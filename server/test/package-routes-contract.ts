import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PackageRegistry } from '../src/kernel/package-registry';
import { handlePackageRoutes } from '../src/routes/package-routes';

function appPackage(version = '1.0.0') {
  return {
    schemaVersion: 'wonder.app-package.v2',
    id: 'route-ledger',
    version,
    collections: { records: { id: 'records', fields: { title: { type: 'text' } } } },
    queries: { all: { from: 'records' } },
    views: { list: { id: 'list', query: 'all', mode: 'list', fields: ['title'] } },
    presentation: {
      label: 'Route ledger',
      homeSurface: 'records.list',
      surfaces: [{ id: 'records.list', label: 'Route ledger', collections: ['records'] }],
    },
    rules: [],
    capabilities: [],
    acceptanceTests: ['package-route-contract'],
  };
}

function createResponse() {
  const headers = new Map<string, string>();
  let body = '';
  return {
    statusCode: 0,
    headers,
    get body() {
      return body;
    },
    set body(value: string) {
      body = value;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(chunk?: string | Buffer) {
      body = typeof chunk === 'string' ? chunk : chunk ? Buffer.from(chunk).toString('utf8') : '';
    },
  };
}

function parseBody(response: ReturnType<typeof createResponse>) {
  return response.body ? JSON.parse(response.body) as Record<string, unknown> : {};
}

const dir = mkdtempSync(join(tmpdir(), 'utopia-package-routes-'));
const registryPath = join(dir, 'registry.json');
const registry = new PackageRegistry({ path: registryPath });
registry.activate(appPackage('1.0.0'));

let installReactiveRuntimeCalls = 0;
let bodyReads = 0;

const allowAuth: () => { ok: boolean } = () => ({ ok: true });
const denyAuth: () => { ok: boolean } | null = () => null;

async function invoke(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  auth: () => { ok: boolean } | null = allowAuth,
) {
  const response = createResponse();
  bodyReads = 0;
  const handled = await handlePackageRoutes(
    { method, headers: {} },
    response,
    path,
    {
      assertAuth: auth,
      readJsonBody: async () => {
        bodyReads += 1;
        return body ?? {};
      },
      packageRegistry: () => registry,
      installReactiveRuntime: () => {
        installReactiveRuntimeCalls += 1;
      },
    },
  );
  return { handled, response, bodyReads };
}

try {
  const denied = await invoke('/packages/active', 'GET', undefined, denyAuth);
  assert.equal(denied.handled, true);
  assert.equal(denied.bodyReads, 0);

  const active = await invoke('/packages/active', 'GET');
  assert.equal(active.response.statusCode, 200);
  assert.equal(parseBody(active.response).status, 'ok');
  assert.equal((parseBody(active.response).active as { version?: string }).version, '1.0.0');

  const invalidPreview = await invoke('/packages/preview', 'POST', { package: { schemaVersion: 'wonder.app-package.v2' } });
  assert.equal(invalidPreview.response.statusCode, 200);
  assert.equal(parseBody(invalidPreview.response).status, 'invalid');

  const previewChange = registry.previewChange({
    requestedBy: 'route-test',
    patch: [{ op: 'replace', path: '/version', value: '2.0.0' }],
  });
  assert.equal(previewChange.status, 'valid');

  const changeActivated = await invoke('/packages/change/activate', 'POST', {
    request: {
      requestedBy: 'route-test',
      patch: [{ op: 'replace', path: '/version', value: '2.0.0' }],
    },
    approval: {
      schemaVersion: 'wonder.package-change-approval.v1',
      approved: true,
      requestHash: previewChange.requestHash,
      packageHash: previewChange.packageHash,
      approvedBy: 'route-test',
      approvedAt: '2026-07-29T00:00:00.000Z',
    },
  });
  assert.equal(changeActivated.response.statusCode, 200);
  assert.equal(parseBody(changeActivated.response).status, 'activated');
  assert.equal((parseBody(changeActivated.response).active as { version?: string }).version, '2.0.0');
  assert.equal(installReactiveRuntimeCalls, 1);

  const disabled = await invoke('/packages/activate', 'POST', {});
  assert.equal(disabled.response.statusCode, 400);
  assert.equal(
    String(parseBody(disabled.response).message),
    'Direct package activation is disabled. Use /packages/change/preview then /packages/change/activate with a hash-bound approval receipt.',
  );

  const rollback = await invoke('/packages/rollback', 'POST', {});
  assert.equal(rollback.response.statusCode, 200);
  assert.equal(parseBody(rollback.response).status, 'rolled_back');
  assert.equal((parseBody(rollback.response).active as { version?: string }).version, '1.0.0');
  assert.equal(installReactiveRuntimeCalls, 2);

  const notFound = await invoke('/packages/unknown', 'GET');
  assert.equal(notFound.response.statusCode, 400);
  assert.equal(String(parseBody(notFound.response).message), 'Route not found');

  console.log('PASS server/test/package-routes-contract.ts');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
