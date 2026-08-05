import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const appsRepo = path.resolve(process.env.UTOPIA_APPS_REPO ?? path.join(root, '../utopia-apps'));
const appsRoot = path.resolve(process.env.UTOPIA_APPS_DIR ?? path.join(appsRepo, 'packages'));
const reportRoot = path.join(appsRepo, 'metadata');
const threshold = Number(process.env.UTOPIA_DUPLICATE_THRESHOLD ?? 0.5);
const presentationOnlyWidgets = new Set(['assetBlock']);

const widgetFamilies = {
  assistantChat: 'ai', audioLoopPlayer: 'audio', videoPlayer: 'video',
  dataTable: 'records', chartBlock: 'analytics', checklistCard: 'tasks',
  durationTimer: 'timing', stepFlow: 'workflow', scientificCalculator: 'calculation',
  formCard: 'records', smartCapture: 'capture', postCard: 'social', pollCard: 'social',
  feedList: 'feed', calendarBlock: 'calendar', mediaBlock: 'media',
  galleryGrid: 'media', showcaseHero: 'media', cardCarousel: 'media',
  eventTimeline: 'timeline', featureCard: 'content', reviewCard: 'reviews',
  tileGrid: 'content', providerStatus: 'providers', widgetCatalog: 'catalog',
  permissionCard: 'permissions', filePicker: 'files', fileExport: 'files',
  locationMap: 'location', notificationScheduler: 'notifications',
  contactPicker: 'contacts', calendarEvent: 'calendar', biometricGate: 'biometrics',
  speechTool: 'speech', healthConnect: 'health', healthConnectStatus: 'health',
  healthKitStatus: 'health', cameraScanner: 'camera', sensorReadout: 'sensors',
  jsonUi: 'custom-layout', recordHeroSummary: 'records', structuredList: 'records',
  recordContentCard: 'records', recordTimeline: 'timeline', kanbanBoard: 'tasks',
  operationHistory: 'history', timelineBlock: 'timeline', recordReviewCard: 'reviews',
  valueControl: 'controls', groupedRecordShelf: 'records', quickAddList: 'records',
  horizontalRecordCarousel: 'records', messageThread: 'messaging', canvasBoard: 'canvas',
  automationFlow: 'automation', routePlanner: 'routing', gameSession: 'game',
};

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function bucket(prefix, count) {
  if (count <= 1) return `${prefix}:1`;
  if (count <= 3) return `${prefix}:2-3`;
  if (count <= 7) return `${prefix}:4-7`;
  if (count <= 15) return `${prefix}:8-15`;
  return `${prefix}:16+`;
}

function capabilityTokens(pkg) {
  const tokens = new Set();
  const screens = Object.values(pkg.presentation?.ui?.screens ?? {});
  const components = screens.flatMap((screen) => screen.components ?? []);

  for (const component of components) {
    if (component.widget && !presentationOnlyWidgets.has(component.widget)) {
      tokens.add(`widget:${component.widget}`);
      tokens.add(`family:${widgetFamilies[component.widget] ?? 'unknown-widget'}`);
    }
    if (component.kind && component.kind !== 'widget') tokens.add(`component:${component.kind}`);
    if (component.action?.kind) tokens.add(`action:${component.action.kind}`);
    if (component.action?.operation) tokens.add(`operation:${component.action.operation}`);
    if (component.query?.collections?.length || component.view || component.props?.collection) tokens.add('binding:records');
  }
  for (const collection of Object.values(pkg.collections ?? {})) {
    for (const field of Object.values(collection.fields ?? {})) tokens.add(`field:${field.type}`);
  }
  for (const view of Object.values(pkg.views ?? {})) tokens.add(`view:${view.mode}`);
  for (const home of pkg.dataHomes ?? []) tokens.add(`data:${home.kind}:${home.mode}`);
  for (const dependency of pkg.dependencyPins ?? []) tokens.add(`dependency:${dependency.package}`);
  for (const nativePackage of pkg.nativeCapabilities?.packages ?? []) tokens.add(`native:${nativePackage}`);
  for (const permission of pkg.nativeCapabilities?.permissions ?? []) {
    if (permission?.permission) tokens.add(`permission:${permission.permission}`);
  }
  for (const intent of pkg.nativeCapabilities?.intents ?? []) {
    if (intent?.kind) tokens.add(`intent:${intent.kind}`);
  }
  const layout = pkg.presentation?.ui?.layout ?? {};
  for (const key of ['compact', 'medium', 'wide', 'portrait', 'landscape']) {
    if (layout[key]) tokens.add(`responsive:${key}`);
  }
  for (const platform of Object.keys(layout.platform ?? {})) tokens.add(`platform-layout:${platform}`);
  tokens.add(bucket('screens', screens.length));
  tokens.add(bucket('collections', Object.keys(pkg.collections ?? {}).length));
  tokens.add(bucket('queries', Object.keys(pkg.queries ?? {}).length));
  return [...tokens].sort();
}

function similarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return {
    score: shared / (a.size + b.size - shared || 1),
    shared: [...a].filter((token) => b.has(token)),
    leftOnly: [...a].filter((token) => !b.has(token)),
    rightOnly: [...b].filter((token) => !a.has(token)),
  };
}

const packages = walk(appsRoot)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({ file, pkg: JSON.parse(fs.readFileSync(file, 'utf8')) }))
  .filter(({ pkg }) => pkg.schemaVersion === 'wonder.app-package.v3')
  .map(({ file, pkg }) => ({
    id: pkg.id,
    label: pkg.presentation?.label ?? pkg.id,
    file: path.relative(appsRepo, file),
    tokens: capabilityTokens(pkg),
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const pairs = [];
const nearest = new Map(packages.map(({ id }) => [id, undefined]));
const tokenFrequency = new Map();
for (const pkg of packages) for (const token of pkg.tokens) tokenFrequency.set(token, (tokenFrequency.get(token) ?? 0) + 1);
for (let left = 0; left < packages.length; left += 1) {
  for (let right = left + 1; right < packages.length; right += 1) {
    const result = similarity(packages[left].tokens, packages[right].tokens);
    const candidate = { left: packages[left].id, right: packages[right].id, score: Number(result.score.toFixed(4)), shared: result.shared };
    if (!nearest.get(candidate.left) || nearest.get(candidate.left).score < candidate.score) nearest.set(candidate.left, { id: candidate.right, score: candidate.score, shared: candidate.shared });
    if (!nearest.get(candidate.right) || nearest.get(candidate.right).score < candidate.score) nearest.set(candidate.right, { id: candidate.left, score: candidate.score, shared: candidate.shared });
    if (result.score < threshold) continue;
    pairs.push({
      left: packages[left].id,
      right: packages[right].id,
      score: Number(result.score.toFixed(4)),
      shared: result.shared,
      leftOnly: result.leftOnly,
      rightOnly: result.rightOnly,
    });
  }
}
pairs.sort((a, b) => b.score - a.score || a.left.localeCompare(b.left) || a.right.localeCompare(b.right));

const parent = new Map(packages.map(({ id }) => [id, id]));
function find(id) {
  const current = parent.get(id);
  if (current !== id) parent.set(id, find(current));
  return parent.get(id);
}
function union(a, b) {
  const left = find(a);
  const right = find(b);
  if (left !== right) parent.set(right, left);
}
for (const pair of pairs) union(pair.left, pair.right);

const grouped = new Map();
for (const pkg of packages) {
  const key = find(pkg.id);
  grouped.set(key, [...(grouped.get(key) ?? []), pkg.id]);
}
const clusters = [...grouped.values()]
  .filter((members) => members.length > 1)
  .map((members) => {
    const memberPairs = pairs.filter((pair) => members.includes(pair.left) && members.includes(pair.right));
    return {
      members: members.sort(),
      pairCount: memberPairs.length,
      maxSimilarity: Math.max(...memberPairs.map((pair) => pair.score)),
      minDirectSimilarity: Math.min(...memberPairs.map((pair) => pair.score)),
    };
  })
  .sort((a, b) => b.members.length - a.members.length || b.maxSimilarity - a.maxSimilarity);

const duplicateIds = new Set(pairs.flatMap((pair) => [pair.left, pair.right]));
const signatures = new Map();
for (const pkg of packages) {
  const key = pkg.tokens.join('\n');
  signatures.set(key, [...(signatures.get(key) ?? []), pkg.id]);
}
const exactGroups = [...signatures.values()]
  .filter((members) => members.length > 1)
  .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
const exactDuplicateIds = new Set(exactGroups.flat());
const edgeLeaders = packages.map((pkg) => ({
  id: pkg.id,
  capabilityTokens: pkg.tokens.length,
  rareTokens: pkg.tokens.filter((token) => (tokenFrequency.get(token) ?? 0) <= 5),
  nearest: nearest.get(pkg.id),
})).sort((a, b) => b.rareTokens.length - a.rareTokens.length || b.capabilityTokens - a.capabilityTokens || a.id.localeCompare(b.id));
const covered = new Set();
const remaining = [...packages];
const coveragePortfolio = [];
while (coveragePortfolio.length < 30 && remaining.length) {
  const scored = remaining.map((pkg) => {
    const uncovered = pkg.tokens.filter((token) => !covered.has(token) && !/^capability:records\./.test(token));
    return { pkg, uncovered, score: uncovered.reduce((sum, token) => sum + 1 / (tokenFrequency.get(token) ?? 1), 0) };
  }).sort((a, b) => b.score - a.score || b.uncovered.length - a.uncovered.length || a.pkg.id.localeCompare(b.pkg.id));
  const selected = scored[0];
  if (!selected?.uncovered.length) break;
  coveragePortfolio.push({ id: selected.pkg.id, newTokens: selected.uncovered, score: Number(selected.score.toFixed(4)), nearest: nearest.get(selected.pkg.id) });
  selected.pkg.tokens.forEach((token) => covered.add(token));
  remaining.splice(remaining.findIndex((pkg) => pkg.id === selected.pkg.id), 1);
}
const output = {
  schemaVersion: 'utopia.catalog-capability-similarity.v2',
  generatedAt: new Date().toISOString(),
  threshold,
  method: 'Jaccard similarity over executable structure; labels, prose, colors, imagery, product identity, acceptance claims, and self-declared capabilities excluded',
  packageCount: packages.length,
  duplicatePairCount: pairs.length,
  duplicateAppCount: duplicateIds.size,
  distinctAtThresholdCount: packages.length - duplicateIds.size,
  clusterCount: clusters.length,
  exactSignatureCount: signatures.size,
  exactDuplicateGroupCount: exactGroups.length,
  exactDuplicateAppCount: exactDuplicateIds.size,
  edgeLeaders,
  coveragePortfolio,
  packages,
  exactGroups,
  clusters,
  pairs,
};

fs.mkdirSync(reportRoot, { recursive: true });
fs.writeFileSync(path.join(reportRoot, 'catalog-capability-similarity.json'), `${JSON.stringify(output, null, 2)}\n`);

const rows = clusters.map((cluster, index) => {
  const strongest = pairs.find((pair) => cluster.members.includes(pair.left) && cluster.members.includes(pair.right));
  return `| ${index + 1} | ${cluster.members.length} | ${Math.round(cluster.maxSimilarity * 100)}% | ${cluster.members.slice(0, 12).join(', ')}${cluster.members.length > 12 ? ', ...' : ''} | ${strongest?.shared.slice(0, 8).join(', ') ?? ''} |`;
});
const exactRows = exactGroups.map((members, index) =>
  `| ${index + 1} | ${members.length} | ${members.slice(0, 16).join(', ')}${members.length > 16 ? ', ...' : ''} |`,
);
const topPairs = pairs.slice(0, 100).map((pair) =>
  `| ${pair.left} | ${pair.right} | ${Math.round(pair.score * 100)}% | ${pair.shared.slice(0, 8).join(', ')} | ${[...pair.leftOnly.slice(0, 3), ...pair.rightOnly.slice(0, 3)].join(', ') || 'none'} |`,
);
const edgeRows = edgeLeaders.slice(0, 30).map((app, index) =>
  `| ${index + 1} | ${app.id} | ${app.capabilityTokens} | ${app.rareTokens.length} | ${app.rareTokens.slice(0, 8).join(', ') || 'none'} | ${app.nearest?.id ?? 'none'} (${Math.round((app.nearest?.score ?? 0) * 100)}%) |`,
);
const portfolioRows = coveragePortfolio.map((app, index) =>
  `| ${index + 1} | ${app.id} | ${app.newTokens.length} | ${app.newTokens.slice(0, 8).join(', ')} | ${app.nearest?.id ?? 'none'} (${Math.round((app.nearest?.score ?? 0) * 100)}%) |`,
);
const markdown = `# Catalog capability duplicates

Generated: ${output.generatedAt}

Similarity ignores names, copy, colors, imagery, acceptance claims, and self-declared capability strings. It compares bound widgets, action/operation kinds, data/view modes, field types, native packages, permissions, intents, dependencies, and responsive structure.

| Metric | Count |
|---|---:|
| V3 packages | ${packages.length} |
| Similar pairs at >= ${Math.round(threshold * 100)}% | ${pairs.length} |
| Apps in at least one similar pair | ${duplicateIds.size} |
| Apps with no >= ${Math.round(threshold * 100)}% match | ${output.distinctAtThresholdCount} |
| Similarity clusters | ${clusters.length} |
| Exact capability signatures | ${signatures.size} |
| Apps in exact-duplicate groups | ${exactDuplicateIds.size} |
| Exact-duplicate groups | ${exactGroups.length} |

## Platform edge leaders

These apps exercise the broadest and rarest declared behavior. This is a prioritization list, not production admission.

| # | App | Capability tokens | Rare tokens | Rare behavior | Nearest app |
|---:|---|---:|---:|---|---|
${edgeRows.join('\n')}

## 30-app maximum-coverage portfolio

Greedy selection favors new functional tokens. These are the best current candidates for pushing the platform edge; each still requires runtime proof.

| # | App | New tokens | New platform surface | Nearest app |
|---:|---|---:|---|---|
${portfolioRows.join('\n')}

## Exact duplicate families

| # | Apps | Members |
|---:|---:|---|
${exactRows.join('\n') || '| - | 0 | none |'}

## Clusters

| # | Apps | Max similarity | Members | Strong shared capabilities |
|---:|---:|---:|---|---|
${rows.join('\n') || '| - | 0 | - | none | none |'}

## Strongest pairs

| App A | App B | Similarity | Shared capability tokens | Differences |
|---|---|---:|---|---|
${topPairs.join('\n') || '| none | none | - | none | none |'}

Full pair evidence: \`metadata/catalog-capability-similarity.json\`.
`;
fs.writeFileSync(path.join(reportRoot, 'catalog-capability-duplicates.md'), markdown);
console.log(JSON.stringify({
  packages: packages.length,
  threshold,
  pairs: pairs.length,
  duplicateApps: duplicateIds.size,
  distinctApps: output.distinctAtThresholdCount,
  clusters: clusters.length,
  exactSignatures: signatures.size,
  exactDuplicateApps: exactDuplicateIds.size,
}));
