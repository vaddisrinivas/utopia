import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-mcp-review-')), 'wonder-runtime.json');

const { callMcpTool } = await import('../src/tools/catalog');
const { createRecord, findRecord } = await import('../src/runtime/state');

const seed = createRecord({
  id: 'mcp-review-archive-record',
  domain: 'food',
  collection: 'recipe',
  title: 'Needs review',
  properties: { status: 'stale' },
  relations: [],
  source: {
    provider: 'user',
    external_id: 'mcp-review-archive-record',
    url: null,
    observed_at: new Date().toISOString(),
    content_hash: null,
  },
  archived_at: null,
}, { persist: false });

const queued = await callMcpTool('utopia.archive_record', {
  actor: 'approver',
  id: seed.id,
  idempotency_key: 'archive-review-key',
});
assert.equal(queued.reviewOnly, true);
assert.equal(queued.json.status, 'queued_for_review');
assert.equal(queued.receipts?.[0]?.status, 'queued');
assert.equal(findRecord(seed.id)?.archived_at, null);

const approvalRequest = queued.json.approval_request as {
  tool: string;
  operationId: string;
  idempotencyKey: string;
  operationHash: string;
};
assert.equal(typeof approvalRequest?.operationHash, 'string');

const tampered = await callMcpTool('utopia.archive_record', {
  actor: 'approver',
  id: seed.id,
  idempotency_key: 'archive-review-key',
  approval_receipt: {
    schemaVersion: 'wonder.mcp-review-approval.v1',
    approver: 'approver',
    authority: 'test-authority',
    tool: approvalRequest.tool,
    operationId: approvalRequest.operationId,
    idempotencyKey: approvalRequest.idempotencyKey,
    operationHash: hashValue({ bad: true }),
    localActor: 'approver',
    approvedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
  },
});
assert.equal(tampered.reviewOnly, true);
assert.equal(tampered.json.approval_error, 'review_approval_hash_mismatch');
assert.equal(findRecord(seed.id)?.archived_at, null);

const approved = await callMcpTool('utopia.archive_record', {
  actor: 'approver',
  id: seed.id,
  idempotency_key: 'archive-review-key',
  approval_receipt: {
    schemaVersion: 'wonder.mcp-review-approval.v1',
    approver: 'approver',
    authority: 'test-authority',
    tool: approvalRequest.tool,
    operationId: approvalRequest.operationId,
    idempotencyKey: approvalRequest.idempotencyKey,
    operationHash: approvalRequest.operationHash,
    localActor: 'approver',
    approvedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
  },
});
assert.equal(approved.reviewOnly, false);
assert.equal(approved.receipts?.[0]?.status, 'completed');
assert.ok(findRecord(seed.id)?.archived_at);

console.log('mcp-review-approval: passed');

function hashValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
