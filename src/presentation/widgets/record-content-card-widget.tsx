import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  RecordContentCardAction,
  RecordContentCardChip,
  RecordContentCardProps,
} from '@/packages/shared/contracts/ui-widgets';
import {
  actionUrl,
  detail,
  label,
  openWidgetTarget,
  rows,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';

type ContentCardProps = WidgetProps & RecordContentCardProps;

export function RecordContentCardWidget({ element }: ComponentRenderProps<ContentCardProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const chips = rows(props.chips) as RecordContentCardChip[];
  const actions = rows(props.actions) as RecordContentCardAction[];
  const title = text(props.title, 'Featured item');
  const subtitle = text(props.subtitle);
  const body = text(props.body);
  const imageUrl = text(props.imageUrl);
  const hasTarget = Boolean(text(props.route) || actionUrl(props));

  return (
    <View style={styles.surface}>
      <Pressable
        accessibilityLabel={[title, subtitle, body].filter(Boolean).join(', ')}
        accessibilityRole={hasTarget ? 'button' : undefined}
        disabled={!hasTarget}
        onPress={() => openWidgetTarget(router, props)}
        style={styles.card}
      >
        {imageUrl ? <Image accessibilityLabel={title} source={{ uri: imageUrl }} style={styles.image} /> : null}
        {!imageUrl && props.emoji ? <Text style={styles.emoji}>{text(props.emoji)}</Text> : null}
        <View style={styles.copy}>
          {props.badge ? <Text style={styles.badge}>{text(props.badge)}</Text> : null}
          <Text numberOfLines={2} style={styles.title}>{title}</Text>
          {subtitle ? <Text numberOfLines={2} style={styles.subtitle}>{subtitle}</Text> : null}
          {body ? <Text numberOfLines={4} style={styles.body}>{body}</Text> : null}
          {chips.length ? (
            <View style={styles.chips}>
              {chips.slice(0, 6).map((chip, index) => (
                <Text key={`${label(chip)}-${index}`} style={styles.chip}>{label(chip)}</Text>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>

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
  surface: { backgroundColor: '#202A35', borderRadius: 24, gap: 12, padding: 14 },
  card: { alignItems: 'flex-start', flexDirection: 'row', gap: 14 },
  image: { backgroundColor: '#31404D', borderRadius: 18, height: 104, width: 104 },
  emoji: { alignItems: 'center', backgroundColor: '#31404D', borderRadius: 18, color: '#EAF2F7', fontSize: 42, height: 104, lineHeight: 104, textAlign: 'center', width: 104 },
  copy: { flex: 1, gap: 7, paddingVertical: 2 },
  badge: { alignSelf: 'flex-start', color: '#9FD4C1', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: '#FFFFFF', fontSize: 21, fontWeight: '900', lineHeight: 26 },
  subtitle: { color: '#D5E0E7', fontSize: 13, lineHeight: 18 },
  body: { color: '#B9C7D1', fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, color: '#F3F7FA', fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 5 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { alignItems: 'center', borderColor: '#526675', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 40, paddingHorizontal: 10 },
  primaryAction: { backgroundColor: '#9FD4C1', borderColor: '#9FD4C1' },
  actionText: { color: '#DCE8EE', fontSize: 13, fontWeight: '800' },
  primaryActionText: { color: '#17221E' },
});
