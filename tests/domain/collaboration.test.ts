import { describe, expect, it } from 'vitest';

import {
  appendCollaborationEventAtomically,
  authorizeAndAppendCollaborationEvent,
  createCollaborationState,
  ensureCollaborationTables,
  loadCollaborationState,
} from '@/src/domain/collaboration';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('collaboration domain', () => {
  it('enforces invite, accept, role, and epoch policy before append in pure state', () => {
    const seeded = createCollaborationState({
      spaceId: 'space-a',
      ownerId: 'owner-1',
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    const invited = authorizeAndAppendCollaborationEvent(seeded, {
      actorId: 'owner-1',
      at: '2026-07-28T00:01:00.000Z',
      eventId: 'event-1',
      idempotencyKey: 'idem-1',
      expectedHead: 0,
      action: {
        kind: 'invite_created',
        inviteId: 'invite-1',
        inviteeId: 'editor-1',
        role: 'editor',
        expiresAt: '2026-07-28T01:00:00.000Z',
      },
    });
    expect(invited.state.invites['invite-1']).toMatchObject({
      epoch: 1,
      status: 'pending',
      role: 'editor',
    });

    const accepted = authorizeAndAppendCollaborationEvent(invited.state, {
      actorId: 'editor-1',
      at: '2026-07-28T00:02:00.000Z',
      eventId: 'event-2',
      idempotencyKey: 'idem-2',
      expectedHead: 1,
      action: {
        kind: 'invite_accepted',
        inviteId: 'invite-1',
      },
    });
    expect(accepted.state.members['editor-1']?.role).toBe('editor');

    const viewerInvite = authorizeAndAppendCollaborationEvent(accepted.state, {
      actorId: 'editor-1',
      at: '2026-07-28T00:03:00.000Z',
      eventId: 'event-3',
      idempotencyKey: 'idem-3',
      expectedHead: 2,
      action: {
        kind: 'invite_created',
        inviteId: 'invite-2',
        inviteeId: 'viewer-1',
        role: 'viewer',
      },
    });
    expect(viewerInvite.state.invites['invite-2']?.invitedBy).toBe('editor-1');

    const rotated = authorizeAndAppendCollaborationEvent(viewerInvite.state, {
      actorId: 'owner-1',
      at: '2026-07-28T00:04:00.000Z',
      eventId: 'event-4',
      idempotencyKey: 'idem-4',
      expectedHead: 3,
      action: { kind: 'epoch_rotated' },
    });
    expect(rotated.state.epoch).toBe(2);
    expect(rotated.state.invites['invite-2']?.status).toBe('superseded');

    expect(() => authorizeAndAppendCollaborationEvent(rotated.state, {
      actorId: 'editor-1',
      at: '2026-07-28T00:05:00.000Z',
      eventId: 'event-5',
      idempotencyKey: 'idem-5',
      expectedHead: 4,
      action: {
        kind: 'invite_created',
        inviteId: 'invite-3',
        inviteeId: 'editor-2',
        role: 'editor',
      },
    })).toThrow(/forbidden/);

    expect(() => authorizeAndAppendCollaborationEvent(rotated.state, {
      actorId: 'viewer-1',
      at: '2026-07-28T00:05:00.000Z',
      eventId: 'event-6',
      idempotencyKey: 'idem-6',
      expectedHead: 4,
      action: {
        kind: 'invite_accepted',
        inviteId: 'invite-2',
      },
    })).toThrow(/not_pending|epoch_stale/);
  });

  it('does atomic authorize plus append in local sqlite and replays idempotently', async () => {
    const db = new NodeSqliteDb() as any;
    await ensureCollaborationTables(db);

    const input = {
      spaceId: 'space-db',
      ownerId: 'owner-1',
      createdAt: '2026-07-28T00:00:00.000Z',
      request: {
        actorId: 'owner-1',
        at: '2026-07-28T00:01:00.000Z',
        eventId: 'event-db-1',
        idempotencyKey: 'idem-db-1',
        expectedHead: 0,
        action: {
          kind: 'invite_created' as const,
          inviteId: 'invite-db-1',
          inviteeId: 'viewer-1',
          role: 'viewer' as const,
        },
      },
    };

    const first = await appendCollaborationEventAtomically(db, input);
    const second = await appendCollaborationEventAtomically(db, input);
    expect(second.event.eventHash).toBe(first.event.eventHash);

    await appendCollaborationEventAtomically(db, {
      ...input,
      request: {
        actorId: 'viewer-1',
        at: '2026-07-28T00:02:00.000Z',
        eventId: 'event-db-2',
        idempotencyKey: 'idem-db-2',
        expectedHead: 1,
        action: {
          kind: 'invite_accepted',
          inviteId: 'invite-db-1',
        },
      },
    });

    const loaded = await loadCollaborationState(db, {
      spaceId: 'space-db',
      ownerId: 'owner-1',
      createdAt: '2026-07-28T00:00:00.000Z',
    });
    expect(loaded.head).toBe(2);
    expect(loaded.members['viewer-1']?.role).toBe('viewer');

    await expect(appendCollaborationEventAtomically(db, {
      ...input,
      request: {
        actorId: 'viewer-1',
        at: '2026-07-28T00:03:00.000Z',
        eventId: 'event-db-3',
        idempotencyKey: 'idem-db-3',
        expectedHead: 2,
        action: {
          kind: 'member_removed',
          memberId: 'owner-1',
        },
      },
    })).rejects.toThrow(/forbidden/);

    db.close();
  });
});
