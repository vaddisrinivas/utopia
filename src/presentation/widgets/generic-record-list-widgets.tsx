import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DomainRecordViewModel } from '@/src/domain/renderer';
import type { ComponentRenderProps } from '@json-render/react-native';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

type SearchableRecordListWidgetProps = Pick<ComponentRenderProps<WidgetProps>, 'element'> & {
  onOpenRecord?: (recordId: string) => void;
  onOpenActionRoute?: (route: string) => void;
};

export function SearchableRecordListWidget({
  element,
  onOpenRecord,
  onOpenActionRoute,
}: SearchableRecordListWidgetProps) {
  const props = element.props ?? {};
  const emptyActionRoute = text(props.emptyActionRoute, '/capture');
  const records = (Array.isArray(props.records) ? props.records : []) as DomainRecordViewModel[];
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('all');
  const collections = useMemo(
    () => Array.from(new Set(records.map((record) => record.collection))).sort(),
    [records],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (collection !== 'all' && record.collection !== collection) return false;
      if (!needle) return true;
      return [
        record.title,
        record.body,
        record.meta,
        record.status,
        ...Object.values(record.properties).map((value) => String(value ?? '')),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [collection, query, records]);

  return (
    <View style={styles.recordSearch}>
      <View style={styles.searchInputShell}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search records"
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder={text(props.placeholder, 'Search names, locations, notes…')}
          placeholderTextColor="#8C8175"
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <Pressable accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={10} onPress={() => setQuery('')}>
            <Text style={styles.searchClear}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilters}>
        {['all', ...collections].map((item) => (
          <Pressable
            accessibilityRole="button"
            key={item}
            onPress={() => setCollection(item)}
            style={[styles.searchFilter, collection === item ? styles.searchFilterActive : null]}
          >
            <Text style={[styles.searchFilterText, collection === item ? styles.searchFilterTextActive : null]}>
              {item === 'all' ? 'All' : item.replaceAll('_', ' ')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.searchCount}>{filtered.length} result{filtered.length === 1 ? '' : 's'}</Text>
      {filtered.length ? (
        <View style={styles.compactRecordList}>
          {filtered.slice(0, 100).map((record) => (
            <Pressable
              accessibilityRole="button"
              key={record.id}
              onPress={() => onOpenRecord?.(record.id)}
              style={styles.compactRecordRow}
            >
              <Text style={styles.compactRecordEmoji}>{text(record.properties.emoji, '•')}</Text>
              <View style={styles.compactRecordCopy}>
                <Text numberOfLines={1} style={styles.compactRecordTitle}>{record.title}</Text>
                <Text numberOfLines={2} style={styles.compactRecordDetail}>{record.body || record.meta}</Text>
              </View>
              <Text style={styles.compactRecordArrow}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.searchEmpty}>
          <Text style={styles.searchEmptyTitle}>{text(props.emptyTitle, 'Nothing matches yet')}</Text>
          <Text style={styles.searchEmptyCopy}>Try another word, change the filter, or add a new item.</Text>
          <Pressable accessibilityRole="button" onPress={() => onOpenActionRoute?.(emptyActionRoute)} style={styles.outcomePrimary}>
            <Text style={styles.outcomePrimaryText}>{text(props.emptyActionLabel, 'Add item')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  recordSearch: { gap: 12 },
  searchInputShell: { alignItems: 'center', backgroundColor: '#F0E9DE', borderRadius: 18, flexDirection: 'row', minHeight: 52, paddingHorizontal: 14 },
  searchIcon: { color: '#2F7448', fontSize: 24, marginRight: 8 },
  searchInput: { color: '#241C16', flex: 1, fontSize: 16, minHeight: 48, paddingVertical: 10 },
  searchClear: { color: '#756A5E', fontSize: 26 },
  searchFilters: { gap: 8, paddingRight: 16 },
  searchFilter: { backgroundColor: '#F0E9DE', borderRadius: 15, minHeight: 36, justifyContent: 'center', paddingHorizontal: 12 },
  searchFilterActive: { backgroundColor: '#2F7448' },
  searchFilterText: { color: '#62584E', fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  searchFilterTextActive: { color: '#FFFFFF' },
  searchCount: { color: '#756A5E', fontSize: 12, fontWeight: '800' },
  compactRecordList: { backgroundColor: '#FFFCF5', borderRadius: 20, overflow: 'hidden' },
  compactRecordRow: { alignItems: 'center', borderBottomColor: '#ECE4D8', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 72, paddingHorizontal: 14, paddingVertical: 10 },
  compactRecordEmoji: { fontSize: 24, width: 32 },
  compactRecordCopy: { flex: 1, gap: 2 },
  compactRecordTitle: { color: '#241C16', fontSize: 16, fontWeight: '800' },
  compactRecordDetail: { color: '#756A5E', fontSize: 13, lineHeight: 18 },
  compactRecordArrow: { color: '#2F7448', fontSize: 24 },
  searchEmpty: { alignItems: 'flex-start', backgroundColor: '#FFFCF5', borderRadius: 20, gap: 10, padding: 20 },
  searchEmptyTitle: { color: '#241C16', fontSize: 18, fontWeight: '900' },
  searchEmptyCopy: { color: '#756A5E', fontSize: 14, lineHeight: 20 },
  outcomePrimary: { backgroundColor: '#2F7448', borderRadius: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  outcomePrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
