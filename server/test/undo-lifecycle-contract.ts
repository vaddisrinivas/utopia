import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-undo-lifecycle-')), 'wonder-runtime.json');

const {
  createRecordWithAction,
  deleteRecord,
  getActionEvent,
  runUndo,
} = await import('../src/runtime/state');

const success = createRecordWithAction({
  actionId: 'undo-lifecycle-success',
  actor: 'hearth',
  domain: 'food',
  tool: 'utopia.create_record',
  risk: 'low',
  command: 'create recipe undo lifecycle success',
  record: {
    id: 'undo-lifecycle-success-record',
    domain: 'food',
    collection: 'recipe',
    title: 'Undo lifecycle success',
    properties: {},
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: 'undo-lifecycle-success-record',
      url: null,
      observed_at: '2026-07-26T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
  },
});

const firstUndo = runUndo(success.action.id);
assert.equal(firstUndo.success, true, firstUndo.message);
assert.equal(getActionEvent(success.action.id)?.status, 'undone');

const secondUndo = runUndo(success.action.id);
assert.equal(secondUndo.success, true, secondUndo.message);
assert.equal(secondUndo.message, 'Action already undone.');
assert.equal(getActionEvent(success.action.id)?.status, 'undone');

const failure = createRecordWithAction({
  actionId: 'undo-lifecycle-failure',
  actor: 'hearth',
  domain: 'food',
  tool: 'utopia.create_record',
  risk: 'low',
  command: 'create recipe undo lifecycle failure',
  record: {
    id: 'undo-lifecycle-failure-record',
    domain: 'food',
    collection: 'recipe',
    title: 'Undo lifecycle failure',
    properties: {},
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: 'undo-lifecycle-failure-record',
      url: null,
      observed_at: '2026-07-26T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
  },
});

deleteRecord('undo-lifecycle-failure-record');
const failedUndo = runUndo(failure.action.id);
assert.equal(failedUndo.success, false, 'undo should fail when the created record is already missing');
assert.equal(getActionEvent(failure.action.id)?.status, 'undo_failed');

console.log('PASS server/test/undo-lifecycle-contract.ts');
