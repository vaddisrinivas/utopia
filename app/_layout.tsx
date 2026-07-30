import { Stack, useRouter } from 'expo-router';
import { Linking, LogBox, Platform, StatusBar as NativeStatusBar } from 'react-native';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { UtopiaDatabaseProvider } from '@/src/db/provider';
import { setActiveDomainOverride } from '@/src/domain/catalog';
import { parseAudioLoopIncomingIntent } from '@/src/platform/incoming-audio-loop';
import { useIncomingShareSafe } from '@/src/platform/incoming-share';
import { GoldenLoopDebugBridge } from '@/src/quality/GoldenLoopDebugBridge';
import { loadUtopiaSettings, subscribeUtopiaSettings } from '@/src/settings/utopia-settings';

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
]);

function IncomingShareRouter() {
  const router = useRouter();
  const incomingShare = useIncomingShareSafe();
  const handleIncomingUrl = (url: string) => {
    if (parseAudioLoopIncomingIntent(url)) {
      return;
    }

    try {
      if (new URL(url).hostname !== 'expo-sharing') return;
      incomingShare.refreshSharePayloads();
      setTimeout(() => {
        router.push('/capture?incomingShare=1');
      }, 0);
    } catch {
      // Ignore unrelated or malformed links.
    }
  };

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (!url) return;
      handleIncomingUrl(url);
    }).catch(() => {});

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });
    return () => subscription.remove();
  }, [incomingShare.refreshSharePayloads, router]);

  return null;
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadUtopiaSettings().then((settings) => {
      if (cancelled) return;
      setActiveDomainOverride(settings.runtime.activeDomain);
      setReady(true);
    }).catch(() => {
      if (!cancelled) setReady(true);
    });
    const unsubscribe = subscribeUtopiaSettings((settings) => {
      setActiveDomainOverride(settings.runtime.activeDomain);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync().catch(() => {});
      if (Platform.OS === 'android') {
        NativeStatusBar.setBarStyle('dark-content');
        NativeStatusBar.setBackgroundColor('#FBF7EE');
        NativeStatusBar.setTranslucent(false);
      }
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <UtopiaDatabaseProvider seedInDev={__DEV__}>
      <GoldenLoopDebugBridge />
      <StatusBar style="dark" />
      {Platform.OS === 'web' ? null : <IncomingShareRouter />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="record/[id]" />
        <Stack.Screen name="collection/[id]" />
        <Stack.Screen name="search" />
        <Stack.Screen name="account" />
        <Stack.Screen name="capture" />
        <Stack.Screen name="install" />
        <Stack.Screen name="vault" />
        <Stack.Screen name="package-control-room" />
        <Stack.Screen name="apps/[installationId]" />
        <Stack.Screen name="system" />
        <Stack.Screen name="config" />
        <Stack.Screen name="health-diagnostics" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </UtopiaDatabaseProvider>
  );
}
