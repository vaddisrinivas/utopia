#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(process.env.QUALITY_GATE_ROOT?.trim() || process.cwd());
const outputPrefix = 'TELEMETRY_PRIVACY_GATE_JSON=';
const requiredFiles = [
  'docs/telemetry-and-privacy-contract.md',
  'docs/operations-observability.md',
  'packages/shared/contracts/telemetry.ts',
  'tests/contracts/telemetry.test.ts',
];

const forbiddenPayloadMarkers = [
  'api key',
  'token',
  'secret',
  'prompt',
  'records',
];

function read(file) {
  return readFileSync(resolve(root, file), 'utf8');
}

const absPaths = requiredFiles.map((file) => resolve(root, file));
const failures = [];

for (const file of absPaths) {
  if (!existsSync(file)) {
    failures.push(`missing:${relative(root, file)}`);
  }
}

if (failures.length === 0) {
  const telemetryContract = read('packages/shared/contracts/telemetry.ts');
  const telemetryDoc = read('docs/telemetry-and-privacy-contract.md');
  const operationsDoc = read('docs/operations-observability.md');
  const telemetryTests = read('tests/contracts/telemetry.test.ts');

  if (!telemetryContract.includes('FORBIDDEN_TELEMETRY_KEYS')) {
    failures.push('telemetry_contract_missing_forbidden_list');
  }
  if (!telemetryDoc.toLowerCase().includes('forbidden')) {
    failures.push('telemetry_doc_missing_forbidden_data_section');
  }
  if (!operationsDoc.includes('OpenTelemetry') || !operationsDoc.includes('Sentry')) {
    failures.push('operations_observability_missing_otel_or_sentry');
  }
  if (!telemetryTests.includes('forbidden telemetry field')) {
    failures.push('telemetry_test_missing_forbidden_reject');
  }

  const lowerDoc = telemetryDoc.toLowerCase();
  const lowerOperations = operationsDoc.toLowerCase();
  for (const marker of forbiddenPayloadMarkers) {
    if (lowerOperations.includes(marker) === false && marker === 'prompt') {
      failures.push(`operations_doc_missing_forbidden_marker:${marker}`);
    }
    if (lowerDoc.includes(marker) === false && marker === 'secret') {
      failures.push(`telemetry_doc_missing_forbidden_marker:${marker}`);
    }
  }

  for (const tokenMarker of ['sentry_dsn', 'otel_exporter']) {
    if (telemetryDoc.includes(tokenMarker.toUpperCase()) || operationsDoc.includes(tokenMarker.toUpperCase())) {
      failures.push(`hardcoded_observability_secret_candidate:${tokenMarker}`);
    }
  }
}

const payload = {
  proof: 'utopia_telemetry_privacy_gate',
  checked_at: new Date().toISOString(),
  root,
  status: failures.length ? 'BLOCKED' : 'READY',
  blockers: failures,
  required_files: Object.fromEntries(
    requiredFiles.map((file) => [file, existsSync(resolve(root, file))]),
  ),
};

console.log(`${outputPrefix}${JSON.stringify(payload)}`);
if (failures.length > 0) {
  process.exit(1);
}
