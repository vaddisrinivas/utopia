import { z } from 'zod';
import { findRecord, getActionEvent } from '../runtime/state';

export type VerificationResult = {
  actionId: string;
  expected: string;
  status: 'verified' | 'denied';
  checks: string[];
  reason?: string;
};

export type VerifyInput = {
  actionId: string;
  expected: string;
  sourceBound?: boolean;
  expectedSupportsUndo?: boolean;
  actualStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'undone' | 'undo_failed';
  actualRecordIds?: string[];
};

const verifyInputSchema = z.object({
  actionId: z.string().min(1),
  expected: z.string(),
  sourceBound: z.boolean().optional(),
  expectedSupportsUndo: z.boolean().optional(),
  actualStatus: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'undone', 'undo_failed']).optional(),
  actualRecordIds: z.array(z.string().trim().min(1)).optional(),
});

const REVERSIBLE_RECORD_ACTIONS = new Set([
  'create_record',
  'update_record',
  'archive_record',
  'utopia.create_record',
  'utopia.update_record',
  'utopia.archive_record',
]);

export async function verifyResult(input: VerifyInput): Promise<VerificationResult> {
  const parsed = verifyInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      actionId: input.actionId ?? 'unknown',
      expected: input.expected ?? '',
      status: 'denied',
      checks: ['input_shape'],
      reason: 'Verification input failed schema validation.',
    };
  }
  input = parsed.data;
  const reversibleRecordAction = REVERSIBLE_RECORD_ACTIONS.has(input.expected);
  const supportsUndo = reversibleRecordAction || (input.expectedSupportsUndo ?? input.expected !== 'chat_reply');
  if (!input.expected || input.expected.trim().length === 0) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['input_shape'],
      reason: 'Expected action target is missing.',
    };
  }

  const action = getActionEvent(input.actionId);
  if (!action) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['action_event', 'canonical_postcondition'],
      reason: 'Canonical action event was not found.',
    };
  }

  if (action.tool !== input.expected) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['action_event', 'action_tool'],
      reason: `Action tool is ${action.tool}; expected ${input.expected}.`,
    };
  }

  if (input.actualStatus && input.actualStatus !== action.status) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['action_event', 'actual_status'],
      reason: `Caller reported ${input.actualStatus}; canonical action status is ${action.status}.`,
    };
  }

  if (action.status !== 'completed') {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['action_event', 'canonical_postcondition'],
      reason: `Action status is ${action.status}; canonical completion was not proven.`,
    };
  }

  const canonicalRecordIds = action.record_ids.filter((id) => typeof id === 'string' && id.trim().length > 0);
  if (input.actualRecordIds) {
    const actualRecordIds = [...new Set(input.actualRecordIds.map((id) => id.trim()).filter(Boolean))].sort();
    const expectedRecordIds = [...new Set(canonicalRecordIds)].sort();
    if (actualRecordIds.length !== expectedRecordIds.length
      || actualRecordIds.some((recordId, index) => recordId !== expectedRecordIds[index])) {
      return {
        actionId: input.actionId,
        expected: input.expected,
        status: 'denied',
        checks: ['action_event', 'record_identity'],
        reason: `Caller reported record ids ${actualRecordIds.join(',') || '(none)'}; canonical action records are ${expectedRecordIds.join(',') || '(none)'}.`,
      };
    }
  }
  if ((reversibleRecordAction || input.expectedSupportsUndo) && canonicalRecordIds.length === 0) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['canonical_postcondition', 'record_identity'],
      reason: 'A reversible record action must identify the affected record.',
    };
  }

  const missingRecordId = canonicalRecordIds.find((recordId) => !findRecord(recordId));
  if (missingRecordId) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['canonical_postcondition', 'record_identity', 'record_reread'],
      reason: `Affected record ${missingRecordId} was not found in canonical state.`,
    };
  }

  if (supportsUndo && (action.undo_payload_json === null || action.undo_payload_json === undefined)) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['canonical_postcondition', 'undo_ready'],
      reason: 'Undo payload was not found on the canonical action event.',
    };
  }

  if (input.sourceBound === true && action.source_ids.length === 0) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['action_event', 'source_bound'],
      reason: 'Caller reported source-bound execution, but canonical action has no bound sources.',
    };
  }
  if (input.sourceBound === false && action.source_ids.length > 0) {
    return {
      actionId: input.actionId,
      expected: input.expected,
      status: 'denied',
      checks: ['action_event', 'source_bound'],
      reason: 'Caller reported sourceBound=false, but canonical action is bound to source ids.',
    };
  }

  const checks = ['action_event', 'canonical_postcondition', 'record_reread', 'source_bound'];
  if (action.idempotency_key) {
    checks.push('idempotent');
  }
  if (supportsUndo) {
    checks.push('undo_ready');
  }

  return {
    actionId: input.actionId,
    expected: input.expected,
    status: 'verified',
    checks,
  };
}
