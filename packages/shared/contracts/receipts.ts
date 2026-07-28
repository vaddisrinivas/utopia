export type ReactiveProposalVerificationReceipt = Readonly<{
  ok: boolean;
  verifierVersion: 'wonder.reactive-proposal-verifier.v1';
  actionId: string;
  operationId: string;
  proposalId: string;
  operationTemplateHash: string;
  recordId: string | null;
  expected: Record<string, unknown>;
  observed: Record<string, unknown> | null;
  resultingRevision: number | null;
  providerWriteback?: ReactiveProviderWritebackReceipt;
  reason: string;
}>;

export type ReactiveProviderWritebackReceipt = Readonly<{
  ok: boolean;
  provider: 'notion' | 'google_sheets';
  operation: 'create_record' | 'update_record' | 'archive_record';
  providerRecordId: string | null;
  sourceSnapshotHash: string;
  sourceSnapshot: Record<string, unknown>;
  readbackSnapshotHash: string;
  readbackSnapshot: Record<string, unknown>;
  reason: string;
}>;

export type ReactiveProposalApprovalReceipt = Readonly<{
  schemaVersion: 'wonder.reactive-proposal-approval.v1';
  approver: string;
  authority: string;
  proposalId: string;
  idempotencyKey: string;
  operationId: string;
  operationHash: string;
  proposalHash: string;
  operationTemplateHash: string;
  localActor: string;
  approvedAt: string;
  expiresAt?: string;
  revoked?: boolean;
}>;

export type ReactiveProposalExecutionReceipt = Readonly<{
  actionId: string;
  idempotencyKey: string;
  replayed: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'undone' | 'undo_failed';
  verification?: ReactiveProposalVerificationReceipt;
}>;
