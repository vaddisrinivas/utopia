import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compileAppPackageSource,
  type AppPackageSourceCollection,
  type AppPackageSourceFolder,
  type AppPackageSourceQuery,
  type AppPackageSourceScreen,
} from '@/packages/app-compiler';
import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import type { A2UiComponent } from '@/packages/shared/contracts/package';
import { APP_PACKAGE_WIDGET_KINDS, APP_PACKAGE_WIDGET_KIND_SET } from '@/packages/shared/contracts/ui-widgets';

export const NATURAL_LANGUAGE_FACTORY_ARTIFACT_SCHEMA_VERSION = 'utopia.github-app-factory-artifact.v2' as const;
export const DEFAULT_FACTORY_MODEL = 'gpt-5.4-mini';
export const DEFAULT_REQUEST_PATH = 'requests/app-idea.md';

type GenerateArgs = Readonly<{
  promptPath: string;
  outputDir: string;
  model: string;
  force: boolean;
}>;

type FactoryArtifactManifest = Readonly<{
  schemaVersion: typeof NATURAL_LANGUAGE_FACTORY_ARTIFACT_SCHEMA_VERSION;
  promptPath: string;
  promptHash: string;
  model: string;
  generatedAt: string;
  packageId: string;
  packageVersion: string;
  packageLabel: string;
  packageChecksum: string;
  previewHash: string;
  requiresApproval: true;
  files: {
    prompt: string;
    source: string;
    package: string;
    preview: string;
    rawModelOutput: string;
  };
}>;

const PACKAGE_SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['app', 'collections', 'queries', 'screens'],
  properties: {
    app: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'id', 'version', 'label', 'homeSurface'],
      properties: {
        schemaVersion: { type: 'string', const: 'wonder.package-source.v1' },
        id: { type: 'string' },
        version: { type: 'string', const: '1.0.0' },
        label: { type: 'string' },
        homeSurface: { type: 'string' },
      },
    },
    collections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'fields'],
        properties: {
          id: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'type', 'required', 'indexed'],
              properties: {
                id: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['text', 'number', 'boolean', 'timestamp', 'json'],
                },
                required: { type: 'boolean' },
                indexed: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'from', 'limit'],
        properties: {
          id: { type: 'string' },
          from: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
    },
    screens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'subtitle', 'collections', 'query', 'mode', 'fields', 'components'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          subtitle: { type: 'string' },
          collections: {
            type: 'array',
            items: { type: 'string' },
          },
          query: { type: 'string' },
          mode: { type: 'string', enum: ['list', 'board', 'table', 'calendar', 'timeline', 'chart'] },
          fields: {
            type: 'array',
            items: { type: 'string' },
          },
          components: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'widget', 'props'],
              properties: {
                kind: { type: 'string', const: 'widget' },
                widget: { type: 'string', enum: APP_PACKAGE_WIDGET_KINDS },
                props: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function generateAppFromPrompt(args: GenerateArgs): Promise<FactoryArtifactManifest> {
  const promptPath = resolve(process.cwd(), args.promptPath);
  const prompt = readPrompt(promptPath);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required. Add it as a GitHub Actions repository secret before running the app factory.');
  }

  const rawModelOutput = await requestPackageSourceFromOpenAI({
    apiKey,
    model: args.model,
    prompt,
  });
  const source = normalizeModelSource(rawModelOutput, prompt);
  return writeFactoryArtifact({
    outputDir: resolve(process.cwd(), args.outputDir),
    promptPath: args.promptPath,
    prompt,
    model: args.model,
    rawModelOutput,
    source,
    force: args.force,
  });
}

export async function requestPackageSourceFromOpenAI(input: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<unknown> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You create Utopia package source JSON for local-first personal, family, group, and small-company apps.',
                'Return only safe declarative package source.',
                'Do not include code, SQL, provider credentials, secrets, URLs for private data, or native permissions.',
                'Use one to three collections, one to three queries, and one to three screens.',
                'Every collection should include id, title, collection, updated_at, properties, and useful domain fields.',
                'Every screen must reference existing collections and queries.',
                'For games, calculators, habit graphs, timers, charts, maps, media, forms, and other non-CRUD tools, include a widget component from the allowed widget enum.',
              ].join('\n'),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input.prompt,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'utopia_package_source',
          strict: true,
          schema: PACKAGE_SOURCE_SCHEMA,
        },
      },
    }),
  });

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.error === 'object' && body.error && 'message' in body.error
      ? String((body.error as { message?: unknown }).message)
      : `OpenAI request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return parseOpenAIJsonOutput(body);
}

export function parseOpenAIJsonOutput(body: unknown): unknown {
  if (!isRecord(body)) throw new Error('OpenAI response was not an object');
  if (typeof body.output_text === 'string') return JSON.parse(body.output_text);

  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return JSON.parse(content.text);
      }
    }
  }
  throw new Error('OpenAI response did not include JSON output text');
}

export function normalizeModelSource(input: unknown, prompt: string): AppPackageSourceFolder {
  if (!isRecord(input)) throw new Error('model output must be an object');
  const app = isRecord(input.app) ? input.app : {};
  const collections = normalizeCollections(input.collections);
  const queries = normalizeQueries(input.queries, collections);
  const screens = normalizeScreens(input.screens, collections, queries);
  const firstScreen = Object.keys(screens)[0] ?? 'home';
  const fallbackLabel = inferLabel(prompt);

  return {
    app: {
      schemaVersion: 'wonder.package-source.v1',
      id: slugify(typeof app.id === 'string' ? app.id : fallbackLabel),
      version: '1.0.0',
      label: typeof app.label === 'string' && app.label.trim() ? app.label.trim() : fallbackLabel,
      homeSurface: typeof app.homeSurface === 'string' && screens[app.homeSurface] ? app.homeSurface : firstScreen,
    },
    collections,
    queries,
    screens,
  };
}

export function writeFactoryArtifact(input: {
  outputDir: string;
  promptPath: string;
  prompt: string;
  model: string;
  rawModelOutput: unknown;
  source: AppPackageSourceFolder;
  force: boolean;
}): FactoryArtifactManifest {
  if (existsSync(input.outputDir)) {
    if (!input.force) throw new Error(`output dir already exists: ${input.outputDir}`);
    rmSync(input.outputDir, { recursive: true, force: true });
  }

  const compiled = compileAppPackageSource(input.source);
  if (!compiled.valid) {
    throw new Error(compiled.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  }

  mkdirSync(input.outputDir, { recursive: true });
  const sourceDir = join(input.outputDir, 'source');
  writeSourceFolder(sourceDir, input.source);
  writeFileSync(join(input.outputDir, 'prompt.md'), `${input.prompt.trim()}\n`, 'utf8');
  writeJson(join(input.outputDir, 'raw-model-output.json'), input.rawModelOutput);
  writeJson(join(input.outputDir, 'package.json'), compiled.package);
  writeJson(join(input.outputDir, 'preview.json'), compiled.preview);

  const manifest: FactoryArtifactManifest = {
    schemaVersion: NATURAL_LANGUAGE_FACTORY_ARTIFACT_SCHEMA_VERSION,
    promptPath: input.promptPath,
    promptHash: sha256Canonical({ prompt: input.prompt }),
    model: input.model,
    generatedAt: new Date().toISOString(),
    packageId: compiled.package.id,
    packageVersion: compiled.package.version,
    packageLabel: compiled.package.presentation?.label ?? compiled.package.id,
    packageChecksum: compiled.checksum,
    previewHash: sha256Canonical(compiled.preview),
    requiresApproval: true,
    files: {
      prompt: 'prompt.md',
      source: 'source',
      package: 'package.json',
      preview: 'preview.json',
      rawModelOutput: 'raw-model-output.json',
    },
  };
  writeJson(join(input.outputDir, 'manifest.json'), manifest);
  return manifest;
}

export function parseArgs(argv: string[]): GenerateArgs {
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--force') {
      flags.set('force', true);
      continue;
    }
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
    if (!token.startsWith('-')) {
      flags.set('prompt', token);
      continue;
    }
    const [key, inlineValue] = token.startsWith('--') ? token.slice(2).split('=', 2) : [token.slice(1), undefined];
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('-')) throw new Error(`missing value for ${token}`);
    flags.set(key, next);
    index += 1;
  }

  const promptPath = readFlag(flags, 'prompt') ?? readFlag(flags, 'request') ?? DEFAULT_REQUEST_PATH;
  const outputDir = readFlag(flags, 'output-dir') ?? readFlag(flags, 'out') ?? 'dist/github-app-factory/app';
  const model = readFlag(flags, 'model') ?? process.env.UTOPIA_APP_FACTORY_MODEL ?? DEFAULT_FACTORY_MODEL;
  return {
    promptPath,
    outputDir,
    model,
    force: Boolean(flags.get('force')),
  };
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const manifest = await generateAppFromPrompt(args);
  process.stdout.write([
    `Generated Utopia app artifact: ${resolve(process.cwd(), args.outputDir)}`,
    `- package: ${manifest.packageId}@${manifest.packageVersion}`,
    `- checksum: ${manifest.packageChecksum}`,
    '- review required before install',
  ].join('\n') + '\n');
}

function readPrompt(promptPath: string): string {
  const prompt = readFileSync(promptPath, 'utf8').trim();
  if (!prompt) throw new Error(`request prompt is empty: ${promptPath}`);
  if (prompt.length > 12000) throw new Error('request prompt is too large; keep it under 12000 characters');
  return prompt;
}

function normalizeCollections(input: unknown): Record<string, AppPackageSourceCollection> {
  const entries = Array.isArray(input)
    ? input.map((value, index) => [isRecord(value) && typeof value.id === 'string' ? value.id : `collection-${index + 1}`, value] as const)
    : Object.entries(isRecord(input) ? input : {});
  const normalized = Object.fromEntries(entries.slice(0, 3).map(([key, value]) => {
    const id = slugify(key);
    const fields = isRecord(value) ? normalizeFields(value.fields) : {};
    return [id, { fields: withBaseFields(fields) }];
  }));
  if (Object.keys(normalized).length > 0) return normalized;
  return {
    item: {
      fields: withBaseFields({
        status: { type: 'text' },
        notes: { type: 'text' },
      }),
    },
  };
}

function normalizeQueries(input: unknown, collections: Record<string, AppPackageSourceCollection>): Record<string, AppPackageSourceQuery> {
  const collectionIds = new Set(Object.keys(collections));
  const firstCollection = Object.keys(collections)[0] ?? 'item';
  const entries = Array.isArray(input)
    ? input.map((value, index) => [isRecord(value) && typeof value.id === 'string' ? value.id : `query-${index + 1}`, value] as const)
    : Object.entries(isRecord(input) ? input : {});
  const normalized = Object.fromEntries(entries.slice(0, 3).map(([key, value]) => {
    const query = isRecord(value) ? value : {};
    const from = typeof query.from === 'string' && collectionIds.has(query.from) ? query.from : firstCollection;
    const limit = typeof query.limit === 'number' && Number.isInteger(query.limit) ? Math.min(Math.max(query.limit, 1), 100) : 20;
    return [slugify(key), { from, limit }];
  }));
  if (Object.keys(normalized).length > 0) return normalized;
  return { home: { from: firstCollection, limit: 20 } };
}

function normalizeScreens(
  input: unknown,
  collections: Record<string, AppPackageSourceCollection>,
  queries: Record<string, AppPackageSourceQuery>,
): Record<string, AppPackageSourceScreen> {
  const collectionIds = new Set(Object.keys(collections));
  const queryIds = new Set(Object.keys(queries));
  const firstCollection = Object.keys(collections)[0] ?? 'item';
  const firstQuery = Object.keys(queries)[0] ?? 'home';
  const entries = Array.isArray(input)
    ? input.map((value, index) => [isRecord(value) && typeof value.id === 'string' ? value.id : `screen-${index + 1}`, value] as const)
    : Object.entries(isRecord(input) ? input : {});
  const normalized = Object.fromEntries(entries.slice(0, 3).map(([key, value]) => {
    const screen = isRecord(value) ? value : {};
    const id = slugify(key);
    const screenCollections = Array.isArray(screen.collections)
      ? screen.collections.filter((item): item is string => typeof item === 'string' && collectionIds.has(item)).slice(0, 3)
      : [];
    const query = typeof screen.query === 'string' && queryIds.has(screen.query) ? screen.query : firstQuery;
    const fields = Array.isArray(screen.fields)
      ? screen.fields.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [];
    const components = normalizeScreenComponents(screen.components);
    return [id, {
      label: typeof screen.label === 'string' && screen.label.trim() ? screen.label.trim() : titleCase(id),
      ...(typeof screen.subtitle === 'string' && screen.subtitle.trim() ? { subtitle: screen.subtitle.trim() } : {}),
      collections: screenCollections.length ? screenCollections : [firstCollection],
      query,
      mode: isScreenMode(screen.mode) ? screen.mode : 'list',
      fields: fields.length ? fields : ['title', 'status', 'updated_at'],
      ...(components.length ? { components } : {}),
    }];
  }));
  if (Object.keys(normalized).length > 0) return normalized;
  return {
    home: {
      label: 'Home',
      collections: [firstCollection],
      query: firstQuery,
      mode: 'list',
      fields: ['title', 'status', 'updated_at'],
    },
  };
}

function normalizeScreenComponents(input: unknown): A2UiComponent[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 4).flatMap((value): A2UiComponent[] => {
    if (!isRecord(value)) return [];
    if (value.kind !== 'widget' || !APP_PACKAGE_WIDGET_KIND_SET.has(String(value.widget))) return [];
    return [{
      kind: 'widget',
      widget: value.widget as A2UiComponent['widget'],
      ...(isRecord(value.props) ? { props: value.props } : {}),
    }];
  });
}

function withBaseFields(fields: Record<string, unknown>): AppPackageSourceCollection['fields'] {
  return {
    id: { type: 'text', required: true, indexed: true },
    title: { type: 'text', required: true, indexed: true },
    collection: { type: 'text', required: true, indexed: true },
    updated_at: { type: 'timestamp', required: true, indexed: true },
    properties: { type: 'json', required: true },
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => isField(value))),
  };
}

function normalizeFields(input: unknown): Record<string, unknown> {
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map((value, index) => {
      const id = isRecord(value) && typeof value.id === 'string' ? value.id : `field-${index + 1}`;
      return [slugify(id).replace(/-/g, '_'), value];
    }));
  }
  return isRecord(input) ? input : {};
}

function isField(value: unknown): value is { type: 'text' | 'number' | 'boolean' | 'timestamp' | 'json'; required?: boolean; indexed?: boolean } {
  return isRecord(value) && ['text', 'number', 'boolean', 'timestamp', 'json'].includes(String(value.type));
}

function writeSourceFolder(sourceDir: string, source: AppPackageSourceFolder): void {
  mkdirSync(join(sourceDir, 'collections'), { recursive: true });
  mkdirSync(join(sourceDir, 'queries'), { recursive: true });
  mkdirSync(join(sourceDir, 'screens'), { recursive: true });
  writeJson(join(sourceDir, 'app.json'), source.app);
  for (const [id, value] of Object.entries(source.collections ?? {})) writeJson(join(sourceDir, 'collections', `${id}.json`), value);
  for (const [id, value] of Object.entries(source.queries ?? {})) writeJson(join(sourceDir, 'queries', `${id}.json`), value);
  for (const [id, value] of Object.entries(source.screens ?? {})) writeJson(join(sourceDir, 'screens', `${id}.json`), value);
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${canonicalJson(value)}\n`, 'utf8');
}

function inferLabel(prompt: string): string {
  const firstLine = prompt.split('\n').map((line) => line.trim()).find(Boolean) ?? 'Utopia App';
  return titleCase(slugify(firstLine).split('-').slice(0, 5).join('-'));
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
    || 'utopia-app';
}

function titleCase(input: string): string {
  return input
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isScreenMode(value: unknown): value is AppPackageSourceScreen['mode'] {
  return ['list', 'board', 'table', 'calendar', 'timeline', 'chart'].includes(String(value));
}

function readFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function printUsage(): void {
  process.stdout.write([
    'Usage: npm run factory:generate-app -- --prompt requests/app-idea.md --output-dir dist/github-app-factory/app --force',
    '',
    'Required:',
    '  OPENAI_API_KEY must be set in the environment or GitHub Actions secrets.',
    '',
    'Optional:',
    `  UTOPIA_APP_FACTORY_MODEL defaults to ${DEFAULT_FACTORY_MODEL}`,
  ].join('\n') + '\n');
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
