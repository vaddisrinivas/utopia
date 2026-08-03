import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  actionRoute,
  actionUrl,
  detail,
  label,
  openWidgetTarget,
  text,
  visualGlyph,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import {
  horizontalRecordCarouselItems,
  type HorizontalRecordCarouselItem,
} from '@/src/presentation/widgets/horizontal-record-carousel-config';

export { horizontalRecordCarouselItems, type HorizontalRecordCarouselItem } from '@/src/presentation/widgets/horizontal-record-carousel-config';

export function HorizontalRecordCarouselWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = horizontalRecordCarouselItems(props);
  const fallbackItems: HorizontalRecordCarouselItem[] = [{
    title: text(props.emptyTitle, 'No records yet'),
    subtitle: text(props.emptyCopy, 'Add a record to begin.'),
    icon: '•',
  }];
  const visibleItems = (items.length ? items : fallbackItems).slice(0, 12);

  return (
    <View style={styles.surface}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.title}>{text(props.title, 'Records')}</Text>
          {text(props.subtitle) ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
        </View>
        {text(props.ctaRoute) ? (
          <Pressable accessibilityRole="button" onPress={() => openWidgetTarget(router, { route: props.ctaRoute, label: props.cta })}>
            <Text style={styles.cta}>{text(props.cta, 'Open')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        accessibilityLabel={text(props.title, 'Records')}
        contentContainerStyle={styles.rail}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {visibleItems.map((item, index) => {
          const actionable = Boolean(actionRoute(item) || actionUrl(item));
          return (
            <Pressable
              accessibilityLabel={[label(item), detail(item)].filter(Boolean).join(', ')}
              accessibilityRole={actionable ? 'button' : undefined}
              disabled={!actionable}
              key={`${label(item)}-${index}`}
              onPress={() => openWidgetTarget(router, item)}
              style={[styles.card, index % 3 === 1 ? styles.cardAlt : index % 3 === 2 ? styles.cardWarm : null, !actionable ? styles.cardStatic : null]}
            >
              <View style={styles.cardTopline}>
                <Text style={styles.icon}>{visualGlyph(item.icon, visualGlyph(item.emoji))}</Text>
                {text(item.badge, text(item.status)) ? <Text style={styles.badge}>{text(item.badge, text(item.status))}</Text> : null}
              </View>
              <Text numberOfLines={2} style={styles.cardTitle}>{label(item)}</Text>
              {detail(item) ? <Text numberOfLines={3} style={styles.cardDetail}>{detail(item)}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { gap: 10 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  copy: { flex: 1, gap: 2 },
  title: { color: '#241C16', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  cta: { color: '#2F7448', fontSize: 13, fontWeight: '900', paddingVertical: 2 },
  rail: { gap: 10, paddingBottom: 3, paddingRight: 8 },
  card: { backgroundColor: '#F6F1E8', borderRadius: 12, gap: 7, minHeight: 132, padding: 14, width: 178 },
  cardAlt: { backgroundColor: '#E7F0F1' },
  cardWarm: { backgroundColor: '#F8E9D8' },
  cardStatic: { opacity: 0.76 },
  cardTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  icon: { fontSize: 26 },
  badge: { color: '#62584E', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  cardTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  cardDetail: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
});
