import type { DatabasePort as SQLiteDatabase } from '@/src/domain/database-port';

import { sha256Canonical } from '@/src/domain/canonical-json';

export const COLLABORATION_STATE_SCHEMA_VERSION = 'wonder.collaboration.state.v1' as const;
export const COLLABORATION_EVENT_SCHEMA_VERSION = 'wonder.collaboration.event.v1' as const;

const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const;
const INVITE_STATUSES = ['pending', 'accepted', 'declined', 'revoked', 'superseded'] as const;

export type CollaborationRole = typeof MEMBER_ROLES[number];
export type CollaborationInviteStatus = typeof INVITE_STATUSES[number];

export type CollaborationMember = Readonly<{
  memberId: string;
  role: CollaborationRole;
  joinedAt: string;
  invitedBy: string | null;
}>;

export type CollaborationInvite = Readonly<{
  inviteId: string;
  inviteeId: string;
  role: Exclude<CollaborationRole, 'owner'>;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string | null;
  epoch: number;
  status: CollaborationInviteStatus;
  respondedAt: string | null;
}>;

export type CollaborationState = Readonly<{
  schemaVersion: typeof COLLABORATION_STATE_SCHEMA_VERSION;
  spaceId: string;
  epoch: number;
  head: number;
  members: Record<string, CollaborationMember>;
  invites: Record<string, CollaborationInvite>;
}>;

export type CollaborationEventAction =
  | Readonly<{
      kind: 'invite_created';
      inviteId: string;
      inviteeId: string;
      role: Exclude<CollaborationRole, 'owner'>;
      expiresAt?: string | null;
    }>
  | Readonly<{
      kind: 'invite_revoked';
      inviteId: string;
    }>
  | Readonly<{
      kind: 'invite_accepted';
      inviteId: string;
    }>
  | Readonly<{
      kind: 'invite_declined';
      inviteId: string;
    }>
  | Readonly<{
      kind: 'member_role_set';
      memberId: string;
      role: Exclude<CollaborationRole, 'owner'>;
    }>
  | Readonly<{
      kind: 'member_removed';
      memberId: string;
    }>
  | Readonly<{
      kind: 'epoch_rotated';
    }>;

export type CollaborationEvent = Readonly<{
  schemaVersion: typeof COLLABORATION_EVENT_SCHEMA_VERSION;
  eventId: string;
  spaceId: string;
  seq: number;
  actorId: string;
  at: string;
  idempotencyKey: string;
  action: CollaborationEventAction;
  eventHash: string;
}>;

export type CollaborationAppendRequest = Readonly<{
  actorId: string;
  at: string;
  eventId: string;
  idempotencyKey: string;
  expectedHead?: number;
  action: CollaborationEventAction;
}>;

export type CollaborationAppendResult = Readonly<{
  state: CollaborationState;
  event: CollaborationEvent;
}>;

type CollaborationRow = {
  seq: number | string;
  event_json: string;
};

export function createCollaborationState(input: {
  spaceId: string;
  ownerId: string;
  createdAt: string;
}): CollaborationState {
  const spaceId = text(input.spaceId);
  const ownerId = text(input.ownerId);
  assertIso(input.createdAt, 'collaboration_created_at_invalid');
  if (!spaceId) throw new Error('collaboration_space_required');
  if (!ownerId) throw new Error('collaboration_owner_required');
  return {
    schemaVersion: COLLABORATION_STATE_SCHEMA_VERSION,
    spaceId,
    epoch: 1,
    head: 0,
    members: {
      [ownerId]: {
        memberId: ownerId,
        role: 'owner',
        joinedAt: input.createdAt,
        invitedBy: null,
      },
    },
    invites: {},
  };
}

export function authorizeCollaborationEvent(
  state: CollaborationState,
  request: CollaborationAppendRequest,
): CollaborationEvent {
  assertStateScope(state, request);
  if (request.expectedHead != null && request.expectedHead !== state.head) {
    throw new Error('collaboration_head_moved');
  }
  const actorId = text(request.actorId);
  const eventId = text(request.eventId);
  const idempotencyKey = text(request.idempotencyKey);
  if (!actorId) throw new Error('collaboration_actor_required');
  if (!eventId) throw new Error('collaboration_event_id_required');
  if (!idempotencyKey) throw new Error('collaboration_idempotency_key_required');
  assertIso(request.at, 'collaboration_time_invalid');
  assertPolicy(state, request);
  const draft = {
    schemaVersion: COLLABORATION_EVENT_SCHEMA_VERSION,
    eventId,
    spaceId: state.spaceId,
    seq: state.head + 1,
    actorId,
    at: request.at,
    idempotencyKey,
    action: request.action,
  } as const;
  return {
    ...draft,
    eventHash: hashValue(draft),
  };
}

export function applyCollaborationEvent(
  state: CollaborationState,
  event: CollaborationEvent,
): CollaborationState {
  if (event.spaceId !== state.spaceId) throw new Error('collaboration_space_mismatch');
  if (event.seq !== state.head + 1) throw new Error('collaboration_seq_invalid');
  const members = { ...state.members };
  const invites = { ...state.invites };
  switch (event.action.kind) {
    case 'invite_created': {
      invites[event.action.inviteId] = {
        inviteId: event.action.inviteId,
        inviteeId: event.action.inviteeId,
        role: event.action.role,
        invitedBy: event.actorId,
        invitedAt: event.at,
        expiresAt: event.action.expiresAt ?? null,
        epoch: state.epoch,
        status: 'pending',
        respondedAt: null,
      };
      break;
    }
    case 'invite_revoked': {
      const invite = invites[event.action.inviteId];
      invites[event.action.inviteId] = { ...invite, status: 'revoked', respondedAt: event.at };
      break;
    }
    case 'invite_declined': {
      const invite = invites[event.action.inviteId];
      invites[event.action.inviteId] = { ...invite, status: 'declined', respondedAt: event.at };
      break;
    }
    case 'invite_accepted': {
      const invite = invites[event.action.inviteId];
      invites[event.action.inviteId] = { ...invite, status: 'accepted', respondedAt: event.at };
      members[invite.inviteeId] = {
        memberId: invite.inviteeId,
        role: invite.role,
        joinedAt: event.at,
        invitedBy: invite.invitedBy,
      };
      break;
    }
    case 'member_role_set': {
      const member = members[event.action.memberId];
      members[event.action.memberId] = { ...member, role: event.action.role };
      break;
    }
    case 'member_removed': {
      delete members[event.action.memberId];
      break;
    }
    case 'epoch_rotated': {
      for (const invite of Object.values(invites)) {
        if (invite.status === 'pending') {
          invites[invite.inviteId] = { ...invite, status: 'superseded', respondedAt: event.at };
        }
      }
      return {
        ...state,
        epoch: state.epoch + 1,
        head: event.seq,
        invites,
        members,
      };
    }
  }
  return {
    ...state,
    head: event.seq,
    invites,
    members,
  };
}

export function authorizeAndAppendCollaborationEvent(
  state: CollaborationState,
  request: CollaborationAppendRequest,
): CollaborationAppendResult {
  const event = authorizeCollaborationEvent(state, request);
  return {
    event,
    state: applyCollaborationEvent(state, event),
  };
}

export async function ensureCollaborationTables(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS collaboration_events (
      space_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      event_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (space_id, seq),
      UNIQUE (space_id, event_id),
      UNIQUE (space_id, idempotency_key)
    );
  `);
}

export async function loadCollaborationState(
  db: SQLiteDatabase,
  input: {
    spaceId: string;
    ownerId: string;
    createdAt: string;
  },
): Promise<CollaborationState> {
  const rows = await db.getAllAsync<CollaborationRow>(
    `SELECT seq, event_json
       FROM collaboration_events
      WHERE space_id = ?
      ORDER BY seq ASC`,
    [input.spaceId],
  );
  return rows.reduce(
    (current, row) => applyCollaborationEvent(current, parseJson<CollaborationEvent>(row.event_json)),
    createCollaborationState(input),
  );
}

export async function appendCollaborationEventAtomically(
  db: SQLiteDatabase,
  input: {
    spaceId: string;
    ownerId: string;
    createdAt: string;
    request: CollaborationAppendRequest;
  },
): Promise<CollaborationAppendResult> {
  let result: CollaborationAppendResult | null = null;
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ event_json: string }>(
      'SELECT event_json FROM collaboration_events WHERE space_id = ? AND idempotency_key = ?',
      [input.spaceId, input.request.idempotencyKey],
    );
    if (existing) {
      const state = await loadCollaborationState(db, input);
      result = {
        state,
        event: parseJson<CollaborationEvent>(existing.event_json),
      };
      return;
    }
    const state = await loadCollaborationState(db, input);
    const appended = authorizeAndAppendCollaborationEvent(state, input.request);
    await db.runAsync(
      `INSERT INTO collaboration_events
        (space_id, seq, event_id, idempotency_key, event_hash, created_at, actor_id, event_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.spaceId,
        appended.event.seq,
        appended.event.eventId,
        appended.event.idempotencyKey,
        appended.event.eventHash,
        appended.event.at,
        appended.event.actorId,
        JSON.stringify(appended.event),
      ],
    );
    result = appended;
  });
  if (!result) throw new Error('collaboration_append_failed');
  return result;
}

function assertPolicy(state: CollaborationState, request: CollaborationAppendRequest) {
  const actor = state.members[request.actorId];
  switch (request.action.kind) {
    case 'invite_created': {
      requireInviteRole(request.action.role);
      if (!actor) throw new Error('collaboration_actor_not_member');
      if (actor.role === 'viewer') throw new Error('collaboration_forbidden');
      if (actor.role === 'editor' && request.action.role !== 'viewer') throw new Error('collaboration_forbidden');
      if (state.members[request.action.inviteeId]) throw new Error('collaboration_member_exists');
      const existing = state.invites[request.action.inviteId];
      if (existing && existing.status === 'pending') throw new Error('collaboration_invite_exists');
      if (request.action.expiresAt != null) assertIso(request.action.expiresAt, 'collaboration_invite_expiry_invalid');
      return;
    }
    case 'invite_revoked': {
      const invite = requireInvite(state, request.action.inviteId);
      if (invite.status !== 'pending') throw new Error('collaboration_invite_not_pending');
      if (!actor) throw new Error('collaboration_actor_not_member');
      if (actor.role !== 'owner' && invite.invitedBy !== request.actorId) throw new Error('collaboration_forbidden');
      return;
    }
    case 'invite_accepted':
    case 'invite_declined': {
      const invite = requireInvite(state, request.action.inviteId);
      if (invite.inviteeId !== request.actorId) throw new Error('collaboration_invite_actor_mismatch');
      if (invite.status !== 'pending') throw new Error('collaboration_invite_not_pending');
      if (invite.epoch !== state.epoch) throw new Error('collaboration_invite_epoch_stale');
      if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.parse(request.at)) {
        throw new Error('collaboration_invite_expired');
      }
      return;
    }
    case 'member_role_set': {
      if (!actor || actor.role !== 'owner') throw new Error('collaboration_forbidden');
      const member = state.members[request.action.memberId];
      if (!member) throw new Error('collaboration_member_missing');
      if (member.role === 'owner') throw new Error('collaboration_owner_role_locked');
      return;
    }
    case 'member_removed': {
      if (!actor || actor.role !== 'owner') throw new Error('collaboration_forbidden');
      const member = state.members[request.action.memberId];
      if (!member) throw new Error('collaboration_member_missing');
      if (member.role === 'owner') throw new Error('collaboration_owner_role_locked');
      return;
    }
    case 'epoch_rotated': {
      if (!actor || actor.role !== 'owner') throw new Error('collaboration_forbidden');
    }
  }
}

function requireInvite(state: CollaborationState, inviteId: string): CollaborationInvite {
  const invite = state.invites[inviteId];
  if (!invite) throw new Error('collaboration_invite_missing');
  return invite;
}

function requireInviteRole(role: string): asserts role is Exclude<CollaborationRole, 'owner'> {
  if (role !== 'editor' && role !== 'viewer') throw new Error('collaboration_invite_role_invalid');
}

function assertStateScope(state: CollaborationState, request: CollaborationAppendRequest) {
  if (state.schemaVersion !== COLLABORATION_STATE_SCHEMA_VERSION) throw new Error('collaboration_state_schema_invalid');
  if (!state.spaceId.trim()) throw new Error('collaboration_space_required');
  if (Number.isNaN(state.epoch) || state.epoch < 1) throw new Error('collaboration_epoch_invalid');
  if (Number.isNaN(state.head) || state.head < 0) throw new Error('collaboration_head_invalid');
  if (!request.action.kind) throw new Error('collaboration_action_required');
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}

function text(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function assertIso(value: string, errorCode: string) {
  if (Number.isNaN(Date.parse(value))) throw new Error(errorCode);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
