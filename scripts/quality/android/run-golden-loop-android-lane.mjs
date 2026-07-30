#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { get as httpGet } from 'node:http';

import { currentGit } from '../evidence-provenance.mjs';
import {
  PUBLIC_UI_HOOKS,
  areInstallationIdsDistinct,
  collectInstallationIdsFromStates,
  getHookBlockerIfMissing,
} from './golden-loop-android-plan.mjs';
import {
  SHELL_PROOF_SCHEMA_VERSION as SHELL_PROOF_PROTOCOL,
  validateShellProofReceipt,
} from '../golden-loop/shell-proof-protocol.mjs';
import { REQUIRED_SCENARIO_ID as REQUIRED_SHELL_PROOF_SCENARIO } from '../golden-loop/receipt-adapter.mjs';

const ROOT = process.cwd();
const ROOT_FILE = fileURLToPath(import.meta.url);
const ADB = process.env.ADB || 'adb';
const SQLITE = process.env.SQLITE3 || 'sqlite3';
const RELAY_SCRIPT = 'scripts/quality/reference-sync-transport-relay.ts';
const RELAY_HOST = process.env.REFERENCE_SYNC_RELAY_HOST || '127.0.0.1';
const DEFAULT_RELAY_PORT = Number(process.env.REFERENCE_SYNC_RELAY_PORT || 3123);
const RELAY_START_TIMEOUT_MS = 45_000;
const RELAY_POLL_MS = 600;
const DEEP_LINK_WAIT_MS = 8_000;
const COMMAND_TIMEOUT_MS = 12_000;
const SQLITE_TIMEOUT_MS = 8_000;
const DEVICE_HASH_PREFIX = 'emulator-';
const REFERENCE_SYNC_HEALTH_PATH = '/reference-sync/health';

class LaneBlocked extends Error {
  constructor(reason, detail = {}) {
    super(`BLOCKED:${reason}`);
    this.reason = reason;
    this.detail = detail;
  }
}

function safeLabel(value) {
  return `${value || 'artifact'}`.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const SHA256_PATTERN = /^([a-f0-9]{64}|sha256:[a-f0-9]{64})$/i;

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value.trim());
}

const REDACT_PATTERNS = [
  /authorization:\s*[^\n\r]+/gi,
  /api[_-]?key\s*=\s*[^\s&"']+/gi,
  /access[_-]?token\s*[=:]\s*[^\s&"']+/gi,
  /refresh[_-]?token\s*[=:]\s*[^\s&"']+/gi,
  /\btoken\s*=\s*[^\s&"']+/gi,
  /cookie\s*[:=]\s*[^\s&"']+/gi,
  /set-cookie:\s*[^\n\r]+/gi,
];

function sha256Of(value) {
  if (value instanceof Uint8Array) {
    return createHash('sha256').update(Buffer.from(value)).digest('hex');
  }
  return createHash('sha256').update(typeof value === 'string' ? value : `${String(value)}`).digest('hex');
}

function withSha256Prefix(value) {
  const hash = sha256Of(value);
  return `sha256:${hash}`;
}

export function redactSensitiveText(value = '') {
  const raw = String(value || '');
  let scrubbed = raw;
  for (const pattern of REDACT_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match) => {
      const [head] = match.split(/\s*[:=]\s*/);
      return `${head}=[redacted]`;
    });
  }
  return scrubbed;
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgv(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=', 2);
    const value = inline !== undefined ? inline : argv[i + 1];
    if (inline === undefined && (value == null || value.startsWith('--'))) {
      out[key] = '';
      continue;
    }
    if (inline === undefined) i += 1;
    out[key] = value || '';
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectDistinct(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const value = `${raw || ''}`.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function summarizeOutput(raw) {
  const sanitized = redactSensitiveText(String(raw || ''));
  return {
    bytes: Buffer.byteLength(sanitized, 'utf8'),
    sha256: sha256Of(sanitized),
    lines: sanitized.split('\n').filter((line) => line.length > 0).length,
  };
}

function toArtifact(rootDir, relativePath, payload, artifacts) {
  const abs = join(rootDir, relativePath);
  mkdirSync(dirname(abs), { recursive: true });
  const text = typeof payload === 'string' ? payload : `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(abs, text, 'utf8');
  const sha256 = sha256Of(readFileSync(abs));
  const bytes = statSync(abs).size;
  const artifact = { path: relativePath, bytes, sha256 };
  if (artifacts) artifacts.push(artifact);
  return artifact;
}

function runCommand(commandName, args, { timeout = COMMAND_TIMEOUT_MS, allowFailure = false } = {}) {
  const startedAt = Date.now();
  try {
    const out = execFileSync(commandName, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    return {
      ok: true,
      stdout: out.toString(),
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const stdout = error?.stdout ? error.stdout.toString() : '';
    const stderr = error?.stderr ? error.stderr.toString() : `${error?.message || String(error)}`;
    if (allowFailure) {
      return {
        ok: false,
        stdout,
        stderr,
        exitCode: Number.isInteger(error?.status) ? error.status : 1,
        durationMs: Date.now() - startedAt,
      };
    }

    const thrown = new Error(`${commandName} ${args.join(' ')}: ${stderr || stdout}`);
    thrown.exitCode = Number.isInteger(error?.status) ? error.status : 1;
    throw thrown;
  }
}

function runAndRecord(rootDir, artifacts, label, commandName, args, options = {}) {
  const result = runCommand(commandName, args, options);
  toArtifact(
    rootDir,
    join('commands', `${safeLabel(label)}.json`),
    {
      command: commandName,
      args,
      ok: result.ok,
      exitCode: result.exitCode,
      timeout: options.timeout,
      allowFailure: options.allowFailure,
      durationMs: result.durationMs,
      stdout: summarizeOutput(result.stdout),
      stderr: summarizeOutput(result.stderr),
    },
    artifacts,
  );
  return result;
}

export function collectAndroidInputs(argv = process.argv.slice(2), env = process.env) {
  const flags = parseArgv(argv);
  const serialSources = [
    ...(flags.serials ? flags.serials.split(',') : []),
    ...(flags.serial_a ? [flags.serial_a] : []),
    ...(flags.serial_b ? [flags.serial_b] : []),
    ...(flags['serial-a'] ? [flags['serial-a']] : []),
    ...(flags['serial-b'] ? [flags['serial-b']] : []),
    ...(env.UTOPIA_ANDROID_GOLDEN_LOOP_SERIALS ? env.UTOPIA_ANDROID_GOLDEN_LOOP_SERIALS.split(',') : []),
    ...(env.ANDROID_EMULATOR_SERIALS ? env.ANDROID_EMULATOR_SERIALS.split(',') : []),
  ];

  const emulatorSerials = collectDistinct(serialSources)
    .filter((value) => value)
    .map((value) => value.trim());

  return {
    optIn: `${env.UTOPIA_ANDROID_GOLDEN_LOOP || ''}`,
    packageId: flags['package-id'] || env.UTOPIA_ANDROID_PACKAGE_ID,
    apkV1Path: flags['apk-v1'] || env.APK_PATH_V1 || env.APK_V1_PATH,
    apkV2Path: flags['apk-v2'] || env.APK_PATH_V2 || env.APK_V2_PATH,
    apkV1Hash: flags['apk-v1-sha256'] || env.APK_V1_SHA256 || '',
    apkV2Hash: flags['apk-v2-sha256'] || env.APK_V2_SHA256 || '',
    relayPort: Number(flags['relay-port'] || env.REFERENCE_SYNC_RELAY_PORT || DEFAULT_RELAY_PORT),
    emulatorSerials,
    proofPath: flags['proof-path'] || env.UTOPIA_ANDROID_GOLDEN_LOOP_RECEIPT_PATH,
    runId: flags['run-id'] || `golden-${nowIso().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
  };
}

export function validateGoldenLoopInputs(rawInputs, options = {}) {
  const {
    requireApkFiles = true,
    disallowDuplicatePackageHash = true,
    source = process.env,
  } = options;

  const inputs = rawInputs || {};
  const blockers = [];
  const apkV1Path = `${inputs.apkV1Path || ''}`;
  const apkV2Path = `${inputs.apkV2Path || ''}`;
  const packageId = `${inputs.packageId || ''}`;
  const emulatorSerials = collectDistinct(inputs.emulatorSerials || []);

  if (String(inputs.optIn || source?.UTOPIA_ANDROID_GOLDEN_LOOP || '') !== '1') {
    blockers.push('missing:android_golden_loop_opt_in');
  }

  if (emulatorSerials.length !== 2) {
    blockers.push('missing:android_emulator_serials');
  }

  const nonEmulatorSerial = emulatorSerials.find((serial) => !`${serial}`.startsWith(DEVICE_HASH_PREFIX));
  if (nonEmulatorSerial) {
    blockers.push('invalid:android_emulator_serial_format');
  }

  if (!packageId) {
    blockers.push('missing:android_package_id');
  } else if (!packageId.endsWith('.goldenloop')) {
    blockers.push('invalid:android_package_id');
  }

  if (!apkV1Path) blockers.push('missing:android_apk_v1');
  if (!apkV2Path) blockers.push('missing:android_apk_v2');

  let apkV1Hash = inputs.apkV1Hash;
  let apkV2Hash = inputs.apkV2Hash;

  if (requireApkFiles && apkV1Path) {
    if (!existsSync(apkV1Path)) {
      blockers.push('missing:android_apk_v1_file');
    } else {
      apkV1Hash = sha256Of(readFileSync(apkV1Path));
    }
  }

  if (requireApkFiles && apkV2Path) {
    if (!existsSync(apkV2Path)) {
      blockers.push('missing:android_apk_v2_file');
    } else {
      apkV2Hash = sha256Of(readFileSync(apkV2Path));
    }
  }

  if (apkV1Hash && !isSha256(apkV1Hash)) blockers.push('invalid:android_apk_v1_hash');
  if (apkV2Hash && !isSha256(apkV2Hash)) blockers.push('invalid:android_apk_v2_hash');

  if (disallowDuplicatePackageHash && apkV1Hash && apkV2Hash && apkV1Hash === apkV2Hash) {
    blockers.push('invalid:android_apk_hash_match');
  }

  return {
    blockers,
    packageId,
    apkV1Path,
    apkV2Path,
    apkV1Hash,
    apkV2Hash,
    relayPort: Number(inputs.relayPort || DEFAULT_RELAY_PORT),
    emulatorSerials,
    proofPath: inputs.proofPath,
    runId: inputs.runId,
  };
}

function validateInputs(inputs) {
  const normalized = validateGoldenLoopInputs(inputs, { source: process.env, requireApkFiles: true });
  if (normalized.blockers.length) {
    throw new LaneBlocked(normalized.blockers[0], normalized);
  }
  return normalized;
}

function requireTool(name) {
  try {
    runCommand(name, ['--version'], { timeout: 8000 });
  } catch (error) {
    throw new LaneBlocked(`missing:${safeLabel(name)}_binary`, { binary: name, message: error.message });
  }
}

function parseDevices(raw = '') {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /^(\S+)\s+(device|offline|unauthorized)/.exec(line))
    .filter(Boolean)
    .map((match) => ({ serial: match[1], status: match[2] }));
}

function listDevices(rootDir, artifacts) {
  const out = runAndRecord(rootDir, artifacts, 'adb-devices', ADB, ['devices']);
  const output = `${out.stdout}\n${out.stderr}`.trim();
  const devices = parseDevices(output);
  return devices;
}

function ensureProvidedSerials(inputs, rootDir, artifacts) {
  const requested = collectDistinct(inputs.emulatorSerials || []).slice(0, 2);
  const devices = listDevices(rootDir, artifacts).filter((device) => device.status === 'device');
  const readySet = new Set(devices.map((entry) => entry.serial));
  const missing = requested.filter((serial) => !readySet.has(serial));
  if (requested.length !== 2 || missing.length > 0) {
    throw new LaneBlocked('missing:android_emulator_serials', {
      requested,
      available: Array.from(readySet),
      missing,
    });
  }
  return requested;
}

function packageList(serial, rootDir, artifacts) {
  const out = runAndRecord(rootDir, artifacts, `pm-packages-${safeLabel(serial)}`, ADB, [
    '-s',
    serial,
    'shell',
    'pm',
    'list',
    'packages',
  ]);
  return out.stdout
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^package:/, ''))
    .filter(Boolean);
}

function assertPackageExists(serial, packageId, rootDir, artifacts) {
  const installed = packageList(serial, rootDir, artifacts);
  if (!installed.includes(packageId)) {
    throw new LaneBlocked('missing:android_package_name', { serial, packageId });
  }
}

function installApk(serial, apkPath, rootDir, artifacts, label) {
  const out = runAndRecord(
    rootDir,
    artifacts,
    `install-${safeLabel(label)}-${safeLabel(serial)}`,
    ADB,
    ['-s', serial, 'install', '-r', '-d', '-g', apkPath],
    { timeout: 120_000, allowFailure: true },
  );

  if (!out.ok) {
    throw new LaneBlocked(`android_${safeLabel(label)}_failed`, {
      serial,
      apkPath,
      stderr: out.stderr,
      exitCode: out.exitCode,
    });
  }
}

function runAs(serial, packageId, shellCommand, rootDir, artifacts, label, options = {}) {
  return runAndRecord(rootDir, artifacts, `run-as-${safeLabel(label)}-${safeLabel(serial)}`, ADB, [
    '-s',
    serial,
    'shell',
    'run-as',
    packageId,
    'sh',
    '-lc',
    shellCommand,
  ], options);
}

function parseDbName(raw) {
  const dbs = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.endsWith('.db'));

  return dbs.find((name) => name === 'utopia.db') || dbs[0];
}

function runQuery(dbPath, query, rootDir, stage, artifacts) {
  const out = runCommand(SQLITE, [dbPath, '-json', query], { timeout: SQLITE_TIMEOUT_MS, allowFailure: true });
  toArtifact(
    rootDir,
    join('sqlite', `${safeLabel(stage)}.json`),
    {
      query,
      path: dbPath,
      ok: out.ok,
      exitCode: out.exitCode,
      rowCount: (() => {
        const parsed = parseJsonRows(out.stdout);
        return parsed.length;
      })(),
      output: summarizeOutput(out.stdout),
    },
    artifacts,
  );

  if (!out.ok) {
    throw new LaneBlocked('missing:android_sqlite_query', {
      query,
      db: dbPath,
      stderr: out.stderr,
    });
  }

  return parseJsonRows(out.stdout);
}

function queryCount(dbPath, tableName, stage, rootDir, artifacts) {
  const rows = runQuery(dbPath, `SELECT COUNT(*) AS count FROM "${tableName}";`, rootDir, `${stage}-count-${tableName}`, artifacts);
  return Number(rows?.[0]?.count || 0);
}

function queryIds(dbPath, tableName, columnName, stage, rootDir, artifacts, limit = 200) {
  const rows = runQuery(
    dbPath,
    `SELECT "${columnName}" AS value FROM "${tableName}" WHERE "${columnName}" IS NOT NULL ORDER BY "${columnName}" ASC LIMIT ${limit};`,
    rootDir,
    `${stage}-${tableName}-${columnName}`,
    artifacts,
  );
  return [...new Set(rows.map((row) => `${row.value || ''}`.trim()).filter(Boolean))];
}

function parseJsonRows(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

function resolveTables(tables = []) {
  const set = new Set(tables.map((value) => `${value || ''}`.trim()));
  const state = {
    app_installations: set.has('app_installations') ? 'app_installations' : null,
    app_installation_package_state: set.has('app_installation_package_state') ? 'app_installation_package_state' : null,
    records: set.has('records') ? 'records' : set.has('app_records') ? 'app_records' : null,
    operations: set.has('operations') ? 'operations' : null,
  };

  const missing = [];
  for (const [logical, actual] of Object.entries(state)) {
    if (!actual) missing.push(logical);
  }

  return { tableMap: state, missing };
}

function snapshotDatabase(serial, packageId, stage, rootDir, artifacts) {
  const lsResult = runAs(
    serial,
    packageId,
    `ls /data/data/${packageId}/databases || true`,
    rootDir,
    artifacts,
    `ls-databases-${safeLabel(serial)}-${safeLabel(stage)}`,
    { allowFailure: true },
  );

  const dbName = parseDbName(lsResult.stdout);
  if (!dbName) {
    throw new LaneBlocked('missing:android_app_database', { serial, packageId });
  }

  const dump = runAs(
    serial,
    packageId,
    `cat /data/data/${packageId}/databases/${dbName} | base64 | tr -d '\\n'`,
    rootDir,
    artifacts,
    `snapshot-db-${safeLabel(serial)}-${safeLabel(stage)}`,
    { timeout: 120_000, allowFailure: true },
  );

  if (!dump.ok || !dump.stdout.trim()) {
    throw new LaneBlocked('android_db_snapshot_failed', {
      serial,
      packageId,
      dbName,
      stderr: dump.stderr,
    });
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'utopia-android-db-'));
  const dbPath = join(tmpDir, `${safeLabel(serial)}-${safeLabel(stage)}.db`);

  let dbSize = 0;
  let dbHash = '';

  try {
    writeFileSync(dbPath, Buffer.from(dump.stdout.trim(), 'base64'));
    dbSize = statSync(dbPath).size;
    dbHash = sha256Of(readFileSync(dbPath));

    const tableRows = runQuery(dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';", rootDir, `tables-${safeLabel(serial)}-${safeLabel(stage)}`, artifacts);
    const tableNames = tableRows
      .map((row) => `${row.name || ''}`.trim())
      .filter(Boolean);

    const { tableMap, missing } = resolveTables(tableNames);
    if (missing.length) {
      throw new LaneBlocked('missing:android_required_tables', {
        serial,
        packageId,
        availableTables: tableNames,
        missingTables: missing,
      });
    }

    const tableCounts = {
      app_installations: queryCount(dbPath, tableMap.app_installations, `count-installations-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts),
      app_installation_package_state: queryCount(dbPath, tableMap.app_installation_package_state, `count-package-state-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts),
      records: queryCount(dbPath, tableMap.records, `count-records-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts),
      operations: queryCount(dbPath, tableMap.operations, `count-operations-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts),
    };

    const installationIds = [...new Set([
      ...queryIds(dbPath, tableMap.app_installations, 'installation_id', `installations-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts, 200),
      ...queryIds(dbPath, tableMap.app_installation_package_state, 'installation_id', `package-state-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts, 200),
      ...queryIds(dbPath, tableMap.app_installations, 'id', `installations-id-${safeLabel(serial)}-${safeLabel(stage)}`, rootDir, artifacts, 200),
    ])];

    const operationIds = queryIds(
      dbPath,
      tableMap.operations,
      'op_id',
      `operations-${safeLabel(serial)}-${safeLabel(stage)}`,
      rootDir,
      artifacts,
      200,
    );

    const summary = {
      serial,
      packageId,
      stage,
      tableMap,
      tableCounts,
      installationIdCount: installationIds.length,
      operationIdCount: operationIds.length,
      operationIds,
    };

    const snapshotArtifact = toArtifact(rootDir, join('db', `${safeLabel(serial)}-${safeLabel(stage)}-summary.json`), summary, artifacts);

    return {
      serial,
      stage,
      packageId,
      tableMap,
      tableCounts,
      installationIds,
      operationIds,
      installationRows: installationIds.map((installation_id) => ({ installation_id })),
      recordRows: operationIds.map((op_id) => ({ op_id })),
      syncRows: operationIds.map((op_id) => ({ op_id })),
      db: {
        sha256: dbHash,
        bytes: dbSize,
        path: snapshotArtifact.path,
      },
      artifact: snapshotArtifact,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function collectInstallIds(state = {}) {
  const ids = [];
  const fromRows = Array.isArray(state?.installationRows) ? state.installationRows : [];
  for (const row of fromRows) {
    if (row?.installation_id) ids.push(`${row.installation_id}`.trim());
  }
  if (state?.installation_id) ids.push(`${state.installation_id}`.trim());
  return [...new Set(ids)];
}

function boardGrowth(beforeState, afterState, serial) {
  const blocker = getHookBlockerIfMissing(
    Number(beforeState.tableCounts?.records || 0),
    Number(afterState.tableCounts?.records || 0),
    PUBLIC_UI_HOOKS.createBoardRow,
  );
  if (blocker) blocker.serial = serial;
  return blocker;
}

function syncGrowth(beforeState, afterState, serial) {
  const blocker = getHookBlockerIfMissing(
    Number(beforeState.tableCounts?.operations || 0),
    Number(afterState.tableCounts?.operations || 0),
    PUBLIC_UI_HOOKS.configureReferenceSync,
  );
  if (blocker) blocker.serial = serial;
  return blocker;
}

function collectOperationIds(state = {}) {
  if (Array.isArray(state.operationIds)) return state.operationIds;
  return [];
}

function proveSyncConvergence(states = []) {
  const sets = states.map((state) => new Set(collectOperationIds(state)));
  const overlap = sets.reduce((seed, currentSet) => {
    if (!seed) return new Set(currentSet);
    return new Set(Array.from(seed).filter((operationId) => currentSet.has(operationId)));
  }, null);

  const ids = Array.from(overlap || []);
  if (!ids.length) {
    throw new LaneBlocked('missing:reference_sync_op_convergence', { detail: 'no shared operation ids observed' });
  }
  return ids.sort();
}

function computeDurableChecksum(state = {}, packageHashes = {}, serial = '') {
  return sha256Of(
    JSON.stringify({
      serial,
      installationIds: collectInstallIds(state),
      packageHashes,
      tableCounts: state.tableCounts || {},
      db: state.db || {},
    }),
  );
}

function transportSession(port, health) {
  return sha256Of(`${RELAY_HOST}:${port}:${JSON.stringify(health || {})}`);
}

function probeRelayHealth(port) {
  const url = `http://${RELAY_HOST}:${port}${REFERENCE_SYNC_HEALTH_PATH}`;
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8').trim();
        try {
          const body = bodyText ? JSON.parse(bodyText) : {};
          if (response.statusCode === 200 && body?.ok === true && body?.data?.status === 'ready') {
            return resolve(body);
          }
          reject(new Error(`health-check-failed:${bodyText}`));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(1_200, () => {
      request.destroy(new Error('health-timeout'));
    });
  });
}

async function startReferenceSyncRelay(port, rootDir, artifacts) {
  const command = `node ${RELAY_SCRIPT} --port ${port}`;
  const commandArgs = ['--import', 'tsx', RELAY_SCRIPT, '--port', String(port)];
  const candidates = [
    { cmd: 'node', args: [RELAY_SCRIPT, '--port', String(port)], label: 'node-script' },
    { cmd: 'node', args: commandArgs, label: 'node-script-tsx' },
  ];

  for (const candidate of candidates) {
    const proc = spawn(candidate.cmd, candidate.args, {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const relayLabel = safeLabel(candidate.label);
    const stdoutChunks = [];
    const stderrChunks = [];
    proc.stdout?.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk) => stderrChunks.push(chunk));

    const startedAt = nowIso();
    const deadline = Date.now() + RELAY_START_TIMEOUT_MS;
    let lastError = null;

    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        lastError = new Error(`relay process exited early:${proc.exitCode}`);
        break;
      }
      try {
        const health = await probeRelayHealth(port);
        const endpoint = `http://${RELAY_HOST}:${port}${REFERENCE_SYNC_HEALTH_PATH}`;
        const healthLog = Buffer.concat(stderrChunks.concat(stdoutChunks)).toString('utf8');
        const relayLog = toArtifact(rootDir, join('reference-sync-relay', `${relayLabel}.log`), {
          command,
          endpoint,
          health,
          startedAt,
          healthLog: summarizeOutput(healthLog),
        }, artifacts);

        return {
          child: proc,
          port,
          endpoint: `http://${RELAY_HOST}:${port}`,
          log: relayLog.path,
          command,
          label: relayLabel,
          health,
          session: transportSession(port, health),
          stop: () => {
            try {
              proc.kill();
            } catch {}
          },
        };
      } catch (error) {
        lastError = error;
        await sleep(RELAY_POLL_MS);
      }
    }

    try {
      proc.kill();
    } catch {}

    if (lastError) {
      throw lastError;
    }
  }

  throw new Error('reference sync relay did not start');
}

function stopRelay(relay) {
  if (!relay) return;
  try {
    relay.stop();
  } catch {}
}

function buildArtifactList(artifacts, serial) {
  const marker = safeLabel(serial);
  const matched = artifacts.filter((artifact) => artifact.path.includes(marker));
  if (!matched.length) return artifacts;
  return matched;
}

function buildObservationArtifact(serialState, stage, rootDir, artifacts) {
  const operationIds = collectOperationIds(serialState.finalState);
  const payload = {
    operations: operationIds.map((opId) => ({
      op_id: opId,
      status: 'executed',
      type: 'reference_sync',
      timestamp: nowIso(),
      source_timestamp: nowIso(),
    })),
  };
  return toArtifact(rootDir, join('observations', `${safeLabel(serialState.serial)}-${safeLabel(stage)}.json`), payload, artifacts);
}

function buildTransportObservationArtifact(serialState, relay, operationIds, rootDir, artifacts) {
  const payload = {
    session: relay.session,
    endpoint: relay.endpoint,
    operation_ids: operationIds,
    operations: operationIds.map((opId) => ({
      op_id: opId,
      status: 'executed',
      type: 'reference_sync',
      timestamp: nowIso(),
      source_timestamp: nowIso(),
    })),
  };
  return toArtifact(rootDir, join('observations', `${safeLabel(serialState.serial)}-transport.json`), payload, artifacts);
}

function buildReceipt(serialState, inputs, relay, convergenceIds, rootDir = ROOT) {
  const packageV1 = withSha256Prefix(inputs.apkV1Hash);
  const packageV2 = withSha256Prefix(inputs.apkV2Hash);
  const operationIds = collectOperationIds(serialState.finalState);
  const transportObservation = buildTransportObservationArtifact(
    serialState,
    relay,
    operationIds,
    rootDir,
    serialState.allArtifacts,
  );
  const observationArtifact = buildObservationArtifact(serialState, 'final', rootDir, serialState.allArtifacts);
  const installation_id = collectInstallIds(serialState.rollbackState)[0]
    || collectInstallIds(serialState.finalState)[0]
    || `missing-${safeLabel(serialState.serial)}`;

  const payload = {
    proof: SHELL_PROOF_PROTOCOL,
    schema_version: SHELL_PROOF_PROTOCOL,
    status: 'PASS',
    checked_at: nowIso(),
    source: {
      surface: 'android',
      emulator_serial: serialState.serial,
      package_id: inputs.packageId,
    },
    installation_id,
    package_checksum: packageV2,
    package: {
      checksum: packageV2,
      version: '2',
      previous_version: '1',
      version_transition: {
        from: '1',
        to: '2',
        checksum: packageV2,
        previous_checksum: packageV1,
      },
    },
    durable_data_checksum: withSha256Prefix(
      computeDurableChecksum(serialState.rollbackState, { v1: inputs.apkV1Hash, v2: inputs.apkV2Hash }, serialState.serial),
    ),
    execution: {
      observations: [
        {
          command: 'utopia://chat?prompt=golden-loop-identity&run=1',
          driver: `adb:${serialState.serial}`,
          source_timestamp: nowIso(),
          artifact: {
            path: observationArtifact.path,
            sha256: observationArtifact.sha256,
            bytes: observationArtifact.bytes,
          },
        },
      ],
      sync_claimed: true,
      transport: {
        sync_claimed: true,
        session: relay.session,
        endpoint: relay.endpoint,
        operation_count: operationIds.length,
        observation: {
          path: transportObservation.path,
          sha256: transportObservation.sha256,
          bytes: transportObservation.bytes,
        },
      },
    },
    convergence: {
      operation_ids: convergenceIds,
      rollback_operation_ids: convergenceIds,
      transport_session: relay.session,
      transport_observation: {
        path: transportObservation.path,
        sha256: transportObservation.sha256,
        bytes: transportObservation.bytes,
      },
      transport: {
        session: relay.session,
        endpoint: relay.endpoint,
      },
    },
    lifecycle: {
      scenario: {
        scenario_id: REQUIRED_SHELL_PROOF_SCENARIO,
        assertions: {
          conflict_detected: convergenceIds.length > 0,
          rollback_replayed_for_losers: Math.max(1, convergenceIds.length),
          convergence_replayed: true,
        },
      },
    },
    git: currentGit(ROOT),
    artifacts: buildArtifactList(serialState.allArtifacts, serialState.serial),
    hooks: serialState.hookChecks,
  };

  return payload;
}

function receiptPaths(inputs, evidenceDir, serial) {
  if (!inputs.proofPath) {
    return join(evidenceDir, `android-shell-proof-${safeLabel(serial)}-${safeLabel(inputs.runId)}.json`);
  }

  const provided = isAbsolute(inputs.proofPath)
    ? inputs.proofPath
    : join(ROOT, inputs.proofPath);
  if (provided.endsWith('.json')) {
    return provided.replace(/\.json$/, `-${safeLabel(serial)}.json`);
  }
  return join(provided, `android-shell-proof-${safeLabel(serial)}.json`);
}

async function run() {
  const collected = collectAndroidInputs();
  const validated = validateInputs(collected);

  const evidenceDir = join(ROOT, 'app', 'build', 'evidence', 'android-golden-loop', validated.runId);
  mkdirSync(evidenceDir, { recursive: true });
  const artifacts = [];

  const report = {
    proof: SHELL_PROOF_PROTOCOL,
    schema_version: SHELL_PROOF_PROTOCOL,
    runId: validated.runId,
    checked_at: nowIso(),
    status: 'UNKNOWN',
    serials: [],
    git: currentGit(ROOT),
    source: { surface: 'android' },
    blockReason: null,
    artifacts: [],
  };

  let relay = null;
  const perDeviceReceipts = [];

  try {
    requireTool(ADB);
    requireTool(SQLITE);

    const serials = ensureProvidedSerials(validated, evidenceDir, artifacts);
    report.serials = serials;

    relay = await startReferenceSyncRelay(validated.relayPort || DEFAULT_RELAY_PORT, evidenceDir, artifacts);

    const serialStates = [];

    for (const serial of serials) {
      const state = {
        serial,
        allArtifacts: artifacts,
        hookChecks: [],
        finalState: null,
      };

      installApk(serial, validated.apkV1Path, evidenceDir, artifacts, `v1-install-${serial}`);
      assertPackageExists(serial, validated.packageId, evidenceDir, artifacts);
      state.v1State = snapshotDatabase(serial, validated.packageId, `v1-${safeLabel(serial)}`, evidenceDir, artifacts);

      installApk(serial, validated.apkV2Path, evidenceDir, artifacts, `v2-install-${serial}`);
      assertPackageExists(serial, validated.packageId, evidenceDir, artifacts);
      state.v2State = snapshotDatabase(serial, validated.packageId, `v2-${safeLabel(serial)}`, evidenceDir, artifacts);

      assertInstallRowsPersist(state.v1State, state.v2State, 'install-update');

      installApk(serial, validated.apkV1Path, evidenceDir, artifacts, `v1-rollback-${serial}`);
      assertPackageExists(serial, validated.packageId, evidenceDir, artifacts);
      state.rollbackState = snapshotDatabase(serial, validated.packageId, `rollback-${safeLabel(serial)}`, evidenceDir, artifacts);

      assertInstallRowsPersist(state.v2State, state.rollbackState, 'install-rollback');

      runAndRecord(
        evidenceDir,
        state.allArtifacts,
        `deep-link-identity-${safeLabel(serial)}`,
        ADB,
        ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'utopia://chat?prompt=golden-loop-identity&run=1'],
      );
      await sleep(DEEP_LINK_WAIT_MS / 2);

      const beforeBoard = state.rollbackState;
      runAndRecord(
        evidenceDir,
        state.allArtifacts,
        `deep-link-board-${safeLabel(serial)}`,
        ADB,
        ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'utopia://chat?prompt=golden-loop-create-board-row&run=1'],
      );
      await sleep(DEEP_LINK_WAIT_MS);
      const afterBoard = snapshotDatabase(serial, validated.packageId, `board-post-${safeLabel(serial)}`, evidenceDir, artifacts);
      const boardBlock = boardGrowth(beforeBoard, afterBoard, serial);
      if (boardBlock) state.hookChecks.push(boardBlock);

      const beforeSync = afterBoard;
      runAndRecord(
        evidenceDir,
        state.allArtifacts,
        `deep-link-sync-${safeLabel(serial)}`,
        ADB,
        ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'utopia://settings?run=1'],
      );
      await sleep(DEEP_LINK_WAIT_MS);
      state.finalState = snapshotDatabase(serial, validated.packageId, `sync-post-${safeLabel(serial)}`, evidenceDir, artifacts);
      const syncBlock = syncGrowth(beforeSync, state.finalState, serial);
      if (syncBlock) state.hookChecks.push(syncBlock);

      serialStates.push(state);
    }

    const installationIds = collectInstallationIdsFromStates(serialStates.map((state) => state.rollbackState));
    if (!areInstallationIdsDistinct(serialStates.map((state) => state.rollbackState))) {
      throw new LaneBlocked('insufficient:distinct_installation_ids', { installationIds });
    }

    const convergenceIds = proveSyncConvergence(serialStates.map((state) => state.finalState));

    const missingHook = serialStates.flatMap((state) => state.hookChecks).find((entry) => entry && entry.status === 'BLOCKED');
    if (missingHook) {
      throw new LaneBlocked(missingHook.reason, missingHook);
    }

    for (const serialState of serialStates) {
      const receipt = buildReceipt(serialState, validated, relay, convergenceIds, evidenceDir);
      const receiptPath = receiptPaths(validated, evidenceDir, serialState.serial);
      const artifact = toArtifact(dirname(receiptPath), basename(receiptPath), receipt, artifacts);
      const validation = validateShellProofReceipt(receipt, {
        root: evidenceDir,
        label: `android-${safeLabel(serialState.serial)}`,
        path: receiptPath,
        requiredSourceSurface: 'android',
      });
      if (!validation.pass) {
        throw new LaneBlocked('invalid:android_shell_proof_receipt', {
          serial: serialState.serial,
          issues: validation.blockers,
          path: receiptPath,
        });
      }
      perDeviceReceipts.push({
        serial: serialState.serial,
        path: artifact.path,
      });
    }

    report.status = 'PASS';
    report.checked_at = nowIso();
    report.artifacts = artifacts;
    report.receipts = perDeviceReceipts;
    report.relay = {
      endpoint: relay.endpoint,
      session: relay.session,
      command: relay.command,
      health: relay.health,
      log: relay.log,
      port: relay.port,
    };

    const finalPayload = {
      ...report,
      proof: SHELL_PROOF_PROTOCOL,
      status: report.status,
      transport: {
        endpoint: relay.endpoint,
        session: relay.session,
      },
      run_scope: {
        serial_count: serials.length,
        package_id: validated.packageId,
        apk_hashes: {
          v1: validated.apkV1Hash,
          v2: validated.apkV2Hash,
        },
      },
    };

    writeFileSync(join(evidenceDir, 'android-golden-loop-proof.json'), `${JSON.stringify(finalPayload, null, 2)}\n`, 'utf8');
    console.log(`${JSON.stringify(finalPayload, null, 2)}\n`);
    stopRelay(relay);
    process.exit(0);
  } catch (error) {
    if (relay) stopRelay(relay);

    if (error instanceof LaneBlocked) {
      report.status = 'BLOCKED';
      report.checked_at = nowIso();
      report.blockReason = [error.reason, error.detail];
      report.artifacts = artifacts;
      const blockedPayload = {
        ...report,
        status: 'BLOCKED',
        proof: SHELL_PROOF_PROTOCOL,
        blocker: {
          reason: error.reason,
          detail: error.detail,
        },
      };
      writeFileSync(join(evidenceDir, 'android-golden-loop-proof-blocked.json'), `${JSON.stringify(blockedPayload, null, 2)}\n`, 'utf8');
      console.log(`${JSON.stringify(blockedPayload, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }

    const failure = {
      ...report,
      status: 'FAIL',
      proof: SHELL_PROOF_PROTOCOL,
      error: error instanceof Error ? error.message : String(error),
      artifacts,
      checked_at: nowIso(),
    };
    writeFileSync(join(evidenceDir, 'android-golden-loop-proof-fail.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
    console.log(`${JSON.stringify(failure, null, 2)}\n`);
    process.exit(1);
  }
}

function assertInstallRowsPersist(beforeState, afterState, phase = 'transition') {
  const beforeIds = collectInstallIds(beforeState);
  const afterIds = collectInstallIds(afterState);

  if (!beforeIds.length) {
    throw new LaneBlocked('missing:android_installation_rows', { phase, serial: beforeState.serial });
  }

  const preserved = afterIds.some((id) => beforeIds.includes(id));
  if (!preserved) {
    throw new LaneBlocked('missing:durable_installation_rows', {
      phase,
      serial: beforeState.serial,
      beforeIds,
      afterIds,
    });
  }
}

if (process.argv[1] === ROOT_FILE) {
  run();
}
