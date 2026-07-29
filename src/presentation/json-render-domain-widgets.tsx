import type { ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  actionRoute,
  actionUrl,
  detail,
  label,
  list,
  navigateWidgetRoute,
  numberValue,
  openWidgetTarget,
  rows,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import { styles } from '@/src/presentation/json-render-widgets';

export function DomainHeroWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const stats = rows((props as Record<string, unknown>).stats);
  const actions = rows(props.actions);
  return (
    <View style={styles.premiumHero}>
      <Text style={styles.premiumEmoji}>{text((props as Record<string, unknown>).emoji, '🍲')}</Text>
      <Text style={styles.premiumBadge}>{text(props.badge, 'Smart plan')}</Text>
      <Text style={styles.premiumTitle}>{text(props.title, 'Tonight is almost solved')}</Text>
      <Text style={styles.premiumSubtitle}>{text(props.subtitle, 'Use-first records, review, and next steps in one place.')}</Text>
      {stats.length ? (
        <View style={styles.premiumStats}>
          {stats.slice(0, 3).map((stat) => (
            <View key={label(stat)} style={styles.premiumStat}>
              <Text style={styles.premiumStatValue}>{text(stat.value, label(stat))}</Text>
              <Text style={styles.premiumStatLabel}>{text(stat.label, detail(stat))}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.premiumBody}>{text(props.body, 'The calmest next path is ready.')}</Text>
      <View style={styles.premiumActions}>
        {actions.slice(0, 3).map((action, index) => (
          <Pressable key={label(action)} style={[styles.premiumAction, index === 0 ? styles.premiumActionPrimary : null]} onPress={() => openWidgetTarget(router, action)}>
            <Text style={[styles.premiumActionText, index === 0 ? styles.premiumActionPrimaryText : null]}>{label(action)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function UseFirstCarouselWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const boundItems = rows(props.records)
    .sort((left, right) => {
      const leftProperties = rows([left.properties])[0] ?? {};
      const rightProperties = rows([right.properties])[0] ?? {};
      return numberValue(leftProperties.expires_in_days, 999) - numberValue(rightProperties.expires_in_days, 999);
    })
    .map((record) => {
      const properties = rows([record.properties])[0] ?? {};
      const expiresInDays = numberValue(properties.expires_in_days, -1);
      return {
        title: text(record.title, 'Food item'),
        subtitle: [text(record.status), text(record.meta)].filter(Boolean).join(' · '),
        badge: expiresInDays >= 0 ? (expiresInDays === 0 ? 'today' : `${expiresInDays}d`) : text(record.status, 'use first'),
        emoji: text(properties.emoji, text(properties.icon, '◉')),
        route: `/record/${encodeURIComponent(text(record.id))}`,
      };
    });
  const configuredItems = rows(props.items);
  const items = props.dataBound === true ? boundItems : configuredItems;
  return (
    <View style={styles.premiumSection}>
      <View style={styles.premiumSectionHeader}>
        <Text style={styles.premiumSectionTitle}>{text(props.title, 'Use first')}</Text>
        {text(props.ctaRoute) ? (
          <Pressable onPress={() => openWidgetTarget(router, { route: props.ctaRoute })}>
            <Text style={styles.premiumSectionCta}>{text(props.cta, 'Cook')}</Text>
          </Pressable>
        ) : null}
      </View>
      {props.subtitle ? <Text style={styles.premiumSectionSubtitle}>{text(props.subtitle)}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.premiumRail}>
        {(items.length ? items : props.dataBound === true
          ? [{ title: 'Nothing urgent', subtitle: 'No expiring kitchen items need attention.', emoji: '✓', badge: 'clear' }]
          : [{ title: 'Baby spinach', subtitle: '2 days · wraps or eggs', emoji: '🥬', badge: '2 days' }]).slice(0, 8).map((item, index) => (
          <Pressable key={label(item)} style={[styles.useFirstPremiumCard, index % 3 === 1 ? styles.useFirstPremiumBlue : index % 3 === 2 ? styles.useFirstPremiumYellow : null]} onPress={() => openWidgetTarget(router, item)}>
            <Text style={styles.useFirstPremiumEmoji}>{text(item.emoji, '🥬')}</Text>
            <Text style={styles.useFirstPremiumBadge}>{text(item.badge, text((item as Record<string, unknown>).status, 'use first'))}</Text>
            <Text style={styles.useFirstPremiumTitle}>{label(item)}</Text>
            <Text style={styles.useFirstPremiumDetail}>{detail(item, 'Ready to use.')}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function DomainTimelineWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items);
  return (
    <View style={styles.premiumCard}>
      <Text style={styles.premiumSectionTitle}>{text(props.title, 'Meal timeline')}</Text>
      {props.subtitle ? <Text style={styles.premiumSectionSubtitle}>{text(props.subtitle)}</Text> : null}
      {(items.length ? items : [{ title: 'Dinner', subtitle: 'Pick from available items', time: 'PM' }]).slice(0, 6).map((item) => (
        <Pressable key={label(item)} style={styles.mealPremiumRow} onPress={() => openWidgetTarget(router, item)}>
          <Text style={styles.mealPremiumTime}>{text(item.time, text(item.badge, 'Now'))}</Text>
          <View style={styles.mealPremiumCopy}>
            <Text style={styles.mealPremiumTitle}>{label(item)}</Text>
            <Text style={styles.mealPremiumDetail}>{detail(item, 'Plan-first item.')}</Text>
          </View>
          <Text style={styles.mealPremiumChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function DomainRecipeCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const chips = rows((props as Record<string, unknown>).chips);
  return (
    <Pressable style={styles.recipePremiumCard} onPress={() => openWidgetTarget(router, props)} disabled={!actionRoute(props) && !actionUrl(props)}>
      <View style={styles.recipePremiumArt}><Text style={styles.recipePremiumEmoji}>{text((props as Record<string, unknown>).emoji, '🍛')}</Text></View>
      <View style={styles.recipePremiumCopy}>
        <Text style={styles.recipePremiumBadge}>{text(props.badge, 'Pantry match')}</Text>
        <Text style={styles.recipePremiumTitle}>{text(props.title, 'Recipe')}</Text>
        <Text style={styles.recipePremiumDetail}>{text(props.subtitle, text(props.body, 'Cook from what you already have.'))}</Text>
        <View style={styles.recipePremiumChips}>
          {(chips.length ? chips : [{ label: '25 min' }, { label: '82% match' }]).slice(0, 4).map((chip) => (
            <Text key={label(chip)} style={styles.recipePremiumChip}>{label(chip)}</Text>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

export function DomainReceiptReviewCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items);
  const actions = rows(props.actions);
  return (
    <View style={styles.receiptPremiumCard}>
      <View style={styles.receiptPremiumHeader}>
        <Text style={styles.receiptPremiumIcon}>🧾</Text>
        <View style={styles.mealPremiumCopy}>
          <Text style={styles.receiptPremiumTitle}>{text(props.title, 'Receipt draft')}</Text>
          <Text style={styles.receiptPremiumDetail}>{text(props.subtitle, 'Source rows are matched and ready for review.')}</Text>
        </View>
        <Text style={styles.receiptPremiumBadge}>{text(props.badge, 'review')}</Text>
      </View>
      {(items.length ? items : [{ title: 'Salmon', subtitle: 'freezer · dinner', status: '+1' }]).slice(0, 5).map((item) => (
        <View key={label(item)} style={styles.receiptPremiumLine}>
          <Text style={styles.receiptPremiumLineTitle}>{label(item)}</Text>
          <Text style={styles.receiptPremiumLineDetail}>{detail(item)}</Text>
          <Text style={styles.receiptPremiumLineStatus}>{text(item.status, 'new')}</Text>
        </View>
      ))}
      <View style={styles.premiumActions}>
        {(actions.length ? actions : [{ title: 'Accept', route: '/capture' }, { title: 'Edit', route: '/capture' }, { title: 'Skip', route: '/capture' }]).slice(0, 3).map((action, index) => (
          <Pressable key={label(action)} style={[styles.premiumAction, index === 0 ? styles.premiumActionPrimary : null]} onPress={() => openWidgetTarget(router, action)}>
            <Text style={[styles.premiumActionText, index === 0 ? styles.premiumActionPrimaryText : null]}>{label(action)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

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
