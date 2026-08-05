import fs from 'node:fs';
import path from 'node:path';

import { PackageSchema, type AppPackage } from '../src/kernel/schema';
import { supportsWidget } from '../src/kernel/widget-support';

type JsonObject = Record<string, unknown>;

export type PackageEnrichment = {
  package: AppPackage;
  changed: boolean;
  changes: string[];
  addedWidgets: string[];
  removedSyntheticAssetBlocks: number;
  operationCountsBefore: Record<string, number>;
  operationCountsAfter: Record<string, number>;
  unresolvedOperations: string[];
};

export type CatalogEnrichmentReport = {
  schemaVersion: 'utopia.catalog-enrichment.v1';
  dryRun: boolean;
  packages: number;
  changed: number;
  addedWidgets: Record<string, number>;
  removedSyntheticAssetBlocks: number;
  operationCountsBefore: Record<string, number>;
  operationCountsAfter: Record<string, number>;
  unresolvedOperations: string[];
  results: Array<{
    id: string;
    changed: boolean;
    changes: string[];
    addedWidgets: string[];
    removedSyntheticAssetBlocks: number;
    operationCountsBefore: Record<string, number>;
    operationCountsAfter: Record<string, number>;
    unresolvedOperations: string[];
  }>;
};

const palette = [
  { accent: '#087F5B', secondary: '#D9485F', highlight: '#F5C542', canvas: '#EDFFF8', surface: '#FFFFFF', ink: '#102A23', muted: '#54736A', tone: 'teal' },
  { accent: '#006D9C', secondary: '#F06B32', highlight: '#FFD166', canvas: '#EDF9FF', surface: '#FFFFFF', ink: '#102A3A', muted: '#526F7B', tone: 'ocean' },
  { accent: '#7048A8', secondary: '#008C7A', highlight: '#F59AC2', canvas: '#FAF1FF', surface: '#FFFFFF', ink: '#271735', muted: '#706079', tone: 'plum' },
  { accent: '#A85A00', secondary: '#06799F', highlight: '#FFD34E', canvas: '#FFF7E5', surface: '#FFFFFF', ink: '#352312', muted: '#796956', tone: 'amber' },
  { accent: '#B8324A', secondary: '#00877D', highlight: '#FFB84D', canvas: '#FFF0F3', surface: '#FFFFFF', ink: '#351820', muted: '#7D5D64', tone: 'coral' },
  { accent: '#4057B2', secondary: '#C0446C', highlight: '#F5C451', canvas: '#F0F3FF', surface: '#FFFFFF', ink: '#172044', muted: '#626B89', tone: 'indigo' },
  { accent: '#347A3E', secondary: '#A83E8B', highlight: '#F4C84B', canvas: '#F0FFF1', surface: '#FFFFFF', ink: '#172D1A', muted: '#5E7561', tone: 'forest' },
  { accent: '#3C627F', secondary: '#C05A2A', highlight: '#F1C84C', canvas: '#EFF8FF', surface: '#FFFFFF', ink: '#172A38', muted: '#5D7381', tone: 'slate' },
] as const;

const mediaWidgets = new Set(['galleryGrid', 'cardCarousel', 'postCard', 'mediaBlock', 'featureCard', 'reviewCard', 'showcaseHero', 'tileGrid']);
const persistentWidgets = new Set([
  'formCard', 'smartCapture', 'recordHeroSummary', 'structuredList', 'recordContentCard', 'recordTimeline',
  'kanbanBoard', 'operationHistory', 'timelineBlock', 'recordReviewCard', 'valueControl', 'groupedRecordShelf',
  'quickAddList', 'horizontalRecordCarousel',
]);
const actionKinds = new Set(['create', 'update', 'delete', 'toggle', 'undo', 'propose']);
const genericOperations = new Set(['navigate', 'create', 'update', 'archive', 'restore', 'retry', 'export']);

const asObject = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = ''): string => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const fields = (pkg: AppPackage) => Object.values(pkg.collections).flatMap((collection) => Object.entries(collection.fields).map(([id, field]) => ({ id, type: field.type })));
const components = (pkg: AppPackage): JsonObject[] => Object.values(pkg.presentation.ui.screens).flatMap((screen) => asArray(screen.components).map(asObject));

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function humanize(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function tokens(pkg: AppPackage): string {
  return [
    pkg.id,
    pkg.presentation.label,
    text(pkg.presentation.archetype),
    ...pkg.capabilities,
    ...Object.keys(pkg.collections),
    ...Object.keys(pkg.queries),
    ...components(pkg).map((component) => `${text(component.widget)} ${text(component.title)}`),
    ...pkg.nativeCapabilities.packages,
    ...pkg.nativeCapabilities.permissions?.map((permission) => JSON.stringify(permission)) ?? [],
  ].join(' ').toLowerCase();
}

function emojiFor(pkg: AppPackage): string {
  const value = tokens(pkg);
  const choices: Array<[RegExp, string]> = [
    [/\b(food|meal|recipe|kitchen|grocery|cook)\b/, '🍲'],
    [/\b(pet|pets|dog|cat|plant|garden|harvest)\b/, '🌱'],
    [/\b(music|audio|podcast|sound|playlist|track|recording)\b/, '🎧'],
    [/\b(video|film|movie|stream|broadcast)\b/, '🎬'],
    [/\b(marketing|campaign|newsletter|audience|content calendar|social media)\b/, '📣'],
    [/\b(analytics|dashboard|business intelligence|reporting|metrics|observability)\b/, '📊'],
    [/\b(inventory|stock|warehouse|asset|maintenance|equipment)\b/, '📦'],
    [/\b(hr|human resources|payroll|employee|recruit|hiring)\b/, '🧑‍💼'],
    [/\b(money|expense|budget|invoice|bank|rent|bill|finance|accounting)\b/, '💳'],
    [/\b(canvas|diagram|whiteboard|vector|drawing|design|figma|miro|mural|sketch)\b/, '🎨'],
    [/\b(game|round|quiz|chess|trivia|tournament)\b/, '🎮'],
    [/\b(chat|message|social|community|thread|conversation|mail|inbox)\b/, '💬'],
    [/\b(map|maps|location|route|trip|travel|hotel|flight|navigation)\b/, '🗺️'],
    [/\b(automation|integration|workflow|flow|trigger|zapier|n8n)\b/, '⚡'],
    [/\b(camera|photo|gallery|image|scan|barcode)\b/, '📷'],
    [/\b(health|fitness|workout|medical|sleep)\b/, '🫀'],
    [/\b(timer|focus|pomodoro|interval|time)\b/, '⏱️'],
    [/\b(calendar|event|schedule|appointment|booking)\b/, '📅'],
    [/\b(task|project|kanban|work)\b/, '✅'],
    [/\b(contact|crm|customer|people|team|member)\b/, '👥'],
    [/\b(shop|store|commerce|cart|inventory|stock)\b/, '🛍️'],
    [/\b(weather|forecast|climate)\b/, '🌤️'],
    [/\b(password|security|vault|auth|privacy)\b/, '🔐'],
    [/\b(code|developer|api|database|analytics|data)\b/, '🧩'],
    [/\b(book|read|note|write|course|learn)\b/, '📚'],
  ];
  return choices.find(([pattern]) => pattern.test(value))?.[1] ?? '🧩';
}

function navigationIcon(screen: string, label: string): string {
  const value = `${screen} ${label}`.toLowerCase();
  if (/setting|config|profile|account|preference/.test(value)) return 'settings';
  if (/search|find|discover/.test(value)) return 'search';
  if (/chat|ask|message|inbox|support/.test(value)) return 'message-circle';
  if (/insight|analytic|report|trend|stat/.test(value)) return 'chart-no-axes-combined';
  if (/history|run|activity|log|recent/.test(value)) return 'history';
  if (/calendar|schedule|event|plan/.test(value)) return 'calendar-days';
  if (/camera|scan|capture|photo/.test(value)) return 'camera';
  if (/audio|music|listen/.test(value)) return 'headphones';
  if (/video|watch|stream/.test(value)) return 'play';
  if (/map|location|route|trip/.test(value)) return 'map';
  if (/file|document|note|page/.test(value)) return 'file-text';
  if (/team|people|member|contact/.test(value)) return 'users';
  if (/task|board|flow|automation|project/.test(value)) return 'workflow';
  if (/food|meal|kitchen|cook|recipe|shop/.test(value)) return 'utensils';
  if (/home|today|dashboard|overview|start/.test(value)) return 'home';
  return 'layout-grid';
}

function hasAction(pkg: AppPackage): boolean {
  return components(pkg).some((component) => actionKinds.has(text(asObject(component.action).kind)));
}

function hasWidget(pkg: AppPackage, widget: string): boolean {
  return components(pkg).some((component) => component.widget === widget);
}

function hasNative(pkg: AppPackage, pattern: RegExp): boolean {
  const value = [
    ...pkg.nativeCapabilities.packages,
    ...asArray(pkg.nativeCapabilities.permissions).map((item) => JSON.stringify(item)),
    ...asArray(pkg.nativeCapabilities.intents).map((item) => JSON.stringify(item)),
  ].join(' ').toLowerCase();
  return pattern.test(value);
}

function mediaReferences(pkg: AppPackage): string[] {
  const references = new Set<string>();
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && /^(image|imageUrl|uri|asset|gif|media)$/i.test(key) && /^(https?:|file:|asset:|data:|\/)/.test(value.trim())) references.add(value.trim());
    if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([child, item]) => visit(item, child));
  };
  visit(pkg.presentation);
  return [...references].sort();
}

function isSyntheticEnrichmentAsset(component: JsonObject): boolean {
  const source = asObject(asObject(component.props).source);
  return text(component.id) === 'enrichment-assetBlock' && source.type === 'scene';
}

function operationNode(value: JsonObject): boolean {
  return typeof value.operation === 'string' && ['action', 'propose', 'propose_operation'].includes(text(value.kind));
}

function collectOperationCounts(pkg: AppPackage): Record<string, number> {
  const counts: Record<string, number> = {};
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as JsonObject;
    if (operationNode(object)) {
      const operation = text(object.operation, '<missing>');
      counts[operation] = (counts[operation] ?? 0) + 1;
    }
    Object.values(object).forEach(visit);
  };
  visit(pkg);
  return counts;
}

function inferCollection(pkg: AppPackage, action: JsonObject): string | undefined {
  const collections = Object.keys(pkg.collections);
  const payload = asObject(action.payload);
  const explicit = [action.collection, payload.collection].map((value) => text(value)).find((value) => collections.includes(value));
  if (explicit) return explicit;
  const haystack = `${text(action.command)} ${text(action.label)} ${text(action.collection)} ${text(payload.collection)}`.toLowerCase();
  const scored = collections.map((id, index) => {
    const words = id.toLowerCase().split(/[-_.]+/).filter(Boolean);
    const score = words.reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0);
    return { id, score, index };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0]?.id;
}

function inferQuery(pkg: AppPackage, action: JsonObject, collection?: string): string | undefined {
  const queries = Object.keys(pkg.queries);
  const payload = asObject(action.payload);
  const explicit = text(payload.query);
  if (queries.includes(explicit)) return explicit;
  const fromCollection = queries.find((id) => pkg.queries[id].from === collection);
  if (fromCollection) return fromCollection;
  const haystack = `${text(action.command)} ${text(action.label)} ${explicit}`.toLowerCase();
  return queries.map((id, index) => ({
    id,
    score: id.toLowerCase().split(/[-_.]+/).reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0),
    index,
  })).sort((left, right) => right.score - left.score || left.index - right.index)[0]?.id;
}

function inferScreen(pkg: AppPackage, action: JsonObject, current: string): string | undefined {
  const screens = Object.keys(pkg.presentation.ui.screens);
  const payload = asObject(action.payload);
  const explicit = [action.target, payload.route, payload.screen].map((value) => text(value)).map((value) => value.replace(/^\//, '')).find((value) => screens.includes(value));
  if (explicit) return explicit;
  const haystack = `${text(action.command)} ${text(action.label)}`.toLowerCase();
  const scored = screens.map((id, index) => ({
    id,
    score: id.toLowerCase().split(/[-_.]+/).reduce((total, word) => total + (haystack.includes(word) ? 2 : 0), 0) + (id === current ? -1 : 0),
    index,
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0]?.id;
}

function mapOperation(raw: string, action: JsonObject): string {
  if (genericOperations.has(raw)) return raw;
  if (raw === 'set' || raw === 'delete' || raw === 'notify') return raw === 'delete' ? 'archive' : 'update';
  const value = `${raw} ${text(action.command)} ${text(action.label)}`.toLowerCase();
  if (/export|backup|csv|download|summary|report/.test(value)) return 'export';
  if (/retry|sync|again|resend|requeue/.test(value)) return 'retry';
  if (/restore|recover|undo/.test(value)) return 'restore';
  if (/archive|delete|remove|retire|dismiss/.test(value)) return 'archive';
  if (/navigate|open|view|route|browse|select/.test(value)) return 'navigate';
  if (/complete|approve|resolve|edit|update|apply|mark|settings|policy|review/.test(value)) return 'update';
  if (/record|log|add|create|new|capture|submit|save|register/.test(value)) return 'create';
  return 'update';
}

function normalizeComponentAction(
  pkg: AppPackage,
  action: JsonObject,
  screen: string,
  changes: string[],
  unresolved: string[],
): void {
  const raw = text(action.operation);
  if (!raw) return;
  const operation = mapOperation(raw, action);
  if (operation !== raw) {
    action.operation = operation;
    changes.push(`operation ${raw}->${operation} ${text(action.command, text(action.label, screen))}`);
  }
  const payload = asObject(action.payload);
  if (operation === 'navigate') {
    const target = inferScreen(pkg, action, screen);
    if (target) {
      if (!pkg.presentation.ui.screens[target]) unresolved.push(`${pkg.id}:${screen}:navigate`);
      else action.target = target;
    } else unresolved.push(`${pkg.id}:${screen}:navigate`);
    return;
  }
  const collection = inferCollection(pkg, action);
  if (['create', 'update', 'archive', 'restore'].includes(operation)) {
    if (collection) {
      action.collection = collection;
      if (payload.collection !== collection) {
        payload.collection = collection;
        action.payload = payload;
      }
    } else unresolved.push(`${pkg.id}:${screen}:${operation}:collection`);
  }
  if (operation === 'export') {
    const query = inferQuery(pkg, action, collection);
    if (query) {
      payload.query = query;
      action.payload = payload;
    } else unresolved.push(`${pkg.id}:${screen}:export:query`);
  }
}

function normalizeRuleEffect(pkg: AppPackage, effect: JsonObject, queryId: string | undefined, changes: string[], unresolved: string[]): void {
  const raw = text(effect.operation);
  if (!raw) return;
  const operation = mapOperation(raw, effect);
  if (operation !== raw) {
    effect.operation = operation;
    changes.push(`rule operation ${raw}->${operation}`);
  }
  const query = queryId && pkg.queries[queryId] ? queryId : inferQuery(pkg, effect);
  if (query) {
    effect.query = query;
    effect.collection = pkg.queries[query].from;
  } else if (['create', 'update', 'archive', 'restore', 'export'].includes(operation)) {
    unresolved.push(`${pkg.id}:rule:${operation}:selection`);
  }
}

type CandidateWidget = { widget: string; collection?: string; props?: JsonObject };

function candidateWidgets(pkg: AppPackage): CandidateWidget[] {
  const value = tokens(pkg);
  const result: CandidateWidget[] = [];
  const add = (widget: string, collection?: string, props?: JsonObject) => {
    if ((widget === 'assetBlock' || !hasWidget(pkg, widget)) && !result.some((item) => item.widget === widget)) result.push({ widget, collection, props });
  };
  const collectionEntries = Object.entries(pkg.collections);
  const collection = (pattern: RegExp) => collectionEntries.find(([id]) => pattern.test(id))?.[0];
  const field = (collectionId: string | undefined, pattern: RegExp, fallback: string) =>
    Object.keys(collectionId ? pkg.collections[collectionId]?.fields ?? {} : {}).find((id) => pattern.test(id)) ?? fallback;
  const timestampCollection = collectionEntries.find(([, collection]) => Object.values(collection.fields).some((field) => field.type === 'timestamp'))?.[0];
  const titleCollection = collectionEntries.find(([, collection]) => Object.keys(collection.fields).some((field) => /title|name|label|text|status/i.test(field)))?.[0] ?? collectionEntries[0]?.[0];
  const numericCollection = collectionEntries.find(([, item]) => Object.values(item.fields).some((spec) => spec.type === 'number'))?.[0];
  const booleanCollection = collectionEntries.find(([, item]) => Object.values(item.fields).some((spec) => spec.type === 'boolean'))?.[0];
  const imageCollection = collectionEntries.find(([, item]) => Object.keys(item.fields).some((id) => /image|photo|cover|thumbnail|uri|url/i.test(id)))?.[0];
  const statusCollection = collectionEntries.find(([, item]) => Object.keys(item.fields).some((id) => /status|state|stage|column/i.test(id)))?.[0];
  const identity = asObject(pkg.presentation.visualIdentity);
  const refs = mediaReferences(pkg);
  if (refs.length) add('assetBlock', undefined, {
    source: { type: 'image', uri: refs[0], alt: pkg.presentation.label, width: '100%', height: 140, contentMode: 'cover' },
  });

  if (/camera|barcode|scan|vision/.test(value) && hasNative(pkg, /camera|barcode|vision/i)) add('cameraScanner');
  if (/notification|reminder|alarm/.test(value) && hasNative(pkg, /notification|calendar/i)) add('notificationScheduler');
  if (/calendar|event|appointment|schedule/.test(value) && hasNative(pkg, /calendar/i)) add('calendarEvent');
  if (/location|map|geocode/.test(value) && hasNative(pkg, /location|map/i)) add('locationMap');
  if (/audio|music|podcast/.test(value) && hasNative(pkg, /audio|music/i)) add('audioLoopPlayer');
  if (/video|movie|film/.test(value) && hasNative(pkg, /video/i)) add('videoPlayer');
  const declaredCapabilities = pkg.capabilities.join(' ').toLowerCase();
  if (/\b(message|composer|mail|thread|conversation|offline_queue)\b/.test(declaredCapabilities)) {
    const threads = collection(/^(thread|conversation|channel|room)s?$/i);
    const messages = collection(/^messages?$/i);
    const drafts = collection(/^drafts?$/i);
    const attachments = collection(/^attachments?$/i);
    if (threads && messages && drafts) add('messageThread', undefined, {
      threadsCollection: threads,
      messagesCollection: messages,
      draftsCollection: drafts,
      attachmentsCollection: attachments ?? 'messageAttachments',
      threadIdField: field(messages, /(thread|conversation|channel|room)_?id/i, 'threadId'),
      messageTextField: field(messages, /^(body|text|content|message)$/i, 'text'),
      draftField: field(drafts, /^(body|text|content|message)$/i, 'text'),
      messageRoleField: field(messages, /^(role|author|sender|direction)$/i, 'role'),
      messageStatusField: field(messages, /^(status|state|send_state)$/i, 'status'),
      attachmentMessageField: field(attachments, /message_?id/i, 'messageId'),
      sendMode: 'queued',
      allowAttachments: Boolean(attachments),
    });
  }
  if (/(canvas|diagram|whiteboard|vector|drawing|scene|shape|node_graph|mind_map)/.test(declaredCapabilities)) {
    const accent = text(identity.accent, '#176B5B');
    const secondary = text(identity.secondary, '#B34E3E');
    const documents = collection(/^(document|board|canvas|diagram|drawing|file)s?$/i) ?? collectionEntries[0]?.[0];
    if (documents) pkg.collections[documents].fields.scene ??= { type: 'json' };
    add('canvasBoard', documents, {
      sceneField: 'scene',
      recordId: `${pkg.id}-canvas`,
      height: 360,
      snap: 8,
      scene: {
        width: 640,
        height: 360,
        background: text(identity.canvas, '#F2FBF8'),
        nodes: [
          { id: 'title', type: 'text', x: 32, y: 48, text: pkg.presentation.label, fontSize: 24, fill: accent, layer: 2 },
          { id: 'primary', type: 'rect', x: 48, y: 88, width: 208, height: 112, rx: 16, fill: accent, opacity: 0.92, layer: 0 },
          { id: 'secondary', type: 'ellipse', cx: 400, cy: 160, rx: 104, ry: 64, fill: secondary, opacity: 0.82, layer: 1 },
          { id: 'connector', type: 'line', x1: 256, y1: 144, x2: 296, y2: 160, stroke: '#182019', strokeWidth: 3, layer: 1 },
        ],
      },
    });
  }
  const automation = collection(/^automations?$/i);
  if (automation && collection(/^steps?$/i) && collection(/^connections?$/i)) {
    pkg.collections[automation].fields.config ??= { type: 'json' };
    add('automationFlow', automation, {
      configField: 'config',
      recordId: `${pkg.id}-automation`,
      config: {
        schemaVersion: 'utopia.automation.v3',
        id: `${pkg.id}-flow`,
        title: `${pkg.presentation.label} flow`,
        enabled: true,
        maxSteps: 100,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', event: 'manual' },
          { id: 'action', kind: 'action', label: 'Local action', operation: 'set', values: {} },
        ],
        edges: [{ id: 'start-action', from: 'start', to: 'action', when: 'always' }],
      },
    });
  }
  const route = collection(/^routes?$/i);
  if (route && (hasNative(pkg, /location|map/i) || /location|route|navigation/.test(declaredCapabilities))) {
    pkg.collections[route].fields.config ??= { type: 'json' };
    add('routePlanner', route, {
      configField: 'config',
      recordId: `${pkg.id}-route`,
      config: { title: pkg.presentation.label, waypoints: [], unit: 'km', speedKph: 30, state: 'offline', retryLabel: 'Retry' },
    });
  }
  if (pkg.capabilities.some((capability) => capability.startsWith('game.'))) {
    const sessions = collection(/(game|quiz|lobby|session)/i) ?? collectionEntries[0]?.[0];
    if (sessions) pkg.collections[sessions].fields.snapshot ??= { type: 'json' };
    add('gameSession', sessions, {
      snapshotField: 'snapshot',
      recordId: `${pkg.id}-session`,
      config: {
        schemaVersion: 'utopia.game.v3',
        title: pkg.presentation.label,
        emoji: '🎮',
        accent: text(identity.accent, '#18794E'),
        canvas: text(identity.canvas, '#F7F5EF'),
        players: [{ id: 'player-1', name: 'Player 1', emoji: '🟢' }, { id: 'player-2', name: 'Player 2', emoji: '🟡' }],
        rounds: 3,
        turnSeconds: 60,
        scoreStep: 1,
        win: { kind: 'score', target: 10 },
      },
    });
  }
  if (/timer|focus|pomodoro|interval/.test(value) && /timer|duration|interval|focus|time/.test(declaredCapabilities)) add('durationTimer');
  if (/calculator|math|equation/.test(value) && /calc|math|formula|scientific/.test(declaredCapabilities)) add('scientificCalculator');
  if (imageCollection) add('galleryGrid', imageCollection, { imageField: field(imageCollection, /image|photo|cover|thumbnail|uri|url/i, 'image'), emptyText: 'No media' });
  if (numericCollection && /analytic|report|dashboard|finance|money|budget|health|fitness|score|inventory|quantity|time|distance|progress|metric/.test(value)) add('chartBlock', numericCollection, { valueField: field(numericCollection, /amount|value|total|score|count|price|duration|distance|quantity/i, Object.keys(pkg.collections[numericCollection].fields).find((id) => pkg.collections[numericCollection].fields[id].type === 'number') ?? 'value'), type: 'bar' });
  if (timestampCollection && /calendar|event|schedule|appointment|booking|reservation|trip|due|deadline|reminder/.test(value)) add('calendarBlock', timestampCollection, { dateField: field(timestampCollection, /date|time|start|due|scheduled|occurred|created/i, Object.keys(pkg.collections[timestampCollection].fields).find((id) => pkg.collections[timestampCollection].fields[id].type === 'timestamp') ?? 'date') });
  if (booleanCollection && /task|todo|checklist|habit|routine|chore|goal|workout|lesson|audit|inspection|compliance/.test(value)) add('checklistCard', booleanCollection, { checkedField: field(booleanCollection, /complete|done|checked|active|enabled|resolved/i, Object.keys(pkg.collections[booleanCollection].fields).find((id) => pkg.collections[booleanCollection].fields[id].type === 'boolean') ?? 'completed') });
  if (statusCollection && /project|task|issue|ticket|workflow|pipeline|sales|crm|case|order|inventory|job|application|lead|deal/.test(value)) add('kanbanBoard', statusCollection, { groupBy: field(statusCollection, /status|state|stage|column/i, 'status') });
  if (timestampCollection && hasAction(pkg)) add('recordTimeline', timestampCollection);
  if (titleCollection && hasAction(pkg) && ![...persistentWidgets].some((widget) => hasWidget(pkg, widget))) add('structuredList', titleCollection);
  return result;
}

function addComponent(pkg: AppPackage, candidate: CandidateWidget, changes: string[]): string | undefined {
  if (!supportsWidget(candidate.widget)) return undefined;
  const screens = pkg.presentation.ui.screens as Record<string, JsonObject>;
  const homeId = pkg.presentation.ui.defaultScreen && screens[pkg.presentation.ui.defaultScreen]
    ? pkg.presentation.ui.defaultScreen
    : Object.keys(screens)[0];
  const home = screens[homeId];
  if (!home) return undefined;
  const list = asArray(home.components) as JsonObject[];
  const component: JsonObject = { kind: 'widget', id: `enrichment-${candidate.widget}`, title: humanize(candidate.widget), widget: candidate.widget, props: { emoji: emojiFor(pkg), ...candidate.props } };
  if (candidate.collection) {
    component.query = { collections: [candidate.collection], limit: 12 };
    (component.props as JsonObject).collection = candidate.collection;
  }
  if (candidate.widget === 'assetBlock') {
    const existing = list.findIndex((item) => item.widget === 'assetBlock');
    if (existing >= 0) return undefined;
    list.unshift(component);
  }
  else list.push(component);
  home.components = list;
  changes.push(`add widget ${candidate.widget}`);
  return candidate.widget;
}

export function enrichPackage(input: unknown): PackageEnrichment {
  const parsed = PackageSchema.parse(input);
  if (parsed.schemaVersion !== 'wonder.app-package.v3') throw new Error(`latest V3 schema required for ${parsed.id}`);
  const pkg = structuredClone(parsed) as AppPackage;
  const changes: string[] = [];
  const addedWidgets: string[] = [];
  const operationCountsBefore = collectOperationCounts(pkg);
  const unresolvedOperations: string[] = [];
  let removedSyntheticAssetBlocks = 0;

  for (const [screenId, screen] of Object.entries(pkg.presentation.ui.screens)) {
    const original = asArray(screen.components).map(asObject);
    const retained = original.filter((component) => {
      if (!isSyntheticEnrichmentAsset(component)) return true;
      removedSyntheticAssetBlocks += 1;
      changes.push(`remove synthetic ${text(component.id)}`);
      return false;
    });
    screen.components = retained as AppPackage['presentation']['ui']['screens'][string]['components'];
    for (const component of retained) {
      const action = asObject(component.action);
      if (typeof action.operation === 'string') normalizeComponentAction(pkg, action, screenId, changes, unresolvedOperations);
    }
  }
  for (const rule of pkg.rules) {
    const item = asObject(rule);
    const trigger = asObject(item.trigger);
    normalizeRuleEffect(pkg, asObject(item.effect), text(trigger.query), changes, unresolvedOperations);
  }
  const normalizeAutomationOperations = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(normalizeAutomationOperations);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const object = value as JsonObject;
    if (text(object.kind) === 'action' && typeof object.operation === 'string') {
      const raw = text(object.operation);
      const operation = mapOperation(raw, object);
      if (operation !== raw) {
        object.operation = operation;
        changes.push(`automation operation ${raw}->${operation}`);
      }
    }
    Object.values(object).forEach(normalizeAutomationOperations);
  };
  normalizeAutomationOperations(pkg.presentation);
  const identity = (pkg.presentation.visualIdentity ??= {}) as JsonObject;
  const selected = palette[hash(pkg.id) % palette.length];
  for (const [key, value] of Object.entries(selected)) {
    if (identity[key] == null || identity[key] === '') {
      identity[key] = value;
      changes.push(`visual identity ${key}`);
    }
  }
  const semanticEmoji = emojiFor(pkg);
  if (identity.emoji !== semanticEmoji) {
    identity.emoji = semanticEmoji;
    changes.push('visual identity emoji');
  }
  if (identity.icon !== semanticEmoji) {
    identity.icon = semanticEmoji;
    changes.push('visual identity icon');
  }
  const paletteMeta = asObject(identity.palette);
  for (const [key, value] of Object.entries({ accent: identity.accent, secondary: identity.secondary, highlight: identity.highlight })) {
    if (paletteMeta[key] !== value) {
      paletteMeta[key] = value;
      changes.push(`visual palette ${key}`);
    }
  }
  if (Object.keys(paletteMeta).length) identity.palette = paletteMeta;

  const screens = pkg.presentation.ui.screens as Record<string, JsonObject>;
  const navigation = pkg.presentation.ui.navigation ?? { items: Object.keys(screens).map((screen) => ({ screen, label: screens[screen].title ?? humanize(screen) })) };
  const items = asArray(navigation.items).map((value, index) => {
    const item = asObject(value);
    const screen = text(item.screen, Object.keys(screens)[index] ?? 'home');
    return { screen, label: text(item.label, humanize(screen)), icon: text(item.icon) || undefined };
  });
  if (items.length > 1) {
    items.forEach((item, index) => {
      const icon = navigationIcon(text(item.screen), text(item.label));
      if (item.icon !== icon) {
        item.icon = icon;
        changes.push(`navigation icon ${text(item.screen)}`);
      }
    });
    pkg.presentation.ui.navigation = { ...navigation, items };
  }

  const references = mediaReferences(pkg);
  if (references.length && identity.media == null) {
    identity.media = { source: 'existing-package-reference', refs: references };
    changes.push('preserve media metadata');
  }
  for (const component of components(pkg)) {
    if (!mediaWidgets.has(text(component.widget))) continue;
    const props = asObject(component.props);
    if (props.emoji == null && props.icon == null && props.image == null && props.imageUrl == null) {
      props.emoji = emojiFor(pkg);
      component.props = props;
      changes.push(`media identity ${text(component.id, text(component.widget))}`);
    }
  }
  for (const candidate of candidateWidgets(pkg)) {
    const added = addComponent(pkg, candidate, changes);
    if (added) addedWidgets.push(added);
  }
  const checked = PackageSchema.parse(pkg);
  return {
    package: checked,
    changed: changes.length > 0,
    changes,
    addedWidgets,
    removedSyntheticAssetBlocks,
    operationCountsBefore,
    operationCountsAfter: collectOperationCounts(checked),
    unresolvedOperations,
  };
}

export function enrichCatalog(inputs: readonly unknown[], dryRun = true): { packages: AppPackage[]; report: CatalogEnrichmentReport } {
  const results = inputs.map((input) => enrichPackage(input));
  const addedWidgets: Record<string, number> = {};
  for (const result of results) for (const widget of result.addedWidgets) addedWidgets[widget] = (addedWidgets[widget] ?? 0) + 1;
  const removedSyntheticAssetBlocks = results.reduce((total, result) => total + result.removedSyntheticAssetBlocks, 0);
  const operationCountsBefore: Record<string, number> = {};
  const operationCountsAfter: Record<string, number> = {};
  for (const result of results) {
    for (const [operation, count] of Object.entries(result.operationCountsBefore)) operationCountsBefore[operation] = (operationCountsBefore[operation] ?? 0) + count;
    for (const [operation, count] of Object.entries(result.operationCountsAfter)) operationCountsAfter[operation] = (operationCountsAfter[operation] ?? 0) + count;
  }
  return {
    packages: results.map((result) => result.package),
    report: {
      schemaVersion: 'utopia.catalog-enrichment.v1',
      dryRun,
      packages: results.length,
      changed: results.filter((result) => result.changed).length,
      addedWidgets,
      removedSyntheticAssetBlocks,
      operationCountsBefore,
      operationCountsAfter,
      unresolvedOperations: results.flatMap((result) => result.unresolvedOperations),
      results: results.map(({ package: pkg, changed, changes, addedWidgets: widgets, removedSyntheticAssetBlocks: removed, operationCountsBefore: before, operationCountsAfter: after, unresolvedOperations: unresolved }) => ({
        id: pkg.id,
        changed,
        changes,
        addedWidgets: widgets,
        removedSyntheticAssetBlocks: removed,
        operationCountsBefore: before,
        operationCountsAfter: after,
        unresolvedOperations: unresolved,
      })),
    },
  };
}

function files(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith('.json') ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? files(child) : child.endsWith('.json') ? [child] : [];
  });
}

function parseArgs(argv: string[]): { input: string; output?: string; dryRun: boolean } {
  let input = path.resolve(process.env.UTOPIA_APPS_DIR ?? '../utopia-apps/packages');
  let output: string | undefined;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--input') input = path.resolve(argv[++index] ?? input);
    else if (argument === '--output') output = path.resolve(argv[++index] ?? '');
    else if (!argument.startsWith('-')) input = path.resolve(argument);
    else throw new Error(`unknown option ${argument}`);
  }
  return { input, output, dryRun };
}

export function main(argv = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const inputFiles = files(options.input).sort();
  const source = inputFiles.map((file) => ({ file, value: JSON.parse(fs.readFileSync(file, 'utf8')) }));
  const intakeFile = path.resolve(process.env.UTOPIA_APPS_REPO ?? '../utopia-apps', 'metadata/catalog-intake.json');
  if (fs.existsSync(intakeFile)) {
    const intake = JSON.parse(fs.readFileSync(intakeFile, 'utf8')) as { selected?: Array<{ id: string; selected: string }> };
    const archetypes = new Map((intake.selected ?? []).map((item) => {
      const segments = item.selected.split(path.sep);
      const packagesIndex = segments.lastIndexOf('packages');
      const raw = packagesIndex > 0 ? segments[packagesIndex - 1] : '';
      return [item.id, raw.replace(/^\d+-/, '').replace(/-/g, ' ')];
    }));
    for (const item of source) {
      const pkg = item.value as JsonObject;
      const presentation = asObject(pkg.presentation);
      const archetype = archetypes.get(text(pkg.id));
      if (archetype) presentation.archetype = archetype;
      pkg.presentation = presentation;
    }
  }
  const { packages, report } = enrichCatalog(source.map(({ value }) => value), options.dryRun || !options.output);
  if (!options.dryRun && options.output) {
    for (let index = 0; index < source.length; index += 1) {
      const relative = path.relative(options.input, source[index].file);
      const target = fs.statSync(options.input).isFile() ? options.output : path.join(options.output, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(packages[index], null, 2)}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

const invoked = Boolean(process.argv[1] && /enrich-catalog\.(ts|js)$/.test(path.basename(process.argv[1])));
if (invoked) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
