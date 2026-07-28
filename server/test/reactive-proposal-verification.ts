import assert from 'node:assert/strict';

import { verifyReactiveProposalPostcondition } from '../src/kernel/reactive-proposal-verification';
import type { McpRecord } from '../src/runtime/state';

const record: McpRecord = {
  id: 'verify-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Verify',
  properties: { status: 'done' },
  relations: [],
  source: { provider: 'user', external_id: 'verify-record', url: null, observed_at: new Date().toISOString(), content_hash: null },
  archived_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  revision: 2,
};
const nestedRecord: McpRecord = {
  ...record,
  id: 'verify-nested-record',
  properties: {
    status: 'done',
    nutrition: { macros: { protein: 31, carbs: 12 }, tags: ['bright', 'savory'] },
  },
};

assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'create_record', collection: 'recipe', recordId: record.id, properties: { status: 'done' } },
  record,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:create',
}).ok, true);
assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'create_record', collection: 'recipe', recordId: nestedRecord.id, properties: { nutrition: { macros: { protein: 31, carbs: 12 }, tags: ['bright', 'savory'] } } },
  record: nestedRecord,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:create-nested',
}).ok, true);
assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'create_record', collection: 'recipe', recordId: nestedRecord.id, properties: { nutrition: { macros: { protein: 30, carbs: 12 }, tags: ['bright', 'savory'] } } },
  record: nestedRecord,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:create-nested',
}).ok, false);
assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'update_record', recordId: record.id, changes: { status: 'done' } },
  record,
  beforeRevision: 1,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:update',
}).ok, true);
assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'update_record', recordId: record.id, changes: { status: 'missing' } },
  record,
  beforeRevision: 1,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:update',
}).ok, false);
assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'archive_record', recordId: record.id },
  record: { ...record, archived_at: new Date().toISOString(), revision: 3 },
  beforeRevision: 2,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:archive',
}).reason, 'canonical_archive_verified');
assert.equal(verifyReactiveProposalPostcondition({
  operationTemplate: { kind: 'archive_record', recordId: record.id },
  record: { ...record, archived_at: new Date().toISOString(), revision: 2 },
  beforeRevision: 2,
  actionId: 'action-a',
  operationId: 'operation-a',
  proposalId: 'proposal-a',
  operationTemplateHash: 'sha256:archive',
}).ok, false);

console.log('reactive-proposal-verification: passed');
