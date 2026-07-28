import assert from 'node:assert/strict';
import { actionEnvelopeSchema, applyJsonDiff, diffJson, validateJsonSchema } from '../src/kernel/validation';

const envelope = actionEnvelopeSchema.parse({
  schema_version: 'utopia.action-event.v1',
  id: 'a1',
  actor: 'user',
  domain: 'decision-ledger',
  tool: 'approve',
  record_ids: ['d1'],
  source_ids: ['e1'],
  idempotency_key: 'k1',
  operation_id: 'o1',
  cause_id: 'c1',
});
assert.equal(envelope.id, 'a1');

const patch = diffJson({ state: 'open', count: 1 }, { state: 'approved', count: 2 });
assert.deepEqual(applyJsonDiff({ state: 'open', count: 1 }, patch), { state: 'approved', count: 2 });

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
  additionalProperties: false,
} as const;
assert.equal(validateJsonSchema(schema, { id: 'd1' }).valid, true);
assert.equal(validateJsonSchema(schema, { id: 4 }).valid, false);
console.log('kernel-validation: passed');
