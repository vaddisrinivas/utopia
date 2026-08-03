import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { createElement, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  AccessibilityRole,
  ActivityIndicator,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { AppPackage } from '@/packages/shared/contracts/package';
import {
  createDataHomeAdapterRegistry,
  DATA_HOME_COPY,
  type DataHomeAdapterDescriptor,
  DEFAULT_DATA_HOME_ADAPTER_ID,
  extractDeclaredDataHomeAdapterIds,
  previewDataHomeSwitch,
  resolveDataHomeSelectionContract,
  resolveDataHomeSelection,
} from '@/src/providers/data-home-selection';
import {
  archiveAppInstallation,
  deleteAppInstallationAndData,
  getActiveAppPackage,
  getAppInstallation,
  restoreAppInstallation,
} from '@/src/db/app-package-registry';
import { useUtopiaDatabase } from '@/src/db/provider';
import {
  connectInstallationDataHome,
  getInstallationDataHome,
  type DataHomeAdapter,
} from '@/src/providers/data-home-adapter';
import { AppRuntimeProvider, useAppRuntime } from '@/src/domain/runtime-context';
import { buildAppInstallationLifecycleViewModel, buildAppLifecycleConfirmation } from '@/src/domain/package-install';
import { JsonRenderRoute } from '@/src/presentation/json-render-route';
import { confirmLifecycleAction } from '@/src/presentation/lifecycle-confirmation';
import { colors } from '@/src/theme';
import { useUtopiaSettingsSnapshot } from '@/src/settings/utopia-settings';
import { resolveDeclaredScreenId } from '@/src/presentation/screen-navigation';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

export default function InstalledAppRoute() {
  const router = useRouter();
  const db = useUtopiaDatabase();
  const params = useLocalSearchParams<{ installationId?: string | string[]; view?: string | string[]; screen?: string | string[] }>();
  const installationId = typeof params.installationId === 'string' ? params.installationId.trim() : '';
  const view = typeof params.view === 'string' ? params.view.trim() : '';
  const requestedScreen = typeof params.screen === 'string' ? params.screen.trim() : '';
  const [installation, setInstallation] = useState<AppInstallation | null>(null);
  const [activePackage, setActivePackage] = useState<AppPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const installationLabel = installation?.label ?? '';
  const effectiveMode = view === 'manage' ? 'manage' : 'run';

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const previousTitle = document.title;
    const safeLabel = installationLabel || 'App';
    document.title = loading
      ? 'Loading app — Utopia'
      : !installation
        ? 'App unavailable — Utopia'
        : effectiveMode === 'manage'
          ? `Manage ${safeLabel} — Utopia`
          : `${safeLabel} — Utopia`;
    return () => {
      document.title = previousTitle || 'Utopia';
    };
  }, [effectiveMode, installation, installationLabel, loading]);

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
      <View {...mainAccessibilityRoleProps()} style={styles.state}>
        <ScreenHeading label="Loading app" />
        <ActivityIndicator />
        <Text style={styles.stateText}>Loading app</Text>
      </View>
    );
  }

  if (!db || !installationId || !installation) {
    return (
      <View {...mainAccessibilityRoleProps()} style={styles.state}>
        <ScreenHeading label="App not found" />
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
      <InstalledAppSurface mode={view === 'manage' ? 'manage' : 'run'} requestedScreen={requestedScreen} />
    </AppRuntimeProvider>
  );
}

function InstalledAppSurface({ mode, requestedScreen }: { mode: 'run' | 'manage'; requestedScreen: string }) {
  const router = useRouter();
  const db = useUtopiaDatabase();
  const { activePackage, installation, refreshRuntime, activeManifest } = useAppRuntime();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [selectedScreen, setSelectedScreen] = useState(requestedScreen || 'home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataHomeState, setDataHomeState] = useState<DataHomeAdapter | null>(null);
  const [dataHomeBusy, setDataHomeBusy] = useState(false);
  const [dataHomeError, setDataHomeError] = useState<string | null>(null);
  const [manageTooltipVisible, setManageTooltipVisible] = useState(false);

  useEffect(() => {
    const resolved = resolveDeclaredScreenId(activeManifest?.ui, requestedScreen) ?? 'home';
    setSelectedScreen(resolved);
    if (requestedScreen !== resolved) {
      router.setParams({ screen: resolved });
    }
  }, [activeManifest?.ui, requestedScreen, router]);
  const [selectedDataHomeAdapterId, setSelectedDataHomeAdapterId] = useState<string>(DEFAULT_DATA_HOME_ADAPTER_ID);
  const settings = useUtopiaSettingsSnapshot();
  const declaredDataHomes = useMemo(() => extractDeclaredDataHomeAdapterIds(activeManifest), [activeManifest]);
  const dataHomeAdapterRegistry = useMemo(() => createDataHomeAdapterRegistry([
    notionDataHomeAdapterDescriptor(settings),
    googleSheetsDataHomeAdapterDescriptor(settings),
  ]), [settings.notion.enabled, settings.notion.token, settings.sheets.enabled, settings.sheets.token]);

  useEffect(() => {
    if (!db || !installation) {
      setDataHomeState(null);
      setSelectedDataHomeAdapterId(DEFAULT_DATA_HOME_ADAPTER_ID);
      return;
    }
    let cancelled = false;
    void getInstallationDataHome(db, {
      installationId: installation.id,
      declaredDataHomes,
    }).then((nextState) => {
      if (cancelled) return;
      setDataHomeState(nextState);
      const currentSelection = resolveDataHomeSelection({
        installationId: installation.id,
        declaredAdapterIds: declaredDataHomes,
        registry: dataHomeAdapterRegistry,
        selection: { installationId: installation.id, adapterId: nextState.summary.provider, updatedAt: nextState.summary.updatedAt },
      });
      setSelectedDataHomeAdapterId(currentSelection.effectiveAdapterId ?? DEFAULT_DATA_HOME_ADAPTER_ID);
    }).catch(() => {
      if (cancelled) return;
      setDataHomeState(null);
      setSelectedDataHomeAdapterId(DEFAULT_DATA_HOME_ADAPTER_ID);
    });
    return () => {
      cancelled = true;
    };
  }, [db, installation?.id, declaredDataHomes.join(','), dataHomeAdapterRegistry]);

  if (!installation) {
    return (
      <View style={styles.state}>
        <Text style={styles.title}>App unavailable</Text>
        <Text style={styles.stateText}>This installation is missing or unavailable.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/install')}>
          <Text style={styles.buttonText}>Back to library</Text>
        </Pressable>
      </View>
    );
  }
  const currentInstallation = installation;

  if (mode === 'run' && currentInstallation.status === 'active' && activePackage) {
    const isPhone = width < 600;
    const manageLabel = isPhone
      ? `More options for ${currentInstallation.label}`
      : `Manage ${currentInstallation.label}`;
  return (
    <View accessibilityLabel={`${currentInstallation.label} app`} {...mainAccessibilityRoleProps()} style={styles.appScreen}>
        <ScreenHeading label={currentInstallation.label} />
        <Pressable
          accessibilityLabel={manageLabel}
          accessibilityHint={`Opens App Library settings for ${currentInstallation.label}`}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.manageButton,
            { top: Math.max(insets.top + 8, 14) },
            isPhone ? styles.manageButtonPhone : styles.manageButtonDesktop,
            pressed ? styles.manageButtonPressed : null,
          ]}
          onBlur={() => setManageTooltipVisible(false)}
          onFocus={() => setManageTooltipVisible(true)}
          onHoverIn={() => setManageTooltipVisible(true)}
          onHoverOut={() => setManageTooltipVisible(false)}
          onPress={() => router.push({
            pathname: '/apps/[installationId]',
            params: { installationId: currentInstallation.id, view: 'manage' },
          })}
        >
          <SymbolView
            accessible={false}
            accessibilityElementsHidden
            fallback={<View style={styles.manageIconFallback} />}
            importantForAccessibility="no"
            name={manageIconName(isPhone)}
            size={isPhone ? 20 : 19}
            tintColor={colors.ink}
          />
          {isPhone ? null : <Text style={styles.manageButtonText}>Manage</Text>}
          {!isPhone && manageTooltipVisible ? (
            <Text pointerEvents="none" style={styles.manageTooltip}>App Library settings</Text>
          ) : null}
        </Pressable>
        <JsonRenderRoute
          screen={selectedScreen}
          screenRouteBase={`/apps/${encodeURIComponent(currentInstallation.id)}`}
        />
      </View>
    );
  }

  const lifecycle = buildAppInstallationLifecycleViewModel(currentInstallation);

  const currentSelection = resolveDataHomeSelection({
    installationId: currentInstallation.id,
    declaredAdapterIds: declaredDataHomes,
    registry: dataHomeAdapterRegistry,
    selection: {
      installationId: currentInstallation.id,
      adapterId: dataHomeState?.summary.provider ?? DEFAULT_DATA_HOME_ADAPTER_ID,
      updatedAt: dataHomeState?.summary.updatedAt ?? new Date().toISOString(),
    },
  });

  const dataHomeChoices = resolveDataHomeSelectionContract({
    installationId: currentInstallation.id,
    declaredAdapterIds: declaredDataHomes,
    registry: dataHomeAdapterRegistry,
  }).options;

  const targetSelection = resolveDataHomeSelection({
    installationId: currentInstallation.id,
    declaredAdapterIds: declaredDataHomes,
    registry: dataHomeAdapterRegistry,
    selection: {
      installationId: currentInstallation.id,
      adapterId: selectedDataHomeAdapterId,
      updatedAt: dataHomeState?.summary.updatedAt ?? null,
    },
  });

  const currentDataHomeId = currentSelection.effectiveAdapterId ?? currentSelection.requestedAdapterId;
  const currentDataHomeLabel = currentDataHomeLabelFromId(currentDataHomeId);

  const preview = previewDataHomeSwitch({
    installationId: currentInstallation.id,
    declaredAdapterIds: declaredDataHomes,
    currentSelection: {
      installationId: currentInstallation.id,
      adapterId: dataHomeState?.summary.provider ?? DEFAULT_DATA_HOME_ADAPTER_ID,
          updatedAt: dataHomeState?.summary.updatedAt ?? null,
    },
    nextAdapterId: selectedDataHomeAdapterId,
    registry: dataHomeAdapterRegistry,
    now: new Date().toISOString(),
  });

  const dataHomeLabel =
    selectedDataHomeAdapterId === 'notion'
      ? 'Notion'
      : selectedDataHomeAdapterId === 'google_sheets'
        ? 'Google Sheets'
        : 'Local SQLite';
  const canApplyDataHomeSelection =
    targetSelection.status === 'ready'
    && targetSelection.effectiveAdapterId
    && targetSelection.effectiveAdapterId !== currentDataHomeId
    && !dataHomeBusy;

  async function archiveCurrentInstallation() {
    if (!db) return;
    const confirmed = await confirmLifecycleAction(
      buildAppLifecycleConfirmation('uninstall', currentInstallation.label),
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await archiveAppInstallation(db, currentInstallation.id);
      await refreshRuntime();
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    } finally {
      setBusy(false);
    }
  }

  async function restoreCurrentInstallation() {
    if (!db) return;
    const confirmed = await confirmLifecycleAction(
      buildAppLifecycleConfirmation('restore', currentInstallation.label),
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await restoreAppInstallation(db, currentInstallation.id);
      await refreshRuntime();
    } catch (restoreError) {
      setError(errorMessage(restoreError));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentInstallation() {
    if (!db) return;
    const confirmed = await confirmLifecycleAction(
      buildAppLifecycleConfirmation('delete-data', currentInstallation.label),
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAppInstallationAndData(db, currentInstallation.id, {
        confirmedInstallationId: currentInstallation.id,
        deleteData: true,
      });
      router.replace('/install');
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  }

  async function applyDataHomeSelection() {
    if (!db || !canApplyDataHomeSelection || !currentInstallation) return;
    setDataHomeBusy(true);
    setDataHomeError(null);
    try {
      const isNotion = selectedDataHomeAdapterId === 'notion';
      const isGoogleSheets = selectedDataHomeAdapterId === 'google_sheets';
      const token = isNotion ? settings.notion.token : isGoogleSheets ? settings.sheets.token : null;
      if (selectedDataHomeAdapterId !== 'sqlite' && !token) {
        throw new Error('data_home_token_missing_for_runtime');
      }
      if (selectedDataHomeAdapterId !== 'sqlite' && !isNotion && !isGoogleSheets) {
        throw new Error('data_home_provider_unsupported_for_runtime');
      }
      const externalId = isNotion
        ? settings.notion.pageId || 'notion'
        : isGoogleSheets
          ? settings.sheets.workbookId || 'google_sheets'
          : selectedDataHomeAdapterId;
      const next = await connectInstallationDataHome(db, {
        installationId: currentInstallation.id,
        provider: selectedDataHomeAdapterId,
        externalId,
        token,
        declaredDataHomes,
        providerOnline: targetSelection.readiness === 'ready',
      });
      setDataHomeState(next);
      await refreshRuntime();
    } catch (applyError) {
      setDataHomeError(errorMessage(applyError));
    } finally {
      setDataHomeBusy(false);
    }
  }

  function requestArchive() {
    void archiveCurrentInstallation();
  }

  function requestDelete() {
    void deleteCurrentInstallation();
  }

  return (
    <ScrollView
      accessibilityLabel={`${currentInstallation.label} app details`}
      {...mainAccessibilityRoleProps()}
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <ScreenHeading label={currentInstallation.label} />
      <Text accessibilityRole="header" style={styles.title} accessibilityLabel={`${currentInstallation.label} details`}>
        {currentInstallation.label}
      </Text>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>App Library</Text>
        <Text style={styles.subtitle}>{currentInstallation.id}</Text>
        <View style={styles.badgeRow}>
          <StatusBadge tone={lifecycle.statusTone} label={lifecycle.statusLabel} />
          <StatusBadge tone="unknown" label={lifecycle.canOpen ? 'Launchable' : 'Not launchable'} />
        </View>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Package key: ${lifecycle.packageKeyLabel}`} style={styles.meta}>
          {lifecycle.packageKeyLabel}
        </Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Package identity: ${lifecycle.packageIdLabel} ${lifecycle.versionLabel}`} style={styles.meta}>
          {lifecycle.packageIdLabel}@{lifecycle.versionLabel}
        </Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Source: ${lifecycle.sourceLabel}`} style={styles.meta}>
          {lifecycle.sourceLabel}
        </Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Checksum: ${lifecycle.checksumLabel}`} style={styles.meta}>
          {lifecycle.checksumLabel}
        </Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Approval: ${lifecycle.approvalLabel}`} style={styles.meta}>
          {lifecycle.approvalLabel}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data home</Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Current data home: ${currentDataHomeId}`} style={styles.sectionCopy}>
          Current: {currentDataHomeLabel}
        </Text>
        {currentSelection.status === 'blocked' ? (
          <Text accessible accessibilityRole="text" accessibilityLabel={`Data home blocked: ${currentSelection.reason}`} style={styles.error}>
            Blocked: {currentSelection.reason}
          </Text>
        ) : null}
        <View style={styles.row}>
          {dataHomeChoices.map((choice) => (
            <View key={choice.adapterId} style={styles.dataHomeOptionRow}>
              <Pressable
                accessibilityLabel={`Use ${choice.label} data home`}
                accessibilityRole="button"
                accessibilityState={{
                  selected: selectedDataHomeAdapterId === choice.adapterId,
                  disabled: dataHomeBusy || choice.adapterId === currentDataHomeId || !choice.canSelect,
                }}
                style={[
                  styles.secondaryButton,
                  (!choice.canSelect || dataHomeBusy || choice.adapterId === currentDataHomeId) ? styles.disabled : null,
                ]}
                onPress={() => setSelectedDataHomeAdapterId(choice.adapterId)}
                disabled={dataHomeBusy || choice.adapterId === currentDataHomeId || !choice.canSelect}
              >
                <Text style={styles.secondaryText}>{choice.label}</Text>
              </Pressable>
              <Text style={styles.sectionCopy}>{choice.reason}</Text>
            </View>
          ))}
        </View>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Switch reason: ${preview.reason}`} style={styles.sectionCopy}>
          {preview.exportRequired ? DATA_HOME_COPY.previewRemoteMigrationHint : 'No data movement required for this change.'}
          {` Export required: ${preview.exportRequired ? 'yes' : 'no'}.`}
        </Text>
        <View style={styles.row}>
          <Pressable
            accessibilityLabel={`Apply data home ${dataHomeLabel}`}
            accessibilityRole="button"
            accessibilityState={{
              selected: false,
              disabled: !canApplyDataHomeSelection || dataHomeBusy || busy,
            }}
            style={[styles.primaryButton, (!canApplyDataHomeSelection || dataHomeBusy || busy) ? styles.disabled : null]}
            onPress={() => void applyDataHomeSelection()}
            disabled={!canApplyDataHomeSelection || dataHomeBusy || busy}
          >
            <Text style={styles.primaryText}>Apply data home</Text>
          </Pressable>
        </View>
        {dataHomeError ? <Text style={styles.error}>{dataHomeError}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Lifecycle</Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={lifecycle.actionHint} style={styles.sectionCopy}>
          {lifecycle.actionHint}
        </Text>
        <Text accessible accessibilityRole="text" accessibilityLabel={`Launch path: ${lifecycle.launchPathLabel}`} style={styles.sectionCopy}>
          {lifecycle.launchPathLabel}
        </Text>
        <View style={styles.row}>
          {currentInstallation.status === 'archived' ? (
            <Pressable
              accessibilityLabel={`Restore ${currentInstallation.label}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              style={styles.secondaryButton}
              onPress={() => void restoreCurrentInstallation()}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>{lifecycle.actionLabel}</Text>
            </Pressable>
          ) : currentInstallation.status === 'active' ? (
            <Pressable
              accessibilityLabel={`Uninstall ${currentInstallation.label}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              style={styles.secondaryButton}
              onPress={() => void requestArchive()}
              disabled={busy}
            >
              <Text style={styles.secondaryText}>{lifecycle.actionLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={`Delete ${currentInstallation.label} and all local data`}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            style={styles.dangerButton}
            onPress={() => void requestDelete()}
            disabled={busy}
          >
            <Text style={styles.dangerText}>Delete app data</Text>
          </Pressable>
        </View>
      </View>

      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.stateText}>Working</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {currentInstallation.status === 'active' ? (
        activePackage ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>App content</Text>
            <JsonRenderRoute screen="home" />
          </View>
        ) : (
          <View style={styles.state}>
            <Text style={styles.title}>App unavailable</Text>
            <Text style={styles.stateText}>No active package is bound to this installation.</Text>
          </View>
        )
      ) : (
        <View style={styles.state}>
          <Text style={styles.title}>{currentInstallation.status === 'archived' ? 'Uninstalled' : 'Disabled'}</Text>
          <Text style={styles.stateText}>
            {currentInstallation.status === 'archived'
              ? 'Restore this app to open it again.'
              : 'Resolve the disabling reason before this app can run again.'}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function ScreenHeading({ label }: { label: string }) {
  if (Platform.OS === 'web') {
    return createElement('h1', {
      'aria-label': `App ${label}`,
      style: {
        position: 'absolute',
        left: '-10000px',
        top: 0,
        width: '1px',
        height: '1px',
        margin: '-1px',
        padding: 0,
        overflow: 'hidden',
      },
    }, label);
  }
  return (
    <Text
      accessibilityRole="header"
      accessible
      style={styles.srOnly}
      accessibilityLabel={`App ${label}`}
    >
      {label}
    </Text>
  );
}

function StatusBadge({ tone, label }: { tone: 'verified' | 'unknown' | 'blocked'; label: string }) {
  const badgeStyle = tone === 'verified'
    ? styles.verifiedBadge
    : tone === 'blocked'
      ? styles.blockedBadge
      : styles.unknownBadge;
  const textStyle = tone === 'verified'
    ? styles.verifiedBadgeText
    : tone === 'blocked'
      ? styles.blockedBadgeText
      : styles.unknownBadgeText;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.statusBadge, badgeStyle]}>
      <Text style={[styles.statusBadgeText, textStyle]}>{label}</Text>
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'app_installation_action_failed';
}

function currentDataHomeLabelFromId(adapterId: string): string {
  return adapterId === 'notion' ? 'Notion' : adapterId === 'google_sheets' ? 'Google Sheets' : 'Local SQLite';
}

function mainAccessibilityRoleProps() {
  return Platform.OS === 'web'
    ? { accessible: true, accessibilityRole: 'main' as AccessibilityRole }
    : {};
}

function manageIconName(isPhone: boolean): SymbolName {
  return isPhone
    ? { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }
    : { ios: 'gearshape', android: 'settings', web: 'settings' };
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

const styles = StyleSheet.create({
  appScreen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  manageButton: {
    position: 'absolute',
    right: 14,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  manageButtonDesktop: {
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  manageButtonPhone: {
    height: 40,
    width: 40,
  },
  manageButtonPressed: {
    opacity: 0.72,
  },
  manageIconFallback: {
    height: 20,
    width: 20,
  },
  manageTooltip: {
    position: 'absolute',
    right: 0,
    top: 46,
    borderRadius: 8,
    backgroundColor: colors.ink,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  manageButtonText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
  },
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
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: 16, padding: 18, paddingTop: 48 },
  hero: { gap: 8, borderColor: colors.line, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  eyebrow: { color: colors.moss, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
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
  subtitle: {
    color: colors.muted,
    textAlign: 'center',
  },
  section: { gap: 8, borderColor: colors.line, borderRadius: 8, borderWidth: 1, backgroundColor: colors.paper, padding: 12 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  sectionCopy: { color: colors.muted },
  meta: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  secondaryButton: { borderColor: colors.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  dangerButton: { borderColor: colors.red, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  secondaryText: { color: colors.ink, fontWeight: '900' },
  dangerText: { color: colors.red, fontWeight: '900' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  statusBadgeText: { fontSize: 12, fontWeight: '900' },
  verifiedBadge: { backgroundColor: colors.mossSoft, borderColor: colors.moss },
  verifiedBadgeText: { color: colors.moss },
  unknownBadge: { backgroundColor: colors.amberSoft, borderColor: colors.amber },
  unknownBadgeText: { color: colors.amber },
  blockedBadge: { backgroundColor: '#FBE1DD', borderColor: colors.red },
  blockedBadgeText: { color: colors.red },
  primaryButton: { borderRadius: 8, backgroundColor: colors.moss, paddingHorizontal: 14, paddingVertical: 11 },
  primaryText: { color: '#FFFFFF', fontWeight: '900' },
  disabled: { opacity: 0.5 },
  loading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  error: { color: colors.red, fontWeight: '700' },
  dataHomeOptionRow: { gap: 6 },
  srOnly: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: 'hidden',
  },
});
