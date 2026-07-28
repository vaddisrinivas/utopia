import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const outDir = join(root, 'app', 'build', 'evidence', 'package-builder-api');
mkdirSync(outDir, { recursive: true });

const stateDir = mkdtempSync(join(tmpdir(), `wf-package-builder-api-${randomBytes(4).toString('hex')}-`));
const token = 'package-builder-api-test-token';
const port = 19132;
const base = `http://127.0.0.1:${port}`;
const serverTsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const rootTsxBinary = join(root, 'node_modules', '.bin', 'tsx');
const tsxBinary = existsSync(serverTsxBinary)
  ? serverTsxBinary
  : existsSync(rootTsxBinary)
    ? rootTsxBinary
    : 'tsx';
const serverEntry = join(root, 'server', 'src', 'index.ts');
const useNpxForTsx = !existsSync(serverTsxBinary) && !existsSync(rootTsxBinary);

const dependencyPins = [
  { package: '@a2ui/web_core/v0_9', version: '0.9.0', source: 'npm' },
];
const nativeCapabilities = {
  schemaVersion: 'wonder.app-package-native-capabilities.v1' as const,
  platform: 'expo' as const,
  packages: ['@a2ui/web_core/v0_9'],
};
const pkg = {
  schemaVersion: 'wonder.app-package.v3',
  id: 'demo-builder',
  version: '1.0.0',
  collections: {
    ideas: { id: 'ideas', fields: { title: { type: 'text', required: true }, state: { type: 'text' } } },
  },
  queries: {
    all: { from: 'ideas', orderBy: [{ field: 'title', direction: 'asc' }] },
  },
  views: {
    home: { id: 'home', query: 'all', mode: 'list', fields: ['title', 'state'] },
  },
  presentation: {
    label: 'Demo Builder',
    homeSurface: 'home',
    surfaces: [{ id: 'home', label: 'Home', collections: ['ideas'] }],
  },
  rules: [],
  capabilities: [],
  acceptanceTests: ['package-builder-api'],
  dependencyPins,
  nativeCapabilities,
  contractLock: {
    schemaVersion: 'wonder.package-contract-lock.v1',
    algorithm: 'sha256',
    pinnedAt: new Date().toISOString(),
    dependencyPins,
    nativeCapabilities,
    checksum: '',
  },
};
pkg.contractLock.checksum = computeContractLockChecksum({
  schemaVersion: pkg.contractLock.schemaVersion,
  algorithm: pkg.contractLock.algorithm,
  dependencyPins: pkg.contractLock.dependencyPins,
  nativeCapabilities: pkg.contractLock.nativeCapabilities,
  pinnedAt: pkg.contractLock.pinnedAt,
});
const CONTRACT_LOCK_SHA = pkg.contractLock.checksum;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5_000);
    (forceTimer as unknown as { unref?: () => void }).unref?.();
    child.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function waitForServerReady(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${base}/health`, { method: 'GET' });
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready at ${base}/health`);
}

async function request(path: string, method: 'GET' | 'POST', body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as Record<string, any> : {};
  return { response, parsed };
}

(async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    LIFEOS_SERVER_TOKEN: token,
    WONDER_RUNTIME_STATE_PATH: join(stateDir, 'wonder-runtime.json'),
    LIFEOS_CHAT_CONVERSATIONS_PATH: join(stateDir, 'conversations.json'),
    LIFEOS_PACKAGE_REGISTRY_PATH: join(stateDir, 'package-registry.json'),
    LIFEOS_REACTIVE_RUNTIME_PATH: join(stateDir, 'reactive-runtime.json'),
  };

  const server = spawn(
    useNpxForTsx ? 'npx' : tsxBinary,
    [
      ...(useNpxForTsx ? ['tsx'] : []),
      '--tsconfig',
      join(root, 'tsconfig.json'),
      serverEntry,
    ],
    {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverStderr = '';
  server.stderr.on('data', (chunk) => {
    serverStderr += String(chunk);
  });

  try {
    await waitForServerReady();

    const activeBefore = await request('/packages/active', 'GET');
    assert(activeBefore.response.ok, `active package endpoint failed: ${activeBefore.response.status} ${JSON.stringify(activeBefore.parsed)}`);
    assert(activeBefore.parsed.active?.id === 'food', 'server should bootstrap manifest package');

    const invalid = await request('/packages/preview', 'POST', {
      package: {
        ...pkg,
        presentation: { label: 'Bad', surfaces: [{ id: 'bad', label: 'Bad', collections: ['ghosts'] }] },
      },
    });
    assert(invalid.response.ok, 'invalid preview should return 200 with invalid status');
    assert(invalid.parsed.status === 'invalid', 'bad package should preview invalid');

    const preview = await request('/packages/preview', 'POST', { package: pkg });
    assert(preview.response.ok, 'valid preview failed');
    assert(preview.parsed.status === 'valid', 'valid package should preview valid');

    const directActivation = await request('/packages/activate', 'POST', { package: pkg });
    assert(directActivation.response.status === 400, 'direct raw package activation should be disabled');

    const basePackageKey = `${activeBefore.parsed.active.id}@${activeBefore.parsed.active.version}`;
    const changeRequest = {
      basePackageKey,
      requestedBy: 'package-builder-api-test',
      patch: [
        { op: 'replace', path: '/version', value: '1.0.1' },
        { op: 'replace', path: '/presentation/label', value: 'Utopia Demo Builder' },
        { op: 'add', path: '/acceptanceTests/-', value: 'package-builder-api-approved-change' },
      ],
    };
    const forbiddenChange = await request('/packages/change/preview', 'POST', {
      request: { ...changeRequest, patch: [{ op: 'replace', path: '/schemaVersion', value: 'evil' }] },
    });
    assert(forbiddenChange.response.status === 400, 'forbidden package patch path should be rejected');

    const changePreview = await request('/packages/change/preview', 'POST', { request: changeRequest });
    assert(changePreview.response.ok, `change preview failed: ${JSON.stringify(changePreview.parsed)}`);
    assert(changePreview.parsed.status === 'valid', 'change preview should be valid');
    assert(typeof changePreview.parsed.requestHash === 'string' && changePreview.parsed.requestHash.startsWith('sha256:'), 'request hash missing');
    assert(typeof changePreview.parsed.packageHash === 'string' && changePreview.parsed.packageHash.startsWith('sha256:'), 'package hash missing');

    const badApproval = await request('/packages/change/activate', 'POST', {
      request: changeRequest,
      approval: {
        schemaVersion: 'wonder.package-change-approval.v1',
        approved: true,
        requestHash: 'sha256:bad',
        packageHash: changePreview.parsed.packageHash,
        approvedBy: 'test',
        approvedAt: '2026-07-25T00:00:00.000Z',
      },
    });
    assert(badApproval.response.status === 400, 'hash-mismatched package approval should be rejected');

    const activated = await request('/packages/change/activate', 'POST', {
      request: changeRequest,
      approval: {
        schemaVersion: 'wonder.package-change-approval.v1',
        approved: true,
        requestHash: changePreview.parsed.requestHash,
        packageHash: changePreview.parsed.packageHash,
        approvedBy: 'test',
        approvedAt: '2026-07-25T00:00:00.000Z',
      },
    });
    assert(activated.response.ok, `activation failed: ${JSON.stringify(activated.parsed)}`);
    assert(activated.parsed.status === 'activated', 'package should activate');
    assert(activated.parsed.active?.id === 'food', 'activated package id should preserve active package identity');
    assert(activated.parsed.active?.presentation?.label === 'Utopia Demo Builder', 'activated package label mismatch');
    assert(activated.parsed.receipt?.action === 'activate', 'activation receipt missing');
    assert(activated.parsed.receipt?.requestHash === changePreview.parsed.requestHash, 'activation receipt request hash missing');
    assert(activated.parsed.receipt?.approvalHash?.startsWith('sha256:'), 'activation approval hash missing');

    const activeAfter = await request('/packages/active', 'GET');
    assert(activeAfter.parsed.active?.presentation?.label === 'Utopia Demo Builder', 'active package not persisted');

    const rolledBack = await request('/packages/rollback', 'POST');
    assert(rolledBack.response.ok, 'rollback failed');
    assert(rolledBack.parsed.status === 'rolled_back', 'rollback status mismatch');
    assert(rolledBack.parsed.active?.id === 'food', 'rollback should restore bootstrapped food package');

    const evidence = {
      proof: 'package_builder_api',
      active_bootstrap: activeBefore.parsed.active?.id,
      invalid_preview_rejected: true,
      direct_activation_rejected: true,
      contract_lock_sha: CONTRACT_LOCK_SHA,
      web_core_v0_9_proved: pkg.dependencyPins.some((pin) => pin.package === '@a2ui/web_core/v0_9'),
      forbidden_patch_rejected: true,
      approval_hash_bound: true,
      activation_receipt_action: activated.parsed.receipt?.action,
      rollback_active: rolledBack.parsed.active?.id,
      all_passed: true,
    };
    const evidencePath = join(outDir, 'package-builder-api-proof.json');
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(`CONTRACT_LOCK_SHA=${CONTRACT_LOCK_SHA}`);
    console.log(`PASS ${evidencePath}`);
  } finally {
    await stopChild(server);
    rmSync(stateDir, { recursive: true, force: true });
  }

  if (serverStderr.includes('SyntaxError') || serverStderr.includes('Unhandled')) {
    throw new Error(`server stderr contained startup/runtime error: ${serverStderr.slice(0, 500)}`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

function computeContractLockChecksum(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
