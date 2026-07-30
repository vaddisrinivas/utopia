#!/usr/bin/env node
import {
  mkdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export const SHARED_HOUSEHOLD_BOARD_ID = 'shared-household-board';
export const SHARED_HOUSEHOLD_BOARD_V1_URL = 'https://utoia.thetechcruise.com/p/shared-household-board.json';
export const SHARED_HOUSEHOLD_BOARD_V2_URL = 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json';
export const SHARED_HOUSEHOLD_BOARD_V1_VERSION = '1.0.0';
export const SHARED_HOUSEHOLD_BOARD_V2_VERSION = '1.1.0';
const SOURCE_FIXTURE_PATH = 'tests/fixtures/golden-loop/shared-household-board.source.json';

const root = process.cwd();
const compilerBridgePath = resolve(root, 'scripts/quality/golden-loop/web-package-compile-bridge.mjs');

function clone(value) {
  return structuredClone(value);
}

function tsxCommand() {
  const localServerTsx = join(root, 'server', 'node_modules', '.bin', 'tsx');
  const localRootTsx = join(root, 'node_modules', '.bin', 'tsx');
  if (existsSync(localServerTsx)) return localServerTsx;
  if (existsSync(localRootTsx)) return localRootTsx;
  return 'npx';
}

function compileWithAppCompiler(sourceOrPath, options = {}) {
  const command = tsxCommand();
  const args = command === 'npx'
    ? ['--yes', 'tsx', '--tsconfig', join(root, 'tsconfig.json'), compilerBridgePath]
    : ['--tsconfig', join(root, 'tsconfig.json'), compilerBridgePath];

  const payload = isString(sourceOrPath)
    ? { sourcePath: sourceOrPath }
    : { source: sourceOrPath };
  if (Object.keys(options).length > 0) {
    payload.version = options.version;
    payload.addPriorityLane = options.addPriorityLane;
  }

  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    input: JSON.stringify(payload),
    maxBuffer: 2 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`app_compiler_spawn_failed:${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`app_compiler_spawn_status:${result.status}${detail ? `:${detail}` : ''}`);
  }

  const raw = String(result.stdout || '').trim();
  if (!raw) {
    throw new Error('app_compiler_no_output');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('app_compiler_invalid_json_output');
  }

  if (!parsed || parsed.valid !== true || !parsed.package || !parsed.checksum) {
    throw new Error(`app_compiler_invalid_result:${JSON.stringify(parsed?.errors ?? parsed)}`);
  }

  return {
    package: parsed.package,
    checksum: parsed.checksum,
    preview: parsed.preview,
  };
}

function readSourceFixture(rootDir, relativePath) {
  const sourcePath = resolve(rootDir, relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error('shared_household_board_source_missing');
  }

  const stats = statSync(sourcePath);
  if (stats.isDirectory()) {
    return { __sourceFolderPath: sourcePath };
  }

  const raw = readFileSync(sourcePath, 'utf8');
  const source = JSON.parse(raw);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('shared_household_board_source_invalid');
  }
  return normalizeLegacySource(source);
}

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArrayMapEntry(value) {
  if (isRecord(value)) {
    return Object.entries(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (!isRecord(entry)) return null;
        const rawId = isString(entry.id) ? entry.id.trim() : null;
        const id = rawId || `item-${index + 1}`;
        return [id, entry];
      })
      .filter((entry) => entry !== null);
  }
  return [];
}

function normalizeSourceFields(fields) {
  const entries = asArrayMapEntry(fields);
  return Object.fromEntries(entries.map(([fieldId, field]) => {
    const rawId = isString(field.id) ? field.id.trim() : null;
    const key = rawId || fieldId;
    return [
      key,
      {
        ...field,
        id: key,
      },
    ];
  }));
}

function normalizeSourceCollections(collections) {
  const entries = asArrayMapEntry(collections);
  return Object.fromEntries(entries.map(([collectionId, value]) => {
    const rawId = isString(value.id) ? value.id.trim() : null;
    const id = rawId || collectionId;
    const fields = normalizeSourceFields(value.fields);
    return [
      id,
      {
        ...value,
        id,
        fields,
      },
    ];
  }));
}

function normalizeSourceQueries(queries) {
  const entries = asArrayMapEntry(queries);
  return Object.fromEntries(entries.map(([queryId, value]) => {
    const rawId = isString(value.id) ? value.id.trim() : null;
    const id = rawId || queryId;
    return [
      id,
      {
        ...value,
        id,
      },
    ];
  }));
}

function normalizeSourceScreens(screens) {
  const entries = asArrayMapEntry(screens);
  return Object.fromEntries(entries.map(([screenId, value]) => {
    const rawId = isString(value.id) ? value.id.trim() : null;
    const id = rawId || screenId;
    return [
      id,
      {
        ...value,
        id,
      },
    ];
  }));
}

function normalizeLegacySource(source) {
  const normalized = isRecord(source) ? source : {};
  return {
    ...normalized,
    app: isRecord(normalized.app) ? { ...normalized.app } : {},
    collections: normalizeSourceCollections(normalized.collections),
    queries: normalizeSourceQueries(normalized.queries),
    screens: normalizeSourceScreens(normalized.screens),
    rules: isRecord(normalized.rules) ? normalized.rules : {},
    workflows: isRecord(normalized.workflows) ? normalized.workflows : {},
    providers: isRecord(normalized.providers) ? normalized.providers : {},
    theme: isRecord(normalized.theme) ? normalized.theme : {},
    fixtures: isRecord(normalized.fixtures) ? normalized.fixtures : {},
    acceptance: isRecord(normalized.acceptance) ? normalized.acceptance : {},
    capabilities: isRecord(normalized.capabilities) ? normalized.capabilities : {},
  };
}

function ensureTaskCollection(source) {
  const collections = isRecord(source?.collections) ? source.collections : {};
  const taskCollection = collections.task;
  if (!taskCollection || !isRecord(taskCollection.fields)) {
    throw new Error('shared_household_board_source_missing_task_collection');
  }
  return taskCollection;
}

function normalizeSourceIdentity(source, version) {
  const copy = clone(source);
  const app = isRecord(copy.app) ? copy.app : {};
  app.id = SHARED_HOUSEHOLD_BOARD_ID;
  app.version = String(version);
  app.label = app.label || 'Shared Household Board';
  app.homeSurface = app.homeSurface || 'today';
  copy.app = app;
  const taskCollection = ensureTaskCollection(copy);
  return { source: copy, taskCollection };
}

function addPriorityLaneIfMissing(taskCollection, includePriorityLane) {
  if (!includePriorityLane) return;
  if (isRecord(taskCollection.fields) && taskCollection.fields.priority_lane) return;
  if (!isRecord(taskCollection.fields)) {
    taskCollection.fields = {};
  }
  taskCollection.fields.priority_lane = {
    id: 'priority_lane',
    type: 'text',
    required: false,
    indexed: true,
  };
}

function compileSourcePackage(source, version, includePriorityLane) {
  const sourceInput = isRecord(source) ? source : {};
  const sourceFolder = sourceInput.__sourceFolderPath;

  if (isString(sourceFolder)) {
    const compiled = compileWithAppCompiler(sourceFolder, {
      version,
      addPriorityLane: includePriorityLane,
    });
    return {
      package: compiled.package,
      checksum: compiled.checksum,
      checksumRaw: compiled.checksum,
      preview: compiled.preview,
    };
  }

  const normalized = normalizeSourceIdentity(source, version);
  addPriorityLaneIfMissing(normalized.taskCollection, includePriorityLane);
  const compiled = compileWithAppCompiler(normalized.source, {
    version: normalized.source.app.version,
    addPriorityLane: includePriorityLane,
  });
  return {
    package: compiled.package,
    checksum: compiled.checksum,
    checksumRaw: compiled.checksum,
    preview: compiled.preview,
  };
}

export function buildSharedHouseholdBoardWebPackageArtifacts({
  root: rootDir = process.cwd(),
  sourceFixturePath = SOURCE_FIXTURE_PATH,
} = {}) {
  const source = readSourceFixture(rootDir, sourceFixturePath);
  const versionA = SHARED_HOUSEHOLD_BOARD_V1_VERSION;
  const versionB = SHARED_HOUSEHOLD_BOARD_V2_VERSION;

  const variantA = compileSourcePackage(source, versionA, false);
  const variantB = compileSourcePackage(source, versionB, true);

  return {
    id: SHARED_HOUSEHOLD_BOARD_ID,
    version: {
      v1: versionA,
      v2: versionB,
    },
    urls: {
      v1: SHARED_HOUSEHOLD_BOARD_V1_URL,
      v2: SHARED_HOUSEHOLD_BOARD_V2_URL,
    },
    v1: {
      package: variantA.package,
      checksum: variantA.checksum,
      checksum_raw: variantA.checksumRaw,
      packageUrl: SHARED_HOUSEHOLD_BOARD_V1_URL,
      preview: variantA.preview,
    },
    v2: {
      package: variantB.package,
      checksum: variantB.checksum,
      checksum_raw: variantB.checksumRaw,
      packageUrl: SHARED_HOUSEHOLD_BOARD_V2_URL,
      preview: variantB.preview,
    },
    source: {
      urlA: SHARED_HOUSEHOLD_BOARD_V1_URL,
      urlB: SHARED_HOUSEHOLD_BOARD_V2_URL,
    },
  };
}

export function writeSharedHouseholdBoardWebPackageArtifacts(rootDir, outputDir, artifacts) {
  mkdirSync(outputDir, { recursive: true });
  const v1Path = resolve(outputDir, 'shared-household-board.json');
  const v2Path = resolve(outputDir, 'shared-household-board-1.1.0.json');
  const metaPath = resolve(outputDir, 'metadata.json');

  const v1Payload = `${JSON.stringify(artifacts.v1.package, null, 2)}\n`;
  const v2Payload = `${JSON.stringify(artifacts.v2.package, null, 2)}\n`;

  writeFileSync(v1Path, v1Payload);
  writeFileSync(v2Path, v2Payload);
  writeFileSync(metaPath, `${JSON.stringify({
    package: {
      id: artifacts.id,
      v1: artifacts.version.v1,
      v2: artifacts.version.v2,
    },
    package_urls: artifacts.urls,
    urls: artifacts.urls,
    checksums: {
      v1: artifacts.v1.checksum,
      v2: artifacts.v2.checksum,
    },
    source: {
      path: SOURCE_FIXTURE_PATH,
      root: rootDir,
    },
    generatedAt: new Date().toISOString(),
    root,
  }, null, 2)}\n`);

  const written = {
    v1: {
      path: v1Path,
      bytes: v1Payload.length,
    },
    v2: {
      path: v2Path,
      bytes: v2Payload.length,
    },
    metadataPath: metaPath,
  };

  return {
    v1: {
      path: v1Path,
      checksum: artifacts.v1.checksum,
      packageUrl: artifacts.urls.v1,
    },
    v2: {
      path: v2Path,
      checksum: artifacts.v2.checksum,
      packageUrl: artifacts.urls.v2,
    },
    metadataPath: metaPath,
    outputDir,
    written,
  };
}
