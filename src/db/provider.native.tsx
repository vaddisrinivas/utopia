import { PropsWithChildren, createContext, useContext, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SQLiteDatabase, openDatabaseAsync } from 'expo-sqlite';

import { DATABASE_NAME, runMigrations } from '@/src/db/migrations';
import { bootstrapAppPackageRegistry } from '@/src/db/app-package-registry';
import { seedDatabase } from '@/src/db/seed';
import { AppRuntimeProvider } from '@/src/domain/runtime-context';
import type { AppPackage } from '@/packages/shared/contracts/package';
import { DEFAULT_APP_INSTALLATION_ID } from '@/packages/shared/contracts/app-installation';

export type UtopiaDatabase = SQLiteDatabase | null;

const DatabaseContext = createContext<UtopiaDatabase>(null);

export function useUtopiaDatabase() {
  return useContext(DatabaseContext);
}

export function UtopiaDatabaseProvider({ children, seedInDev = false }: PropsWithChildren<{ seedInDev?: boolean }>) {
  const [db, setDb] = useState<UtopiaDatabase>(null);
  const [activePackage, setActivePackage] = useState<AppPackage | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let opened: SQLiteDatabase | null = null;

    const boot = async () => {
      try {
        opened = await openDatabaseAsync(DATABASE_NAME);
        await runMigrations(opened);
        const bootstrappedPackage = await bootstrapAppPackageRegistry(opened);
        await seedDatabase(opened, { seedInDev });
        if (!cancelled) {
          setActivePackage(bootstrappedPackage);
          setDb(opened);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'local_data_open_failed';
        console.error('[utopia:db_boot_failed]', message, error);
        if (!cancelled) {
          setBootError(message);
          setActivePackage(null);
          setDb(null);
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
      void opened?.closeAsync?.();
    };
  }, [seedInDev, bootAttempt]);

  if (bootError) {
    return (
      <View style={styles.bootErrorShell}>
        <Text style={styles.bootEyebrow}>Utopia</Text>
        <Text style={styles.bootTitle}>Food data did not open.</Text>
        <Text style={styles.bootCopy}>Restart once. If this keeps happening, reinstall the app and keep your Notion or Sheets connected.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setBootError(null);
            setBootAttempt((attempt) => attempt + 1);
          }}
          style={styles.bootButton}
        >
          <Text style={styles.bootButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <DatabaseContext.Provider value={db}>
      {db ? (
        <AppRuntimeProvider db={db} installationId={DEFAULT_APP_INSTALLATION_ID} initialPackage={activePackage}>
          {children}
        </AppRuntimeProvider>
      ) : null}
    </DatabaseContext.Provider>
  );
}

const styles = StyleSheet.create({
  bootButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#2F7448',
    borderRadius: 18,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  bootButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  bootCopy: {
    color: '#6D6259',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
  },
  bootErrorShell: {
    backgroundColor: '#FBF7EE',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  bootEyebrow: {
    color: '#2F7448',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  bootTitle: {
    color: '#30241F',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.7,
    lineHeight: 35,
    marginTop: 10,
  },
});
