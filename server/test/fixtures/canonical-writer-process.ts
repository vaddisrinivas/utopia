const writer = Number(process.env.LIFEOS_CANONICAL_WRITER_INDEX);
if (!Number.isInteger(writer) || writer < 0) {
  throw new Error('LIFEOS_CANONICAL_WRITER_INDEX must be a non-negative integer');
}

const { createRecordWithAction } = await import('../../src/runtime/state');

const id = `concurrent-record-${writer}`;
const actionId = `concurrent-action-${writer}`;
const result = createRecordWithAction({
  actionId,
  actor: 'test',
  domain: 'food',
  tool: 'create_record',
  risk: 'low',
  command: `concurrent writer ${writer}`,
  idempotencyKey: `concurrent-key-${writer}`,
  record: {
    id,
    domain: 'food',
    collection: 'recipe',
    title: `Concurrent record ${writer}`,
    properties: { writer },
    relations: [],
    source: {
      provider: 'user',
      external_id: id,
      url: null,
      observed_at: '2026-07-26T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
  },
});

if (result.action.status !== 'completed' || result.record?.id !== id) {
  throw new Error(`writer ${writer} did not commit`);
}
