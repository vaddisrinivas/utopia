import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { buildPackageInstallApprovalReceipt } from '@/packages/shared/contracts/package-install';
import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { UtopiaRegistryManifest, UtopiaRegistryPackage } from '@/packages/shared/contracts/package-install';
import { connectInstallationDataHome } from '@/src/providers/data-home-adapter';
import {
  createDataHomeAdapterRegistry,
  DATA_HOME_COPY,
  type DataHomeAdapterDescriptor,
  DEFAULT_DATA_HOME_ADAPTER_ID,
  extractDeclaredDataHomeAdapterIds,
  resolveDataHomeSelectionContract,
} from '@/src/providers/data-home-selection';
import {
  activateApprovedAppPackageUpdate,
  archiveAppInstallation,
  deleteAppInstallationAndData,
  installApprovedAppPackage,
  listAppInstallations,
  previewAppPackageUpdate,
  restoreAppInstallation,
} from '@/src/db/app-package-registry';
import { useUtopiaDatabase } from '@/src/db/provider';
import {
  BUNDLED_DEMO_PACKAGE_URL,
  BUNDLED_UTOPIA_REGISTRY_URL,
  buildAppInstallationLifecycleViewModel,
  buildAppLifecycleConfirmation,
  buildPackageInstallReviewViewModel,
  createPackageInstallFetcher,
  fetchPackageInstallCandidate,
  fetchRegistryManifest,
  getBundledRegistryManifest,
  type PackageInstallCandidate,
} from '@/src/domain/package-install';
import { useAppRuntime } from '@/src/domain/runtime-context';
import { confirmLifecycleAction } from '@/src/presentation/lifecycle-confirmation';
import { colors } from '@/src/theme';
import { useUtopiaSettingsSnapshot } from '@/src/settings/utopia-settings';

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
  const [dataHomeSelection, setDataHomeSelection] = useState<string>(DEFAULT_DATA_HOME_ADAPTER_ID);
  const [installations, setInstallations] = useState<AppInstallation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useUtopiaSettingsSnapshot();

  const declaredDataHomes = useMemo(() => extractDeclaredDataHomeAdapterIds(candidate?.packageJson), [candidate?.packageJson]);
  const adapterRegistry = useMemo(() => {
    return createDataHomeAdapterRegistry([
      notionDataHomeAdapterDescriptor(settings),
      googleSheetsDataHomeAdapterDescriptor(settings),
    ]);
  }, [settings.notion.enabled, settings.notion.token, settings.sheets.enabled, settings.sheets.token]);

  const dataHomeOptions = useMemo(() => {
    if (!candidate) return [];
    return resolveDataHomeSelectionContract({
      installationId: candidate.preview.packageId || candidate.target.packageUrl,
      declaredAdapterIds: declaredDataHomes,
      registry: adapterRegistry,
    }).options.map((option) => ({
      id: option.adapterId,
      disabled: !option.canSelect,
      label: option.label,
      reason: option.reason,
    }));
  }, [candidate, declaredDataHomes, adapterRegistry]);

  useEffect(() => {
    if (candidate) {
      setDataHomeSelection(DEFAULT_DATA_HOME_ADAPTER_ID);
    }
  }, [candidate]);

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
        .filter((item) => item.id !== installationId)
        .sort((left, right) => {
          if (left.status !== right.status) {
            if (left.status === 'active') return -1;
            if (right.status === 'active') return 1;
            if (left.status === 'archived') return -1;
            if (right.status === 'archived') return 1;
          }
          return left.label.localeCompare(right.label);
        }));
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
      const next = await fetchPackageInstallCandidate(url, fetcher, {
        registryPackage,
        registryTrustMetadata: registry.trust,
      });
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
      if (dataHomeSelection !== DEFAULT_DATA_HOME_ADAPTER_ID) {
        const isNotion = dataHomeSelection === 'notion';
        const isGoogleSheets = dataHomeSelection === 'google_sheets';
        const token = isNotion ? settings.notion.token : settings.sheets.token;
        if (!token) {
          throw new Error('data_home_token_missing_for_install');
        }
        if (!isNotion && !isGoogleSheets) {
          throw new Error('data_home_provider_unsupported_for_install');
        }
        const externalId = isNotion
          ? settings.notion.pageId || 'notion'
          : settings.sheets.workbookId || 'google_sheets';
        await connectInstallationDataHome(db, {
          installationId: installation.id,
          provider: dataHomeSelection,
          externalId,
          token,
          declaredDataHomes,
          providerOnline: adapterRegistry.get(dataHomeSelection)?.readiness === 'ready',
        });
      }
      router.replace({ pathname: '/apps/[installationId]', params: { installationId: installation.id } });
    } catch (installError) {
      setError(errorMessage(installError));
    } finally {
      setBusy(false);
    }
  }

  async function updateInstallation(id: string) {
    if (!db || !candidate || candidate.preview.status !== 'ready_for_review') return;
    try {
      const updatePreview = await previewAppPackageUpdate(db, id, candidate.packageJson as any, candidate.preview);
      if (updatePreview.status !== 'ready_for_review') {
        setError(updatePreview.errors.join('\n') || 'update_blocked');
        return;
      }
      const target = installations.find((item) => item.id === id);
      const confirmed = await confirmLifecycleAction(
        buildAppLifecycleConfirmation('update', target?.label ?? 'this app', {
          version: target?.packageBinding?.version ?? null,
          nextVersion: candidate.preview.version,
        }),
      );
      if (!confirmed) return;
      setBusy(true);
      setError(null);
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
    const target = installations.find((item) => item.id === id);
    const confirmed = await confirmLifecycleAction(
      buildAppLifecycleConfirmation('uninstall', target?.label ?? 'this app'),
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const archived = await archiveAppInstallation(db, id);
      setInstallations((items) => items.map((item) => (
        item.id === id ? { ...item, status: archived.status } : item
      )));
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    } finally {
      setBusy(false);
    }
  }

  async function restoreInstallation(id: string) {
    if (!db) return;
    const target = installations.find((item) => item.id === id);
    const confirmed = await confirmLifecycleAction(
      buildAppLifecycleConfirmation('restore', target?.label ?? 'this app'),
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await restoreAppInstallation(db, id);
      setInstallations((items) => items.map((item) => (
        item.id === id ? { ...item, status: restored.status } : item
      )));
    } catch (restoreError) {
      setError(errorMessage(restoreError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteInstallation(id: string) {
    if (!db) return;
    const target = installations.find((item) => item.id === id);
    const confirmed = await confirmLifecycleAction(
      buildAppLifecycleConfirmation('delete-data', target?.label ?? 'this app'),
    );
    if (!confirmed) return;
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
  const review = preview ? buildPackageInstallReviewViewModel(preview) : null;
  const activeInstallations = installations.filter((item) => item.status === 'active');
  const archivedInstallations = installations.filter((item) => item.status === 'archived');
  const disabledInstallations = installations.filter((item) => item.status === 'disabled');
  const updateTargets = preview?.packageId
    ? installations.filter((item) => item.status === 'active' && item.packageBinding?.packageId === preview.packageId && item.packageBinding?.version !== preview.version)
    : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>App Library</Text>
        <Text style={styles.title}>Review apps and installs</Text>
        <Text style={styles.subtitle}>Install from a link, inspect trust, and manage lifecycle actions without guesswork.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Install review</Text>
        <TextInput
          value={packageUrl}
          onChangeText={setPackageUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://example.com/app.package.json"
          accessibilityLabel="Package URL"
          style={styles.input}
        />
        <View style={styles.row}>
          <Pressable
            accessibilityLabel="Install from link"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            style={styles.primaryButton}
            onPress={() => void previewPackage(packageUrl)}
            disabled={busy}
          >
            <Text style={styles.primaryText}>Install from link</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Load bundled app"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
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
          accessibilityLabel="Registry URL"
          style={styles.input}
        />
        <Pressable
          accessibilityLabel="Choose registry"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          style={styles.secondaryButton}
          onPress={() => void loadRegistry()}
          disabled={busy}
        >
          <Text style={styles.secondaryText}>Choose registry</Text>
        </Pressable>
        <Text style={styles.registryName}>{registry.name}</Text>
        {registry.packages.map((item) => (
          <Pressable
            key={`${item.id}@${item.version}`}
            style={[styles.packageRow, selectedPackage?.id === item.id && selectedPackage.version === item.version ? styles.selectedRow : null]}
            accessibilityLabel={`${item.name}, ${item.id}@${item.version}, ${item.publisher?.name ?? item.publisher?.id ?? 'Unknown publisher'}${item.publisher?.verified ? ', verified publisher' : ''}`}
            accessibilityRole="button"
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
          {activeInstallations.length ? <Text style={styles.sectionHint}>Active</Text> : null}
          {activeInstallations.map((item) => {
            const lifecycle = buildAppInstallationLifecycleViewModel(item);
            return (
              <View key={item.id} style={styles.packageRow}>
                <Text style={styles.packageName}>{item.label}</Text>
                <Text style={styles.packageMeta}>{lifecycle.packageIdLabel}@{lifecycle.versionLabel}</Text>
                <Text style={styles.packageMeta}>{lifecycle.approvalLabel}</Text>
                <Text style={styles.packageMeta}>{lifecycle.sourceLabel}</Text>
                <View style={styles.row}>
                  <Pressable
                    accessibilityLabel={`Open ${item.label}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy || !lifecycle.canOpen }}
                    style={styles.secondaryButton}
                    onPress={() => router.push({ pathname: '/apps/[installationId]', params: { installationId: item.id } })}
                    disabled={busy || !lifecycle.canOpen}
                  >
                    <Text style={styles.secondaryText}>Open</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Uninstall ${item.label}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    style={styles.secondaryButton}
                    onPress={() => void archiveInstallation(item.id)}
                    disabled={busy}
                  >
                    <Text style={styles.secondaryText}>{lifecycle.actionLabel}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Delete ${item.label} and all local data`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    style={styles.dangerButton}
                    onPress={() => void deleteInstallation(item.id)}
                    disabled={busy}
                  >
                    <Text style={styles.dangerText}>Delete app data</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {archivedInstallations.length ? <Text style={styles.sectionHint}>Uninstalled</Text> : null}
          {archivedInstallations.map((item) => {
            const lifecycle = buildAppInstallationLifecycleViewModel(item);
            return (
              <View key={item.id} style={styles.packageRow}>
                <Text style={styles.packageName}>{item.label}</Text>
                <Text style={styles.packageMeta}>{lifecycle.packageIdLabel}@{lifecycle.versionLabel}</Text>
                <Text style={styles.packageMeta}>{lifecycle.actionHint}</Text>
                <View style={styles.row}>
                  <Pressable
                    accessibilityLabel={`Delete ${item.label} and all local data`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    style={styles.dangerButton}
                    onPress={() => void deleteInstallation(item.id)}
                    disabled={busy}
                  >
                    <Text style={styles.dangerText}>Delete app data</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          {disabledInstallations.length ? <Text style={styles.sectionHint}>Disabled</Text> : null}
          {disabledInstallations.map((item) => {
            const lifecycle = buildAppInstallationLifecycleViewModel(item);
            return (
              <View key={item.id} style={styles.packageRow}>
                <Text style={styles.packageName}>{item.label}</Text>
                <Text style={styles.packageMeta}>{lifecycle.packageIdLabel}@{lifecycle.versionLabel}</Text>
                <Text style={styles.packageMeta}>{lifecycle.actionHint}</Text>
                <View style={styles.row}>
                  <Pressable
                    accessibilityLabel={`Restore ${item.label}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    style={styles.secondaryButton}
                    onPress={() => void restoreInstallation(item.id)}
                    disabled={busy}
                  >
                    <Text style={styles.secondaryText}>{lifecycle.actionLabel}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Delete ${item.label} and all local data`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}
                    style={styles.dangerButton}
                    onPress={() => void deleteInstallation(item.id)}
                    disabled={busy}
                  >
                    <Text style={styles.dangerText}>Delete app data</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.sectionTitle}>Install review</Text>
            <Text style={styles.previewTitle}>{preview.icon ? `${preview.icon} ` : ''}{review?.title ?? preview.appName}</Text>
          {preview.description ? <Text style={styles.muted}>{preview.description}</Text> : null}
          {dataHomeOptions.length ? (
            <View style={styles.section}>
              <Text style={styles.previewLabel}>Data-home selection</Text>
              <Text accessible accessibilityRole="text" accessibilityLabel="Data homes are not auto-migrated" style={styles.previewLabel}>
                {DATA_HOME_COPY.localDefaultHint}
              </Text>
              <View style={styles.row}>
                {dataHomeOptions.map((option) => (
                  <View key={option.id} style={styles.dataHomeOptionRow}>
                    <Pressable
                      accessibilityLabel={`Select ${option.label} data home`}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: dataHomeSelection === option.id,
                        disabled: option.disabled || busy,
                      }}
                      style={[
                        styles.secondaryButton,
                        dataHomeSelection === option.id ? styles.selectedRow : null,
                        option.disabled || busy ? styles.disabled : null,
                      ]}
                      onPress={() => setDataHomeSelection(option.id)}
                      disabled={option.disabled || busy}
                    >
                      <Text style={styles.secondaryText}>{option.label}</Text>
                    </Pressable>
                    <Text style={styles.previewValue}>{option.reason}</Text>
                  </View>
                ))}
              </View>
              {dataHomeSelection !== DEFAULT_DATA_HOME_ADAPTER_ID ? (
                <Text style={styles.previewValue}>
                  {DATA_HOME_COPY.remoteMigrationHint}
                </Text>
              ) : null}
            </View>
          ) : null}
          {review?.identityRows.map((row) => (
            <View key={row.label} accessible accessibilityRole="text" accessibilityLabel={`${row.label}: ${row.values.join(', ') || 'None'}`} style={styles.previewRow}>
              <Text style={styles.previewLabel}>{row.label}</Text>
              <Text style={styles.previewValue}>{row.values.join(', ')}</Text>
            </View>
          ))}
          {review ? (
            <View style={styles.trustBlock}>
              <View style={styles.badgeRow}>
                <TrustBadge tone={preview.status === 'ready_for_review' ? 'verified' : 'blocked'} label={review.trustSummary.statusLabel} />
                <TrustBadge tone={review.trustSummary.trustTone} label={review.trustSummary.trustLabel} />
                <TrustBadge tone={preview.runtimeCompatibility.status === 'compatible' ? 'verified' : 'blocked'} label={preview.runtimeCompatibility.status} />
              </View>
              <View accessible accessibilityRole="text" accessibilityLabel={`Checksum: ${review.trustSummary.checksumLabel}`} style={styles.previewRow}>
                <Text style={styles.previewLabel}>Checksum</Text>
                <Text style={styles.previewValue}>{review.trustSummary.checksumLabel}</Text>
              </View>
              <View accessible accessibilityRole="text" accessibilityLabel={`Publisher: ${review.trustSummary.publisherLabel}`} style={styles.previewRow}>
                <Text style={styles.previewLabel}>Publisher</Text>
                <Text style={styles.previewValue}>{review.trustSummary.publisherLabel}</Text>
              </View>
              <View accessible accessibilityRole="text" accessibilityLabel={`Self-signature: ${review.trustSummary.selfSignatureLabel}`} style={styles.previewRow}>
                <Text style={styles.previewLabel}>Self-signature</Text>
                <Text style={styles.previewValue}>{review.trustSummary.selfSignatureLabel}</Text>
              </View>
              <View accessible accessibilityRole="text" accessibilityLabel={`Publisher trust: ${review.trustSummary.publisherTrustLabel}`} style={styles.previewRow}>
                <Text style={styles.previewLabel}>Publisher trust</Text>
                <Text style={styles.previewValue}>{review.trustSummary.publisherTrustLabel}</Text>
              </View>
              <View accessible accessibilityRole="text" accessibilityLabel={`TUF metadata: ${review.trustSummary.tufMetadataLabel}`} style={styles.previewRow}>
                <Text style={styles.previewLabel}>TUF metadata</Text>
                <Text style={styles.previewValue}>{review.trustSummary.tufMetadataLabel}</Text>
              </View>
              <View accessible accessibilityRole="text" accessibilityLabel={`Approval: ${review.trustSummary.approvalLabel}`} style={styles.previewRow}>
                <Text style={styles.previewLabel}>Approval</Text>
                <Text style={preview.status === 'ready_for_review' ? styles.ready : styles.blocked}>{review.trustSummary.approvalLabel}</Text>
              </View>
            </View>
          ) : null}
          {review?.previewRows.map((row) => (
            <View key={row.label} accessible accessibilityRole="text" accessibilityLabel={`${row.label}: ${row.values.length ? row.values.join(', ') : 'None'}`} style={styles.previewRow}>
              <Text style={styles.previewLabel}>{row.label}</Text>
              <Text style={styles.previewValue}>{row.values.length ? row.values.join(', ') : 'None'}</Text>
            </View>
          ))}
          {review?.capabilityRows.length ? <Text style={styles.previewLabel}>Requested native capabilities</Text> : null}
          {review?.capabilityRows.map((row) => (
            <View key={row.label + row.value} accessible accessibilityRole="text" accessibilityLabel={`${row.label}: ${row.value}`} style={styles.previewRow}>
              <Text style={styles.previewLabel}>{row.label}</Text>
              <Text style={[
                styles.previewValue,
                row.tone === 'verified' ? styles.verifiedValue : row.tone === 'blocked' ? styles.blockedValue : styles.unknownValue,
              ]}>{row.value}</Text>
            </View>
          ))}
          {review?.blockingReasons.length ? <Text style={styles.previewLabel}>Install blocking reasons</Text> : null}
          {review?.blockingReasons.map((item) => <Text key={item} accessible accessibilityRole="text" accessibilityLabel={`Blocking reason: ${item}`} style={styles.error}>- {item}</Text>)}
          <View style={styles.row}>
            <Pressable
              accessibilityLabel={review?.primaryActionLabel ?? 'Install app'}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !db || preview.status !== 'ready_for_review' }}
              style={[styles.primaryButton, preview.status !== 'ready_for_review' ? styles.disabled : null]}
              onPress={() => void installCandidate()}
              disabled={busy || !db || preview.status !== 'ready_for_review'}
            >
              <Text style={styles.primaryText}>{review?.primaryActionLabel ?? 'Install'}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cancel install review"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              style={styles.secondaryButton}
              onPress={() => setCandidate(null)}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
          {updateTargets.length ? (
            <View style={styles.updateBlock}>
              <Text style={styles.previewLabel}>Update installed app</Text>
              {updateTargets.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityLabel={`Update ${item.label}${item.packageBinding?.version ? ` from ${item.packageBinding.version}` : ''}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy || !db || preview.status !== 'ready_for_review' }}
                  style={[styles.secondaryButton, preview.status !== 'ready_for_review' ? styles.disabled : null]}
                  onPress={() => void updateInstallation(item.id)}
                  disabled={busy || !db || preview.status !== 'ready_for_review'}
                >
                  <Text style={styles.secondaryText}>
                    {item.label}
                    {item.packageBinding?.version ? ` from ${item.packageBinding.version}` : ''}
                  </Text>
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
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.trustBadge, styles[`${tone}Badge`]]}>
      <Text style={[styles.trustBadgeText, styles[`${tone}BadgeText`]]}>{label}</Text>
    </View>
  );
}

function notionDataHomeAdapterDescriptor(settings: ReturnType<typeof useUtopiaSettingsSnapshot>): DataHomeAdapterDescriptor {
  return {
    id: 'notion',
    kind: 'remote',
    readiness: settings.notion.enabled && settings.notion.token ? 'ready' : 'requires_auth',
    capabilities: ['read', 'write', 'sync', 'import', 'export', 'migrate'],
  };
}

function googleSheetsDataHomeAdapterDescriptor(settings: ReturnType<typeof useUtopiaSettingsSnapshot>): DataHomeAdapterDescriptor {
  return {
    id: 'google_sheets',
    kind: 'remote',
    readiness: settings.sheets.enabled && settings.sheets.token ? 'ready' : 'requires_auth',
    capabilities: ['read', 'write', 'sync', 'import', 'export', 'migrate'],
  };
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
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  section: { gap: 10, borderColor: colors.line, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  sectionHint: { color: colors.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
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
  verifiedValue: { color: colors.moss, fontWeight: '700' },
  unknownValue: { color: colors.amber, fontWeight: '700' },
  blockedValue: { color: colors.red, fontWeight: '700' },
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
  dataHomeOptionRow: { gap: 6 },
});
