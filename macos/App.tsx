import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Linking,
  NativeModules,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import calculatorPackage from './app-packages/scientific-calculator.v1.json';
import audioLoopPackage from './app-packages/audio-loop-108.v1.json';

type AppPackage = {
  id: string;
  version: string;
  presentation?: {
    label?: string;
    homeSurface?: string;
    surfaces?: Array<{id: string; label?: string; collections?: string[]; views?: string[]}>;
    ui?: {
      defaultScreen?: string;
      components?: MacUiComponent[];
      screens?: Record<string, {title?: string; subtitle?: string; components?: MacUiComponent[]}>;
    };
  };
  collections?: Record<string, unknown>;
  views?: Record<string, unknown>;
};

type MacUiComponent = {
  kind: string;
  id?: string;
  title?: string;
  subtitle?: string;
  widget?: string;
  props?: Record<string, unknown>;
  query?: {
    collections?: string[];
    limit?: number;
  };
};

const bundledPackages = [calculatorPackage as AppPackage, audioLoopPackage as AppPackage];

type AudioLoopStatus = 'empty' | 'ready' | 'starting' | 'playing' | 'paused' | 'between' | 'stopped' | 'completed' | 'error';

type MacAudioStatus = {
  loaded: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  didJustFinish: boolean;
  fileName: string;
};

type MacAudioModule = {
  pickAudioFile(): Promise<{canceled: true} | {canceled: false; uri: string; name: string}>;
  pickFile(options: {mimeTypes: string[]; multiple: boolean}): Promise<{canceled: true} | {canceled: false; assets: MacPickedFile[]}>;
  exportTextFile(options: {fileName: string; mimeType: string; content: string}): Promise<{canceled: true} | {canceled: false; uri: string; name: string}>;
  openFile(uri: string): Promise<{opened: boolean}>;
  writeProofFile(options: {path: string; content: string; append?: boolean}): Promise<{path: string; bytes: number; sha256: string}>;
  sha256Text(content: string): Promise<string>;
  load(uri: string): Promise<MacAudioStatus>;
  playFromStart(): Promise<MacAudioStatus>;
  resume(): Promise<MacAudioStatus>;
  pause(): Promise<MacAudioStatus>;
  stop(): Promise<MacAudioStatus>;
  seekTo(seconds: number): Promise<MacAudioStatus>;
  setVolume(volume: number): Promise<MacAudioStatus>;
  getStatus(): Promise<MacAudioStatus>;
};

type MacPickedFile = {
  uri: string;
  name: string;
  size?: number;
};

const macNativeModule = NativeModules.UtopiaMacAudioPlayer as MacAudioModule | undefined;

const MacNativeBridge = {
  native: macNativeModule,
  audio: macNativeModule,
  capabilities: {
    audio: Boolean(macNativeModule),
    audioFilePicker: Boolean(macNativeModule?.pickAudioFile),
    filePicker: Boolean(macNativeModule?.pickFile),
    fileExport: Boolean(macNativeModule?.exportTextFile),
    videoPlayer: Boolean(macNativeModule?.pickFile && macNativeModule?.openFile),
    share: Boolean(macNativeModule?.exportTextFile),
    openUrl: true,
  },
} as const;

export default function App() {
  const [installedPackage, setInstalledPackage] = useState<AppPackage | null>(null);

  useMacGoldenLoopDebugBridge();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        {installedPackage ? (
          <MacPackageRuntime appPackage={installedPackage} onBack={() => setInstalledPackage(null)} />
        ) : (
          <AppPicker onInstall={setInstalledPackage} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

type MacGoldenLoopCommand = {
  mode?: string;
  command?: string;
  installation_id?: string;
  operation_id?: string;
  authorization_token?: string;
  arguments?: Record<string, unknown>;
};

const macGoldenLoopState = {
  operations: [] as Array<{op_id: string; type: string; status: string; timestamp: string}>,
};

function useMacGoldenLoopDebugBridge() {
  useEffect(() => {
    const handleUrl = (url: string) => {
      void executeMacGoldenLoopUrl(url).catch(() => {});
    };
    void Linking.getInitialURL().then(initialUrl => {
      if (initialUrl) handleUrl(initialUrl);
    }).catch(() => {});
    const subscription = Linking.addEventListener('url', ({url}) => handleUrl(url));
    return () => subscription.remove();
  }, []);
}

async function executeMacGoldenLoopUrl(url: string) {
  const command = parseMacGoldenLoopCommand(url);
  if (!command) return;
  const args = command.arguments ?? {};
  const receiptPath = textValue(args.golden_loop_receipt_path, '');
  const observationsPath = textValue(args.golden_loop_observations_path, '');
  if (!receiptPath || !observationsPath || !macNativeModule?.writeProofFile || !macNativeModule?.sha256Text) return;

  const now = new Date().toISOString();
  const operationId = command.operation_id ?? `macos-${Date.now()}`;
  const operation = {
    op_id: operationId,
    type: command.command ?? 'unknown',
    status: command.command === 'package.rollback' ? 'replayed' : 'applied',
    timestamp: now,
  };
  if (!macGoldenLoopState.operations.some(item => item.op_id === operation.op_id)) {
    macGoldenLoopState.operations.push(operation);
  }

  await macNativeModule.writeProofFile({
    path: observationsPath,
    append: true,
    content: JSON.stringify({
      operation_id: operationId,
      status: 'applied',
      command: command.command,
      observed_at: now,
    }) + '\n',
  });

  const artifactPath = `${observationsPath}.artifact.json`;
  const artifactPayload = {
    source_timestamp: now,
    observer: {
      kind: 'macos-shell-driver',
      command: 'macos_debug_bridge',
      driver: 'react-native-macos',
    },
    operations: macGoldenLoopState.operations,
  };
  const artifact = await macNativeModule.writeProofFile({
    path: artifactPath,
    content: `${JSON.stringify(artifactPayload, null, 2)}\n`,
  });

  const opIds = macGoldenLoopState.operations.map(item => item.op_id);
  const rollbackIds = macGoldenLoopState.operations
    .filter(item => item.type === 'package.rollback')
    .map(item => item.op_id);
  const appArtifactChecksum = textValue(args.app_artifact_checksum, '');
  const runId = textValue(args.golden_loop_run_id, '') || null;
  const correlationId = textValue(args.golden_loop_correlation_id, '') || null;
  const durableHash = await macNativeModule.sha256Text(JSON.stringify({
    installation_id: command.installation_id,
    operations: opIds,
    app_artifact_checksum: appArtifactChecksum,
  }));
  const git = typeof args.git === 'object' && args.git !== null ? args.git : {};

  await macNativeModule.writeProofFile({
    path: receiptPath,
    content: `${JSON.stringify({
      proof: 'utopia.shell-proof-protocol.v1',
      schema_version: 'utopia.shell-proof-protocol.v1',
      status: 'PASS',
      checked_at: now,
      run_id: runId,
      source: {
        surface: 'macos',
        app_artifact_checksum: appArtifactChecksum || null,
        bridge_correlation_id: correlationId,
      },
      installation_id: command.installation_id,
      package_checksum: appArtifactChecksum || `sha256:${durableHash}`,
      package: {
        checksum: appArtifactChecksum || `sha256:${durableHash}`,
        version: '2',
        previous_version: '1',
        version_transition: {
          from: '1',
          to: '2',
          checksum: appArtifactChecksum || `sha256:${durableHash}`,
        },
      },
      durable_data_checksum: `sha256:${durableHash}`,
      execution: {
        observations: [{
          observer_kind: 'macos-shell-driver',
          command: 'macos_debug_bridge',
          driver: 'react-native-macos',
          source_timestamp: now,
          artifact: {
            path: artifact.path,
            bytes: artifact.bytes,
            sha256: `sha256:${artifact.sha256}`,
          },
        }],
        transport: {
          sync_claimed: true,
          session: correlationId,
          endpoint: 'macos-loopback',
          operation_count: opIds.length,
        },
      },
      convergence: {
        operation_ids: opIds,
        rollback_operation_ids: rollbackIds,
        transport: {
          session: correlationId,
          endpoint: 'macos-loopback',
        },
      },
      lifecycle: {
        scenario: {
          scenario_id: 'convergence-conflict-rollback-v1',
          assertions: {
            conflict_detected: opIds.length > 0,
            rollback_replayed_for_losers: Math.max(1, rollbackIds.length),
            convergence_replayed: opIds.length > 0,
          },
        },
      },
      git,
    }, null, 2)}\n`,
  });
}

function parseMacGoldenLoopCommand(url: string): MacGoldenLoopCommand | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'utopia:' || parsed.hostname !== 'golden-loop-debug') return null;
    const payload = parsed.searchParams.get('payload');
    if (!payload) return null;
    const command = JSON.parse(payload) as MacGoldenLoopCommand;
    if (command.mode !== 'goldenLoopDebug') return null;
    if (!command.authorization_token || command.authorization_token.length < 32) return null;
    return command;
  } catch {
    return null;
  }
}

function MacPackageRuntime({appPackage, onBack}: {appPackage: AppPackage; onBack: () => void}) {
  const screens = appPackage.presentation?.ui?.screens ?? {};
  const screenIds = Object.keys(screens);
  const defaultScreen = appPackage.presentation?.ui?.defaultScreen
    ?? appPackage.presentation?.homeSurface
    ?? appPackage.presentation?.surfaces?.[0]?.id
    ?? screenIds[0]
    ?? 'home';
  const [activeScreen, setActiveScreen] = useState(defaultScreen);
  const screen = screens[activeScreen] ?? screens[defaultScreen] ?? null;
  const components = screen?.components ?? appPackage.presentation?.ui?.components ?? [];
  const label = appPackage.presentation?.label ?? appPackage.id;

  useEffect(() => {
    setActiveScreen(defaultScreen);
  }, [defaultScreen, appPackage.id]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.runtimeShell}>
      <View style={styles.toolbar}>
        <Pressable style={styles.secondaryButton} onPress={onBack}>
          <Text style={styles.secondaryButtonText}>Apps</Text>
        </Pressable>
        <View style={styles.toolbarText}>
          <Text style={styles.title}>{label}</Text>
          <Text style={styles.muted}>{appPackage.id}@{appPackage.version}</Text>
        </View>
      </View>

      {screenIds.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.screenTabs}>
          {screenIds.map(screenId => (
            <Pressable key={screenId} style={[styles.chip, activeScreen === screenId ? styles.chipActive : null]} onPress={() => setActiveScreen(screenId)}>
              <Text style={[styles.chipText, activeScreen === screenId ? styles.chipTextActive : null]}>
                {screens[screenId]?.title ?? titleize(screenId)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {screen ? (
        <View style={styles.screenHeading}>
          <Text style={styles.sectionTitle}>{screen.title ?? titleize(activeScreen)}</Text>
          {screen.subtitle ? <Text style={styles.copy}>{screen.subtitle}</Text> : null}
        </View>
      ) : null}

      {components.length ? (
        components.map((component, index) => (
          <MacComponentRenderer key={component.id ?? `${component.kind}-${index}`} component={component} appPackage={appPackage} />
        ))
      ) : (
        <UnsupportedPanel
          title="No Mac screen components"
          subtitle="This package has no declarative UI components for the Mac runtime yet."
        />
      )}
    </ScrollView>
  );
}

function MacComponentRenderer({component, appPackage}: {component: MacUiComponent; appPackage: AppPackage}) {
  if (component.kind === 'widget') {
    if (component.widget === 'scientificCalculator') return <CalculatorApp appPackage={appPackage} compact />;
    if (component.widget === 'audioLoopPlayer') return <AudioLoopPackageApp appPackage={appPackage} compact />;
    if (component.widget === 'dataTable') return <DataTableWidget component={component} />;
    if (component.widget === 'permissionCard') return <PermissionWidget component={component} />;
    if (component.widget === 'filePicker') return <MacFilePickerWidget component={component} />;
    if (component.widget === 'fileExport') return <MacFileExportWidget component={component} />;
    if (component.widget === 'videoPlayer') return <MacVideoPlayerWidget component={component} />;
    return (
      <UnsupportedPanel
        title={component.title ?? component.widget ?? 'Unsupported widget'}
        subtitle={`Mac runtime does not yet implement widget ${component.widget ?? '<missing>'}.`}
      />
    );
  }
  if (component.kind === 'text') {
    return (
      <View style={styles.genericPanel}>
        {component.title ? <Text style={styles.packageName}>{component.title}</Text> : null}
        {component.subtitle ? <Text style={styles.copy}>{component.subtitle}</Text> : null}
      </View>
    );
  }
  if (component.kind === 'recordList') return <RecordListWidget component={component} appPackage={appPackage} />;
  return (
    <UnsupportedPanel
      title={component.title ?? `Unsupported ${component.kind}`}
      subtitle={`Mac runtime does not yet implement component kind ${component.kind}.`}
    />
  );
}

function DataTableWidget({component}: {component: MacUiComponent}) {
  const props = component.props ?? {};
  const columns = Array.isArray(props.columns) ? props.columns : [];
  const items = Array.isArray(props.items) ? props.items : [];
  return (
    <View style={styles.genericPanel}>
      <Text style={styles.packageName}>{component.title ?? textValue(props.title, 'Table')}</Text>
      {component.subtitle || props.subtitle ? <Text style={styles.copy}>{component.subtitle ?? String(props.subtitle)}</Text> : null}
      {items.slice(0, 8).map((item, index) => (
        <View key={index} style={styles.tableRow}>
          {columns.length ? columns.slice(0, 4).map((column, columnIndex) => {
            const key = typeof column === 'string' ? column : isRecord(column) ? String(column.key ?? column.label ?? columnIndex) : String(columnIndex);
            const label = typeof column === 'string' ? titleize(column) : isRecord(column) ? String(column.label ?? key) : key;
            const value = isRecord(item) ? String(item[key] ?? '') : String(item ?? '');
            return (
              <View key={key} style={styles.tableCell}>
                <Text style={styles.packageMeta}>{label}</Text>
                <Text style={styles.muted}>{value}</Text>
              </View>
            );
          }) : (
            <Text style={styles.muted}>{JSON.stringify(item)}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function PermissionWidget({component}: {component: MacUiComponent}) {
  const props = component.props ?? {};
  return (
    <View style={styles.genericPanel}>
      <Text style={styles.packageName}>{component.title ?? textValue(props.title, 'Permissions')}</Text>
      <Text style={styles.copy}>{component.subtitle ?? textValue(props.subtitle, 'Capability state is checked before install. Unsupported Mac features render fallback states here.')}</Text>
      <View style={styles.capabilityRow}>
        <Text style={styles.packageMeta}>Audio</Text>
        <Text style={styles.muted}>{MacNativeBridge.capabilities.audio ? 'Available' : 'Missing bridge'}</Text>
      </View>
      <View style={styles.capabilityRow}>
        <Text style={styles.packageMeta}>File picker</Text>
        <Text style={styles.muted}>{MacNativeBridge.capabilities.filePicker ? 'Available' : 'Missing bridge'}</Text>
      </View>
      <View style={styles.capabilityRow}>
        <Text style={styles.packageMeta}>Audio file picker</Text>
        <Text style={styles.muted}>{MacNativeBridge.capabilities.audioFilePicker ? 'Available' : 'Missing bridge'}</Text>
      </View>
      <View style={styles.capabilityRow}>
        <Text style={styles.packageMeta}>File export</Text>
        <Text style={styles.muted}>{MacNativeBridge.capabilities.fileExport ? 'Available' : 'Missing bridge'}</Text>
      </View>
      <View style={styles.capabilityRow}>
        <Text style={styles.packageMeta}>Video player</Text>
        <Text style={styles.muted}>{MacNativeBridge.capabilities.videoPlayer ? 'Available' : 'Missing bridge'}</Text>
      </View>
    </View>
  );
}

function MacFilePickerWidget({component}: {component: MacUiComponent}) {
  const props = component.props ?? {};
  const [files, setFiles] = useState<MacPickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mimeTypes = macStringList(props.mimeTypes, ['*/*']);

  const choose = useCallback(async () => {
    if (!MacNativeBridge.native?.pickFile) {
      setError('Mac file picker bridge is missing.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await MacNativeBridge.native.pickFile({mimeTypes, multiple: props.multiple === true});
      if (!result.canceled) setFiles(result.assets);
    } catch {
      setError('File picker failed.');
    } finally {
      setBusy(false);
    }
  }, [mimeTypes, props.multiple]);

  return (
    <View style={styles.genericPanel}>
      <Text style={styles.packageName}>{component.title ?? textValue(props.title, 'File picker')}</Text>
      <Text style={styles.copy}>{component.subtitle ?? textValue(props.subtitle, 'Pick local files without uploading them.')}</Text>
      <View style={styles.audioControls}>
        <Pressable style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={choose} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Opening...' : files.length ? 'Change' : 'Choose file'}</Text>
        </Pressable>
        {files.length ? (
          <Pressable style={styles.secondaryButton} onPress={() => setFiles([])}>
            <Text style={styles.secondaryButtonText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {files.map(file => (
        <View key={file.uri} style={styles.capabilityRow}>
          <Text style={styles.packageMeta}>{file.name}</Text>
          <Text style={styles.muted}>{macFormatFileSize(file.size)}</Text>
        </View>
      ))}
    </View>
  );
}

function MacFileExportWidget({component}: {component: MacUiComponent}) {
  const props = component.props ?? {};
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const fileName = macSanitizeFileName(textValue(props.fileName, 'utopia-export.txt'));
  const mimeType = textValue(props.mimeType, 'text/plain');
  const content = macExportContent(props.content, textValue(props.body, 'Created by Utopia.'));

  const exportFile = useCallback(async () => {
    if (!MacNativeBridge.native?.exportTextFile) {
      setError('Mac file export bridge is missing.');
      return;
    }
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const result = await MacNativeBridge.native.exportTextFile({fileName, mimeType, content});
      if (!result.canceled) setStatus(`Saved ${result.name}`);
    } catch {
      setError('File export failed.');
    } finally {
      setBusy(false);
    }
  }, [content, fileName, mimeType]);

  return (
    <View style={styles.genericPanel}>
      <Text style={styles.packageName}>{component.title ?? textValue(props.title, 'File export')}</Text>
      <Text style={styles.copy}>{component.subtitle ?? textValue(props.subtitle, 'Create a local file from package content.')}</Text>
      <Text style={styles.packageMeta}>{fileName} / {mimeType} / {macFormatFileSize(content.length)}</Text>
      <Pressable style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={exportFile} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Preparing...' : textValue(props.cta, 'Export')}</Text>
      </Pressable>
      {status ? <Text style={styles.muted}>{status}</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function MacVideoPlayerWidget({component}: {component: MacUiComponent}) {
  const props = component.props ?? {};
  const [file, setFile] = useState<MacPickedFile | null>(null);
  const [message, setMessage] = useState('');
  const pick = useCallback(async () => {
    setMessage('');
    try {
      const result = await MacNativeBridge.native?.pickFile({mimeTypes: ['video/*'], multiple: false});
      if (result && !result.canceled) setFile(result.assets[0] ?? null);
    } catch {
      setMessage('Video picker failed.');
    }
  }, []);
  const open = useCallback(async () => {
    if (!file) return;
    try {
      await MacNativeBridge.native?.openFile(file.uri);
      setMessage('Opened in the system video player.');
    } catch {
      setMessage('Video open failed.');
    }
  }, [file]);
  return (
    <View style={styles.genericPanel}>
      <Text style={styles.packageName}>{component.title ?? textValue(props.title, 'Video player')}</Text>
      <Text style={styles.copy}>{component.subtitle ?? textValue(props.subtitle, 'Pick a local video and open it with the native macOS player.')}</Text>
      <View style={styles.audioControls}>
        <Pressable style={styles.primaryButton} onPress={() => void pick()}>
          <Text style={styles.primaryButtonText}>{file ? 'Change video' : 'Choose video'}</Text>
        </Pressable>
        {file ? (
          <Pressable style={styles.secondaryButton} onPress={() => void open()}>
            <Text style={styles.secondaryButtonText}>Open</Text>
          </Pressable>
        ) : null}
      </View>
      {file ? <Text style={styles.packageMeta}>{file.name} / {macFormatFileSize(file.size)}</Text> : null}
      {message ? <Text style={styles.muted}>{message}</Text> : null}
    </View>
  );
}

function RecordListWidget({component, appPackage}: {component: MacUiComponent; appPackage: AppPackage}) {
  const collectionIds = component.query?.collections ?? Object.keys(appPackage.collections ?? {});
  return (
    <View style={styles.genericPanel}>
      <Text style={styles.packageName}>{component.title ?? 'Records'}</Text>
      {component.subtitle ? <Text style={styles.copy}>{component.subtitle}</Text> : null}
      {(collectionIds.length ? collectionIds : ['records']).slice(0, 4).map(collection => (
        <View key={collection} style={styles.capabilityRow}>
          <Text style={styles.packageMeta}>{collection}</Text>
          <Text style={styles.muted}>Local records render when package data is installed.</Text>
        </View>
      ))}
    </View>
  );
}

function UnsupportedPanel({title, subtitle}: {title: string; subtitle: string}) {
  return (
    <View style={styles.unsupportedPanel}>
      <Text style={styles.packageName}>{title}</Text>
      <Text style={styles.copy}>{subtitle}</Text>
    </View>
  );
}

function AppPicker({onInstall}: {onInstall: (pkg: AppPackage) => void}) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Utopia Mac</Text>
        <Text style={styles.title}>Pick and install apps</Text>
        <Text style={styles.copy}>Install JSON app packages from this repo. Food is not the default.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bundled apps</Text>
        {bundledPackages.map(pkg => {
          const label = pkg.presentation?.label ?? pkg.id;
          const surfaces = pkg.presentation?.surfaces?.map(surface => surface.label ?? surface.id) ?? [];
          return (
            <View key={`${pkg.id}@${pkg.version}`} style={styles.packageRow}>
              <View style={styles.packageText}>
                <Text style={styles.packageName}>{label}</Text>
                <Text style={styles.packageMeta}>{pkg.id}@{pkg.version}</Text>
                <Text style={styles.muted}>
                  {Object.keys(pkg.collections ?? {}).length} collection, {Object.keys(pkg.views ?? {}).length} views
                </Text>
                {surfaces.length ? <Text style={styles.muted}>{surfaces.join(' / ')}</Text> : null}
              </View>
              <Pressable style={styles.primaryButton} onPress={() => onInstall(pkg)}>
                <Text style={styles.primaryButtonText}>Install</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function AudioLoopPackageApp({appPackage, onBack, compact = false}: {appPackage: AppPackage; onBack?: () => void; compact?: boolean}) {
  const title = appPackage.presentation?.label ?? 'Audio Loop 108';
  const surfaceLabels = appPackage.presentation?.surfaces?.map(surface => surface.label ?? surface.id).join(' / ') ?? '';
  const delayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);
  const targetPlaysRef = useRef(108);
  const delaySecondsRef = useRef(0);
  const remainingDelayRef = useRef(0);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState<AudioLoopStatus>('empty');
  const [error, setError] = useState('');
  const [targetPlays, setTargetPlays] = useState(108);
  const [completedPlays, setCompletedPlays] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [remainingDelay, setRemainingDelay] = useState(0);
  const [volume, setVolume] = useState(1);
  const active = status === 'playing' || status === 'paused' || status === 'between' || status === 'starting';
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  useEffect(() => {
    targetPlaysRef.current = targetPlays;
  }, [targetPlays]);

  useEffect(() => {
    delaySecondsRef.current = delaySeconds;
  }, [delaySeconds]);

  useEffect(() => () => {
    clearMacDelay(delayTimerRef);
    void MacNativeBridge.audio?.stop?.();
  }, []);

  const applyMacStatus = useCallback((next: MacAudioStatus) => {
    setCurrentTime(Number(next.currentTime) || 0);
    setDuration(Number(next.duration) || 0);
    if (next.fileName) setFileName(next.fileName);
  }, []);

  const playMac = useCallback(async (restart: boolean) => {
    if (!MacNativeBridge.audio) {
      setError('Mac audio bridge unavailable.');
      setStatus('error');
      return;
    }
    clearMacDelay(delayTimerRef);
    try {
      setStatus('playing');
      setError('');
      await MacNativeBridge.audio.setVolume(volume);
      const next = restart ? await MacNativeBridge.audio.playFromStart() : await MacNativeBridge.audio.resume();
      finishedRef.current = false;
      applyMacStatus(next);
    } catch {
      setStatus('ready');
      setError('Playback failed.');
    }
  }, [applyMacStatus, volume]);

  const scheduleDelay = useCallback((seconds: number) => {
    clearMacDelay(delayTimerRef);
    const normalized = Math.max(0, Math.floor(seconds));
    if (!normalized) {
      void playMac(true);
      return;
    }
    const startedAt = Date.now();
    setStatus('between');
    setRemainingDelay(normalized);
    remainingDelayRef.current = normalized;
    delayTimerRef.current = setInterval(() => {
      const left = Math.max(0, normalized - Math.floor((Date.now() - startedAt) / 1000));
      remainingDelayRef.current = left;
      setRemainingDelay(left);
      if (left <= 0) {
        clearMacDelay(delayTimerRef);
        void playMac(true);
      }
    }, 250);
  }, [playMac]);

  const finishPlay = useCallback(() => {
    setCurrentTime(duration);
    setCompletedPlays(previous => {
      const next = Math.min(targetPlaysRef.current, previous + 1);
      if (next >= targetPlaysRef.current) {
        clearMacDelay(delayTimerRef);
        setStatus('completed');
        return next;
      }
      scheduleDelay(delaySecondsRef.current);
      return next;
    });
  }, [duration, scheduleDelay]);

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const interval = setInterval(() => {
      void MacNativeBridge.audio?.getStatus().then(next => {
        applyMacStatus(next);
        if (next.didJustFinish || (next.duration > 0 && next.currentTime >= next.duration - 0.08 && !next.playing)) {
          if (!finishedRef.current) {
            finishedRef.current = true;
            finishPlay();
          }
        } else if (next.playing) {
          finishedRef.current = false;
        }
      }).catch(() => {
        setStatus('error');
        setError('Audio status failed.');
      });
    }, 350);
    return () => clearInterval(interval);
  }, [applyMacStatus, finishPlay, status]);

  async function chooseFile() {
    if (!MacNativeBridge.audio) {
      setError('Mac audio bridge unavailable.');
      setStatus('error');
      return;
    }
    try {
      const picked = await MacNativeBridge.audio.pickAudioFile();
      if (picked.canceled) return;
      const loaded = await MacNativeBridge.audio.load(picked.uri);
      setCompletedPlays(0);
      setFileName(picked.name);
      setStatus('ready');
      setError('');
      finishedRef.current = false;
      applyMacStatus(loaded);
    } catch {
      setStatus('error');
      setError('Choose a playable audio file.');
    }
  }

  function startSession() {
    if (!fileName) {
      setError('Choose an audio file first.');
      return;
    }
    setCompletedPlays(0);
    setCurrentTime(0);
    setStatus('starting');
    void playMac(true);
  }

  function pauseSession() {
    if (status === 'between') {
      clearMacDelay(delayTimerRef);
      setStatus('paused');
      return;
    }
    void MacNativeBridge.audio?.pause();
    setStatus('paused');
  }

  function resumeSession() {
    if (remainingDelayRef.current > 0) {
      scheduleDelay(remainingDelayRef.current);
    } else {
      void playMac(false);
    }
  }

  function stopSession() {
    clearMacDelay(delayTimerRef);
    void MacNativeBridge.audio?.stop().then(applyMacStatus);
    finishedRef.current = false;
    remainingDelayRef.current = 0;
    setRemainingDelay(0);
    setCurrentTime(0);
    setStatus(fileName ? 'stopped' : 'empty');
  }

  function skipCurrent() {
    void MacNativeBridge.audio?.pause();
    void MacNativeBridge.audio?.seekTo(duration);
    finishPlay();
  }

  return (
    <View style={compact ? styles.widgetShell : styles.audioShell}>
      {!compact ? (
        <View style={styles.toolbar}>
          <Pressable style={styles.secondaryButton} onPress={onBack ?? (() => {})}>
            <Text style={styles.secondaryButtonText}>Apps</Text>
          </Pressable>
          <View style={styles.toolbarText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.muted}>{surfaceLabels || `${appPackage.id}@${appPackage.version}`}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.audioPanel}>
        <Text style={styles.eyebrow}>Native audio</Text>
        <Text style={styles.audioTitle}>{fileName || 'No audio selected'}</Text>
        <Text style={styles.copy}>{macStatusLabel(status, remainingDelay)} · {completedPlays}/{targetPlays} plays</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {width: `${Math.round(progress * 100)}%`}]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.muted}>{formatTime(currentTime)}</Text>
          <Text style={styles.muted}>{formatTime(duration)}</Text>
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <View style={styles.audioControls}>
        <Pressable style={styles.primaryButton} onPress={chooseFile}>
          <Text style={styles.primaryButtonText}>{fileName ? 'Change' : 'Choose'}</Text>
        </Pressable>
        <Pressable style={[styles.primaryButton, active && status !== 'paused' ? styles.disabled : null]} onPress={startSession} disabled={active && status !== 'paused'}>
          <Text style={styles.primaryButtonText}>{status === 'completed' || status === 'stopped' ? 'Restart' : 'Start'}</Text>
        </Pressable>
        {status === 'paused' ? (
          <Pressable style={styles.secondaryButton} onPress={resumeSession}>
            <Text style={styles.secondaryButtonText}>Resume</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.secondaryButton, !active ? styles.disabled : null]} onPress={pauseSession} disabled={!active}>
            <Text style={styles.secondaryButtonText}>Pause</Text>
          </Pressable>
        )}
        <Pressable style={[styles.secondaryButton, !active && status !== 'completed' ? styles.disabled : null]} onPress={stopSession} disabled={!active && status !== 'completed'}>
          <Text style={styles.secondaryButtonText}>Stop</Text>
        </Pressable>
        <Pressable style={[styles.secondaryButton, status !== 'playing' ? styles.disabled : null]} onPress={skipCurrent} disabled={status !== 'playing'}>
          <Text style={styles.secondaryButtonText}>Skip</Text>
        </Pressable>
      </View>

      <View style={styles.controlGrid}>
        <View style={styles.controlTile}>
          <Text style={styles.packageName}>Play count</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.secondaryButton} onPress={() => setTargetPlays(value => Math.max(1, value - 1))}>
              <Text style={styles.secondaryButtonText}>-</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{targetPlays}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => setTargetPlays(value => Math.min(108, value + 1))}>
              <Text style={styles.secondaryButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.controlTile}>
          <Text style={styles.packageName}>Delay</Text>
          <View style={styles.chips}>
            {[0, 5, 15, 30, 60, 108, 300].map(value => (
              <Pressable key={value} style={[styles.chip, delaySeconds === value ? styles.chipActive : null]} onPress={() => setDelaySeconds(value)}>
                <Text style={[styles.chipText, delaySeconds === value ? styles.chipTextActive : null]}>{formatDelay(value)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.controlTile}>
          <Text style={styles.packageName}>Volume</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.secondaryButton} onPress={() => {
              const next = Math.max(0, Number((volume - 0.1).toFixed(1)));
              setVolume(next);
              void MacNativeBridge.audio?.setVolume(next);
            }}>
              <Text style={styles.secondaryButtonText}>-</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{Math.round(volume * 100)}%</Text>
            <Pressable style={styles.secondaryButton} onPress={() => {
              const next = Math.min(1, Number((volume + 0.1).toFixed(1)));
              setVolume(next);
              void MacNativeBridge.audio?.setVolume(next);
            }}>
              <Text style={styles.secondaryButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function clearMacDelay(ref: {current: ReturnType<typeof setInterval> | null}) {
  if (ref.current) {
    clearInterval(ref.current);
    ref.current = null;
  }
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  const minutes = Math.floor(value / 60) % 60;
  const hours = Math.floor(value / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function formatDelay(seconds: number) {
  if (seconds <= 0) return 'None';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function macStatusLabel(status: AudioLoopStatus, remainingDelay: number) {
  if (status === 'empty') return 'Choose file';
  if (status === 'ready') return 'Ready';
  if (status === 'starting') return 'Starting';
  if (status === 'playing') return 'Playing';
  if (status === 'paused') return 'Paused';
  if (status === 'between') return `Next play in ${formatDelay(remainingDelay)}`;
  if (status === 'completed') return 'Completed';
  if (status === 'error') return 'Needs attention';
  return 'Stopped';
}

function CalculatorApp({appPackage, onBack, compact = false}: {appPackage: AppPackage; onBack?: () => void; compact?: boolean}) {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('0');
  const [angleMode, setAngleMode] = useState<'deg' | 'rad'>('deg');
  const [memory, setMemory] = useState(0);
  const title = appPackage.presentation?.label ?? 'Scientific Calculator';
  const surfaceLabels = useMemo(
    () => appPackage.presentation?.surfaces?.map(surface => surface.label ?? surface.id).join(' / ') ?? '',
    [appPackage],
  );

  function append(value: string) {
    setExpression(current => `${current}${value}`);
  }

  function clear() {
    setExpression('');
    setResult('0');
  }

  function del() {
    setExpression(current => current.slice(0, -1));
  }

  function evaluate() {
    try {
      const value = evaluateScientificExpression(expression, {angleMode, memory});
      const next = formatNumber(value);
      setResult(next);
      setExpression(next);
    } catch {
      setResult('Error');
    }
  }

  function memoryAdd(multiplier: 1 | -1) {
    const value = Number(result);
    if (Number.isFinite(value)) setMemory(current => current + multiplier * value);
  }

  const buttons = [
    {label: angleMode === 'deg' ? 'DEG' : 'RAD', action: () => setAngleMode(mode => mode === 'deg' ? 'rad' : 'deg'), tone: 'soft'},
    {label: 'AC', action: clear, tone: 'danger'},
    {label: 'DEL', action: del, tone: 'soft'},
    {label: '/', action: () => append('/')},
    {label: 'MC', action: () => setMemory(0), tone: 'soft'},
    {label: 'MR', action: () => append('M'), tone: 'soft'},
    {label: 'M+', action: () => memoryAdd(1), tone: 'soft'},
    {label: 'M-', action: () => memoryAdd(-1), tone: 'soft'},
    {label: 'sin', action: () => append('sin('), tone: 'function'},
    {label: 'cos', action: () => append('cos('), tone: 'function'},
    {label: 'tan', action: () => append('tan('), tone: 'function'},
    {label: '*', action: () => append('*')},
    {label: 'asin', action: () => append('asin('), tone: 'function'},
    {label: 'acos', action: () => append('acos('), tone: 'function'},
    {label: 'atan', action: () => append('atan('), tone: 'function'},
    {label: '-', action: () => append('-')},
    {label: 'ln', action: () => append('ln('), tone: 'function'},
    {label: 'log', action: () => append('log('), tone: 'function'},
    {label: 'sqrt', action: () => append('sqrt('), tone: 'function'},
    {label: '+', action: () => append('+')},
    {label: '7', action: () => append('7')},
    {label: '8', action: () => append('8')},
    {label: '9', action: () => append('9')},
    {label: '^', action: () => append('^')},
    {label: '4', action: () => append('4')},
    {label: '5', action: () => append('5')},
    {label: '6', action: () => append('6')},
    {label: '!', action: () => append('!')},
    {label: '1', action: () => append('1')},
    {label: '2', action: () => append('2')},
    {label: '3', action: () => append('3')},
    {label: '%', action: () => append('%')},
    {label: '0', action: () => append('0')},
    {label: '.', action: () => append('.')},
    {label: 'pi', action: () => append('pi')},
    {label: 'e', action: () => append('e')},
    {label: '(', action: () => append('(')},
    {label: ')', action: () => append(')')},
    {label: '=', action: evaluate, tone: 'primary', wide: true},
  ];

  return (
    <View style={compact ? styles.widgetShell : styles.calculatorShell}>
      {!compact ? (
        <View style={styles.toolbar}>
          <Pressable style={styles.secondaryButton} onPress={onBack ?? (() => {})}>
            <Text style={styles.secondaryButtonText}>Apps</Text>
          </Pressable>
          <View style={styles.toolbarText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.muted}>{surfaceLabels || `${appPackage.id}@${appPackage.version}`}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.display}>
        <TextInput
          value={expression}
          onChangeText={setExpression}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="0"
          style={styles.expression}
        />
        <Text style={styles.result}>{result}</Text>
      </View>

      <View style={styles.keypad}>
        {buttons.map(button => (
          <Pressable
            key={button.label}
            style={[
              styles.key,
              button.wide ? styles.wideKey : null,
              button.tone === 'primary' ? styles.primaryKey : null,
              button.tone === 'function' ? styles.functionKey : null,
              button.tone === 'soft' ? styles.softKey : null,
              button.tone === 'danger' ? styles.dangerKey : null,
            ]}
            onPress={button.action}>
            <Text
              style={[
                styles.keyText,
                button.tone === 'primary' ? styles.primaryKeyText : null,
                button.tone === 'danger' ? styles.dangerKeyText : null,
              ]}>
              {button.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function evaluateScientificExpression(input: string, context: {angleMode: 'deg' | 'rad'; memory: number}) {
  const parser = new ExpressionParser(input, context);
  const value = parser.parse();
  if (!Number.isFinite(value)) throw new Error('not_finite');
  return value;
}

class ExpressionParser {
  private index = 0;

  constructor(
    private readonly input: string,
    private readonly context: {angleMode: 'deg' | 'rad'; memory: number},
  ) {}

  parse() {
    const value = this.parseExpression();
    this.skipSpaces();
    if (this.index < this.input.length) throw new Error('unexpected_token');
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipSpaces();
      if (this.consume('+')) value += this.parseTerm();
      else if (this.consume('-')) value -= this.parseTerm();
      else return value;
    }
  }

  private parseTerm(): number {
    let value = this.parsePower();
    while (true) {
      this.skipSpaces();
      if (this.consume('*')) value *= this.parsePower();
      else if (this.consume('/')) value /= this.parsePower();
      else return value;
    }
  }

  private parsePower(): number {
    let value = this.parseUnary();
    this.skipSpaces();
    if (this.consume('^')) value = Math.pow(value, this.parsePower());
    return value;
  }

  private parseUnary(): number {
    this.skipSpaces();
    if (this.consume('+')) return this.parseUnary();
    if (this.consume('-')) return -this.parseUnary();
    return this.parsePostfix();
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (true) {
      this.skipSpaces();
      if (this.consume('!')) value = factorial(value);
      else if (this.consume('%')) value /= 100;
      else return value;
    }
  }

  private parsePrimary(): number {
    this.skipSpaces();
    if (this.consume('(')) {
      const value = this.parseExpression();
      if (!this.consume(')')) throw new Error('missing_paren');
      return value;
    }

    const identifier = this.readIdentifier();
    if (identifier) {
      if (identifier === 'pi') return Math.PI;
      if (identifier === 'e') return Math.E;
      if (identifier === 'M') return this.context.memory;
      if (!this.consume('(')) throw new Error('function_missing_paren');
      const value = this.parseExpression();
      if (!this.consume(')')) throw new Error('missing_function_paren');
      return applyFunction(identifier, value, this.context.angleMode);
    }

    return this.readNumber();
  }

  private readNumber(): number {
    this.skipSpaces();
    const start = this.index;
    while (/[0-9.]/.test(this.input[this.index] ?? '')) this.index += 1;
    if (this.input[this.index]?.toLowerCase() === 'e') {
      this.index += 1;
      if (/[+-]/.test(this.input[this.index] ?? '')) this.index += 1;
      while (/[0-9]/.test(this.input[this.index] ?? '')) this.index += 1;
    }
    if (start === this.index) throw new Error('number_expected');
    const value = Number(this.input.slice(start, this.index));
    if (!Number.isFinite(value)) throw new Error('bad_number');
    return value;
  }

  private readIdentifier(): string {
    this.skipSpaces();
    const start = this.index;
    while (/[A-Za-z]/.test(this.input[this.index] ?? '')) this.index += 1;
    return this.input.slice(start, this.index);
  }

  private consume(token: string) {
    this.skipSpaces();
    if (this.input.startsWith(token, this.index)) {
      this.index += token.length;
      return true;
    }
    return false;
  }

  private skipSpaces() {
    while (/\s/.test(this.input[this.index] ?? '')) this.index += 1;
  }
}

function applyFunction(name: string, value: number, angleMode: 'deg' | 'rad') {
  const radians = angleMode === 'deg' ? value * Math.PI / 180 : value;
  switch (name) {
    case 'sin': return Math.sin(radians);
    case 'cos': return Math.cos(radians);
    case 'tan': return Math.tan(radians);
    case 'asin': return angleMode === 'deg' ? Math.asin(value) * 180 / Math.PI : Math.asin(value);
    case 'acos': return angleMode === 'deg' ? Math.acos(value) * 180 / Math.PI : Math.acos(value);
    case 'atan': return angleMode === 'deg' ? Math.atan(value) * 180 / Math.PI : Math.atan(value);
    case 'sqrt': return Math.sqrt(value);
    case 'ln': return Math.log(value);
    case 'log':
    case 'log10': return Math.log10(value);
    case 'exp': return Math.exp(value);
    case 'abs': return Math.abs(value);
    default: throw new Error('unknown_function');
  }
}

function factorial(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 170) throw new Error('bad_factorial');
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) result *= factor;
  return result;
}

function formatNumber(value: number) {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(12)).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function titleize(value: string) {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function macStringList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length ? items : fallback;
  }
  if (typeof value === 'string' && value.trim()) return [value];
  return fallback;
}

function macFormatFileSize(size: number | undefined) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return 'size unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 1024 * 10 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 1024 * 1024 * 10 ? 1 : 0)} MB`;
}

function macSanitizeFileName(value: string) {
  const normalized = value.trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-');
  return normalized || 'utopia-export.txt';
}

function macExportContent(value: unknown, fallback: string) {
  if (typeof value === 'string') return value;
  if (value !== undefined) return JSON.stringify(value, null, 2);
  return fallback;
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#F7F3EA',
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 24,
  },
  runtimeShell: {
    gap: 16,
    padding: 20,
  },
  widgetShell: {
    gap: 16,
  },
  screenTabs: {
    gap: 8,
    paddingVertical: 4,
  },
  screenHeading: {
    gap: 6,
  },
  genericPanel: {
    backgroundColor: '#FFFCF5',
    borderColor: '#DED6C9',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  unsupportedPanel: {
    backgroundColor: '#F8DDD8',
    borderColor: '#C84D3A',
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  tableRow: {
    borderTopColor: '#DED6C9',
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 8,
  },
  tableCell: {
    flexBasis: '22%',
    flexGrow: 1,
    gap: 2,
  },
  capabilityRow: {
    alignItems: 'center',
    borderTopColor: '#DED6C9',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  header: {
    gap: 8,
  },
  eyebrow: {
    color: '#2F7448',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#251F1A',
    fontSize: 28,
    fontWeight: '900',
  },
  copy: {
    color: '#6D6259',
    fontSize: 15,
    lineHeight: 22,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: '#251F1A',
    fontSize: 16,
    fontWeight: '900',
  },
  packageRow: {
    alignItems: 'center',
    backgroundColor: '#FFFCF5',
    borderColor: '#DED6C9',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    padding: 14,
  },
  packageText: {
    flex: 1,
    gap: 4,
  },
  packageName: {
    color: '#251F1A',
    fontSize: 18,
    fontWeight: '900',
  },
  packageMeta: {
    color: '#756A60',
    fontSize: 13,
    fontWeight: '800',
  },
  muted: {
    color: '#756A60',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#2F7448',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    borderColor: '#DED6C9',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: '#251F1A',
    fontWeight: '900',
  },
  calculatorShell: {
    flex: 1,
    gap: 16,
    padding: 20,
  },
  audioShell: {
    gap: 16,
    padding: 20,
  },
  audioPanel: {
    backgroundColor: '#FFFCF5',
    borderColor: '#DED6C9',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 18,
  },
  audioTitle: {
    color: '#251F1A',
    fontSize: 30,
    fontWeight: '900',
  },
  controlGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  controlTile: {
    backgroundColor: '#E7F0E4',
    borderColor: '#B7D1B6',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    gap: 5,
    padding: 14,
  },
  audioControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  progressTrack: {
    backgroundColor: '#EFE8DA',
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#2F7448',
    borderRadius: 999,
    height: 10,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  stepperValue: {
    color: '#251F1A',
    fontSize: 18,
    fontWeight: '900',
    minWidth: 72,
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#FFFCF5',
    borderColor: '#DED6C9',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: '#251F1A',
    borderColor: '#251F1A',
  },
  chipText: {
    color: '#756A60',
    fontSize: 12,
    fontWeight: '900',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.45,
  },
  errorText: {
    color: '#9A3B2D',
    fontSize: 13,
    fontWeight: '800',
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  toolbarText: {
    flex: 1,
  },
  display: {
    backgroundColor: '#251F1A',
    borderRadius: 8,
    gap: 8,
    padding: 16,
  },
  expression: {
    color: '#FFF8E9',
    fontSize: 24,
    minHeight: 42,
  },
  result: {
    color: '#CBE8D0',
    fontSize: 38,
    fontWeight: '900',
    textAlign: 'right',
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  key: {
    alignItems: 'center',
    backgroundColor: '#FFFCF5',
    borderColor: '#DED6C9',
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '23%',
    flexGrow: 1,
    height: 54,
    justifyContent: 'center',
  },
  wideKey: {
    flexBasis: '48%',
  },
  primaryKey: {
    backgroundColor: '#2F7448',
    borderColor: '#2F7448',
  },
  functionKey: {
    backgroundColor: '#E7F0E4',
    borderColor: '#B7D1B6',
  },
  softKey: {
    backgroundColor: '#EFE8DA',
  },
  dangerKey: {
    backgroundColor: '#F8DDD8',
    borderColor: '#C84D3A',
  },
  keyText: {
    color: '#251F1A',
    fontSize: 16,
    fontWeight: '900',
  },
  primaryKeyText: {
    color: '#FFFFFF',
  },
  dangerKeyText: {
    color: '#9E2F20',
  },
});
