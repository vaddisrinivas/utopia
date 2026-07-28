export type DecisionEvidence = readonly string[];

export type DecisionAudit = Readonly<{
  actor: string;
  evidence: DecisionEvidence;
  at: string;
}>;

export type DecisionApproval = DecisionAudit & Readonly<{
  id: string;
}>;

export type CompensationProposal<T> = Readonly<{
  id: string;
  reverses_decision_id: string;
  reverses_approval_id: string;
  status: 'proposed';
  proposal: T;
  reason: string;
  audit: DecisionAudit;
}>;

export type DecisionLedgerEntry<TOriginal, TCompensation = never> = Readonly<{
  schema_version: 'utopia.decision-ledger.v1';
  id: string;
  original: TOriginal;
  created: DecisionAudit;
  approval: DecisionApproval | null;
  compensations: readonly CompensationProposal<TCompensation>[];
}>;

type AuditInput = {
  actor: string;
  evidence: readonly string[];
  at?: string;
};

export function createDecision<TOriginal, TCompensation = TOriginal>(input: AuditInput & {
  id: string;
  original: TOriginal;
}): DecisionLedgerEntry<TOriginal, TCompensation> {
  const id = requiredText(input.id, 'decision id');
  const created = makeAudit(input);
  return immutable({
    schema_version: 'utopia.decision-ledger.v1',
    id,
    original: clone(input.original),
    created,
    approval: null,
    compensations: [],
  });
}

export function approveDecision<TOriginal, TCompensation>(
  decision: DecisionLedgerEntry<TOriginal, TCompensation>,
  input: AuditInput & { id: string },
): DecisionLedgerEntry<TOriginal, TCompensation> {
  if (decision.approval) {
    throw new Error(`Decision ${decision.id} is already approved by ${decision.approval.id}.`);
  }
  const approval = immutable({
    id: requiredText(input.id, 'approval id'),
    ...makeAudit(input),
  });
  return immutable({
    ...decision,
    approval,
    compensations: [...decision.compensations],
  });
}

export function proposeCompensation<TOriginal, TExistingCompensation, TCompensation>(
  decision: DecisionLedgerEntry<TOriginal, TExistingCompensation>,
  input: AuditInput & {
    id: string;
    proposal: TCompensation;
    reason: string;
  },
): DecisionLedgerEntry<TOriginal, TExistingCompensation | TCompensation> {
  if (!decision.approval) {
    throw new Error(`Decision ${decision.id} must be approved before compensation can be proposed.`);
  }
  const id = requiredText(input.id, 'compensation id');
  if (decision.compensations.some((compensation) => compensation.id === id)) {
    throw new Error(`Compensation ${id} already exists.`);
  }
  const compensation: CompensationProposal<TCompensation> = immutable({
    id,
    reverses_decision_id: decision.id,
    reverses_approval_id: decision.approval.id,
    status: 'proposed',
    proposal: clone(input.proposal),
    reason: requiredText(input.reason, 'compensation reason'),
    audit: makeAudit(input),
  });
  return immutable({
    ...decision,
    compensations: [
      ...decision.compensations,
      compensation,
    ] as readonly CompensationProposal<TExistingCompensation | TCompensation>[],
  });
}

function makeAudit(input: AuditInput): DecisionAudit {
  const actor = requiredText(input.actor, 'actor');
  const evidence = input.evidence
    .map((item) => item.trim())
    .filter(Boolean);
  if (evidence.length === 0) {
    throw new Error('At least one evidence reference is required.');
  }
  return immutable({
    actor,
    evidence: [...new Set(evidence)],
    at: input.at ? requiredText(input.at, 'audit timestamp') : new Date().toISOString(),
  });
}

function requiredText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    immutable(child);
  }
  return Object.freeze(value);
}
