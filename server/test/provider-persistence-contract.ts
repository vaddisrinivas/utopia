import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readJsonStateFile, writeJsonStateFileAtomic } from '../src/providers/json-state';

const tempDir = mkdtempSync(join(tmpdir(), 'utopia-provider-persistence-'));

const atomicPath = join(tempDir, 'atomic.json');
writeJsonStateFileAtomic(atomicPath, { ok: true, nested: { value: 1 } });
assert.deepEqual(JSON.parse(readFileSync(atomicPath, 'utf-8')), { ok: true, nested: { value: 1 } });
assert.equal(readdirSync(tempDir).some((name) => name.includes('.tmp-')), false, 'atomic write should not leave temp files behind');

const runtimePath = join(tempDir, 'wonder-runtime.json');
writeFileSync(runtimePath, '{"broken":', 'utf-8');
assert.throws(
  () => readJsonStateFile(runtimePath, {
    label: 'Wonder runtime state',
    validate: (value): value is { version: 1 } => typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1,
  }),
  /Corrupt Wonder runtime state/,
  'runtime corruption error should be explicit',
);
assert.equal(readdirSync(tempDir).some((name) => /^wonder-runtime\.corrupt-/.test(name)), true, 'corrupt runtime state should be quarantined');

const workflowPath = join(tempDir, 'workflow-runs.json');
writeFileSync(workflowPath, '{"runs":', 'utf-8');
assert.throws(
  () => readJsonStateFile(workflowPath, {
    label: 'workflow checkpoint state',
    validate: (value): value is { runs: Record<string, unknown> } => typeof value === 'object' && value !== null && 'runs' in (value as Record<string, unknown>),
  }),
  /Corrupt workflow checkpoint state/,
  'workflow corruption error should be explicit',
);
assert.equal(readdirSync(tempDir).some((name) => /^workflow-runs\.corrupt-/.test(name)), true, 'corrupt workflow state should be quarantined');

console.log('PASS server/test/provider-persistence-contract.ts');
