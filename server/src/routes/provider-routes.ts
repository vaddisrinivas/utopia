import { badRequest, handleBodyReadError, notFound, ok, setJson, unauthorized } from '../http-utils';
import { type RequestAuthorizationResult } from '../security/auth';

const PROVIDER_BODY_LIMIT_BYTES = 1024 * 1024;

export type ProviderRoutesContext = {
  assertAuth: (req: any, res: any) => RequestAuthorizationResult | null;
  readJsonBody: (req: any, maxBytes: number) => Promise<Record<string, unknown>>;
  readRawBody: (req: any, maxBytes: number) => Promise<string>;
  readNotionConfig: () => any;
  discoverNotionDataSources: (config?: any) => unknown;
  pullNotionRecords: (input?: Record<string, unknown>) => unknown;
  pullNotionRecordsLive: (input?: Record<string, unknown>) => Promise<unknown>;
  writeNotionRecord: (input: any) => Promise<{ ok: boolean; error?: string }>;
  normalizeWebhookBody: (rawBody: string) => unknown;
  normalizeWebhookEvent: (event: unknown) => unknown;
  verifyNotionWebhookSignature: (rawBody: string, signature?: string) => boolean;
  syncNotionFromWebhook: (input: { event: unknown }) => Promise<unknown>;
  getNotionWebhookReplayState: () => unknown;
  buildNotionWebhookResponse: (normalized: any, reconciliation: any, replayState: any) => unknown;
  checkSheetsHealth: () => unknown;
  readSheetsConfig: () => unknown;
  pullSheetsRecords: (input?: Record<string, unknown>) => unknown;
  pullSheetsRecordsLive: (input?: Record<string, unknown>) => Promise<unknown>;
  writeSheetsRecord: (input: any) => Promise<{ ok: boolean; conflict?: unknown; error?: string }>;
  normalizeSheetsWebhookEvent: (event: unknown) => unknown;
  syncSheetsFromWebhook: (input: { event: unknown; domain?: string; collection?: string; limit?: number }) => Promise<unknown>;
  getSheetsWebhookReplayState: () => unknown;
  buildSheetsWebhookResponse: (normalized: any, reconciliation: any, replayState: any) => unknown;
};

function parseNumber(raw: unknown, fallback: number) {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseBooleanString(raw: unknown, fallback = false) {
  if (typeof raw !== 'string') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseProviderOperation(raw: unknown): 'create_record' | 'update_record' | 'archive_record' | null {
  if (typeof raw !== 'string') {
    return null;
  }
  if (raw === 'create_record' || raw === 'update_record' || raw === 'archive_record') {
    return raw;
  }
  return null;
}

function notionWebhooksEnabled() {
  return process.env.LIFEOS_NOTION_WEBHOOKS_ENABLED?.trim().toLowerCase() === 'true';
}

function getQuery(req: any) {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

function getHeaderValue(headers: Record<string, unknown> | undefined, key: string) {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

export function isProviderRoute(path: string) {
  return (
    path === '/providers/notion'
    || path === '/providers/sheets'
    || path.startsWith('/providers/notion/')
    || path.startsWith('/providers/sheets/')
  );
}

async function handleNotionProviderRoute(
  req: any,
  res: any,
  path: string,
  context: ProviderRoutesContext,
): Promise<boolean> {
  if (path === '/providers/notion/webhook') {
    if (!notionWebhooksEnabled()) {
      notFound(res, 'Notion webhooks are disabled; use authenticated pull sync.');
      return true;
    }
    if (req.method !== 'POST') {
      badRequest(res, 'Unsupported method');
      return true;
    }
    let rawBody = '';
    try {
      rawBody = await context.readRawBody(req, PROVIDER_BODY_LIMIT_BYTES);
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid webhook JSON');
      return true;
    }
    const parsed = context.normalizeWebhookBody(rawBody);
    if (!parsed) {
      badRequest(res, 'Invalid webhook JSON');
      return true;
    }

    const verificationToken =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).verification_token
        : undefined;
    if (typeof verificationToken === 'string' && verificationToken.trim().length > 0) {
      ok(res, {
        status: 'verification_required',
        verification_token_present: true,
        signature_required_for_events: true,
      });
      return true;
    }

    const webhookSignature = getHeaderValue(req.headers as Record<string, unknown> | undefined, 'x-notion-signature');
    if (!context.verifyNotionWebhookSignature(rawBody, webhookSignature)) {
      unauthorized(res, 'Invalid webhook signature');
      return true;
    }

    const normalized = context.normalizeWebhookEvent(parsed);
    if (!normalized) {
      badRequest(res, 'Malformed webhook event');
      return true;
    }

    const reconciliation = await context.syncNotionFromWebhook({ event: parsed });
    const replayAfterSync = context.getNotionWebhookReplayState();
    ok(res, context.buildNotionWebhookResponse(normalized, reconciliation, replayAfterSync));
    return true;
  }

  if (!context.assertAuth(req, res)) {
    return true;
  }

  const query = getQuery(req);
  if (req.method === 'GET' && path === '/providers/notion/discovery') {
    ok(res, context.discoverNotionDataSources(context.readNotionConfig() || undefined));
    return true;
  }

  if (req.method === 'GET' && path === '/providers/notion/pull') {
    const domain = query.searchParams.get('domain');
    const collection = query.searchParams.get('collection');
    const limit = query.searchParams.get('limit');
    const live = parseBooleanString(query.searchParams.get('live'), false);
    const payload = {
      domain: domain ?? undefined,
      collection: collection ?? undefined,
      limit: limit ? parseNumber(limit, 50) : undefined,
    };
    if (live) {
      ok(res, await context.pullNotionRecordsLive(payload));
      return true;
    }
    ok(res, context.pullNotionRecords(payload));
    return true;
  }

  if (req.method === 'POST' && path === '/providers/notion/pull') {
    let payload: { domain?: string; collection?: string; limit?: number; live?: boolean };
    try {
      payload = (await context.readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    if (payload.live) {
      ok(res, await context.pullNotionRecordsLive(payload));
      return true;
    }
    ok(res, context.pullNotionRecords(payload));
    return true;
  }

  if (req.method === 'POST' && path === '/providers/notion/push') {
    let payload: {
      operation?: string;
      recordId?: string;
      pageId?: string;
      domain?: string;
      collection?: string;
      title?: string;
      properties?: Record<string, unknown>;
      archived?: boolean;
      externalId?: string;
    };
    try {
      payload = (await context.readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    const operation = parseProviderOperation(payload?.operation);
    if (!operation) {
      badRequest(res, 'operation must be create_record, update_record, or archive_record');
      return true;
    }
    const recordId = typeof payload.recordId === 'string' ? payload.recordId.trim() : '';
    if (!recordId) {
      badRequest(res, 'recordId required');
      return true;
    }
    const result = await context.writeNotionRecord({
      operation,
      recordId,
      pageId: typeof payload.pageId === 'string' && payload.pageId.trim() ? payload.pageId.trim() : undefined,
      domain: payload.domain ?? 'food',
      collection: payload.collection ?? 'recipe',
      title: payload.title,
      properties: payload.properties,
      archived: payload.archived,
      externalId: payload.externalId,
    });
    if (!result.ok) {
      badRequest(res, result.error || 'Notion write failed');
      return true;
    }
    ok(res, result);
    return true;
  }

  badRequest(res, 'Route not found');
  return true;
}

async function handleSheetsProviderRoute(
  req: any,
  res: any,
  path: string,
  context: ProviderRoutesContext,
): Promise<boolean> {
  if (path === '/providers/sheets/webhook') {
    if (req.method !== 'POST') {
      badRequest(res, 'Unsupported method');
      return true;
    }
    if (!context.assertAuth(req, res)) {
      return true;
    }
    let rawBody = '';
    try {
      rawBody = await context.readRawBody(req, PROVIDER_BODY_LIMIT_BYTES);
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    let webhookPayload: unknown;
    try {
      webhookPayload = JSON.parse(rawBody);
    } catch {
      badRequest(res, 'Invalid JSON');
      return true;
    }
    const normalized = context.normalizeSheetsWebhookEvent(webhookPayload);
    if (!normalized) {
      badRequest(res, 'Malformed webhook event');
      return true;
    }
    const reconciliation = await context.syncSheetsFromWebhook({ event: normalized });
    const replayStore = context.getSheetsWebhookReplayState();
    ok(res, context.buildSheetsWebhookResponse(normalized, reconciliation, replayStore));
    return true;
  }

  if (!context.assertAuth(req, res)) {
    return true;
  }

  const query = getQuery(req);
  if (req.method === 'GET' && path === '/providers/sheets/health') {
    ok(res, context.checkSheetsHealth());
    return true;
  }

  if (req.method === 'GET' && path === '/providers/sheets/pull') {
    const domain = query.searchParams.get('domain');
    const collection = query.searchParams.get('collection');
    const live = parseBooleanString(query.searchParams.get('live'), false);
    const payload = {
      domain: domain ?? undefined,
      collection: collection ?? undefined,
    };
    if (live) {
      ok(res, await context.pullSheetsRecordsLive(payload));
      return true;
    }
    ok(res, context.pullSheetsRecords(payload));
    return true;
  }

  if (req.method === 'POST' && path === '/providers/sheets/pull') {
    let payload: { domain?: string; collection?: string; live?: boolean };
    try {
      payload = (await context.readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    if (payload.live) {
      ok(res, await context.pullSheetsRecordsLive(payload));
      return true;
    }
    ok(res, context.pullSheetsRecords(payload));
    return true;
  }

  if (req.method === 'POST' && path === '/providers/sheets/push') {
    let payload: {
      operation?: string;
      id?: string;
      recordId?: string;
      domain?: string;
      collection?: string;
      title?: string;
      properties?: Record<string, unknown>;
      archived?: boolean;
      externalId?: string;
      source?: Record<string, unknown>;
      version?: number;
      expected_version?: number;
      expected_digest?: string;
    };
    try {
      payload = (await context.readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    const operation = parseProviderOperation(payload?.operation);
    if (!operation) {
      badRequest(res, 'operation must be create_record, update_record, or archive_record');
      return true;
    }
    const recordId = typeof payload.recordId === 'string'
      ? payload.recordId.trim()
      : typeof payload.id === 'string'
        ? payload.id.trim()
        : '';
    if (!recordId) {
      badRequest(res, 'record id required');
      return true;
    }
    const result = await context.writeSheetsRecord({
      operation,
      record: {
        id: recordId,
        domain: payload.domain ?? 'food',
        collection: payload.collection ?? 'recipe',
        title: payload.title ?? recordId,
        properties: payload.properties,
        archived: payload.archived,
        source: payload.source,
        externalId: payload.externalId,
        version: typeof payload.version === 'number' && Number.isFinite(payload.version) ? payload.version : undefined,
        expectedVersion: typeof payload.expected_version === 'number' && Number.isFinite(payload.expected_version)
          ? payload.expected_version
          : undefined,
        expectedDigest: typeof payload.expected_digest === 'string' ? payload.expected_digest : undefined,
      },
    });
    if (!result.ok) {
      if (result.conflict) {
        setJson(res, 409, {
          status: 'conflict',
          message: result.error || 'Sheets write conflict',
          conflict: result.conflict,
        });
        return true;
      }
      badRequest(res, result.error || 'Sheets write failed');
      return true;
    }
    ok(res, result);
    return true;
  }

  if (req.method === 'POST' && path === '/providers/sheets/sync') {
    let payload: {
      event?: unknown;
      domain?: string;
      collection?: string;
      limit?: number;
    };
    try {
      payload = (await context.readJsonBody(req, PROVIDER_BODY_LIMIT_BYTES)) as typeof payload;
    } catch (error) {
      if (handleBodyReadError(res, error)) return true;
      badRequest(res, 'Invalid JSON');
      return true;
    }
    const sync = await context.syncSheetsFromWebhook({
      event: payload?.event as unknown,
      domain: payload.domain,
      collection: payload.collection,
      limit: payload.limit,
    });
    ok(res, sync);
    return true;
  }

  badRequest(res, 'Route not found');
  return true;
}

export async function handleProviderRoutes(
  req: any,
  res: any,
  path: string,
  context: ProviderRoutesContext,
): Promise<boolean> {
  if (!isProviderRoute(path)) {
    return false;
  }

  if (path === '/providers/notion' || path.startsWith('/providers/notion/')) {
    return handleNotionProviderRoute(req, res, path, context);
  }

  if (path === '/providers/sheets' || path.startsWith('/providers/sheets/')) {
    return handleSheetsProviderRoute(req, res, path, context);
  }

  return false;
}
