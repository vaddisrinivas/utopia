import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  SHARED_STATE_SYNC_SCHEMA_VERSION,
  createFileSharedStateSyncAdapter,
  type SharedStateSyncEnvelope,
  type SharedStateSyncRecoveryResult,
  type SharedStateSyncSnapshot,
  type SharedStateSyncStageResult,
  type SharedStateSyncSyncResult,
} from '@/src/providers/shared-state-sync';
import {
  REFERENCE_SYNC_TRANSPORT_SCHEMA_VERSION,
  referenceSyncTransportPaths,
} from '@/src/providers/reference-sync-transport';
import type { ReferenceSyncTransportHealth } from '@/src/providers/reference-sync-transport';

type TransportResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

type EnvelopeBody = Record<string, unknown>;

type RouteContext = {
  schemaVersion: typeof SHARED_STATE_SYNC_SCHEMA_VERSION;
  workspaceId: string;
  installationId: string;
  deviceId: string;
};

const PORT = Number(process.env.UTOPIA_REFERENCE_SYNC_TRANSPORT_PORT || process.env.PORT || 19331);
const STATE_PATH =
  process.env.UTOPIA_REFERENCE_SYNC_STATE_PATH
  || join(process.cwd(), 'app', 'build', 'evidence', 'reference-sync-transport', 'state.json');

const adapter = createFileSharedStateSyncAdapter(STATE_PATH);
const health: ReferenceSyncTransportHealth = {
  status: 'ready',
  schemaVersion: REFERENCE_SYNC_TRANSPORT_SCHEMA_VERSION,
  statePath: STATE_PATH,
};

mkdirSync(dirname(STATE_PATH), { recursive: true });

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'internal_error',
    });
  }
});

server.listen(PORT, '127.0.0.1');
process.stdout.write(`reference-sync-transport-relay ready=${PORT}\n`);

const closeServer = () => {
  if (server.listening) {
    server.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);

server.on('error', (error) => {
  console.error(`reference-sync-transport-relay error ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

function parsePath(request: IncomingMessage): string {
  const raw = request.url ?? '/';
  try {
    return new URL(raw, 'http://127.0.0.1').pathname;
  } catch {
    return raw;
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: TransportResponse): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireObject(value: unknown): EnvelopeBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request_body_must_be_object');
  }
  return value as EnvelopeBody;
}

function getSchemaVersion(
  input: EnvelopeBody,
  path: string,
): typeof SHARED_STATE_SYNC_SCHEMA_VERSION {
  const schemaVersion = (input.schemaVersion as string | undefined) ?? SHARED_STATE_SYNC_SCHEMA_VERSION;
  if (schemaVersion !== SHARED_STATE_SYNC_SCHEMA_VERSION) {
    throw new Error(`invalid_schema_version:${path}`);
  }
  return schemaVersion;
}

function ensureContext(input: EnvelopeBody, path: string): RouteContext {
  const schemaVersion = getSchemaVersion(input, path);
  const workspaceId = input.workspaceId;
  const installationId = input.installationId;
  const deviceId = input.deviceId;

  if (typeof workspaceId !== 'string' || !workspaceId) {
    throw new Error(`workspaceId.required:${path}`);
  }
  if (typeof installationId !== 'string' || !installationId) {
    throw new Error(`installationId.required:${path}`);
  }
  if (typeof deviceId !== 'string' || !deviceId) {
    throw new Error(`deviceId.required:${path}`);
  }

  return {
    schemaVersion,
    workspaceId,
    installationId,
    deviceId,
  };
}

function ensureEnvelope(input: EnvelopeBody): SharedStateSyncEnvelope {
  const schemaVersion = getSchemaVersion(input, referenceSyncTransportPaths.stage);
  const workspaceId = input.workspaceId;
  const installationId = input.installationId;
  const deviceId = input.deviceId;
  const operation = input.operation;

  if (typeof workspaceId !== 'string' || !workspaceId) {
    throw new Error(`workspaceId.required:${referenceSyncTransportPaths.stage}`);
  }
  if (typeof installationId !== 'string' || !installationId) {
    throw new Error(`installationId.required:${referenceSyncTransportPaths.stage}`);
  }
  if (typeof deviceId !== 'string' || !deviceId) {
    throw new Error(`deviceId.required:${referenceSyncTransportPaths.stage}`);
  }
  if (!operation || typeof operation !== 'object') {
    throw new Error(`operation.required:${referenceSyncTransportPaths.stage}`);
  }

  return {
    schemaVersion,
    workspaceId,
    installationId,
    deviceId,
    operation: operation as SharedStateSyncEnvelope['operation'],
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = parsePath(request);

  if (request.method === 'GET' && path === referenceSyncTransportPaths.health) {
    sendJson(response, 200, { ok: true, data: health });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  const payload = requireObject(await readRequestBody(request));

  if (path === referenceSyncTransportPaths.stage) {
    const envelope = ensureEnvelope(payload);
    const result = adapter.stage(envelope) as SharedStateSyncStageResult;
    sendJson(response, 200, { ok: true, data: result });
    return;
  }

  if (path === referenceSyncTransportPaths.snapshot) {
    const workspaceId = payload.workspaceId;
    const installationId = payload.installationId;
    if (typeof workspaceId !== 'string' || !workspaceId) {
      throw new Error(`workspaceId.required:${referenceSyncTransportPaths.snapshot}`);
    }
    if (typeof installationId !== 'string' || !installationId) {
      throw new Error(`installationId.required:${referenceSyncTransportPaths.snapshot}`);
    }
    const result = adapter.snapshot({
      schemaVersion: getSchemaVersion(payload, referenceSyncTransportPaths.snapshot),
      workspaceId,
      installationId,
    }) as SharedStateSyncSnapshot;
    sendJson(response, 200, { ok: true, data: result });
    return;
  }

  if (path === referenceSyncTransportPaths.sync) {
    const context = ensureContext(payload, referenceSyncTransportPaths.sync);
    const result = adapter.syncDevice({
      schemaVersion: context.schemaVersion as typeof SHARED_STATE_SYNC_SCHEMA_VERSION,
      workspaceId: context.workspaceId,
      installationId: context.installationId,
      deviceId: context.deviceId,
    }) as SharedStateSyncSyncResult;
    sendJson(response, 200, { ok: true, data: result });
    return;
  }

  if (path === referenceSyncTransportPaths.loseDevice) {
    const context = ensureContext(payload, referenceSyncTransportPaths.loseDevice);
    adapter.loseDevice({
      schemaVersion: context.schemaVersion as typeof SHARED_STATE_SYNC_SCHEMA_VERSION,
      workspaceId: context.workspaceId,
      installationId: context.installationId,
      deviceId: context.deviceId,
    });
    sendJson(response, 200, { ok: true, data: { ok: true } });
    return;
  }

  if (path === referenceSyncTransportPaths.recoverDevice) {
    const context = ensureContext(payload, referenceSyncTransportPaths.recoverDevice);
    const result = adapter.recoverDevice({
      schemaVersion: context.schemaVersion as typeof SHARED_STATE_SYNC_SCHEMA_VERSION,
      workspaceId: context.workspaceId,
      installationId: context.installationId,
      deviceId: context.deviceId,
    }) as SharedStateSyncRecoveryResult;
    sendJson(response, 200, { ok: true, data: result });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: `unknown_route:${path}`,
  });
}
