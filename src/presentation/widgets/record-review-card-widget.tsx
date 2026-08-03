import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  RecordReviewCardAction,
  RecordReviewCardItem,
  RecordReviewCardProps,
} from '@/packages/shared/contracts/ui-widgets';
import {
  detail,
  label,
  openWidgetTarget,
  rows,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';

type ReviewProps = WidgetProps & RecordReviewCardProps;

export function RecordReviewCardWidget({ element }: ComponentRenderProps<ReviewProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items) as RecordReviewCardItem[];
  const actions = rows(props.actions) as RecordReviewCardAction[];
  const title = text(props.title, 'Review items');
  const subtitle = text(props.subtitle, 'Check the items before applying the change.');

  return (
    <View accessibilityLabel={[title, subtitle, text(props.badge)].filter(Boolean).join(', ')} style={styles.surface}>
      <View style={styles.header}>
        <Text style={styles.icon}>{text(props.emoji, '✓')}</Text>
        <View style={styles.heading}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {props.badge ? <Text style={styles.badge}>{text(props.badge)}</Text> : null}
      </View>

      {items.length ? items.slice(0, 8).map((item, index) => (
        <View accessibilityLabel={[label(item), detail(item), text(item.status)].filter(Boolean).join(', ')} key={`${label(item)}-${index}`} style={styles.item}>
          <View style={styles.itemCopy}>
            <Text numberOfLines={2} style={styles.itemTitle}>{label(item)}</Text>
            {detail(item) ? <Text numberOfLines={2} style={styles.itemDetail}>{detail(item)}</Text> : null}
          </View>
          <Text style={styles.itemStatus}>{text(item.status, 'pending')}</Text>
        </View>
      )) : (
        <Text style={styles.empty}>Nothing is waiting for review.</Text>
      )}

      {actions.length ? (
        <View style={styles.actions}>
          {actions.slice(0, 3).map((action, index) => (
            <Pressable
              accessibilityRole="button"
              key={`${label(action)}-${index}`}
              onPress={() => openWidgetTarget(router, action)}
              style={[styles.action, index === 0 ? styles.primaryAction : null]}
            >
              <Text style={[styles.actionText, index === 0 ? styles.primaryActionText : null]}>{label(action)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { backgroundColor: '#F7FAF4', borderColor: '#D5E0D7', borderRadius: 20, borderWidth: 1, gap: 10, padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  icon: { alignItems: 'center', backgroundColor: '#E8F0EA', borderRadius: 14, color: '#246B45', fontSize: 22, height: 44, lineHeight: 44, textAlign: 'center', width: 44 },
  heading: { flex: 1, gap: 2 },
  title: { color: '#17251C', fontSize: 18, fontWeight: '800' },
  subtitle: { color: '#607066', fontSize: 13, lineHeight: 18 },
  badge: { backgroundColor: '#E8F0EA', borderRadius: 999, color: '#246B45', fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  item: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  itemCopy: { flex: 1, gap: 2 },
  itemTitle: { color: '#17251C', fontSize: 14, fontWeight: '700' },
  itemDetail: { color: '#607066', fontSize: 12, lineHeight: 16 },
  itemStatus: { color: '#246B45', fontSize: 11, fontWeight: '800' },
  empty: { color: '#607066', fontSize: 13, paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 2 },
  action: { alignItems: 'center', borderColor: '#BFD0C3', borderRadius: 10, borderWidth: 1, flex: 1, minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  primaryAction: { backgroundColor: '#246B45', borderColor: '#246B45' },
  actionText: { color: '#246B45', fontSize: 13, fontWeight: '800' },
  primaryActionText: { color: '#FFFFFF' },
});
