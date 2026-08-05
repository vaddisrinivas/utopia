import fs from 'node:fs';
import path from 'node:path';

const appsRepo = () => path.resolve(process.env.UTOPIA_APPS_REPO ?? path.resolve(process.cwd(), '../utopia-apps'));
const families = {
  assistantChat: 'ai', audioLoopPlayer: 'audio', videoPlayer: 'video', dataTable: 'records', chartBlock: 'analytics', checklistCard: 'tasks', durationTimer: 'timing', stepFlow: 'workflow', scientificCalculator: 'calculation', formCard: 'records', smartCapture: 'capture', postCard: 'social', feedList: 'feed', calendarBlock: 'calendar', mediaBlock: 'media', galleryGrid: 'media', showcaseHero: 'media', cardCarousel: 'media', eventTimeline: 'timeline', featureCard: 'content', reviewCard: 'reviews', tileGrid: 'content', providerStatus: 'providers', widgetCatalog: 'catalog', permissionCard: 'permissions', filePicker: 'files', fileExport: 'files', locationMap: 'location', notificationScheduler: 'notifications', contactPicker: 'contacts', calendarEvent: 'calendar', biometricGate: 'biometrics', speechTool: 'speech', healthConnect: 'health', healthConnectStatus: 'health', healthKitStatus: 'health', cameraScanner: 'camera', sensorReadout: 'sensors', jsonUi: 'custom-layout', recordHeroSummary: 'records', structuredList: 'records', recordContentCard: 'records', recordTimeline: 'timeline', kanbanBoard: 'tasks', operationHistory: 'history', timelineBlock: 'timeline', recordReviewCard: 'reviews', valueControl: 'controls', groupedRecordShelf: 'records', quickAddList: 'records', horizontalRecordCarousel: 'records', messageThread: 'messaging', canvasBoard: 'canvas', automationFlow: 'automation', routePlanner: 'routing', gameSession: 'game',
};

const walk = (directory) => fs.existsSync(directory)
  ? fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
  : [];

const bucket = (name, n) => `${name}:${n <= 1 ? '1' : n <= 3 ? '2-3' : n <= 7 ? '4-7' : n <= 15 ? '8-15' : '16+'}`;

const jaccard = (left, right) => {
  const a = new Set(left); const b = new Set(right);
  const shared = [...a].filter((token) => b.has(token));
  return { score: shared.length / (a.size + b.size - shared.length || 1), shared, leftOnly: [...a].filter((token) => !b.has(token)), rightOnly: [...b].filter((token) => !a.has(token)) };
};

const dsu = (nodes) => {
  const parent = new Map(nodes.map((node) => [node, node]));
  const find = (node) => {
    const root = parent.get(node);
    if (root !== node) parent.set(node, find(root));
    return parent.get(node);
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  return { find, union };
};

const collect = (pkg) => {
  const tokens = new Set();
  const screens = Object.values(pkg.presentation?.ui?.screens ?? {});
  const add = (values) => values.forEach((value) => tokens.add(value));
  for (const screen of screens) for (const component of screen.components ?? []) {
    if (!component.widget) continue;
    add([
      `widget:${component.widget}`,
      `family:${families[component.widget] ?? 'unknown-widget'}`,
      component.kind && component.kind !== 'widget' && `component:${component.kind}`,
      component.action?.kind && `action:${component.action.kind}`,
      component.action?.operation && `operation:${component.action.operation}`,
      (component.query?.collections?.length || component.view || component.props?.collection) && 'binding:records',
    ]);
  }
  for (const collection of Object.values(pkg.collections ?? {})) for (const field of Object.values(collection.fields ?? {})) add([`field:${field.type}`]);
  for (const view of Object.values(pkg.views ?? {})) view.mode && add([`view:${view.mode}`]);
  for (const home of pkg.dataHomes ?? []) home.kind && home.mode && add([`data:${home.kind}:${home.mode}`]);
  for (const permission of pkg.nativeCapabilities?.permissions ?? []) permission.permission && add([`permission:${permission.permission}`]);
  for (const intent of pkg.nativeCapabilities?.intents ?? []) intent.kind && add([`intent:${intent.kind}`]);
  for (const packageName of pkg.nativeCapabilities?.packages ?? []) add([`native:${packageName}`]);
  for (const key of ['compact', 'medium', 'wide', 'portrait', 'landscape']) pkg.presentation?.ui?.layout?.[key] && add([`responsive:${key}`]);
  for (const key of Object.keys(pkg.presentation?.ui?.platform ?? {})) add([`platform:${key}`]);
  add([bucket('screens', screens.length), bucket('collections', Object.keys(pkg.collections ?? {}).length), bucket('queries', Object.keys(pkg.queries ?? {}).length)]);
  return [...tokens].sort();
};

export function buildCatalogSimilarityReport({ appsRoot = path.join(appsRepo(), 'packages'), threshold = Number(process.env.UTOPIA_DUPLICATE_THRESHOLD ?? 0.5) } = {}) {
  const packages = walk(appsRoot)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value?.schemaVersion !== 'wonder.app-package.v3' || !value.id) return;
        return { id: value.id, file, tokens: collect(value) };
      } catch { return; }
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));

  const nearest = new Map(packages.map((pkg) => [pkg.id, null]));
  const pairs = [];
  const { find, union } = dsu(packages.map((pkg) => pkg.id));

  for (let left = 0; left < packages.length; left += 1) {
    for (let right = left + 1; right < packages.length; right += 1) {
      const { score, ...details } = jaccard(packages[left].tokens, packages[right].tokens);
      const leftId = packages[left].id;
      const rightId = packages[right].id;
      const rounded = Number(score.toFixed(4));
      const bestLeft = nearest.get(leftId); const bestRight = nearest.get(rightId);
      if (!bestLeft || bestLeft.score < rounded) nearest.set(leftId, { ...details, score: rounded, id: rightId });
      if (!bestRight || bestRight.score < rounded) nearest.set(rightId, { ...details, score: rounded, id: leftId });
      if (rounded < threshold) continue;
      pairs.push({ left: leftId, right: rightId, score: rounded, ...details });
      union(leftId, rightId);
    }
  }

  const duplicateSet = new Set(pairs.flatMap((pair) => [pair.left, pair.right]));

  const edgeLeaders = packages
    .map((pkg) => ({ id: pkg.id, capabilityTokens: pkg.tokens.length, nearest: nearest.get(pkg.id) }))
    .sort((left, right) => right.capabilityTokens - left.capabilityTokens || left.id.localeCompare(right.id));

  const table = (rows) => rows.map((row) => `| ${row.join(' | ')} |`).join('\n') || '| - | 0 | none |';
  return {
    schemaVersion: 'utopia.catalog-capability-similarity.v2',
    generatedAt: new Date().toISOString(),
    threshold,
    packageCount: packages.length,
    duplicatePairCount: pairs.length,
    duplicateAppCount: duplicateSet.size,
    distinctAtThresholdCount: packages.length - duplicateSet.size,
    packages,
    pairs,
    edgeLeaders,
  };
}

export function writeCatalogSimilarityArtifacts(report, reportRoot = path.join(appsRepo(), 'metadata')) {
  const markdown = [
    '# Catalog capability duplicates',
    `Generated: ${report.generatedAt}`,
    '',
    `- packages: ${report.packageCount}`,
    `- pairs >= ${Math.round(report.threshold * 100)}%: ${report.duplicatePairCount}`,
    `- unique in duplicates: ${report.duplicateAppCount}`,
    `## Edge leaders (${report.edgeLeaders.length})`,
    '| # | App | Capability tokens | Nearest |',
    '|---:|---|---:|---|',
    table(report.edgeLeaders.slice(0, 30).map((entry, index) => [String(index + 1), entry.id, String(entry.capabilityTokens), entry.nearest ? `${entry.nearest.id} (${Math.round(entry.nearest.score * 100)}%)` : 'none'])),
    '',
    '## Top similar pairs',
    '| App A | App B | Similarity | Shared |',
    '|---|---|---:|---|',
    table(report.pairs.slice(0, 100).map((pair) => [pair.left, pair.right, `${Math.round(pair.score * 100)}%`, pair.shared.slice(0, 8).join(', ')])),
    '',
  ].join('\n');
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.writeFileSync(path.join(reportRoot, 'catalog-capability-similarity.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(reportRoot, 'catalog-capability-duplicates.md'), `${markdown}\n`);
}

export function main() {
  writeCatalogSimilarityArtifacts(buildCatalogSimilarityReport());
  return 0;
}

if (path.basename(process.argv[1]) === 'report-catalog-similarity.mjs') {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
