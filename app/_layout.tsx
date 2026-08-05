import 'react-native-gesture-handler';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Theme } from '@/src/kernel/theme';

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <Theme>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="apps/[installationId]" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </Theme>
    </SafeAreaProvider>
  </GestureHandlerRootView>;
}
