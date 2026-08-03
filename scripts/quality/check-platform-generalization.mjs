import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const appsRoot = path.join(root, 'apps');
const baselinePath = path.join(root, 'scripts/quality/platform-generalization-baseline.json');
const evidencePath = path.join(root, 'app/build/evidence/platform-generalization.json');

const domainSpecificWidgets = new Set([
  'pantryShelf',
  'askFoodBar',
]);

const specializedRuntimeWidgets = new Set([
  'scientificCalculator',
  'audioLoopPlayer',
  'healthConnect',
]);

const baseline = readBaseline();
const appFiles = findBundledAppPackages();
const allApps = appFiles.map((file) => inspectAppPackage(file));
const excludedProbeIds = new Set(baseline?.excludedProbeApps ?? []);
const apps = allApps
  .filter((app) => !excludedProbeIds.has(app.id))
  .map((app) => ({
    ...app,
    ratchet: {
      expectedClassification: baseline?.expectedAppClassifications?.[app.id] ?? null,
      domainSpecificWidgetReferenceDelta:
        app.domainSpecificWidgetReferences.length
        - (baseline?.perAppMaximumDomainSpecificWidgetReferences?.[app.id]
          ?? app.domainSpecificWidgetReferences.length),
      specializedRuntimeWidgetDelta:
        app.specializedRuntimeWidgetsRequired.length
        - (baseline?.perAppMaximumSpecializedRuntimeWidgetsRequired?.[app.id]
          ?? app.specializedRuntimeWidgetsRequired.length),
    },
  }));
const probes = allApps.filter((app) => excludedProbeIds.has(app.id));
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
  baseline: baseline ? {
    path: path.relative(root, baselinePath),
    ...baseline,
  } : null,
  totals,
  apps,
  probes,
  thresholds: {
    minimumBundledApps: 3,
    maximumAllowedMissingPackages: 0,
  },
};

const problems = [];
for (const probeId of excludedProbeIds) {
  if (!allApps.some((app) => app.id === probeId)) {
    problems.push(`excluded probe is missing from apps/: ${probeId}`);
  }
}
if (apps.length < evidence.thresholds.minimumBundledApps) {
  problems.push(`expected at least ${evidence.thresholds.minimumBundledApps} bundled apps, found ${apps.length}`);
}
if (baseline) {
  for (const [appId, expectedClassification] of Object.entries(baseline.expectedAppClassifications ?? {})) {
    const app = apps.find((candidate) => candidate.id === appId);
    if (!app) {
      problems.push(`required sentinel app is missing: ${appId}`);
    } else if (app.classification !== expectedClassification) {
      problems.push(`${appId}: expected ${expectedClassification}, found ${app.classification}`);
    }
  }
  if (totals.apps < baseline.minimumBundledApps) {
    problems.push(`bundled app count regressed: expected at least ${baseline.minimumBundledApps}, found ${totals.apps}`);
  }
  if (totals.purePackageApps < baseline.minimumPurePackageApps) {
    problems.push(`package-only app count regressed: expected at least ${baseline.minimumPurePackageApps}, found ${totals.purePackageApps}`);
  }
  if (totals.domainDebtApps > baseline.maximumDomainDebtApps) {
    problems.push(`domain-debt app count increased: max ${baseline.maximumDomainDebtApps}, found ${totals.domainDebtApps}`);
  }
  if (totals.domainSpecificWidgetReferences > baseline.maximumDomainSpecificWidgetReferences) {
    problems.push(`domain-specific widget references increased: max ${baseline.maximumDomainSpecificWidgetReferences}, found ${totals.domainSpecificWidgetReferences}`);
  }
  if (totals.specializedRuntimeWidgetsRequired > baseline.maximumSpecializedRuntimeWidgetsRequired) {
    problems.push(`specialized runtime widgets increased: max ${baseline.maximumSpecializedRuntimeWidgetsRequired}, found ${totals.specializedRuntimeWidgetsRequired}`);
  }
  for (const app of apps) {
    const maxDomainRefs = baseline.perAppMaximumDomainSpecificWidgetReferences?.[app.id];
    if (maxDomainRefs !== undefined && app.domainSpecificWidgetReferences.length > maxDomainRefs) {
      problems.push(`${app.id}: domain-specific widget references increased: max ${maxDomainRefs}, found ${app.domainSpecificWidgetReferences.length}`);
    }
    const maxRuntimeWidgets = baseline.perAppMaximumSpecializedRuntimeWidgetsRequired?.[app.id];
    if (maxRuntimeWidgets !== undefined && app.specializedRuntimeWidgetsRequired.length > maxRuntimeWidgets) {
      problems.push(`${app.id}: specialized runtime widgets increased: max ${maxRuntimeWidgets}, found ${app.specializedRuntimeWidgetsRequired.length}`);
    }
  }
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

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null;
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  if (baseline.schemaVersion !== 'utopia.platform-generalization-baseline.v1') {
    throw new Error('platform_generalization_baseline_schema_invalid');
  }
  for (const key of [
    'minimumBundledApps',
    'minimumPurePackageApps',
    'maximumDomainDebtApps',
    'maximumDomainSpecificWidgetReferences',
    'maximumSpecializedRuntimeWidgetsRequired',
  ]) {
    if (!Number.isInteger(baseline[key]) || baseline[key] < 0) {
      throw new Error(`platform_generalization_baseline_${key}_invalid`);
    }
  }
  if (baseline.excludedProbeApps !== undefined) {
    if (!Array.isArray(baseline.excludedProbeApps) || baseline.excludedProbeApps.some((id) => typeof id !== 'string')) {
      throw new Error('platform_generalization_baseline_excludedProbeApps_invalid');
    }
  }
  if (baseline.expectedAppClassifications !== undefined) {
    const valid = new Set(['pure_package', 'reusable_runtime_capability', 'domain_specific_debt']);
    if (
      !baseline.expectedAppClassifications
      || typeof baseline.expectedAppClassifications !== 'object'
      || Array.isArray(baseline.expectedAppClassifications)
      || Object.entries(baseline.expectedAppClassifications)
        .some(([id, classification]) => !id || !valid.has(classification))
    ) {
      throw new Error('platform_generalization_baseline_expectedAppClassifications_invalid');
    }
  }
  return baseline;
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}
