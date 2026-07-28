import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8903;
const base = `http://127.0.0.1:${port}`;
const token = 'ingress-security-test-token';

process.env.PORT = String(port);
process.env.LIFEOS_SERVER_HOST = '127.0.0.1';
delete process.env.LIFEOS_LOCAL_DEV;
delete process.env.LIFEOS_SERVER_TOKEN;
delete process.env.LIFEOS_MCP_TOKEN;
delete process.env.LIFEOS_MCP_TRUSTED_TOKENS_JSON;
delete process.env.LIFEOS_MCP_TRUSTED_PRINCIPAL;
delete process.env.LIFEOS_MCP_TRUSTED_DOMAINS;
process.env.NOTION_TOKEN = 'status-notion-token';
process.env.NOTION_DATA_SOURCE_ID = 'status-notion-source';
process.env.GOOGLE_SHEETS_ACCESS_TOKEN = 'status-sheets-token';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'status-sheet-id';
process.env.GOOGLE_SHEETS_DATA_SOURCE_ID = 'status-sheet-source';
process.env.LIFEOS_REQUEST_DEADLINE_MS = '900';
process.env.LIFEOS_BODY_CHUNK_TIMEOUT_MS = '400';
process.env.LIFEOS_HEADER_TIMEOUT_MS = '500';
process.env.LIFEOS_MAX_HEADER_COUNT = '24';
process.env.LIFEOS_MAX_HEADER_BYTES = '2048';

const { server } = await import('../src/index');
await delay(25);

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function chunkedPost(
  path: string,
  bodyChunks: string[],
  authorization?: string,
  options: { delayMsBetweenChunks?: number; headers?: Record<string, string> } = {},
) {
  return new Promise<{ statusCode: number; body: string; errorCode?: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      },
    );

    req.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') {
        resolve({ statusCode: 0, body: '', errorCode: 'ECONNRESET' });
        return;
      }
      reject(error);
    });
    (async () => {
      for (const chunk of bodyChunks) {
        req.write(chunk);
        if (options.delayMsBetweenChunks) {
          await delay(options.delayMsBetweenChunks);
        }
      }
      req.end();
    })().catch(reject);
  });
}

try {
  const failClosed = await fetch(`${base}/chat/threads`);
  const failClosedBody = await readJson(failClosed);
  ensure(failClosed.status === 503, `chat threads should fail closed when no server token is configured, got ${failClosed.status}`);
  ensure(String(failClosedBody.message).includes('not configured'), 'fail-closed response should explain missing server token');

  const redactedWithoutToken = await fetch(`${base}/providers/status`);
  const redactedWithoutTokenBody = await readJson(redactedWithoutToken);
  const redactedNotion = redactedWithoutTokenBody.providers as { notion?: Record<string, unknown>; google_sheets?: Record<string, unknown> };
  ensure(redactedWithoutToken.status === 200, 'providers/status should stay reachable for diagnostics');
  ensure(redactedNotion.notion?.data_source_id === null, 'providers/status should redact notion data source id without auth');
  ensure(redactedNotion.google_sheets?.spreadsheet_id === null, 'providers/status should redact spreadsheet id without auth');
  ensure(redactedNotion.google_sheets?.data_source_id === null, 'providers/status should redact sheets data source id without auth');

  process.env.LIFEOS_SERVER_TOKEN = token;

  const missingToken = await fetch(`${base}/chat/threads`);
  const missingTokenBody = await readJson(missingToken);
  ensure(missingToken.status === 401, `chat threads should reject missing bearer token, got ${missingToken.status}`);
  ensure(String(missingTokenBody.message).includes('Missing server bearer token'), 'missing token response should be explicit');

  const wrongToken = await fetch(`${base}/chat/threads`, {
    headers: { authorization: 'Bearer wrong-token' },
  });
  const wrongTokenBody = await readJson(wrongToken);
  ensure(wrongToken.status === 401, `chat threads should reject wrong bearer token, got ${wrongToken.status}`);
  ensure(String(wrongTokenBody.message).includes('Invalid server bearer token'), 'wrong token response should be explicit');

  const redactedWithMissingAuth = await fetch(`${base}/providers/status`);
  const redactedWithMissingAuthBody = await readJson(redactedWithMissingAuth);
  const missingAuthProviders = redactedWithMissingAuthBody.providers as { notion?: Record<string, unknown>; google_sheets?: Record<string, unknown> };
  ensure(missingAuthProviders.notion?.data_source_id === null, 'providers/status should still redact ids when token exists but auth is missing');

  const visibleWithAuth = await fetch(`${base}/providers/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const visibleWithAuthBody = await readJson(visibleWithAuth);
  const visibleProviders = visibleWithAuthBody.providers as { notion?: Record<string, unknown>; google_sheets?: Record<string, unknown> };
  ensure(visibleProviders.notion?.data_source_id === 'status-notion-source', 'authenticated providers/status should expose notion data source id');
  ensure(visibleProviders.google_sheets?.spreadsheet_id === 'status-sheet-id', 'authenticated providers/status should expose spreadsheet id');
  ensure(visibleProviders.google_sheets?.data_source_id === 'status-sheet-source', 'authenticated providers/status should expose sheets data source id');

  const oversizedChat = await fetch(`${base}/chat/stop`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ run_id: 'run-test', filler: 'x'.repeat((70 * 1024)) }),
  });
  const oversizedChatBody = await readJson(oversizedChat);
  ensure(oversizedChat.status === 413, `chat control ingress should reject oversized body, got ${oversizedChat.status}`);
  ensure(String(oversizedChatBody.message).includes('Limit is'), 'chat oversize response should mention the byte limit');

  const oversizedPackage = await fetch(`${base}/packages/preview`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ package: { payload: 'x'.repeat((530 * 1024)) } }),
  });
  const oversizedPackageBody = await readJson(oversizedPackage);
  ensure(oversizedPackage.status === 413, `package ingress should reject oversized body, got ${oversizedPackage.status}`);
  ensure(String(oversizedPackageBody.message).includes('Limit is'), 'package oversize response should mention the byte limit');

  const oversizedProvider = await chunkedPost(
    '/providers/sheets/sync',
    ['{"event":"', 'x'.repeat((1024 * 1024) + 8), '"}'],
    `Bearer ${token}`,
  );
  ensure(
    oversizedProvider.statusCode === 413 || oversizedProvider.errorCode === 'ECONNRESET',
    `provider ingress should reject or abort oversized chunked body, got status=${oversizedProvider.statusCode} error=${oversizedProvider.errorCode ?? 'none'}`,
  );
  if (oversizedProvider.statusCode === 413) {
    ensure(oversizedProvider.body.includes('Limit is'), 'provider chunked oversize response should mention the byte limit');
  }

  const slowBodyDeadline = await chunkedPost(
    '/providers/sheets/sync',
    ['{"event":"a', 'b', 'c', 'd', '"}'],
    `Bearer ${token}`,
    { delayMsBetweenChunks: 250 },
  );
  ensure(
    slowBodyDeadline.statusCode === 408 || slowBodyDeadline.errorCode === 'ECONNRESET',
    `provider ingress should time out slow total body reads, got status=${slowBodyDeadline.statusCode} error=${slowBodyDeadline.errorCode ?? 'none'}`,
  );
  if (slowBodyDeadline.statusCode === 408) {
    ensure(slowBodyDeadline.body.includes('deadline'), 'slow total body timeout should mention the request deadline');
  }

  const slowlorisBody = await chunkedPost(
    '/providers/sheets/sync',
    ['{"event":"hang', '"}'],
    `Bearer ${token}`,
    { delayMsBetweenChunks: 450 },
  );
  ensure(
    slowlorisBody.statusCode === 408 || slowlorisBody.errorCode === 'ECONNRESET',
    `provider ingress should time out idle slow-body reads, got status=${slowlorisBody.statusCode} error=${slowlorisBody.errorCode ?? 'none'}`,
  );
  if (slowlorisBody.statusCode === 408) {
    ensure(slowlorisBody.body.includes('without progress'), 'slowloris timeout should mention stalled body progress');
  }

  const tooManyHeaders = await chunkedPost(
    '/health',
    [],
    undefined,
    {
      headers: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`x-test-${index}`, '1'])),
    },
  );
  ensure(tooManyHeaders.statusCode === 431, `header-count protection should return 431, got ${tooManyHeaders.statusCode}`);
  ensure(tooManyHeaders.body.includes('too many headers'), 'header-count protection should explain the limit');

  const oversizedHeaders = await chunkedPost(
    '/health',
    [],
    undefined,
    {
      headers: {
        'x-large-header': 'x'.repeat(2100),
      },
    },
  );
  ensure(
    oversizedHeaders.statusCode === 431 || oversizedHeaders.statusCode === 400 || oversizedHeaders.errorCode === 'ECONNRESET',
    `header-size protection should reject oversized headers, got status=${oversizedHeaders.statusCode} error=${oversizedHeaders.errorCode ?? 'none'}`,
  );

  console.log('PASS server/test/ingress-security.ts');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
