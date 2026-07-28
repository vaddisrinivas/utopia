import type { ConfidenceValue } from '@/packages/shared/contracts/confidence';
import type { ActionRisk, PolicyDecision } from '@/src/actions/policy';

export type ActionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'undone' | 'undo_failed';

export type ActionReceipt = {
  id: string;
  actor: string;
  domain: string;
  tool: string;
  schema_version?: 'utopia.action-event.v1' | string;
  risk?: ActionRisk;
  status: ActionStatus;
  record_ids: string[];
  conversation_id?: string;
  source_ids?: string[];
  created_at: string;
  updated_at: string;
  idempotency_key?: string;
  undo_deadline_at?: string;
};

export type CommandReceipt = {
  id: string;
  actor: string;
  domain: string;
  tool: string;
  status: ActionStatus;
  record_ids: string[];
  created_at: string;
  updated_at: string;
  idempotency_key?: string;
  undo_deadline_at?: string;
  undo_token: string;
  inverse_plan: InversePlanStep[];
};

export type InversePlanStep = {
  operation: string;
  target_type: 'record' | 'workflow' | string;
  target_id: string;
  metadata?: Record<string, unknown>;
};

export type ParsedCommandIntent = {
  type: 'create' | 'update' | 'archive' | 'noop';
  collection?: string;
  recordId?: string;
  title?: string;
  patch?: Record<string, unknown>;
  needsClarification: boolean;
  reason?: string;
};

export type CommandPolicyDecision = PolicyDecision & {
  risk: ActionRisk;
  confidence: ConfidenceValue;
};
