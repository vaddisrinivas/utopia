import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const matrixPath = path.join(root, 'docs/adversarial-app-matrix.json');
const fixturesRoot = path.join(root, 'tests/fixtures/adversarial-apps');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));

if (matrix.schemaVersion !== 'utopia.adversarial-app-matrix.v1' || !Array.isArray(matrix.entries)) {
  throw new Error('adversarial_app_matrix_invalid');
}

const packageAliases = new Map([
  [9, 'expense-splitter'],
]);
const boundaryAxes = new Set(['multi_writer', 'self_hosting']);
const tones = {
  real_time_loop: { accent: '#1F6FEB', canvas: '#F6FAFF', tone: 'blue', icon: 'timer' },
  aggregate_expression: { accent: '#2F7448', canvas: '#F7FAF4', tone: 'moss', icon: 'calculator' },
  temporal_rules: { accent: '#8A5A00', canvas: '#FFF9EE', tone: 'amber', icon: 'calendar' },
  native_stream: { accent: '#8B3A62', canvas: '#FFF6FA', tone: 'rose', icon: 'activity' },
  multi_writer: { accent: '#4F46E5', canvas: '#F7F7FF', tone: 'indigo', icon: 'users' },
  weird_shape: { accent: '#0F766E', canvas: '#F3FBFA', tone: 'teal', icon: 'grid' },
  self_hosting: { accent: '#525252', canvas: '#FAFAFA', tone: 'neutral', icon: 'settings' },
};

const materialized = [];
matrix.entries = matrix.entries.map((entry) => {
  const fixturePackage = packageAliases.get(entry.number) ?? entry.id;
  const packagePath = path.join(fixturesRoot, fixturePackage, `${fixturePackage}.v1.json`);

  if (!fs.existsSync(packagePath)) {
    fs.mkdirSync(path.dirname(packagePath), { recursive: true });
    fs.writeFileSync(packagePath, `${JSON.stringify(createPackage(entry, fixturePackage), null, 2)}\n`);
  }

  materialized.push({ number: entry.number, id: entry.id, package: fixturePackage });
  return {
    ...entry,
    currentStatus: entry.currentStatus === 'proven'
      ? 'proven'
      : boundaryAxes.has(entry.axis)
        ? 'boundary_expected'
        : 'partial',
    fixturePackage,
    currentEvidence: entry.currentEvidence ?? `Adversarial JSON fixture exists at tests/fixtures/adversarial-apps/${fixturePackage}/${fixturePackage}.v1.json; ${entry.missingPrimitive} remains the missing primitive.`,
  };
});

fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
console.log(`Materialized ${materialized.length} adversarial app fixtures.`);

function createPackage(entry, appId) {
  const theme = tones[entry.axis] ?? tones.weird_shape;
  const itemCollection = `${safePrefix(appId)}_item`;
  const eventCollection = `${safePrefix(appId)}_event`;
  const resultCollection = `${safePrefix(appId)}_result`;

  return {
    schemaVersion: 'wonder.app-package.v2',
    id: appId,
    version: '1.0.0',
    collections: {
      [itemCollection]: collection(itemCollection, {
        status: { type: 'text', indexed: true },
        priority: { type: 'number', indexed: true },
        owner: { type: 'text', indexed: true },
        notes: { type: 'text' },
      }),
      [eventCollection]: collection(eventCollection, {
        status: { type: 'text', indexed: true },
        happened_at: { type: 'timestamp', indexed: true },
        value: { type: 'number', indexed: true },
        source: { type: 'text', indexed: true },
      }),
      [resultCollection]: collection(resultCollection, {
        status: { type: 'text', indexed: true },
        score: { type: 'number', indexed: true },
        summary: { type: 'text' },
        missing_primitive: { type: 'text', indexed: true },
      }),
    },
    queries: {
      items: {
        from: 'records',
        where: { field: 'collection', op: 'eq', value: itemCollection },
        orderBy: [{ field: 'updated_at', direction: 'desc' }],
        limit: 50,
      },
      events: {
        from: 'records',
        where: { field: 'collection', op: 'eq', value: eventCollection },
        orderBy: [{ field: 'happened_at', direction: 'desc' }],
        limit: 50,
      },
      results: {
        from: 'records',
        where: { field: 'collection', op: 'eq', value: resultCollection },
        orderBy: [{ field: 'updated_at', direction: 'desc' }],
        limit: 20,
      },
    },
    views: {
      items: {
        id: 'items',
        query: 'items',
        mode: 'list',
        fields: ['title', 'status', 'priority', 'owner'],
      },
      events: {
        id: 'events',
        query: 'events',
        mode: 'table',
        fields: ['title', 'happened_at', 'value', 'source', 'status'],
      },
      results: {
        id: 'results',
        query: 'results',
        mode: 'table',
        fields: ['title', 'score', 'summary', 'missing_primitive', 'status'],
      },
    },
    rules: [
      {
        id: 'review-new-test-event',
        trigger: { kind: 'query_transition', query: 'events', transition: 'enter' },
        when: { '>': [{ var: 'query.after.total' }, { var: 'query.before.total' }] },
        effect: { kind: 'propose_operation', operation: 'review_adversarial_fixture' },
        mode: 'suggest',
        maxRunsPerEvent: 1,
      },
    ],
    capabilities: [],
    acceptanceTests: [`adversarial-${entry.number}-${entry.axis}`],
    presentation: {
      label: entry.title,
      homeSurface: 'home',
      surfaces: [
        { id: 'home', label: 'Probe', collections: [itemCollection, eventCollection, resultCollection], views: ['items', 'results'] },
        { id: 'events', label: 'Events', collections: [eventCollection], views: ['events'] },
        { id: 'boundary', label: 'Boundary', collections: [resultCollection], views: ['results'] },
      ],
      visualIdentity: {
        accent: theme.accent,
        canvas: theme.canvas,
        icon: theme.icon,
        tone: theme.tone,
      },
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: 'home',
        screens: {
          home: {
            title: entry.title,
            subtitle: `Adversarial fixture #${entry.number}: ${entry.attacks}`,
            components: [
              {
                kind: 'metric',
                title: 'Runtime Axis',
                subtitle: labelAxis(entry.axis),
                query: { collections: [resultCollection], limit: 20 },
                tone: theme.tone,
              },
              {
                kind: 'recordList',
                title: 'Fixture Items',
                subtitle: 'Generic records prove the data shell can host the app shape.',
                query: { collections: [itemCollection], limit: 20 },
                props: { emptyText: 'No fixture items yet.', subtitleFields: ['status', 'priority', 'owner'] },
              },
              boundaryTable(entry, theme.tone),
            ],
          },
          events: {
            title: `${entry.title} Events`,
            subtitle: 'Event rows for imports, taps, scans, timers, edits, or generated transitions.',
            components: [
              {
                kind: 'recordList',
                title: 'Recent Events',
                subtitle: 'Newest first.',
                query: { collections: [eventCollection], limit: 50 },
                props: { emptyText: 'No events yet.', subtitleFields: ['happened_at', 'value', 'source', 'status'] },
              },
            ],
          },
          boundary: {
            title: 'Boundary',
            subtitle: 'What this JSON package proves and what the runtime still lacks.',
            components: [boundaryTable(entry, 'amber')],
          },
        },
      },
    },
  };
}

function collection(id, fields) {
  return {
    id,
    fields: {
      id: { type: 'text', required: true, indexed: true },
      title: { type: 'text', required: true, indexed: true },
      collection: { type: 'text', required: true, indexed: true },
      updated_at: { type: 'timestamp', required: true, indexed: true },
      properties: { type: 'json', required: true },
      ...fields,
    },
  };
}

function boundaryTable(entry, tone) {
  return {
    kind: 'widget',
    widget: 'dataTable',
    title: 'Adversarial Boundary',
    subtitle: entry.expectedFailSignal,
    tone,
    props: {
      columns: [
        { key: 'field', label: 'Field' },
        { key: 'value', label: 'Value' },
      ],
      items: [
        { field: 'Axis', value: labelAxis(entry.axis) },
        { field: 'Missing primitive', value: entry.missingPrimitive },
        { field: 'Current status', value: boundaryAxes.has(entry.axis) ? 'Boundary expected' : 'Partial fixture' },
        { field: 'Package rule', value: 'No app-specific renderer widget allowed' },
      ],
    },
  };
}

function safePrefix(id) {
  return id.replace(/-/g, '_').slice(0, 42);
}

function labelAxis(axis) {
  return axis.replace(/_/g, ' ');
}
