import { ChevronRight, ExternalLink } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Linking } from 'react-native';
import { Button, Card, H2, Paragraph, Progress, Text, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';
import { ChartVisualization } from './chart-visualization';
import { normalizeStatusTone, themeStatusColor, usePackageTheme } from './theme';
import { normalizeWidgetKind, widgetAliases } from './widget-support';

type Row = Record<string, unknown>;
type Props = { component: AppComponent; navigate(target: string): void };

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === 'object') : [];
const title = (row: Row) => text(row.title, text(row.label, text(row.name)));
const detail = (row: Row) => text(row.subtitle, text(row.detail, text(row.body)));
const field = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const rowTarget = (row: Row) => field(row.route, field(row.screen));
const rowUrl = (row: Row) => field(row.url);

type WidgetAction = { target?: string; url?: string; disabled?: boolean };

const actionFromComponent = (component?: AppComponent): WidgetAction => {
  const action = component?.action;
  if (!action) return {};
  if (action.kind === 'navigate' || action.operation === 'navigate') {
    return { target: text(action.target, text(action.payload?.route)) };
  }
  if (action.kind === 'open_url') return { url: text(action.url, text(action.payload?.url)) };
  return {};
};

const actionFromRow = (row: Row, component?: AppComponent): WidgetAction => {
  const action = row?.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object') return actionFromComponent(component);
  if (action.kind === 'navigate' || action.operation === 'navigate') {
    return { target: text(action.target, text(action.route)) };
  }
  if (action.kind === 'open_url') return { url: text(action.url, text(action.href)) };
  return actionFromComponent(component);
};

export function resolveWidgetAction(item: Row, component?: AppComponent): WidgetAction {
  const explicitTarget = rowTarget(item);
  const explicitUrl = rowUrl(item);
  const explicitAction = actionFromRow(item, component);
  const fallback = actionFromComponent(component);
  const fallbackTarget = text(fallback.target);
  const fallbackUrl = text(fallback.url);
  const actionTarget = text(explicitAction.target);
  const actionUrl = text(explicitAction.url);

  return {
    target: explicitTarget || actionTarget || (fallbackTarget.startsWith('/') ? fallbackTarget : ''),
    url: explicitUrl || actionUrl || (!fallbackTarget.startsWith('/') ? fallbackUrl : fallbackUrl),
    disabled: item.disabled === true,
  };
}

export function executeWidgetAction(item: Row, component: AppComponent | undefined, navigate: Props['navigate']): boolean {
  const action = resolveWidgetAction(item, component);
  if (action.disabled || (!action.target && !action.url)) return false;

  if (action.target) {
    void navigate(action.target);
    return true;
  }

  const target = text(action.url);
  if (!target) return false;
  if (target.startsWith('/')) {
    void navigate(target);
    return true;
  }
  if (/^https?:\/\//.test(target)) {
    void Linking.openURL(target);
    return true;
  }
  return false;
}

function Shell({ component, children }: { component: AppComponent; children: React.ReactNode }) {
  const theme = usePackageTheme();
  const tone = normalizeStatusTone(component.tone ?? 'neutral');
  const color = themeStatusColor(tone, theme);
  return <Card gap="$3" style={{ padding: 16, borderWidth: 1, borderColor: `${color}33`, borderRadius: 8, backgroundColor: `${theme.surface}` }}>{component.title ? <H2 size="$6" style={{ color: theme.ink }}>{component.title}</H2> : null}{component.subtitle ? <Paragraph style={{ color: theme.muted }}>{component.subtitle}</Paragraph> : null}{children}</Card>;
}

function Gallery({ component, navigate }: Props) {
  return <Shell component={component}><XStack flexWrap="wrap" gap="$3">{rows(component.props?.items).map((item, index) => {
    const image = text(item.imageUrl, text(item.image));
    return <Card key={String(item.id ?? index)} pressStyle={{ scale: .98 }} onPress={() => void executeWidgetAction(item, component, navigate)} width="47%" minHeight={132} padding="$3" gap="$2" borderRadius="$5" backgroundColor="#F6F1E8">
      {image ? <Image source={{ uri: image }} style={{ width: '100%', height: 88, borderRadius: 12 }} /> : <Text fontSize="$8">{text(item.emoji, '•')}</Text>}
      <Text fontWeight="900">{title(item)}</Text>{detail(item) ? <Paragraph size="$2" color="$color10">{detail(item)}</Paragraph> : null}
    </Card>;
  })}</XStack></Shell>;
}

function Feed({ component, navigate }: Props) {
  return <Shell component={component}>{rows(component.props?.items).map((item, index) =>
    <Button key={String(item.id ?? index)} chromeless height="auto" onPress={() => void executeWidgetAction(item, component, navigate)} disabled={Boolean(item.disabled)} style={{ paddingVertical: 12 }}>
      <XStack flex={1} gap="$3" style={{ alignItems: 'center' }}><Text fontSize="$7">{text(item.emoji, text(item.icon, '•'))}</Text><YStack flex={1}><Text fontWeight="900">{title(item)}</Text>{detail(item) ? <Paragraph size="$2" color="$color10">{detail(item)}</Paragraph> : null}</YStack>{(rowTarget(item) || rowUrl(item)) ? <ChevronRight size={14} /> : null}</XStack>
    </Button>)}</Shell>;
}

function Post({ component, navigate }: Props) {
  const p = component.props ?? {};
  const image = text(p.imageUrl, text(p.image));
  const action = resolveWidgetAction(p, component);
  return <Shell component={component}>{image ? <Image source={{ uri: image }} style={{ width: '100%', height: 180, borderRadius: 14 }} resizeMode="cover" /> : null}{p.badge ? <Text style={{ alignSelf: 'flex-start', backgroundColor: '#FFF1B8', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }} fontWeight="900">{text(p.badge)}</Text> : null}{p.body ? <Paragraph>{text(p.body)}</Paragraph> : null}{(action.target || action.url) ? <Button icon={ExternalLink} style={{ alignSelf: 'flex-start' }} onPress={() => void executeWidgetAction(p, component, navigate)}>{text(p.cta, 'Open')}</Button> : null}</Shell>;
}

function NavigationPanel({ component, navigate }: Props) {
  const options = rows(component.props?.items ?? component.props?.actions ?? component.props?.routes);
  return <Shell component={component}><YStack gap="$2">{options.map((item, index) => {
    const action = resolveWidgetAction(item, component);
    const label = title(item);
    return <Button key={String(item.id ?? index)} chromeless onPress={() => void executeWidgetAction(item, component, navigate)} disabled={Boolean(item.disabled)}>
      <XStack style={{ width: '100%', justifyContent: 'space-between' }}><Text fontWeight="900">{label}</Text>{action.target || action.url ? <ChevronRight /> : null}</XStack>
    </Button>;
  })}</YStack></Shell>;
}

function ActionOverlay({ component, navigate }: Props) {
  const actions = rows(component.props?.items ?? component.props?.actions);
  return <Shell component={component}><YStack gap="$2">{text(component.props?.message) ? <Paragraph>{text(component.props?.message)}</Paragraph> : null}{actions.map((item, index) =>
    <Button key={String(item.id ?? index)} size="$3" onPress={() => void executeWidgetAction(item, component, navigate)} disabled={Boolean(item.disabled)}>{title(item)}</Button>
  )}</YStack></Shell>;
}

function MetricDisplay({ component }: Props) {
  const values = rows(component.props?.items ?? component.props?.metrics);
  return <Shell component={component}><XStack flexWrap="wrap" gap="$2">{values.map((item, index) => <Card key={String(item.id ?? index)} padding="$3" borderRadius="$4" width="48%"><YStack><Text color="$color10">{text(item.label, text(item.title))}</Text><H2>{text(item.value, '0')}</H2>{text(item.delta) ? <Text color="$color10">{text(item.delta)}</Text> : null}</YStack></Card>)}</XStack></Shell>;
}

function Calendar({ component, navigate }: Props) {
  return <Shell component={component}>{rows(component.props?.events ?? component.props?.items).map((item, index) =>
    <Button key={String(item.id ?? index)} chromeless onPress={() => void executeWidgetAction(item, component, navigate)} disabled={Boolean(item.disabled)}><XStack flex={1} gap="$3"><Text width={72} color="$green10" fontWeight="900">{text(item.time, text(item.date))}</Text><YStack flex={1}><Text fontWeight="900">{title(item)}</Text>{detail(item) ? <Paragraph size="$2" color="$color10">{detail(item)}</Paragraph> : null}</YStack></XStack></Button>)} </Shell>;
}

function Poll({ component }: Props) {
  const options = rows(component.props?.options ?? component.props?.items);
  const [choice, setChoice] = useState('');
  return <Shell component={component}>{options.map((item) => {
    const id = text(item.id, title(item));
    const value = Number(item.value ?? item.votes ?? 0);
    return <Button key={id} theme={choice === id ? 'green' : undefined} onPress={() => setChoice(id)}><XStack flex={1} style={{ justifyContent: 'space-between' }}><Text>{title(item)}</Text>{value ? <Text>{value}</Text> : null}</XStack></Button>;
  })}</Shell>;
}

function ChartList({ component }: Props) {
  const items = rows(component.props?.items ?? component.props?.points);
  const data = items.map((item, index) => ({ x: title(item) || String(index + 1), y: Number(item.value ?? 0) }));
  return <Shell component={component}><YStack height={180}><ChartVisualization data={data} type={component.props?.type} /></YStack></Shell>;
}

function Permission({ component }: Props) {
  return <Shell component={component}>{rows(component.props?.permissions ?? component.props?.items).map((item, index) =>
    <YStack key={String(item.id ?? index)} style={{ padding: 12, borderRadius: 8, backgroundColor: '#F6F1E8' }}><XStack style={{ justifyContent: 'space-between' }}><Text fontWeight="900">{title(item)}</Text><Text color="$green10" fontWeight="800">{text(item.status, text(item.required, 'optional'))}</Text></XStack>{text(item.prompt, detail(item)) ? <Paragraph size="$2" color="$color10">{text(item.prompt, detail(item))}</Paragraph> : null}</YStack>)}</Shell>;
}

function Provider({ component, navigate }: Props) {
  const p = component.props ?? {};
  return <Shell component={component}>{p.status ? <Text color="$green10" fontWeight="900">{text(p.status)}</Text> : null}{p.body ? <Paragraph>{text(p.body)}</Paragraph> : null}<Feed component={{ ...component, title: undefined, subtitle: undefined, props: { items: p.homes ?? p.steps ?? p.actions } }} navigate={navigate} /></Shell>;
}

function Catalog({ component }: Props) {
  const labels = rows(component.props?.items).map(title);
  const fallback = Array.isArray(component.props?.widgets) ? component.props.widgets.map(String) : [];
  return <Shell component={component}><XStack flexWrap="wrap" gap="$2">{[...labels, ...fallback].filter(Boolean).map((item) => <Text key={item} style={{ backgroundColor: '#EFE6ED', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 }} fontWeight="700">{item}</Text>)}</XStack></Shell>;
}

function Menu({ component, navigate }: Props) {
  return <Shell component={component}><XStack flexWrap="wrap" gap="$2">{rows(component.props?.items ?? component.props?.actions).map((item, index) =>
    <Button key={String(item.id ?? index)} disabled={Boolean(item.disabled)} onPress={() => void executeWidgetAction(item, component, navigate)}>
      <Text>{title(item)}</Text>
    </Button>)}</XStack></Shell>;
}

function ProgressStatus({ component }: Props) {
  const value = Math.max(0, Math.min(100, Number(component.props?.value ?? 0)));
  return <Shell component={component}><Progress value={value}><Progress.Indicator /></Progress><Text fontWeight="900">{value}%</Text></Shell>;
}

function StatusDisplay({ component, navigate }: Props) {
  const theme = usePackageTheme();
  return <Shell component={component}><YStack gap="$2">{rows(component.props?.items).map((item, index) => {
    const itemStatus = text(item.status, text(item.state, 'neutral'));
    const value = text(item.value, itemStatus);
    return <Button key={String(item.id ?? index)} chromeless onPress={() => void executeWidgetAction(item, component, navigate)}>
      <XStack justify="space-between"><Text fontWeight="800">{title(item)}</Text><Text style={{ color: themeStatusColor(itemStatus, theme) }}>{value}</Text></XStack>
    </Button>;
  })}</YStack></Shell>;
}

function Empty({ component, navigate }: Props) {
  const p = component.props ?? {};
  const action = resolveWidgetAction(p, component);
  return <Shell component={component}><YStack gap="$2" style={{ alignItems: 'center' }}><Text fontSize="$9">{text(p.emoji, '✨')}</Text>{text(p.message) ? <Paragraph style={{ textAlign: 'center' }}>{text(p.message)}</Paragraph> : null}{(action.target || action.url) ? <Button onPress={() => void executeWidgetAction(p, component, navigate)}>{text(p.cta, 'Open')}</Button> : null}</YStack></Shell>;
}

const renderers = {
  galleryGrid: Gallery,
  feedList: Feed,
  postCard: Post,
  mediaBlock: Post,
  calendarBlock: Calendar,
  pollCard: Poll,
  chartBlock: ChartList,
  permissionCard: Permission,
  providerStatus: Provider,
  widgetCatalog: Catalog,
  navigationPanel: NavigationPanel,
  actionOverlay: ActionOverlay,
  statusDisplay: StatusDisplay,
  metricDisplay: MetricDisplay,
  menuStrip: Menu,
  segmentedControl: Menu,
  progressStatus: ProgressStatus,
  statusBanner: StatusDisplay,
  emptyState: Empty,
} as const;

export const standardWidgets = new Set([...Object.keys(renderers), ...Object.keys(widgetAliases)]);
export function StandardWidget(props: Props) {
  const Renderer = renderers[normalizeWidgetKind(props.component.widget) as keyof typeof renderers] ?? Feed;
  return <Renderer {...props} />;
}
