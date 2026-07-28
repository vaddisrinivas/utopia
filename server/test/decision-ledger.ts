import {
  approveDecision,
  createDecision,
  proposeCompensation,
} from '../src/kernel/decision-ledger';

function ensure(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function expectThrow(run: () => unknown, match: string) {
  try {
    run();
  } catch (error) {
    ensure(error instanceof Error && error.message.includes(match), `Expected error containing "${match}".`);
    return;
  }
  throw new Error(`Expected error containing "${match}".`);
}

const inputOriginal = {
  policy: 'world-law',
  payload: {
    gravity: 0.8,
  },
};

expectThrow(
  () => createDecision({ id: 'decision-empty-actor', original: {}, actor: ' ', evidence: ['source:1'] }),
  'actor is required',
);
expectThrow(
  () => createDecision({ id: 'decision-empty-evidence', original: {}, actor: 'architect', evidence: [' '] }),
  'evidence reference',
);

const proposed = createDecision<typeof inputOriginal, { gravity: number }>({
  id: 'decision-1',
  original: inputOriginal,
  actor: 'architect',
  evidence: ['spec:world-law', 'spec:world-law'],
  at: '2026-07-23T00:00:00.000Z',
});

inputOriginal.payload.gravity = 9.8;
ensure(proposed.original.payload.gravity === 0.8, 'Original must be detached from mutable input.');
ensure(Object.isFrozen(proposed.original), 'Original must be immutable.');
ensure(Object.isFrozen(proposed.original.payload), 'Nested original values must be immutable.');
ensure(proposed.created.evidence.length === 1, 'Evidence references should be normalized and deduplicated.');

const approved = approveDecision(proposed, {
  id: 'approval-1',
  actor: 'governor',
  evidence: ['review:1'],
  at: '2026-07-23T00:01:00.000Z',
});

ensure(proposed.approval === null, 'Approval must not mutate the proposed decision.');
ensure(approved.approval?.actor === 'governor', 'Approval actor must be recorded.');
ensure(approved.original === proposed.original, 'Approval must preserve the immutable original.');
expectThrow(
  () => approveDecision(approved, { id: 'approval-2', actor: 'governor', evidence: ['review:2'] }),
  'already approved',
);

expectThrow(
  () => proposeCompensation(proposed, {
    id: 'compensation-too-early',
    proposal: { gravity: 1 },
    reason: 'Restore baseline.',
    actor: 'operator',
    evidence: ['incident:1'],
  }),
  'must be approved',
);

const compensationInput = { gravity: 1 };
const compensated = proposeCompensation(approved, {
  id: 'compensation-1',
  proposal: compensationInput,
  reason: 'Restore baseline gravity.',
  actor: 'operator',
  evidence: ['incident:1'],
  at: '2026-07-23T00:02:00.000Z',
});

compensationInput.gravity = 2;
const compensation = compensated.compensations[0];
ensure(approved.compensations.length === 0, 'Compensation must not mutate the approved decision.');
ensure(compensation.status === 'proposed', 'Compensation must remain a proposal.');
ensure(compensation.reverses_decision_id === approved.id, 'Compensation must reference the original decision.');
ensure(compensation.reverses_approval_id === approved.approval?.id, 'Compensation must reference the approval.');
ensure(compensation.proposal.gravity === 1, 'Compensation proposal must be detached from mutable input.');
ensure(compensated.original === approved.original, 'Compensation must preserve the immutable original.');
expectThrow(
  () => proposeCompensation(compensated, {
    id: 'compensation-1',
    proposal: { gravity: 1 },
    reason: 'Duplicate.',
    actor: 'operator',
    evidence: ['incident:2'],
  }),
  'already exists',
);

console.log('PASS server/test/decision-ledger.ts');
