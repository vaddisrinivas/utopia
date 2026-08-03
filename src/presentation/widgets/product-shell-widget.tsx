import type { ComponentRenderProps } from '@json-render/react-native';
import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { Children, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  normalizeProductShellConfig,
  type ProductShellAction,
  type ProductShellCompositionMode,
  type ProductShellConfig,
  type ProductShellDensity,
  type ProductShellStatusTone,
} from '@/src/presentation/widgets/product-shell-config';

type ProductShellProps = ComponentRenderProps<Record<string, unknown>>;
type SymbolName = ComponentProps<typeof SymbolView>['name'];
type IconStyle = ComponentProps<typeof View>['style'];

type Pane = Readonly<{
  ariaLabel: string;
  children: readonly ReactNode[];
}>;

type CompositionMetrics = ReturnType<typeof shellMetrics>;

type PaneShape = Readonly<{
  mode: ProductShellCompositionMode;
  leftRatio: number;
  dashboardColumns: number;
}>;

const PRODUCT_SHELL_ICON_SYMBOLS: Record<string, SymbolName> = {
  'bar-chart': { ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' },
  book: { ios: 'book', android: 'book', web: 'book' },
  'book-open': { ios: 'book', android: 'menu_book', web: 'menu_book' },
  bookmark: { ios: 'bookmark', android: 'bookmark', web: 'bookmark' },
  calculator: { ios: 'function', android: 'calculate', web: 'calculate' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  'clipboard-check': { ios: 'checklist.checked', android: 'task_alt', web: 'task_alt' },
  'clipboard-list': { ios: 'list.clipboard', android: 'assignment', web: 'assignment' },
  briefcase: { ios: 'briefcase', android: 'work', web: 'work' },
  dumbbell: { ios: 'dumbbell', android: 'fitness_center', web: 'fitness_center' },
  'edit-3': { ios: 'pencil', android: 'edit', web: 'edit' },
  flame: { ios: 'flame', android: 'local_fire_department', web: 'local_fire_department' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  home: { ios: 'house', android: 'home', web: 'home' },
  archive: { ios: 'archivebox', android: 'inventory_2', web: 'inventory_2' },
  'shopping-cart': { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  'function-square': { ios: 'function', android: 'functions', web: 'functions' },
  superscript: { ios: 'textformat.superscript', android: 'superscript', web: 'superscript' },
  'sliders-horizontal': { ios: 'slider.horizontal.3', android: 'tune', web: 'tune' },
  'line-chart': { ios: 'chart.line.uptrend.xyaxis', android: 'monitoring', web: 'monitoring' },
  list: { ios: 'list.bullet', android: 'list', web: 'list' },
  'list-plus': { ios: 'text.badge.plus', android: 'playlist_add', web: 'playlist_add' },
  'message-square': { ios: 'message', android: 'chat_bubble', web: 'chat_bubble' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  'shield-check': { ios: 'checkmark.shield', android: 'verified', web: 'verified' },
  table: { ios: 'tablecells', android: 'table_chart', web: 'table_chart' },
  'trending-up': { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  'rotate-ccw': { ios: 'arrow.counterclockwise', android: 'restart_alt', web: 'restart_alt' },
};

export function ProductShellWidget({ element, children, emit }: ProductShellProps) {
  const router = useRouter();
  const config = useMemo(() => normalizeProductShellConfig(element.props), [element.props]);
  const tabRoutes = useMemo(() => {
    const value = element.props?.tabRoutes;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && entry[1].startsWith('/')
    )));
  }, [element.props]);
  const tabScreens = useMemo(() => {
    const value = element.props?.tabScreens;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && Boolean(entry[1])
    )));
  }, [element.props]);
  const [activeTab, setActiveTab] = useState(config.activeTab);
  const [statusVisible, setStatusVisible] = useState(true);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isWide = width >= config.responsive.breakpoint;
  const padding = isWide ? config.responsive.widePadding : config.responsive.narrowPadding;
  const metrics = shellMetrics(config.density, isWide);
  const compactPhone = !isWide && width < 430;
  const maxContentWidth = isWide && config.layoutMode === 'focusedTool'
    ? Math.min(config.responsive.maxContentWidth, 960)
    : config.responsive.maxContentWidth;
  const shape = paneShape(config.composition.mode, config.composition.ratio, config.composition.dashboardColumns);

  useEffect(() => {
    setActiveTab(config.activeTab);
  }, [config.activeTab]);

  const showDesktopActions = isWide && config.bottomActions.length > 0;
  const showMobileActions = !isWide && config.bottomActions.length > 0;
  const mobileSafeBottom = Math.max(insets.bottom, metrics.mobileActionSafePadding);
  const contentBottom = metrics.contentBottom + (showMobileActions ? metrics.mobileActionReserve + mobileSafeBottom : 0);

  const shellWidthStyle = {
    maxWidth: maxContentWidth,
    paddingHorizontal: padding,
    width: '100%' as const,
    alignSelf: 'center' as const,
  };

  const workspaceStyle = {
    ...shellWidthStyle,
    paddingBottom: contentBottom,
    paddingTop: metrics.contentTop,
  };

  const tabControls = config.tabs.map((tab) => {
    const selected = activeTab === tab.id;
    const route = tabRoutes[tab.id];
    const activate = () => {
      setActiveTab(tab.id);
      const targetScreen = tabScreens[tab.id];
      if (targetScreen) router.setParams({ screen: targetScreen });
      else if (route) router.push(route as never);
      else emit(`tab:${tab.id}`);
    };
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityHint={tab.screen ? `Open ${tab.label}` : undefined}
        accessibilityState={{ disabled: tab.disabled, selected }}
        disabled={tab.disabled}
        key={tab.id}
        onPress={activate}
        style={({ pressed }) => [
          styles.tab,
          compactPhone ? styles.tabCompact : null,
          {
            backgroundColor: 'transparent',
            borderColor: 'transparent',
          },
          pressed ? styles.tabPressed : null,
          tab.disabled ? styles.disabled : null,
        ]}
      >
        <ProductShellIcon
          color={selected ? config.theme.accent : config.theme.muted}
          name={tab.icon}
          size={compactPhone ? 15 : 16}
          style={styles.tabIcon}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.tabLabel,
            compactPhone ? styles.tabLabelCompact : null,
            { color: selected ? config.theme.ink : config.theme.muted },
          ]}
        >
          {tab.label}
        </Text>
        {selected ? <View style={[styles.tabIndicator, { backgroundColor: config.theme.accent }]} /> : null}
      </Pressable>
    );
  });

  const panes = useMemo(() => {
    const ordered = Children.toArray(children);
    return resolvePanes(ordered, shape, isWide);
  }, [children, isWide, shape.mode, shape.leftRatio, shape.dashboardColumns]);

  return (
    <View style={[styles.root, { backgroundColor: config.theme.canvas }]}>
      <View style={styles.frame}>
        <View style={[styles.appBar, {
          borderBottomColor: config.theme.border,
          minHeight: metrics.appBarHeight + insets.top,
          paddingBottom: metrics.appBarPadding,
          paddingTop: metrics.appBarPadding + insets.top,
        }]}>
          <View style={[styles.appBarInner, shellWidthStyle]}>
            {config.showBack ? (
              <Pressable
                accessibilityLabel="Go back"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => emit('back')}
                style={styles.backButton}
              >
                <Text style={[styles.backIcon, { color: config.theme.ink }]}>‹</Text>
              </Pressable>
            ) : null}
            <View style={[styles.appBarCopy, compactPhone ? styles.appBarCopyCompact : null]}>
              {config.eyebrow ? <Text style={[styles.eyebrow, { color: config.theme.accent }]}>{config.eyebrow}</Text> : null}
              <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, compactPhone ? styles.titleCompact : null, { color: config.theme.ink }]}>
                {config.title}
              </Text>
              {config.subtitle ? <Text numberOfLines={1} style={[styles.subtitle, compactPhone ? styles.subtitleCompact : null, { color: config.theme.muted }]}>{config.subtitle}</Text> : null}
            </View>
          </View>
        </View>

        {config.tabs.length ? isWide ? (
          <View
            accessibilityRole="tablist"
            style={[styles.tabs, styles.tabsDesktop, shellWidthStyle, { paddingVertical: metrics.tabPadding }]}
          >
            {tabControls}
          </View>
        ) : (
          <ScrollView
            accessibilityRole="tablist"
            contentContainerStyle={[
              styles.tabs,
              styles.tabsMobileContent,
              { paddingHorizontal: padding, paddingVertical: metrics.tabPadding },
            ]}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.tabsMobile, { backgroundColor: config.theme.canvas, borderBottomColor: config.theme.border }]}
          >
            {tabControls}
          </ScrollView>
        ) : null}

        {statusVisible && config.status ? (
          <View style={[styles.statusSlot, shellWidthStyle]}>
            <View
              accessibilityRole="alert"
              style={[styles.status, { backgroundColor: statusBackground(config.status.tone, config.theme) }]}
            >
              <Text accessibilityLiveRegion="polite" style={[styles.statusText, { color: config.theme.ink }]}>
                {config.status.message}
              </Text>
              {config.status.dismissible ? (
                <Pressable
                  accessibilityLabel="Dismiss status"
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => setStatusVisible(false)}
                >
                  <Text style={[styles.dismiss, { color: config.theme.muted }]}>×</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.bodyFrame}>
          {config.scrollable ? (
            <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
              <View style={[styles.workspace, showDesktopActions ? styles.workspaceWithRail : null, workspaceStyle]}>
                <CompositionPanes panes={panes} metrics={metrics} shape={shape} />
                {showDesktopActions ? <ActionRail config={config} emit={emit} /> : null}
              </View>
            </ScrollView>
          ) : (
            <View style={[styles.body, styles.workspace, showDesktopActions ? styles.workspaceWithRail : null, workspaceStyle]}>
              <CompositionPanes panes={panes} metrics={metrics} shape={shape} />
              {showDesktopActions ? <ActionRail config={config} emit={emit} /> : null}
            </View>
          )}
        </View>

        {showMobileActions ? (
          <View style={[styles.mobileActionBar, { backgroundColor: config.theme.surface, borderTopColor: config.theme.border, paddingBottom: mobileSafeBottom, paddingHorizontal: padding, gap: metrics.actionGap }] }>
            {config.bottomActions.map((action) => (
              <ShellAction action={action} compact={compactPhone} config={config} emit={emit} key={action.id} placement="mobile" />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

type CompositionPanesProps = {
  panes: readonly Pane[];
  metrics: CompositionMetrics;
  shape: PaneShape;
};

function CompositionPanes({ panes, metrics, shape }: CompositionPanesProps) {
  if (!panes.length) return null;

  if (panes.length === 1) {
    return (
      <View style={[styles.paneContainer, { gap: metrics.paneGap }]} accessibilityRole="summary" accessibilityLabel={panes[0].ariaLabel}>
        {panes[0].children}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Screen composition"
      accessibilityRole="none"
      style={[
        styles.paneGrid,
        panes.length === 2 ? styles.paneGridTwo : styles.paneGridThree,
        { gap: metrics.paneGap },
      ]}
    >
      {panes.map((pane, index) => (
        <View
          accessibilityRole="none"
          accessibilityLabel={pane.ariaLabel}
          key={pane.ariaLabel}
          style={[
            styles.contentPane,
            paneStyle(index, shape.mode, shape.leftRatio, panes.length),
          ]}
        >
          {pane.children}
        </View>
      ))}
    </View>
  );
}

function paneStyle(index: number, mode: ProductShellCompositionMode, leftRatio: number, paneCount: number) {
  if (paneCount <= 1) return {};
  if (mode === 'masterDetail' && paneCount === 2) {
    const leftFlex = Math.max(2, Math.round(leftRatio * 10));
    const rightFlex = Math.max(1, 10 - leftFlex);
    return index === 0 ? { flex: leftFlex } : { flex: rightFlex };
  }
  return {};
}

function ActionRail({ config, emit }: { config: ProductShellConfig; emit: (event: string) => void }) {
  return (
    <View accessibilityLabel="Screen actions" style={[styles.actionRail, { borderLeftColor: config.theme.border }]}>
      {config.bottomActions.map((action) => (
        <ShellAction action={action} compact={false} config={config} emit={emit} key={action.id} placement="rail" />
      ))}
    </View>
  );
}

function ShellAction({ action, compact, config, emit, placement }: { action: ProductShellAction; compact: boolean; config: ProductShellConfig; emit: (event: string) => void; placement: 'mobile' | 'rail' }) {
  const event = action.event ?? `action:${action.id}`;
  const color = actionTextColor(action.tone, config, placement);
  return (
    <Pressable
      accessibilityLabel={action.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: action.disabled }}
      disabled={action.disabled}
      onPress={() => emit(event)}
      style={[styles.action, placement === 'rail' ? styles.railAction : null, compact ? styles.actionCompact : null, actionStyle(action.tone, config, placement), action.disabled ? styles.disabled : null]}
    >
      <ProductShellIcon color={color} name={action.icon} size={compact ? 16 : 17} style={styles.actionIcon} />
      <Text numberOfLines={compact ? 2 : 1} style={[styles.actionLabel, placement === 'rail' ? styles.railActionLabel : null, compact ? styles.actionLabelCompact : null, { color }]}>
        {action.label}
      </Text>
    </Pressable>
  );
}

function ProductShellIcon({ color, name, size, style }: { color: string; name?: string; size: number; style?: IconStyle }) {
  const symbol = name ? PRODUCT_SHELL_ICON_SYMBOLS[name] : undefined;
  if (!symbol) return null;
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.iconFrame, { height: size, width: size }, style]}
    >
      <SymbolView
        fallback={<View style={{ height: size, width: size }} />}
        name={symbol}
        resizeMode="scaleAspectFit"
        size={size}
        tintColor={color}
      />
    </View>
  );
}

function paneShape(mode: ProductShellCompositionMode, ratio?: number, dashboardColumns?: number): PaneShape {
  const leftRatio = ratio ?? 0.34;
  return {
    mode,
    leftRatio: Math.min(0.78, Math.max(0.22, leftRatio)),
    dashboardColumns: Math.min(3, Math.max(2, dashboardColumns ?? 2)),
  };
}

function resolvePanes(children: ReactNode[], shape: PaneShape, isWide: boolean): Pane[] {
  const ordered = [...children];

  if (!isWide || ordered.length <= 1 || shape.mode === 'single') {
    return [{ ariaLabel: 'Primary content', children: ordered }];
  }

  if (shape.mode === 'masterDetail') {
    const master = ordered.slice(0, 1);
    const detail = ordered.slice(1);
    return [
      { ariaLabel: 'Master list', children: master },
      { ariaLabel: 'Detail panel', children: detail },
    ].filter((pane) => pane.children.length);
  }

  const columns = shape.dashboardColumns;
  if (columns === 3) {
    const chunk = Math.max(1, Math.ceil(ordered.length / 3));
    return [
      { ariaLabel: 'Primary dashboard', children: ordered.slice(0, chunk) },
      { ariaLabel: 'Secondary dashboard', children: ordered.slice(chunk, chunk * 2) },
      { ariaLabel: 'Tertiary dashboard', children: ordered.slice(chunk * 2) },
    ].filter((pane) => pane.children.length);
  }

  return [
    { ariaLabel: 'Primary dashboard', children: ordered.filter((_, index) => index % 2 === 0) },
    { ariaLabel: 'Secondary dashboard', children: ordered.filter((_, index) => index % 2 === 1) },
  ].filter((pane) => pane.children.length);
}

function actionStyle(tone: ProductShellAction['tone'], config: ProductShellConfig, placement: 'mobile' | 'rail') {
  if (placement === 'rail') {
    if (tone === 'primary') return { backgroundColor: config.theme.surfaceMuted, borderColor: config.theme.accent };
    if (tone === 'danger') return { backgroundColor: 'transparent', borderColor: config.theme.danger };
    if (tone === 'quiet') return { backgroundColor: 'transparent', borderColor: 'transparent' };
    return { backgroundColor: 'transparent', borderColor: config.theme.border };
  }
  if (tone === 'primary') return { backgroundColor: config.theme.accent, borderColor: config.theme.accent };
  if (tone === 'danger') return { backgroundColor: config.theme.danger, borderColor: config.theme.danger };
  if (tone === 'quiet') return { backgroundColor: 'transparent', borderColor: 'transparent' };
  return { backgroundColor: config.theme.surfaceMuted, borderColor: config.theme.border };
}

function actionTextColor(tone: ProductShellAction['tone'], config: ProductShellConfig, placement: 'mobile' | 'rail') {
  if (placement === 'rail') {
    if (tone === 'primary') return config.theme.accent;
    if (tone === 'danger') return config.theme.danger;
    return config.theme.ink;
  }
  if (tone === 'primary') return config.theme.accentContrast;
  if (tone === 'danger') return config.theme.dangerContrast;
  return config.theme.ink;
}

function statusBackground(tone: ProductShellStatusTone, theme: ProductShellConfig['theme']) {
  if (tone === 'success') return theme.statusSuccess;
  if (tone === 'warning') return theme.statusWarning;
  if (tone === 'error') return theme.statusError;
  return theme.statusInfo;
}

function shellMetrics(density: ProductShellDensity, isWide: boolean) {
  if (density === 'compact') {
    return {
      appBarHeight: isWide ? 70 : 64,
      appBarPadding: isWide ? 10 : 8,
      contentTop: isWide ? 10 : 8,
      contentBottom: isWide ? 14 : 12,
      tabPadding: isWide ? 12 : 10,
      paneGap: 12,
      actionGap: 8,
      mobileActionReserve: 72,
      mobileActionSafePadding: 8,
    };
  }
  if (density === 'spacious') {
    return {
      appBarHeight: isWide ? 82 : 74,
      appBarPadding: isWide ? 16 : 12,
      contentTop: isWide ? 14 : 12,
      contentBottom: isWide ? 20 : 16,
      tabPadding: isWide ? 16 : 12,
      paneGap: 20,
      actionGap: 12,
      mobileActionReserve: 86,
      mobileActionSafePadding: 12,
    };
  }
  return {
    appBarHeight: isWide ? 76 : 68,
    appBarPadding: isWide ? 14 : 10,
    contentTop: isWide ? 12 : 10,
    contentBottom: isWide ? 16 : 14,
    tabPadding: isWide ? 14 : 11,
    paneGap: 16,
    actionGap: 10,
    mobileActionReserve: 78,
    mobileActionSafePadding: 10,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 1 },
  frame: { flex: 1, width: '100%' },
  appBar: { borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 76 },
  appBarInner: { alignItems: 'center', flexDirection: 'row', minWidth: 0 },
  appBarCopy: { flex: 1, gap: 3 },
  appBarCopyCompact: { paddingRight: 48 },
  backButton: { alignItems: 'center', height: 44, justifyContent: 'center', marginRight: 8, width: 36 },
  backIcon: { fontSize: 32, fontWeight: '400', lineHeight: 34 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  title: { flexShrink: 1, fontSize: 22, fontWeight: '800' },
  titleCompact: { fontSize: 20, lineHeight: 24 },
  subtitle: { flexShrink: 1, fontSize: 14, lineHeight: 20 },
  subtitleCompact: { fontSize: 13, lineHeight: 18 },
  tabs: { alignItems: 'center', gap: 6 },
  tabsDesktop: { flexDirection: 'row', flexShrink: 0, flexWrap: 'wrap', gap: 6 },
  tabsMobile: { borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0, flexShrink: 0 },
  tabsMobileContent: { flexDirection: 'row', gap: 4 },
  tab: { alignItems: 'center', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', flexShrink: 0, gap: 6, minHeight: 44, minWidth: 44, paddingHorizontal: 12, position: 'relative' },
  tabCompact: { gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 10 },
  tabPressed: { opacity: 0.68 },
  tabIndicator: { borderRadius: 2, bottom: 3, height: 3, left: 12, position: 'absolute', right: 12 },
  iconFrame: { alignItems: 'center', flexShrink: 0, justifyContent: 'center' },
  tabIcon: { marginRight: -1 },
  tabLabel: { fontSize: 13, fontWeight: '800' },
  tabLabelCompact: { fontSize: 12 },
  statusSlot: { marginTop: 10 },
  status: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  statusText: { flex: 1, fontSize: 13, lineHeight: 18 },
  dismiss: { fontSize: 22, lineHeight: 22 },
  bodyFrame: { flex: 1, minHeight: 0 },
  body: { flex: 1 },
  scrollBody: { flexGrow: 1 },
  workspace: { minWidth: 0 },
  workspaceWithRail: { alignItems: 'flex-start', flexDirection: 'row', gap: 28 },
  paneContainer: { width: '100%' },
  paneGrid: { width: '100%', flexDirection: 'row', minWidth: 0 },
  paneGridTwo: { flexWrap: 'nowrap' },
  paneGridThree: { flexWrap: 'nowrap' },
  contentPane: { flex: 1, flexBasis: 0, minWidth: 0 },
  actionRail: { alignSelf: 'flex-start', borderLeftWidth: StyleSheet.hairlineWidth, flexShrink: 0, gap: 8, paddingLeft: 16, width: 208 },
  mobileActionBar: { alignItems: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingTop: 10 },
  action: { alignItems: 'center', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 46, paddingHorizontal: 12 },
  railAction: { flex: 0, justifyContent: 'flex-start', minHeight: 40, paddingHorizontal: 10 },
  actionCompact: { flexDirection: 'column', gap: 2, minHeight: 52, paddingHorizontal: 6, paddingVertical: 6 },
  actionIcon: {},
  actionLabel: { fontSize: 13, fontWeight: '700' },
  actionLabelCompact: { fontSize: 12 },
  railActionLabel: { textAlign: 'left' },
  disabled: { opacity: 0.45 },
});
