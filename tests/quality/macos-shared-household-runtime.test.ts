import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';

const tempRoots: string[] = [];
const scriptPath = join(process.cwd(), 'scripts/quality/macos/check-shared-household-runtime.mjs');
const targetPackageId = 'shared-household-board';
const operationId = 'shared-household-board-op-1';
type ProofStatus = 'PASS' | 'BLOCKED';
type ProofEvidence = {
  status: ProofStatus;
  blockers: string[];
  blockers_note: string | null;
  next_action: string | null;
  bridge: {
    configured: boolean;
    command: string | null;
    receipt_path: string;
    raw_observation_path: string;
    invoked: boolean;
    exit_code: number | null;
    output_bytes: number;
  };
  shell_proof: {
    observations_path_exists: boolean;
    observations_hash: string | null;
    validator: {
      pass: boolean | null;
      blockers: string[];
      status: string | null;
      issues: unknown[];
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseProofEvidence(raw: string): ProofEvidence {
  const data = JSON.parse(raw) as unknown;
  if (!isRecord(data)) {
    throw new Error('Invalid proof file payload');
  }

  if (data.status !== 'PASS' && data.status !== 'BLOCKED') {
    throw new Error('Unexpected proof status');
  }

  const bridge = isRecord(data.bridge) ? data.bridge : {};
  const shellProof = isRecord(data.shell_proof) ? data.shell_proof : {};
  const validator = isRecord(shellProof.validator) ? shellProof.validator : {};

  return {
    status: data.status,
    blockers: parseStringArray(data.blockers),
    blockers_note: typeof data.blockers_note === 'string' ? data.blockers_note : null,
    next_action: typeof data.next_action === 'string' ? data.next_action : null,
    bridge: {
      configured: typeof bridge.configured === 'boolean' ? bridge.configured : false,
      command: typeof bridge.command === 'string' ? bridge.command : null,
      receipt_path: typeof bridge.receipt_path === 'string' ? bridge.receipt_path : '',
      raw_observation_path: typeof bridge.raw_observation_path === 'string' ? bridge.raw_observation_path : '',
      invoked: typeof bridge.invoked === 'boolean' ? bridge.invoked : false,
      exit_code: typeof bridge.exit_code === 'number' ? bridge.exit_code : null,
      output_bytes: typeof bridge.output_bytes === 'number' ? bridge.output_bytes : 0,
    },
    shell_proof: {
      observations_path_exists: typeof shellProof.observations_path_exists === 'boolean'
        ? shellProof.observations_path_exists
        : false,
      observations_hash: typeof shellProof.observations_hash === 'string'
        ? shellProof.observations_hash
        : null,
      validator: {
        pass: typeof validator.pass === 'boolean' ? validator.pass : null,
        blockers: parseStringArray(validator.blockers),
        status: typeof validator.status === 'string' ? validator.status : null,
        issues: Array.isArray(validator.issues) ? validator.issues : [],
      },
    },
  };
}

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-macos-shared-household-runtime-'));
  tempRoots.push(root);
  return root;
}

function writeScript(root: string, name: string, body: string) {
  const path = join(root, name);
  const source = [
    '#!/usr/bin/env node',
    body,
    '',
  ].join('\n');
  writeFileSync(path, source, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

function writeAppBundle(root: string, appName = 'UtopiaMac.app') {
  const appPath = join(root, appName);
  const infoPlistPath = join(appPath, 'Contents', 'Info.plist');
  const executablePath = join(appPath, 'Contents', 'MacOS', 'UtopiaMac');
  mkdirSync(join(appPath, 'Contents', 'MacOS'), {recursive: true});
  writeFileSync(infoPlistPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleExecutable</key>',
    '  <string>UtopiaMac</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(executablePath, 'binary placeholder', 'utf8');
  return appPath;
}

function hashDirectoryForTest(basePath: string) {
  const digest = createHash('sha256');
  const queue = [basePath];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let stat;
    try {
      stat = statSync(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const children = readdirSync(current, {withFileTypes: true})
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
      for (const child of children) queue.push(resolve(current, child));
      continue;
    }

    if (!stat.isFile()) continue;
    digest.update(relative(process.cwd(), current));
    digest.update(readFileSync(current));
  }

  return digest.digest('hex');
}

function buildCanonicalBridgeReceipt(options: {
  sourceSurface?: string;
  appArtifactChecksum?: string;
  rawObservationText: string;
  rawObservationChecksum?: string;
  badReceiptChecksum?: boolean;
}) {
  const sourceSurface = options.sourceSurface || 'macos';
  const observationText = options.rawObservationText;
  const observationSha = options.badReceiptChecksum
    ? '0'.repeat(64)
    : options.rawObservationChecksum
      || createHash('sha256').update(observationText).digest('hex');
  const now = new Date().toISOString();

  return {
    proof: 'utopia.shell-proof-protocol.v1',
    schema_version: 'utopia.shell-proof-protocol.v1',
    checked_at: now,
    status: 'PASS',
    git: currentGit(process.cwd()),
    package: {
      checksum: `sha256:${'a'.repeat(64)}`,
      version: '2.0.0',
      version_transition: {
        from: '1.0.0',
        to: '2.0.0',
      },
    },
    installation_id: `${targetPackageId}-installation`,
    source: {
      surface: sourceSurface,
      installation_id: `${targetPackageId}-installation`,
      app_artifact_checksum: options.appArtifactChecksum,
    },
    execution: {
      installation_id: `${targetPackageId}-installation`,
      durable_data_checksum: `sha256:${'d'.repeat(64)}`,
      observations: [{
        observer_kind: 'runtime',
        command: 'utopia-macos-runtime-bridge',
        driver: 'shared-household-board-runtime-bridge',
        source_timestamp: now,
        artifact: {
          path: '',
          sha256: `sha256:${observationSha}`,
          bytes: Buffer.byteLength(observationText, 'utf8'),
        },
      }],
    },
    lifecycle: {
      scenario: {
        scenario_id: 'convergence-conflict-rollback-v1',
        assertions: {
          convergence_replayed: true,
          rollback_replayed_for_losers: 1,
        },
      },
    },
    convergence: {
      operation_ids: [operationId],
      rollback_operation_ids: [],
      rollback_replayed: false,
    },
  };
}

function writeBridge(
  root: string,
  options: {
    sourceSurface?: string;
    appArtifactChecksum?: string;
    badReceiptChecksum?: boolean;
    rawObservation?: unknown;
  },
) {
  const receiptPath = join(root, 'bridge-receipt.json');
  const rawPath = join(root, 'bridge-observations.json');
  const rawObservationText = JSON.stringify(options.rawObservation ?? {
    operations: [{
      op_id: operationId,
      type: 'install',
      status: 'executed',
      timestamp: new Date().toISOString(),
    }],
  });
  const receipt = buildCanonicalBridgeReceipt({
    sourceSurface: options.sourceSurface,
    appArtifactChecksum: options.appArtifactChecksum,
    rawObservationText,
    badReceiptChecksum: options.badReceiptChecksum,
  });

  const body = [
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "const checksumArg = args.findIndex((item, index) => item === '--app-artifact-checksum' && typeof args[index + 1] === 'string');",
    "const appArtifactChecksum = checksumArg >= 0 ? args[checksumArg + 1] : null;",
    "const receiptArg = args.findIndex((item, index) => item === '--receipt-path' && typeof args[index + 1] === 'string');",
    "const rawArg = args.findIndex((item, index) => item === '--raw-observations-path' && typeof args[index + 1] === 'string');",
    "const receiptPath = receiptArg >= 0 ? args[receiptArg + 1] : process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_RECEIPT_PATH;",
    "const rawPath = rawArg >= 0 ? args[rawArg + 1] : process.env.UTOPIA_MACOS_RUNTIME_BRIDGE_RAW_OBSERVATION_PATH;",
    "if (!receiptPath || !rawPath) process.exit(1);",
    `const receipt = ${JSON.stringify(receipt)};`,
    "if (!receipt?.source) receipt.source = {};",
    "if (!receipt?.source?.app_artifact_checksum && typeof appArtifactChecksum === 'string') {",
    "  receipt.source.app_artifact_checksum = appArtifactChecksum;",
    "}",
    "if (Array.isArray(receipt?.execution?.observations) && receipt.execution.observations[0]?.artifact) {",
    "  receipt.execution.observations[0].artifact.path = rawPath;",
    "}",
    `writeFileSync(receiptPath, JSON.stringify(receipt), 'utf8');`,
    `writeFileSync(rawPath, ${JSON.stringify(rawObservationText)}, 'utf8');`,
    'process.exit(0);',
    '',
  ].join('\n');

  return writeScript(root, 'bridge.js', body);
}

function runProof(root: string, env: Record<string, string> = {}) {
  const proofPath = join(root, 'macos-shared-household-runtime-receipt.json');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      UTOPIA_MACOS_PLATFORM_OVERRIDE: 'darwin',
      UTOPIA_MACOS_SHARED_HOUSEHOLD_RUNTIME_PROOF_PATH: proofPath,
      UTOPIA_MACOS_GOLDEN_LOOP: '1',
      ...env,
    },
  });
  return {
    result,
    proofPath,
    evidence: parseProofEvidence(readFileSync(proofPath, 'utf8')),
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, {recursive: true, force: true});
  }
});

describe('shared-household-board macOS runtime proof script', () => {
  it('BLOCKS when golden-loop opt-in is missing', () => {
    const root = createTempRoot();
    writeAppBundle(root);
    const env = {
      UTOPIA_MACOS_GOLDEN_LOOP: '0',
      UTOPIA_MACOS_APP_PATH: join(root, 'UtopiaMac.app'),
    };

    const {result, evidence} = runProof(root, env);

    expect(result.status).toBe(1);
    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.blockers).toContain('missing_macos_golden_loop_opt_in');
    expect(evidence.next_action).toContain('Set UTOPIA_MACOS_GOLDEN_LOOP=1');
    expect(evidence.blockers.length).toBeGreaterThan(0);
    expect(evidence.blockers_note).toBeTypeOf('string');
  });

  it('BLOCKS when macOS app path is missing', () => {
    const root = createTempRoot();
    const env = {
      UTOPIA_MACOS_APP_PATH: join(root, 'Missing.app'),
    };

    const {result, evidence} = runProof(root, env);

    expect(result.status).toBe(1);
    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.blockers.some((entry) => entry.startsWith('app_path_missing:'))).toBe(true);
  });

  it('BLOCKS when automation bridge is missing', () => {
    const root = createTempRoot();
    const appPath = writeAppBundle(root);
    const {result, evidence} = runProof(root, {
      UTOPIA_MACOS_APP_PATH: appPath,
    });

    expect(result.status).toBe(1);
    expect(evidence.status).toBe('BLOCKED');
    expect(evidence.bridge.configured).toBe(false);
    expect(evidence.bridge.invoked).toBe(false);
    expect(evidence.blockers).toContain('missing_runtime_automation_bridge');
  });

  it('ACCEPTS protocol receipt when source surface and observation hash validate', () => {
    const root = createTempRoot();
    const appPath = writeAppBundle(root);
    const bridge = writeBridge(root, {
      appArtifactChecksum: `sha256:${hashDirectoryForTest(appPath)}`,
      rawObservation: {
        operations: [{
          op_id: operationId,
          type: 'insert',
          status: 'executed',
          timestamp: new Date().toISOString(),
        }],
      },
    });
    const {result, evidence} = runProof(root, {
      UTOPIA_MACOS_APP_PATH: appPath,
      UTOPIA_MACOS_RUNTIME_BRIDGE: bridge,
    });

    expect(result.status).toBe(0);
    expect(evidence.status).toBe('PASS');
    expect(evidence.blockers).toHaveLength(0);
    expect(evidence.shell_proof.observations_path_exists).toBe(true);
    expect(evidence.shell_proof.observations_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.shell_proof.validator.pass).toBe(true);
  });

  it('REJECTS wrong source surface from shell receipt', () => {
    const root = createTempRoot();
    const appPath = writeAppBundle(root);
    const bridge = writeBridge(root, {
      sourceSurface: 'android',
      appArtifactChecksum: `sha256:${hashDirectoryForTest(appPath)}`,
      rawObservation: {
        operations: [{
          op_id: operationId,
          type: 'insert',
          status: 'executed',
          timestamp: new Date().toISOString(),
        }],
      },
    });
    const {result, evidence} = runProof(root, {
      UTOPIA_MACOS_APP_PATH: appPath,
      UTOPIA_MACOS_RUNTIME_BRIDGE: bridge,
    });

    expect(result.status).toBe(1);
    expect(evidence.status).toBe('BLOCKED');
    expect(
      evidence.blockers.some((entry) => entry.startsWith('shell_proof_validator_blocker:source_surface_mismatch:')),
    ).toBe(true);
  });

  it('REJECTS mismatched raw observation hash from shell receipt', () => {
    const root = createTempRoot();
    const appPath = writeAppBundle(root);
    const bridge = writeBridge(root, {
      badReceiptChecksum: true,
      appArtifactChecksum: `sha256:${hashDirectoryForTest(appPath)}`,
      rawObservation: {
        operations: [{
          op_id: operationId,
          type: 'insert',
          status: 'executed',
          timestamp: new Date().toISOString(),
        }],
      },
    });
    const {result, evidence} = runProof(root, {
      UTOPIA_MACOS_APP_PATH: appPath,
      UTOPIA_MACOS_RUNTIME_BRIDGE: bridge,
    });

    expect(result.status).toBe(1);
    expect(evidence.status).toBe('BLOCKED');
    expect(
      evidence.blockers.some((entry) => entry.includes('artifact_stale:sha256')),
    ).toBe(true);
  });

  it('REJECTS app artifact checksum mismatch from bridge receipt source', () => {
    const root = createTempRoot();
    const appPath = writeAppBundle(root);
    const bridge = writeBridge(root, {
      appArtifactChecksum: `sha256:${'f'.repeat(64)}`,
      rawObservation: {
        operations: [{
          op_id: operationId,
          type: 'insert',
          status: 'executed',
          timestamp: new Date().toISOString(),
        }],
      },
    });
    const {result, evidence} = runProof(root, {
      UTOPIA_MACOS_APP_PATH: appPath,
      UTOPIA_MACOS_RUNTIME_BRIDGE: bridge,
    });

    expect(result.status).toBe(1);
    expect(evidence.status).toBe('BLOCKED');
    expect(
      evidence.blockers.some((entry) => entry.startsWith('app_artifact_checksum_mismatch:')),
    ).toBe(true);
  });
});
