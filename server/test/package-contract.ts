import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateAppPackage } from '../src/kernel/package';

const pkg = {
  schemaVersion: 'wonder.app-package.v2',
  id: 'decision-ledger',
  version: '1.0.0',
  collections: { decisions: { id: 'decisions', fields: { state: { type: 'text', indexed: true } } } },
  queries: { open: { from: 'decisions', where: { op: 'eq', field: 'state', value: 'open' } } },
  views: { inbox: { id: 'inbox', query: 'open', mode: 'table', fields: ['state'] } },
  rules: [{ id: 'require-approval', trigger: { kind: 'operation' }, effect: { kind: 'propose_operation', operation: 'approve' }, mode: 'suggest', maxRunsPerEvent: 1 }],
  capabilities: [],
  acceptanceTests: ['decision-approval-invariant'],
};

assert.equal(validateAppPackage(pkg).valid, true);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Decisions',
    homeSurface: 'decisions.inbox',
    surfaces: [{ id: 'decisions.inbox', label: 'Inbox', icon: 'inbox', collections: ['decisions'] }],
    visualIdentity: { domain: { icon: 'inbox', accent: 'blue' } },
    render: { default_title: 'Decision inbox' },
    richDetailSchema: 'schemas/decision-detail.v1.schema.json',
    providerTemplateFields: { required: ['id', 'title'] },
    sourceSchemaVersion: 'utopia.domain.v1',
  },
}).valid, true);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Food shell',
    homeSurface: 'decisions.inbox',
    surfaces: [{ id: 'decisions.inbox', label: 'Inbox', collections: ['decisions'] }],
    visualIdentity: { domain: { icon: 'inbox', accent: 'blue' } },
    ui: {
      schemaVersion: 'a2ui.v0_9',
      openUrlAllowlist: ['https://wonder.example', 'http://localhost:3000'],
      components: [
        {
          kind: 'action',
          id: 'open-home',
          title: 'Open docs',
          action: { kind: 'open_url', url: 'https://wonder.example/docs' },
        },
        {
          kind: 'action',
          id: 'propose-action',
          title: 'Propose update',
          action: { kind: 'propose', tool: 'local_query' },
        },
      ],
      screens: {
        home: {
          title: 'Home',
          subtitle: 'Primary',
          components: [
            { kind: 'text', id: 'tip', title: 'Tip', subtitle: 'Welcome to Food.' },
            { kind: 'recordList', id: 'records', title: 'Recent', query: { collections: ['decisions'], limit: 3 } },
            { kind: 'widget', widget: 'pollCard', id: 'vote', title: 'Vote', props: { options: [{ label: 'Yes' }, { label: 'No' }] } },
            { kind: 'widget', widget: 'kanbanBoard', id: 'board', title: 'Board', props: { columns: [{ title: 'Next', items: [{ title: 'Review' }] }] } },
            { kind: 'widget', widget: 'permissionCard', id: 'permissions', title: 'Permissions', props: { permissions: [{ title: 'Camera', subtitle: 'Receipt capture' }] } },
          ],
        },
      },
      defaultScreen: 'home',
    },
  },
}).valid, true);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [{ id: 'bad', label: 'Bad', collections: [], script: 'bad' }],
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [{ id: 'inbox', label: 'Inbox', collections: ['decisions'] }],
    ui: { schemaVersion: 'a2ui.v0_9', components: [{ kind: 'action', id: 'bad-open', title: 'Bad', action: { kind: 'open_url' } }] },
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [{ id: 'inbox', label: 'Inbox', collections: ['decisions'] }],
    ui: { schemaVersion: 'a2ui.v0_9', components: [{ kind: 'action', id: 'bad-propose', title: 'Bad', action: { kind: 'propose' } }] },
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [{ id: 'inbox', label: 'Inbox', collections: ['decisions'] }],
    ui: { schemaVersion: 'a2ui.v0_9', openUrlAllowlist: [''], components: [] },
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [{ id: 'inbox', label: 'Inbox', collections: ['decisions'] }],
    ui: { schemaVersion: 'a2ui.v0_9', components: [{ kind: 'widget', widget: 'rawCodeRunner', id: 'bad-widget' }] },
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    homeSurface: 'missing',
    surfaces: [{ id: 'inbox', label: 'Inbox', collections: ['decisions'] }],
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [{ id: 'inbox', label: 'Inbox', collections: ['ghosts'] }],
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  presentation: {
    label: 'Bad',
    surfaces: [
      { id: 'inbox', label: 'Inbox', collections: ['decisions'] },
      { id: 'inbox', label: 'Inbox duplicate', collections: ['decisions'] },
    ],
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  rules: [{
    id: 'typed-update',
    trigger: { kind: 'operation' },
    effect: { kind: 'propose_operation', operation: { kind: 'update_record', collection: 'decisions', recordId: 'decision-a', expectedRevision: 3, changes: { state: 'review' } } },
    mode: 'suggest',
    maxRunsPerEvent: 1,
  }],
}).valid, true);
assert.equal(validateAppPackage({ ...pkg, javascript: 'bad' }).valid, false);
assert.equal(validateAppPackage({ ...pkg, views: { inbox: { id: 'wrong', query: '', mode: 'table', fields: [] } } }).valid, false);
assert.equal(validateAppPackage({ ...pkg, queries: { inbox: { from: 'records', limit: -1 } } }).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  views: { inbox: { id: 'inbox', query: 'missing', mode: 'table', fields: ['state'] } },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  queries: { open: { from: 'ghosts' } },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  views: { inbox: { id: 'inbox', query: 'open', mode: 'table', fields: ['state'], layout: { code: 'bad' } } },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  views: { inbox: { id: 'inbox', query: 'open', mode: 'table', fields: ['state'], layout: { columns: 12 } } },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  rules: [{ id: 'loose', script: 'bad' }],
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  rules: [{ id: 'bad-rule', trigger: { kind: 'query_transition', query: 'missing' }, effect: { kind: 'propose_operation', operation: 'approve' }, mode: 'suggest', maxRunsPerEvent: 1 }],
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  rules: [{ id: 'too-many', trigger: { kind: 'operation' }, effect: { kind: 'propose_operation', operation: 'approve' }, mode: 'suggest', maxRunsPerEvent: 65 }],
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  rules: [{ id: 'bad-template', trigger: { kind: 'operation' }, effect: { kind: 'propose_operation', operation: { kind: 'create_record', collection: 'missing' } }, mode: 'suggest', maxRunsPerEvent: 1 }],
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  capabilities: ['mcp-tool:ok', 'mcp-tool:ok'],
}).valid, false);
assert.equal(validateAppPackage({
  ...pkg,
  acceptanceTests: ['bad test name'],
}).valid, false);
const pkgV3 = (() => {
  const dependencyPins = [{ package: '@a2ui/web_core/v0_9', version: '0.9.0', source: 'npm' }];
  const nativeCapabilities = {
    schemaVersion: 'wonder.app-package-native-capabilities.v1',
    platform: 'expo',
    packages: ['@a2ui/web_core/v0_9'],
    permissions: [
      {
        id: 'health-connect-read',
        platform: 'android',
        permission: 'android.permission.health.READ_NUTRITION',
        reason: 'Food-health context when enabled.',
        required: false,
        prompt: 'Allow Wonder to read nutrition records for food context.',
      },
    ],
    intents: [
      {
        id: 'save-food-link',
        platform: 'expo',
        kind: 'share',
        reason: 'Let users send food links into the package.',
        required: false,
        payload: { accepts: ['url', 'text'], target: 'food.capture' },
      },
    ],
  };
  return {
    ...pkg,
    schemaVersion: 'wonder.app-package.v3',
    dependencyPins,
    nativeCapabilities,
    contractLock: {
      schemaVersion: 'wonder.package-contract-lock.v1',
      algorithm: 'sha256',
      checksum: 'sha256:placeholder',
      pinnedAt: '2026-07-24T00:00:00.000Z',
      dependencyPins,
      nativeCapabilities,
    },
  };
})();
pkgV3.contractLock.checksum = `sha256:${createHash('sha256').update(stableJson({
  schemaVersion: pkgV3.contractLock.schemaVersion,
  algorithm: pkgV3.contractLock.algorithm,
  pinnedAt: pkgV3.contractLock.pinnedAt,
  dependencyPins: pkgV3.dependencyPins,
  nativeCapabilities: pkgV3.nativeCapabilities,
})).digest('hex')}`;
assert.equal(validateAppPackage(pkgV3).valid, true);
assert.equal(validateAppPackage(withNativeCapabilities(pkgV3, {
  ...pkgV3.nativeCapabilities,
  intents: [
    ...(pkgV3.nativeCapabilities.intents ?? []),
    {
      id: 'unsupported-voice',
      platform: 'android',
      kind: 'voice',
      reason: 'Voice routing is not implemented in the shell yet.',
      required: false,
      payload: {},
    },
  ],
})).valid, false);
assert.equal(validateAppPackage({
  ...pkgV3,
  contractLock: {
    ...pkgV3.contractLock,
    checksum: 'sha256:0',
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkgV3,
  nativeCapabilities: {
    ...pkgV3.nativeCapabilities,
    permissions: [
      ...pkgV3.nativeCapabilities.permissions,
      {
        id: 'forged-camera',
        platform: 'android',
        permission: 'android.permission.CAMERA',
        reason: 'Forged runtime permission.',
        required: true,
      },
    ],
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkgV3,
  nativeCapabilities: {
    ...pkgV3.nativeCapabilities,
    intents: [
      ...(pkgV3.nativeCapabilities.intents ?? []),
      {
        id: 'bad-intent',
        platform: 'android',
        kind: 'shell_exec',
        reason: 'Bad native intent.',
      },
    ],
  },
}).valid, false);
assert.equal(validateAppPackage({
  ...pkgV3,
  contractLock: {
    ...pkgV3.contractLock,
    checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  },
}).valid, false);
console.log('package-contract: passed');

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

function withNativeCapabilities(base: typeof pkgV3, nativeCapabilities: any): typeof pkgV3 {
  const contractLock = {
    ...base.contractLock,
    nativeCapabilities,
  };
  contractLock.checksum = `sha256:${createHash('sha256').update(stableJson({
    schemaVersion: contractLock.schemaVersion,
    algorithm: contractLock.algorithm,
    pinnedAt: contractLock.pinnedAt,
    dependencyPins: contractLock.dependencyPins,
    nativeCapabilities,
  })).digest('hex')}`;
  return {
    ...base,
    nativeCapabilities,
    contractLock,
  };
}
