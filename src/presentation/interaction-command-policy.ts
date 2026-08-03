export const AUTOSAVE_MODES = ['manual', 'blur', 'change'] as const;
export type AutosaveMode = (typeof AUTOSAVE_MODES)[number];

export const OFFLINE_BEHAVIORS = ['block', 'queue', 'local'] as const;
export type OfflineBehavior = (typeof OFFLINE_BEHAVIORS)[number];

export const VALIDATION_MODES = ['none', 'submit', 'change'] as const;
export type ValidationMode = (typeof VALIDATION_MODES)[number];

export const DRAFT_SCOPES = ['memory', 'local'] as const;
export type DraftScope = (typeof DRAFT_SCOPES)[number];

export const COMMAND_STATUSES = [
  'pending',
  'saved',
  'error',
  'queued',
  'undone',
  'cancelled',
] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export type AccessibleStatus = {
  status: CommandStatus;
  message: string;
  live: 'off' | 'polite' | 'assertive';
};

export const DESTRUCTIVE_INTENTS = [
  'delete',
  'archive',
  'clear',
  'remove',
  'deactivate',
  'purge',
] as const;
export type DestructiveIntent = (typeof DESTRUCTIVE_INTENTS)[number];

export const COMMAND_INTENTS = [
  ...DESTRUCTIVE_INTENTS,
  'create',
  'update',
  'complete',
  'duplicate',
  'reorder',
  'toggle',
  'undo',
  'open',
  'other',
] as const;
export type InteractionCommandIntent = (typeof COMMAND_INTENTS)[number];

export type NormalizedInteractionIntent = {
  kind: InteractionCommandIntent;
  destructive: boolean;
  subject?: string;
};

export type OfflineConnectivity = {
  online: boolean;
  queuedCount?: number;
};

export type OfflineExecutionProjection = {
  status: CommandStatus;
  canExecute: boolean;
  live: 'off' | 'polite' | 'assertive';
  message: string;
  queuedCount: number;
};

export type SaveOutcomeProjection = OfflineExecutionProjection;

export type UndoEligibility = {
  available: boolean;
  reason: string;
  remainingMs: number;
};

export type ConfirmationAdvice = {
  required: boolean;
  message: string;
};

export type NormalizedInteractionCommandPolicy = {
  autosave: AutosaveMode;
  optimistic: boolean;
  undo: {
    enabled: boolean;
    windowMs: number;
  };
  confirmation: {
    required: boolean;
    message: string;
  };
  offline: OfflineBehavior;
  validation: {
    mode: ValidationMode;
    requiredFields: readonly string[];
  };
  draftPersistence: {
    enabled: boolean;
    scope: DraftScope;
  };
  restartRecovery: {
    enabled: boolean;
    maxAgeMs: number;
  };
  accessibleStatus: {
    enabled: boolean;
    labels: Readonly<Record<CommandStatus, string>>;
  };
};

export type InteractionCommandPolicyInput = {
  autosave?: unknown;
  optimistic?: unknown;
  undo?: unknown;
  confirmation?: unknown;
  offline?: unknown;
  validation?: unknown;
  draftPersistence?: unknown;
  restartRecovery?: unknown;
  accessibleStatus?: unknown;
};

export type CommandState = {
  id: string;
  status: CommandStatus;
  revision: number;
  updatedAt: number;
  error?: string;
};

type TransitionEvent =
  | { type: 'pending'; at: number }
  | { type: 'saved'; at: number }
  | { type: 'error'; at: number; message: string }
  | { type: 'queued'; at: number }
  | { type: 'undone'; at: number }
  | { type: 'cancelled'; at: number };

const DEFAULT_STATUS_LABELS: Record<CommandStatus, string> = {
  pending: 'Saving',
  saved: 'Saved',
  error: 'Save failed',
  queued: 'Queued for later',
  undone: 'Undone',
  cancelled: 'Cancelled',
};

const ALLOWED_TRANSITIONS: Readonly<Record<CommandStatus, readonly CommandStatus[]>> = {
  pending: ['pending', 'saved', 'error', 'queued', 'cancelled'],
  saved: ['saved', 'pending', 'undone', 'cancelled'],
  error: ['error', 'pending', 'cancelled'],
  queued: ['queued', 'pending', 'saved', 'error', 'cancelled'],
  undone: ['undone', 'pending'],
  cancelled: ['cancelled'],
};

function fail(path: string, message: string): never {
  throw new TypeError(`Invalid interaction command policy at ${path}: ${message}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown value');
  }
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail(path, `expected one of ${values.join(', ')}`);
  }
  return value as T;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(path, 'expected a non-negative safe integer');
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail(path, 'expected a positive safe integer');
  return parsed;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'expected a non-empty string');
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  const result = value.map((item, index) => stringValue(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
  return result;
}

function normalizeAutosave(value: unknown): AutosaveMode {
  if (value === undefined) return 'manual';
  if (typeof value === 'string') return enumValue(value, AUTOSAVE_MODES, 'autosave');
  const object = asRecord(value, 'autosave');
  assertKnownKeys(object, ['mode'], 'autosave');
  return enumValue(object.mode, AUTOSAVE_MODES, 'autosave.mode');
}

function normalizeBooleanOption(value: unknown, path: string, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  const object = asRecord(value, path);
  assertKnownKeys(object, ['enabled'], path);
  return booleanValue(object.enabled, `${path}.enabled`);
}

function normalizeUndo(value: unknown): NormalizedInteractionCommandPolicy['undo'] {
  if (value === undefined) return { enabled: false, windowMs: 5_000 };
  if (typeof value === 'boolean') return { enabled: value, windowMs: 5_000 };
  const object = asRecord(value, 'undo');
  assertKnownKeys(object, ['enabled', 'windowMs'], 'undo');
  return {
    enabled: object.enabled === undefined ? false : booleanValue(object.enabled, 'undo.enabled'),
    windowMs: object.windowMs === undefined ? 5_000 : positiveInteger(object.windowMs, 'undo.windowMs'),
  };
}

function normalizeConfirmation(value: unknown): NormalizedInteractionCommandPolicy['confirmation'] {
  if (value === undefined) return { required: false, message: 'Are you sure?' };
  if (typeof value === 'boolean') return { required: value, message: 'Are you sure?' };
  const object = asRecord(value, 'confirmation');
  assertKnownKeys(object, ['required', 'message'], 'confirmation');
  return {
    required: object.required === undefined ? false : booleanValue(object.required, 'confirmation.required'),
    message: object.message === undefined ? 'Are you sure?' : stringValue(object.message, 'confirmation.message'),
  };
}

function normalizeValidation(value: unknown): NormalizedInteractionCommandPolicy['validation'] {
  if (value === undefined) return { mode: 'none', requiredFields: [] };
  const object = asRecord(value, 'validation');
  assertKnownKeys(object, ['mode', 'requiredFields'], 'validation');
  return {
    mode: object.mode === undefined ? 'none' : enumValue(object.mode, VALIDATION_MODES, 'validation.mode'),
    requiredFields: object.requiredFields === undefined ? [] : stringArray(object.requiredFields, 'validation.requiredFields'),
  };
}

function normalizeDraftPersistence(value: unknown): NormalizedInteractionCommandPolicy['draftPersistence'] {
  if (value === undefined) return { enabled: false, scope: 'memory' };
  if (typeof value === 'boolean') return { enabled: value, scope: 'memory' };
  const object = asRecord(value, 'draftPersistence');
  assertKnownKeys(object, ['enabled', 'scope'], 'draftPersistence');
  return {
    enabled: object.enabled === undefined ? false : booleanValue(object.enabled, 'draftPersistence.enabled'),
    scope: object.scope === undefined ? 'memory' : enumValue(object.scope, DRAFT_SCOPES, 'draftPersistence.scope'),
  };
}

function normalizeRestartRecovery(value: unknown): NormalizedInteractionCommandPolicy['restartRecovery'] {
  if (value === undefined) return { enabled: false, maxAgeMs: 86_400_000 };
  if (typeof value === 'boolean') return { enabled: value, maxAgeMs: 86_400_000 };
  const object = asRecord(value, 'restartRecovery');
  assertKnownKeys(object, ['enabled', 'maxAgeMs'], 'restartRecovery');
  return {
    enabled: object.enabled === undefined ? false : booleanValue(object.enabled, 'restartRecovery.enabled'),
    maxAgeMs: object.maxAgeMs === undefined ? 86_400_000 : positiveInteger(object.maxAgeMs, 'restartRecovery.maxAgeMs'),
  };
}

function normalizeAccessibleStatus(value: unknown): NormalizedInteractionCommandPolicy['accessibleStatus'] {
  if (value === undefined) return { enabled: true, labels: { ...DEFAULT_STATUS_LABELS } };
  if (typeof value === 'boolean') return { enabled: value, labels: { ...DEFAULT_STATUS_LABELS } };
  const object = asRecord(value, 'accessibleStatus');
  assertKnownKeys(object, ['enabled', 'labels'], 'accessibleStatus');
  const labels = { ...DEFAULT_STATUS_LABELS };
  if (object.labels !== undefined) {
    const labelObject = asRecord(object.labels, 'accessibleStatus.labels');
    assertKnownKeys(labelObject, COMMAND_STATUSES, 'accessibleStatus.labels');
    for (const status of COMMAND_STATUSES) {
      if (labelObject[status] !== undefined) labels[status] = stringValue(labelObject[status], `accessibleStatus.labels.${status}`);
    }
  }
  return {
    enabled: object.enabled === undefined ? true : booleanValue(object.enabled, 'accessibleStatus.enabled'),
    labels,
  };
}

export function normalizeInteractionCommandPolicy(
  input: InteractionCommandPolicyInput = {},
): NormalizedInteractionCommandPolicy {
  const object = asRecord(input, 'policy');
  assertKnownKeys(object, [
    'autosave',
    'optimistic',
    'undo',
    'confirmation',
    'offline',
    'validation',
    'draftPersistence',
    'restartRecovery',
    'accessibleStatus',
  ], 'policy');
  return {
    autosave: normalizeAutosave(object.autosave),
    optimistic: object.optimistic === undefined ? false : booleanValue(object.optimistic, 'optimistic'),
    undo: normalizeUndo(object.undo),
    confirmation: normalizeConfirmation(object.confirmation),
    offline: object.offline === undefined ? 'block' : enumValue(object.offline, OFFLINE_BEHAVIORS, 'offline'),
    validation: normalizeValidation(object.validation),
    draftPersistence: normalizeDraftPersistence(object.draftPersistence),
    restartRecovery: normalizeRestartRecovery(object.restartRecovery),
    accessibleStatus: normalizeAccessibleStatus(object.accessibleStatus),
  };
}

export function createCommandState(id: string, at = 0): CommandState {
  return { id: stringValue(id, 'id'), status: 'pending', revision: 0, updatedAt: nonNegativeInteger(at, 'at') };
}

export function transitionCommandState(state: CommandState, event: TransitionEvent): CommandState {
  if (!COMMAND_STATUSES.includes(state.status) || !Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new TypeError('Invalid command state');
  }
  if (!Number.isSafeInteger(event.at) || event.at < 0) throw new TypeError('Invalid command transition time');
  if (!ALLOWED_TRANSITIONS[state.status].includes(event.type)) {
    throw new Error(`Invalid command transition: ${state.status} -> ${event.type}`);
  }
  if (event.at < state.updatedAt) throw new Error('Command transition time must not move backwards');
  const next: CommandState = {
    id: state.id,
    status: event.type,
    revision: state.revision + 1,
    updatedAt: event.at,
  };
  if (event.type === 'error') next.error = stringValue(event.message, 'event.message');
  return next;
}

export function normalizeIntent(raw: unknown): NormalizedInteractionIntent {
  const intent = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const kind = (COMMAND_INTENTS as readonly string[]).includes(intent)
    ? (intent as InteractionCommandIntent)
    : 'other';
  return {
    kind,
    destructive: (DESTRUCTIVE_INTENTS as readonly string[]).includes(intent),
    subject: intent || undefined,
  };
}

export function confirmationAdvice(
  policy: NormalizedInteractionCommandPolicy,
  intent: NormalizedInteractionIntent,
  options: { subject?: string } = {},
): ConfirmationAdvice {
  const required = policy.confirmation.required || (intent.destructive && policy.confirmation.required);
  const subject = options.subject ?? intent.subject;
  const message = subject
    ? `${policy.confirmation.message} ${subject}?`
    : policy.confirmation.message;
  return { required, message };
}

export function offlineExecutionProjection(
  policy: NormalizedInteractionCommandPolicy,
  network: OfflineConnectivity,
): OfflineExecutionProjection {
  const queuedCount = Math.max(0, network.queuedCount ?? 0);
  if (network.online) {
    return {
      status: 'pending',
      canExecute: true,
      live: 'off',
      message: 'Online',
      queuedCount: 0,
    };
  }
  if (policy.offline === 'block') {
    return {
      status: 'error',
      canExecute: false,
      live: 'assertive',
      message: 'Offline actions blocked by package policy.',
      queuedCount,
    };
  }
  return {
    status: 'queued',
    canExecute: true,
    live: 'polite',
    message: policy.offline === 'local'
      ? 'Saved locally and queued locally.'
      : 'Queued for sync when network returns.',
    queuedCount: policy.offline === 'queue' ? queuedCount : 0,
  };
}

export function saveOutcomeProjection(
  policy: NormalizedInteractionCommandPolicy,
  network: OfflineConnectivity,
): SaveOutcomeProjection {
  const offline = offlineExecutionProjection(policy, network);
  if (!network.online) {
    return {
      ...offline,
      message: policy.accessibleStatus.enabled
        ? policy.accessibleStatus.labels[offline.status]
        : offline.message,
    };
  }
  return {
    status: 'saved',
    canExecute: true,
    live: policy.accessibleStatus.enabled ? 'polite' : 'off',
    message: policy.accessibleStatus.enabled ? policy.accessibleStatus.labels.saved : '',
    queuedCount: 0,
  };
}

export function undoEligibility(
  state: CommandState,
  policy: NormalizedInteractionCommandPolicy,
  nowMs: number,
): UndoEligibility {
  if (!policy.undo.enabled) {
    return { available: false, reason: 'Undo disabled by policy.', remainingMs: 0 };
  }
  if (state.status !== 'saved') {
    return { available: false, reason: `Cannot undo from ${state.status}.`, remainingMs: 0 };
  }
  const remainingMs = state.updatedAt + policy.undo.windowMs - nowMs;
  if (remainingMs <= 0) {
    return { available: false, reason: 'Undo window expired.', remainingMs: 0 };
  }
  return { available: true, reason: 'Undo available.', remainingMs };
}

export const pending = (state: CommandState, at: number): CommandState => transitionCommandState(state, { type: 'pending', at });
export const saved = (state: CommandState, at: number): CommandState => transitionCommandState(state, { type: 'saved', at });
export const error = (state: CommandState, at: number, message: string): CommandState => transitionCommandState(state, { type: 'error', at, message });
export const queued = (state: CommandState, at: number): CommandState => transitionCommandState(state, { type: 'queued', at });
export const undone = (state: CommandState, at: number): CommandState => transitionCommandState(state, { type: 'undone', at });
export const cancelled = (state: CommandState, at: number): CommandState => transitionCommandState(state, { type: 'cancelled', at });

export function accessibleStatusFor(
  state: CommandState,
  policy: NormalizedInteractionCommandPolicy,
): AccessibleStatus {
  if (!policy.accessibleStatus.enabled) return { status: state.status, message: '', live: 'off' };
  return {
    status: state.status,
    message: policy.accessibleStatus.labels[state.status],
    live: state.status === 'error' ? 'assertive' : state.status === 'pending' ? 'polite' : 'polite',
  };
}
