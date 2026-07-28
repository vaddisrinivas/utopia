import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'utopia-causal-'));
process.env.WONDER_RUNTIME_STATE_PATH = join(dir, 'wonder-runtime.json');
const state = await import('../src/runtime/state');

const record = state.createRecord({
  id: 'decision-causal-1',
  domain: 'food',
  collection: 'recipe',
  title: 'Causal contract',
  properties: {},
  relations: [],
  source: { provider: 'user', external_id: 'decision-causal-1', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
}, { persist: false });

const write = state.updateRecordWithAction({
  actionId: 'action-causal-1',
  operationId: 'operation-causal-1',
  causeId: 'cause-causal-1',
  actor: 'test', domain: 'food', tool: 'update_record', risk: 'standard', command: 'update', id: record.id,
  expectedRevision: record.revision,
  patch: { title: 'Causal contract updated' },
});
assert.equal(write.action.status, 'completed');
const verified = state.attachActionVerification(write.action.id, { ok: true, verifierVersion: 'test.verifier.v1' });
assert.equal((verified?.verification_json as { ok?: boolean }).ok, true);
assert.equal(write.action.operation_id, 'operation-causal-1');
assert.equal(write.action.cause_id, 'cause-causal-1');
assert.equal(write.action.expected_revision, record.revision);
assert.equal(write.record?.revision, (record.revision ?? 0) + 1);

const conflict = state.updateRecordWithAction({
  actionId: 'action-causal-conflict', actor: 'test', domain: 'food', tool: 'update_record', risk: 'standard', command: 'update', id: record.id,
  expectedRevision: record.revision,
  patch: { title: 'must not win' },
});
assert.equal(conflict.action.status, 'failed');
assert.match((conflict.action as unknown as { reason?: string }).reason ?? 'revision conflict', /revision conflict/);
assert.equal(conflict.record?.title, 'Causal contract updated');
console.log('state-causal-contract: passed');
