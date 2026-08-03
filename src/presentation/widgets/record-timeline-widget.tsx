import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  actionRoute,
  actionUrl,
  detail,
  label,
  openWidgetTarget,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import { recordTimelineItems, recordTimelineMarker } from '@/src/presentation/widgets/record-timeline-config';

export { recordTimelineItems, recordTimelineMarker } from '@/src/presentation/widgets/record-timeline-config';

export function RecordTimelineWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = recordTimelineItems(props);
  const fallbackItems = [{ title: 'No activity yet', subtitle: 'Add a record to begin.' }];

  return (
    <View style={styles.surface}>
      <Text style={styles.title}>{text(props.title, 'Activity')}</Text>
      {text(props.subtitle) ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
      {(items.length ? items : fallbackItems).slice(0, 12).map((item, index) => {
        const actionable = Boolean(actionRoute(item) || actionUrl(item));
        const content = (
          <>
            <Text style={styles.marker}>{recordTimelineMarker(item)}</Text>
            <View style={styles.copy}>
              <Text numberOfLines={2} style={styles.itemTitle}>{label(item)}</Text>
              {detail(item) ? <Text numberOfLines={3} style={styles.itemDetail}>{detail(item)}</Text> : null}
            </View>
            {actionable ? <Text style={styles.chevron}>›</Text> : null}
          </>
        );

        return actionable ? (
          <Pressable
            accessibilityLabel={[label(item), detail(item), recordTimelineMarker(item)].filter(Boolean).join(', ')}
            accessibilityRole="button"
            key={`${label(item)}-${index}`}
            onPress={() => openWidgetTarget(router, item)}
            style={styles.row}
          >
            {content}
          </Pressable>
        ) : (
          <View accessibilityLabel={[label(item), detail(item), recordTimelineMarker(item)].filter(Boolean).join(', ')} key={`${label(item)}-${index}`} style={styles.row}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { gap: 10 },
  title: { color: '#241C16', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  row: { alignItems: 'center', backgroundColor: '#F6F1E8', borderRadius: 16, flexDirection: 'row', gap: 12, minHeight: 68, padding: 12 },
  marker: { backgroundColor: '#E4F1E8', borderRadius: 14, color: '#2F7448', fontSize: 11, fontWeight: '900', minWidth: 58, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 8, textAlign: 'center' },
  copy: { flex: 1, gap: 3 },
  itemTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  itemDetail: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  chevron: { color: '#B8AB9A', fontSize: 28, fontWeight: '300' },
});
