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
  visualGlyph,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import { groupedRecordShelfGroups, type GroupedRecordShelfGroup } from '@/src/presentation/widgets/grouped-record-shelf-config';

export { groupedRecordShelfGroups, type GroupedRecordShelfGroup } from '@/src/presentation/widgets/grouped-record-shelf-config';

export function GroupedRecordShelfWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const groups = groupedRecordShelfGroups(props);
  const columns = Math.max(1, Math.min(2, Math.floor(Number(props.gridColumns) || 2)));
  const fallbackGroups: GroupedRecordShelfGroup[] = [{
    title: '',
    subtitle: '',
    action: null,
    items: [{ title: 'No records yet', subtitle: 'Add or import a record to begin.', emoji: '•' }],
  }];

  return (
    <View style={styles.surface}>
      <Text style={styles.title}>{text(props.title, 'Records')}</Text>
      {text(props.subtitle) ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
      {(groups.length ? groups : fallbackGroups).map((group, groupIndex) => (
        <View key={`${group.title}-${groupIndex}`} style={styles.group}>
          {group.title ? (
            <View style={styles.groupHeader}>
              <View style={styles.groupCopy}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                {group.subtitle ? <Text style={styles.groupSubtitle}>{group.subtitle}</Text> : null}
              </View>
              {group.action ? (
                <Pressable
                  accessibilityLabel={`Open ${group.title}`}
                  accessibilityRole="button"
                  onPress={() => openWidgetTarget(router, group.action!)}
                >
                  <Text style={styles.groupAction}>{text(group.action.label, 'Open')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={[styles.grid, columns === 1 ? styles.oneColumn : null]}>
            {group.items.map((item, itemIndex) => {
              const isActionable = Boolean(actionRoute(item) || actionUrl(item));
              return (
                <Pressable
                  accessibilityLabel={[label(item), detail(item)].filter(Boolean).join(', ')}
                  accessibilityRole={isActionable ? 'button' : undefined}
                  disabled={!isActionable}
                  key={`${label(item)}-${itemIndex}`}
                  onPress={() => openWidgetTarget(router, item)}
                  style={[styles.tile, columns === 1 ? styles.tileOneColumn : null, !isActionable ? styles.tileStatic : null]}
                >
                  <View style={styles.tileTopline}>
                    <Text style={styles.icon}>{visualGlyph(item.emoji, visualGlyph(item.icon))}</Text>
                    {text(item.badge, text(item.status)) ? <Text style={styles.badge}>{text(item.badge, text(item.status))}</Text> : null}
                  </View>
                  <Text numberOfLines={2} style={styles.itemTitle}>{label(item)}</Text>
                  {detail(item) ? <Text numberOfLines={3} style={styles.itemDetail}>{detail(item)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { gap: 12 },
  title: { color: '#241C16', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  group: { gap: 8 },
  groupHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  groupCopy: { flex: 1, gap: 2 },
  groupTitle: { color: '#3E332A', fontSize: 15, fontWeight: '900' },
  groupSubtitle: { color: '#756A5E', fontSize: 12, lineHeight: 17 },
  groupAction: { color: '#2F7448', fontSize: 13, fontWeight: '900', paddingVertical: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  oneColumn: { flexDirection: 'column' },
  tile: { backgroundColor: '#F6F1E8', borderRadius: 12, gap: 6, minHeight: 112, padding: 14, width: '48%' },
  tileOneColumn: { width: '100%' },
  tileStatic: { opacity: 0.76 },
  tileTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  icon: { fontSize: 26 },
  badge: { color: '#62584E', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  itemTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  itemDetail: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
});
