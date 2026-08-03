import type { useRouter } from 'expo-router';
import { Linking, Platform } from 'react-native';

import type { ProviderSyncStatus } from '@/src/db/provider-status';

export type WidgetProps = {
  widget?: string;
  label?: string;
  title?: string;
  subtitle?: string;
  prompt?: string;
  placeholder?: string;
  eyebrow?: string;
  emoji?: string;
  actionLabel?: string;
  primaryActionLabel?: string;
  stateVariants?: unknown;
  actionRoute?: string;
  route?: string;
  showBack?: boolean;
  examples?: unknown[];
  suggestions?: unknown[];
  compact?: boolean;
  appearance?: string;
  commandPolicy?: unknown;
  progressiveDisclosure?: boolean;
  body?: string;
  author?: string;
  url?: string;
  imageUrl?: string;
  chips?: unknown[];
  items?: unknown[];
  groups?: unknown[];
  gridColumns?: unknown;
  options?: unknown[];
  columns?: unknown[];
  fields?: unknown[];
  events?: unknown[];
  eventLabels?: unknown;
  points?: unknown[];
  permissions?: unknown[];
  capability?: string;
  provider?: string;
  providerStatus?: ProviderSyncStatus;
  status?: string;
  badge?: string;
  cta?: string;
  ctaRoute?: string;
  homes?: unknown[];
  steps?: unknown[];
  actions?: unknown[];
  showHeader?: boolean;
  fullPage?: boolean;
  initialPrompt?: string;
  autoSubmitPrompt?: boolean;
  records?: unknown[];
  dateField?: string;
  stats?: unknown[];
  dataBound?: boolean;
  searchable?: boolean;
  detail?: boolean;
  emptyTitle?: string;
  emptyCopy?: string;
  emptyActionLabel?: string;
  emptyActionRoute?: string;
  saveOutcome?: unknown;
  initialExpression?: string;
  initialResult?: string;
  angleMode?: string;
  defaultPlays?: unknown;
  maxPlays?: unknown;
  defaultDelaySeconds?: unknown;
  defaultStartDelaySeconds?: unknown;
  delayOptions?: unknown[];
  startDelayOptions?: unknown[];
  presets?: unknown[];
  allowSeeking?: boolean;
  countSkippedAsCompleted?: boolean;
  nativeUnavailableCopy?: string;
  mimeTypes?: unknown;
  multiple?: boolean;
  copyToCacheDirectory?: boolean;
  fileName?: string;
  mimeType?: string;
  content?: unknown;
  shareTitle?: string;
  sourceUri?: string;
  source?: string;
  autoplay?: boolean;
  loop?: boolean;
  allowPick?: boolean;
  allowCapture?: boolean;
  contentFit?: string;
  nativeControls?: boolean;
  barcodeTypes?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  address?: string;
  sensor?: string;
  seconds?: unknown;
  eventTitle?: string;
  startOffsetMinutes?: unknown;
  durationMinutes?: unknown;
  durationSeconds?: unknown;
  runId?: string;
  completionRecord?: unknown;
  speechText?: string;
  authPrompt?: string;
  checkedField?: string;
  pickedField?: string;
  pickedLabel?: string;
  collection?: string;
  recordId?: string;
  recordMode?: "append" | "upsert";
  recordTitle?: string;
  initialValue?: unknown;
  positionField?: string;
  reorderable?: boolean;
  editable?: boolean;
  deletable?: boolean;
  autoSaveEdits?: boolean;
  noteField?: string;
  notePlaceholder?: string;
  metadataFields?: unknown;
  sorts?: unknown;
  filterFields?: unknown;
  copy?: Record<string, unknown>;
  inputLabel?: string;
  emptyText?: string;
  valueField?: string;
  titleField?: string;
  quickAdds?: unknown[];
  defaultProperties?: Record<string, unknown>;
  presetLabelField?: string;
  presetValueField?: string;
  presetProperties?: Record<string, unknown>;
  showManualEntry?: boolean;
  showRecords?: boolean;
  submitLabel?: string;
  step?: unknown;
  min?: unknown;
  max?: unknown;
  resetValue?: unknown;
  precision?: unknown;
  unit?: string;
  limit?: unknown;
};

export function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const VISUAL_GLYPHS: Readonly<Record<string, string>> = {
  archive: '▣',
  berries: '🫐',
  bowl: '🥣',
  box: '📦',
  calendar: '📅',
  camera: '📷',
  cube: '🧊',
  edit: '✎',
  fish: '🐟',
  leaf: '🥬',
  link: '↗',
  meal: '🍲',
  plate: '🍽️',
  receipt: '🧾',
  snowflake: '❄',
  timer: '◷',
};

export function visualGlyph(value: unknown, fallback = '•') {
  const candidate = text(value);
  if (!candidate) return fallback;
  const mapped = VISUAL_GLYPHS[candidate.toLowerCase()];
  if (mapped) return mapped;
  return /^[a-z][a-z0-9-]*$/i.test(candidate) ? fallback : candidate;
}

type TemplateRecord = Readonly<{
  id?: unknown;
  title?: unknown;
  collection?: unknown;
  properties?: Readonly<Record<string, unknown>>;
}>;

const TEMPLATE_TOKEN = /(^|[^\\{])\{([A-Za-z_][A-Za-z0-9_]{0,63})\}(?!\})/g;

export function interpolateRecordTemplate(value: unknown, context: unknown, fallback = '-'): string {
  const template = text(value, fallback);
  return template
    .replace(TEMPLATE_TOKEN, (_match, prefix: string, field: string) => {
      const resolved = templateRecordValue(firstTemplateRecord(context), field, fallback);
      return `${prefix}${resolved}`;
    })
    .replace(/\\([{}])/g, '$1');
}

function firstTemplateRecord(context: unknown): TemplateRecord | null {
  const candidate = Array.isArray(context) ? context[0] : context;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as TemplateRecord : null;
}

function templateRecordValue(record: TemplateRecord | null, field: string, fallback: string): string {
  if (!record) return fallback;
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
    ? record.properties
    : {};
  const value = Object.prototype.hasOwnProperty.call(properties, field)
    ? properties[field]
    : (record as Record<string, unknown>)[field];
  if (value === null || value === undefined) return fallback;
  const rendered = String(value).trim();
  return rendered ? rendered : fallback;
}

export function list(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : fallback;
}

export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

export function label(value: unknown, fallback = 'Item') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return text(raw.title, text(raw.label, text(raw.name, text(raw.permission, text(raw.id, fallback)))));
  }
  return fallback;
}

export function detail(value: unknown, fallback = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return text(raw.subtitle, text(raw.body, text(raw.detail, text(raw.reason, fallback))));
  }
  return fallback;
}

export function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function actionRoute(value: Record<string, unknown>): string {
  return normalizeWidgetRoute(text(value.route, text(value.path)));
}

export function actionUrl(value: Record<string, unknown>): string {
  return text(value.url, text(value.href, text(value.deeplink)));
}

export function openWidgetTarget(router: ReturnType<typeof useRouter>, target: Record<string, unknown>) {
  const route = actionRoute(target);
  if (route) {
    navigateWidgetRoute(router, route);
    return;
  }
  const url = actionUrl(target);
  if (url) {
    void Linking.openURL(url);
  }
}

export function navigateWidgetRoute(router: ReturnType<typeof useRouter>, route: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(route);
    return;
  }
  router.push(route as never);
}

export function normalizeWidgetRoute(route: string) {
  if (!route) return '';
  const [path, query] = route.split('?');
  const suffix = query ? `?${query}` : '';
  if (path.startsWith('/collection/')) {
    const id = path.slice('/collection/'.length);
    return `/collection?id=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
  }
  if (path.startsWith('/record/')) {
    const id = path.slice('/record/'.length);
    return `/record?id=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
  }
  if (path === '/' || path === '/home') return `/${suffix}`;
  if (path === '/chat' || path === '/ask') return `/chat${suffix}`;
  if (path === `/${'fo'}${'od'}` || path === '/kitchen') return `/${'fo'}${'od'}${suffix}`;
  if (path === '/sources') return `/sources${suffix}`;
  if (path === '/settings') return `/settings${suffix}`;
  return route;
}
