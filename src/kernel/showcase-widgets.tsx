import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AppComponent } from './schema';

type Row = Record<string, unknown>;
type Props = { component: AppComponent; navigate(target: string): void };
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === 'object') : [];
const title = (row: Row) => text(row.title, text(row.label, text(row.name)));
const detail = (row: Row) => text(row.subtitle, text(row.detail, text(row.body)));

function Actions({ items, navigate }: { items: Row[]; navigate(target: string): void }) {
  return <View style={s.actions}>{items.slice(0, 3).map((item, index) =>
    <Pressable key={title(item)} style={[s.action, index === 0 && s.actionPrimary]} onPress={() => navigate(text(item.route, text(item.url)))}>
      <Text style={[s.actionText, index === 0 && s.actionPrimaryText]}>{title(item)}</Text>
    </Pressable>)}</View>;
}

function Hero({ component, navigate }: Props) {
  const p = component.props ?? {};
  const stats = rows(p.stats);
  return <View style={s.hero}>
    {p.emoji ? <Text style={s.heroEmoji}>{text(p.emoji)}</Text> : null}
    {p.badge ? <Text style={s.badge}>{text(p.badge)}</Text> : null}
    <Text style={s.heroTitle}>{component.title ?? text(p.title)}</Text>
    {component.subtitle ?? p.subtitle ? <Text style={s.heroSubtitle}>{component.subtitle ?? text(p.subtitle)}</Text> : null}
    {stats.length ? <View style={s.stats}>{stats.slice(0, 3).map((item) => <View key={title(item)} style={s.stat}><Text style={s.statValue}>{text(item.value)}</Text><Text style={s.statLabel}>{title(item)}</Text></View>)}</View> : null}
    {p.body ? <Text style={s.body}>{text(p.body)}</Text> : null}
    <Actions items={rows(p.actions)} navigate={navigate} />
  </View>;
}

function Carousel({ component, navigate }: Props) {
  const p = component.props ?? {};
  const items = rows(p.items);
  return <View style={s.section}><View style={s.sectionHead}><Text style={s.sectionTitle}>{component.title ?? text(p.title)}</Text>{p.cta ? <Pressable onPress={() => navigate(text(p.ctaRoute))}><Text style={s.cta}>{text(p.cta)}</Text></Pressable> : null}</View>
    {component.subtitle ?? p.subtitle ? <Text style={s.sectionSubtitle}>{component.subtitle ?? text(p.subtitle)}</Text> : null}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>{items.slice(0, 8).map((item, index) =>
      <Pressable key={title(item)} style={[s.useCard, index % 3 === 1 && s.useBlue, index % 3 === 2 && s.useYellow]} onPress={() => navigate(text(item.route))}>
        {item.emoji ? <Text style={s.useEmoji}>{text(item.emoji)}</Text> : null}{item.badge ? <Text style={s.useBadge}>{text(item.badge)}</Text> : null}<Text style={s.useTitle}>{title(item)}</Text><Text style={s.useDetail}>{detail(item)}</Text>
      </Pressable>)}</ScrollView>
  </View>;
}

function Timeline({ component, navigate }: Props) {
  const p = component.props ?? {};
  return <View style={s.card}><Text style={s.sectionTitle}>{component.title ?? text(p.title)}</Text>{rows(p.items).slice(0, 6).map((item) =>
    <Pressable key={title(item)} style={s.timelineRow} onPress={() => navigate(text(item.route))}><Text style={s.time}>{text(item.time, text(item.badge, 'Now'))}</Text><View style={s.copy}><Text style={s.rowTitle}>{title(item)}</Text><Text style={s.rowDetail}>{detail(item)}</Text></View><Text style={s.chevron}>›</Text></Pressable>)}</View>;
}

function Feature({ component, navigate }: Props) {
  const p = component.props ?? {};
  return <Pressable style={s.recipe} onPress={() => navigate(text(p.route, text(p.url)))}>
    {p.emoji ? <View style={s.recipeArt}><Text style={s.recipeEmoji}>{text(p.emoji)}</Text></View> : null}
    <View style={s.copy}>{p.badge ? <Text style={s.recipeBadge}>{text(p.badge)}</Text> : null}<Text style={s.recipeTitle}>{component.title ?? text(p.title)}</Text><Text style={s.recipeDetail}>{component.subtitle ?? text(p.subtitle, text(p.body))}</Text><View style={s.chips}>{rows(p.chips).slice(0, 4).map((item) => <Text key={title(item)} style={s.chip}>{title(item)}</Text>)}</View></View>
  </Pressable>;
}

function Review({ component, navigate }: Props) {
  const p = component.props ?? {};
  return <View style={s.receipt}><View style={s.receiptHead}>{p.emoji ? <Text style={s.receiptIcon}>{text(p.emoji)}</Text> : null}<View style={s.copy}><Text style={s.receiptTitle}>{component.title ?? text(p.title)}</Text><Text style={s.rowDetail}>{component.subtitle ?? text(p.subtitle)}</Text></View>{p.badge ? <Text style={s.useBadge}>{text(p.badge)}</Text> : null}</View>
    {rows(p.items).slice(0, 5).map((item) => <View key={title(item)} style={s.receiptLine}><Text style={s.receiptLineTitle}>{title(item)}</Text><Text style={s.receiptLineDetail}>{detail(item)}</Text><Text style={s.receiptStatus}>{text(item.status)}</Text></View>)}
    <Actions items={rows(p.actions)} navigate={navigate} />
  </View>;
}

function Grid({ component, navigate }: Props) {
  const p = component.props ?? {};
  return <View style={s.card}><Text style={s.sectionTitle}>{component.title ?? text(p.title)}</Text><View style={s.grid}>{rows(p.items).slice(0, 6).map((item) =>
    <Pressable key={title(item)} style={s.tile} onPress={() => navigate(text(item.route))}>{item.emoji ? <Text style={s.tileEmoji}>{text(item.emoji)}</Text> : null}<Text style={s.useTitle}>{title(item)}</Text><Text style={s.useDetail}>{detail(item)}</Text></Pressable>)}</View></View>;
}

export function ShowcaseWidget(props: Props) {
  const widget = props.component.widget as string;
  if (widget === 'showcaseHero') return <Hero {...props} />;
  if (widget === 'cardCarousel') return <Carousel {...props} />;
  if (widget === 'eventTimeline') return <Timeline {...props} />;
  if (widget === 'featureCard') return <Feature {...props} />;
  if (widget === 'reviewCard') return <Review {...props} />;
  if (widget === 'tileGrid') return <Grid {...props} />;
  if (widget === 'foodHero') return <Hero {...props} />;
  if (widget === 'useFirstCarousel') return <Carousel {...props} />;
  if (widget === 'mealTimeline') return <Timeline {...props} />;
  if (widget === 'recipeCard') return <Feature {...props} />;
  if (widget === 'receiptReviewCard') return <Review {...props} />;
  if (widget === 'pantryShelf') return <Grid {...props} />;
  return <Grid {...props} />;
}

export const showcaseWidgets = new Set(['showcaseHero', 'cardCarousel', 'eventTimeline', 'featureCard', 'reviewCard', 'tileGrid', 'foodHero', 'useFirstCarousel', 'mealTimeline', 'recipeCard', 'receiptReviewCard', 'pantryShelf']);

const s = StyleSheet.create({
  hero: { backgroundColor: '#E4F1E8', borderRadius: 32, padding: 22, gap: 14, overflow: 'hidden', shadowColor: '#2F7448', shadowOpacity: .12, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  heroEmoji: { position: 'absolute', right: 20, top: 18, width: 74, height: 74, borderRadius: 26, backgroundColor: '#FFFCF5', textAlign: 'center', lineHeight: 74, fontSize: 38, overflow: 'hidden' },
  badge: { alignSelf: 'flex-start', backgroundColor: '#FFF1B8', borderRadius: 999, color: '#9A4B2E', fontSize: 12, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  heroTitle: { color: '#142016', fontSize: 30, lineHeight: 34, fontWeight: '900', maxWidth: '76%' }, heroSubtitle: { color: '#536557', fontSize: 15, lineHeight: 21, fontWeight: '700', maxWidth: '82%' },
  stats: { flexDirection: 'row', gap: 8 }, stat: { flex: 1, backgroundColor: 'rgba(255,252,245,.72)', borderRadius: 18, padding: 10, gap: 2 }, statValue: { color: '#142016', fontSize: 18, fontWeight: '900' }, statLabel: { color: '#6D6257', fontSize: 11, fontWeight: '800' }, body: { color: '#26372A', fontSize: 16, lineHeight: 23 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { backgroundColor: 'rgba(36,28,22,.08)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 }, actionPrimary: { backgroundColor: '#241C16' }, actionText: { color: '#241C16', fontSize: 13, fontWeight: '900' }, actionPrimaryText: { color: '#fff' },
  section: { gap: 10 }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { color: '#182019', fontSize: 24, fontWeight: '900' }, sectionSubtitle: { color: '#657066', fontSize: 14, lineHeight: 20 }, cta: { color: '#2F7448', fontSize: 13, fontWeight: '900' }, rail: { gap: 12, paddingRight: 18 },
  useCard: { width: 144, minHeight: 152, borderRadius: 22, backgroundColor: '#F9E7D9', padding: 13, gap: 6, justifyContent: 'space-between' }, useBlue: { backgroundColor: '#E3EFF3' }, useYellow: { backgroundColor: '#FFF1B8' }, useEmoji: { fontSize: 28 }, useBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,252,245,.78)', borderRadius: 999, color: '#9A4B2E', fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' }, useTitle: { color: '#241C16', fontSize: 16, fontWeight: '900', lineHeight: 20 }, useDetail: { color: '#6D6257', fontSize: 12, lineHeight: 16 },
  card: { backgroundColor: '#FFFCF5', borderRadius: 28, padding: 18, gap: 12, shadowColor: '#271D14', shadowOpacity: .05, shadowRadius: 12, elevation: 2 }, timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, backgroundColor: '#F6F1E8', padding: 12 }, time: { width: 58, minHeight: 48, borderRadius: 18, backgroundColor: '#E4F1E8', color: '#2F7448', textAlign: 'center', lineHeight: 48, fontSize: 11, fontWeight: '900', overflow: 'hidden' }, copy: { flex: 1, gap: 3 }, rowTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' }, rowDetail: { color: '#6D6257', fontSize: 13, lineHeight: 18 }, chevron: { color: '#B8AB9A', fontSize: 30 },
  recipe: { flexDirection: 'row', gap: 14, borderRadius: 30, backgroundColor: '#241C16', padding: 16, shadowColor: '#241C16', shadowOpacity: .16, shadowRadius: 16, elevation: 4 }, recipeArt: { width: 102, borderRadius: 24, backgroundColor: '#FFF1B8', alignItems: 'center', justifyContent: 'center' }, recipeEmoji: { fontSize: 48 }, recipeBadge: { alignSelf: 'flex-start', color: '#F3B15E', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }, recipeTitle: { color: '#fff', fontSize: 22, lineHeight: 26, fontWeight: '900' }, recipeDetail: { color: '#DCD2C3', fontSize: 13, lineHeight: 18 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { backgroundColor: 'rgba(255,255,255,.12)', borderRadius: 999, color: '#fff', fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden' },
  receipt: { backgroundColor: '#FFF5EA', borderRadius: 30, padding: 18, gap: 12, borderWidth: 1, borderColor: '#F2D6BE' }, receiptHead: { flexDirection: 'row', alignItems: 'center', gap: 12 }, receiptIcon: { width: 48, height: 48, borderRadius: 18, backgroundColor: '#FFFCF5', textAlign: 'center', lineHeight: 48, fontSize: 25, overflow: 'hidden' }, receiptTitle: { color: '#241C16', fontSize: 21, fontWeight: '900' }, receiptLine: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFCF5', borderRadius: 16, padding: 11 }, receiptLineTitle: { flex: .8, color: '#241C16', fontSize: 14, fontWeight: '900' }, receiptLineDetail: { flex: 1.2, color: '#6D6257', fontSize: 12 }, receiptStatus: { color: '#2F7448', fontSize: 11, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, tile: { width: '47%', minHeight: 118, borderRadius: 22, backgroundColor: '#F6F1E8', padding: 14, gap: 6 }, tileEmoji: { fontSize: 28 },
});
