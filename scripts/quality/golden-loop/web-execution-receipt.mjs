#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';
import { ensureWebBaseUrl } from '../web-static-server.mjs';
import { SHELL_PROOF_SCHEMA_VERSION, validateShellProofReceipt } from './shell-proof-protocol.mjs';
import {
  buildSharedHouseholdBoardWebPackageArtifacts,
  SHARED_HOUSEHOLD_BOARD_ID,
  writeSharedHouseholdBoardWebPackageArtifacts,
} from './web-package-artifacts.mjs';

const root = process.cwd();
const baseUrl = process.env.UTOPIA_WEB_BASE_URL || process.env.LIFEOS_WEB_BASE_URL || 'http://127.0.0.1:8094';
const outDir = join(root, 'app', 'build', 'evidence', 'golden-loop');
const explicitOutPath = process.env.UTOPIA_WEB_GOLDEN_LOOP_EXECUTION_RECEIPT_PATH;
const outPath = explicitOutPath
  ? (isAbsolute(explicitOutPath) ? explicitOutPath : join(outDir, explicitOutPath))
  : join(outDir, 'web-execution-receipt.json');
const packageArtifactsDir = join(outDir, 'web-packages');
const sourceFixturePath = process.env.WEB_GOLDEN_LOOP_SOURCE_FIXTURE_PATH
  || 'tests/fixtures/golden-loop/shared-household-board.source.json';

const INSTALL_PATH = '/install';
const APP_PATH_PREFIX = '/apps/';
const CONTROL_ROOM_PATH = '/package-control-room';
const REQUIRED_SCENARIO_ID = 'convergence-conflict-rollback-v1';
const SHELL_PROOF_PROTOCOL_VERSION = SHELL_PROOF_SCHEMA_VERSION;

function normalizeChecksum(raw) {
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(normalized)) return `sha256:${normalized}`;
  if (/^sha256:[a-f0-9]{64}$/.test(normalized)) return normalized;
  return null;
}

export function hashText(value) {
  return `sha256:${createHash('sha256').update(String(value ?? '')).digest('hex')}`;
}

function hashPayload(value) {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeParseJson(input) {
  try {
    if (!input) return null;
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function extractString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizeObservedOperationId(value) {
  const raw = extractString(value);
  if (!raw) return null;
  if (/^sha256:[a-f0-9]{64}$/.test(raw.toLowerCase())) return raw.toLowerCase();
  if (/^[a-f0-9]{64}$/.test(raw.toLowerCase())) return `sha256:${raw.toLowerCase()}`;
  return hashText(raw);
}

function collectObservedOperationIds(value, blockLabel, blockers = []) {
  const values = [];
  if (typeof value === 'string') {
    values.push(value);
  } else if (Array.isArray(value)) {
    values.push(...value);
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const candidate of [
      value.operationId,
      value.operation_id,
      value.opId,
      value.op_id,
      value.id,
    ]) {
      if (extractString(candidate)) values.push(candidate);
    }

    if (Array.isArray(value.operations)) {
      for (const operation of value.operations) {
        for (const candidate of collectObservedOperationIds(operation, blockLabel, blockers)) {
          values.push(candidate);
        }
      }
    }
  } else if (value != null && blockLabel) {
    blockers.push(`invalid_${blockLabel}`);
  }

  return values
    .map((entry) => normalizeObservedOperationId(entry))
    .filter(Boolean);
}

function makeReferenceSyncSessionId(parts) {
  const workspaceId = extractString(parts?.workspaceId);
  const installationId = extractString(parts?.installationId);
  const deviceId = extractString(parts?.deviceId);

  if (!workspaceId && !installationId && !deviceId) return null;
  return [workspaceId || 'none', installationId || 'none', deviceId || 'none'].join('|');
}

export function sanitizeHeadersForEvidence(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }

  const allowlistedHeaders = new Set([
    'accept',
    'accept-language',
    'accept-encoding',
    'content-type',
    'content-length',
    'cache-control',
    'user-agent',
  ]);

  return Object.entries(headers)
    .filter(([key, value]) => {
      const normalized = String(key || '').toLowerCase();
      return allowlistedHeaders.has(normalized)
        && typeof value === 'string'
        && value.trim().length > 0;
    })
    .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

export function extractReferenceSyncMetadataFromResponse(payload) {
  const body = safeParseJson(payload);
  const data = body && typeof body === 'object' && body && 'data' in body ? body.data : body;
  const asObject = data && typeof data === 'object' ? data : {};
  const workspaceId = extractString(asObject.workspaceId ?? body?.workspaceId);
  const installationId = extractString(asObject.installationId ?? body?.installationId);
  const deviceId = extractString(asObject.deviceId ?? body?.deviceId);

  const opId = extractString(asObject.opId ?? asObject.operationId ?? asObject.operation_id);
  const operationIds = collectObservedOperationIds(
    opId ? [opId, ...(asObject.operationIds ?? [])] : asObject.operationIds,
    'operation_ids',
  );
  const rollbackOperationIds = collectObservedOperationIds(
    asObject.rollbackOperationId
      ?? asObject.rollback_operation_id
      ?? asObject.rollback_op_id
      ?? asObject.rollbackOperationIds
      ?? asObject.rollback_operation_ids,
    'rollback_operation_ids',
  );
  const reconciledOperationId = collectObservedOperationIds(
    asObject.reconciledOperationId
      ?? asObject.reconciled_operation_id
      ?? asObject.winnerOpId
      ?? asObject.winner_op_id,
    'reconciled_operation_id',
  )[0] || null;

  const responseSession = extractString(asObject.session ?? asObject.session_id ?? asObject.sync_session);
  const observedEndpoint = extractString(asObject.endpoint ?? asObject.base_url);

  const cursor = extractString(asObject.cursor ?? asObject.sync_cursor ?? asObject.persisted_cursor);
  const status = extractString(asObject.status ?? asObject.state);
  const rawSessionId = responseSession
    || makeReferenceSyncSessionId({ workspaceId, installationId, deviceId });
  const sessionId = rawSessionId ? hashText(rawSessionId) : null;
  const conflictDetected = extractBoolean(
    asObject.conflict_detected
      ?? asObject.conflictDetected
      ?? asObject.conflict
      ?? asObject.has_conflict
      ?? asObject.hasConflict,
  );
  const convergenceReplayed = extractBoolean(
    asObject.convergence_replayed
      ?? asObject.convergenceReplayed
      ?? asObject.convergence
      ?? asObject.converged,
  );
  const rollbackReplayed = extractBoolean(
    asObject.rollback_replayed
      ?? asObject.rollbackReplayed
      ?? asObject.rollback_replay,
  );
  const sessionObserved = Boolean(responseSession);
  const endpointObserved = Boolean(observedEndpoint);
  const hasOperation = operationIds.length > 0;
  const hasRollbackOperation = rollbackOperationIds.length > 0;
  const hasReconciledOperation = Boolean(reconciledOperationId);

  return {
    workspaceId,
    installationId,
    deviceId,
    cursorHash: cursor ? hashText(cursor) : null,
    status,
    sessionId: sessionId || null,
    operationIds,
    rollbackOperationIds,
    reconciledOperationId,
    cursorObserved: cursor !== null,
    hasOperation,
    hasRollbackOperation,
    hasReconciledOperation,
    hasConflictObserved: conflictDetected === true,
    hasConvergenceObserved: convergenceReplayed === true,
    conflictDetected,
    convergenceReplayed,
    rollbackReplayed,
    sessionObserved,
    endpointObserved,
    rawSession: responseSession || null,
    endpoint: observedEndpoint || null,
    session: {
      workspace_id_hash: workspaceId ? hashText(workspaceId) : null,
      installation_id_hash: installationId ? hashText(installationId) : null,
      device_id_hash: deviceId ? hashText(deviceId) : null,
      session_id_hash: sessionId,
    },
  };
}

function hashTextRecord(value) {
  const text = String(value ?? '');
  return {
    bytes: text.length,
    sha256: hashText(text),
    text,
  };
}

function hashPayloadRecord(payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  return {
    bytes: text.length,
    sha256: hashText(text),
    payload,
  };
}

function writeHashedArtifact(filePath, payload) {
  const record = hashPayloadRecord(payload);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return {
    path: resolve(filePath),
    bytes: record.bytes,
    sha256: record.sha256.replace('sha256:', ''),
    checksum: record.sha256,
  };
}

function requirePlaywright() {
  const moduleDirs = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    process.env.CODEX_PRIMARY_NODE_MODULES,
    '/Users/srinivasvaddi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules',
  ].filter(Boolean);

  for (const dir of moduleDirs) {
    try {
      return createRequire(join(dir, 'package.json'))('playwright');
    } catch {
      // continue
    }
  }

  return createRequire(join(root, 'package.json'))('playwright');
}

function chromiumLaunchOptions(chromium) {
  const configured = process.env.UTOPIA_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const systemCandidates = process.platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
    : [];
  const bundled = chromium.executablePath();
  const executablePath = [configured, bundled, ...systemCandidates]
    .filter(Boolean)
    .find((candidate) => existsSync(candidate));

  return executablePath
    ? { headless: true, executablePath }
    : { headless: true };
}

function isReferenceSyncUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.includes('/reference-sync/') || pathname.includes('/reference-sync');
  } catch {
    return false;
  }
}

function isConvergenceObservation(url) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.includes('/reference-sync/convergence')
      || pathname.includes('/reference-sync/status')
      || pathname.includes('/reference-sync/v1/sync')
      || pathname.includes('/reference-sync/v1/snapshot');
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueBlockers(values) {
  return unique(values);
}

async function captureText(page) {
  return page.locator('body').innerText({ timeout: 12000 });
}

async function waitForRuntimeBody(page) {
  await page.waitForFunction(
    () => (document.body?.innerText?.trim().length ?? 0) > 0,
    undefined,
    { timeout: 12000 },
  ).catch(() => undefined);
}

async function findPackageUrlInput(page) {
  const candidates = [
    page.getByLabel(/Package URL/i),
    page.getByPlaceholder(/Package URL/i),
    page.getByRole('textbox', { name: /Package/i }),
    page.locator('input[type="url"], input[type="text"], textarea').first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.count()) return candidate.first();
  }
  return null;
}

async function findButtonByText(page, patterns) {
  for (const pattern of patterns) {
    const locator = page.getByRole('button', { name: pattern });
    if (await locator.count()) return locator.first();
  }
  return null;
}

function parseVersionFromText(text) {
  const match = text.match(/shared-household-board@([0-9]+\.[0-9]+\.[0-9]+)/i);
  return match?.[1] ?? null;
}

function parsePackageIdentityFromText(text) {
  const match = text.match(/(shared-household-board)@([0-9]+\.[0-9]+\.[0-9]+)/i);
  return match ? { id: match[1], version: match[2] } : null;
}

function getInstallationIdFromUrl(url) {
  const match = url.match(/\/apps\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function summarizeArtifacts(artifacts, written, screenshots, observationArtifacts, shellProofArtifacts, receiptPath) {
  return {
    path: resolve(receiptPath),
    package_sources: {
      v1: {
        path: written?.v1?.path,
        version: artifacts.version.v1,
        packageUrl: artifacts.urls.v1,
        checksum: artifacts.v1.checksum,
      },
      v2: {
        path: written?.v2?.path,
        version: artifacts.version.v2,
        packageUrl: artifacts.urls.v2,
        checksum: artifacts.v2.checksum,
      },
    },
    metadata: written?.metadataPath,
    checksum: normalizeChecksum(artifacts.v2.checksum),
    screenshots,
    observation_artifacts: observationArtifacts,
    shell_proofs: shellProofArtifacts,
  };
}

function makeLifecycleAssertions(referenceSync) {
  return {
    conflict_detected: Boolean(referenceSync?.conflictDetected),
    rollback_replayed_for_losers: Number.isInteger(referenceSync?.rollbackOperationIds?.length)
      ? referenceSync.rollbackOperationIds.length
      : (referenceSync?.hasRollbackOperation ? 1 : 0),
    convergence_replayed: Boolean(referenceSync?.convergenceReplayed),
  };
}

function resolveExecutionObserverMetadata() {
  return {
    kind: 'playwright',
    command: 'web_execution_receipt',
    driver: 'golden-loop',
  };
}

function buildExecutionOperationEntries(referenceSync) {
  const referenceOpSet = new Set(referenceSync?.operationIds ?? []);
  const executionOperations = [];
  const rollbackOperationIds = [...new Set(referenceSync?.rollbackOperationIds ?? [])];
  const reconciledOperationId = extractString(referenceSync?.reconciledOperationId);
  const observedOperationIds = [];
  const seen = new Set();

  const addOperation = (operationId, type, status) => {
    const operation = {
      op_id: operationId,
      type,
      status,
      timestamp: new Date().toISOString(),
    };
    if (!seen.has(operationId)) {
      seen.add(operationId);
      executionOperations.push(operation);
      observedOperationIds.push(operationId);
    }
  };

  for (const operationId of referenceOpSet) {
    addOperation(operationId, 'reference_sync', 'applied');
  }

  for (const operationId of rollbackOperationIds) {
    addOperation(operationId, 'rollback', 'replayed');
  }

  for (const operationId of [reconciledOperationId].filter(Boolean)) {
    addOperation(operationId, 'reconciled', 'replayed');
  }

  const operationIds = [...new Set(observedOperationIds)];

  return {
    operations: executionOperations,
    operationIds,
    rollbackOperationIds,
    reconciledOperationId,
  };
}

function writeExecutionObservationsArtifact(baseDir, packageOperations) {
  const source = {
    source_timestamp: new Date().toISOString(),
    observer: resolveExecutionObserverMetadata(),
    operations: packageOperations,
  };
  const artifactPath = join(baseDir, 'web-golden-loop-execution-observations-v1.json');
  const artifact = writeHashedArtifact(artifactPath, source);
  return {
    observation: {
      observer_kind: resolveExecutionObserverMetadata().kind,
      driver: resolveExecutionObserverMetadata().driver,
      command: resolveExecutionObserverMetadata().command,
      source_timestamp: source.source_timestamp,
      artifact: {
        path: artifact.path,
        sha256: `sha256:${artifact.sha256}`,
        bytes: artifact.bytes,
      },
    },
    artifact: {
      path: artifact.path,
      sha256: `sha256:${artifact.sha256}`,
      bytes: artifact.bytes,
    },
  };
}

function writeSyncTransportArtifact(baseDir, transportSession, endpoint, operationIds, operationCount, rawObservations) {
  const artifactPayload = {
    observed_at: new Date().toISOString(),
    session: transportSession,
    endpoint,
    operation_ids: operationIds,
    operation_count: operationCount,
    operations: rawObservations,
  };
  const artifactPath = join(baseDir, 'web-golden-loop-reference-sync-transport-v1.json');
  const artifact = writeHashedArtifact(artifactPath, artifactPayload);
  return {
    path: artifact.path,
    sha256: `sha256:${artifact.sha256}`,
    bytes: artifact.bytes,
  };
}

async function capturePublicInstall({ page, packageUrl, label, blockers, steps }) {
  const url = `${baseUrl}${INSTALL_PATH}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByText('Install from link', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 12000 })
    .catch(() => undefined);

  const installInput = await findPackageUrlInput(page);
  if (!installInput) {
    blockers.push('missing_public_install_url_input');
    return { version: null, installationId: null, reviewed: false, versionText: null };
  }

  await installInput.fill(packageUrl);
  const installSubmit = await findButtonByText(page, [/Install from link/i]);
  if (!installSubmit) {
    blockers.push('missing_public_install_submit_button:install_from_link');
    return { version: null, installationId: null, reviewed: false, versionText: null };
  }

  await installSubmit.click();
  const reviewButton = await findButtonByText(page, [
    /^Install$/i,
    /^Install app$/i,
    /^Update$/i,
    /^Proceed$/i,
    /^Apply$/i,
    /Confirm/i,
  ]);
  if (!reviewButton) {
    blockers.push('missing_public_install_review_action');
    return { version: null, installationId: null, reviewed: false, versionText: null };
  }

  const nav = page.waitForURL(/\/apps\//, { timeout: 20000 });
  await reviewButton.click();
  try {
    await nav;
  } catch {
    // continue if route stays on install flow
  }

  const finalUrl = page.url();
  await waitForRuntimeBody(page);
  const text = await captureText(page);
  const parsedIdentity = parsePackageIdentityFromText(text);
  const installationId = getInstallationIdFromUrl(finalUrl);
  const version = parseVersionFromText(text) || parsedIdentity?.version || null;

  if (!installationId) {
    blockers.push('missing_public_installation_identity_after_review');
  }
  if (!version) {
    blockers.push(`missing_public_install_version:${label}`);
  }

  steps.push({
    step: `install_${label}`,
    status: installationId && version ? 'passed' : 'failed',
    packageUrl,
    installationId,
    version,
  });

  return {
    version,
    installationId,
    reviewed: true,
    versionText: text,
  };
}

async function captureUpdateAction({ page, packageUrl, blockers, previousVersion, steps }) {
  const url = `${baseUrl}${INSTALL_PATH}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByText('Install from link', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 12000 })
    .catch(() => undefined);

  const installInput = await findPackageUrlInput(page);
  if (!installInput) {
    blockers.push('missing_public_install_url_input');
    return { version: null, installationId: null, reviewed: false, versionText: null };
  }

  await installInput.fill(packageUrl);
  const installSubmit = await findButtonByText(page, [/Install from link/i]);
  if (!installSubmit) {
    blockers.push('missing_public_install_submit_button:install_from_link');
    return { version: null, installationId: null, reviewed: false, versionText: null };
  }

  await installSubmit.click();

  const escaped = previousVersion ? escapeRegExp(previousVersion) : '\\d+\\.\\d+\\.\\d+';
  const reviewButton = await findButtonByText(page, [
    new RegExp(`Update .*from ${escaped}`, 'i'),
    /Update installed app/i,
    /Update app/i,
    /^Update$/i,
  ]);
  if (!reviewButton) {
    blockers.push('missing_public_update_button:installed_app_update_not_present');
    return { version: null, installationId: null, reviewed: false, versionText: null };
  }

  const nav = page.waitForURL(/\/apps\//, { timeout: 20000 });
  await reviewButton.click();
  try {
    await nav;
  } catch {
    // best effort
  }

  await waitForRuntimeBody(page);
  const text = await captureText(page);
  const version = parseVersionFromText(text) || parsePackageIdentityFromText(text)?.version || null;
  const installationId = getInstallationIdFromUrl(page.url()) || null;

  if (!installationId) {
    blockers.push('missing_public_updated_installation_identity_after_review');
  }
  if (!version) {
    blockers.push('missing_public_updated_version_after_review');
  }

  steps.push({
    step: 'update_v1_to_v2',
    status: version ? 'passed' : 'failed',
    packageUrl,
    installationId,
    version,
    previousVersion,
  });

  return {
    version,
    installationId,
    reviewed: true,
    versionText: text,
  };
}

async function captureDataWriteProbe({ page, installationId, marker, blockers, steps, phase }) {
  if (!installationId) {
    blockers.push('missing_public_data_write_scope:missing_installation_id');
    return {
      attempted: false,
      marker,
      before: null,
      after: null,
      hasMarkerAfter: false,
    };
  }

  await page.goto(`${baseUrl}${APP_PATH_PREFIX}${installationId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForRuntimeBody(page);
  const beforeText = await captureText(page);
  const before = {
    text: beforeText,
    checksum: hashText(beforeText),
  };

  const candidateWriteButton = await findButtonByText(page, [
    /^Add /i,
    /Create /i,
    /^New /i,
    /Create record/i,
    /Add record/i,
    /Add task/i,
    /Add expense/i,
    /New task/i,
    /New expense/i,
    /Save/i,
    /Submit/i,
  ]);

  if (!candidateWriteButton) {
    blockers.push(`missing_public_data_write_hook:app-lifecycle:${phase}`);
    return {
      attempted: false,
      marker,
      before,
      after: null,
      hasMarkerAfter: false,
    };
  }

  await candidateWriteButton.click();
  const value = marker || `proof-${Date.now().toString(36)}`;

  const inputCandidates = page.locator('input, textarea').first();
  if (await inputCandidates.count()) {
    await inputCandidates.fill(value);
  }

  const submitButton = await findButtonByText(page, [
    /Save/i,
    /Submit/i,
    /Add/i,
    /Create/i,
    /Done/i,
  ]);
  if (!submitButton) {
    blockers.push('missing_public_data_write_confirm_hook:app-lifecycle');
    return {
      attempted: true,
      marker: value,
      before,
      after: null,
      hasMarkerAfter: false,
    };
  }

  await submitButton.click();
  await page.waitForTimeout(1200);
  const afterText = await captureText(page);
  const after = {
    text: afterText,
    checksum: hashText(afterText),
  };

  const hasMarkerAfter = afterText.includes(value);
  if (!hasMarkerAfter) {
    blockers.push('web_data_write_marker_not_visible');
  }

  steps.push({
    step: `data_write_${phase}`,
    status: hasMarkerAfter ? 'passed' : 'failed',
    marker: value,
    installationId,
  });

  return {
    attempted: true,
    marker: value,
    before,
    after,
    hasMarkerAfter,
  };
}

async function captureMarkerReadback({ page, installationId, marker, blockers, phase }) {
  if (!installationId) {
    blockers.push('missing_public_data_write_scope:missing_installation_id');
    return {
      found: false,
      checksum: null,
      version: null,
      text: '',
    };
  }

  await page.goto(`${baseUrl}${APP_PATH_PREFIX}${installationId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForRuntimeBody(page);
  const text = await captureText(page);
  const checksum = hashText(text);
  const hasMarker = marker ? text.includes(marker) : false;
  if (marker && !hasMarker) {
    blockers.push(`web_data_marker_missing:${phase}`);
  }

  return {
    found: hasMarker,
    checksum,
    version: parseVersionFromText(text) || parsePackageIdentityFromText(text)?.version || null,
    text,
  };
}

async function captureRollbackHook({ page, blockers, steps }) {
  const controlRoomUrl = `${baseUrl}${CONTROL_ROOM_PATH}`;
  try {
    await page.goto(controlRoomUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await waitForRuntimeBody(page);
  } catch {
    blockers.push('missing_public_rollback_hook:package-control-room');
    return {
      ok: false,
      versionAfterRollback: null,
    };
  }

  const text = await captureText(page);
  if (!text.includes('Package control room')) {
    blockers.push('missing_public_rollback_scope:package-control-room_requires_runtime_context');
    return { ok: false, versionAfterRollback: null };
  }

  const rollbackButton = await findButtonByText(page, [/Rollback/i]);
  if (!rollbackButton) {
    blockers.push('missing_public_rollback_hook:package-control-room');
    return { ok: false, versionAfterRollback: null };
  }

  const isDisabled = (await rollbackButton.getAttribute('disabled')) !== null
    || ((await rollbackButton.getAttribute('aria-disabled')) === 'true');
  if (isDisabled) {
    blockers.push('rollback_not_available:package-control-room_previous_version_missing');
    return { ok: false, versionAfterRollback: null };
  }

  await rollbackButton.click();
  await page.waitForTimeout(1500);

  steps.push({
    step: 'rollback_to_v1',
    status: 'passed',
  });

  const versionAfterRollback = parseVersionFromText(await captureText(page)) || null;
  return {
    ok: true,
    versionAfterRollback,
  };
}

function buildReferenceSyncEvidence(referenceSyncState) {
  if (!referenceSyncState) {
    return {
      observed: false,
      convergence: false,
      operationObserved: false,
      rollbackOperationObserved: false,
      reconciledOperationObserved: false,
      sessionObserved: false,
      endpointObserved: false,
      conflictObserved: false,
      convergenceObserved: false,
      conflictDetected: null,
      rollbackReplayed: null,
      convergenceReplayed: null,
      rollbackOperationIds: [],
      reconciledOperationId: null,
      endpoints: [],
      operationIds: [],
      sessionIds: [],
      observations: [],
      latestSessionId: null,
      observationIds: [],
    };
  }

  const observations = [...referenceSyncState.observations].map((entry) => {
    const item = { ...entry };
    delete item.cursor;
    return item;
  });

  return {
    observed: referenceSyncState.observed,
    convergence: referenceSyncState.convergence,
    operationObserved: referenceSyncState.operationObserved,
    rollbackOperationObserved: referenceSyncState.rollbackOperationObserved,
    reconciledOperationObserved: referenceSyncState.reconciledOperationObserved,
    sessionObserved: referenceSyncState.sessionObserved,
    endpointObserved: referenceSyncState.endpointObserved,
    conflictObserved: referenceSyncState.conflictObserved,
    convergenceObserved: referenceSyncState.convergenceObserved,
    conflictDetected: referenceSyncState.conflictDetected,
    rollbackReplayed: referenceSyncState.rollbackReplayed,
    convergenceReplayed: referenceSyncState.convergenceReplayed,
    rollbackOperationIds: [...referenceSyncState.rollbackOperationIds].sort(),
    reconciledOperationId: referenceSyncState.reconciledOperationId ?? null,
    endpoints: [...referenceSyncState.endpoints].sort(),
    operationIds: [...referenceSyncState.operationIds].sort(),
    sessionIds: [...referenceSyncState.sessionIds].sort(),
    observations,
    latestSessionId: [...referenceSyncState.sessionIds].at(-1) ?? null,
    observationIds: [...referenceSyncState.observationIds].sort(),
  };
}

export function buildWebExecutionReceipt({
  blockers,
  steps,
  initial,
  updated,
  installationId,
  artifacts,
  written,
  baseUrl: base,
  packageChecksum,
  referenceSync,
  dataPreservation,
  screenshotArtifacts,
  observationArtifacts = [],
  executionArtifactDir = outDir,
  receiptPath,
  git,
}) {
  const unique = uniqueBlockers((blockers ?? []).filter(Boolean));
  const checked_at = new Date().toISOString();
  const packageVersion = artifacts.version;
  const normalizedPackageChecksum = normalizeChecksum(packageChecksum);
  const dataPreservationSummary = dataPreservation ?? null;
  const referenceSyncSummary = buildReferenceSyncEvidence(referenceSync ?? null);
  const syncGateBlockers = [];
  if (!referenceSyncSummary.sessionObserved) {
    syncGateBlockers.push('missing_public_reference_sync_session_hook:session');
  }
  if (!referenceSyncSummary.endpointObserved) {
    syncGateBlockers.push('missing_public_reference_sync_endpoint_hook:endpoint');
  }
  if (!referenceSyncSummary.operationObserved) {
    syncGateBlockers.push('missing_public_reference_sync_operation_hook:operation');
  }
  if (!referenceSyncSummary.convergenceObserved) {
    syncGateBlockers.push('missing_public_reference_sync_convergence_hook:convergence');
  }
  if (!referenceSyncSummary.rollbackOperationObserved) {
    syncGateBlockers.push('missing_public_reference_sync_rollback_hook:operation');
  }
  if (!referenceSyncSummary.reconciledOperationObserved) {
    syncGateBlockers.push('missing_public_reference_sync_reconciled_hook:operation');
  }
  if (!referenceSyncSummary.conflictObserved) {
    syncGateBlockers.push('missing_public_reference_sync_conflict_hook:conflict');
  }

  const allBlockers = uniqueBlockers([...unique, ...syncGateBlockers]);
  const finalStatus = allBlockers.length === 0 ? 'PASS' : 'BLOCKED';
  const status = finalStatus;
  const lifecycleAssertions = makeLifecycleAssertions(referenceSyncSummary);
  const durableDataChecksum = normalizeChecksum(dataPreservationSummary?.post_rollback?.checksum ?? null);
  const syncSessionId = referenceSyncSummary?.latestSessionId || null;
  const syncEndpoint = `${base}/reference-sync/v1/sync`;
  const baselineTransitions = {
    from: initial.version,
    to: updated.version,
  };
  const syncClaimed = Boolean(referenceSyncSummary?.observed && syncSessionId && (referenceSyncSummary?.operationIds?.length ?? 0) > 0);
  const executionOps = buildExecutionOperationEntries(referenceSyncSummary);
  const normalizedExecutionOperations = executionOps.operations;
  const operationIds = [...new Set(executionOps.operationIds)];
  const rollbackOperationIds = [...new Set(executionOps.rollbackOperationIds)];
  const reconciledOperationId = executionOps.reconciledOperationId ?? null;

  const executionArtifactDirectory = resolve(executionArtifactDir ?? outDir);
  mkdirSync(executionArtifactDirectory, { recursive: true });
  const executionObservationArtifact = writeExecutionObservationsArtifact(
    executionArtifactDirectory,
    normalizedExecutionOperations,
  );
  const transportObservationRef = syncClaimed
    ? writeSyncTransportArtifact(
      executionArtifactDirectory,
      syncSessionId,
      syncEndpoint,
      operationIds,
      operationIds.length,
      referenceSyncSummary?.observations ?? [],
    )
    : null;
  const transportObservation = transportObservationRef
    ? {
      path: transportObservationRef.path,
      sha256: transportObservationRef.sha256,
      bytes: transportObservationRef.bytes,
    }
    : null;

  const generatedObservationArtifacts = [
    {
      type: 'execution_observations',
      ...executionObservationArtifact.artifact,
    },
  ];
  if (transportObservation) {
    generatedObservationArtifacts.push({
      type: 'reference_sync_transport',
      ...transportObservation,
    });
  }

  const executionObservations = [executionObservationArtifact.observation];
  const convergenceAssertionOperationIds = [...new Set([
    ...operationIds,
    ...executionOps.rollbackOperationIds,
    ...(executionOps.reconciledOperationId ? [executionOps.reconciledOperationId] : []),
  ])];
  const transportSession = syncClaimed ? syncSessionId : null;
  const hasConvergenceData = Boolean(referenceSyncSummary?.convergence);
  const transitionTo = normalizeChecksum(updated?.version) ? null : (updated?.version ?? null);
  const transitionFrom = normalizeChecksum(initial?.version) ? null : (initial?.version ?? null);

  return {
    proof: SHELL_PROOF_PROTOCOL_VERSION,
    schema_version: SHELL_PROOF_PROTOCOL_VERSION,
    checked_at,
    scope: 'shared_household_board_install_update_rollback_data_preservation',
    status,
    pass: status === 'PASS',
      blockers: allBlockers,
    source: {
      surface: 'web',
      installation_id: installationId || null,
      route: `${base}${INSTALL_PATH}`,
    },
    package_checksum: normalizedPackageChecksum,
    package: {
      checksum: normalizedPackageChecksum,
      version: transitionTo,
      previous_version: transitionFrom,
      version_transition: {
        from: baselineTransitions.from ?? null,
        to: baselineTransitions.to ?? null,
      },
    },
    package_sources: {
      v1: {
        version: packageVersion.v1,
        packageUrl: artifacts.urls.v1,
        checksum: artifacts.v1.checksum,
      },
      v2: {
        version: packageVersion.v2,
        packageUrl: artifacts.urls.v2,
        checksum: artifacts.v2.checksum,
      },
    },
    installation_id: installationId || null,
    lifecycle: {
      scenario_id: REQUIRED_SCENARIO_ID,
      scenario: {
        scenario_id: REQUIRED_SCENARIO_ID,
        assertions: {
          ...lifecycleAssertions,
        },
      },
      status,
      blockers: allBlockers,
      version_transition: {
        from: baselineTransitions.from ?? null,
        to: baselineTransitions.to ?? null,
      },
      data_preservation: dataPreservationSummary,
      reference_sync: referenceSyncSummary,
      package_checksum: normalizedPackageChecksum,
    },
    version_steps: steps,
    version_transition: {
      from: baselineTransitions.from ?? null,
      to: baselineTransitions.to ?? null,
    },
    package_hash: normalizedPackageChecksum ? normalizedPackageChecksum.replace('sha256:', '') : null,
    data_preservation: dataPreservationSummary,
    reference_sync: referenceSyncSummary,
    execution: {
      sync_claimed: syncClaimed,
      transport: {
        endpoint: syncEndpoint,
        session: transportSession,
        operation_count: operationIds.length,
        observation: transportObservation
          ? {
            path: transportObservation.path,
            sha256: transportObservation.sha256,
            bytes: transportObservation.bytes,
          }
          : null,
      },
      observations: executionObservations,
      durable_data_checksum: durableDataChecksum,
      convergence: {
        operation_ids: convergenceAssertionOperationIds,
        rollback_operation_ids: rollbackOperationIds,
        reconciled_operation_id: reconciledOperationId,
        rollback_replayed: dataPreservationSummary?.preserved === true,
        transport_session: transportSession,
        transport_observation: transportObservation
          ? {
            path: transportObservation.path,
            sha256: transportObservation.sha256,
            bytes: transportObservation.bytes,
          }
          : null,
        assertions: lifecycleAssertions,
      },
    },
    artifacts: summarizeArtifacts(
      artifacts,
      written,
      screenshotArtifacts ?? [],
      [...observationArtifacts, ...generatedObservationArtifacts],
      [],
      receiptPath || outPath,
    ),
    convergence: {
      operation_ids: convergenceAssertionOperationIds,
      rollback_operation_ids: rollbackOperationIds,
      reconciled_operation_id: reconciledOperationId,
      rollback_replayed: dataPreservationSummary?.preserved === true,
      transport_session: transportSession,
      transport_observation: transportObservation
        ? {
          path: transportObservation.path,
          sha256: transportObservation.sha256,
          bytes: transportObservation.bytes,
        }
        : null,
      assertions: lifecycleAssertions,
      observed: hasConvergenceData,
    },
    git: git ?? currentGit(root),
    status_reason: status === 'PASS'
      ? 'shared household board install, write, update, rollback, and reference sync convergence observed through public App Library routes'
      : `blocked:${allBlockers.join('|')}`,
  };
}

export async function runWebGoldenLoopExecution() {
  const artifacts = buildSharedHouseholdBoardWebPackageArtifacts({
    root,
    sourceFixturePath,
  });
  const written = writeSharedHouseholdBoardWebPackageArtifacts(root, packageArtifactsDir, artifacts);

  const packageChecksum = artifacts.v2.checksum;

  const blockers = [];
  const steps = [];
  const dataPreservation = {
    attempted: false,
    marker: null,
    before_update: null,
    after_update: null,
    post_rollback: null,
    preserved: null,
  };

  let installation = {
    version: null,
    installationId: null,
  };
  let updated = {
    version: null,
    installationId: null,
  };

  const referenceSyncState = {
    observed: false,
    convergence: false,
    operationObserved: false,
    rollbackOperationObserved: false,
    reconciledOperationObserved: false,
    sessionObserved: false,
    endpointObserved: false,
    conflictObserved: false,
    convergenceObserved: false,
    conflictDetected: null,
    rollbackReplayed: null,
    convergenceReplayed: null,
    rollbackOperationIds: new Set(),
    reconciledOperationId: null,
    endpoints: new Set(),
    sessionIds: new Set(),
    operationIds: new Set(),
    observations: [],
    observationIds: new Set(),
  };

  const networkResponseWaits = new Set();

  const packageMap = new Map();
  packageMap.set(artifacts.urls.v1, artifacts.v1.package);
  packageMap.set(artifacts.urls.v2, artifacts.v2.package);

  const packageChecksums = {
    v1: artifacts.v1.checksum,
    v2: artifacts.v2.checksum,
  };

  const webServer = await ensureWebBaseUrl({ root, baseUrl });

  const { chromium } = requirePlaywright();
  const browser = await chromium.launch(chromiumLaunchOptions(chromium));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const screenshots = [];
  const requestEvidence = [];

  context.on('request', (request) => {
    if (!isReferenceSyncUrl(request.url())) {
      return;
    }

    const endpoint = (() => {
      try {
        return new URL(request.url()).pathname;
      } catch {
        return request.url();
      }
    })();

    referenceSyncState.observed = true;
    referenceSyncState.endpoints.add(endpoint);

    requestEvidence.push({
      type: 'request',
      timestamp: new Date().toISOString(),
      method: request.method(),
      path: endpoint,
      status: null,
    });
  });

  context.on('response', (response) => {
    if (!isReferenceSyncUrl(response.url())) return;

    const request = response.request();
    const method = request.method();
    const url = response.url();
    let endpoint = url;
    try {
      endpoint = new URL(url).pathname;
    } catch {
      // ignore
    }

      const wait = response.text().then((responseText) => {
      const metadata = extractReferenceSyncMetadataFromResponse(responseText);

      referenceSyncState.observed = true;
      referenceSyncState.sessionObserved = Boolean(
        referenceSyncState.sessionObserved
          || metadata.sessionObserved
      );
      referenceSyncState.endpointObserved = Boolean(
        referenceSyncState.endpointObserved
          || metadata.endpointObserved
      );
      referenceSyncState.convergence = Boolean(
        referenceSyncState.convergence
          || metadata.hasConvergenceObserved
      );
      referenceSyncState.conflictObserved = Boolean(
        referenceSyncState.conflictObserved
          || metadata.hasConflictObserved
      );
      referenceSyncState.convergenceObserved = Boolean(
        referenceSyncState.convergenceObserved
          || metadata.hasConvergenceObserved
      );
      referenceSyncState.operationObserved = Boolean(
        referenceSyncState.operationObserved
          || metadata.hasOperation
      );
      referenceSyncState.rollbackOperationObserved = Boolean(
        referenceSyncState.rollbackOperationObserved
          || metadata.hasRollbackOperation
      );
      referenceSyncState.reconciledOperationObserved = Boolean(
        referenceSyncState.reconciledOperationObserved
          || metadata.hasReconciledOperation
      );
      referenceSyncState.endpoints.add(endpoint);
      if (metadata.sessionId) {
        referenceSyncState.sessionIds.add(metadata.sessionId);
      }
      if (metadata.endpoint) {
        referenceSyncState.endpoints.add(metadata.endpoint);
      }
      for (const operationId of metadata.operationIds) {
        referenceSyncState.operationIds.add(operationId);
      }
      for (const operationId of metadata.rollbackOperationIds) {
        referenceSyncState.rollbackOperationIds.add(operationId);
      }
      if (metadata.reconciledOperationId) {
        referenceSyncState.reconciledOperationId = metadata.reconciledOperationId;
      }
      if (metadata.conflictDetected !== null) {
        referenceSyncState.conflictDetected = metadata.conflictDetected;
      }
      if (metadata.rollbackReplayed !== null) {
        referenceSyncState.rollbackReplayed = metadata.rollbackReplayed;
      }
      if (metadata.convergenceReplayed !== null) {
        referenceSyncState.convergenceReplayed = metadata.convergenceReplayed;
      }

      const observationId = hashText(`${method}|${endpoint}|${response.status()}|${response.ok()}`);
      requestEvidence.push({
        type: 'response',
        timestamp: new Date().toISOString(),
        path: endpoint,
        method,
        status: response.status(),
        ok: response.ok(),
        session_id: metadata.sessionId,
        operation_ids: metadata.operationIds,
        rollback_operation_ids: metadata.rollbackOperationIds,
        reconciled_operation_id: metadata.reconciledOperationId,
        endpoint: metadata.endpoint,
        cursor_hash: metadata.cursorHash,
        conflict_detected: metadata.conflictDetected,
        convergence_replayed: metadata.convergenceReplayed,
        rollback_replayed: metadata.rollbackReplayed,
        body_checksum: hashText(responseText),
        transport_observation_id: observationId,
      });
      referenceSyncState.observations.push({
        path: endpoint,
        observation_id: observationId,
        status: response.status(),
        ok: response.ok(),
        method,
        session_id: metadata.sessionId,
        operation_ids: metadata.operationIds,
        rollback_operation_ids: metadata.rollbackOperationIds,
        reconciled_operation_id: metadata.reconciledOperationId,
        endpoint: metadata.endpoint,
        cursor_hash: metadata.cursorHash,
        conflict_detected: metadata.conflictDetected,
        convergence_replayed: metadata.convergenceReplayed,
        rollback_replayed: metadata.rollbackReplayed,
        state: metadata.status,
        body_checksum: hashText(responseText),
      });
      if (metadata.sessionId || metadata.operationIds.length) {
        referenceSyncState.observationIds.add(observationId);
      }
    }).catch(() => {
      referenceSyncState.observed = true;
      referenceSyncState.endpoints.add(endpoint);

      requestEvidence.push({
        type: 'response',
        timestamp: new Date().toISOString(),
        path: endpoint,
        method,
        status: response.status(),
        ok: response.ok(),
      });
    });

    networkResponseWaits.add(wait);
    wait.finally(() => {
      networkResponseWaits.delete(wait);
    });
  });

  await context.route('**/utoia.thetechcruise.com/p/shared-household-board*.json', async (route, request) => {
    const packageUrl = request.url();
    const packageJson = packageMap.get(packageUrl);
    if (!packageJson) {
      await route.continue();
      return;
    }

    const payload = `${JSON.stringify(packageJson, null, 2)}\n`;
    requestEvidence.push({
      type: 'intercepted_package_response',
      url: packageUrl,
      status: 200,
      checksum: hashText(payload),
      bytes: payload.length,
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: payload,
    });
  });

  try {
    const firstInstall = await capturePublicInstall({
      page,
      packageUrl: artifacts.urls.v1,
      label: 'v1',
      blockers,
      steps,
    });

    installation = {
      version: firstInstall.version,
      installationId: firstInstall.installationId,
    };

    if (!installation.installationId) {
      blockers.push('missing_public_installation_identity_after_v1');
    }
    if (!installation.version) {
      blockers.push('web_install_v1_version_missing');
    }

    const initialDataWrite = await captureDataWriteProbe({
      page,
      installationId: installation.installationId,
      blockers,
      steps,
      phase: 'v1_before_update',
    });

    if (!initialDataWrite.attempted) {
      blockers.push('web_data_write_not_executed');
    }

    dataPreservation.attempted = initialDataWrite.attempted;
    dataPreservation.marker = initialDataWrite.marker;
    dataPreservation.before_update = initialDataWrite.before
      ? {
          checksum: initialDataWrite.before.checksum,
          found: null,
        }
      : null;

    const writeResultReadback = await captureMarkerReadback({
      page,
      installationId: installation.installationId,
      marker: dataPreservation.marker,
      blockers,
      phase: 'post_write_before_update',
    });
    dataPreservation.before_update = {
      ...(dataPreservation.before_update ?? {}),
      checksum: writeResultReadback.checksum,
      found: writeResultReadback.found,
      version: writeResultReadback.version,
    };

    if (!writeResultReadback.found) {
      blockers.push('web_data_marker_not_preserved_before_update');
    }

    if (installation.installationId || installation.version) {
      const secondInstall = await captureUpdateAction({
        page,
        packageUrl: artifacts.urls.v2,
        blockers,
        previousVersion: installation.version,
        steps,
      });

      updated = {
        version: secondInstall.version,
        installationId: secondInstall.installationId ?? installation.installationId,
      };

      if (!updated.version) {
        blockers.push('web_update_v2_version_missing');
      }
      if (updated.version && installation.version && updated.version === installation.version) {
        blockers.push('web_update_no_version_progression');
      }
      if (installation.installationId && updated.installationId
        && updated.installationId !== installation.installationId) {
        blockers.push('web_update_changed_installation_identity');
      }

      const postUpdateReadback = await captureMarkerReadback({
        page,
        installationId: updated.installationId || installation.installationId,
        marker: dataPreservation.marker,
        blockers,
        phase: 'post_update',
      });

      dataPreservation.after_update = {
        checksum: postUpdateReadback.checksum,
        found: postUpdateReadback.found,
        version: postUpdateReadback.version,
      };

      if (!postUpdateReadback.found) {
        blockers.push('web_data_marker_not_preserved_after_update');
      }
      if (dataPreservation.marker && postUpdateReadback.text) {
        steps.push({
          step: 'verify_marker_after_update',
          status: postUpdateReadback.found ? 'passed' : 'failed',
          marker: dataPreservation.marker,
          installationId: updated.installationId || installation.installationId,
        });
      }
    }

    const rollbackResult = await captureRollbackHook({
      page,
      blockers,
      steps,
    });

    if (!rollbackResult.ok) {
      blockers.push('web_rollback_failed');
    }

    const postRollbackReadback = await captureMarkerReadback({
      page,
      installationId: installation.installationId,
      marker: dataPreservation.marker,
      blockers,
      phase: 'post_rollback',
    });

    dataPreservation.post_rollback = {
      checksum: postRollbackReadback.checksum,
      found: postRollbackReadback.found,
      version: postRollbackReadback.version,
    };
    dataPreservation.preserved = Boolean(
      dataPreservation.before_update?.found !== false
      && dataPreservation.after_update?.found !== false
      && postRollbackReadback.found,
    );

    if (installation.version && dataPreservation.post_rollback.version
      && dataPreservation.post_rollback.version !== installation.version) {
      blockers.push(`web_rollback_version_unexpected:${dataPreservation.post_rollback.version}`);
    }
    if (!dataPreservation.preserved) {
      blockers.push('data_not_preserved_after_rollback');
    }

    if (!updated.version || updated.version === installation.version) {
      blockers.push('web_update_missing_version_progression');
    }

    if (!referenceSyncState.sessionObserved) {
      blockers.push('missing_public_reference_sync_session_hook:session');
    }
    if (!referenceSyncState.endpointObserved) {
      blockers.push('missing_public_reference_sync_endpoint_hook:endpoint');
    }
    if (!referenceSyncState.operationObserved) {
      blockers.push('missing_public_reference_sync_operation_hook:operation');
    }
    if (!referenceSyncState.convergenceObserved) {
      blockers.push('missing_public_reference_sync_convergence_hook:convergence');
    }
    if (!referenceSyncState.rollbackOperationObserved) {
      blockers.push('missing_public_reference_sync_rollback_hook:operation');
    }
    if (!referenceSyncState.reconciledOperationObserved) {
      blockers.push('missing_public_reference_sync_reconciled_hook:operation');
    }
    if (!referenceSyncState.conflictObserved) {
      blockers.push('missing_public_reference_sync_conflict_hook:conflict');
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await webServer.close();
    await Promise.all([...networkResponseWaits]);
  }

  if (!normalizeChecksum(packageChecksum)) {
    blockers.push('invalid_package_checksum:web_execution_receipt');
  }

  if (packageChecksums.v1 === packageChecksums.v2) {
    blockers.push('package_checksum_regression:v1_v2_identical');
  }

  const referenceSync = buildReferenceSyncEvidence(referenceSyncState);
  const referenceSyncArtifacts = writeHashedArtifact(
    join(outDir, 'web-golden-loop-reference-sync-observations-v1.json'),
    {
      observed: referenceSync,
      observations: referenceSync.observations,
      request_events: requestEvidence,
    },
  );

  const receipt = buildWebExecutionReceipt({
    blockers,
    steps,
    initial: installation,
    updated,
    installationId: installation.installationId,
    artifacts,
    written,
    baseUrl,
    packageChecksum: normalizeChecksum(packageChecksum),
    referenceSync,
    dataPreservation,
    screenshotArtifacts: screenshots,
    observationArtifacts: [referenceSyncArtifacts],
    receiptPath: outPath,
    executionArtifactDir: outDir,
    git: currentGit(root),
  });

  mkdirSync(outDir, { recursive: true });
  mkdirSync(packageArtifactsDir, { recursive: true });

  const finalReceipt = {
    ...receipt,
    artifacts: {
      ...receipt.artifacts,
      screenshots,
      reference_sync_observations: [referenceSyncArtifacts],
    },
  };

  const validation = validateShellProofReceipt(finalReceipt, {
    root,
    label: 'web',
    path: outPath,
    requiredSourceSurface: 'web',
  });
  if (!validation.pass) {
    finalReceipt.blockers.push(
      ...validation.blockers.map((blocker) => `shell_proof_validation:${blocker}`),
    );
  }
  finalReceipt.status = finalReceipt.blockers.length === 0 ? 'PASS' : 'BLOCKED';
  finalReceipt.pass = finalReceipt.status === 'PASS';
  finalReceipt.status_reason = finalReceipt.status === 'PASS'
    ? finalReceipt.status_reason
    : `blocked:${finalReceipt.blockers.join('|')}`;
  finalReceipt.schema_validation = {
    pass: validation.pass,
    blockers: validation.blockers,
    hash: validation.hash,
  };

  writeFileSync(outPath, `${JSON.stringify(finalReceipt, null, 2)}\n`);

  if (finalReceipt.status !== 'PASS') {
    console.error(`BLOCKED: ${finalReceipt.status_reason}`);
    process.exitCode = 1;
    return finalReceipt;
  }

  console.log(`PASS ${outPath}`);
  return finalReceipt;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebGoldenLoopExecution().catch((error) => {
    console.error(`web-execution-receipt failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
