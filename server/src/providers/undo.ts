import type { McpRecord } from '../runtime/state';
import { pullNotionRecordsLive } from './notion/pull';
import { writeNotionRecord } from './notion/push';
import { pullSheetsRecordsLive } from './sheets/pull';
import { writeSheetsRecord } from './sheets/push';

export type ProviderUndoInput = {
  operation: 'delete_record' | 'restore_after_update' | 'restore_after_archive' | 'restore_record';
  provider: 'notion' | 'google_sheets';
  currentRecord: McpRecord | null;
  desiredRecord: McpRecord | null;
  providerSnapshot?: Record<string, unknown> | null;
};

export type ProviderUndoResult =
  | { ok: true; message: string; snapshot?: Record<string, unknown> | null }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function providerValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (Array.isArray(value)) return value.map(providerValueText).join('').trim();
  if (isRecord(value)) {
    if (typeof value.plain_text === 'string') return value.plain_text.trim();
    if (isRecord(value.text) && typeof value.text.content === 'string') return value.text.content.trim();
    if (typeof value.name === 'string') return value.name.trim();
    if ('title' in value) return providerValueText(value.title);
    if ('rich_text' in value) return providerValueText(value.rich_text);
  }
  return '';
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined).sort();
    const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
  }
  return false;
}

function providerValueMatches(observed: unknown, expected: unknown): boolean {
  if (deepEqual(observed, expected)) return true;
  const observedText = providerValueText(observed);
  if (typeof expected === 'string') return observedText === expected;
  if (typeof expected === 'number') return Number(observedText) === expected;
  if (typeof expected === 'boolean') return observedText.toLowerCase() === String(expected);
  return false;
}

function hasProviderProperties(observed: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => providerValueMatches(observed[key], value));
}

function resolveProviderRecordId(input: ProviderUndoInput) {
  const snapshot = input.providerSnapshot;
  const snapshotId =
    typeof snapshot?.page_id === 'string' ? snapshot.page_id
      : typeof snapshot?.pageId === 'string' ? snapshot.pageId
        : typeof snapshot?.provider_record_id === 'string' ? snapshot.provider_record_id
          : typeof snapshot?.external_id === 'string' ? snapshot.external_id
            : '';
  return snapshotId
    || input.desiredRecord?.source.external_id
    || input.currentRecord?.source.external_id
    || '';
}

function desiredUndoRecord(input: ProviderUndoInput): McpRecord | null {
  if (input.operation === 'delete_record') {
    if (!input.currentRecord) {
      return null;
    }
    return {
      ...input.currentRecord,
      archived_at: new Date().toISOString(),
    };
  }
  return input.desiredRecord;
}

async function undoNotion(input: ProviderUndoInput): Promise<ProviderUndoResult> {
  const target = desiredUndoRecord(input);
  if (!target) {
    return { ok: false, message: 'Provider undo missing target record.' };
  }
  const pageId = resolveProviderRecordId(input);
  if (!pageId) {
    return { ok: false, message: 'Provider undo missing Notion page id.' };
  }

  const operation = target.archived_at ? 'archive_record' : 'update_record';
  const write = await writeNotionRecord({
    operation,
    recordId: target.id,
    pageId,
    domain: target.domain,
    collection: target.collection,
    title: target.title,
    properties: target.properties,
    archived: Boolean(target.archived_at),
    externalId: pageId,
  });
  if (!write.ok) {
    return { ok: false, message: write.error || 'Notion undo write failed.' };
  }

  const readback = await pullNotionRecordsLive({
    domain: target.domain,
    collection: target.collection,
    limit: 100,
    pageId,
    externalId: pageId,
  });
  if (readback.status !== 'ready') {
    return { ok: false, message: readback.error || readback.message };
  }

  const recordIndex = readback.records.findIndex((entry) => entry.id === pageId);
  if (recordIndex === -1) {
    return { ok: false, message: 'Notion undo readback missing target page.' };
  }

  const snapshot = readback.source_snapshots[recordIndex];
  const projection = readback.records[recordIndex];
  const rawProperties = isRecord((snapshot as Record<string, unknown> | undefined)?.properties)
    ? (snapshot as { properties: Record<string, unknown> }).properties
    : {};

  if (Boolean(target.archived_at)) {
    if ((snapshot as Record<string, unknown> | undefined)?.archived !== true && (snapshot as Record<string, unknown> | undefined)?.inTrash !== true) {
      return { ok: false, message: 'Notion undo readback did not archive the page.' };
    }
  } else {
    if ((snapshot as Record<string, unknown> | undefined)?.archived === true || (snapshot as Record<string, unknown> | undefined)?.inTrash === true) {
      return { ok: false, message: 'Notion undo readback left the page archived.' };
    }
  }

  if (projection.title !== target.title) {
    return { ok: false, message: 'Notion undo readback title mismatch.' };
  }
  if (!hasProviderProperties(rawProperties, target.properties)) {
    return { ok: false, message: 'Notion undo readback properties mismatch.' };
  }

  return {
    ok: true,
    message: 'Notion undo verified.',
    snapshot: isRecord(snapshot) ? snapshot : null,
  };
}

async function undoSheets(input: ProviderUndoInput): Promise<ProviderUndoResult> {
  const target = desiredUndoRecord(input);
  if (!target) {
    return { ok: false, message: 'Provider undo missing target record.' };
  }
  const providerRecordId = resolveProviderRecordId(input) || target.id;
  const currentDigest =
    input.currentRecord?.source.content_hash
    || (typeof input.providerSnapshot?.afterDigest === 'string' ? input.providerSnapshot.afterDigest : '')
    || undefined;
  const operation = target.archived_at ? 'archive_record' : 'update_record';
  const write = await writeSheetsRecord({
    operation,
    record: {
      id: target.id,
      domain: target.domain,
      collection: target.collection,
      title: target.title,
      properties: target.properties,
      relations: target.relations,
      archived: Boolean(target.archived_at),
      externalId: providerRecordId,
      expectedDigest: currentDigest,
    },
  });
  if (!write.ok) {
    return { ok: false, message: write.error || 'Sheets undo write failed.' };
  }

  const readback = await pullSheetsRecordsLive({
    domain: target.domain,
    collection: target.collection,
  });
  if (readback.status !== 'ready') {
    return { ok: false, message: readback.error || readback.message };
  }

  const recordIndex = readback.records.findIndex((entry) => entry.id === target.id);
  if (recordIndex === -1) {
    return { ok: false, message: 'Sheets undo readback missing target row.' };
  }

  const projection = readback.records[recordIndex];
  const snapshot = readback.source_snapshots[recordIndex];
  if (Boolean(projection.archived) !== Boolean(target.archived_at)) {
    return { ok: false, message: 'Sheets undo readback archive state mismatch.' };
  }
  if (projection.title !== target.title) {
    return { ok: false, message: 'Sheets undo readback title mismatch.' };
  }
  if (!hasProviderProperties(projection.properties ?? {}, target.properties)) {
    return { ok: false, message: 'Sheets undo readback properties mismatch.' };
  }

  return {
    ok: true,
    message: write.noChange ? 'Sheets undo already matched desired state.' : 'Sheets undo verified.',
    snapshot: isRecord(snapshot) ? snapshot : null,
  };
}

export async function executeProviderUndo(input: ProviderUndoInput): Promise<ProviderUndoResult> {
  if (input.provider === 'notion') {
    return undoNotion(input);
  }
  if (input.provider === 'google_sheets') {
    return undoSheets(input);
  }
  return { ok: false, message: `Unsupported provider undo target ${input.provider}.` };
}
