import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/domain-config');
const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

const INSTANCE_RULES = [
  { match: (path) => path === 'domain-catalog.v1.json', schema: 'schemas/domain-catalog.v1.schema.json' },
  { match: (path) => path === 'agents/registry.v1.json', schema: 'schemas/agent-registry.v1.schema.json' },
  { match: (path) => path.startsWith('domains/') && path.endsWith('.json'), schema: 'schemas/domain.v1.schema.json' },
  { match: (path) => path.startsWith('workflows/') && path.endsWith('.json'), schema: 'schemas/workflow.v1.schema.json' },
  { match: (path) => path === 'templates/utopia-data-plane-template.v1.json', schema: 'templates/utopia-data-plane-template.v1.schema.json' },
  { match: (path) => path === 'templates/package-change-templates/package-change-blueprints.v1.json', schema: 'templates/package-change-templates/package-change-blueprints.v1.schema.json' },
  { match: (path) => path === 'templates/package-change-templates/widget-screen-intents.v1.json', schema: 'templates/package-change-templates/widget-screen-intents.v1.schema.json' },
  { match: (path) => path === 'providers/notion/metadata.v1.json', schema: providerMetadataSchema() },
  { match: (path) => path === 'providers/notion/surface.v1.json', schema: providerSurfaceSchema() },
];

const IGNORED_PATHS = [
  'schemas/approval/fixtures/',
  'templates/generated/',
];

export function validateDomainConfig(rootDir = DEFAULT_ROOT) {
  const ajv = createAjv();
  const schemaCache = new Map();
  const documents = new Map();
  const files = walkJsonFiles(rootDir, rootDir)
    .filter((path) => !IGNORED_PATHS.some((prefix) => path.startsWith(prefix)))
    .sort((left, right) => left.localeCompare(right));

  for (const path of files) {
    const document = readJson(resolve(rootDir, path));
    documents.set(path, document);
    if (path.endsWith('.schema.json')) {
      loadSchemaValidator({ ajv, schemaCache, path, document });
    }
  }

  for (const path of files) {
    if (path.endsWith('.schema.json')) continue;
    const document = documents.get(path);
    const rule = INSTANCE_RULES.find((entry) => entry.match(path));
    if (!rule) continue;
    const validate = rule.schema && typeof rule.schema === 'string'
      ? loadSchemaValidatorByPath({ ajv, rootDir, schemaCache, schemaPath: rule.schema })
      : compileInlineSchema({ ajv, path, schema: rule.schema });
    assertValid(validate, document, resolve(rootDir, path));
  }

  return validatePackageRefs({ documents, rootDir });
}

function validatePackageRefs({ documents, rootDir }) {
  const catalog = documents.get('domain-catalog.v1.json');
  if (!catalog) throw new Error('Missing domain catalog.');
  const active = catalog.domains.find((domain) => domain.id === catalog.active_domain_id);
  if (!active?.manifest || !active?.skill) throw new Error('Active domain must reference a manifest and skill.');

  const workflowIds = new Set(
    Array.from(documents.entries())
      .filter(([path]) => path.startsWith('workflows/') && path.endsWith('.json'))
      .map(([, document]) => document.id),
  );

  const manifests = new Map();
  for (const domain of catalog.domains) {
    if (!domain.manifest || !domain.skill) throw new Error(`Domain ${domain.id} must reference a manifest and skill.`);
    const manifestPath = resolve(rootDir, domain.manifest);
    const skillPath = resolve(rootDir, domain.skill);
    if (!exists(manifestPath) || !exists(skillPath)) throw new Error(`Domain package is incomplete: ${domain.id}`);

    const manifest = documents.get(normalizeRelative(rootDir, manifestPath));
    if (!manifest) throw new Error(`Domain manifest missing: ${domain.id}`);
    if (manifest.id !== domain.id) throw new Error(`Manifest id mismatch for ${domain.id}: ${manifest.id}`);

    const collections = new Set(manifest.collections);
    for (const relation of manifest.relations) {
      if (!collections.has(relation.from) || (relation.to !== '*' && !collections.has(relation.to))) {
        throw new Error(`Unknown relation collection in ${domain.id}: ${relation.from} -> ${relation.to}`);
      }
    }
    for (const id of manifest.workflows) {
      if (!workflowIds.has(id)) throw new Error(`Missing workflow for ${domain.id}: ${id}`);
    }
    validateUiQueryCollections(manifest.ui, collections, `domain-manifest:${domain.id}.ui`);
    if (manifest.rich_detail_schema && !exists(resolve(rootDir, manifest.rich_detail_schema))) {
      throw new Error(`Missing rich detail schema for ${domain.id}: ${manifest.rich_detail_schema}`);
    }
    manifests.set(domain.id, manifest);
  }

  const activeManifest = manifests.get(active.id);
  if (!activeManifest) throw new Error(`Active domain manifest missing: ${active.id}`);

  const registry = documents.get('agents/registry.v1.json');
  if (!registry) throw new Error('Missing agent registry.');

  const agentIds = new Set();
  const operationKinds = new Set(['create', 'update', 'archive', 'restore', 'relate', 'unrelate', 'delete']);
  for (const agent of registry.agents) {
    if (agentIds.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
    agentIds.add(agent.id);
    for (const schemaRef of [agent.input_schema, agent.output_schema]) {
      if (!exists(resolve(rootDir, 'agents', schemaRef))) throw new Error(`Missing agent schema: ${agent.id} -> ${schemaRef}`);
    }
    if (!Array.isArray(agent.capabilities) || agent.capabilities.length === 0) {
      throw new Error(`Agent ${agent.id} must declare capabilities.`);
    }
    for (const capability of agent.capabilities) {
      if (capability.domain !== '*' && !manifests.has(capability.domain)) {
        throw new Error(`Agent ${agent.id} capability references unknown domain: ${capability.domain}`);
      }
      const domainIds = capability.domain === '*' ? Array.from(manifests.keys()) : [capability.domain];
      for (const domainId of domainIds) {
        const manifest = manifests.get(domainId);
        if (!manifest) continue;
        for (const collection of capability.collections ?? []) {
          if (collection !== '*' && !manifest.collections.includes(collection)) {
            throw new Error(`Agent ${agent.id} capability references unknown collection: ${domainId}.${collection}`);
          }
        }
      }
      for (const op of capability.ops ?? []) {
        if (!operationKinds.has(op)) throw new Error(`Agent ${agent.id} capability references unknown operation: ${op}`);
      }
    }
  }

  return {
    domains: catalog.domains.length,
    activeDomain: active.id,
    activeCollections: activeManifest.collections.length,
    activeWorkflows: activeManifest.workflows.length,
    agents: registry.agents.length,
  };
}

function validateUiQueryCollections(value, collections, path) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateUiQueryCollections(item, collections, `${path}[${index}]`));
    return;
  }
  if (value.query && typeof value.query === 'object' && Array.isArray(value.query.collections)) {
    value.query.collections.forEach((collection, index) => {
      if (typeof collection !== 'string' || !collections.has(collection)) {
        throw new Error(`${path}.query.collections[${index}] references missing collection ${String(collection)}`);
      }
    });
  }
  for (const [key, child] of Object.entries(value)) {
    validateUiQueryCollections(child, collections, `${path}.${key}`);
  }
}

function loadSchemaValidatorByPath({ ajv, rootDir, schemaCache, schemaPath }) {
  const absolute = resolve(rootDir, schemaPath);
  const path = normalizeRelative(rootDir, absolute);
  const document = readJson(absolute);
  return loadSchemaValidator({ ajv, schemaCache, path, document });
}

function loadSchemaValidator({ ajv, schemaCache, path, document }) {
  if (schemaCache.has(path)) return schemaCache.get(path);
  if (typeof document.$schema === 'string' && isDialectSchema(document.$schema)) {
    const validate = ajv.compile(document);
    schemaCache.set(path, validate);
    return validate;
  }
  throw new Error(`Schema file must declare a supported JSON Schema dialect: ${path}`);
}

function compileInlineSchema({ ajv, path, schema }) {
  const validate = ajv.compile(schema);
  if (!validate) throw new Error(`Unable to compile schema for ${path}`);
  return validate;
}

function assertValid(validate, document, path) {
  if (validate(document)) return;
  const errors = (validate.errors ?? []).map((error) => `${path}:${error.instancePath || '/'} ${error.message ?? 'invalid'}`);
  throw new Error(`Domain config invalid:\n${errors.map((entry) => `- ${entry}`).join('\n')}`);
}

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: true });
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value) => isDateTime(value),
  });
  ajv.addFormat('uri', {
    type: 'string',
    validate: (value) => isUri(value),
  });
  return ajv;
}

function isDateTime(value) {
  if (typeof value !== 'string' || !value.includes('T')) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function isUri(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    // Relative URLs are not valid here; fail closed.
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isDialectSchema(schema) {
  return schema === DRAFT_2020_12 || schema === DRAFT_07;
}

function walkJsonFiles(dir, rootDir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) return walkJsonFiles(path, rootDir);
    return path.endsWith('.json') ? [normalizeRelative(rootDir, path)] : [];
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeRelative(rootDir, path) {
  return relative(rootDir, path).split('/').join('/').replaceAll('\\', '/');
}

function exists(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function providerMetadataSchema() {
  return {
    type: 'object',
    required: ['provider', 'schema_version', 'api', 'required_env', 'webhook', 'operations', 'contracts'],
    properties: {
      provider: { const: 'notion' },
      schema_version: { const: 'utopia.provider.notion.v1' },
      api: {
        type: 'object',
        required: ['version', 'base_path', 'write_parent', 'retry_enabled'],
        properties: {
          version: { type: 'string', minLength: 1 },
          base_path: { type: 'string', minLength: 1 },
          write_parent: { type: 'string', minLength: 1 },
          retry_enabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      required_env: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
      webhook: {
        type: 'object',
        required: ['signature_env', 'signature_header', 'dedupe_preference', 'id'],
        properties: {
          signature_env: { type: 'string', minLength: 1 },
          signature_header: { type: 'string', minLength: 1 },
          dedupe_preference: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
          id: {
            type: 'object',
            required: ['external_prefix'],
            properties: {
              external_prefix: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      operations: {
        type: 'array',
        items: { enum: ['create_record', 'update_record', 'archive_record'] },
        minItems: 1,
        uniqueItems: true,
      },
      contracts: {
        type: 'object',
        required: ['preserve_unsupported_fields', 'source_snapshot_fields'],
        properties: {
          preserve_unsupported_fields: { type: 'boolean' },
          source_snapshot_fields: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}

function providerSurfaceSchema() {
  return {
    type: 'object',
    required: ['provider', 'schema_version', 'name', 'supports', 'output_contract'],
    properties: {
      provider: { const: 'notion' },
      schema_version: { const: 'utopia.provider.surface.v1' },
      name: { type: 'string', minLength: 1 },
      supports: {
        type: 'object',
        required: ['typed_commands', 'resolved_data_home'],
        properties: {
          typed_commands: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
          resolved_data_home: { const: 'notion' },
        },
        additionalProperties: false,
      },
      output_contract: {
        type: 'object',
        required: ['fields', 'required_source_snapshot'],
        properties: {
          fields: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
          required_source_snapshot: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, uniqueItems: true },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}
