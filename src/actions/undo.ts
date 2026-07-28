import type { SQLiteDatabase } from 'expo-sqlite';
import { ActionEvent, getAction } from '@/src/db/actions';
import { getUndoForAction } from '@/src/db/undo';
import { ActionCommand, executeAction } from './engine';

export type UndoEligibility = {
  eligible: boolean;
  reason?: string;
  undo_deadline_at?: string | null;
};

export type UndoExecution = {
  success: boolean;
  actionId?: string;
  reverseActionId?: string;
  verification?: {
    actionId: string;
    status: 'verified' | 'denied';
    expected: string;
    checks: string[];
    reason?: string;
  };
  reason: string;
};

export async function canUndo(db: SQLiteDatabase | null, actionId: string): Promise<UndoEligibility> {
  if (!db) {
    return { eligible: false, reason: 'Offline mode does not provide undoable actions.' };
  }

  const action = await getActionById(db, actionId);
  if (!action) {
    return { eligible: false, reason: 'Action not found.' };
  }

  if (action.status !== 'completed') {
    return {
      eligible: false,
      reason: `Cannot undo action in status ${action.status}.`,
      undo_deadline_at: actionStatusToDeadline(action),
    };
  }

  const undo = await getUndoForAction(db, actionId);
  if (!undo) {
    return { eligible: false, reason: 'Undo payload missing.' };
  }

  const deadline = parseUndoDeadline(undo.payload_json);
  if (!deadline || !isUndoStillValid(deadline)) {
    return {
      eligible: false,
      reason: 'Undo window expired.',
      undo_deadline_at: deadline,
    };
  }

  return { eligible: true, undo_deadline_at: deadline };
}

export async function executeUndo(db: SQLiteDatabase | null, actionId: string): Promise<UndoExecution> {
  const action = db ? await getActionById(db, actionId) : null;
  const check = db ? await canUndo(db, actionId) : { eligible: false, reason: 'Offline mode does not provide undoable actions.' };

  if (!check.eligible || !action) {
    return {
      success: false,
      reason: check.reason ?? 'Undo not available.',
    };
  }

  if (!db) {
    return {
      success: false,
      reason: 'Offline mode does not support undo execution.',
    };
  }

  const undoState = await getUndoForAction(db, actionId);
  const payload = undoState?.payload_json ? safeJsonParse(undoState.payload_json) : null;
  if (!payload || typeof payload !== 'object') {
    return { success: false, reason: 'Undo payload malformed.' };
  }

  const reverse = await executeAction({
    db,
    command: {
      ...buildReverseCommand(action),
      id: `${action.id}:undo:${Date.now()}`,
      idempotency_key: `${action.id}:undo`,
    },
  });

  return {
    success: true,
    actionId: action.id,
    reverseActionId: reverse.receipt.id,
    verification: reverse.verification,
    reason: `Undo executed using payload keys ${Object.keys(payload).join(',')}.`,
  };
}

function actionStatusToDeadline(action: ActionEvent): string | null {
  const withUndo = action as ActionEvent & { undo_payload_json?: string | null };
  if (!withUndo.undo_payload_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(withUndo.undo_payload_json) as { expires_at?: string };
    return parsed?.expires_at ?? null;
  } catch {
    return null;
  }
}

function getActionById(db: SQLiteDatabase, actionId: string) {
  return getAction(db, actionId);
}

function parseUndoDeadline(payload: string): string | null {
  const parsed = safeJsonParse(payload) as { expires_at?: string } | null;
  return parsed?.expires_at ?? null;
}

function isUndoStillValid(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return parsed > Date.now();
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildReverseCommand(input: ActionEvent): ActionCommand {
  return {
    id: '',
    actor: input.actor,
    domain: input.domain,
    tool: input.tool,
    action: 'undo',
    risk: 'standard',
    payload: {
      undo_of: input.id,
      snapshot: safeJsonParse((input as ActionEvent & { before_json?: string | null }).before_json as string) ?? null,
    },
    record_ids: parseRecordIds((input as ActionEvent & { record_ids: string | null }).record_ids ?? null),
    source_ids: [],
  };
}

function parseRecordIds(raw: string | null) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
