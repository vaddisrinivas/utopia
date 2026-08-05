import { useLocalSearchParams } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, H2, Paragraph, Spinner, YStack } from 'tamagui';
import { Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { collectPendingRuntimePermissions, requestBootPermission, type PermissionRequest } from '@/src/kernel/capabilities';
import { findPackage } from '@/src/kernel/catalog';
import { PackageApp } from '@/src/kernel/render';
import type { AppPackage } from '@/src/kernel/schema';
import { AppStore } from '@/src/kernel/store';
import { recordConsent } from '@/src/kernel/policy';

export default function AppRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ installationId?: string | string[]; screen?: string | string[] }>();
  const id = typeof params.installationId === 'string' ? params.installationId : '';
  const screen = typeof params.screen === 'string' ? params.screen : undefined;
  const installationId = id;
  const [pkg, setPackage] = useState<AppPackage>();
  const [ready, setReady] = useState(false);
  const [bootPermissions, setBootPermissions] = useState<PermissionRequest[]>([]);
  const [bootStep, setBootStep] = useState(0);
  const [bootError, setBootError] = useState('');
  const [bootReady, setBootReady] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [settingsMode, setSettingsMode] = useState(false);

  const openSettings = async () => { try { await Linking.openSettings(); } catch {} };
  const advance = () => setBootStep((value) => value + 1);

  useEffect(() => { let active = true; void findPackage(id).then((value) => active && setPackage(value)).finally(() => active && setReady(true)); return () => { active = false; }; }, [id]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = !ready ? 'Loading app — Utopia' : pkg ? `${pkg.presentation?.label ?? 'App'} — Utopia` : 'App unavailable — Utopia';
  }, [pkg, ready]);
  useEffect(() => {
    let active = true;
    setBootReady(false);
    if (!pkg) return;
    void (async () => {
      const pending = await collectPendingRuntimePermissions(installationId, pkg);
      if (!active) return;
      setBootPermissions(pending);
      setBootStep(0);
      setSettingsMode(false);
      setBootReady(true);
    })();
    return () => { active = false; };
  }, [installationId, pkg?.id]);

  const current = bootPermissions[bootStep];

  const requestNextPermission = async () => {
    if (!pkg || !current) return;
    try {
      setRequesting(true);
      setBootError('');
      await requestBootPermission(installationId, current);
      advance();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Permission check failed';
      setSettingsMode(message.toLowerCase().includes('denied') || message.toLowerCase().includes('cannot ask again'));
      setBootError(message);
    } finally {
      setRequesting(false);
    }
  };

  const skipPermission = async () => {
    if (!pkg || !current) return;
    await recordConsent(installationId, current.capability, 'denied');
    advance();
  };

  if (!ready) return <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
    <YStack role="main" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <H2 accessibilityRole="header">Loading app</H2><Paragraph>Preparing app.</Paragraph><Spinner />
    </YStack>
  </SafeAreaView>;
  if (!pkg) return <SafeAreaView style={{ flex: 1, backgroundColor: 'white', paddingHorizontal: 16 }}>
    <YStack role="main" gap="$3" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <H2 accessibilityRole="header">App unavailable</H2><Paragraph>Unknown app.</Paragraph>
      <Button accessibilityRole="button" accessibilityLabel="Open app list" onPress={() => router.replace('/')}>Apps</Button>
    </YStack>
  </SafeAreaView>;
  if (!bootReady) return <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
    <YStack role="main" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: '$3' }}>
      <Spinner accessibilityLabel="Checking permissions" />
    </YStack>
  </SafeAreaView>;
  if (current) return <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
    <YStack role="main" style={{ flex: 1, alignItems: 'stretch', justifyContent: 'center', paddingHorizontal: 16, gap: '$3' }}>
      <H2 accessibilityRole="header">{current.permission.id}</H2>
        <Paragraph>{current.permission.prompt || current.permission.reason || `Allow ${current.permission.id}?`}</Paragraph>
      {bootError ? <Paragraph color="$red10">{bootError}</Paragraph> : null}
      <Button accessibilityRole="button" accessibilityLabel={`Allow ${current.permission.id}`} disabled={requesting} onPress={() => void requestNextPermission()}>
        {requesting ? 'Requesting...' : 'Allow'}
      </Button>
      <Button chromeless accessibilityRole="button" onPress={() => void skipPermission()}>Not now</Button>
      {settingsMode ? <Button chromeless accessibilityRole="button" onPress={() => void openSettings()}>Open settings</Button> : null}
    </YStack>
  </SafeAreaView>;
  return <YStack role="main" flex={1}><AppStore appId={installationId}><PackageApp appId={installationId} pkg={pkg} initialScreen={screen} /></AppStore></YStack>;
}
