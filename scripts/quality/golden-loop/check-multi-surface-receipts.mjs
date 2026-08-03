#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { currentGit } from '../evidence-provenance.mjs';
import {
  DEFAULT_EMULATOR_IDENTITIES,
  normalizeAvdIdentities,
} from '../emulator-sync/emulator-sync-plan.mjs';
import { validateReceipt as validateReceiptFromAdapter } from './receipt-adapter.mjs';
import { SHELL_PROOF_SCHEMA_VERSION } from './shell-proof-protocol.mjs';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'golden-loop');
const explicitOutPath = process.env.UTOPIA_MULTI_SURFACE_RECEIPTS_OUT_PATH;
const outPath = explicitOutPath
  ? (isAbsolute(explicitOutPath) ? explicitOutPath : join(outDir, explicitOutPath))
  : join(outDir, 'multi-surface-receipts.json');

const webReceiptPath = process.env.UTOPIA_MULTI_SURFACE_WEB_RECEIPT_PATH ?? 'app/build/evidence/golden-loop/web-execution-receipt.json';
const macosReceiptPath = process.env.UTOPIA_MULTI_SURFACE_MACOS_RECEIPT_PATH
  ?? 'app/build/evidence/golden-loop/macos-execution-receipt.json';
const REQUIRED_ANDROID_COUNT = 2;
const DEFAULT_MAX_RECEIPT_AGE_MS = 30 * 60 * 1000;

const REQUIRED_SOURCE_SURFACES = {
  android: 'android',
  web: 'web',
  macos: 'macos',
};

function deriveSurfaceFromLabel(label) {
  if (label.startsWith('android_')) return 'android';
  if (label === 'web') return 'web';
  if (label === 'macos') return 'macos';
  return null;
}

function normalizeAndroidInput(raw = '') {
  const requiredIds = normalizeAvdIdentities(
    process.env.UTOPIA_EMULATOR_SYNC_AVD_IDS
      || DEFAULT_EMULATOR_IDENTITIES.join(','),
  ).slice(0, REQUIRED_ANDROID_COUNT);
  return {
    requiredIds,
    entries: raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => {
        const equalsIndex = entry.indexOf('=');
        if (equalsIndex > 0 && equalsIndex < entry.length - 1) {
          return {
            avdId: entry.slice(0, equalsIndex).trim(),
            path: entry.slice(equalsIndex + 1).trim(),
          };
        }

        return {
          avdId: requiredIds[index] ?? `emulator-${index + 1}`,
          path: entry,
        };
      }),
  };
}

function validateReceipt(label, path, blockers, options = {}) {
  return {
    ...validateReceiptFromAdapter({
      root,
      label,
      path,
      blockers,
      requireInstallationId: true,
      requireShellProof: true,
      requiredSourceSurface: options.requiredSourceSurface ?? deriveSurfaceFromLabel(label),
    }),
    requested_path: path,
  };
}

function collectEvidenceValue(records, selector) {
  const values = records
    .map(selector)
    .filter(Boolean);
  return new Set(values);
}

function compareSurfaceSets(surfaceKey, blockers, records, selector) {
  const values = collectEvidenceValue(records, selector);
  if (values.size > 1) {
    blockers.push(`${surfaceKey}_evidence_mismatch:${Array.from(values).join(',')}`);
  }
}

export function receiptFreshnessBlocker(checkedAt, {
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_RECEIPT_AGE_MS,
} = {}) {
  if (typeof checkedAt !== 'string' || Number.isNaN(Date.parse(checkedAt))) {
    return 'missing_or_invalid_checked_at';
  }
  const age = now - Date.parse(checkedAt);
  if (age < -5 * 60 * 1000) return `receipt_checked_at_in_future:${checkedAt}`;
  if (age > maxAgeMs) return `receipt_checked_at_too_old:${checkedAt}`;
  return null;
}

function summarizeSurface(record) {
  return {
    run_id: record.run_id,
    proof: record.proof,
    status: record.status,
    pass: record.pass,
    requested_path: record.requested_path,
    source_surface: record.source_surface,
    checksum: record.checksum,
    installation_id: record.installation_id,
    version_transition: record.package_transition,
    durable_data_checksum: record.durable_data_checksum,
    transport: record.transport,
    operation_ids: record.operation_ids,
    convergence: record.convergence,
  };
}

function checkShellEvidence(blockers, records) {
  const configuredMaxAgeMs = Number(process.env.UTOPIA_MULTI_SURFACE_MAX_RECEIPT_AGE_MS || DEFAULT_MAX_RECEIPT_AGE_MS);
  const maxAgeMs = Number.isFinite(configuredMaxAgeMs) && configuredMaxAgeMs > 0
    ? configuredMaxAgeMs
    : DEFAULT_MAX_RECEIPT_AGE_MS;
  for (const record of records) {
    if (!record.run_id) {
      blockers.push(`missing_run_id:${record.requested_path}`);
    }

    const freshnessBlocker = receiptFreshnessBlocker(record.checked_at, { maxAgeMs });
    if (freshnessBlocker) {
      blockers.push(`${freshnessBlocker}:${record.requested_path}`);
    }

    if (!record.shell_proof || !record.shell_proof.pass) {
      blockers.push(`missing_or_blocked_shell_protocol:${record.requested_path}`);
      continue;
    }

    const shell = record.shell_proof;
    if (shell.transport?.sync_claimed && !(shell.transport.endpoint && shell.transport.session)) {
      blockers.push(`missing_sync_transport_session_or_endpoint:${record.requested_path}`);
    }

    if (!shell.source_surface) {
      blockers.push(`missing_source_surface:${record.requested_path}`);
    }

    if (!shell.package?.checksum) {
      blockers.push(`missing_package_checksum:${record.requested_path}`);
    }

    if (!shell.package?.transition_from || !shell.package?.transition_to) {
      blockers.push(`missing_version_transition:${record.requested_path}`);
    }

    if (!Array.isArray(shell.operation_ids) || shell.operation_ids.length === 0) {
      blockers.push(`missing_operation_ids:${record.requested_path}`);
    }

    if (!shell.convergence) {
      blockers.push(`missing_convergence:${record.requested_path}`);
    }
  }

  compareSurfaceSets('package_transition', blockers, records, (record) => {
    const transition = record.package_transition;
    return transition && transition.from && transition.to
      ? `${transition.from}->${transition.to}:${transition.checksum}`
      : null;
  });

  compareSurfaceSets('durable_data_checksum', blockers, records, (record) => record.durable_data_checksum);

  const operationIdSets = records
    .map((record) => {
      const operations = record.operation_ids || [];
      return [...operations].sort().join('|');
    })
    .filter(Boolean);
  if (new Set(operationIdSets).size > 1) {
    blockers.push(`operation_ids_mismatch:${operationIdSets.join('||')}`);
  }

  const convergenceSets = records
    .map((record) => {
      const convergence = record.convergence?.operation_ids || [];
      return [...convergence].sort().join('|');
    })
    .filter(Boolean);
  if (new Set(convergenceSets).size > 1) {
    blockers.push(`convergence_operation_ids_mismatch:${convergenceSets.join('||')}`);
  }

  compareSurfaceSets('run_id', blockers, records, (record) => record.run_id);
}

function main() {
  mkdirSync(outDir, { recursive: true });

  const blockers = [];
  const current = currentGit(root);
  const expectedRunId = process.env.UTOPIA_GOLDEN_LOOP_RUN_ID
    || process.env.GOLDEN_LOOP_RUN_ID
    || null;

  const android = normalizeAndroidInput(process.env.UTOPIA_MULTI_SURFACE_ANDROID_RECEIPTS ?? '');
  if (android.entries.length !== REQUIRED_ANDROID_COUNT) {
    blockers.push(`invalid_android_receipt_count:${android.entries.length}:expected:${REQUIRED_ANDROID_COUNT}`);
  }

  const checkedAt = new Date().toISOString();

  const androidReceipts = android.entries.map((entry) => {
    if (!entry.avdId) return null;
    return {
      avd_id: entry.avdId,
      ...validateReceipt(`android_${entry.avdId}`, entry.path, blockers, { requiredSourceSurface: REQUIRED_SOURCE_SURFACES.android }),
    };
  }).filter(Boolean);

  if (android.requiredIds.length > 0 && android.entries.length === REQUIRED_ANDROID_COUNT) {
    for (const requiredId of android.requiredIds.slice(0, REQUIRED_ANDROID_COUNT)) {
      if (!androidReceipts.some((entry) => entry.avd_id === requiredId)) {
        blockers.push(`missing_android_receipt_for:${requiredId}`);
      }
    }
  }

  const web = {
    label: 'web',
    ...validateReceipt('web', webReceiptPath, blockers, { requiredSourceSurface: REQUIRED_SOURCE_SURFACES.web }),
  };
  const macos = {
    label: 'macos',
    ...validateReceipt('macos', macosReceiptPath, blockers, { requiredSourceSurface: REQUIRED_SOURCE_SURFACES.macos }),
  };

  const allReceipts = [...androidReceipts, web, macos];
  const runIds = allReceipts.map((entry) => entry.run_id).filter((value) => typeof value === 'string' && value.trim().length > 0);
  if (expectedRunId && runIds.some((runId) => runId !== expectedRunId)) {
    blockers.push(`run_id_mismatch_expected:${expectedRunId}:${runIds.join('|')}`);
  } else if (runIds.length === 0) {
    blockers.push('missing_run_id');
  }

  const checksumValues = allReceipts
    .map((entry) => entry.shell_proof?.package?.checksum)
    .filter(Boolean);
  const checksumSet = new Set(checksumValues);
  if (checksumSet.size === 0) {
    blockers.push('missing_all_package_checksums');
  } else if (checksumSet.size > 1) {
    blockers.push(`package_checksum_mismatch:${[...checksumSet].join(',')}`);
  }

  const installationIds = allReceipts.map((entry) => entry.installation_id).filter((value) => value !== null);
  if (new Set(installationIds).size !== installationIds.length) {
    blockers.push('duplicate_installation_ids');
  }

  if (new Set(androidReceipts.map((entry) => entry.avd_id)).size !== androidReceipts.length) {
    blockers.push('duplicate_android_avd_id');
  }

  checkShellEvidence(blockers, allReceipts);

  const hasConflicts = blockers.length > 0;
  const status = hasConflicts ? 'BLOCKED' : 'PASS';

  const evidence = {
    proof: 'utopia_multi_surface_receipts',
    schema_version: SHELL_PROOF_SCHEMA_VERSION,
    status,
    checked_at: checkedAt,
    git: current,
    blockers,
    surfaces: {
      android: {
        required_ids: android.requiredIds,
        received: androidReceipts.map((record) => ({
          avd_id: record.avd_id,
          ...summarizeSurface(record),
        })),
      },
      web: summarizeSurface(web),
      macos: summarizeSurface(macos),
    },
    package_checksum: checksumValues[0] ?? null,
    status_reason: status === 'PASS'
      ? 'all multi-surface execution receipts present and validated'
      : `blocked:${blockers.join('|')}`,
    run_id: runIds[0] ?? null,
  };

  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`${evidence.proof}: ${evidence.status}`);
  if (status !== 'PASS') {
    console.log(`BLOCKERS=${blockers.join(',')}`);
  }
  if (status !== 'PASS') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
