import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { AppPackage } from '@/packages/shared/contracts/package';
import { getActiveAppPackage, getAppInstallation } from '@/src/db/app-package-registry';
import { useUtopiaDatabase } from '@/src/db/provider';
import { AppRuntimeProvider, useAppRuntime } from '@/src/domain/runtime-context';
import { JsonRenderRoute } from '@/src/presentation/json-render-route';
import { colors } from '@/src/theme';

export default function InstalledAppRoute() {
  const router = useRouter();
  const db = useUtopiaDatabase();
  const params = useLocalSearchParams<{ installationId?: string | string[] }>();
  const installationId = typeof params.installationId === 'string' ? params.installationId.trim() : '';
  const [installation, setInstallation] = useState<AppInstallation | null>(null);
  const [activePackage, setActivePackage] = useState<AppPackage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db || !installationId) {
      setInstallation(null);
      setActivePackage(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getAppInstallation(db, installationId),
      getActiveAppPackage(db, installationId),
    ]).then(([nextInstallation, nextPackage]) => {
      if (cancelled) return;
      setInstallation(nextInstallation);
      setActivePackage(nextPackage);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setInstallation(null);
      setActivePackage(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [db, installationId]);

  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading app</Text>
      </View>
    );
  }

  if (!db || !installationId || !installation) {
    return (
      <View style={styles.state}>
        <Text style={styles.title}>App not found</Text>
        <Text style={styles.stateText}>This installation is missing or unavailable.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/install')}>
          <Text style={styles.buttonText}>Back to install</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <AppRuntimeProvider
      db={db}
      installationId={installation.id}
      initialInstallation={installation}
      initialPackage={activePackage}
    >
      <InstalledAppSurface />
    </AppRuntimeProvider>
  );
}

function InstalledAppSurface() {
  const router = useRouter();
  const { activePackage, installation } = useAppRuntime();

  if (!activePackage) {
    return (
      <View style={styles.state}>
        <Text style={styles.title}>{installation?.label ?? 'App unavailable'}</Text>
        <Text style={styles.stateText}>No active package is bound to this installation.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/install')}>
          <Text style={styles.buttonText}>Back to install</Text>
        </Pressable>
      </View>
    );
  }

  return <JsonRenderRoute screen="home" />;
}

const styles = StyleSheet.create({
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: colors.canvas,
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  stateText: {
    color: colors.muted,
    textAlign: 'center',
  },
  button: {
    borderRadius: 8,
    backgroundColor: colors.moss,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
});
