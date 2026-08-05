import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {bundledEntries, bundledLoaders} from '../src/generated/catalog';
import {AppStore, useAppStore} from '../src/kernel/store';
import {routeScreen, type AppState} from '../src/kernel/runtime';
import type {AppAction, AppComponent, AppPackage} from '../src/kernel/schema';
import {recordBindableWidgets, recordWidgets} from '../src/kernel/widget-support';
import {RecordWidget} from '../src/kernel/record-widgets';
import {PackageTheme, Theme} from '../src/kernel/theme';
import {Widget} from '../src/kernel/widgets';

type Row = Record<string, unknown>;

type Dispatch = (action: AppAction) => Promise<void>;

const catalog = bundledEntries;
const value = (raw: unknown, fallback = '') =>
  typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
const actionLabel = (action: Row, component: AppComponent) => value(action.label, value(component.title, 'Run'));

export default function App() {
  const [pkg, setPackage] = useState<AppPackage>();
  return <Theme><SafeAreaView style={s.safe}><PkgBoundary pkg={pkg} close={() => setPackage(undefined)} open={setPackage} /></SafeAreaView></Theme>;
}

function PkgBoundary({pkg, close, open}: {pkg?: AppPackage; close: () => void; open: (value: AppPackage) => void}) {
  if (!pkg) return <Launcher open={open} />;
  return <AppStore appId={pkg.id}><Runtime pkg={pkg} close={close} /></AppStore>;
}

function Launcher({open}: {open(pkg: AppPackage): void}) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'active' | 'inactive'>('active');

  const activeCount = catalog.filter((item) => item.catalog.status === 'active').length;
  const inactiveCount = catalog.length - activeCount;
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return catalog
      .filter((entry) => entry.catalog.status === scope)
      .filter((entry) => `${entry.presentation.label} ${entry.id}`.toLowerCase().includes(query));
  }, [scope, search]);

  return <ScrollView contentContainerStyle={s.page} accessibilityLabel="App library">
    <Text style={s.h1}>Apps</Text>
    <Text style={s.muted}>{activeCount} active · {inactiveCount} inactive</Text>
    <View style={s.scope}>
      <Pressable style={[s.scopeButton, scope === 'active' && s.scopeSelected]} onPress={() => setScope('active')}><Text style={s.scopeText}>Active {activeCount}</Text></Pressable>
      <Pressable style={[s.scopeButton, scope === 'inactive' && s.scopeSelected]} onPress={() => setScope('inactive')}><Text style={s.scopeText}>Inactive {inactiveCount}</Text></Pressable>
    </View>
    <TextInput accessibilityLabel="Search apps" placeholder={`Search ${scope}`} value={search} onChangeText={setSearch} style={s.input} />
    {visible.map((entry) => {
      const identity = (entry.presentation.visualIdentity ?? {}) as Row;
      return <Pressable key={entry.id} style={[s.launch, {backgroundColor: value(identity.canvas, '#FFFCF5'), borderColor: value(identity.accent, '#2F7448'), borderWidth: 1}]} accessibilityRole="button" accessibilityLabel={`Open ${entry.presentation.label}`} onPress={() => open(bundledLoaders[entry.id]() as AppPackage)}>
        <Text style={s.launchIcon}>{value(identity.icon, value(identity.emoji, '◉'))}</Text>
        <View style={{flex: 1}}>
          <Text style={s.launchText}>{entry.presentation.label}</Text>
          {entry.catalog.status === 'inactive' ? <Text style={s.muted}>Similar to {entry.catalog.duplicateOf} · {Math.round(entry.catalog.similarity * 100)}%</Text> : null}
        </View>
        <Text style={s.chevron}>›</Text>
      </Pressable>;
    })}
  </ScrollView>;
}

function Runtime({pkg, close}: {pkg: AppPackage; close: () => void}) {
  const ui = pkg.presentation.ui;
  const ids = Object.keys(ui.screens);
  const [active, setActive] = useState(ui.defaultScreen ?? ids[0]);
  const [history, setHistory] = useState<string[]>([]);
  const store = useAppStore();
  const {state, ready, dispatch} = store;

  const navigate = useCallback((target: string, replace = false) => {
    const id = routeScreen(target, ids);
    if (id) {
      if (id !== active) {
        if (!replace) setHistory((list) => [...list, active]);
        setActive(id);
      }
      return true;
    }
    if (/^https?:\/\//.test(target)) void Linking.openURL(target);
    return false;
  }, [active, ids]);

  useEffect(() => { setHistory([]); }, [pkg.id]);

  const back = () => {
    const previous = history.at(-1);
    if (previous) {
      setActive(previous);
      setHistory((current) => current.slice(0, -1));
      return;
    }
    close();
  };

  const screen = ui.screens[active] ?? ui.screens[ids[0]];
  const nav = ui.navigation?.items ?? ids.map((id) => ({screen: id, label: ui.screens[id].title ?? id}));
  const background = pkg.presentation.visualIdentity?.canvas ?? '#FBF7EE';
  const accent = pkg.presentation.visualIdentity?.accent ?? '#2F7448';

  return <PackageTheme identity={pkg.presentation.visualIdentity}><View style={[s.safe, {backgroundColor: background}]}>
    <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to apps" onPress={back}><Text style={[s.back, {color: accent}]}>‹ Apps</Text></Pressable><Text style={s.h1} accessibilityRole="header">{pkg.presentation.label}</Text></View>
    <ScrollView contentContainerStyle={s.page}>{ready ? screen?.components.map((component, index) => <Element key={`${component.id ?? component.widget ?? component.kind}-${index}`} component={component} state={state} dispatch={dispatch} navigate={navigate} pkg={pkg} />) : <Text style={s.muted}>Loading</Text>}</ScrollView>
    <View style={s.nav} accessibilityLabel="App navigation">{nav.map((item) => <Pressable key={item.screen} style={[s.navItem, item.screen === active && {backgroundColor: `${accent}20`}]} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{selected: item.screen === active}} onPress={() => navigate(item.screen)}><Text style={[s.navText, item.screen === active && {color: accent}]}>{item.label}</Text></Pressable>)}</View>
  </View></PackageTheme>;
}

function Element({component, pkg, state, dispatch, navigate}: {component: AppComponent; pkg: AppPackage; state: AppState; dispatch: Dispatch; navigate(target: string): boolean}) {
  const bound = Boolean(component.view || component.query?.collections?.length || component.props?.collection || component.props?.query);
  if (component.kind === 'widget' && (recordWidgets.has(component.widget ?? '') || (bound && recordBindableWidgets.has(component.widget ?? '')))) {
    return <RecordWidget component={component} pkg={pkg} />;
  }
  if (component.kind === 'recordList') return <RecordWidget component={{...component, kind: 'widget', widget: 'structuredList'}} pkg={pkg} />;
  if (component.kind === 'metric' && bound) return <RecordWidget component={{...component, kind: 'widget', widget: 'recordMetric'}} pkg={pkg} />;
  if (component.kind === 'widget') return <Widget appId={pkg.id} component={component} navigate={navigate} />;
  if (component.kind === 'text') return <TextBlock component={component} />;
  if (component.kind === 'metric') return <Metric component={component} />;
  if (component.kind === 'action') return <Action component={component} dispatch={dispatch} navigate={navigate} />;
  throw new Error(`Unsupported component kind ${String(component.kind)}`);
}

function Frame({component, children}: {component: AppComponent; children: React.ReactNode}) {
  return <View style={s.card}>{component.title ? <Text style={s.h2}>{component.title}</Text> : null}{component.subtitle ? <Text style={s.muted}>{component.subtitle}</Text> : null}{children}</View>;
}

function TextBlock({component}: {component: AppComponent}) {
  return <Frame component={component}><Text style={s.body}>{value(component.props?.body, value(component.props?.text, component.subtitle))}</Text></Frame>;
}

function Metric({component}: {component: AppComponent}) {
  const valueProp = component.props ?? {};
  return <Frame component={component}><Text style={s.metric}>{String(valueProp.value ?? valueProp.metric ?? valueProp.amount ?? '0')}</Text>{valueProp.label ? <Text style={s.muted}>{value(valueProp.label)}</Text> : null}</Frame>;
}

function Action({component, dispatch, navigate}: {component: AppComponent; dispatch: Dispatch; navigate(target: string): boolean}) {
  const action = (component.action ?? {}) as Row;
  const label = actionLabel(action, component);
  const target = value(action.target, value(action.url, value((action.payload as Row | undefined)?.route)));
  return <Frame component={component}><Pressable accessibilityRole="button" accessibilityLabel={label} style={s.primary} onPress={() => {
    if (action.kind === 'navigate' || target) navigate(target);
    else if (action.kind === 'open_url') void Linking.openURL(value(action.url, value((action.payload as Row | undefined)?.url, '')));
    else if (action.kind) dispatch(action as AppAction);
  }}><Text style={s.primaryText}>{label}</Text></Pressable></Frame>;
}

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#FBF7EE'},
  page: {width: '100%', maxWidth: 820, alignSelf: 'center', padding: 18, gap: 14},
  header: {flexDirection: 'row', alignItems: 'center', gap: 18, padding: 16, borderBottomWidth: 1, borderColor: '#E6DDCF'},
  h1: {fontSize: 30, fontWeight: '900', color: '#182019'},
  h2: {fontSize: 20, fontWeight: '900', color: '#241C16'},
  back: {fontSize: 15, color: '#2F7448', fontWeight: '800'},
  launch: {minHeight: 64, borderRadius: 18, padding: 18, backgroundColor: '#FFFCF5', flexDirection: 'row', alignItems: 'center', gap: 12},
  launchIcon: {fontSize: 22, color: '#2F7448'},
  launchText: {fontSize: 17, fontWeight: '900', color: '#182019'},
  scope: {flexDirection: 'row', gap: 8},
  scopeButton: {flex: 1, padding: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#F6F1E8'},
  scopeSelected: {backgroundColor: '#E4F1E8'},
  scopeText: {fontWeight: '900', color: '#26372A'},
  card: {borderRadius: 24, padding: 16, gap: 12, backgroundColor: '#FFFCF5'},
  muted: {fontSize: 13, lineHeight: 18, color: '#6D6257'},
  body: {fontSize: 16, lineHeight: 23, color: '#26372A'},
  metric: {fontSize: 42, fontWeight: '900', color: '#2F7448'},
  chevron: {position: 'absolute', right: 12, top: 12, fontSize: 24, color: '#B8AB9A'},
  primary: {alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14, backgroundColor: '#241C16'},
  primaryText: {color: '#fff', fontWeight: '900'},
  input: {flex: 1, minHeight: 48, borderRadius: 14, padding: 12, backgroundColor: '#F6F1E8', color: '#241C16'},
  nav: {flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderColor: '#E6DDCF', backgroundColor: '#FFFCF5'},
  navItem: {flex: 1, alignItems: 'center', padding: 10, borderRadius: 14},
  navText: {fontWeight: '800', color: '#241C16'},
});
