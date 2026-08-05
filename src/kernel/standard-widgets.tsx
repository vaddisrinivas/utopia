import { ExternalLink } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Linking } from 'react-native';
import { Button, Card, H2, Paragraph, Text, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';
import { ChartVisualization } from './chart-visualization';
import { usePackageTheme } from './theme';

type Row = Record<string, unknown>;
type Props = { component: AppComponent; navigate(target: string): void };
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === 'object') : [];
const title = (row: Row) => text(row.title, text(row.label, text(row.name)));
const detail = (row: Row) => text(row.subtitle, text(row.detail, text(row.body)));

function open(item: Row, navigate: Props['navigate']) {
  const target = text(item.route, text(item.url));
  if (target.startsWith('/')) navigate(target);
  else if (/^https:\/\//.test(target)) void Linking.openURL(target);
}

function Shell({ component, children }: { component: AppComponent; children: React.ReactNode }) {
  const theme = usePackageTheme();
  return <Card gap="$3" style={{ padding: 16, borderWidth: 1, borderColor: `${theme.accent}33`, borderRadius: 8, backgroundColor: theme.surface }}>{component.title ? <H2 size="$6" style={{ color: theme.ink }}>{component.title}</H2> : null}{component.subtitle ? <Paragraph style={{ color: theme.muted }}>{component.subtitle}</Paragraph> : null}{children}</Card>;
}

function Gallery({ component, navigate }: Props) {
  const items = rows(component.props?.items);
  return <Shell component={component}><XStack flexWrap="wrap" gap="$3">{items.map((item, index) => {
    const image = text(item.imageUrl, text(item.image));
    return <Card key={String(item.id ?? index)} pressStyle={{ scale: .98 }} onPress={() => open(item, navigate)} width="47%" minHeight={132} padding="$3" gap="$2" borderRadius="$5" backgroundColor="#F6F1E8">
      {image ? <Image source={{ uri: image }} style={{ width: '100%', height: 88, borderRadius: 12 }} /> : <Text fontSize="$8">{text(item.emoji, '•')}</Text>}
      <Text fontWeight="900">{title(item)}</Text>{detail(item) ? <Paragraph size="$2" color="$color10">{detail(item)}</Paragraph> : null}
    </Card>;
  })}</XStack></Shell>;
}

function Feed({ component, navigate }: Props) {
  return <Shell component={component}>{rows(component.props?.items).map((item, index) =>
    <Button key={String(item.id ?? index)} chromeless height="auto" style={{ paddingVertical: 12 }} onPress={() => open(item, navigate)}>
      <XStack flex={1} gap="$3" style={{ alignItems: 'center' }}><Text fontSize="$7">{text(item.emoji, text(item.icon, '•'))}</Text><YStack flex={1}><Text fontWeight="900">{title(item)}</Text><Paragraph size="$2" color="$color10">{detail(item)}</Paragraph></YStack><Text color="$color9">›</Text></XStack>
    </Button>)}</Shell>;
}

function Post({ component, navigate }: Props) {
  const p = component.props ?? {};
  const image = text(p.imageUrl, text(p.image));
  return <Shell component={component}>{image ? <Image source={{ uri: image }} style={{ width: '100%', height: 180, borderRadius: 14 }} resizeMode="cover" /> : null}{p.badge ? <Text style={{ alignSelf: 'flex-start', backgroundColor: '#FFF1B8', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }} fontWeight="900">{text(p.badge)}</Text> : null}<Paragraph>{text(p.body)}</Paragraph>{p.url || p.route ? <Button icon={ExternalLink} style={{ alignSelf: 'flex-start' }} onPress={() => open(p, navigate)}>{text(p.cta, 'Open')}</Button> : null}</Shell>;
}

function Calendar({ component, navigate }: Props) {
  return <Shell component={component}>{rows(component.props?.events ?? component.props?.items).map((item, index) =>
    <Button key={String(item.id ?? index)} chromeless onPress={() => open(item, navigate)}><XStack flex={1} gap="$3"><Text width={72} color="$green10" fontWeight="900">{text(item.time, text(item.date))}</Text><YStack flex={1}><Text fontWeight="900">{title(item)}</Text><Paragraph size="$2" color="$color10">{detail(item)}</Paragraph></YStack></XStack></Button>)}</Shell>;
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
  return <Shell component={component}><YStack height={180}><ChartVisualization data={data} type={component.props?.type} /></YStack><XStack style={{ justifyContent: 'space-around' }}>{items.map((item, index) => <Text key={index} color="$color10">{title(item)}</Text>)}</XStack></Shell>;
}

function Permission({ component }: Props) {
  return <Shell component={component}>{rows(component.props?.permissions ?? component.props?.items).map((item, index) =>
    <YStack key={String(item.id ?? index)} style={{ padding: 12, borderRadius: 16, backgroundColor: '#F6F1E8' }}><XStack style={{ justifyContent: 'space-between' }}><Text fontWeight="900">{title(item)}</Text><Text color="$green10" fontWeight="800">{text(item.status, text(item.required, 'optional'))}</Text></XStack><Paragraph size="$2" color="$color10">{text(item.prompt, detail(item))}</Paragraph></YStack>)}</Shell>;
}

function Provider({ component, navigate }: Props) {
  const p = component.props ?? {};
  return <Shell component={component}>{p.status || p.body ? <YStack gap="$2"><Text color="#2F7448" style={{ alignSelf: 'flex-start', backgroundColor: '#E4F1E8', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 }} fontWeight="900">{text(p.status, 'Ready')}</Text><Paragraph>{text(p.body)}</Paragraph></YStack> : null}<Feed component={{ ...component, title: undefined, subtitle: undefined, props: { items: p.homes ?? p.steps ?? p.actions } }} navigate={navigate} /></Shell>;
}

function Catalog({ component }: Props) {
  const labels = rows(component.props?.items).map(title);
  const fallback = Array.isArray(component.props?.widgets) ? component.props.widgets.map(String) : [];
  return <Shell component={component}><XStack flexWrap="wrap" gap="$2">{[...labels, ...fallback].map((item) => <Text key={item} style={{ backgroundColor: '#EFE6ED', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 }} fontWeight="700">{item}</Text>)}</XStack></Shell>;
}

export const standardWidgets = new Set(['postCard', 'feedList', 'calendarBlock', 'mediaBlock', 'galleryGrid', 'pollCard', 'chartBlock', 'permissionCard', 'providerStatus', 'widgetCatalog']);
const legacyToStandardWidgets = new Set([
  'foodHero',
  'useFirstCarousel',
  'mealTimeline',
  'recipeCard',
  'receiptReviewCard',
  'pantryShelf',
]);
for (const legacy of legacyToStandardWidgets) standardWidgets.add(legacy);

export function StandardWidget(props: Props) {
  const widget = props.component.widget as string;
  switch (widget) {
    case 'galleryGrid': return <Gallery {...props} />;
    case 'feedList': return <Feed {...props} />;
    case 'postCard': case 'mediaBlock': return <Post {...props} />;
    case 'calendarBlock': return <Calendar {...props} />;
    case 'pollCard': return <Poll {...props} />;
    case 'chartBlock': return <ChartList {...props} />;
    case 'permissionCard': return <Permission {...props} />;
    case 'providerStatus': return <Provider {...props} />;
    case 'widgetCatalog': return <Catalog {...props} />;
    case 'foodHero': return <Post {...props} />;
    case 'recipeCard': return <Post {...props} />;
    case 'receiptReviewCard': return <Permission {...props} />;
    case 'mealTimeline': return <Calendar {...props} />;
    case 'useFirstCarousel': return <Gallery {...props} />;
    case 'pantryShelf': return <Catalog {...props} />;
    default: return <Feed {...props} />;
  }
}
