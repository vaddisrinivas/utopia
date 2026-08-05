import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PackageSchema } from '../src/kernel/schema';
import { enrichPackage } from './enrich-catalog';

type Origin = 'local' | 'gold-v3' | 'luna-v3' | 'gold-v2';
type Candidate = { file: string; origin: Origin; package: Record<string, unknown>; score: number };
type Source = { origin: Origin; schema: string; root: (appsDir: string, parityRoot: string) => string };

const SOURCES: Source[] = [
  { origin: 'local', schema: 'wonder.app-package.v3', root: (appsDir) => appsDir },
  { origin: 'gold-v3', schema: 'wonder.app-package.v3', root: (_appsDir, parityRoot) => path.join(parityRoot, 'apps') },
  { origin: 'luna-v3', schema: 'wonder.app-package.v3', root: (_appsDir, parityRoot) => path.join(parityRoot, 'research', 'luna-app-generation') },
  { origin: 'gold-v2', schema: 'wonder.app-package.v2', root: (_appsDir, parityRoot) => path.join(parityRoot, 'apps') },
];

const PRIORITY: Record<Origin, number> = { local: 4000, 'gold-v3': 3000, 'luna-v3': 2000, 'gold-v2': 1000 };
const RECORD_WIDGETS = new Set(['formCard', 'smartCapture', 'recordHeroSummary', 'structuredList', 'recordContentCard', 'recordTimeline', 'kanbanBoard', 'operationHistory', 'timelineBlock', 'recordReviewCard', 'valueControl', 'groupedRecordShelf', 'quickAddList', 'horizontalRecordCarousel']);
const scrubText = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') {
    if (!['title', 'subtitle', 'text', 'description', 'emptyText', 'label'].includes(key)) return value;
    if (/(package-only|app-specific|contract surface|device proof|awaiting_device_proof|not_run|kernel runtime)/i.test(value)) return '';
    return value.length > 140 ? `${value.slice(0, 137).trim()}...` : value;
  }
  if (Array.isArray(value)) return value.map((entry) => scrubText(entry));
  if (!value || typeof value !== 'object') return value;
  for (const [k, v] of Object.entries(value)) (value as Record<string, unknown>)[k] = scrubText(v, k);
  return value;
};

const walk = (dir: string): string[] =>
  !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

const readJson = (file: string): Record<string, unknown> | undefined => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return; }
};

const migrateV2 = (value: Record<string, unknown>, sourceFile: string) => ({
  ...value,
  schemaVersion: 'wonder.app-package.v3',
  dataHomes: [{ id: 'local', kind: 'sqlite', mode: 'local' }],
  defaultDataHome: 'local',
  dependencyPins: [],
  nativeCapabilities: { schemaVersion: 'wonder.app-package-native-capabilities.v1', platform: 'expo', packages: [] },
  contractLock: { schemaVersion: 'wonder.package-contract-lock.v1', algorithm: 'sha256', checksum: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex')}`, pinnedAt: '2026-08-04T00:00:00.000Z' },
});

const normalize = (app: Record<string, unknown>) => {
  const value = scrubText(structuredClone(app)) as Record<string, any>;
  value.collections ??= {}; value.queries ??= {}; value.views ??= {};
  const screens = value.presentation?.ui?.screens as Record<string, any> ?? {};
  const collections = value.collections as Record<string, { id: string; fields: Record<string, any> }>;
  const ensureCollection = (id: string) => {
    if (!id || collections[id]) return;
    collections[id] = { id, fields: { title: { type: 'text', required: true, indexed: true } } };
  };
  for (const query of Object.values(value.queries as Record<string, { from?: string }>) as Array<{ from?: string }>) ensureCollection(String(query.from));
  for (const view of Object.values(value.views as Record<string, { query?: string }>) as Array<{ query?: string }>) {
    const id = String(view?.query ?? ''); if (!id) continue;
    value.queries[id] ??= { from: id, limit: 200 };
    ensureCollection(id);
  }

  for (const screen of Object.values(screens)) {
    screen.components = (screen.components ?? []).filter((component: Record<string, any>) => !['dataHomeSettings', 'themeDensitySelector'].includes(String(component.widget)));
    for (const component of screen.components) {
      if (component.action?.kind === 'propose' && !component.action.operation) {
        const payload = (component.action.payload ?? {}) as Record<string, any>;
        const command = String(component.action.command ?? '').toLowerCase();
        const operation = String(payload.route ?? '') || command;
        component.action.collection = typeof payload.collection === 'string' ? payload.collection : undefined;
        component.action.target = String(payload.route ?? '') || undefined;
        component.action.operation = operation === 'create_record' ? 'create'
          : operation === 'update_record' ? 'update'
          : operation === 'archive_record' ? 'archive'
          : operation === 'restore_record' ? 'restore'
          : operation === 'retry_sync' ? 'retry'
          : operation === 'export_records' || operation === 'share' ? 'export'
          : operation ? 'navigate' : 'unsupported';
      }

      if (!RECORD_WIDGETS.has(String(component.widget)) || component?.query?.collections?.[0] || component.props?.collection) continue;
      const fields = (Array.isArray(component.props?.fields) ? component.props.fields : []).map((field: any) => String(typeof field === 'string' ? field : field?.id ?? '')).filter(Boolean);
      const ranked = Object.values(collections).map((collection) => ({ id: collection.id, overlap: fields.filter((field) => collection.fields[field]).length })).sort((left, right) => right.overlap - left.overlap || left.id.localeCompare(right.id));
      const best = ranked[0];
      if (best?.overlap || !['formCard', 'smartCapture'].includes(String(component.widget))) { component.props ??= {}; component.props.collection = best?.id; continue; }
      const base = String(component.id ?? component.title ?? 'settings').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'settings';
      let collectionId = base;
      for (let suffix = 2; collections[collectionId]; suffix += 1) collectionId = `${base}_${suffix}`;
      collections[collectionId] = { id: collectionId, fields: Object.fromEntries(fields.map((field) => [String(field), { type: 'text', required: Boolean(component?.props?.required) }])) };
      component.props ??= {}; component.props.collection = collectionId;
    }
  }
  return value;
};

const score = (app: Record<string, any>) => {
  const screens = Object.values(app.presentation?.ui?.screens ?? {});
  return screens.length * 10 + screens.reduce((sum, screen) => sum + ((screen?.components ?? []).length), 0);
};

export function runImportCorpus(context: { parityRoot?: string; appsRepo?: string; appsDir?: string; output?: string; reportPath?: string } = {}) {
  const parityRoot = path.resolve(context.parityRoot ?? process.env.UTOPIA_PARITY_ROOT ?? '/Users/srinivasvaddi/Projects/utopia-serious-app-parity');
  const appsRepo = path.resolve(context.appsRepo ?? process.env.UTOPIA_APPS_REPO ?? path.resolve(process.cwd(), '../utopia-apps'));
  const appsDir = path.resolve(context.appsDir ?? process.env.UTOPIA_APPS_DIR ?? path.join(appsRepo, 'packages'));
  const output = path.resolve(context.output ?? path.join(appsDir, 'imported'));
  const reportPath = path.resolve(context.reportPath ?? path.join(appsRepo, 'metadata', 'catalog-intake.json'));

  const candidates: Candidate[] = [];
  const rejected: Array<{ file: string; reason: string }> = [];
  for (const source of SOURCES) {
    for (const file of walk(source.root(appsDir, parityRoot).toString()).filter((file) => file.endsWith('.json') && !file.startsWith(output))) {
      const raw = readJson(file); if (!raw || raw.schemaVersion !== source.schema) continue;
      const normalized = source.origin === 'gold-v2' ? migrateV2(normalize(raw), file) : normalize(raw);
      const parsed = PackageSchema.safeParse(normalized);
      if (!parsed.success) { rejected.push({ file, reason: parsed.error.issues.map((issue) => issue.message).join('; ') }); continue; }
      const enriched = enrichPackage(parsed.data).package as Record<string, unknown>;
      candidates.push({ file, origin: source.origin, package: enriched, score: PRIORITY[source.origin] + score(enriched as Record<string, any>) });
    }
  }

  const byId = new Map<string, Candidate[]>();
  for (const candidate of candidates) byId.set(String((candidate.package as { id?: string }).id), [...(byId.get(String((candidate.package as { id?: string }).id)) ?? []), candidate]);
  const report = {
    schemaVersion: 'utopia.catalog-intake.v1' as const,
    generatedAt: new Date().toISOString(),
    parityRoot,
    candidateFiles: candidates.length,
    identities: byId.size,
    origins: Object.fromEntries(Object.keys(PRIORITY).map((origin) => [origin, 0])) as Record<Origin, number>,
    rejected,
    selected: [] as Array<{ id: string; selected: string; origin: Origin; alternatives: string[] }>,
  };
  for (const [id, options] of byId) {
    const ranked = [...options].sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));
    const chosen = ranked[0];
    if (!chosen) continue;
    report.selected.push({ id, selected: chosen.file, origin: chosen.origin, alternatives: ranked.slice(1).map((option) => option.file) });
    report.origins[chosen.origin] += 1;
  }
  report.selected.sort((left, right) => left.id.localeCompare(right.id));

  fs.mkdirSync(output, { recursive: true });
  for (const item of report.selected) {
    const chosen = candidates.find((candidate) => candidate.file === item.selected && String((candidate.package as Record<string, any>).id) === item.id);
    if (!chosen) continue;
    fs.writeFileSync(path.join(output, `${item.id}.v1.json`), `${JSON.stringify(chosen.package, null, 2)}\n`);
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function main(argv = process.argv.slice(2)): number {
  const context: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--')) context[argument.slice(2)] = argv[index + 1] ?? '';
  }
  runImportCorpus({
    parityRoot: context['parity-root'],
    appsRepo: context['apps-repo'],
    appsDir: context['apps-dir'],
    output: context['output'],
    reportPath: context['report'],
  });
  return 0;
}

if (path.basename(process.argv[1]) === 'import-corpus.ts') {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
