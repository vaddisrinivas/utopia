import { AppWindow, ArrowLeft } from 'lucide-react-native';
import * as Lucide from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, useWindowDimensions } from 'react-native';
import { Button, H1, H2, Paragraph, ScrollView, Separator, Spinner, XStack, YStack } from 'tamagui';

import { routeScreen } from './runtime';
import { layout } from './layout';
import { localize } from './localization';
import type { AppComponent, AppPackage } from './schema';
import { RecordWidget } from './record-widgets';
import { Proposal } from './proposal';
import { useAppStore } from './store';
import { deriveTheme, PackageTheme, usePackageTheme } from './theme';
import { Widget } from './widgets';
import { recordBindableWidgets, recordWidgets } from './widget-support';

const icon = (name?: string) => {
  const key = (name ?? '').split(/[-_\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return (Lucide as unknown as Record<string, typeof AppWindow>)[key] ?? AppWindow;
};

function Component({ appId, component, navigate, pkg }: { appId: string; component: AppComponent; navigate(target: string): boolean; pkg: AppPackage }) {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const { dispatch } = useAppStore();
  const theme = usePackageTheme();
  async function act() {
    const action = component.action;
    if (!action) return;
    if (action.kind === 'navigate') {
      const target = action.target ?? String(action.payload?.route ?? '');
      if (!navigate(target) && target.startsWith('/')) router.push(target as never);
      return;
    }
    if (action.kind === 'open_url') {
      const url = action.url ?? String(action.payload?.url ?? '');
      if (/^https:\/\//.test(url)) await Linking.openURL(url);
      return;
    }
    if (['create', 'update', 'delete', 'toggle', 'undo'].includes(action.kind)) await dispatch(action);
  }
  const bound = Boolean(component.view || component.query?.collections?.length || component.props?.collection);
  const body = component.kind === 'widget' && (recordWidgets.has(component.widget ?? '') || (bound && recordBindableWidgets.has(component.widget ?? '')))
    ? <RecordWidget component={component} pkg={pkg} />
    : component.kind === 'metric' && bound ? <RecordWidget component={{ ...component, kind: 'widget', widget: 'recordMetric' }} pkg={pkg} />
    : component.kind === 'widget' ? <Widget appId={appId} component={component} navigate={navigate} />
    : component.kind === 'recordList' ? <RecordWidget component={{ ...component, widget: 'structuredList' }} pkg={pkg} />
    : component.kind === 'text' ? <Paragraph>{String(component.props?.text ?? component.title ?? '')}</Paragraph>
    : component.kind === 'metric' ? <YStack><Paragraph color="$color10">{component.title}</Paragraph><H2>{String(component.props?.value ?? '0')}</H2></YStack>
    : component.action?.kind === 'propose' ? null
    : component.action ? <Button style={{ alignSelf: component.layout ? 'auto' : 'flex-start', backgroundColor: theme.accent }} color="#FFFFFF" onPress={() => void act()}>{component.title ?? component.action.label ?? 'Run'}</Button> : null;
  const content = component.action?.kind === 'propose'
    ? <YStack gap="$2">{body}<Proposal action={component.action} pkg={pkg} navigate={navigate} /></YStack>
    : body;
  return <YStack style={layout(component.layout, width, height, Platform.OS)}>{content}</YStack>;
}

export function PackageApp({ pkg, initialScreen }: { pkg: AppPackage; initialScreen?: string }) {
  pkg = localize(pkg, pkg.presentation.ui.localization);
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const screens = pkg.presentation.ui.screens;
  const ids = Object.keys(screens);
  const requested = routeScreen(initialScreen ?? '', ids);
  const [active, setActive] = useState(requested ?? pkg.presentation.ui.defaultScreen ?? ids[0]);
  const screen = screens[active] ?? screens[ids[0]];
  const navigation = pkg.presentation.ui.navigation?.items ?? ids.map((screen) => ({ screen, label: screens[screen].title ?? screen, icon: undefined }));
  const { ready } = useAppStore();
  const identity = pkg.presentation.visualIdentity;
  const palette = deriveTheme(identity);
  const accent = palette.accent;
  const emoji = typeof identity?.emoji === 'string' ? identity.emoji : '◆';
  const ink = palette.ink;
  const wide = width >= 900;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const document = (globalThis as { document?: { title: string } }).document;
    if (!document) return;
    const previous = document.title;
    document.title = `${pkg.presentation.label} - Utopia`;
    return () => { document.title = previous; };
  }, [pkg.presentation.label]);
  const navigate = (target: string) => {
    const next = routeScreen(target, ids);
    if (next) {
      if (next !== active) {
        setActive(next);
        router.setParams({ screen: next });
      }
      return true;
    }
    return false;
  };
  useEffect(() => { if (requested && requested !== active) setActive(requested); }, [active, requested]);
  if (!ready) return <YStack style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Spinner /></YStack>;
  const nav = navigation.length > 1 ? <XStack gap="$1" style={{ width: '100%', maxWidth: 1080, alignSelf: 'center', padding: 8 }}>
    {navigation.map((item) => {
      const Icon = icon(item.icon);
      return <Button key={item.screen} flex={wide ? undefined : 1} size="$3" chromeless icon={<Icon color={item.screen === active ? accent : ink} />} style={{ backgroundColor: item.screen === active ? `${accent}22` : 'transparent', color: item.screen === active ? accent : ink }} onPress={() => navigate(item.screen)} accessibilityLabel={item.label} accessibilityState={{ selected: item.screen === active }} aria-label={item.label}>{wide ? item.label : null}</Button>;
    })}
  </XStack> : null;
  return <PackageTheme identity={identity}><YStack accessibilityRole={Platform.OS === 'web' ? 'main' as never : undefined} style={{ flex: 1, backgroundColor: palette.canvas, ...layout(pkg.presentation.ui.layout, width, height, Platform.OS) }}>
    <XStack style={{ backgroundColor: `${accent}12` }}>
      <XStack gap="$3" style={{ width: '100%', maxWidth: 1120, alignSelf: 'center', alignItems: 'center', padding: 12, paddingTop: 20 }}>
        <Button circular chromeless icon={<ArrowLeft color={ink} />} onPress={() => router.canGoBack() ? router.back() : router.replace('/')} aria-label="Apps" />
        <YStack style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: accent }}><Paragraph fontSize="$6">{emoji}</Paragraph></YStack>
        <H1 size="$8" flex={1} style={{ color: ink }}>{pkg.presentation.label}</H1>
      </XStack>
    </XStack>
    <Separator />
    {wide && nav ? <YStack style={{ borderBottomWidth: 1, borderColor: '#E3E6E3' }}>{nav}</YStack> : null}
    <ScrollView contentContainerStyle={{ padding: 12 } as never}>
      <YStack gap="$3" style={{ width: '100%', maxWidth: 1080, alignSelf: 'center' }}>
        {screen?.title ? <H2 size="$8" style={{ color: ink }}>{screen.title}</H2> : null}
        <YStack gap="$3" style={{ width: '100%', ...layout(screen?.layout, width, height, Platform.OS) }}>
          {screen?.components.map((component, index) => <Component appId={pkg.id} key={component.id ?? `${component.kind}-${index}`} component={component} navigate={navigate} pkg={pkg} />)}
        </YStack>
      </YStack>
    </ScrollView>
    {!wide && nav ? <YStack style={{ borderTopWidth: 1, borderColor: '#E3E6E3', paddingBottom: 6 }}>{nav}</YStack> : null}
  </YStack></PackageTheme>;
}
