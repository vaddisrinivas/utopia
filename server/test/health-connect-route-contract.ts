import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

const token = 'health-connect-route-token';

const dir = mkdtempSync(join(tmpdir(), 'utopia-health-connect-route-'));
const snapshotPath = join(dir, 'health-connect-snapshots.json');
const sideEffectProbePath = join(dir, 'health-connect-import-probe.json');
const previousEnv = {
  port: process.env.PORT,
  host: process.env.LIFEOS_SERVER_HOST,
  token: process.env.LIFEOS_SERVER_TOKEN,
  healthSnapshotsPath: process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH,
};

process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH = sideEffectProbePath;
const { handleHealthConnectRoute } = await import('../src/routes/health-connect');
ensure(!existsSync(sideEffectProbePath), 'importing health-connect route module should not touch health snapshots file path');

const nonHealthHandled = await handleHealthConnectRoute(
  { method: 'GET' },
  {},
  '/health',
  {
    assertAuth: () => ({ ok: true, localDevelopment: false, statusCode: 200, message: '', principalId: null, mcpScope: null }),
    readJsonBody: async () => ({}),
  },
);
ensure(nonHealthHandled === false, 'health-connect handler should only claim health/connect routes');

process.env.PORT = '0';
process.env.LIFEOS_SERVER_HOST = '127.0.0.1';
process.env.LIFEOS_SERVER_TOKEN = token;
process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH = snapshotPath;
const { server } = await import('../src/index');
if (!server.listening) await once(server, 'listening');
const address = server.address();
ensure(address !== null && typeof address !== 'string', 'server should expose an ephemeral TCP address');
const base = `http://127.0.0.1:${address.port}`;

const validSnapshot = {
  availability: 'available',
  granted: ['read:steps', 'read:weight'],
  observedAt: '2026-07-29T00:00:00.000Z',
  range: {
    startTime: '2026-07-28T00:00:00.000Z',
    endTime: '2026-07-29T00:00:00.000Z',
  },
  records: {
    steps: [{ count: 1234 }],
    weight: [{ value: 82 }],
  },
};

async function postJson(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function postRawJson(path: string, body: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body,
  });
}

try {
  const unauth = await fetch(`${base}/health/connect/snapshots`);
  ensure(unauth.status === 401, `health connect should require bearer token, got ${unauth.status}`);

  const invalid = await postRawJson('/health/connect/snapshot', '{this-is-not-json}');
  ensure(invalid.status === 400, `invalid JSON payload should be rejected, got ${invalid.status}`);

  const before = await readJson(await fetch(`${base}/health/connect/snapshots`, {
    headers: { authorization: `Bearer ${token}` },
  }));
  ensure(Array.isArray(before.snapshots) && before.snapshots.length === 0, 'initial snapshots should be empty');

  const stored = await readJson(await postJson('/health/connect/snapshot', validSnapshot));
  ensure(stored.status === 'stored' || stored.status === 'duplicate', `snapshot store status should succeed, got ${String(stored.status)}`);

  const list = await readJson(await fetch(`${base}/health/connect/snapshots`, {
    headers: { authorization: `Bearer ${token}` },
  }));
  const rows = list.snapshots as Array<{ id: string; content_hash: string }>;
  ensure(Array.isArray(rows) && rows.length === 1, 'snapshot list should include stored snapshot');

  const exportResponse = await fetch(`${base}/health/connect/export`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const exportBody = await readJson(exportResponse);
  ensure(exportResponse.headers.get('content-disposition')?.includes('utopia-health-connect-export.json') === true, 'export endpoint should set attachment filename');
  const exportedRows = exportBody.snapshots as Array<unknown>;
  ensure(Array.isArray(exportedRows) && exportedRows.length === 1, 'exported snapshot payload should include one snapshot');

  const removed = await readJson(await fetch(`${base}/health/connect/snapshot/${encodeURIComponent(rows[0]!.id)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }));
  ensure(removed.status === 'deleted', 'snapshot delete should succeed');

  const deletedList = await readJson(await fetch(`${base}/health/connect/snapshots`, {
    headers: { authorization: `Bearer ${token}` },
  }));
  const remaining = deletedList.snapshots as Array<unknown>;
  ensure(Array.isArray(remaining) && remaining.length === 0, 'snapshot should be removed after delete');

  const rootRoute = await fetch(`${base}/health/connect`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const rootRouteBody = await readJson(rootRoute);
  ensure(rootRoute.status === 400, `unsupported health/connect path should return route-not-found status, got ${rootRoute.status}`);
  ensure(String(rootRouteBody.message) === 'Route not found', 'health/connect unsupported path should return route-not-found response');

  console.log('PASS server/test/health-connect-route-contract.ts');
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  if (previousEnv.port === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = previousEnv.port;
  }
  if (previousEnv.host === undefined) {
    delete process.env.LIFEOS_SERVER_HOST;
  } else {
    process.env.LIFEOS_SERVER_HOST = previousEnv.host;
  }
  if (previousEnv.token === undefined) {
    delete process.env.LIFEOS_SERVER_TOKEN;
  } else {
    process.env.LIFEOS_SERVER_TOKEN = previousEnv.token;
  }
  if (previousEnv.healthSnapshotsPath === undefined) {
    delete process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH;
  } else {
    process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH = previousEnv.healthSnapshotsPath;
  }
  rmSync(dir, { recursive: true, force: true });
}
