import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import {
  actionRoute,
  actionUrl,
  detail,
  label,
  list,
  navigateWidgetRoute,
  openWidgetTarget,
  rows,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import { styles } from '@/src/presentation/json-render-widgets';

export function DomainShelfWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items);
  return (
    <View style={styles.premiumCard}>
      <Text style={styles.premiumSectionTitle}>{text(props.title, 'Kitchen map')}</Text>
      {props.subtitle ? <Text style={styles.premiumSectionSubtitle}>{text(props.subtitle)}</Text> : null}
      <View style={styles.shelfPremiumGrid}>
        {(items.length ? items : [{ title: 'Fridge', subtitle: '18 items', emoji: '❄️' }]).slice(0, 6).map((item) => (
          <Pressable key={label(item)} style={styles.shelfPremiumTile} onPress={() => openWidgetTarget(router, item)}>
            <Text style={styles.shelfPremiumEmoji}>{text(item.emoji, '🥫')}</Text>
            <Text style={styles.shelfPremiumTitle}>{label(item)}</Text>
            <Text style={styles.shelfPremiumDetail}>{detail(item)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function DomainAskBarWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const suggestions = list(props.suggestions, ['What should we do next?', 'Use items before they expire', 'Turn source into clean updates']);
  const ask = (prompt?: string) => {
    const route = prompt
      ? `/chat?prompt=${encodeURIComponent(prompt)}&run=1`
      : '/chat';
    navigateWidgetRoute(router, route);
  };
  return (
    <View style={styles.askPremiumCard}>
      <Text style={styles.askPremiumTitle}>{text(props.title, 'Ask')}</Text>
      <Text style={styles.askPremiumSubtitle}>{text(props.subtitle, 'Questions, sources, updates, decisions.')}</Text>
      <View style={styles.suggestions}>
        {suggestions.slice(0, 4).map((suggestion) => (
          <Pressable accessibilityRole="button" key={suggestion} onPress={() => ask(suggestion)}>
            <Text style={styles.askPremiumChip}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => ask()} style={styles.askPremiumInput}>
        <Text style={styles.askPremiumPlaceholder}>{text(props.placeholder, 'Ask what to do, update, use, or change…')}</Text>
        <Text style={styles.askPremiumSend}>Ask</Text>
      </Pressable>
    </View>
  );
}
