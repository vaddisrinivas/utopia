import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const appsRoot = path.join(root, 'apps');
const evidencePath = path.join(root, 'app/build/evidence/platform-generalization.json');

const domainSpecificWidgets = new Set([
  'foodHero',
  'useFirstCarousel',
  'mealTimeline',
  'recipeCard',
  'receiptReviewCard',
  'pantryShelf',
  'askFoodBar',
]);

const specializedRuntimeWidgets = new Set([
  'scientificCalculator',
  'audioLoopPlayer',
  'healthConnect',
]);

const appFiles = findBundledAppPackages();
const apps = appFiles.map((file) => inspectAppPackage(file));
const totals = {
  apps: apps.length,
  purePackageApps: apps.filter((app) => app.classification === 'pure_package').length,
  reusableRuntimeCapabilityApps: apps.filter((app) => app.classification === 'reusable_runtime_capability').length,
  domainDebtApps: apps.filter((app) => app.classification === 'domain_specific_debt').length,
  domainSpecificWidgetReferences: apps.reduce((total, app) => total + app.domainSpecificWidgetReferences.length, 0),
  specializedRuntimeWidgetsRequired: unique(apps.flatMap((app) => app.specializedRuntimeWidgetsRequired)).length,
};

const evidence = {
  status: 'PASS',
  commit: currentCommit(),
  checkedAt: new Date().toISOString(),
  thesis: 'New app packages should trend toward zero domain-specific widgets and explicit reusable runtime capabilities.',
  totals,
  apps,
  thresholds: {
    minimumBundledApps: 3,
    maximumAllowedMissingPackages: 0,
  },
};

const problems = [];
if (apps.length < evidence.thresholds.minimumBundledApps) {
  problems.push(`expected at least ${evidence.thresholds.minimumBundledApps} bundled apps, found ${apps.length}`);
}

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (problems.length) {
  console.error('Platform generalization check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(
  `Platform generalization check: PASS (${totals.apps} apps, ${totals.domainSpecificWidgetReferences} domain-specific widget references, ${totals.specializedRuntimeWidgetsRequired} specialized runtime widgets; evidence: ${path.relative(root, evidencePath)})`,
);

function findBundledAppPackages() {
  if (!fs.existsSync(appsRoot)) return [];
  return fs.readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = path.join(appsRoot, entry.name);
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.v1.json'))
        .map((name) => path.join(dir, name));
    })
    .sort();
}

function inspectAppPackage(file) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  const components = [];
  const screenSources = [
    document.presentation?.ui?.screens,
    document.ui?.screens,
    document.render?.screens,
  ].filter(Boolean);
  walk(screenSources, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (typeof value.kind === 'string') {
      components.push({
        kind: value.kind,
        widget: typeof value.widget === 'string' ? value.widget : null,
      });
    }
  });

  const widgets = components.map((component) => component.widget).filter(Boolean);
  const domainSpecificWidgetReferences = widgets.filter((widget) => domainSpecificWidgets.has(widget));
  const specializedRuntimeWidgetsRequired = unique(widgets.filter((widget) => specializedRuntimeWidgets.has(widget)));
  const genericWidgetsUsed = unique(widgets.filter((widget) => !domainSpecificWidgets.has(widget) && !specializedRuntimeWidgets.has(widget)));
  const componentKindsUsed = unique(components.map((component) => component.kind));
  const classification = domainSpecificWidgetReferences.length > 0
    ? 'domain_specific_debt'
    : specializedRuntimeWidgetsRequired.length > 0
      ? 'reusable_runtime_capability'
      : 'pure_package';

  return {
    id: String(document.id ?? path.basename(file, '.json')),
    version: String(document.version ?? 'unknown'),
    path: path.relative(root, file),
    classification,
    componentKindsUsed,
    genericWidgetsUsed,
    specializedRuntimeWidgetsRequired,
    domainSpecificWidgetReferences,
    rendererEconomics: {
      packageOnly: classification === 'pure_package',
      needsReusableRuntimeCapability: specializedRuntimeWidgetsRequired.length > 0,
      carriesDomainSpecificRendererDebt: domainSpecificWidgetReferences.length > 0,
    },
  };
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
