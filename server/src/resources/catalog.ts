import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../../../src/domain/catalog';
import { findWorkflow, getActionEvent, listActionEvents, listActionUris, listRecordUris, listRecords, listWorkflows } from '../runtime/state';
import { listConversations } from '../conversations';

export type McpResource = {
  uri: string;
  name: string;
  mimeType: string;
};

export type McpResourceAuthorization =
  | { kind: 'safe-global' }
  | { kind: 'global-index' }
  | { kind: 'domain'; domain: string };

type McpResourceRecord = {
  uri: string;
  name: string;
  mimeType: string;
  path: string | undefined;
  mode: 'file' | 'dynamic';
};

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = [
  process.env.LIFEOS_PROJECT_ROOT,
  process.cwd(),
  resolve(MODULE_ROOT, '../../..'),
]
  .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  .find((candidate) => existsSync(join(candidate, 'packages/domain-config/domain-catalog.v1.json')))
  ?? process.cwd();

function resolvePath(relativePath: string) {
  return join(PROJECT_ROOT, relativePath);
}

const STATIC_RESOURCES: Record<string, McpResourceRecord> = {
  'utopia://skill/bundled-food': {
    uri: 'utopia://skill/bundled-food',
    name: 'bundled-food',
    mimeType: 'text/markdown',
    path: resolvePath('packages/domain-config/skills/food.md'),
    mode: 'file',
  },
  'utopia://skill/bundled-health': {
    uri: 'utopia://skill/bundled-health',
    name: 'bundled-health',
    mimeType: 'text/markdown',
    path: resolvePath('packages/domain-config/skills/health.md'),
    mode: 'file',
  },
  'utopia://skill/bundled-plants': {
    uri: 'utopia://skill/bundled-plants',
    name: 'bundled-plants',
    mimeType: 'text/markdown',
    path: resolvePath('packages/domain-config/skills/plants.md'),
    mode: 'file',
  },
  'utopia://agent-registry-v1': {
    uri: 'utopia://agent-registry-v1',
    name: 'agent-registry-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/agents/registry.v1.json'),
    mode: 'file',
  },
  'utopia://utopia/domain-catalog-v1': {
    uri: 'utopia://utopia/domain-catalog-v1',
    name: 'domain-catalog-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/domain-catalog.v1.json'),
    mode: 'file',
  },
  'utopia://domain-catalog-v1': {
    uri: 'utopia://domain-catalog-v1',
    name: 'domain-catalog-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/domain-catalog.v1.json'),
    mode: 'file',
  },
  'utopia://domain-catalog': {
    uri: 'utopia://domain-catalog',
    name: 'domain-catalog',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/domain-catalog.v1.json'),
    mode: 'file',
  },
  'utopia://schema/command.v1': {
    uri: 'utopia://schema/command.v1',
    name: 'command-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/schemas/command.v1.schema.json'),
    mode: 'file',
  },
  'utopia://schema/action-event.v1': {
    uri: 'utopia://schema/action-event.v1',
    name: 'action-event-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/schemas/action-event.v1.schema.json'),
    mode: 'file',
  },
  'utopia://schema/undo-v1': {
    uri: 'utopia://schema/undo-v1',
    name: 'undo-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/schemas/undo.v1.schema.json'),
    mode: 'file',
  },
  'utopia://schema/workflow.v1': {
    uri: 'utopia://schema/workflow.v1',
    name: 'workflow-v1',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/schemas/workflow.v1.schema.json'),
    mode: 'file',
  },
  'utopia://schema/domain-catalog-v1': {
    uri: 'utopia://schema/domain-catalog-v1',
    name: 'domain-catalog-v1-schema',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/schemas/domain-catalog.v1.schema.json'),
    mode: 'file',
  },
  'utopia://schema/domain.v1': {
    uri: 'utopia://schema/domain.v1',
    name: 'domain-v1-schema',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/schemas/domain.v1.schema.json'),
    mode: 'file',
  },
  'utopia://schema/proposal-package-v1': {
    uri: 'utopia://schema/proposal-package-v1',
    name: 'proposal-package-v1',
    mimeType: 'application/json',
    path: resolvePath('docs/ai/proposal-package.schema.v1.json'),
    mode: 'file',
  },
  'utopia://schema/command-envelope-v1': {
    uri: 'utopia://schema/command-envelope-v1',
    name: 'command-envelope-v1',
    mimeType: 'application/json',
    path: resolvePath('docs/ai/command-envelope.schema.v1.json'),
    mode: 'file',
  },
  'utopia://contract/app-command': {
    uri: 'utopia://contract/app-command',
    name: 'app-command',
    mimeType: 'text/markdown',
    path: resolvePath('docs/app-command-contract.md'),
    mode: 'file',
  },
  'utopia://manifest/food': {
    uri: 'utopia://manifest/food',
    name: 'manifest-food',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/domains/food.v1.json'),
    mode: 'file',
  },
  'utopia://manifest/health': {
    uri: 'utopia://manifest/health',
    name: 'manifest-health',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/domains/health.v1.json'),
    mode: 'file',
  },
  'utopia://manifest/plants': {
    uri: 'utopia://manifest/plants',
    name: 'manifest-plants',
    mimeType: 'application/json',
    path: resolvePath('packages/domain-config/domains/plants.v1.json'),
    mode: 'file',
  },
};

const SAFE_GLOBAL_RESOURCE_URIS = new Set([
  'utopia://schema/command.v1',
  'utopia://schema/action-event.v1',
  'utopia://schema/undo-v1',
  'utopia://schema/workflow.v1',
  'utopia://schema/domain-catalog-v1',
  'utopia://schema/domain.v1',
  'utopia://schema/proposal-package-v1',
  'utopia://schema/command-envelope-v1',
  'utopia://contract/app-command',
]);

const GLOBAL_INDEX_RESOURCE_URIS = new Set([
  'utopia://agent-registry-v1',
  'utopia://utopia/domain-catalog-v1',
  'utopia://domain-catalog-v1',
  'utopia://domain-catalog',
  'utopia://records',
  'utopia://actions',
  'utopia://workflows',
  'utopia://conversations',
]);

function resolveMimeType(path: string, fallback: string) {
  return fallback ?? (extname(path) === '.json' ? 'application/json' : 'text/markdown');
}

function getConversationUris(): string[] {
  try {
    const catalog = loadCatalog();
    return catalog.catalog.domains
      .map((entry) => `utopia://domain/${entry.id}`)
      .concat(catalog.catalog.domains.flatMap((entry) => [`utopia://catalog/domain/${entry.id}`]));
  } catch {
    return ['utopia://domain/food'];
  }
}

function getWorkflowUris(): string[] {
  return listWorkflows().map((workflow) => `utopia://workflow/${encodeURIComponent(workflow.id)}`);
}

function getRecordUris(): string[] {
  return listRecordUris();
}

function getActionUris(): string[] {
  return listActionUris();
}

function extractStaticDomainUri(uri: string): string | null {
  const staticMatch = uri.match(/^utopia:\/\/(?:manifest\/|skill\/bundled-|domain\/|catalog\/domain\/)([^/]+)$/);
  return staticMatch?.[1]?.trim().toLowerCase() || null;
}

function readRecordDomain(uri: string): string {
  const recordId = decodeURIComponent(uri.replace('utopia://record/', ''));
  const record = listRecords({ query: `"${recordId}"`, limit: 200, includeArchived: true }).find((entry) => entry.id === recordId);
  if (!record) {
    throw new Error(`Unknown record resource: ${uri}`);
  }
  return record.domain.trim().toLowerCase();
}

function readActionDomain(uri: string): string {
  const actionId = decodeURIComponent(uri.replace('utopia://action/', ''));
  const event = getActionEvent(actionId);
  if (!event) {
    throw new Error(`Unknown action resource: ${uri}`);
  }
  return event.domain.trim().toLowerCase();
}

function readWorkflowDomain(uri: string): string {
  const workflowId = decodeURIComponent(uri.replace('utopia://workflow/', ''));
  const workflow = findWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Unknown workflow resource: ${uri}`);
  }
  return workflow.domain.trim().toLowerCase();
}

export function describeMcpResourceAuthorization(uri: string): McpResourceAuthorization {
  if (SAFE_GLOBAL_RESOURCE_URIS.has(uri)) {
    return { kind: 'safe-global' };
  }

  if (GLOBAL_INDEX_RESOURCE_URIS.has(uri)) {
    return { kind: 'global-index' };
  }

  const staticDomain = extractStaticDomainUri(uri);
  if (staticDomain) {
    return { kind: 'domain', domain: staticDomain };
  }

  if (uri.startsWith('utopia://record/')) {
    return { kind: 'domain', domain: readRecordDomain(uri) };
  }

  if (uri.startsWith('utopia://action/')) {
    return { kind: 'domain', domain: readActionDomain(uri) };
  }

  if (uri.startsWith('utopia://workflow/')) {
    return { kind: 'domain', domain: readWorkflowDomain(uri) };
  }

  if (uri in STATIC_RESOURCES || isConversationCatalogUri(uri)) {
    throw new Error(`Resource authorization not configured: ${uri}`);
  }

  throw new Error(`Unknown resource: ${uri}`);
}

export function getMcpResourceUris(): string[] {
  const staticUris = Object.keys(STATIC_RESOURCES);
  return [
    ...staticUris,
    'utopia://records',
    'utopia://actions',
    'utopia://workflows',
    'utopia://conversations',
    ...getWorkflowUris(),
    ...getConversationUris(),
    ...getRecordUris(),
    ...getActionUris(),
  ].sort();
}

export function listMcpResources(): McpResource[] {
  const staticResources = Object.values(STATIC_RESOURCES).map((resource) => ({
    uri: resource.uri,
    name: resource.name,
    mimeType: resource.mimeType,
  }));

  const workflows = listWorkflows().map((workflow) => ({
    uri: `utopia://workflow/${encodeURIComponent(workflow.id)}`,
    name: `workflow-${workflow.id}`,
    mimeType: 'application/json',
  }));

  const recordList = listRecordUris().map((uri) => ({
    uri,
    name: `record-${decodeURIComponent(uri.replace('utopia://record/', ''))}`,
    mimeType: 'application/json',
  }));

  const actionList = listActionUris().map((uri) => ({
    uri,
    name: `action-${decodeURIComponent(uri.replace('utopia://action/', ''))}`,
    mimeType: 'application/json',
  }));

  const catalog = {
    uri: 'utopia://records',
    name: 'records-index',
    mimeType: 'application/json',
  };

  return [
    ...staticResources,
    catalog,
    { uri: 'utopia://actions', name: 'actions-index', mimeType: 'application/json' },
    { uri: 'utopia://workflows', name: 'workflows-index', mimeType: 'application/json' },
    { uri: 'utopia://conversations', name: 'conversation-index', mimeType: 'application/json' },
    ...workflows,
    ...recordList,
    ...actionList,
    ...getConversationUris().map((uri) => ({ uri, name: uri.split('/').pop() || 'conversation', mimeType: 'application/json' })),
  ].sort((a, b) => a.uri.localeCompare(b.uri));
}

function isConversationCatalogUri(uri: string): boolean {
  return uri.startsWith('utopia://domain/') || uri.startsWith('utopia://catalog/domain/');
}

function readDomainCatalog(): string {
  const catalog = loadCatalog();
  return JSON.stringify(catalog, null, 2);
}

function readActionActionEvent(actionUri: string) {
  const actionId = decodeURIComponent(actionUri.replace('utopia://action/', ''));
  const event = getActionEvent(actionId);
  if (!event) {
    throw new Error(`Unknown action resource: ${actionUri}`);
  }
  return JSON.stringify(event, null, 2);
}

function readConversationResource(uri: string) {
  const catalog = loadCatalog();
  const normalized = uri.replace('utopia://catalog/domain/', '').replace('utopia://domain/', '');
  const manifest = catalog.domainsById[normalized]?.manifest;
  if (!manifest) {
    throw new Error(`Unknown domain resource: ${uri}`);
  }
  return JSON.stringify({ domain: normalized, manifest }, null, 2);
}

function readRecordResource(uri: string) {
  const recordId = decodeURIComponent(uri.replace('utopia://record/', ''));
  const records = listRecords({ query: `"${recordId}"`, limit: 200, includeArchived: true }).filter((record) => record.id === recordId);
  if (!records.length) {
    throw new Error(`Unknown record resource: ${uri}`);
  }
  return JSON.stringify(records[0], null, 2);
}

function readRecordsIndex() {
  const records = listRecords({ includeArchived: true, limit: 500 });
  return JSON.stringify({ type: 'record-index', count: records.length, records }, null, 2);
}

function readWorkflowResource(uri: string) {
  const workflowId = decodeURIComponent(uri.replace('utopia://workflow/', ''));
  const workflow = findWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Unknown workflow resource: ${uri}`);
  }
  return JSON.stringify(workflow, null, 2);
}

function readWorkflowsIndex() {
  return JSON.stringify({ type: 'workflow-index', workflows: listWorkflows() }, null, 2);
}

function readActionsIndex() {
  return JSON.stringify({ type: 'action-index', events: listActionEvents() }, null, 2);
}

function readConversationsIndex() {
  try {
    return JSON.stringify({ type: 'conversation-index', threads: listConversations() }, null, 2);
  } catch {
    return JSON.stringify({ type: 'conversation-index', threads: [] }, null, 2);
  }
}

export function readMcpResource(uri: string): string {
  if (uri in STATIC_RESOURCES) {
    const resource = STATIC_RESOURCES[uri];
    if (resource.mode === 'file') {
      if (!resource.path || !existsSync(resource.path)) {
        throw new Error(`Missing resource file for ${uri}`);
      }
      return readFileSync(resource.path, 'utf-8');
    }
  }

  if (uri === 'utopia://records') {
    return readRecordsIndex();
  }

  if (uri === 'utopia://actions') {
    return readActionsIndex();
  }

  if (uri === 'utopia://workflows') {
    return readWorkflowsIndex();
  }

  if (uri === 'utopia://conversations') {
    return readConversationsIndex();
  }

  if (uri === 'utopia://domain-catalog') {
    return readDomainCatalog();
  }

  if (uri.startsWith('utopia://record/')) {
    return readRecordResource(uri);
  }

  if (uri.startsWith('utopia://action/')) {
    return readActionActionEvent(uri);
  }

  if (uri.startsWith('utopia://workflow/')) {
    return readWorkflowResource(uri);
  }

  if (isConversationCatalogUri(uri)) {
    return readConversationResource(uri);
  }

  throw new Error(`Unknown resource: ${uri}`);
}

export function resolveResourceMimeType(uri: string): string {
  const resource = STATIC_RESOURCES[uri];
  if (resource?.path && resource.path) {
    return resolveMimeType(resource.path, resource.mimeType);
  }
  return 'application/json';
}
