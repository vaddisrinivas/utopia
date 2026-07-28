import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { AccountDevice, AccountSession, OidcAccount } from '@/src/domain/account-cloud';
import { describeAccountDevice, summarizeAccountAuthState } from '@/src/domain/account-cloud';
import { useUtopiaDatabase } from '@/src/db/provider';
import { useAppRuntime } from '@/src/domain/runtime-context';
import { colors, radius, shadow } from '@/src/theme';

type AccountRow = Pick<OidcAccount, 'accountId' | 'email' | 'displayName' | 'status' | 'updatedAt'>;
type DeviceRow = Pick<AccountDevice, 'deviceId' | 'installationId' | 'platform' | 'deviceLabel' | 'status' | 'lastSeenAt'> & {
  sessionCount: number;
};
type SessionRow = Pick<AccountSession, 'sessionId' | 'status' | 'deviceId'>;

export default function AccountScreen() {
  const router = useRouter();
  const db = useUtopiaDatabase();
  const { installation, installationId } = useAppRuntime();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const workspaceId = installation?.workspaceId ?? 'default-workspace';

  useEffect(() => {
    let cancelled = false;
    if (!db) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const liveDb = db;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextAccount = await liveDb.getFirstAsync<AccountRow>(
          `SELECT
             account_id AS accountId,
             email,
             display_name AS displayName,
             status,
             updated_at AS updatedAt
           FROM cloud_accounts
           WHERE workspace_id = ?
           ORDER BY updated_at DESC
           LIMIT 1`,
          [workspaceId],
        );

        if (!nextAccount) {
          if (!cancelled) {
            setAccount(null);
            setDevices([]);
            setSessions([]);
          }
          return;
        }

        const [nextDevices, nextSessions] = await Promise.all([
          liveDb.getAllAsync<DeviceRow>(
            `SELECT
               d.device_id AS deviceId,
               d.app_installation_id AS installationId,
               d.platform,
               d.device_label AS deviceLabel,
               d.status,
               d.last_seen_at AS lastSeenAt,
               COUNT(s.session_id) AS sessionCount
             FROM cloud_devices d
             LEFT JOIN cloud_sessions s
               ON s.device_id = d.device_id
               AND s.workspace_id = d.workspace_id
             WHERE d.workspace_id = ?
               AND d.account_id = ?
             GROUP BY d.device_id
             ORDER BY CASE WHEN d.app_installation_id = ? THEN 0 ELSE 1 END, d.updated_at DESC`,
            [workspaceId, nextAccount.accountId, installationId],
          ),
          liveDb.getAllAsync<SessionRow>(
            `SELECT
               session_id AS sessionId,
               status,
               device_id AS deviceId
             FROM cloud_sessions
             WHERE workspace_id = ?
               AND account_id = ?
             ORDER BY updated_at DESC`,
            [workspaceId, nextAccount.accountId],
          ),
        ]);

        if (!cancelled) {
          setAccount(nextAccount);
          setDevices(nextDevices);
          setSessions(nextSessions);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'account_load_failed');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [db, installationId, workspaceId]);

  const summary = useMemo(
    () => summarizeAccountAuthState({ account, devices, sessions }),
    [account, devices, sessions],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>Account and devices</Text>
        <Text style={styles.title}>{summary.headline}</Text>
        <Text style={styles.subtitle}>{summary.detail}</Text>
      </View>

      <View style={[styles.card, summary.mode === 'attention' ? styles.cardWarn : summary.mode === 'connected' ? styles.cardGood : null]}>
        <Text style={styles.cardTitle}>{summary.accountLabel}</Text>
        <Text style={styles.cardBody}>{summary.deviceLabel} - {summary.sessionLabel}</Text>
        <Text style={styles.cardMeta}>Workspace {workspaceId}</Text>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.moss} />
          <Text style={styles.loadingText}>Loading account status...</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && !account ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No cloud account</Text>
          <Text style={styles.cardBody}>Local capture, records, and chat stay available with no account setup.</Text>
        </View>
      ) : null}

      {account ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Devices</Text>
          {devices.length ? devices.map((device) => (
            <View key={device.deviceId} style={styles.deviceRow}>
              <View style={styles.deviceCopy}>
                <Text style={styles.deviceTitle}>
                  {device.deviceLabel}
                  {device.installationId && device.installationId === installationId ? ' - This install' : ''}
                </Text>
                <Text style={styles.deviceBody}>{describeAccountDevice(device, device.sessionCount)}</Text>
              </View>
              <View style={[styles.statusPill, pillTone(device.status)]}>
                <Text style={styles.statusPillText}>{device.status}</Text>
              </View>
            </View>
          )) : (
            <Text style={styles.cardBody}>No devices registered.</Text>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

function pillTone(status: DeviceRow['status']) {
  if (status === 'active') return styles.pillGood;
  if (status === 'pending') return styles.pillWarn;
  return styles.pillBad;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  header: {
    gap: 8,
    paddingTop: 12,
  },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  backText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  eyebrow: {
    color: colors.moss,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 8,
    padding: 16,
    ...shadow,
  },
  cardGood: {
    backgroundColor: colors.mossSoft,
  },
  cardWarn: {
    backgroundColor: colors.amberSoft,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  cardBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
  },
  error: {
    color: colors.red,
    fontSize: 14,
    fontWeight: '700',
  },
  deviceRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  deviceCopy: {
    flex: 1,
    gap: 4,
  },
  deviceTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
  },
  deviceBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  statusPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillGood: {
    backgroundColor: colors.mossSoft,
  },
  pillWarn: {
    backgroundColor: colors.amberSoft,
  },
  pillBad: {
    backgroundColor: '#F7E1DD',
  },
  statusPillText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
