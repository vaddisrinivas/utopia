import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ComponentRenderProps } from '@json-render/react-native';

import { SearchableRecordListWidget as SearchableRecordListWidgetCore } from '@/src/presentation/widgets/generic-record-list-widgets';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

type NavigationWidgetProps = { element: ComponentRenderProps<WidgetProps>["element"] };

export function ScreenHeaderWidget({ element }: NavigationWidgetProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const props = element.props ?? {};
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  };
  return (
    <View style={[styles.screenHeader, { paddingTop: Math.max(insets.top + 6, 10) }]}>
      <View style={styles.screenHeaderTitleRow}>
        {props.showBack ? <Pressable accessibilityLabel="Back" accessibilityRole="button" hitSlop={10} onPress={goBack} style={styles.screenHeaderBack}><Text style={styles.screenHeaderBackText}>‹</Text></Pressable> : null}
        <View style={styles.screenHeaderCopy}>
          {props.eyebrow ? <Text style={styles.screenHeaderEyebrow}>{text(props.eyebrow)}</Text> : null}
          <Text numberOfLines={1} style={styles.screenHeaderTitle}>{text(props.title, 'App')}</Text>
        </View>
        {props.actionLabel && props.actionRoute ? <Pressable accessibilityRole="button" onPress={() => router.push(props.actionRoute as never)} style={styles.screenHeaderAction}><Text style={styles.screenHeaderActionText}>{text(props.actionLabel)}</Text></Pressable> : null}
      </View>
    </View>
  );
}

export function FloatingActionWidget({ element }: NavigationWidgetProps) {
  const router = useRouter();
  const props = element.props ?? {};
  if (!props.route) return null;
  return <Pressable accessibilityLabel={text(props.label, 'Add')} accessibilityRole="button" onPress={() => router.push(props.route as never)} style={({ pressed }) => [styles.fab, pressed ? styles.fabPressed : null]}><Text style={styles.fabPlus}>＋</Text><Text style={styles.fabLabel}>{text(props.label, 'Add')}</Text></Pressable>;
}

export function SearchableRecordListWidget({ element }: NavigationWidgetProps) {
  const router = useRouter();
  return <SearchableRecordListWidgetCore element={element} onOpenRecord={(recordId) => router.push(`/record/${encodeURIComponent(recordId)}` as never)} onOpenActionRoute={(route) => router.push(route as never)} />;
}

const styles = StyleSheet.create({
  screenHeader: { backgroundColor: '#FBF7EE', borderBottomColor: '#E8DFD1', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10 },
  screenHeaderTitleRow: { alignItems: 'center', flexDirection: 'row', minHeight: 42 },
  screenHeaderBack: { alignItems: 'center', backgroundColor: '#F0E9DE', borderRadius: 18, height: 36, justifyContent: 'center', marginRight: 10, width: 36 },
  screenHeaderBackText: { color: '#241C16', fontSize: 32, fontWeight: '500', lineHeight: 34 },
  screenHeaderCopy: { flex: 1 },
  screenHeaderEyebrow: { color: '#2F7448', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  screenHeaderTitle: { color: '#241C16', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  screenHeaderAction: { backgroundColor: '#2F7448', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9 },
  screenHeaderActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  fab: { alignItems: 'center', backgroundColor: '#2F7448', borderRadius: 26, bottom: 16, elevation: 8, flexDirection: 'row', gap: 5, minHeight: 52, paddingHorizontal: 18, position: 'absolute', right: 16, shadowColor: '#102716', shadowOffset: { height: 5, width: 0 }, shadowOpacity: 0.24, shadowRadius: 10 },
  fabPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  fabPlus: { color: '#FFFFFF', fontSize: 23, fontWeight: '500', lineHeight: 25 },
  fabLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});
