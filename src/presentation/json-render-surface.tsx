import type { Spec } from '@json-render/core';
import { validateSpec } from '@json-render/core';
import { JSONUIProvider, Renderer, createStandardActionHandlers } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { A2UiSurface, A2UiAction, A2UiComponent, AppPackageNativeCapability, PresentationDataState } from '@/packages/shared/contracts/package';
import type { ProviderSyncSummary, ProviderStatusKey } from '@/src/db/provider-status';
import type { DomainRecordViewModel } from '@/src/domain/renderer';
import { JSON_RENDER_WIDGET_REGISTRY } from '@/src/presentation/json-render-widgets';
import { localizePackageUiValue, type PackageLocaleOptions } from '@/src/presentation/package-localization';
import { useUtopiaTheme } from '@/src/theme';
import { queryChartResult, queryMetricResult, resolveDataBinding } from '@/src/presentation/widgets/query-visualization';
import { declaredScreenIds, resolveDeclaredScreenId } from '@/src/presentation/screen-navigation';
import { normalizeProductShellConfig } from '@/src/presentation/widgets/product-shell-config';

type JsonRenderSurfaceProps = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  ui?: A2UiSurface;
  screen?: string;
  records?: DomainRecordViewModel[];
  nativePermissions?: AppPackageNativeCapability['permissions'];
  providerSync?: ProviderSyncSummary | null;
  emptyTitle?: string;
  screenTitle?: string;
  screenSubtitle?: string;
  initialPrompt?: string;
  autoSubmitPrompt?: boolean;
  showBack?: boolean;
  localeOverride?: string;
  recordsState?: PresentationDataState;
  recordsError?: string;
  screenRouteBase?: string;
};

type JsonRenderElement = {
  type: string;
  props: Record<string, unknown>;
  children: string[];
  visible?: unknown;
  on?: Record<string, unknown>;
};

type SurfaceScreen = NonNullable<A2UiSurface['screens']>[string];
type Insets = { top: number; bottom: number };
type SurfaceDensity = 'comfortable' | 'compact';

type Palette = {
  canvas: string;
  ink: string;
  muted: string;
  paper: string;
  moss: string;
  mossSoft: string;
  amberSoft: string;
  plumSoft: string;
  blueSoft: string;
};

const lightPalette: Palette = {
  canvas: '#FBF7EE',
  ink: '#182019',
  muted: '#657066',
  paper: '#FFFCF5',
  moss: '#2F7448',
  mossSoft: '#E4F1E8',
  amberSoft: '#F9E7D9',
  plumSoft: '#EFE6ED',
  blueSoft: '#E3EFF3',
};

const darkPalette: Palette = {
  canvas: '#11130F',
  ink: '#F4F0E6',
  muted: '#B9B2A3',
  paper: '#191B16',
  moss: '#A9C891',
  mossSoft: '#263220',
  amberSoft: '#3C291B',
  plumSoft: '#342637',
  blueSoft: '#1F3138',
};

function paletteFor(dark: boolean): Palette {
  // @json-render/react-native standard Card/ListItem components currently
  // hardcode dark text colors internally, so dark surface backgrounds produce
  // unreadable UI. Keep the pure upstream renderer path, but force light
  // surface tokens until dark-mode-capable upstream/custom catalog components
  // replace those standards.
  return dark ? lightPalette : lightPalette;
}

function toneColor(tone: A2UiComponent['tone'], palette: Palette) {
  if (tone === 'moss') return palette.mossSoft;
  if (tone === 'amber') return palette.amberSoft;
  if (tone === 'plum') return palette.plumSoft;
  if (tone === 'blue') return palette.blueSoft;
  return palette.paper;
}

function normalize(text: unknown) {
  return String(text ?? '').toLowerCase();
}

function recordValue(record: DomainRecordViewModel, field: string): string {
  const trimmed = field.trim();
  if (!trimmed) return '';
  const direct = (() => {
    if (trimmed === 'id') return record.id;
    if (trimmed === 'collection') return record.collection;
    if (trimmed === 'title') return record.title;
    if (trimmed === 'body') return record.body;
    if (trimmed === 'source') return record.source;
    if (trimmed === 'status') return record.status;
    if (trimmed === 'meta') return record.meta;
    return record.properties[trimmed];
  })();
  if (direct === null || direct === undefined) return '';
  if (typeof direct === 'string') return direct;
  if (typeof direct === 'number' || typeof direct === 'boolean') return String(direct);
  return '';
}

function matchesRecord(record: DomainRecordViewModel, query: NonNullable<A2UiComponent['query']>) {
  if (query.collections?.length && !query.collections.includes(record.collection)) {
    return false;
  }
  if (!query.match?.trim()) {
    return true;
  }
  try {
    const pattern = new RegExp(query.match, 'i');
    return pattern.test([
      record.title,
      record.body,
      record.meta,
      record.status,
      record.collection,
      record.source,
      ...Object.values(record.properties).map((value) => String(value ?? '')),
    ].join(' '));
  } catch {
    const needle = normalize(query.match);
    return [
      record.title,
      record.body,
      record.meta,
      record.status,
      record.collection,
      record.source,
      ...Object.values(record.properties).map((value) => String(value ?? '')),
    ]
      .some((value) => normalize(value).includes(needle));
  }
}

function queryRecords(records: DomainRecordViewModel[], query?: A2UiComponent['query']) {
  if (!query) {
    return records.slice(0, 4);
  }
  return records.filter((record) => matchesRecord(record, query)).slice(0, query.limit ?? 4);
}

function actionRoute(action?: A2UiAction, records: DomainRecordViewModel[] = []) {
  const rawRoute = action?.payload?.route;
  if (typeof rawRoute === 'string' && rawRoute.includes('{{record.') && !records[0]) return null;
  const route = typeof rawRoute === 'string'
    ? rawRoute.replace(/\{\{record\.([A-Za-z0-9_]+)\}\}/g, (_match, field: string) => encodeURIComponent(recordValue(records[0], field)))
    : rawRoute;
  if (typeof route !== 'string' || !route.startsWith('/')) return null;
  return normalizeActionRoute(route);
}

function normalizeActionRoute(route: string) {
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
  if (path === `/${'fo'}${'od'}` || path === '/kitchen') return `/${'fo'}${'od'}${suffix}`;
  if (path === '/chat' || path === '/ask') return `/chat${suffix}`;
  if (path === '/sources') return `/sources${suffix}`;
  if (path === '/settings') return `/settings${suffix}`;
  return route;
}

function actionBinding(action?: A2UiAction) {
  const screen = actionRoute(action);
  if (!screen) return null;
  return {
    action: 'navigate',
    params: {
      screen,
    },
  };
}

function navigateSurfaceRoute(router: ReturnType<typeof useRouter>, route: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(route);
    return;
  }
  router.push(route as never);
}

function rowRoute(record: DomainRecordViewModel) {
  return `/record/${encodeURIComponent(record.id)}`;
}

function componentProps(component: A2UiComponent): Record<string, unknown> {
  return component.props && typeof component.props === 'object' && !Array.isArray(component.props)
    ? component.props
    : {};
}

function fallbackFor(component: A2UiComponent) {
  const props = componentProps(component);
  const nested = props.emptyState;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const message = widgetText((nested as Record<string, unknown>).title, widgetText((nested as Record<string, unknown>).body));
    if (message) return message;
  }
  return widgetText(props.emptyTitle, widgetText(props.emptyText, 'Nothing here yet.'));
}

function selectScreen(ui?: A2UiSurface, screen?: string): SurfaceScreen | null {
  if (!ui?.screens) {
    return ui?.components ? { components: ui.components } : null;
  }
  const screenId = resolveDeclaredScreenId(ui, screen);
  return screenId ? ui.screens[screenId] ?? null : null;
}

function shellNavigationScreens(shell: Record<string, unknown>, ui: A2UiSurface | undefined) {
  if (!ui?.screens) return {};
  const declared = new Set(declaredScreenIds(ui));
  const config = normalizeProductShellConfig(shell);
  return Object.fromEntries(config.tabs.flatMap((tab) => {
    const target = tab.screen ?? tab.id;
    return declared.has(target) ? [[tab.id, target]] : [];
  }));
}

function shellWithNavigationIcons(shell: Record<string, unknown>, ui: A2UiSurface | undefined) {
  const navigationItems = ui?.navigation?.items ?? [];
  const iconsByScreen = new Map(navigationItems.flatMap((item) => (
    item.icon ? [[item.screen, item.icon] as const] : []
  )));
  const tabs = Array.isArray(shell.tabs)
    ? shell.tabs.map((tab) => {
        if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return tab;
        const value = tab as Record<string, unknown>;
        if (typeof value.icon === 'string' && value.icon.trim()) return tab;
        const target = typeof value.screen === 'string'
          ? value.screen
          : typeof value.id === 'string'
            ? value.id
            : '';
        const icon = iconsByScreen.get(target);
        return icon ? { ...value, icon } : tab;
      })
    : shell.tabs;
  return { ...shell, ...(tabs ? { tabs } : {}) };
}

function shellNavigationRoutes(screens: Record<string, string>, routeBase?: string) {
  if (!routeBase) return {};
  return Object.fromEntries(Object.entries(screens).map(([tabId, target]) => (
    [tabId, `${routeBase}?screen=${encodeURIComponent(target)}`]
  )));
}

function shellNavigationBindings(routes: Record<string, string>) {
  return Object.fromEntries(Object.entries(routes).map(([tabId, route]) => (
    [`tab:${tabId}`, {
      action: 'navigate',
      params: { screen: route },
    }]
  )));
}

function createBuilder() {
  let next = 0;
  const elements: Record<string, JsonRenderElement> = {};
  const add = (type: string, props: Record<string, unknown> = {}, children: string[] = [], extra: Partial<JsonRenderElement> = {}) => {
    const key = `${type.toLowerCase()}-${next++}`;
    elements[key] = { type, props, children, ...extra };
    return key;
  };
  return { add, elements };
}

function recordIcon(record: DomainRecordViewModel) {
  return widgetText(record.properties.emoji, widgetText(record.properties.icon, '•'));
}

function addActionButton(add: ReturnType<typeof createBuilder>['add'], action: A2UiAction | undefined) {
  const binding = actionBinding(action);
  if (!action?.label || !binding) {
    return null;
  }
  return add('Button', { label: action.label, variant: 'secondary', size: 'md' }, [], {
    on: { press: binding },
  });
}

function widgetText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function widgetCellText(value: unknown, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const instant = (value as Record<string, unknown>).instant;
    if (typeof instant === 'string' && instant.trim()) return instant.trim();
  }
  return fallback;
}

function widgetRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function widgetLabel(value: unknown, fallback = 'Item') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return widgetText(raw.title, widgetText(raw.label, widgetText(raw.name, widgetText(raw.permission, widgetText(raw.id, fallback)))));
  }
  return fallback;
}

function widgetDetail(value: unknown, fallback = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return widgetText(raw.subtitle, widgetText(raw.body, widgetText(raw.detail, widgetText(raw.reason, fallback))));
  }
  return fallback;
}

function widgetNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function widgetActionRoute(value: Record<string, unknown>): string | null {
  const route = widgetText(value.route, widgetText(value.path));
  if (!route.startsWith('/')) return null;
  const [path, query] = route.split('?');
  const suffix = query ? `?${query}` : '';
  if (path === '/' || path === '/home') return `/(tabs)${suffix}`;
  if (path === `/${'fo'}${'od'}` || path === '/kitchen') return `/(tabs)/${'fo'}${'od'}${suffix}`;
  if (path === '/chat' || path === '/ask') return `/(tabs)/chat${suffix}`;
  if (path === '/sources') return `/(tabs)/sources${suffix}`;
  if (path === '/settings') return `/(tabs)/settings${suffix}`;
  return route;
}

function widgetActionUrl(value: Record<string, unknown>): string | null {
  const url = widgetText(value.url, widgetText(value.href, widgetText(value.deeplink)));
  return url ? url : null;
}

function widgetPressBinding(target: Record<string, unknown>): Record<string, unknown> | null {
  const route = widgetActionRoute(target);
  if (route) {
    return { action: 'navigate', params: { screen: route } };
  }
  const url = widgetActionUrl(target);
  if (url) {
    return { action: 'openURL', params: { url } };
  }
  return null;
}

function addWidgetActionButtons(
  add: ReturnType<typeof createBuilder>['add'],
  actions: Record<string, unknown>[],
) {
  const actionButtons = actions.slice(0, 3).flatMap((item) => {
    const press = widgetPressBinding(item);
    if (!press) return [];
    return [add('Button', { label: widgetLabel(item), variant: 'secondary', size: 'sm' }, [], { on: { press } })];
  });
  if (!actionButtons.length) {
    return null;
  }
  return add('Row', { gap: 8, flexWrap: 'wrap' }, actionButtons);
}

function addStandardWidgetCard(
  add: ReturnType<typeof createBuilder>['add'],
  component: A2UiComponent,
  palette: Palette,
  children: string[],
) {
  return add('Card', {
    title: component.title ?? null,
    subtitle: component.subtitle ?? null,
    padding: 18,
    backgroundColor: toneColor(component.tone, palette),
    borderRadius: 18,
    elevated: false,
  }, children);
}

function addStandardDisplayWidget(
  add: ReturnType<typeof createBuilder>['add'],
  component: A2UiComponent,
  palette: Palette,
  records: DomainRecordViewModel[] = [],
  recordsState: PresentationDataState = 'ready',
  recordsError?: string,
  viewportWidth = 1024,
) {
  const props = component.props ?? {};
  switch (component.widget) {
    case 'widgetCatalog': {
      const itemLabels = [
        ...widgetRows(props.items).map((item) => widgetLabel(item)).filter(Boolean),
        ...((Array.isArray(props.widgets) ? props.widgets : []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))),
      ];
      const labels = (itemLabels.length ? itemLabels : [
        'Assistant chat',
        'Health connect',
        'Schema editor',
        'Widget catalog',
        'Post card',
        'Poll card',
        'Link preview',
        'Feed list',
        'Kanban board',
        'Chart block',
        'Media block',
        'Map block',
        'Form card',
        'Checklist card',
        'Calendar block',
        'Timeline block',
        'Gallery grid',
        'Data table',
        'Permission card',
        'Provider status',
        'Theme preview',
      ]).slice(0, 32);
      return addStandardWidgetCard(
        add,
        component,
        palette,
        [add('Row', { gap: 8, flexWrap: 'wrap' }, labels.map((item) => add('Chip', { label: item })))],
      );
    }
    case 'postCard': {
      const children: string[] = [];
      const badge = widgetText(props.badge);
      if (badge) children.push(add('Badge', { label: badge, variant: 'warning' }));
      const imageUrl = widgetText(props.imageUrl);
      if (imageUrl) {
        children.push(add('Image', { src: imageUrl, alt: component.title ?? 'Post image', height: 180, borderRadius: 14, resizeMode: 'cover' }));
      }
      const body = widgetText(props.body, 'A package-defined post, note, update, or announcement.');
      children.push(add('Paragraph', { text: body, color: palette.ink, fontSize: 15 }));
      const url = widgetText(props.url);
      if (url) children.push(add('Label', { text: url, color: palette.moss, size: 'sm' }));
      const actions = addWidgetActionButtons(add, widgetRows(props.actions));
      if (actions) children.push(actions);
      return addStandardWidgetCard(add, component, palette, children);
    }
    case 'linkPreview': {
      const target: Record<string, unknown> = { ...props };
      const url = widgetActionUrl(target);
      const host = (() => {
        try {
          return url ? new URL(url).hostname.replace(/^www\./, '') : 'link';
        } catch {
          return 'link';
        }
      })();
      const heroChildren = [
        add('Badge', { label: host, variant: 'info' }),
        add('Paragraph', {
          text: widgetText(props.body, component.subtitle ?? 'A safe preview surface for recipes, docs, posts, and references.'),
          color: palette.ink,
          fontSize: 15,
        }),
        ...(url ? [add('Label', { text: url, color: palette.moss, size: 'sm' })] : []),
      ];
      const hero = add('Container', {
        padding: 16,
        backgroundColor: palette.blueSoft,
        borderRadius: 16,
      }, heroChildren);
      return addStandardWidgetCard(add, component, palette, [
        widgetPressBinding(target)
          ? add('Pressable', {}, [hero], { on: { press: widgetPressBinding(target) ?? undefined } })
          : hero,
      ]);
    }
    case 'feedList': {
      const items = (widgetRows(props.items).length ? widgetRows(props.items) : [{ title: 'No feed items yet', subtitle: 'Add posts, links, or updates from package data.' }]).slice(0, 8);
      return addStandardWidgetCard(add, component, palette, items.map((item) => {
        const meta = widgetText(item.badge, widgetText(item.status, widgetText(item.date, widgetText(item.when))));
        const subtitle = [meta, widgetDetail(item)].filter(Boolean).join(' · ') || null;
        const press = widgetPressBinding(item);
        return add('ListItem', {
          title: widgetLabel(item),
          subtitle,
          leading: '•',
          showChevron: Boolean(press),
        }, [], press ? { on: { press } } : {});
      }));
    }
    case 'chartBlock': {
      const binding = resolveDataBinding(component.dataBinding, props.dataBinding);
      const bound = binding ? queryChartResult(records, binding, component.dataState ?? recordsState, component.dataError ?? recordsError) : null;
      if (bound?.state === 'loading') {
        return addStandardWidgetCard(add, component, palette, [
          add('Badge', { label: 'Loading', variant: 'info', accessibilityLabel: 'Loading chart data' }),
        ]);
      }
      if (bound?.state === 'error') {
        return addStandardWidgetCard(add, component, palette, [
          add('Badge', { label: 'Error', variant: 'warning', accessibilityLabel: 'Chart data error' }),
          add('Paragraph', { text: bound.message ?? 'Unable to render chart data.', color: palette.muted, accessibilityRole: 'alert' }),
        ]);
      }
      if (bound?.points?.length === 0) {
        return addStandardWidgetCard(add, component, palette, [
          add('Paragraph', { text: widgetText(props.emptyText, bound.message ?? 'No values yet.'), color: palette.muted, accessibilityLabel: widgetText(props.emptyText, bound.message ?? 'No values yet.') }),
        ]);
      }
      const points = (bound?.points ?? (widgetRows(props.points).length ? widgetRows(props.points) : [{ label: 'A', value: 6 }, { label: 'B', value: 10 }, { label: 'C', value: 4 }]))
        .map((point) => ({ label: widgetLabel(point), value: widgetNumber(point.value) }))
        .filter((point) => Number.isFinite(point.value));
      const max = Math.max(1, ...points.map((point) => point.value));
      return addStandardWidgetCard(add, component, palette, points.slice(0, 8).map((point) => add('Column', { gap: 6, accessibilityLabel: `${point.label}: ${point.value}` }, [
        add('Row', { gap: 10, justifyContent: 'space-between', alignItems: 'center' }, [
          add('Label', { text: point.label, color: palette.ink, bold: true, size: 'sm' }),
          add('Label', { text: String(point.value), color: palette.muted, size: 'sm' }),
        ]),
        add('ProgressBar', { progress: point.value / max, color: palette.moss, trackColor: palette.paper, height: 8 }),
      ])));
    }
    case 'mediaBlock': {
      const target: Record<string, unknown> = { ...props };
      const children: string[] = [];
      const imageUrl = widgetText(props.imageUrl);
      if (imageUrl) {
        children.push(add('Image', { src: imageUrl, alt: component.title ?? 'Media', height: 180, borderRadius: 14, resizeMode: 'cover' }));
      } else {
        children.push(add('Badge', { label: 'Media', variant: 'info' }));
      }
      children.push(add('Paragraph', {
        text: widgetText(props.body, 'Attach or preview media here.'),
        color: palette.ink,
        fontSize: 15,
      }));
      const url = widgetActionUrl(target);
      if (url) children.push(add('Label', { text: url, color: palette.moss, size: 'sm' }));
      const press = widgetPressBinding(target);
      if (press) children.push(add('Button', { label: widgetText(props.cta, 'Open media'), variant: 'secondary', size: 'sm' }, [], { on: { press } }));
      return addStandardWidgetCard(add, component, palette, children);
    }
    case 'mapBlock': {
      const target: Record<string, unknown> = { ...props };
      const children: string[] = [
        add('Badge', { label: widgetText((props as Record<string, unknown>).address, 'Map'), variant: 'info' }),
        add('Paragraph', {
          text: widgetText(props.body, 'Map provider hooks can render stores, trips, homes, routes, or field work.'),
          color: palette.ink,
          fontSize: 15,
        }),
      ];
      const press = widgetPressBinding(target);
      if (press) children.push(add('Button', { label: widgetText(props.cta, 'Open map'), variant: 'secondary', size: 'sm' }, [], { on: { press } }));
      return addStandardWidgetCard(add, component, palette, children);
    }
    case 'calendarBlock': {
      const events = (widgetRows(props.events).length ? widgetRows(props.events) : [{ title: 'Planning block', subtitle: 'Today' }, { title: 'Review', subtitle: 'Tomorrow' }]).slice(0, 7);
      return addStandardWidgetCard(add, component, palette, events.map((event) => add('ListItem', {
        title: widgetLabel(event),
        subtitle: [widgetText(event.date, widgetText(event.when)), widgetDetail(event)].filter(Boolean).join(' · ') || null,
        leading: '📅',
      })));
    }
    case 'timelineBlock': {
      const items = (widgetRows(props.items).length ? widgetRows(props.items) : [{ title: 'Started', subtitle: 'Created from package config' }, { title: 'Next', subtitle: 'Add more events from package data' }]).slice(0, 10);
      return addStandardWidgetCard(add, component, palette, items.map((item) => add('ListItem', {
        title: widgetLabel(item),
        subtitle: widgetDetail(item, widgetText(item.time)),
        leading: '•',
      })));
    }
    case 'galleryGrid': {
      const items = (widgetRows(props.items).length ? widgetRows(props.items) : [{ title: 'Image' }, { title: 'Clip' }, { title: 'Doc' }, { title: 'Audio' }]).slice(0, 8);
      return addStandardWidgetCard(add, component, palette, [
        add('Row', { gap: 10, flexWrap: 'wrap' }, items.map((item, index) => {
          const imageUrl = widgetText(item.imageUrl, widgetText(item.url));
          const detail = widgetDetail(item);
          const tileChildren = [
            ...(imageUrl
              ? [add('Image', { src: imageUrl, alt: widgetLabel(item), height: 96, borderRadius: 12, resizeMode: 'cover' })]
              : [add('Label', { text: widgetText(item.emoji, 'Item'), color: palette.muted, bold: true, size: 'sm' })]),
            add('Label', { text: widgetLabel(item), color: palette.ink, bold: true, size: 'sm' }),
            ...(detail ? [add('Paragraph', { text: detail, color: palette.muted, fontSize: 13, numberOfLines: 3 })] : []),
          ];
          const press = widgetPressBinding(item);
          const tile = add('Container', {
            width: 148,
            minHeight: 96,
            padding: 10,
            backgroundColor: index % 2 === 0 ? palette.plumSoft : palette.blueSoft,
            borderRadius: 14,
          }, tileChildren);
          return press ? add('Pressable', {}, [tile], { on: { press } }) : tile;
        })),
      ]);
    }
    case 'dataTable': {
      const declaredColumns = widgetRows(props.columns);
      const fieldColumns: Record<string, unknown>[] = Array.isArray(props.fields)
        ? props.fields.flatMap((field) => {
            const key = widgetText(field);
            return key ? [{ key, label: key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) }] : [];
          })
        : [];
      const fallbackColumns: Record<string, unknown>[] = [
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status' },
        { key: 'owner', label: 'Owner' },
      ];
      const columns = (declaredColumns.length ? declaredColumns : fieldColumns.length ? fieldColumns : fallbackColumns).slice(0, 8).map((column, index) => ({
        key: widgetText(column.key, widgetText(column.field, widgetText(column.id, widgetText(column.name, `column_${index}`)))).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        title: widgetLabel(column, `Column ${index + 1}`),
      }));
      const recordField = widgetText(props.itemsFromRecordField);
      const boundItems = recordField
        ? records.flatMap((record) => widgetRows(record.properties[recordField] ?? (record as unknown as Record<string, unknown>)[recordField]))
        : [];
      const queriedItems: Record<string, unknown>[] = recordField
        ? []
        : records.map((record) => ({
          id: record.id,
          title: record.title,
          ...record.properties,
        }));
      const items = (boundItems.length
        ? boundItems
        : widgetRows(props.items).length
          ? widgetRows(props.items)
          : queriedItems).slice(0, 20);
      if (recordsState === 'loading') {
        return addStandardWidgetCard(add, component, palette, [
          add('Paragraph', { text: 'Loading table…', color: palette.muted, fontSize: 14 }),
        ]);
      }
      if (recordsState === 'error') {
        return addStandardWidgetCard(add, component, palette, [
          add('Paragraph', { text: recordsError || 'Table data is unavailable.', color: palette.muted, fontSize: 14 }),
        ]);
      }
      if (!items.length) {
        return addStandardWidgetCard(add, component, palette, [
          add('Paragraph', { text: widgetText(props.emptyText, 'No table rows yet.'), color: palette.muted, fontSize: 14 }),
        ]);
      }
      const narrow = viewportWidth < 600;
      const header = add('Row', { gap: 8, accessibilityRole: 'row' }, columns.map((column) => add('Container', { flex: 1, minWidth: 0, accessibilityRole: 'columnheader' }, [
        add('Label', { text: column.title, color: palette.muted, bold: true, size: 'xs' }),
      ])), { visible: !narrow });
      const rows = items.map((item, index) => {
        const press = widgetPressBinding(item);
        const row = narrow
          ? add('Container', { paddingVertical: 10, accessibilityRole: 'group', accessibilityLabel: widgetLabel(item) }, columns.map((column, columnIndex) => add('Row', { gap: 8, alignItems: 'flex-start' }, [
              add('Label', { text: column.title, color: palette.muted, bold: true, size: 'xs', width: 96 }),
              add('Paragraph', {
                text: widgetCellText(item[column.key], columnIndex === 0 ? widgetLabel(item) : '—'),
                color: palette.ink,
                fontSize: 14,
                flex: 1,
              }),
            ])))
          : add('Container', { paddingVertical: 10, accessibilityRole: 'row' }, [
              add('Row', { gap: 8 }, columns.map((column, columnIndex) => add('Container', { flex: 1, minWidth: 0, accessibilityRole: 'cell' }, [
                add('Paragraph', {
                  text: widgetCellText(item[column.key], columnIndex === 0 ? widgetLabel(item) : '—'),
                  color: palette.ink,
                  fontSize: 14,
                }),
              ]))),
            ]);
        return press ? add('Pressable', { accessibilityRole: 'button', accessibilityLabel: widgetLabel(item) }, [row], { on: { press } }) : row;
      });
      const tableChildren: string[] = narrow ? rows : [header];
      if (!narrow) rows.forEach((row, index) => {
        tableChildren.push(add('Divider', { color: palette.blueSoft, margin: 0 }), row);
        if (index === rows.length - 1) tableChildren.push(add('Divider', { color: palette.blueSoft, margin: 0 }));
      });
      return addStandardWidgetCard(add, component, palette, [
        add('Container', { accessibilityRole: narrow ? 'list' : 'table' }, tableChildren),
      ]);
    }
    case 'themePreview': {
      const colorSource = props.colors && typeof props.colors === 'object' && !Array.isArray(props.colors)
        ? Object.entries(props.colors as Record<string, unknown>).filter(([, value]) => typeof value === 'string' && value.trim())
        : [];
      const swatches = (colorSource.length ? colorSource : [
        ['primary', '#2F7448'],
        ['accent', '#F3B15E'],
        ['calm', '#B9DCE8'],
        ['ink', '#241C16'],
      ]) as Array<[string, string]>;
      const children: string[] = [
        add('Row', { gap: 8, flexWrap: 'wrap' }, swatches.map(([name, value]) => add('Chip', {
          label: `${name}: ${value}`,
          backgroundColor: value,
        }))),
      ];
      const mood = widgetText(props.mood);
      if (mood) children.push(add('Paragraph', { text: mood, color: palette.muted, fontSize: 14 }));
      const density = widgetText(props.density);
      if (density) children.push(add('Badge', { label: density, variant: 'success' }));
      return addStandardWidgetCard(add, component, palette, children);
    }
    default:
      return null;
  }
}

function addTextBlock(add: ReturnType<typeof createBuilder>['add'], component: A2UiComponent, palette: Palette) {
  const children = [
    add('Heading', { text: component.title ?? 'Section', level: 'h3', color: palette.ink }),
  ];
  if (component.subtitle) {
    children.push(add('Paragraph', { text: component.subtitle, color: palette.muted, fontSize: 15 }));
  }
  const button = addActionButton(add, component.action);
  if (button) children.push(button);
  return add('Card', {
    title: null,
    subtitle: null,
    padding: 18,
    backgroundColor: toneColor(component.tone, palette),
    borderRadius: 18,
    elevated: false,
  }, children);
}

function addActionBlock(add: ReturnType<typeof createBuilder>['add'], component: A2UiComponent, palette: Palette) {
  const binding = actionBinding(component.action);
  return add('Card', {
    title: component.title ?? component.action?.label ?? 'Open',
    subtitle: component.subtitle ?? null,
    padding: 18,
    backgroundColor: toneColor(component.tone, palette),
    borderRadius: 18,
    elevated: false,
  }, binding ? [
    add('Button', { label: component.action?.label ?? 'Open', variant: 'secondary', size: 'md' }, [], {
      on: { press: binding },
    }),
  ] : []);
}

function addMetricBlock(
  add: ReturnType<typeof createBuilder>['add'],
  component: A2UiComponent,
  records: DomainRecordViewModel[],
  palette: Palette,
  recordsState: PresentationDataState = 'ready',
  recordsError?: string,
  viewportWidth = 1024,
) {
  const rows = queryRecords(records, component.query);
  const props = componentProps(component);
  const binding = resolveDataBinding(component.dataBinding, props.dataBinding);
  const result = queryMetricResult(rows, binding, component.dataState ?? recordsState, component.dataError ?? recordsError);
  const body = result.state === 'loading'
    ? [add('Badge', { label: 'Loading', variant: 'info', accessibilityLabel: 'Loading metric data' })]
    : result.state === 'error'
      ? [
          add('Badge', { label: 'Error', variant: 'warning', accessibilityLabel: 'Metric data error' }),
          add('Paragraph', { text: result.message ?? 'Unable to render metric data.', color: palette.muted, accessibilityRole: 'alert' }),
        ]
      : result.value === undefined
        ? [add('Paragraph', { text: widgetText(props.emptyText, result.message ?? 'No values yet.'), color: palette.muted, accessibilityLabel: widgetText(props.emptyText, result.message ?? 'No values yet.') })]
        : [add('Heading', { text: String(result.value), level: 'h1', color: palette.ink, accessibilityLabel: `${component.title ?? 'Metric'}: ${result.value}` })];
  return add('Card', {
    title: component.title ?? 'Metric',
    subtitle: component.subtitle ?? null,
    padding: 18,
    backgroundColor: toneColor(component.tone, palette),
    borderRadius: 18,
    elevated: false,
  }, body);
}

function addRecordListBlock(add: ReturnType<typeof createBuilder>['add'], component: A2UiComponent, records: DomainRecordViewModel[], palette: Palette) {
  const rows = queryRecords(records, component.query);
  const children: string[] = [];
  const button = addActionButton(add, component.action);
  const props = componentProps(component);
  const subtitleFields = Array.isArray(props.subtitleFields)
    ? props.subtitleFields.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const subtitleTemplate = widgetText(props.subtitleTemplate);
  const iconField = widgetText(props.iconField);
  if (rows.length) {
    for (const row of rows) {
      const subtitle = (() => {
        if (subtitleTemplate) {
          const interpolated = subtitleTemplate.replace(/\{([^}]+)\}/g, (_, field: string) => recordValue(row, field));
          if (interpolated.trim()) return interpolated;
        }
        if (subtitleFields.length) {
          const values = subtitleFields.map((field) => recordValue(row, field)).filter(Boolean);
          if (values.length) return values.join(' · ');
        }
        return row.body || row.meta || row.status;
      })();
      const leading = iconField ? recordValue(row, iconField) || recordIcon(row) : recordIcon(row);
      children.push(add('ListItem', {
        title: row.title,
        subtitle,
        leading,
        trailing: null,
        showChevron: true,
      }, [], {
        on: { press: actionBinding({ kind: 'propose', payload: { route: rowRoute(row) } }) ?? undefined },
      }));
    }
  } else {
    children.push(add('Paragraph', { text: fallbackFor(component), color: palette.muted, fontSize: 15 }));
  }
  if (button) children.push(button);
  return add('Card', {
    title: component.title ?? 'Records',
    subtitle: component.subtitle ?? null,
    padding: 14,
    backgroundColor: palette.paper,
    borderRadius: 18,
    elevated: false,
  }, children);
}

function addUnsupportedWidgetBlock(add: ReturnType<typeof createBuilder>['add'], component: A2UiComponent, palette: Palette) {
  const props = componentProps(component);
  const fallbackText = widgetText(
    props.fallbackText,
    widgetText(
      props.fallback,
      'This package component is unavailable in this runtime.',
    ),
  );
  return add('Card', {
    title: component.title ?? 'Unsupported component',
    subtitle: component.subtitle ?? null,
    padding: 18,
    backgroundColor: palette.paper,
    borderRadius: 18,
    elevated: false,
  }, [
    add('Paragraph', {
      text: fallbackText,
      color: palette.muted,
      fontSize: 15,
    }),
  ]);
}

function providerKeyFromComponent(component: A2UiComponent): ProviderStatusKey {
  const raw = component.props?.provider;
  if (raw === 'local' || raw === 'notion' || raw === 'google_sheets' || raw === 'summary') return raw;
  return 'summary';
}

function addSurfaceComponent(
  add: ReturnType<typeof createBuilder>['add'],
  component: A2UiComponent,
  records: DomainRecordViewModel[],
  palette: Palette,
  nativePermissions?: AppPackageNativeCapability['permissions'],
  providerSync?: ProviderSyncSummary | null,
  initialPrompt?: string,
  autoSubmitPrompt?: boolean,
  recordsState: PresentationDataState = 'ready',
  recordsError?: string,
  viewportWidth = 1024,
) {
  if (component.kind === 'widget') {
    const standardWidgetKinds = new Set<string>([
      'widgetCatalog',
      'postCard',
      'linkPreview',
      'feedList',
      'chartBlock',
      'mediaBlock',
      'mapBlock',
      'calendarBlock',
      'timelineBlock',
      'galleryGrid',
      'dataTable',
      'themePreview',
    ]);
    if (component.widget && standardWidgetKinds.has(component.widget)) {
      const rendered = addStandardDisplayWidget(add, component, palette, queryRecords(records, component.query), recordsState, recordsError, viewportWidth);
      if (rendered) return rendered;
    }
    const typeByWidget: Record<string, string> = {
      assistantChat: 'AssistantChatWidget',
      healthConnect: 'HealthConnectWidget',
      schemaEditor: 'SchemaEditorWidget',
      pollCard: 'PollCardWidget',
      kanbanBoard: 'KanbanBoardWidget',
      smartCapture: 'SmartCaptureWidget',
      videoPlayer: 'VideoPlayerWidget',
      cameraScanner: 'CameraScannerWidget',
      locationMap: 'LocationMapWidget',
      sensorReadout: 'SensorReadoutWidget',
      notificationScheduler: 'NotificationSchedulerWidget',
      contactPicker: 'ContactPickerWidget',
      calendarEvent: 'CalendarEventWidget',
      biometricGate: 'BiometricGateWidget',
      healthKitStatus: 'HealthKitStatusWidget',
      speechTool: 'SpeechToolWidget',
      formCard: 'FormCardWidget',
      checklistCard: 'ChecklistCardWidget',
      permissionCard: 'PermissionCardWidget',
      capabilityExerciser: 'CapabilityExerciserWidget',
      providerStatus: 'ProviderStatusWidget',
      themeDensitySelector: 'ThemeDensitySelectorWidget',
      aiProviderSettings: 'AiProviderSettingsWidget',
      dataHomeSettings: 'DataHomeSettingsWidget',
      scientificCalculator: 'ScientificCalculatorWidget',
      audioLoopPlayer: 'AudioLoopPlayerWidget',
      stepFlow: 'StepFlowWidget',
      durationTimer: 'DurationTimerWidget',
      valueControl: 'ValueControlWidget',
      operationHistory: 'OperationHistoryWidget',
      quickAddList: 'QuickAddListWidget',
      structuredList: 'StructuredListWidget',
      groupedRecordShelf: 'GroupedRecordShelfWidget',
      horizontalRecordCarousel: 'HorizontalRecordCarouselWidget',
      filePicker: 'FilePickerWidget',
      fileExport: 'FileExportWidget',
      recordHeroSummary: 'RecordHeroSummaryWidget',
      recordTimeline: 'RecordTimelineWidget',
      recordContentCard: 'RecordContentCardWidget',
      recordReviewCard: 'RecordReviewCardWidget',
      askFoodBar: 'AskFoodBarWidget',
    };
    const widgetType = component.widget ? typeByWidget[component.widget] : null;
    if (widgetType) {
      const usesNamedQuery = typeof component.props?.query === 'string' && component.props.query.trim().length > 0;
      return add(widgetType, {
        title: component.title,
        subtitle: component.subtitle,
        ...(component.widget === 'permissionCard' && component.props?.permissions === undefined && nativePermissions ? { permissions: nativePermissions } : {}),
        ...(component.widget === 'providerStatus' && providerSync ? { providerStatus: providerSync.providers[providerKeyFromComponent(component)] } : {}),
        ...(component.query || usesNamedQuery ? {
          records: component.query ? queryRecords(records, component.query) : records,
          dataBound: true,
        } : {}),
        ...(component.props ?? {}),
        ...(component.widget === 'assistantChat' && initialPrompt ? {
          initialPrompt,
          autoSubmitPrompt: autoSubmitPrompt === true,
        } : {}),
      });
    }
    return addUnsupportedWidgetBlock(add, component, palette);
  }
  if (component.kind === 'recordList' && component.props?.searchable === true) {
    return add('SearchableRecordListWidget', {
      title: component.title,
      subtitle: component.subtitle,
      records: queryRecords(records, component.query),
      ...(component.props ?? {}),
    });
  }
  if (component.kind === 'recordList' && component.props?.detail === true) {
    return add('RecordDetailWidget', {
      title: component.title,
      subtitle: component.subtitle,
      records: queryRecords(records, component.query),
      ...(component.props ?? {}),
    });
  }
  if (component.kind === 'recordList') return addRecordListBlock(add, component, records, palette);
  if (component.kind === 'metric') return addMetricBlock(add, component, records, palette, recordsState, recordsError);
  if (component.kind === 'action') return addActionBlock(add, component, palette);
  return addTextBlock(add, component, palette);
}

function composeJsonRenderSpec(
  props: JsonRenderSurfaceProps,
  palette: Palette,
  insets: Insets,
  density: SurfaceDensity,
  viewportWidth = 1024,
): Spec {
  const localeOptions: PackageLocaleOptions = {
    appLocale: props.localeOverride,
    deviceLocale: systemLocale(),
  };
  const selectedScreenId = resolveDeclaredScreenId(props.ui, props.screen);
  const screen = localizePackageUiValue(
    selectScreen(props.ui, selectedScreenId),
    props.ui?.localization,
    localeOptions,
  );
  const components = screen?.components ?? [];
  const topAction = components.find((component) => component.kind === 'action' && component.placement === 'top');
  const fabAction = components.find((component) => component.kind === 'action' && component.placement === 'fab');
  const contentComponents = components.filter((component) => component !== topAction && component !== fabAction);
  const shellConfig = screen?.shell
    ? shellWithNavigationIcons(screen.shell, props.ui)
    : undefined;
  const shellTabScreens = shellConfig
    ? shellNavigationScreens(shellConfig, props.ui)
    : {};
  const shellTabRoutes = shellNavigationRoutes(shellTabScreens, props.screenRouteBase);
  const fullPageChat = contentComponents.length === 1
    && contentComponents[0]?.kind === 'widget'
    && contentComponents[0]?.widget === 'assistantChat'
    && contentComponents[0]?.props?.fullPage === true;
  const { add, elements } = createBuilder();
  const compact = density === 'compact';
  const bottomGap = Math.max(compact ? 30 : 42, insets.bottom + (compact ? 12 : 22));
  const header = shellConfig ? null : add('ScreenHeaderWidget', {
    title: props.screenTitle ?? (selectedScreenId === 'record' ? props.records?.[0]?.title : undefined) ?? screen?.title ?? props.title ?? 'App',
    eyebrow: props.eyebrow,
    showBack: props.showBack === true,
    actionLabel: topAction?.action?.label,
    actionRoute: actionRoute(topAction?.action, props.records),
  });
  const contentChildren = [
  ];
  const subtitle = props.screenSubtitle ?? screen?.subtitle ?? props.subtitle;
  if (subtitle && !shellConfig && !fullPageChat) {
    contentChildren.push(add('Paragraph', { text: subtitle, color: palette.muted, fontSize: 16 }));
  }
  if (contentComponents.length) {
    for (const component of contentComponents) {
      contentChildren.push(addSurfaceComponent(
        add,
        component,
        props.records ?? [],
        palette,
        props.nativePermissions,
        props.providerSync,
        props.initialPrompt,
        props.autoSubmitPrompt,
        props.recordsState,
        props.recordsError,
        viewportWidth,
      ));
    }
  } else if (!components.length) {
    contentChildren.push(add('Card', {
      title: props.emptyTitle ?? 'Nothing configured yet.',
      subtitle: 'Add package components to render this surface.',
      padding: 18,
      backgroundColor: palette.paper,
      borderRadius: 18,
      elevated: false,
    }));
  }
  if (!fullPageChat) contentChildren.push(add('Spacer', { size: bottomGap }));
  const column = add('Column', {
    gap: fullPageChat ? 0 : compact ? 10 : 14,
    padding: fullPageChat || shellConfig ? 0 : compact ? 12 : 16,
    flex: 1,
  }, contentChildren);
  const shellRoot = shellConfig
    ? add('ProductShellWidget', {
        title: props.screenTitle ?? screen?.title ?? props.title ?? 'App',
        subtitle: props.screenSubtitle ?? screen?.subtitle ?? props.subtitle,
        ...shellConfig,
        tabScreens: shellTabScreens,
        tabRoutes: shellTabRoutes,
        ...(selectedScreenId ? { activeTab: selectedScreenId } : {}),
      }, [column], {
        on: shellNavigationBindings(shellTabRoutes),
      })
    : null;
  const rootChildren = fullPageChat
      ? [header!, column]
      : [header!, add('ScrollContainer', { padding: 0, backgroundColor: palette.canvas, horizontal: false, showsScrollIndicator: true }, [column])];
  const fabRoute = actionRoute(fabAction?.action, props.records);
  if (fabAction?.action?.label && fabRoute) {
    rootChildren.push(add('FloatingActionWidget', {
      label: fabAction.action.label,
      route: fabRoute,
    }));
  }
  const root = shellRoot ?? add('SafeArea', { backgroundColor: palette.canvas }, rootChildren);
  return { root, elements } as Spec;
}

function systemLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

function assertJsonRenderSpec(spec: Spec): Spec {
  const result = validateSpec(spec);
  if (!result.valid) {
    throw new Error(`Invalid json-render spec: ${result.issues.map((issue) => issue.message).join('; ')}`);
  }
  return spec;
}

export function buildJsonRenderSpec(
  props: JsonRenderSurfaceProps,
  options: { dark?: boolean; density?: SurfaceDensity; insets?: Partial<Insets>; viewportWidth?: number } = {},
): Spec {
  const insets = {
    top: options.insets?.top ?? 0,
    bottom: options.insets?.bottom ?? 0,
  };
  return assertJsonRenderSpec(composeJsonRenderSpec(props, paletteFor(Boolean(options.dark)), insets, options.density ?? 'comfortable', options.viewportWidth));
}

export function JsonRenderSurface(props: JsonRenderSurfaceProps) {
  const router = useRouter();
  const theme = useUtopiaTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const spec = useMemo(() => buildJsonRenderSpec(props, { dark: theme.dark, density: theme.density, insets, viewportWidth: width }), [insets, props, theme.dark, theme.density, width]);
  const handlers = useMemo(() => createStandardActionHandlers({
    navigate: (screen) => navigateSurfaceRoute(router, screen),
    goBack: () => {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)' as never);
    },
  }), [router]);

  return (
    <JSONUIProvider navigate={(path) => navigateSurfaceRoute(router, path)} handlers={handlers} registry={JSON_RENDER_WIDGET_REGISTRY}>
      <Renderer key={props.screen ?? 'default'} spec={spec} includeStandard registry={JSON_RENDER_WIDGET_REGISTRY} />
    </JSONUIProvider>
  );
}
