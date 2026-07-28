import type { CanonicalProvenance, CanonicalRecord } from './records';

export type OperationKind = 'create' | 'update' | 'archive' | 'restore' | 'relate' | 'unrelate' | 'delete';
export type OperationActor = CanonicalProvenance['actor'];
export type OperationOrigin = 'manual' | 'chat' | 'share' | 'webhook' | 'workflow' | 'import' | 'capture' | 'sync' | 'seed';

export interface Operation {
  op_id: string;
  kind: OperationKind;
  domain: string;
  collection: string;
  record_id: string;
  expected_revision?: number;
  changes?: Record<string, unknown>;
  record?: Partial<CanonicalRecord> & { source?: CanonicalRecord['source'] };
  relations_add?: { name: string; target_id: string }[];
  relations_remove?: { name: string; target_id: string }[];
  actor: OperationActor;
  origin: OperationOrigin;
  idempotency_key?: string;
  confidence?: number | null;
  evidence?: string[];
  reason?: string | null;
}

export interface OperationResult {
  status: 'applied' | 'rejected' | 'duplicate' | 'dry_run';
  op_id: string;
  record?: CanonicalRecord;
  inverse?: Operation;
  diff?: OperationDiff;
  reject_reason?: string;
}

export type OperationDiff = {
  before: CanonicalRecord | null;
  after: CanonicalRecord;
  changed_fields: string[];
};

export type ApplyOperationOptions = {
  dryRun?: boolean;
};
