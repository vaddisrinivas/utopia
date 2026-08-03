import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  detail,
  interpolateRecordTemplate,
  label,
  openWidgetTarget,
  rows,
  text,
  visualGlyph,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import { styles } from '@/src/presentation/json-render-widgets';

export function RecordHeroSummaryWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const rawProps = props as Record<string, unknown>;
  const records = Array.isArray(rawProps.records) ? rawProps.records : [];
  const stats = rows(rawProps.stats);
  const actions = rows(props.actions);
  const title = interpolateRecordTemplate(props.title, records, 'A clearer next step');
  const subtitle = props.subtitle ? interpolateRecordTemplate(props.subtitle, records) : '';
  const badge = props.badge ? interpolateRecordTemplate(props.badge, records) : '';
  const body = props.body ? interpolateRecordTemplate(props.body, records) : '';
  const emoji = visualGlyph(rawProps.emoji, '');

  return (
    <View style={styles.premiumHero}>
      {emoji ? <Text style={styles.premiumEmoji}>{emoji}</Text> : null}
      {badge ? <Text style={styles.premiumBadge}>{badge}</Text> : null}
      <Text style={styles.premiumTitle}>{title}</Text>
      {subtitle ? <Text style={styles.premiumSubtitle}>{subtitle}</Text> : null}
      {stats.length ? (
        <View style={styles.premiumStats}>
          {stats.slice(0, 3).map((stat, index) => (
            <View key={`${label(stat)}-${index}`} style={styles.premiumStat}>
              <Text style={styles.premiumStatValue}>{interpolateRecordTemplate(stat.value, records, label(stat))}</Text>
              <Text style={styles.premiumStatLabel}>{interpolateRecordTemplate(stat.label, records, detail(stat))}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {body ? <Text style={styles.premiumBody}>{body}</Text> : null}
      {actions.length ? (
        <View style={styles.premiumActions}>
          {actions.slice(0, 3).map((action, index) => (
            <Pressable
              key={`${label(action)}-${index}`}
              style={[styles.premiumAction, index === 0 ? styles.premiumActionPrimary : null]}
              onPress={() => openWidgetTarget(router, action)}
            >
              <Text style={[styles.premiumActionText, index === 0 ? styles.premiumActionPrimaryText : null]}>
                {label(action)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
