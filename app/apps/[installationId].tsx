import { useLocalSearchParams } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, H2, Paragraph, Spinner, YStack } from 'tamagui';

import { findPackage } from '@/src/kernel/catalog';
import { PackageApp } from '@/src/kernel/render';
import type { AppPackage } from '@/src/kernel/schema';
import { AppStore } from '@/src/kernel/store';

export default function AppRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ installationId?: string | string[]; screen?: string | string[] }>();
  const id = typeof params.installationId === 'string' ? params.installationId : '';
  const screen = typeof params.screen === 'string' ? params.screen : undefined;
  const [pkg, setPackage] = useState<AppPackage>();
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; void findPackage(id).then((value) => active && setPackage(value)).finally(() => active && setReady(true)); return () => { active = false; }; }, [id]);
  if (!ready) return <YStack style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Spinner /></YStack>;
  if (!pkg) return <YStack gap="$3" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><H2>Unavailable</H2><Paragraph>Unknown app.</Paragraph><Button onPress={() => router.replace('/')}>Apps</Button></YStack>;
  return <AppStore appId={pkg.id}><PackageApp pkg={pkg} initialScreen={screen} /></AppStore>;
}
