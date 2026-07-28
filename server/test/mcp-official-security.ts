import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port = 8904;
const base = `http://127.0.0.1:${port}`;
const foodToken = 'mcp-official-food-token';
const healthToken = 'mcp-official-health-token';
const unscopedToken = 'mcp-official-unscoped-token';
const stateDir = mkdtempSync(join(tmpdir(), 'utopia-mcp-security-'));

process.env.WONDER_RUNTIME_STATE_PATH = join(stateDir, 'wonder-runtime.json');
delete process.env.LIFEOS_LOCAL_DEV;
delete process.env.LIFEOS_SERVER_TOKEN;
delete process.env.LIFEOS_MCP_TOKEN;
delete process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON;
delete process.env.LIFEOS_MCP_TRUSTED_PRINCIPAL;
delete process.env.LIFEOS_MCP_TRUSTED_DOMAINS;

const { handleMcpRequest } = await import('../src/mcp/official-server');
const { createActionEvent, createRecord, findRecord } = await import('../src/runtime/state');

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response) {
  return (await response.json()) as {
    jsonrpc?: string;
    result?: Record<string, unknown>;
    error?: { code?: number; message?: string };
  };
}

async function readText(response: Response) {
  return response.text();
}

async function postMcp(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const httpServer = createServer(async (req, res) => {
  if (req.url?.startsWith('/mcp')) {
    await handleMcpRequest(req, res);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

await new Promise<void>((resolve, reject) => {
  httpServer.listen(port, '127.0.0.1', () => resolve());
  httpServer.on('error', reject);
});

try {
  const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2026-03-11',
      capabilities: {},
      clientInfo: { name: 'mcp-security-test', version: '1' },
    },
  };

  const failClosed = await postMcp(initializeBody);
  const failClosedBody = await readText(failClosed);
  ensure(failClosed.status === 503, `official MCP should fail closed without configured token, got ${failClosed.status}`);
  ensure(failClosedBody.includes('not configured'), 'MCP fail-closed response should explain missing token');

  process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON = JSON.stringify([
    { token: foodToken, principal: 'food-principal', domains: ['food'] },
    { token: healthToken, principal: 'health-principal', domains: ['health'] },
    { token: unscopedToken, principal: 'observer' },
  ]);

  createRecord({
    id: 'food-scope-record',
    domain: 'food',
    collection: 'inventory',
    title: 'Food scope marker',
    properties: { marker: 'food-visible' },
    relations: [],
    source: {
      provider: 'user',
      external_id: 'food-scope-record',
      url: null,
      observed_at: new Date().toISOString(),
      content_hash: null,
    },
    archived_at: null,
  });
  createRecord({
    id: 'health-scope-record',
    domain: 'health',
    collection: 'health_note',
    title: 'Secret health marker',
    properties: { marker: 'health-hidden' },
    relations: [],
    source: {
      provider: 'user',
      external_id: 'health-scope-record',
      url: null,
      observed_at: new Date().toISOString(),
      content_hash: null,
    },
    archived_at: null,
  });
  createActionEvent({
    id: 'health-scope-action',
    actor: 'health-principal',
    domain: 'health',
    tool: 'utopia.create_record',
    risk: 'low',
    recordIds: ['health-scope-record'],
    command: 'create health note',
    status: 'completed',
    undoPayload: { operation: 'delete_record', record_id: 'health-scope-record' },
  });

  const missingToken = await postMcp(initializeBody);
  const missingTokenBody = await readText(missingToken);
  ensure(missingToken.status === 401, `official MCP should reject missing bearer token, got ${missingToken.status}`);
  ensure(missingTokenBody.includes('Missing mcp bearer token'), 'missing MCP token response should be explicit');

  const wrongToken = await postMcp(initializeBody, { authorization: 'Bearer wrong-token' });
  const wrongTokenBody = await readText(wrongToken);
  ensure(wrongToken.status === 401, `official MCP should reject wrong bearer token, got ${wrongToken.status}`);
  ensure(wrongTokenBody.includes('Invalid mcp bearer token'), 'wrong MCP token response should be explicit');

  const initialize = await postMcp(initializeBody, { authorization: `Bearer ${foodToken}` });
  const initializeResult = await readJson(initialize);
  ensure(initialize.status === 200, `authorized initialize should succeed, got ${initialize.status}`);
  ensure(typeof initializeResult.result?.protocolVersion === 'string', 'authorized initialize should return protocolVersion');

  const scopedList = await postMcp(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
      params: {},
    },
    {
      authorization: `Bearer ${foodToken}`,
    },
  );
  const scopedListBody = await readJson(scopedList);
  const scopedResources = Array.isArray(scopedListBody.result?.resources)
    ? scopedListBody.result?.resources as Array<{ uri?: unknown }>
    : [];
  const scopedUris = scopedResources.map((resource) => String(resource.uri));
  ensure(scopedList.status === 200, `scoped resources/list should succeed, got ${scopedList.status}`);
  ensure(scopedUris.includes('utopia://manifest/food'), 'food scope should retain food manifest');
  ensure(!scopedUris.includes('utopia://manifest/health'), 'food scope should hide health manifest');
  ensure(!scopedUris.includes('utopia://domain/health'), 'food scope should hide health domain resource');
  ensure(scopedUris.includes('utopia://records'), 'trusted scoped token should retain filtered records index');
  ensure(scopedUris.includes('utopia://actions'), 'trusted scoped token should retain filtered actions index');
  ensure(scopedUris.includes('utopia://workflows'), 'trusted scoped token should retain filtered workflows index');
  ensure(scopedUris.includes('utopia://conversations'), 'trusted scoped token should retain filtered conversations index');

  const scopedTools = await postMcp(
    { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} },
    { authorization: `Bearer ${foodToken}` },
  );
  const scopedToolsBody = await readJson(scopedTools);
  ensure(scopedTools.status === 200, `scoped tools/list should succeed, got ${scopedTools.status}`);
  ensure(!JSON.stringify(scopedToolsBody).toLowerCase().includes('health'), 'food tools/list must not reveal health-specific capability');

  const principalBoundCall = await postMcp(
    {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'utopia.propose_app_link',
        arguments: {
          requestId: 'trusted-principal-binding',
          actor: 'caller-forged-principal',
          actions: [{ type: 'inventory.add', name: 'Eggs' }],
        },
      },
    },
    { authorization: `Bearer ${foodToken}` },
  );
  const principalBoundBody = await readJson(principalBoundCall);
  const principalBoundContent = Array.isArray(principalBoundBody.result?.content)
    ? principalBoundBody.result?.content as Array<{ text?: unknown }>
    : [];
  const principalBoundPayload = JSON.parse(String(principalBoundContent[0]?.text || '{}')) as { actor?: unknown };
  ensure(principalBoundPayload.actor === 'food-principal', 'MCP actor must be bound to trusted token principal');

  async function expectFoodToolDenied(
    id: number,
    name: string,
    args: Record<string, unknown>,
  ) {
    const response = await postMcp(
      { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
      { authorization: `Bearer ${foodToken}` },
    );
    const body = await readJson(response);
    ensure(Boolean(body.error), `${name} should reject a health-scoped target`);
    ensure(body.error?.code === -32001, `${name} should fail as an authorization denial`);
    ensure(String(body.error?.message).includes('not authorized'), `${name} should explain scope denial`);
    if (name === 'utopia.read_record') {
      ensure(!JSON.stringify(body).toLowerCase().includes('health'), 'record-id denial must not disclose the target domain');
    }
  }

  await expectFoodToolDenied(22, 'utopia.search_records', {
    domain: 'health',
    collection: 'health_note',
    query: 'Secret health marker',
  });
  await expectFoodToolDenied(23, 'utopia.read_record', { id: 'health-scope-record' });
  await expectFoodToolDenied(24, 'utopia.create_record', {
    domain: 'health',
    collection: 'health_note',
    id: 'health-cross-create',
    title: 'Cross-domain create',
  });
  await expectFoodToolDenied(25, 'utopia.update_record', {
    id: 'health-scope-record',
    domain: 'food',
    data_home: 'local_sqlite',
    patch: { title: 'Cross-domain update' },
  });
  await expectFoodToolDenied(26, 'utopia.archive_record', {
    id: 'health-scope-record',
    domain: 'food',
    data_home: 'local_sqlite',
  });
  await expectFoodToolDenied(27, 'utopia.run_workflow', {
    workflow: 'weekly_food_reset',
    domain: 'health',
  });
  await expectFoodToolDenied(28, 'utopia.undo_action', { actionId: 'health-scope-action' });
  await expectFoodToolDenied(29, 'utopia.get_resource', { uri: 'utopia://manifest/health' });

  const protectedHealthRecord = findRecord('health-scope-record');
  ensure(protectedHealthRecord?.title === 'Secret health marker', 'denied health update must not mutate target');
  ensure(protectedHealthRecord?.archived_at === null, 'denied health archive/undo must not mutate target');

  const scopedCatalog = await postMcp(
    {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'utopia.get_resource',
        arguments: { uri: 'utopia://domain-catalog' },
      },
    },
    { authorization: `Bearer ${foodToken}` },
  );
  const scopedCatalogBody = await readJson(scopedCatalog);
  ensure(scopedCatalog.status === 200, `scoped domain catalog should be readable, got ${scopedCatalog.status}`);
  ensure(!JSON.stringify(scopedCatalogBody).toLowerCase().includes('health'), 'food get_resource must filter health catalog metadata');

  const scopedRead = await postMcp(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'utopia://manifest/health' },
    },
    {
      authorization: `Bearer ${foodToken}`,
    },
  );
  const scopedReadBody = await readJson(scopedRead);
  ensure(
    scopedRead.status === 400 || scopedRead.status === 200,
    `scoped resources/read should return JSON-RPC error envelope, got HTTP ${scopedRead.status}`,
  );
  ensure(Boolean(scopedReadBody.error), 'cross-tenant resources/read should fail');
  ensure(String(scopedReadBody.error?.message).includes('not readable'), 'cross-tenant resources/read should explain scope denial');

  const healthScopedList = await postMcp(
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
      params: {},
    },
    {
      authorization: `Bearer ${healthToken}`,
    },
  );
  const healthScopedListBody = await readJson(healthScopedList);
  const healthResources = Array.isArray(healthScopedListBody.result?.resources)
    ? healthScopedListBody.result?.resources as Array<{ uri?: unknown }>
    : [];
  const healthUris = healthResources.map((resource) => String(resource.uri));
  ensure(healthScopedList.status === 200, `health-scoped resources/list should succeed, got ${healthScopedList.status}`);
  ensure(healthUris.includes('utopia://manifest/health'), 'health scope should retain health manifest');
  ensure(!healthUris.includes('utopia://manifest/food'), 'health scope should hide food manifest');

  const forgedScope = await postMcp(
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/list',
      params: {},
    },
    {
      authorization: `Bearer ${foodToken}`,
      'x-utopia-domain-scope': 'health',
    },
  );
  const forgedScopeBody = await readText(forgedScope);
  ensure(forgedScope.status === 403, `forged MCP scope header should be rejected, got ${forgedScope.status}`);
  ensure(forgedScopeBody.includes('trusted server configuration'), 'forged scope denial should explain trusted config');

  const forgedPrincipal = await postMcp(
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'resources/list',
      params: {},
    },
    {
      authorization: `Bearer ${foodToken}`,
      'x-utopia-principal': 'health-principal',
    },
  );
  const forgedPrincipalBody = await readText(forgedPrincipal);
  ensure(forgedPrincipal.status === 403, `forged MCP principal header should be rejected, got ${forgedPrincipal.status}`);
  ensure(forgedPrincipalBody.includes('trusted server configuration'), 'forged principal denial should explain trusted config');

  const unscopedList = await postMcp(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/list',
      params: {},
    },
    {
      authorization: `Bearer ${unscopedToken}`,
    },
  );
  const unscopedListBody = await readJson(unscopedList);
  const unscopedResources = Array.isArray(unscopedListBody.result?.resources)
    ? unscopedListBody.result?.resources as Array<{ uri?: unknown }>
    : [];
  const unscopedUris = unscopedResources.map((resource) => String(resource.uri));
  ensure(unscopedList.status === 200, `unscoped resources/list should succeed, got ${unscopedList.status}`);
  ensure(unscopedUris.includes('utopia://schema/command.v1'), 'unscoped token should retain domain-neutral schema resources');
  ensure(!unscopedUris.includes('utopia://agent-registry-v1'), 'unscoped token should hide domain-bearing agent registry');
  ensure(!unscopedUris.includes('utopia://domain-catalog'), 'unscoped token should hide domain catalog');
  ensure(!unscopedUris.includes('utopia://records'), 'unscoped token should hide records index');
  ensure(!unscopedUris.includes('utopia://actions'), 'unscoped token should hide actions index');
  ensure(!unscopedUris.includes('utopia://workflows'), 'unscoped token should hide workflows index');
  ensure(!unscopedUris.includes('utopia://conversations'), 'unscoped token should hide conversations index');
  ensure(!unscopedUris.includes('utopia://manifest/food'), 'unscoped token should hide domain resources');

  const deniedGlobalIndex = await postMcp(
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/read',
      params: { uri: 'utopia://records' },
    },
    {
      authorization: `Bearer ${unscopedToken}`,
    },
  );
  const deniedGlobalIndexBody = await readJson(deniedGlobalIndex);
  ensure(
    deniedGlobalIndex.status === 400 || deniedGlobalIndex.status === 200,
    `unscoped records index read should return JSON-RPC error envelope, got HTTP ${deniedGlobalIndex.status}`,
  );
  ensure(Boolean(deniedGlobalIndexBody.error), 'unscoped records index read should fail');
  ensure(String(deniedGlobalIndexBody.error?.message).includes('not readable'), 'unscoped records index denial should explain scope denial');

  const oversizedMcp = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${foodToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 9,
      method: 'initialize',
      params: {
        protocolVersion: '2026-03-11',
        blob: 'x'.repeat((260 * 1024)),
      },
    }),
  });
  const oversizedMcpBody = await readText(oversizedMcp);
  ensure(oversizedMcp.status === 413, `official MCP should reject oversized body, got ${oversizedMcp.status}`);
  ensure(oversizedMcpBody.includes('Limit is'), 'oversized MCP response should mention the byte limit');

  console.log('PASS server/test/mcp-official-security.ts');
} finally {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  rmSync(stateDir, { recursive: true, force: true });
}
