import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { buildPackageInstallApprovalReceipt } from '@/packages/shared/contracts/package-install';
import type { UtopiaRegistryManifest, UtopiaRegistryPackage } from '@/packages/shared/contracts/package-install';
import {
  activateApprovedAppPackageUpdate,
  archiveAppInstallation,
  deleteAppInstallationAndData,
  installApprovedAppPackage,
  listAppInstallations,
  previewAppPackageUpdate,
} from '@/src/db/app-package-registry';
import { useUtopiaDatabase } from '@/src/db/provider';
import {
  BUNDLED_DEMO_PACKAGE_URL,
  BUNDLED_UTOPIA_REGISTRY_URL,
  createPackageInstallFetcher,
  fetchPackageInstallCandidate,
  fetchRegistryManifest,
  getBundledRegistryManifest,
  packageInstallPreviewRows,
  packageInstallTrustLabel,
  packageInstallTrustSummary,
  type PackageInstallCandidate,
} from '@/src/domain/package-install';
import { useAppRuntime } from '@/src/domain/runtime-context';
import { colors } from '@/src/theme';

export default function InstallScreen() {
  const router = useRouter();
  const db = useUtopiaDatabase();
  const params = useLocalSearchParams<{ url?: string }>();
  const { installationId } = useAppRuntime();
  const fetcher = useMemo(() => createPackageInstallFetcher(), []);
  const bundledRegistry = useMemo(() => getBundledRegistryManifest(), []);
  const [packageUrl, setPackageUrl] = useState('');
  const [registryUrl, setRegistryUrl] = useState(BUNDLED_UTOPIA_REGISTRY_URL);
  const [registry, setRegistry] = useState<UtopiaRegistryManifest>(bundledRegistry);
  const [candidate, setCandidate] = useState<PackageInstallCandidate | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<UtopiaRegistryPackage | null>(null);
  const [installations, setInstallations] = useState<{ id: string; label: string; launchPath?: string; packageId?: string; version?: string; approvedBy?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof params.url === 'string' && params.url.trim()) {
      setPackageUrl(params.url);
      void previewPackage(params.url);
    }
    // Run only for first route param load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url]);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    void listAppInstallations(db).then((items) => {
      if (cancelled) return;
      setInstallations(items
        .filter((item) => item.id !== installationId && item.status === 'active')
        .map((item) => ({
          id: item.id,
          label: item.label,
          packageId: item.packageBinding?.packageId ?? undefined,
          version: item.packageBinding?.version ?? undefined,
          approvedBy: item.approval?.approvedBy ?? undefined,
          launchPath: item.activation?.launchPath,
        })));
    }).catch(() => {
      if (!cancelled) setInstallations([]);
    });
    return () => {
      cancelled = true;
    };
  }, [db, installationId, busy]);

  async function previewPackage(url: string, registryPackage?: UtopiaRegistryPackage) {
    setBusy(true);
    setError(null);
    setSelectedPackage(registryPackage ?? null);
    try {
      const next = await fetchPackageInstallCandidate(url, fetcher, { registryPackage });
      setCandidate(next);
    } catch (installError) {
      setCandidate(null);
      setError(errorMessage(installError));
    } finally {
      setBusy(false);
    }
  }

  async function loadRegistry() {
    setBusy(true);
    setError(null);
    try {
      setRegistry(await fetchRegistryManifest(registryUrl, fetcher));
      setCandidate(null);
      setSelectedPackage(null);
    } catch (registryError) {
      setError(errorMessage(registryError));
    } finally {
      setBusy(false);
    }
  }

  async function installCandidate() {
    if (!db || !candidate || candidate.preview.status !== 'ready_for_review') return;
    setBusy(true);
    setError(null);
    try {
      const approval = buildPackageInstallApprovalReceipt(candidate.preview, 'local-user');
      const installation = await installApprovedAppPackage(db, {
        packageJson: candidate.packageJson,
        preview: candidate.preview,
        approval,
      });
      router.replace({ pathname: '/apps/[installationId]', params: { installationId: installation.id } });
    } catch (installError) {
      setError(errorMessage(installError));
    } finally {
      setBusy(false);
    }
  }

  async function updateInstallation(id: string) {
    if (!db || !candidate || candidate.preview.status !== 'ready_for_review') return;
    setBusy(true);
    setError(null);
    try {
      const updatePreview = await previewAppPackageUpdate(db, id, candidate.packageJson as any, candidate.preview);
      if (updatePreview.status !== 'ready_for_review') {
        setError(updatePreview.errors.join('\n') || 'update_blocked');
        return;
      }
      const approval = buildPackageInstallApprovalReceipt(candidate.preview, 'local-user');
      const installation = await activateApprovedAppPackageUpdate(db, {
        installationId: id,
        packageJson: candidate.packageJson as any,
        preview: candidate.preview,
        approval,
      });
      router.replace({ pathname: '/apps/[installationId]', params: { installationId: installation.id } });
    } catch (updateError) {
      setError(errorMessage(updateError));
    } finally {
      setBusy(false);
    }
  }

  async function archiveInstallation(id: string) {
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      await archiveAppInstallation(db, id);
      setInstallations((items) => items.filter((item) => item.id !== id));
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    } finally {
      setBusy(false);
    }
  }

  function requestDeleteInstallation(id: string, label: string) {
    Alert.alert(
      'Delete app and data?',
      `This permanently removes ${label}, its local records, provider links, queued writes, source snapshots, workflows, and install state.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete data', style: 'destructive', onPress: () => void deleteInstallation(id) },
      ],
    );
  }

  async function deleteInstallation(id: string) {
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAppInstallationAndData(db, id, {
        confirmedInstallationId: id,
        deleteData: true,
      });
      setInstallations((items) => items.filter((item) => item.id !== id));
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  }

  const preview = candidate?.preview ?? null;
  const trustSummary = preview ? packageInstallTrustSummary(preview) : null;
  const updateTargets = preview?.packageId
    ? installations.filter((item) => item.packageId === preview.packageId && item.version !== preview.version)
    : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Utopia install</Text>
        <Text style={styles.title}>Install an app</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Link</Text>
        <TextInput
          value={packageUrl}
          onChangeText={setPackageUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://example.com/app.package.json"
          style={styles.input}
        />
        <View style={styles.row}>
          <Pressable style={styles.primaryButton} onPress={() => void previewPackage(packageUrl)} disabled={busy}>
            <Text style={styles.primaryText}>Install from link</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void previewPackage(BUNDLED_DEMO_PACKAGE_URL, bundledRegistry.packages[0])}
            disabled={busy}
          >
            <Text style={styles.secondaryText}>Bundled app</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Registry</Text>
        <TextInput
          value={registryUrl}
          onChangeText={setRegistryUrl}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Pressable style={styles.secondaryButton} onPress={() => void loadRegistry()} disabled={busy}>
          <Text style={styles.secondaryText}>Choose registry</Text>
        </Pressable>
        <Text style={styles.registryName}>{registry.name}</Text>
        {registry.packages.map((item) => (
          <Pressable
            key={`${item.id}@${item.version}`}
            style={[styles.packageRow, selectedPackage?.id === item.id && selectedPackage.version === item.version ? styles.selectedRow : null]}
            onPress={() => {
              setPackageUrl(item.url);
              void previewPackage(item.url, item);
            }}
            disabled={busy}
          >
            <Text style={styles.packageName}>{item.name}</Text>
            <Text style={styles.packageMeta}>{item.id}@{item.version}</Text>
            <Text style={styles.packageMeta}>
              {item.publisher?.name ?? item.publisher?.id ?? 'Unknown publisher'}
              {item.publisher?.verified ? ' · verified' : ''}
            </Text>
            {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
          </Pressable>
        ))}
      </View>

      {installations.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Installed apps</Text>
          {installations.map((item) => (
            <View key={item.id} style={styles.packageRow}>
              <Text style={styles.packageName}>{item.label}</Text>
              <Text style={styles.packageMeta}>{[item.packageId, item.version].filter(Boolean).join('@') || item.id}</Text>
              <Text style={styles.packageMeta}>{item.approvedBy ? `Approved by ${item.approvedBy}` : item.launchPath ?? item.id}</Text>
              <View style={styles.row}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => router.push({ pathname: '/apps/[installationId]', params: { installationId: item.id } })}
                  disabled={busy}
                >
                  <Text style={styles.secondaryText}>Open</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void archiveInstallation(item.id)} disabled={busy}>
                  <Text style={styles.secondaryText}>Archive</Text>
                </Pressable>
                <Pressable style={styles.dangerButton} onPress={() => requestDeleteInstallation(item.id, item.label)} disabled={busy}>
                  <Text style={styles.dangerText}>Delete data</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {busy ? (
        <View style={styles.loading}><ActivityIndicator /><Text style={styles.muted}>Loading</Text></View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.sectionTitle}>Install preview</Text>
          <Text style={styles.previewTitle}>{preview.icon ? `${preview.icon} ` : ''}{preview.appName}</Text>
          {preview.description ? <Text style={styles.muted}>{preview.description}</Text> : null}
          <Text style={styles.packageMeta}>{preview.sourceUrl}</Text>
          <Text style={styles.packageMeta}>{preview.packageId ?? 'unknown'}@{preview.version ?? 'unknown'}</Text>
          {trustSummary ? (
            <View style={styles.trustBlock}>
              <View style={styles.badgeRow}>
                <TrustBadge tone={preview.status === 'ready_for_review' ? 'verified' : 'blocked'} label={trustSummary.statusLabel} />
                <TrustBadge tone={trustSummary.trustTone} label={trustSummary.trustLabel} />
                <TrustBadge tone={preview.runtimeCompatibility.status === 'compatible' ? 'verified' : 'blocked'} label={preview.runtimeCompatibility.status} />
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Checksum</Text>
                <Text style={styles.previewValue}>{trustSummary.checksumLabel}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Publisher</Text>
                <Text style={styles.previewValue}>{trustSummary.publisherLabel}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Signature</Text>
                <Text style={styles.previewValue}>{trustSummary.signatureLabel}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Approval</Text>
                <Text style={preview.status === 'ready_for_review' ? styles.ready : styles.blocked}>{trustSummary.approvalLabel}</Text>
              </View>
            </View>
          ) : null}
          {packageInstallPreviewRows(preview).map((row) => (
            <View key={row.label} style={styles.previewRow}>
              <Text style={styles.previewLabel}>{row.label}</Text>
              <Text style={styles.previewValue}>{row.values.length ? row.values.join(', ') : 'None'}</Text>
            </View>
          ))}
          {preview.validationErrors.map((item) => <Text key={item} style={styles.error}>- {item}</Text>)}
          <View style={styles.row}>
            <Pressable
              style={[styles.primaryButton, preview.status !== 'ready_for_review' ? styles.disabled : null]}
              onPress={() => void installCandidate()}
              disabled={busy || !db || preview.status !== 'ready_for_review'}
            >
              <Text style={styles.primaryText}>Install</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setCandidate(null)} disabled={busy}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
          {updateTargets.length ? (
            <View style={styles.updateBlock}>
              <Text style={styles.previewLabel}>Update installed app</Text>
              {updateTargets.map((item) => (
                <Pressable
                  key={item.id}
                  style={[styles.secondaryButton, preview.status !== 'ready_for_review' ? styles.disabled : null]}
                  onPress={() => void updateInstallation(item.id)}
                  disabled={busy || !db || preview.status !== 'ready_for_review'}
                >
                  <Text style={styles.secondaryText}>{item.label} {item.version ? `from ${item.version}` : ''}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function TrustBadge({ tone, label }: { tone: 'verified' | 'unknown' | 'blocked'; label: string }) {
  return (
    <View style={[styles.trustBadge, styles[`${tone}Badge`]]}>
      <Text style={[styles.trustBadgeText, styles[`${tone}BadgeText`]]}>{label}</Text>
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'install_failed';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: 16, padding: 18, paddingTop: 48 },
  header: { gap: 4 },
  eyebrow: { color: colors.moss, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  section: { gap: 10, borderColor: colors.line, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  input: { borderColor: colors.line, borderRadius: 8, borderWidth: 1, color: colors.ink, minHeight: 44, paddingHorizontal: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primaryButton: { borderRadius: 8, backgroundColor: colors.moss, paddingHorizontal: 14, paddingVertical: 11 },
  secondaryButton: { borderColor: colors.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  dangerButton: { borderColor: colors.red, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  disabled: { opacity: 0.45 },
  primaryText: { color: '#FFFFFF', fontWeight: '900' },
  secondaryText: { color: colors.ink, fontWeight: '900' },
  dangerText: { color: colors.red, fontWeight: '900' },
  registryName: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  packageRow: { gap: 3, borderColor: colors.line, borderRadius: 8, borderWidth: 1, padding: 10 },
  selectedRow: { borderColor: colors.moss, backgroundColor: colors.mossSoft },
  packageName: { color: colors.ink, fontWeight: '900' },
  packageMeta: { color: colors.muted, fontSize: 12 },
  muted: { color: colors.muted },
  loading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  error: { color: colors.red, fontWeight: '700' },
  preview: { gap: 10, borderColor: colors.moss, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  previewTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  ready: { color: colors.moss, fontWeight: '900' },
  blocked: { color: colors.red, fontWeight: '900' },
  trustBlock: { gap: 8, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 10 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trustBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  trustBadgeText: { fontSize: 12, fontWeight: '900' },
  verifiedBadge: { backgroundColor: colors.mossSoft, borderColor: colors.moss },
  verifiedBadgeText: { color: colors.moss },
  unknownBadge: { backgroundColor: colors.amberSoft, borderColor: colors.amber },
  unknownBadgeText: { color: colors.amber },
  blockedBadge: { backgroundColor: '#FBE1DD', borderColor: colors.red },
  blockedBadgeText: { color: colors.red },
  previewRow: { gap: 2 },
  previewLabel: { color: colors.ink, fontWeight: '900' },
  previewValue: { color: colors.muted },
  updateBlock: { gap: 8, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 10 },
});
