export const UTOPIA_TELEMETRY_SCHEMA_VERSION = 'utopia.telemetry-event.v1' as const;

export const UTOPIA_TELEMETRY_EVENT_NAMES = [
  'package_created',
  'install_previewed',
  'install_blocked',
  'package_installed',
  'package_opened',
  'package_uninstalled',
  'capability_blocked',
  'feedback_submitted',
] as const;

export type UtopiaTelemetryEventName = typeof UTOPIA_TELEMETRY_EVENT_NAMES[number];

export type UtopiaTelemetryEvent = Readonly<{
  schemaVersion: typeof UTOPIA_TELEMETRY_SCHEMA_VERSION;
  event: UtopiaTelemetryEventName;
  anonymousInstallationId: string;
  occurredAt: string;
  packageId?: string;
  packageVersion?: string;
  source?: 'app' | 'registry' | 'custom_gpt' | 'github_factory' | 'browser_builder';
  rating?: 1 | 2 | 3 | 4 | 5;
  tags?: readonly string[];
}>;

export const UTOPIA_TELEMETRY_MAX_EVENT_BYTES = 4096;

const UTOPIA_TELEMETRY_ALLOWED_FIELDS = [
  'schemaVersion',
  'event',
  'anonymousInstallationId',
  'occurredAt',
  'packageId',
  'packageVersion',
  'source',
  'rating',
  'tags',
] as const;

const FORBIDDEN_TELEMETRY_KEYS = [
  'record',
  'records',
  'prompt',
  'prompts',
  'apiKey',
  'api_key',
  'token',
  'secret',
  'audio',
  'file',
  'files',
  'health',
  'contact',
  'contacts',
  'location',
  'latitude',
  'longitude',
  'email',
  'phone',
] as const;

const EVENT_NAMES = new Set<string>(UTOPIA_TELEMETRY_EVENT_NAMES);
const ALLOWED_FIELDS = new Set<string>(UTOPIA_TELEMETRY_ALLOWED_FIELDS);

export function validateTelemetryEvent(input: unknown): UtopiaTelemetryEvent {
  const issues = collectTelemetryEventIssues(input);
  if (issues.length) throw new Error(`telemetry_event_invalid:${issues.join('|')}`);
  return input as UtopiaTelemetryEvent;
}

export function collectTelemetryEventIssues(input: unknown): string[] {
  if (!isRecord(input)) return ['event must be an object'];
  const issues: string[] = [];
  const keys = Object.keys(input);

  for (const forbidden of FORBIDDEN_TELEMETRY_KEYS) {
    if (keys.some((key) => key.toLowerCase().includes(forbidden.toLowerCase()))) {
      issues.push(`forbidden telemetry field:${forbidden}`);
    }
  }

  for (const key of keys) {
    if (!ALLOWED_FIELDS.has(key)) {
      issues.push(`field is not allowlisted:${key}`);
    }
  }
  collectNestedForbiddenTelemetryKeys(input, '', issues);

  if (input.schemaVersion !== UTOPIA_TELEMETRY_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${UTOPIA_TELEMETRY_SCHEMA_VERSION}`);
  }
  if (!isText(input.event) || !EVENT_NAMES.has(input.event)) {
    issues.push('event is not allowlisted');
  }
  if (!isText(input.anonymousInstallationId)) {
    issues.push('anonymousInstallationId is required');
  }
  if (!isText(input.occurredAt) || Number.isNaN(Date.parse(input.occurredAt))) {
    issues.push('occurredAt must be ISO date');
  }
  if (input.packageId !== undefined && !isText(input.packageId)) issues.push('packageId must be text');
  if (input.packageVersion !== undefined && !isText(input.packageVersion)) issues.push('packageVersion must be text');
  if (input.source !== undefined && !['app', 'registry', 'custom_gpt', 'github_factory', 'browser_builder'].includes(String(input.source))) {
    issues.push('source is invalid');
  }
  if (input.rating !== undefined && (![1, 2, 3, 4, 5].includes(Number(input.rating)) || !Number.isInteger(input.rating))) {
    issues.push('rating must be 1..5');
  }
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      issues.push('tags must be an array');
    } else if (input.tags.length > 16) {
      issues.push('tags must be small');
    } else if (input.tags.some((tag) => !isText(tag) || tag.length > 48)) {
      issues.push('tags must be short text labels');
    }
  }
  if (input.packageId !== undefined && typeof input.packageId === 'string' && input.packageId.length > 128) {
    issues.push('packageId is too long');
  }
  if (input.packageVersion !== undefined && typeof input.packageVersion === 'string' && input.packageVersion.length > 64) {
    issues.push('packageVersion is too long');
  }
  if (isText(input.anonymousInstallationId) && input.anonymousInstallationId.length > 128) {
    issues.push('anonymousInstallationId is too long');
  }

  return issues;
}

export function redactedTelemetryEvent(input: UtopiaTelemetryEvent): Record<string, unknown> {
  return {
    schemaVersion: input.schemaVersion,
    event: input.event,
    anonymousInstallationId: input.anonymousInstallationId,
    occurredAt: input.occurredAt,
    ...(input.packageId ? { packageId: input.packageId } : {}),
    ...(input.packageVersion ? { packageVersion: input.packageVersion } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.rating ? { rating: input.rating } : {}),
    ...(input.tags ? { tags: [...input.tags] } : {}),
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isText(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function collectNestedForbiddenTelemetryKeys(
  input: unknown,
  path: string,
  issues: string[],
): void {
  if (Array.isArray(input)) {
    input.forEach((value) => collectNestedForbiddenTelemetryKeys(value, `${path}[]`, issues));
    return;
  }
  if (!isRecord(input)) return;
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_TELEMETRY_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden.toLowerCase()))) {
      issues.push(`forbidden telemetry field:${key}`);
    }
    collectNestedForbiddenTelemetryKeys(value, `${path}.${key}`, issues);
  }
}
