import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { currentGit } from '../../scripts/quality/evidence-provenance.mjs';
import { SHELL_PROOF_SCHEMA_VERSION } from '../../scripts/quality/golden-loop/shell-proof-protocol.mjs';

const scriptPath = join(process.cwd(), 'scripts/quality/golden-loop/check-multi-surface-receipts.mjs');
const SOURCE_TIMESTAMP = new Date().toISOString();
const CONVERGENCE_OPERATION_IDS = [
  'sync-op-alpha',
  'sync-op-beta',
  'sync-op-gamma',
  'rb-sync-op-beta',
];
const PROOF_VERSION = {
  from: '1.0.0',
  to: '1.1.0',
};

type TempRoot = string;
const tempRoots: TempRoot[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-multi-surface-receipts-'));
  tempRoots.push(root);
  return root;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedGitEnvelope() {
  const git = currentGit(process.cwd());
  return {
    ...git,
    branch: git.branch || 'detached-head',
    tree_hash: git.tree,
    dirty_diff_hash: git.dirtyDiffHash,
  };
}

type ArtifactDescriptor = {
  path: string;
  sha256: string;
  bytes: number;
};
type Surface = 'android' | 'web' | 'macos';
type StrictReceipt = Record<string, unknown>;

function writeJsonArtifact(root: string, filename: string, body: unknown) {
  const text = JSON.stringify(body, null, 2);
  const path = join(root, filename);
  writeFileSync(path, text, 'utf8');
  return {
    path,
    sha256: `sha256:${sha256Hex(text)}`,
    bytes: text.length,
  } as ArtifactDescriptor;
}

function makeLifecycleScenario() {
  return {
    scenario: {
      scenario_id: 'convergence-conflict-rollback-v1',
      assertions: {
        conflict_detected: true,
        conflict_resolved_by_deterministic_winner: ['android-emulator-5554'],
        rollback_replayed_for_losers: 1,
        convergence_replayed: true,
      },
    },
    lifecycle_actions: ['install', 'activate', 'rollback'],
    installed: true,
    activated: true,
    rolled_back: true,
  };
}

function makeObservedOperationsArtifact(root: string, surface: string, operations: string[]) {
  return writeJsonArtifact(root, `${surface}-operations-${sha256Hex(operations.join(','))}.json`, {
    source_timestamp: SOURCE_TIMESTAMP,
    operations: operations.map((opId) => ({
      op_id: opId,
      type: 'write',
      status: 'applied',
      timestamp: SOURCE_TIMESTAMP,
    })),
  });
}

function makeConvergenceArtifact(root: string, surface: string, operations: string[]) {
  return writeJsonArtifact(root, `${surface}-convergence-${sha256Hex(operations.join(','))}.json`, {
    session: 'sync-session-v1',
    endpoint: '/sync',
    operation_ids: operations,
  });
}

function makeStrictReceipt({
  surface,
  installationId,
  observationArtifact,
  convergenceArtifact,
  packageChecksum,
  lifecycle = makeLifecycleScenario(),
  syntheticPlanIsNotDeviceProof = false,
}: {
  surface: Surface;
  installationId: string;
  observationArtifact: ArtifactDescriptor;
  convergenceArtifact: ArtifactDescriptor;
  packageChecksum: string;
  lifecycle?: ReturnType<typeof makeLifecycleScenario>;
  syntheticPlanIsNotDeviceProof?: boolean;
}) {
  const proofBySurface = {
    android: 'utopia_multi_surface_android_execution_receipt',
    web: 'utopia_multi_surface_web_execution_receipt',
    macos: 'utopia_multi_surface_macos_execution_receipt',
  };

  return {
    proof: proofBySurface[surface],
    run_id: 'golden-loop-test-run-v1',
    schema_version: SHELL_PROOF_SCHEMA_VERSION,
    checked_at: SOURCE_TIMESTAMP,
    status: 'passed',
    git: normalizedGitEnvelope(),
    source: {
      surface,
      installation_id: installationId,
    },
    package: {
      checksum: packageChecksum,
      version: PROOF_VERSION.to,
      previous_version: PROOF_VERSION.from,
      version_transition: {
        from: PROOF_VERSION.from,
        to: PROOF_VERSION.to,
      },
    },
    execution: {
      installation_id: installationId,
      durable_data_checksum: `sha256:${'d'.repeat(64)}`,
      sync_claimed: true,
      transport: {
        endpoint: '/sync',
        session: 'sync-session-v1',
        operation_count: CONVERGENCE_OPERATION_IDS.length,
      },
      observations: [
        {
          observer_kind: 'shell-driver',
          command: 'bun run shell-sync',
          driver: surface,
          source_timestamp: SOURCE_TIMESTAMP,
          artifact: observationArtifact,
        },
      ],
    },
    convergence: {
      operation_ids: CONVERGENCE_OPERATION_IDS,
      rollback_operation_ids: ['rb-sync-op-beta'],
      reconciled_operation_id: 'sync-op-gamma',
      rollback_replayed: true,
      transport_session: 'sync-session-v1',
      transport_observation: {
        path: convergenceArtifact.path,
        sha256: convergenceArtifact.sha256,
        bytes: convergenceArtifact.bytes,
      },
    },
    lifecycle: {
      scenario: lifecycle.scenario,
    },
    ...(syntheticPlanIsNotDeviceProof ? { synthetic_plan_is_not_device_proof: true } : {}),
  } as StrictReceipt;
}

function writeReceipt(path: string, receipt: Record<string, unknown>) {
  writeFileSync(path, JSON.stringify({
    checked_at: new Date().toISOString(),
    git: normalizedGitEnvelope(),
    ...receipt,
  }));
}

function runScript(overrides: {
  androidReceipts: string;
  webReceipt: string;
  macosReceipt: string;
  proofPath: string;
}) {
  const env = {
    ...process.env,
    UTOPIA_MULTI_SURFACE_ANDROID_RECEIPTS: overrides.androidReceipts,
    UTOPIA_MULTI_SURFACE_WEB_RECEIPT_PATH: overrides.webReceipt,
    UTOPIA_MULTI_SURFACE_MACOS_RECEIPT_PATH: overrides.macosReceipt,
    UTOPIA_MULTI_SURFACE_RECEIPTS_OUT_PATH: overrides.proofPath,
    UTOPIA_EMULATOR_SYNC_AVD_IDS: 'emulator-5554,emulator-5556',
  };

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });

  const evidence = JSON.parse(readFileSync(overrides.proofPath, 'utf8')) as {
    proof: string;
    status: 'PASS' | 'BLOCKED';
    blockers: string[];
    status_reason: string;
    package_checksum: string | null;
    surfaces: {
      android: {
        required_ids: string[];
        received: Array<{
          avd_id: string;
          checksum: string;
          source_surface: string;
          transport: {
            session: string;
            endpoint: string;
            operation_count: number | null;
          };
          operation_ids: string[];
          convergence: {
            operation_ids: string[];
            rollback_operation_ids: string[];
          };
          installation_id: string;
        }>;
      };
      web: {
        checksum: string;
        source_surface: string;
        transport: {
          session: string;
          endpoint: string;
          operation_count: number | null;
        };
        operation_ids: string[];
        convergence: {
          operation_ids: string[];
          rollback_operation_ids: string[];
        };
        installation_id: string;
      };
      macos: {
        checksum: string;
        source_surface: string;
        transport: {
          session: string;
          endpoint: string;
          operation_count: number | null;
        };
        operation_ids: string[];
        convergence: {
          operation_ids: string[];
          rollback_operation_ids: string[];
        };
        installation_id: string;
      };
    };
  };

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    evidence,
  };
}

describe('golden loop multi-surface receipt validation', () => {
  it('passes when strict shell-proof v1 receipts align on package checksum, lifecycle assertions, operation ids, transport, and convergence', {
    timeout: 15_000,
  }, () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-receipts.json');
    const androidA = join(temp, 'android-a.json');
    const androidB = join(temp, 'android-b.json');
    const web = join(temp, 'web.json');
    const macos = join(temp, 'macos.json');
    const checksum = `sha256:${'a'.repeat(64)}`;
    const scenario = makeLifecycleScenario();
    const androidAOperations = makeObservedOperationsArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBOperations = makeObservedOperationsArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webOperations = makeObservedOperationsArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosOperations = makeObservedOperationsArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);
    const androidAConvergence = makeConvergenceArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBConvergence = makeConvergenceArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webConvergence = makeConvergenceArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosConvergence = makeConvergenceArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);

    writeReceipt(androidA, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-a',
      observationArtifact: androidAOperations,
      convergenceArtifact: androidAConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(androidB, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-b',
      observationArtifact: androidBOperations,
      convergenceArtifact: androidBConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(web, makeStrictReceipt({
      surface: 'web',
      installationId: 'web-install',
      observationArtifact: webOperations,
      convergenceArtifact: webConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(macos, makeStrictReceipt({
      surface: 'macos',
      installationId: 'macos-install',
      observationArtifact: macosOperations,
      convergenceArtifact: macosConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));

    const result = runScript({
      androidReceipts: `emulator-5554=${androidA},emulator-5556=${androidB}`,
      webReceipt: web,
      macosReceipt: macos,
      proofPath,
    });
    expect(result.status).toBe(0);
    expect(result.evidence.status).toBe('PASS');
    expect(result.evidence.blockers).toEqual([]);
    expect(result.evidence.package_checksum).toBe(checksum);
    expect(result.evidence.surfaces.android.received).toHaveLength(2);
    expect(result.evidence.surfaces.android.received[0]?.avd_id).toBe('emulator-5554');
    expect(result.evidence.surfaces.android.received[1]?.avd_id).toBe('emulator-5556');
    expect(result.evidence.surfaces.android.received[0]?.operation_ids).toEqual(CONVERGENCE_OPERATION_IDS);
    expect(result.evidence.surfaces.android.received[1]?.operation_ids).toEqual(CONVERGENCE_OPERATION_IDS);
    expect(result.evidence.surfaces.web.convergence?.operation_ids).toHaveLength(CONVERGENCE_OPERATION_IDS.length);
    expect(result.evidence.surfaces.macos.convergence?.operation_ids).toHaveLength(CONVERGENCE_OPERATION_IDS.length);
    expect(new Set([
      result.evidence.surfaces.android.received[0]?.transport?.session,
      result.evidence.surfaces.android.received[1]?.transport?.session,
      result.evidence.surfaces.web.transport?.session,
      result.evidence.surfaces.macos.transport?.session,
    ]).size).toBe(1);
    expect(new Set([
      result.evidence.surfaces.android.received[0]?.transport?.endpoint,
      result.evidence.surfaces.android.received[1]?.transport?.endpoint,
      result.evidence.surfaces.web.transport?.endpoint,
      result.evidence.surfaces.macos.transport?.endpoint,
    ]).size).toBe(1);
    expect(result.evidence.surfaces.web.operation_ids).toEqual(CONVERGENCE_OPERATION_IDS);
    expect(result.evidence.surfaces.macos.operation_ids).toEqual(CONVERGENCE_OPERATION_IDS);
    expect(result.evidence.surfaces.android.received[0]?.installation_id).toBe('android-install-a');
    expect(result.evidence.surfaces.android.received[1]?.installation_id).toBe('android-install-b');
  });

  it('blocks synthetic execution receipts', { timeout: 15_000 }, () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-receipts.json');
    const androidA = join(temp, 'android-a.json');
    const androidB = join(temp, 'android-b.json');
    const web = join(temp, 'web.json');
    const macos = join(temp, 'macos.json');
    const checksum = 'sha256:' + 'b'.repeat(64);
    const scenario = makeLifecycleScenario();
    const androidAOperations = makeObservedOperationsArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBOperations = makeObservedOperationsArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webOperations = makeObservedOperationsArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosOperations = makeObservedOperationsArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);
    const androidAConvergence = makeConvergenceArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBConvergence = makeConvergenceArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webConvergence = makeConvergenceArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosConvergence = makeConvergenceArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);

    const androidAReceipt = makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-a',
      observationArtifact: androidAOperations,
      convergenceArtifact: androidAConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
      syntheticPlanIsNotDeviceProof: true,
    });

    writeReceipt(androidA, androidAReceipt);
    writeReceipt(androidB, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-b',
      observationArtifact: androidBOperations,
      convergenceArtifact: androidBConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(web, makeStrictReceipt({
      surface: 'web',
      installationId: 'web-install',
      observationArtifact: webOperations,
      convergenceArtifact: webConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(macos, makeStrictReceipt({
      surface: 'macos',
      installationId: 'macos-install',
      observationArtifact: macosOperations,
      convergenceArtifact: macosConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));

    const result = runScript({
      androidReceipts: `emulator-5554=${androidA},emulator-5556=${androidB}`,
      webReceipt: web,
      macosReceipt: macos,
      proofPath,
    });

    expect(result.status).toBe(1);
    expect(result.evidence.status).toBe('BLOCKED');
    expect(result.evidence.blockers).toContain('synthetic_receipt:android_emulator-5554');
    expect(result.evidence.status_reason).toContain('blocked:');
  });

  it('blocks when package checksums diverge across surfaces', { timeout: 15_000 }, () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-receipts.json');
    const androidA = join(temp, 'android-a.json');
    const androidB = join(temp, 'android-b.json');
    const web = join(temp, 'web.json');
    const macos = join(temp, 'macos.json');
    const scenario = makeLifecycleScenario();
    const androidAOperations = makeObservedOperationsArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBOperations = makeObservedOperationsArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webOperations = makeObservedOperationsArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosOperations = makeObservedOperationsArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);
    const androidAConvergence = makeConvergenceArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBConvergence = makeConvergenceArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webConvergence = makeConvergenceArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosConvergence = makeConvergenceArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);

    writeReceipt(androidA, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-a',
      observationArtifact: androidAOperations,
      convergenceArtifact: androidAConvergence,
      packageChecksum: `sha256:${'c'.repeat(64)}`,
      lifecycle: scenario,
    }));
    writeReceipt(androidB, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-b',
      observationArtifact: androidBOperations,
      convergenceArtifact: androidBConvergence,
      packageChecksum: `sha256:${'c'.repeat(64)}`,
      lifecycle: scenario,
    }));
    writeReceipt(web, makeStrictReceipt({
      surface: 'web',
      installationId: 'web-install',
      observationArtifact: webOperations,
      convergenceArtifact: webConvergence,
      packageChecksum: `sha256:${'d'.repeat(64)}`,
      lifecycle: scenario,
    }));
    writeReceipt(macos, makeStrictReceipt({
      surface: 'macos',
      installationId: 'macos-install',
      observationArtifact: macosOperations,
      convergenceArtifact: macosConvergence,
      packageChecksum: `sha256:${'c'.repeat(64)}`,
      lifecycle: scenario,
    }));

    const result = runScript({
      androidReceipts: `emulator-5554=${androidA},emulator-5556=${androidB}`,
      webReceipt: web,
      macosReceipt: macos,
      proofPath,
    });

    expect(result.status).toBe(1);
    expect(result.evidence.status).toBe('BLOCKED');
    expect(result.evidence.blockers.some((blocker) => blocker.startsWith('package_checksum_mismatch:'))).toBe(true);
  });

  it('blocks tampered raw observation artifacts even when operation ids converge', { timeout: 15_000 }, () => {
    const temp = createTempRoot();
    const proofPath = join(temp, 'multi-surface-receipts.json');
    const androidA = join(temp, 'android-a.json');
    const androidB = join(temp, 'android-b.json');
    const web = join(temp, 'web.json');
    const macos = join(temp, 'macos.json');
    const checksum = `sha256:${'e'.repeat(64)}`;
    const scenario = makeLifecycleScenario();
    const androidAOperations = makeObservedOperationsArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBOperations = makeObservedOperationsArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webOperations = makeObservedOperationsArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosOperations = makeObservedOperationsArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);
    const androidAConvergence = makeConvergenceArtifact(temp, 'android-a', CONVERGENCE_OPERATION_IDS);
    const androidBConvergence = makeConvergenceArtifact(temp, 'android-b', CONVERGENCE_OPERATION_IDS);
    const webConvergence = makeConvergenceArtifact(temp, 'web', CONVERGENCE_OPERATION_IDS);
    const macosConvergence = makeConvergenceArtifact(temp, 'macos', CONVERGENCE_OPERATION_IDS);

    writeReceipt(androidA, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-a',
      observationArtifact: androidAOperations,
      convergenceArtifact: androidAConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(androidB, makeStrictReceipt({
      surface: 'android',
      installationId: 'android-install-b',
      observationArtifact: androidBOperations,
      convergenceArtifact: androidBConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(web, makeStrictReceipt({
      surface: 'web',
      installationId: 'web-install',
      observationArtifact: webOperations,
      convergenceArtifact: webConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));
    writeReceipt(macos, makeStrictReceipt({
      surface: 'macos',
      installationId: 'macos-install',
      observationArtifact: macosOperations,
      convergenceArtifact: macosConvergence,
      packageChecksum: checksum,
      lifecycle: scenario,
    }));

    writeFileSync(androidAOperations.path, `${JSON.stringify({
      source_timestamp: SOURCE_TIMESTAMP,
      operations: [
        { op_id: 'tamper', type: 'tampered', status: 'executed', timestamp: SOURCE_TIMESTAMP },
      ],
    }, null, 2)}\n`, 'utf8');

    const result = runScript({
      androidReceipts: `emulator-5554=${androidA},emulator-5556=${androidB}`,
      webReceipt: web,
      macosReceipt: macos,
      proofPath,
    });

    expect(result.status).toBe(1);
    expect(result.evidence.status).toBe('BLOCKED');
    expect(result.evidence.blockers).toContain('missing_or_blocked_shell_protocol');
    expect(result.evidence.blockers.some((blocker) => blocker.includes('artifact_stale'))).toBe(true);
  });
});
