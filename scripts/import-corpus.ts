import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PackageSchema } from '../src/kernel/schema';
import { enrichPackage } from './enrich-catalog';

type Candidate = {
  file: string;
  origin: 'local' | 'gold-v3' | 'luna-v3' | 'gold-v2';
  package: Record<string, unknown>;
  score: number;
};

const root = path.resolve(import.meta.dirname, '..');
const parity = process.env.UTOPIA_PARITY_ROOT ?? '/Users/srinivasvaddi/Projects/utopia-serious-app-parity';
const appsRepo = path.resolve(process.env.UTOPIA_APPS_REPO ?? path.join(root, '../utopia-apps'));
const packagesRoot = path.resolve(process.env.UTOPIA_APPS_DIR ?? path.join(appsRepo, 'packages'));
const output = path.join(packagesRoot, 'imported');
const reportPath = path.join(appsRepo, 'metadata', 'catalog-intake.json');
const priorities = { local: 4_000, 'gold-v3': 3_000, 'luna-v3': 2_000, 'gold-v2': 1_000 };

function files(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

function read(file: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

function migrateV2(value: Record<string, unknown>, file: string): Record<string, unknown> {
  return {
    ...value,
    schemaVersion: 'wonder.app-package.v3',
    dataHomes: [{ id: 'local', kind: 'sqlite', mode: 'local' }],
    defaultDataHome: 'local',
    dependencyPins: [],
    nativeCapabilities: {
      schemaVersion: 'wonder.app-package-native-capabilities.v1',
      platform: 'expo',
      packages: [],
    },
    contractLock: {
      schemaVersion: 'wonder.package-contract-lock.v1',
      algorithm: 'sha256',
      checksum: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`,
      pinnedAt: '2026-08-04T00:00:00.000Z',
    },
  };
}

const visibleKeys = new Set(['title', 'subtitle', 'text', 'description', 'emptyText', 'label']);
const internalCopy = /\b(package-only|app-specific|contract surface|device proof|awaiting_device_proof|not_run|kernel runtime)\b/i;

function normalizePresentation(value: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(value);
  const presentation = clone.presentation as Record<string, unknown> | undefined;
  const ui = presentation?.ui as Record<string, unknown> | undefined;
  const screens = (ui?.screens as Record<string, Record<string, unknown>> | undefined) ?? {};
  for (const screen of Object.values(screens)) {
    const components = Array.isArray(screen.components) ? screen.components as Array<Record<string, unknown>> : [];
    screen.components = components.filter((component) => !['dataHomeSettings', 'themeDensitySelector'].includes(String(component.widget)));
  }
  function clean(node: unknown, key = ''): unknown {
    if (typeof node === 'string' && visibleKeys.has(key)) {
      if (internalCopy.test(node)) return '';
      return node.length > 140 ? `${node.slice(0, 137).trim()}...` : node;
    }
    if (Array.isArray(node)) return node.map((item) => clean(item));
    if (node && typeof node === 'object') {
      for (const [childKey, child] of Object.entries(node)) (node as Record<string, unknown>)[childKey] = clean(child, childKey);
    }
    return node;
  }
  return clean(clone) as Record<string, unknown>;
}

function repairReferences(value: Record<string, unknown>): Record<string, unknown> {
  const collections = value.collections as Record<string, Record<string, unknown>>;
  const queries = value.queries as Record<string, Record<string, unknown>>;
  const views = value.views as Record<string, Record<string, unknown>>;
  const ensureCollection = (id: string) => {
    collections[id] ??= { id, fields: { title: { type: 'text', required: true, indexed: true } } };
  };
  for (const query of Object.values(queries)) ensureCollection(String(query.from));
  for (const view of Object.values(views)) {
    const queryId = String(view.query);
    if (!queries[queryId]) {
      ensureCollection(queryId);
      queries[queryId] = { from: queryId, limit: 200 };
    }
  }
  return value;
}

const recordWidgets = new Set([
  'formCard', 'smartCapture', 'recordHeroSummary', 'structuredList', 'recordContentCard',
  'recordTimeline', 'kanbanBoard', 'operationHistory', 'timelineBlock', 'recordReviewCard',
  'valueControl', 'groupedRecordShelf', 'quickAddList', 'horizontalRecordCarousel',
]);

function bindRecordWidgets(value: Record<string, unknown>): Record<string, unknown> {
  const collections = value.collections as Record<string, { id: string; fields: Record<string, Record<string, unknown>> }>;
  const presentation = value.presentation as Record<string, unknown>;
  const ui = presentation.ui as Record<string, unknown>;
  const screens = ui.screens as Record<string, { components?: Array<Record<string, unknown>> }>;
  for (const screen of Object.values(screens)) {
    for (const component of screen.components ?? []) {
      if (!recordWidgets.has(String(component.widget))) continue;
      const props = (component.props ??= {}) as Record<string, unknown>;
      const query = component.query as { collections?: string[] } | undefined;
      if (props.collection || query?.collections?.[0]) continue;
      const declared = Array.isArray(props.fields) ? props.fields : [];
      const fields = declared.map((field) => typeof field === 'string' ? field : String((field as Record<string, unknown>).id ?? '')).filter(Boolean);
      const ranked = Object.values(collections).map((collection) => ({
        id: collection.id,
        overlap: fields.filter((field) => collection.fields[field]).length,
      })).sort((a, b) => b.overlap - a.overlap || a.id.localeCompare(b.id));
      if (ranked[0]?.overlap || (ranked[0] && !['formCard', 'smartCapture'].includes(String(component.widget)))) {
        props.collection = ranked[0].id;
        continue;
      }
      const base = String(component.id ?? component.title ?? 'settings').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'settings';
      let id = base;
      for (let suffix = 2; collections[id]; suffix += 1) id = `${base}_${suffix}`;
      collections[id] = {
        id,
        fields: Object.fromEntries(declared.map((field) => {
          const spec = typeof field === 'string' ? { id: field, type: 'text' } : field as Record<string, unknown>;
          const type = ['number', 'boolean', 'timestamp', 'json'].includes(String(spec.type)) ? String(spec.type) : 'text';
          return [String(spec.id), { type, required: Boolean(spec.required) }];
        }).filter(([field]) => field)),
      };
      props.collection = id;
    }
  }
  return value;
}

function bindProposalOperations(value: Record<string, unknown>): Record<string, unknown> {
  const screens = ((value.presentation as Record<string, unknown>).ui as Record<string, unknown>).screens as Record<string, { components?: Array<Record<string, unknown>> }>;
  for (const screen of Object.values(screens)) {
    for (const component of screen.components ?? []) {
      const action = component.action as Record<string, unknown> | undefined;
      if (action?.kind !== 'propose' || action.operation) continue;
      const command = String(action.command ?? '').toLowerCase();
      const payload = (action.payload ?? {}) as Record<string, unknown>;
      const route = String(payload.route ?? '');
      action.collection ??= typeof payload.collection === 'string' ? payload.collection : undefined;
      action.target ??= route || undefined;
      action.operation =
        route ? 'navigate'
        : command === 'create_record' ? 'create'
        : command === 'update_record' ? 'update'
        : command === 'archive_record' ? 'archive'
        : command === 'restore_record' ? 'restore'
        : command === 'retry_sync' ? 'retry'
        : command === 'export_records' || command === 'share' ? 'export'
        : 'unsupported';
    }
  }
  return value;
}

function quality(value: Record<string, unknown>): number {
  const presentation = value.presentation as Record<string, unknown> | undefined;
  const ui = presentation?.ui as Record<string, unknown> | undefined;
  const screens = Object.values((ui?.screens as Record<string, unknown> | undefined) ?? {});
  const components = screens.reduce((count, screen) => {
    const list = (screen as Record<string, unknown>).components;
    return count + (Array.isArray(list) ? list.length : 0);
  }, 0);
  return screens.length * 10 + components;
}

const sources: Array<{ directory: string; origin: Candidate['origin']; accept(value: Record<string, unknown>): boolean }> = [
  {
    directory: packagesRoot,
    origin: 'local',
    accept: (value) => value.schemaVersion === 'wonder.app-package.v3',
  },
  {
    directory: path.join(parity, 'apps'),
    origin: 'gold-v3',
    accept: (value) => value.schemaVersion === 'wonder.app-package.v3',
  },
  {
    directory: path.join(parity, 'research', 'luna-app-generation'),
    origin: 'luna-v3',
    accept: (value) => value.schemaVersion === 'wonder.app-package.v3',
  },
  {
    directory: path.join(parity, 'apps'),
    origin: 'gold-v2',
    accept: (value) => value.schemaVersion === 'wonder.app-package.v2',
  },
];

const candidates: Candidate[] = [];
const rejected: Array<{ file: string; reason: string }> = [];
for (const source of sources) {
  for (const file of files(source.directory).filter((item) => item.endsWith('.json') && !item.startsWith(output))) {
    const value = read(file);
    if (!value || !source.accept(value)) continue;
    const migrated = bindProposalOperations(bindRecordWidgets(repairReferences(normalizePresentation(source.origin === 'gold-v2' ? migrateV2(value, file) : value))));
    const result = PackageSchema.safeParse(migrated);
    if (!result.success) {
      rejected.push({ file, reason: result.error.issues.map((issue) => issue.message).join('; ') });
      continue;
    }
    candidates.push({
      file,
      origin: source.origin,
      package: enrichPackage(result.data).package,
      score: priorities[source.origin] + quality(migrated),
    });
  }
}

const byId = new Map<string, Candidate[]>();
for (const candidate of candidates) {
  const id = String(candidate.package.id);
  byId.set(id, [...(byId.get(id) ?? []), candidate]);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const selected = [...byId].map(([id, options]) => {
  const sorted = options.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const winner = sorted[0];
  if (winner.origin === 'local') {
    fs.writeFileSync(winner.file, `${JSON.stringify(winner.package, null, 2)}\n`);
  } else {
    fs.writeFileSync(path.join(output, `${id}.v1.json`), `${JSON.stringify(winner.package, null, 2)}\n`);
  }
  return {
    id,
    selected: winner.file,
    origin: winner.origin,
    alternatives: sorted.slice(1).map((item) => item.file),
  };
}).sort((a, b) => a.id.localeCompare(b.id));

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({
  schemaVersion: 'utopia.catalog-intake.v1',
  generatedAt: new Date().toISOString(),
  parityRoot: parity,
  candidateFiles: candidates.length,
  identities: selected.length,
  origins: Object.fromEntries(Object.keys(priorities).map((origin) => [origin, selected.filter((item) => item.origin === origin).length])),
  rejected,
  selected,
}, null, 2)}\n`);
console.log(JSON.stringify({ candidates: candidates.length, identities: selected.length, rejected: rejected.length }));
