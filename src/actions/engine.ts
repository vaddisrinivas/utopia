import type { SQLiteDatabase } from 'expo-sqlite';
import {
  createActionEvent,
  getAction,
  getActionByIdempotencyKey,
  updateActionState,
} from '@/src/db/actions';
import { createUndoEvent, getUndoForAction } from '@/src/db/undo';
import {
  ActionRisk,
  evaluateCommandPolicy,
  PolicyDecision,
  policyCanExecute,
  policyNeedsClarification,
} from './policy';

export type ActionCommand = {
  id: string;
  actor: string;
  domain: string;
  tool: string;
  action: string;
  payload: Record<string, unknown>;
  risk: ActionRisk;
  record_ids: string[];
  source_ids: string[];
  idempotency_key?: string;
};

export type ActionReceipt = {
  id: string;
  actor: string;
  domain: string;
  tool: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  record_ids: string[];
  created_at: string;
  updated_at: string;
  idempotency_key?: string;
  undo_deadline_at: string;
};

export type Verification = {
  actionId: string;
  status: 'verified' | 'denied';
  expected: string;
  checks: string[];
  reason?: string;
};

export type ActionExecutionResult = {
  policy: PolicyDecision;
  receipt: ActionReceipt;
  command: ActionCommand;
  verification: Verification;
};

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;

export function makeCommandId(input: { scope: string; actor: string; action: string }) {
  const base = input.scope.replace(/[^a-z0-9_-]+/gi, '-').replace(/-{2,}/g, '-').toLowerCase();
  return `${base}:${input.actor}:${Date.now()}`;
}

export async function executeAction(input: {
  db: SQLiteDatabase | null;
  command: ActionCommand;
}): Promise<ActionExecutionResult> {
  if (input.command.idempotency_key && input.db) {
    const seen = await getActionByIdempotencyKey(input.db, input.command.idempotency_key);
    if (seen && seen.status === 'completed') {
      return {
        policy: {
          decision: 'execute',
          reason: 'Idempotency key replayed.',
          risk: seen.tool.includes('sensitive') ? 'standard' : 'low',
          confidence: normalizeReplayConfidence(),
        },
        command: input.command,
        receipt: {
          id: seen.id,
          actor: seen.actor,
          domain: seen.domain,
          tool: seen.tool,
          status: seen.status,
          record_ids: parseRecordIds(seen.record_ids),
          created_at: seen.created_at,
          updated_at: seen.updated_at,
          idempotency_key: seen.idempotency_key ?? undefined,
          undo_deadline_at: parseUndoDeadlineFromEvent(seen.undo_payload_json),
        },
        verification: {
          actionId: seen.id,
          status: 'verified',
          expected: seen.tool,
          checks: ['idempotency'],
          reason: 'Replay completed action by idempotency key.',
        },
      };
    }
  }

  const policy = evaluateCommandPolicy({
    domain: input.command.domain,
    tool: input.command.tool,
    command: input.command.payload.text ? String(input.command.payload.text) : input.command.action,
    actor: input.command.actor,
  });

  if (!policyCanExecute(policy)) {
    const now = new Date().toISOString();
    const deniedReceipt: ActionReceipt = {
      id: input.command.id,
      actor: input.command.actor,
      domain: input.command.domain,
      tool: input.command.tool,
      status: 'failed',
      record_ids: input.command.record_ids,
      created_at: now,
      updated_at: now,
      idempotency_key: input.command.idempotency_key,
      undo_deadline_at: new Date(Date.now() + ACTION_TTL_MS).toISOString(),
    };

    if (input.db) {
      await createActionEvent(input.db, {
        id: deniedReceipt.id,
        domain: deniedReceipt.domain,
        conversation_id: null,
        actor: deniedReceipt.actor,
        tool: deniedReceipt.tool,
        record_ids: deniedReceipt.record_ids,
        idempotency_key: deniedReceipt.idempotency_key,
      });
      await updateActionState(input.db, deniedReceipt.id, {
        status: deniedReceipt.status,
        before: null,
        after: null,
        undo_payload: null,
      });
    }

    return {
      policy,
      command: input.command,
      receipt: deniedReceipt,
      verification: {
        actionId: deniedReceipt.id,
        status: 'denied',
        expected: input.command.tool,
        checks: ['policy'],
        reason: policyNeedsClarification(policy) ? policy.clarifyingQuestion : policy.reason,
      },
    };
  }

  const now = new Date().toISOString();
  const undoDeadlineAt = new Date(Date.now() + ACTION_TTL_MS).toISOString();

  if (input.db) {
    await createActionEvent(input.db, {
      id: input.command.id,
      domain: input.command.domain,
      conversation_id: null,
      actor: input.command.actor,
      tool: input.command.tool,
      record_ids: input.command.record_ids,
      idempotency_key: input.command.idempotency_key,
    });
    await updateActionState(input.db, input.command.id, {
      status: 'running',
      before: { version: 0, source: 'client' },
      undo_payload: {
        command_id: input.command.id,
        snapshot: input.command.payload,
        expires_at: undoDeadlineAt,
      },
    });
  }

  const receipt: ActionReceipt = {
    id: input.command.id,
    actor: input.command.actor,
    domain: input.command.domain,
    tool: input.command.tool,
    status: 'completed',
    record_ids: input.command.record_ids,
    created_at: now,
    updated_at: now,
    idempotency_key: input.command.idempotency_key,
    undo_deadline_at: undoDeadlineAt,
  };

  if (input.db) {
    await updateActionState(input.db, input.command.id, {
      status: 'completed',
      after: { version: 1, source: 'engine' },
      undo_payload: {
        command_id: input.command.id,
        payload: input.command.payload,
        expires_at: undoDeadlineAt,
      },
    });
    await createUndoEvent(input.db, {
      id: `${input.command.id}:undo`,
      action_id: input.command.id,
      payload: {
        command: input.command,
        receipt,
      },
      expires_at: undoDeadlineAt,
    });
  }

  return {
    policy,
    command: input.command,
    receipt,
    verification: {
      actionId: input.command.id,
      status: 'verified',
      expected: input.command.tool,
      checks: ['policy', 'idempotency', 'db_event'],
    },
  };
}

function normalizeReplayConfidence() {
  return { score: 0.9, band: 'high' as const };
}

function parseUndoDeadlineFromEvent(undoPayloadJson: string | null) {
  if (!undoPayloadJson) {
    return new Date(Date.now() + ACTION_TTL_MS).toISOString();
  }

  try {
    const parsed = JSON.parse(undoPayloadJson) as { expires_at?: string };
    return parsed?.expires_at ?? new Date(Date.now() + ACTION_TTL_MS).toISOString();
  } catch {
    return new Date(Date.now() + ACTION_TTL_MS).toISOString();
  }
}

function parseRecordIds(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function getActionByCommand(db: SQLiteDatabase | null, actionId: string) {
  if (!db) {
    return null;
  }
  return getAction(db, actionId);
}

export async function getUndoState(db: SQLiteDatabase | null, actionId: string) {
  if (!db) {
    return null;
  }
  return getUndoForAction(db, actionId);
}
