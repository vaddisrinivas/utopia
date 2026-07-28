import { Tabs } from 'expo-router';
import {
  SymbolView,
  type AndroidSymbol,
  type SFSymbol,
} from 'expo-symbols';
import { View, type ColorValue } from 'react-native';

import type { A2UiSurface } from '@/packages/shared/contracts/package';
import { useAppRuntime } from '@/src/domain/runtime-context';

type NavigationItem = NonNullable<A2UiSurface['navigation']>['items'][number];

const ICONS: Record<NonNullable<NavigationItem['icon']>, { android: AndroidSymbol; ios: SFSymbol }> = {
  home: { android: 'home', ios: 'house.fill' },
  food: { android: 'restaurant', ios: 'fork.knife' },
  sparkles: { android: 'auto_awesome', ios: 'sparkles' },
  sync: { android: 'cloud_sync', ios: 'arrow.triangle.2.circlepath' },
  settings: { android: 'settings', ios: 'gearshape.fill' },
};

function TabIcon({
  android,
  color,
  focused,
  ios,
}: {
  android: AndroidSymbol;
  color: ColorValue;
  focused: boolean;
  ios: SFSymbol;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: focused ? '#DDEEE2' : 'transparent',
        borderRadius: 18,
        height: 32,
        justifyContent: 'center',
        width: 48,
      }}
    >
      <SymbolView
        name={{ android, ios }}
        size={22}
        tintColor={color}
        weight="semibold"
      />
    </View>
  );
}

export default function TabLayout() {
  const { activeManifest } = useAppRuntime();
  const items = activeManifest?.ui?.navigation?.items ?? [];
  const item = (screen: NavigationItem['screen'], fallback: NavigationItem): NavigationItem =>
    items.find((candidate) => candidate.screen === screen) ?? fallback;
  const home = item('home', { screen: 'home', label: 'Home', icon: 'home' });
  const overview = item('overview', { screen: 'overview', label: activeManifest?.label ?? 'App', icon: 'food' });
  const chat = item('chat', { screen: 'chat', label: 'Ask', icon: 'sparkles' });
  const settings = item('settings', { screen: 'settings', label: 'Settings', icon: 'settings' });
  const icon = (entry: NavigationItem, fallback: NonNullable<NavigationItem['icon']>) => ICONS[entry.icon ?? fallback];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2F7448',
        tabBarInactiveTintColor: '#7A7066',
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: '#FFFCF5',
          borderTopColor: '#E3DACB',
          borderTopWidth: 1,
          height: 78,
          paddingBottom: 8,
          paddingTop: 7,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '800',
          marginTop: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: home.label,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon {...icon(home, 'home')} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="food"
        options={{
          title: overview.label,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon {...icon(overview, 'food')} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: chat.label,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon {...icon(chat, 'sparkles')} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen name="sources" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: settings.label,
          tabBarIcon: ({ color, focused }) => (
            <TabIcon {...icon(settings, 'settings')} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
