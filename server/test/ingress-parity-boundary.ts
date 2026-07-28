import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.WONDER_RUNTIME_STATE_PATH = join(mkdtempSync(join(tmpdir(), 'utopia-ingress-parity-')), 'wonder-runtime.json');

const executorSource = readFileSync(resolve(process.cwd(), 'server/src/agents/executor.ts'), 'utf8');
const executorStateImport = executorSource.match(/import\s*\{([\s\S]*?)\}\s*from '\.\.\/runtime\/state';/);
assert.equal(Boolean(executorStateImport), true, 'expected executor runtime state import');
assert.equal(
  /\bcreateRecord\b|\bupdateRecord\b|\barchiveRecord\b/.test(executorStateImport?.[1] ?? ''),
  false,
  'chat executor must not import direct record mutators',
);

const { executeCommand } = await import('../src/agents/executor');
const { callMcpTool } = await import('../src/tools/catalog');
const { findRecord, getActionEvent } = await import('../src/runtime/state');
const { evaluateMcpPolicy } = await import('../src/security/policy');

function requireAction(id: string) {
  const action = getActionEvent(id);
  assert.ok(action, `expected action ${id}`);
  return action;
}

function requireRecord(id: string) {
  const record = findRecord(id);
  assert.ok(record, `expected record ${id}`);
  return record;
}

function actionIdFromToolResult(result: Awaited<ReturnType<typeof callMcpTool>>) {
  const action = result.json.action as { id?: unknown } | undefined;
  assert.equal(typeof action?.id, 'string', 'expected MCP tool action id');
  return String(action?.id);
}

function assertLifecycleParity(input: {
  chatActionId: string;
  toolActionId: string;
  chatRecordId: string;
  toolRecordId: string;
  operation: 'delete_record' | 'restore_after_update' | 'restore_after_archive';
  expectedRevision: number;
  archived: boolean;
}) {
  const chatAction = requireAction(input.chatActionId);
  const toolAction = requireAction(input.toolActionId);
  const chatRecord = requireRecord(input.chatRecordId);
  const toolRecord = requireRecord(input.toolRecordId);

  assert.equal(chatAction.status, 'completed');
  assert.equal(toolAction.status, 'completed');
  assert.equal((chatAction.undo_payload_json as { operation?: unknown })?.operation, input.operation);
  assert.equal((toolAction.undo_payload_json as { operation?: unknown })?.operation, input.operation);
  assert.equal(chatRecord.source.provider, 'sqlite');
  assert.equal(toolRecord.source.provider, 'sqlite');
  assert.equal(chatRecord.revision, input.expectedRevision);
  assert.equal(toolRecord.revision, input.expectedRevision);
  assert.equal(Boolean(chatRecord.archived_at), input.archived);
  assert.equal(Boolean(toolRecord.archived_at), input.archived);
}

const reviewPolicy = evaluateMcpPolicy({
  tool: 'utopia.archive_record',
  domain: 'food',
  command: 'archive recipe parity-review',
  actor: 'hearth',
});
assert.equal(reviewPolicy.decision, 'review');
assert.equal('allowed' in reviewPolicy, false, 'policy decisions must not expose boolean allowed');

const chatCreate = await executeCommand({
  actionId: 'ingress-chat-create',
  actor: 'hearth',
  domain: 'food',
  tool: 'chat_execute_command',
  commandText: 'create recipe Chat parity',
  record_ids: [],
  conversationId: 'ingress-parity-chat',
});
assert.equal(chatCreate.receipt.tool, 'utopia.create_record');
const chatCreateRecordId = chatCreate.receipt.record_ids[0];
assert.ok(chatCreateRecordId, 'chat create should emit a record id');

const toolCreate = await callMcpTool('utopia.create_record', {
  actor: 'hearth',
  domain: 'food',
  collection: 'recipe',
  title: 'Tool parity',
  data_home: 'local_sqlite',
  id: 'ingress-tool-record',
  action_id: 'ingress-tool-create',
  idempotency_key: 'ingress-tool-create-key',
});
assert.equal(toolCreate.reviewOnly, false);
const toolCreateActionId = actionIdFromToolResult(toolCreate);
const toolCreateRecordId = String((toolCreate.json.record as { id?: unknown } | undefined)?.id ?? 'ingress-tool-record');

assertLifecycleParity({
  chatActionId: chatCreate.receipt.id,
  toolActionId: toolCreateActionId,
  chatRecordId: chatCreateRecordId,
  toolRecordId: toolCreateRecordId,
  operation: 'delete_record',
  expectedRevision: 1,
  archived: false,
});

const chatUpdate = await executeCommand({
  actionId: 'ingress-chat-update',
  actor: 'hearth',
  domain: 'food',
  tool: 'chat_execute_command',
  commandText: 'update recipe Chat parity to Chat parity updated',
  record_ids: [chatCreateRecordId],
  conversationId: 'ingress-parity-chat',
});
const toolUpdate = await callMcpTool('utopia.update_record', {
  actor: 'hearth',
  id: toolCreateRecordId,
  data_home: 'local_sqlite',
  patch: { title: 'Tool parity updated' },
  action_id: 'ingress-tool-update',
  idempotency_key: 'ingress-tool-update-key',
});

assertLifecycleParity({
  chatActionId: chatUpdate.receipt.id,
  toolActionId: actionIdFromToolResult(toolUpdate),
  chatRecordId: chatCreateRecordId,
  toolRecordId: toolCreateRecordId,
  operation: 'restore_after_update',
  expectedRevision: 2,
  archived: false,
});

const chatArchive = await executeCommand({
  actionId: 'ingress-chat-archive',
  actor: 'hearth',
  domain: 'food',
  tool: 'chat_execute_command',
  commandText: 'archive recipe Chat parity updated',
  record_ids: [chatCreateRecordId],
  conversationId: 'ingress-parity-chat',
});
const toolArchiveQueued = await callMcpTool('utopia.archive_record', {
  actor: 'hearth',
  id: toolCreateRecordId,
  data_home: 'local_sqlite',
  action_id: 'ingress-tool-archive',
  idempotency_key: 'ingress-tool-archive-key',
});
assert.equal(toolArchiveQueued.reviewOnly, true);
assert.equal(toolArchiveQueued.json.status, 'queued_for_review');

const archiveApprovalRequest = toolArchiveQueued.json.approval_request as {
  tool: string;
  operationId: string;
  idempotencyKey: string;
  operationHash: string;
};
assert.equal(typeof archiveApprovalRequest?.operationHash, 'string', 'expected archive approval request');

const toolArchive = await callMcpTool('utopia.archive_record', {
  actor: 'hearth',
  id: toolCreateRecordId,
  data_home: 'local_sqlite',
  action_id: 'ingress-tool-archive',
  idempotency_key: 'ingress-tool-archive-key',
  approval_receipt: {
    schemaVersion: 'wonder.mcp-review-approval.v1',
    approver: 'hearth',
    authority: 'test-authority',
    tool: archiveApprovalRequest.tool,
    operationId: archiveApprovalRequest.operationId,
    idempotencyKey: archiveApprovalRequest.idempotencyKey,
    operationHash: archiveApprovalRequest.operationHash,
    localActor: 'hearth',
    approvedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
  },
});

assertLifecycleParity({
  chatActionId: chatArchive.receipt.id,
  toolActionId: actionIdFromToolResult(toolArchive),
  chatRecordId: chatCreateRecordId,
  toolRecordId: toolCreateRecordId,
  operation: 'restore_after_archive',
  expectedRevision: 3,
  archived: true,
});

console.log('PASS server/test/ingress-parity-boundary.ts');
