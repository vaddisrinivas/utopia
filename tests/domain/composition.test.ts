import { describe, expect, it } from 'vitest';

import {
  applyApprovedCompositionProposal,
  approveCompositionProposal,
  buildCompositionRuntime,
  createCompositionCapabilitySchema,
  createCompositionGrant,
  createCompositionState,
  submitCompositionProposal,
} from '@/src/domain/composition';

describe('composition domain', () => {
  it('builds a read-only runtime from capability grants', () => {
    const capability = createCompositionCapabilitySchema({
      capabilityId: 'recipe.board',
      label: 'Recipe board',
      actions: ['read', 'propose_write'],
    });
    const readGrant = createCompositionGrant(capability, {
      grantId: 'grant-read',
      subjectId: 'viewer-1',
      mode: 'read',
      grantedBy: 'owner-1',
      grantedAt: '2026-07-28T00:00:00.000Z',
    });
    const state = createCompositionState({
      compositionId: 'composition-a',
      payload: {
        sections: [{ id: 'ideas', title: 'Ideas' }],
      },
      capabilities: [capability],
      grants: [readGrant],
    });

    const runtime = buildCompositionRuntime(state, {
      subjectId: 'viewer-1',
      at: '2026-07-28T00:01:00.000Z',
    });

    expect(runtime.mode).toBe('read_only');
    expect(runtime.capabilities).toEqual(['recipe.board']);
    expect(runtime.canProposeWrite).toBe(false);
    expect(Object.isFrozen(runtime.snapshot)).toBe(true);
  });

  it('allows proposal-only writes with approval binding', () => {
    const capability = createCompositionCapabilitySchema({
      capabilityId: 'recipe.board',
      label: 'Recipe board',
      actions: ['read', 'propose_write'],
    });
    const writeGrant = createCompositionGrant(capability, {
      grantId: 'grant-write',
      subjectId: 'editor-1',
      mode: 'propose_write',
      grantedBy: 'owner-1',
      grantedAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-07-28T01:00:00.000Z',
    });
    const state = createCompositionState({
      compositionId: 'composition-b',
      payload: {
        sections: [{ id: 'ideas', title: 'Ideas' }],
      },
      capabilities: [capability],
      grants: [writeGrant],
    });

    const proposed = submitCompositionProposal(state, {
      proposalId: 'proposal-1',
      capabilityId: 'recipe.board',
      grantId: 'grant-write',
      requestedBy: 'editor-1',
      requestedAt: '2026-07-28T00:02:00.000Z',
      justification: 'Add approved prep lane',
      operations: [
        {
          op: 'add',
          path: '/sections/1',
          value: { id: 'prep', title: 'Prep' },
        },
      ],
    });
    expect(proposed.proposal.baseRevision).toBe(state.revision);

    const approval = approveCompositionProposal(proposed.state, proposed.proposal, {
      approvedBy: 'owner-1',
      approvedAt: '2026-07-28T00:03:00.000Z',
      expiresAt: '2026-07-28T00:30:00.000Z',
      nonce: 'nonce-1',
    });
    expect(approval.proposalHash).toBe(proposed.proposal.proposalHash);

    const applied = applyApprovedCompositionProposal(proposed.state, proposed.proposal, approval);
    expect((applied.state.payload.sections as Array<{ id: string }>).map((section) => section.id)).toEqual(['ideas', 'prep']);
    expect(applied.state.pendingProposals).toEqual({});
    expect(applied.state.consumedApprovals['nonce-1']?.proposalHash).toBe(proposed.proposal.proposalHash);

    expect(() => applyApprovedCompositionProposal(applied.state, proposed.proposal, approval)).toThrow(/replayed|missing/);
  });
});
