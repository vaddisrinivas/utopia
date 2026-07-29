import type { CanonicalRecord, CanonicalRelation } from '@/src/domain/runtime';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';
import { isSupportedDataHomeProvider } from '@/src/providers/data-home-contract';

export const NOTION_DATA_HOME_SCHEMA_VERSION = 'utopia.notion-data-home.v1' as const;
const NOTION_VERSION = '2026-03-11';
const NOTION_PROVIDER = 'notion' as const;
const MAX_PULL_PAGES = 100;

export type NotionDataHomePropertyValue =
  | { type: 'title'; value: string }
  | { type: 'rich_text'; value: string }
  | { type: 'number'; value: number | null }
  | { type: 'checkbox'; value: boolean }
  | { type: 'select'; value: string | null }
  | { type: 'multi_select'; value: readonly string[] }
  | { type: 'date'; value: NotionDateValue | null }
  | { type: 'relation'; value: readonly string[] }
  | { type: 'url'; value: string | null }
  | { type: 'email'; value: string | null }
  | { type: 'phone_number'; value: string | null }
  | { type: 'formula'; value: unknown }
  | { type: 'rollup'; value: unknown };

export type NotionDateValue = Readonly<{
  start: string;
  end?: string | null;
  time_zone?: string | null;
}>;

export type NotionPage = Readonly<{
  id: string;
  url?: string | null;
  parent?: Readonly<{
    data_source_id?: string | null;
    database_id?: string | null;
  }> | null;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string | null;
  last_edited_time?: string | null;
  version?: number | string | null;
  properties?: Record<string, unknown>;
}>;

export type NotionDataHomePullInput = Readonly<{
  installationId: string;
  declaredDataHomes: readonly string[];
  databaseId: string;
  sessionPresent: boolean;
  online: boolean;
  pages: readonly NotionPage[];
  cursor?: string | null;
  observedAt?: string;
}>;

export type NotionDataHomePullResult =
  | Readonly<{
    status: 'ok';
    schemaVersion: typeof NOTION_DATA_HOME_SCHEMA_VERSION;
    installationId: string;
    databaseId: string;
    cursor: string;
    pageCount: number;
    records: readonly CanonicalRecord[];
  }>
  | Readonly<{
    status: 'blocked';
    schemaVersion: typeof NOTION_DATA_HOME_SCHEMA_VERSION;
    installationId: string;
    databaseId: string;
    cursor: null;
    pageCount: 0;
    records: readonly [];
    reason: string;
  }>;

export type NotionDataHomePushOperation = 'create' | 'update' | 'archive' | 'delete';

export type NotionDataHomePushInput = Readonly<{
  installationId: string;
  declaredDataHomes: readonly string[];
  databaseId: string;
  sessionPresent: boolean;
  online: boolean;
  operation: NotionDataHomePushOperation;
  record: CanonicalRecord;
  expectedRevision: number;
  idempotencyKey: string;
  pageId?: string | null;
  deleteMode?: 'archive' | 'hard';
}>;

export type NotionDataHomeRequest = Readonly<{
  method: 'POST' | 'PATCH';
  url: string;
  headers: Readonly<{
    'content-type': 'application/json';
    'notion-version': typeof NOTION_VERSION;
  }>;
  body: string;
}>;

export type NotionDataHomePushResult =
  | Readonly<{
    status: 'ok';
    schemaVersion: typeof NOTION_DATA_HOME_SCHEMA_VERSION;
    installationId: string;
    databaseId: string;
    idempotencyKey: string;
    expectedRevision: number;
    request: NotionDataHomeRequest;
  }>
  | Readonly<{
    status: 'blocked';
    schemaVersion: typeof NOTION_DATA_HOME_SCHEMA_VERSION;
    installationId: string;
    databaseId: string;
    idempotencyKey: string;
    expectedRevision: number;
    request: null;
    reason: string;
  }>;

export function pullNotionDataHome(input: NotionDataHomePullInput): NotionDataHomePullResult {
  try {
    const scoped = validateScope(input.installationId, input.declaredDataHomes, input.databaseId, input.sessionPresent, input.online);
    if (!scoped.ok) return blockedPull(input.installationId, input.databaseId, scoped.reason);
    if (input.pages.length > MAX_PULL_PAGES) {
      return blockedPull(scoped.installationId, scoped.databaseId, 'page_limit_exceeded');
    }

    const normalized = [...input.pages]
      .sort((left, right) => compareText(left.id, right.id))
      .map((page) => normalizePullPage(page, scoped.installationId, scoped.databaseId, input.observedAt))
      .sort((left, right) => compareText(left.id, right.id));

    const cursor = buildCursor(scoped.installationId, scoped.databaseId, input.cursor ?? null, normalized);
    return {
      status: 'ok',
      schemaVersion: NOTION_DATA_HOME_SCHEMA_VERSION,
      installationId: scoped.installationId,
      databaseId: scoped.databaseId,
      cursor,
      pageCount: normalized.length,
      records: normalized,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'pull_rejected';
    return blockedPull(input.installationId, input.databaseId, reason);
  }
}

export function planNotionDataHomePush(input: NotionDataHomePushInput): NotionDataHomePushResult {
  try {
    const scoped = validateScope(input.installationId, input.declaredDataHomes, input.databaseId, input.sessionPresent, input.online);
    if (!scoped.ok) return blockedPush(input, scoped.reason);
    if (input.deleteMode === 'hard') {
      return blockedPush(input, 'destructive_delete_rejected');
    }
    if (input.record.source.provider !== NOTION_PROVIDER) {
      return blockedPush(input, 'cross_installation_record');
    }
    if (!isScopedRecordId(input.record.id, scoped.installationId, scoped.databaseId)) {
      return blockedPush(input, 'cross_installation_record');
    }
    if (input.record.source.external_id.trim() && input.record.source.external_id !== decodeRecordId(input.record.id).pageId) {
      return blockedPush(input, 'cross_installation_record');
    }
    if (input.record.revision !== input.expectedRevision) {
      return blockedPush(input, 'revision_conflict');
    }

    const request = buildRequest(input, scoped.databaseId);
    if ('reason' in request) {
      return blockedPush(input, request.reason);
    }

    return {
      status: 'ok',
      schemaVersion: NOTION_DATA_HOME_SCHEMA_VERSION,
      installationId: scoped.installationId,
      databaseId: scoped.databaseId,
      idempotencyKey: input.idempotencyKey.trim(),
      expectedRevision: input.expectedRevision,
      request,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'push_rejected';
    return blockedPush(input, reason);
  }
}

function validateScope(
  installationId: string,
  declaredDataHomes: readonly string[],
  databaseId: string,
  sessionPresent: boolean,
  online: boolean,
): Readonly<{ ok: true; installationId: string; databaseId: string }> | Readonly<{ ok: false; reason: string }> {
  const scopedInstallationId = installationId.trim();
  const scopedDatabaseId = databaseId.trim();
  if (!scopedInstallationId) return { ok: false, reason: 'installation_id_required' };
  if (!scopedDatabaseId) return { ok: false, reason: 'database_id_required' };
  if (!declaredDataHomes.some((home) => home.trim() === NOTION_PROVIDER)) return { ok: false, reason: 'undeclared_provider:notion' };
  if (!isSupportedDataHomeProvider(NOTION_PROVIDER)) return { ok: false, reason: 'unsupported_provider:notion' };
  if (!sessionPresent) return { ok: false, reason: 'session_required' };
  if (!online) return { ok: false, reason: 'offline' };
  return { ok: true, installationId: scopedInstallationId, databaseId: scopedDatabaseId };
}

function normalizePullPage(page: NotionPage, installationId: string, databaseId: string, observedAt?: string): CanonicalRecord {
  const scopeParent = normalizeParentScope(page.parent, databaseId);
  const now = resolveTimestamp(observedAt, page.last_edited_time ?? page.created_time);
  const revision = resolveRevision(page);
  const normalizedProperties: Record<string, NotionDataHomePropertyValue> = {};
  const relations: CanonicalRelation[] = [];
  let title = page.id;

  for (const [propertyName, propertyValue] of Object.entries(page.properties ?? {})) {
    const normalized = normalizeProperty(propertyName, propertyValue);
    normalizedProperties[propertyName] = normalized.value;
    if (normalized.titleText) {
      title = normalized.titleText;
    }
    relations.push(...normalized.relations);
  }

  const recordId = buildRecordId(installationId, databaseId, page.id);
  const sourceContentHash = sha256Canonical({
    installationId,
    databaseId,
    page: canonicalJson(page),
  });

  return {
    id: recordId,
    domain: NOTION_PROVIDER,
    collection: databaseId,
    title,
    properties: normalizedProperties,
    relations,
    source: {
      provider: NOTION_PROVIDER,
      external_id: page.id,
      url: page.url ?? null,
      observed_at: now,
      content_hash: sourceContentHash,
    },
    archived_at: page.archived || page.in_trash ? now : null,
    created_at: page.created_time ?? now,
    updated_at: page.last_edited_time ?? now,
    revision,
    schema_version: NOTION_DATA_HOME_SCHEMA_VERSION,
    deleted: Boolean(page.archived || page.in_trash),
    privacy: 'personal',
    provenance: {
      actor: 'sync',
      confidence: null,
      evidence: [`notion:${scopeParent}`],
      reason: 'notion_data_home_pull',
    },
  };
}

function normalizeProperty(
  propertyName: string,
  propertyValue: unknown,
): Readonly<{ value: NotionDataHomePropertyValue; titleText?: string; relations: readonly CanonicalRelation[] }> {
  if (!propertyValue || typeof propertyValue !== 'object') {
    throw new Error(`unsupported_property_type:${propertyName}`);
  }
  const property = propertyValue as Record<string, unknown>;
  const type = typeof property.type === 'string' ? property.type : '';
  switch (type) {
    case 'title': {
      const text = richTextToPlainText(property.title);
      return { value: { type: 'title', value: text }, titleText: text, relations: [] };
    }
    case 'rich_text':
      return { value: { type: 'rich_text', value: richTextToPlainText(property.rich_text) }, relations: [] };
    case 'number':
      return { value: { type: 'number', value: normalizeNullableNumber(property.number, propertyName) }, relations: [] };
    case 'checkbox':
      return { value: { type: 'checkbox', value: Boolean(property.checkbox) }, relations: [] };
    case 'select':
      return { value: { type: 'select', value: normalizeOptionName(property.select) }, relations: [] };
    case 'status':
      return { value: { type: 'select', value: normalizeOptionName(property.status) }, relations: [] };
    case 'multi_select':
      return { value: { type: 'multi_select', value: normalizeOptions(property.multi_select) }, relations: [] };
    case 'date':
      return { value: { type: 'date', value: normalizeDate(property.date) }, relations: [] };
    case 'relation': {
      const ids = normalizeRelationIds(property.relation);
      return {
        value: { type: 'relation', value: ids },
        relations: ids.map((targetId) => ({ name: propertyName, target_id: targetId })),
      };
    }
    case 'url':
      return { value: { type: 'url', value: normalizeNullableString(property.url) }, relations: [] };
    case 'email':
      return { value: { type: 'email', value: normalizeNullableString(property.email) }, relations: [] };
    case 'phone_number':
      return { value: { type: 'phone_number', value: normalizeNullableString(property.phone_number) }, relations: [] };
    case 'formula':
      return { value: { type: 'formula', value: normalizeReadOnlyValue(property.formula) }, relations: [] };
    case 'rollup':
      return { value: { type: 'rollup', value: normalizeReadOnlyValue(property.rollup) }, relations: [] };
    default:
      throw new Error(`unsupported_property_type:${type || propertyName}`);
  }
}

function buildRequest(
  input: NotionDataHomePushInput,
  databaseId: string,
): NotionDataHomeRequest | Readonly<{ reason: string }> {
  const recordId = input.pageId?.trim() || decodeRecordId(input.record.id).pageId;
  const properties = toNotionProperties(input.record.properties);
  if (input.operation === 'create') {
    return {
      method: 'POST',
      url: 'https://api.notion.com/v1/pages',
      headers: {
        'content-type': 'application/json',
        'notion-version': NOTION_VERSION,
      },
      body: canonicalJson({
        parent: { data_source_id: databaseId },
        properties,
      }),
    };
  }
  if (!recordId) {
    return { reason: 'page_id_required' };
  }
  const body = input.operation === 'update'
    ? {
      properties,
    }
    : {
      in_trash: true,
    };
  return {
    method: 'PATCH',
    url: `https://api.notion.com/v1/pages/${encodeURIComponent(recordId)}`,
    headers: {
      'content-type': 'application/json',
      'notion-version': NOTION_VERSION,
    },
    body: canonicalJson(body),
  };
}

function toNotionProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(properties).sort(([left], [right]) => compareText(left, right));
  const output: Record<string, unknown> = {};
  for (const [name, value] of entries) {
    output[name] = toNotionProperty(name, value);
  }
  return output;
}

function toNotionProperty(propertyName: string, propertyValue: unknown): Record<string, unknown> {
  if (!propertyValue || typeof propertyValue !== 'object') {
    throw new Error(`malformed_property:${propertyName}`);
  }
  const property = propertyValue as Record<string, unknown>;
  switch (property.type) {
    case 'title':
      return { title: toRichText(property.value, propertyName) };
    case 'rich_text':
      return { rich_text: toRichText(property.value, propertyName) };
    case 'number':
      if (typeof property.value !== 'number' && property.value !== null) throw new Error(`malformed_property:${propertyName}`);
      return { number: property.value };
    case 'checkbox':
      if (typeof property.value !== 'boolean') throw new Error(`malformed_property:${propertyName}`);
      return { checkbox: property.value };
    case 'select':
      return { select: property.value == null ? null : { name: assertString(property.value, propertyName) } };
    case 'multi_select':
      return { multi_select: assertStringArray(property.value, propertyName).map((name) => ({ name })) };
    case 'date':
      return { date: property.value == null ? null : assertDateValue(property.value, propertyName) };
    case 'relation':
      return { relation: assertStringArray(property.value, propertyName).map((id) => ({ id })) };
    case 'url':
      return { url: property.value == null ? null : assertString(property.value, propertyName) };
    case 'email':
      return { email: property.value == null ? null : assertString(property.value, propertyName) };
    case 'phone_number':
      return { phone_number: property.value == null ? null : assertString(property.value, propertyName) };
    case 'formula':
    case 'rollup':
      throw new Error(`writeback_unsupported:${property.type}`);
    default:
      throw new Error(`malformed_property:${propertyName}`);
  }
}

function richTextToPlainText(value: unknown): string {
  const text = richTextArray(value).map((fragment) => fragment.text.content).join('');
  if (!text.trim()) throw new Error('malformed_rich_text');
  return text;
}

function richTextFromPlainText(value: unknown, propertyName: string): ReadonlyArray<{ type: 'text'; text: { content: string } }> {
  const text = assertString(value, propertyName);
  return [{ type: 'text', text: { content: text } }];
}

function toRichText(value: unknown, propertyName: string): ReadonlyArray<{ type: 'text'; text: { content: string } }> {
  if (typeof value === 'string') {
    return richTextFromPlainText(value, propertyName);
  }
  if (Array.isArray(value)) {
    return richTextArray(value).map((fragment) => ({ type: 'text' as const, text: { content: fragment.text.content } }));
  }
  throw new Error(`malformed_property:${propertyName}`);
}

function richTextArray(value: unknown): ReadonlyArray<{ text: { content: string } }> {
  if (!Array.isArray(value) || !value.length) throw new Error('malformed_rich_text');
  return value.map((fragment) => {
    if (!fragment || typeof fragment !== 'object') throw new Error('malformed_rich_text');
    const item = fragment as Record<string, unknown>;
    const text = item.text;
    if (!text || typeof text !== 'object') throw new Error('malformed_rich_text');
    const content = (text as Record<string, unknown>).content;
    if (typeof content !== 'string') throw new Error('malformed_rich_text');
    return { text: { content } };
  });
}

function normalizeNullableNumber(value: unknown, propertyName: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`malformed_property:${propertyName}`);
  return value;
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('malformed_property');
  return value;
}

function normalizeOptionName(value: unknown): string | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object') throw new Error('malformed_property');
  const option = value as Record<string, unknown>;
  const name = option.name;
  if (name == null) return null;
  if (typeof name !== 'string') throw new Error('malformed_property');
  return name;
}

function normalizeOptions(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('malformed_property');
  return value.map((option) => normalizeOptionName(option)).filter((name): name is string => Boolean(name));
}

function normalizeDate(value: unknown): NotionDateValue | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object') throw new Error('malformed_property');
  const date = value as Record<string, unknown>;
  const start = date.start;
  if (typeof start !== 'string' || !start.trim()) throw new Error('malformed_property');
  const end = date.end == null ? null : assertString(date.end, 'date.end');
  const timeZone = date.time_zone == null ? null : assertString(date.time_zone, 'date.time_zone');
  return {
    start,
    ...(end ? { end } : {}),
    ...(timeZone ? { time_zone: timeZone } : {}),
  };
}

function normalizeRelationIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('malformed_property');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('malformed_property');
    const relation = entry as Record<string, unknown>;
    const id = relation.id;
    if (typeof id !== 'string' || !id.trim()) throw new Error('malformed_property');
    return id;
  });
}

function normalizeReadOnlyValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => normalizeReadOnlyValue(entry));
  if (typeof value === 'object') return canonicalJson(value);
  throw new Error('malformed_property');
}

function normalizeParentScope(
  parent: NotionPage['parent'],
  databaseId: string,
): string {
  const parentDataSourceId = parent?.data_source_id?.trim() ?? '';
  const parentDatabaseId = parent?.database_id?.trim() ?? '';
  const scopeId = parentDataSourceId || parentDatabaseId;
  if (!scopeId) {
    throw new Error('notion_parent_scope_mismatch');
  }
  if (scopeId !== databaseId) {
    throw new Error('notion_parent_scope_mismatch');
  }
  return scopeId;
}

function resolveTimestamp(override: string | undefined, fallback: string | null | undefined): string {
  const candidate = override?.trim() || fallback?.trim();
  if (!candidate) {
    throw new Error('notion_timestamp_required');
  }
  assertValidTimestamp(candidate);
  return candidate;
}

function resolveRevision(page: NotionPage): number {
  if (page.version != null) {
    const version = typeof page.version === 'string' ? Number(page.version) : page.version;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error('notion_revision_invalid');
    }
    return version;
  }
  const lastEdited = page.last_edited_time?.trim();
  if (!lastEdited) {
    throw new Error('notion_timestamp_required');
  }
  const revision = Date.parse(lastEdited);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('notion_timestamp_invalid');
  }
  return revision;
}

function assertValidTimestamp(value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('notion_timestamp_invalid');
  }
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertString(value: unknown, propertyName: string): string {
  if (typeof value !== 'string') throw new Error(`malformed_property:${propertyName}`);
  return value;
}

function assertStringArray(value: unknown, propertyName: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`malformed_property:${propertyName}`);
  return value.map((entry) => assertString(entry, propertyName));
}

function assertDateValue(value: unknown, propertyName: string): NotionDateValue {
  if (!value || typeof value !== 'object') throw new Error(`malformed_property:${propertyName}`);
  const date = value as Record<string, unknown>;
  const start = assertString(date.start, propertyName);
  const end = date.end == null ? null : assertString(date.end, propertyName);
  const timeZone = date.time_zone == null ? null : assertString(date.time_zone, propertyName);
  return {
    start,
    ...(end ? { end } : {}),
    ...(timeZone ? { time_zone: timeZone } : {}),
  };
}

function buildRecordId(installationId: string, databaseId: string, pageId: string): string {
  return `notion:${encodeURIComponent(installationId)}:${encodeURIComponent(databaseId)}:${encodeURIComponent(pageId)}`;
}

function decodeRecordId(recordId: string): Readonly<{ installationId: string; databaseId: string; pageId: string }> {
  const parts = recordId.split(':');
  if (parts.length < 4 || parts[0] !== NOTION_PROVIDER) {
    return { installationId: '', databaseId: '', pageId: recordId };
  }
  return {
    installationId: decodeURIComponent(parts[1] ?? ''),
    databaseId: decodeURIComponent(parts[2] ?? ''),
    pageId: decodeURIComponent(parts.slice(3).join(':')),
  };
}

function isScopedRecordId(recordId: string, installationId: string, databaseId: string): boolean {
  const decoded = decodeRecordId(recordId);
  return decoded.installationId === installationId && decoded.databaseId === databaseId;
}

function buildCursor(
  installationId: string,
  databaseId: string,
  previousCursor: string | null,
  records: readonly CanonicalRecord[],
): string {
  return `notion-cursor:${sha256Canonical({
    installationId,
    databaseId,
    previousCursor,
    records: records.map((record) => ({
      id: record.id,
      source: record.source,
      title: record.title,
      updated_at: record.updated_at,
      archived_at: record.archived_at,
      revision: record.revision,
      properties: record.properties,
      relations: record.relations,
    })),
  })}`;
}

function blockedPull(installationId: string, databaseId: string, reason: string): NotionDataHomePullResult {
  return {
    status: 'blocked',
    schemaVersion: NOTION_DATA_HOME_SCHEMA_VERSION,
    installationId: installationId.trim(),
    databaseId: databaseId.trim(),
    cursor: null,
    pageCount: 0,
    records: [],
    reason,
  };
}

function blockedPush(input: Pick<NotionDataHomePushInput, 'installationId' | 'databaseId' | 'idempotencyKey' | 'expectedRevision'>, reason: string): NotionDataHomePushResult {
  return {
    status: 'blocked',
    schemaVersion: NOTION_DATA_HOME_SCHEMA_VERSION,
    installationId: input.installationId.trim(),
    databaseId: input.databaseId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    expectedRevision: input.expectedRevision,
    request: null,
    reason,
  };
}
