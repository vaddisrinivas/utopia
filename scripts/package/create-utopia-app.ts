import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileAppPackageSourceFolder } from '../../packages/app-compiler';

type CreateUtopiaAppOptions = Readonly<{
  id: string;
  name: string;
  outDir: string;
  version: string;
  force: boolean;
}>;

const DEFAULT_VERSION = '1.0.0';

export function createMinimalUtopiaAppSource(options: CreateUtopiaAppOptions): string {
  const source = buildTemplateSource(options);
  const targetDir = path.resolve(options.outDir);
  writeFolder(targetDir, source, options.force);

  const compiled = compileAppPackageSourceFolder(targetDir);
  if (!compiled.valid) {
    throw new Error(compiled.errors.map((error) => `${error.path}: ${error.message}`).join('\n'));
  }

  return targetDir;
}

export function buildTemplateSource(options: Pick<CreateUtopiaAppOptions, 'id' | 'name' | 'version'>) {
  return {
    app: {
      schemaVersion: 'wonder.package-source.v1' as const,
      id: options.id,
      version: options.version,
      label: options.name,
      homeSurface: 'home',
    },
    collections: {
      items: {
        fields: {
          id: { type: 'text', required: true, indexed: true },
          title: { type: 'text', required: true, indexed: true },
          collection: { type: 'text', required: true, indexed: true },
          updated_at: { type: 'timestamp', required: true, indexed: true },
          properties: { type: 'json', required: true },
          status: { type: 'text' },
        },
      },
    },
    queries: {
      home: {
        from: 'items',
        limit: 20,
      },
    },
    screens: {
      home: {
        label: 'Home',
        subtitle: `${options.name} starter list`,
        collections: ['items'],
        query: 'home',
        mode: 'list',
        fields: ['title', 'status', 'updated_at'],
      },
    },
  };
}

export function parseCreateUtopiaAppArgs(argv: string[]): CreateUtopiaAppOptions {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    if (token === '--force') {
      flags.set('force', true);
      continue;
    }
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }

    const [key, inlineValue] = token.startsWith('--') ? token.slice(2).split('=', 2) : [token.slice(1), undefined];
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('-')) {
      throw new Error(`missing value for ${token}`);
    }
    flags.set(key, next);
    index += 1;
  }

  const id = slugify(readFlag(flags, 'id') ?? positionals[0] ?? 'untitled-app');
  const name = readFlag(flags, 'name') ?? titleCase(id);
  const outDir = readFlag(flags, 'out')
    ?? readFlag(flags, 'output')
    ?? positionals[1]
    ?? path.resolve(process.cwd(), 'apps', id, 'source');
  const version = readFlag(flags, 'version') ?? DEFAULT_VERSION;
  const force = Boolean(flags.get('force'));

  return {
    id,
    name,
    outDir,
    version,
    force,
  };
}

export function main(argv: string[] = process.argv.slice(2)): string {
  const options = parseCreateUtopiaAppArgs(argv);
  const targetDir = createMinimalUtopiaAppSource(options);
  process.stdout.write(`Created Utopia app source at ${targetDir}\n`);
  return targetDir;
}

function writeFolder(targetDir: string, source: ReturnType<typeof buildTemplateSource>, force: boolean): void {
  if (force) {
    rmSync(targetDir, { recursive: true, force: true });
  }

  mkdirSync(path.join(targetDir, 'collections'), { recursive: true });
  mkdirSync(path.join(targetDir, 'queries'), { recursive: true });
  mkdirSync(path.join(targetDir, 'screens'), { recursive: true });

  writeJson(path.join(targetDir, 'app.json'), source.app);
  for (const [id, collection] of Object.entries(source.collections)) {
    writeJson(path.join(targetDir, 'collections', `${id}.json`), collection);
  }
  for (const [id, query] of Object.entries(source.queries)) {
    writeJson(path.join(targetDir, 'queries', `${id}.json`), query);
  }
  for (const [id, screen] of Object.entries(source.screens)) {
    writeJson(path.join(targetDir, 'screens', `${id}.json`), screen);
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled-app';
}

function titleCase(input: string): string {
  return input
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function printUsage(): void {
  process.stdout.write([
    'Usage: npm run create:utopia-app -- [--id slug] [--name "App Name"] [--out path] [--version 1.0.0] [--force]',
    '',
    'Defaults:',
    '  id      from --id or first positional value',
    '  name    from --name or title-cased id',
    '  out     apps/<id>/source',
  ].join('\n') + '\n');
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
