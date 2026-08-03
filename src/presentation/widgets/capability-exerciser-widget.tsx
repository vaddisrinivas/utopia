import type { ComponentRenderProps } from '@json-render/react-native';
import * as React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CapabilityDiagnosticRuntimeState } from '@/packages/shared/contracts/ui-widgets';
import { useAppRuntime } from '@/src/domain/runtime-context';
import {
  createAudioLoopRecorderDriver,
} from '@/src/presentation/widget-native-bridges';
import {
  requestWidgetCapability,
  type WidgetCapabilityRuntime,
} from '@/src/presentation/widgets/package-capability-broker';
import {
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';

export const CAPABILITY_EXERCISER_IDS = [
  'microphone',
  'background_task',
  'health',
  'deep_link',
  'file_open',
  'shortcut',
] as const;

export type CapabilityExerciserId = typeof CAPABILITY_EXERCISER_IDS[number];

type CapabilityExerciserAction =
  | 'microphone'
  | 'background_task'
  | 'health'
  | 'deep_link'
  | 'file_open'
  | 'shortcut';

export type CapabilityExerciserProbe = Readonly<{
  capabilityId: CapabilityExerciserId;
  title: string;
  detail: string;
  action: CapabilityExerciserAction;
  cta: string;
  url?: string;
}>;

type ProbeStatus = Readonly<{
  state: CapabilityDiagnosticRuntimeState;
  detail: string;
  observedAt?: string;
}>;

const DEFAULT_PROBES: readonly CapabilityExerciserProbe[] = [
  {
    capabilityId: 'microphone',
    title: 'Microphone',
    detail: 'Requests recorder consent through the package capability broker, then starts and stops one explicit recorder session if granted.',
    action: 'microphone',
    cta: 'Run microphone probe',
  },
  {
    capabilityId: 'background_task',
    title: 'Background task',
    detail: 'Checks the declared background-task intent and loads TaskManager on demand. It does not claim OS background execution.',
    action: 'background_task',
    cta: 'Check background task',
  },
  {
    capabilityId: 'health',
    title: 'Health',
    detail: 'Requests Android Health Connect access through the existing Health bridge. Other shells report unavailable.',
    action: 'health',
    cta: 'Choose health access',
  },
  {
    capabilityId: 'deep_link',
    title: 'Deep link',
    detail: 'Opens the declared self link through React Native Linking. Failure remains visible as blocked/interrupted.',
    action: 'deep_link',
    cta: 'Open self link',
    url: 'utopia://capability-lab/matrix?source=capability-lab',
  },
  {
    capabilityId: 'file_open',
    title: 'File open',
    detail: 'Verifies the declared inbound file-open intent. The current app cannot safely inject an OS file-open event from inside itself.',
    action: 'file_open',
    cta: 'Check file-open path',
  },
  {
    capabilityId: 'shortcut',
    title: 'Shortcut',
    detail: 'Verifies the declared shortcut intent. Native shortcut publishing remains blocked until a shell adapter exists.',
    action: 'shortcut',
    cta: 'Check shortcut path',
  },
] as const;

export function isCapabilityExerciserId(value: unknown): value is CapabilityExerciserId {
  return typeof value === 'string' && (CAPABILITY_EXERCISER_IDS as readonly string[]).includes(value);
}

export function resolveCapabilityExerciserProbes(value: unknown): CapabilityExerciserProbe[] {
  if (!Array.isArray(value)) return [...DEFAULT_PROBES];
  const parsed = value.flatMap((item): CapabilityExerciserProbe[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (!isCapabilityExerciserId(record.capabilityId) || !isCapabilityExerciserAction(record.action)) return [];
    const fallback = DEFAULT_PROBES.find((probe) => probe.capabilityId === record.capabilityId);
    return [{
      capabilityId: record.capabilityId,
      title: text(record.title, fallback?.title ?? titleize(record.capabilityId)),
      detail: text(record.detail, fallback?.detail ?? 'Run this probe explicitly.'),
      action: record.action,
      cta: text(record.cta, fallback?.cta ?? 'Run probe'),
      url: text(record.url, fallback?.url),
    }];
  });
  return parsed.length ? parsed : [...DEFAULT_PROBES];
}

export function CapabilityExerciserWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = (element.props ?? {}) as WidgetProps & Record<string, unknown>;
  const runtime = useAppRuntime();
  const probes = resolveCapabilityExerciserProbes(props.probes);
  const [statuses, setStatuses] = React.useState<Record<string, ProbeStatus>>({});
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const setProbeStatus = React.useCallback((capabilityId: CapabilityExerciserId, status: ProbeStatus) => {
    setStatuses((current) => ({
      ...current,
      [capabilityId]: {
        ...status,
        observedAt: status.observedAt ?? new Date().toISOString(),
      },
    }));
  }, []);

  const runProbe = React.useCallback(async (probe: CapabilityExerciserProbe) => {
    setBusyId(probe.capabilityId);
    setProbeStatus(probe.capabilityId, {
      state: 'requested',
      detail: `${probe.title} requested by user action.`,
    });
    try {
      const result = await runCapabilityProbe(probe, runtime);
      setProbeStatus(probe.capabilityId, result);
    } catch (error) {
      setProbeStatus(probe.capabilityId, {
        state: 'interrupted',
        detail: error instanceof Error ? error.message : `${probe.title} probe interrupted.`,
      });
    } finally {
      setBusyId(null);
    }
  }, [runtime, setProbeStatus]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{text(props.title, 'Capability exercisers')}</Text>
      <Text style={styles.subtitle}>{text(props.subtitle, 'Each probe runs only from its button. Results are local runtime state, not admission proof.')}</Text>
      <Text style={styles.platform}>Current shell: {String(Platform.OS)}</Text>
      {probes.map((probe) => {
        const status = statuses[probe.capabilityId] ?? {
          state: 'unrequested' as const,
          detail: 'NOT_RUN: no user action yet.',
        };
        const busy = busyId === probe.capabilityId;
        return (
          <View key={probe.capabilityId} style={styles.probe}>
            <View style={styles.probeHeading}>
              <Text style={styles.probeTitle}>{probe.title}</Text>
              <Text style={[styles.state, stateStyle(status.state)]}>{status.state}</Text>
            </View>
            <Text style={styles.detail}>{probe.detail}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${probe.title} exerciser`}
              disabled={busy}
              onPress={() => void runProbe(probe)}
              style={[styles.button, busy ? styles.disabled : null]}
            >
              <Text style={styles.buttonText}>{busy ? 'Running...' : probe.cta}</Text>
            </Pressable>
            <Text accessibilityLabel={`${probe.title} probe result ${status.state}`} style={styles.result}>{status.detail}</Text>
            {status.observedAt ? <Text style={styles.timestamp}>{status.observedAt}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

async function runCapabilityProbe(
  probe: CapabilityExerciserProbe,
  runtime: WidgetCapabilityRuntime,
): Promise<ProbeStatus> {
  if (probe.action === 'microphone') return runMicrophoneProbe(runtime);
  if (probe.action === 'background_task') return runBackgroundTaskProbe(runtime);
  if (probe.action === 'health') return runHealthProbe(runtime);
  if (probe.action === 'deep_link') return runDeepLinkProbe(runtime, probe.url);
  if (probe.action === 'file_open') return runFileOpenProbe(runtime);
  return runShortcutProbe(runtime);
}

async function runMicrophoneProbe(runtime: WidgetCapabilityRuntime): Promise<ProbeStatus> {
  const grant = requestWidgetCapability(runtime, {
    kind: 'audio-recorder',
    action: 'record',
    declaredPurpose: 'request microphone access for the Capability Lab recorder probe',
  });
  if (!grant.ok) {
    return { state: 'blocked', detail: grant.error.message };
  }
  const driver = await createAudioLoopRecorderDriver();
  const started = await driver.startRecording({ outputFile: 'capability-lab-microphone-probe', isMuted: false });
  await driver.stopRecording();
  return {
    state: 'success',
    detail: started.sourceUri
      ? 'Recorder started and stopped from explicit user action.'
      : 'Recorder started and stopped; no source URI returned.',
  };
}

async function runBackgroundTaskProbe(runtime: WidgetCapabilityRuntime): Promise<ProbeStatus> {
  const declared = requireDeclaredIntent(runtime, 'background_task');
  if (declared) return declared;
  try {
    const taskManager = await import('expo-task-manager');
    const hasRegistry = typeof taskManager.isTaskRegisteredAsync === 'function';
    return {
      state: 'blocked',
      detail: hasRegistry
        ? 'TaskManager loaded, but no scheduler/background execution receipt was run. NOT_RUN for OS background execution.'
        : 'TaskManager loaded without a registry API. NOT_RUN for OS background execution.',
    };
  } catch {
    return { state: 'unavailable', detail: 'expo-task-manager is unavailable in this shell.' };
  }
}

async function runHealthProbe(runtime: WidgetCapabilityRuntime): Promise<ProbeStatus> {
  const declared = requireDeclaredHealth(runtime);
  if (declared) return declared;
  const {
    getUtopiaHealthStatus,
    requestUtopiaHealthPermissions,
  } = await import('@/src/health/connect');
  const before = await getUtopiaHealthStatus();
  if (before.availability === 'unsupported') {
    return { state: 'unavailable', detail: before.message };
  }
  const status = await requestUtopiaHealthPermissions();
  if (status.availability === 'available' && status.granted.length > 0) {
    return { state: 'granted', detail: `Health Connect granted ${status.granted.length} permission(s).` };
  }
  if (status.availability === 'available') {
    return { state: 'denied', detail: 'Health Connect is available, but no permissions were granted.' };
  }
  return {
    state: status.availability === 'unsupported' ? 'unavailable' : 'blocked',
    detail: status.message,
  };
}

async function runDeepLinkProbe(runtime: WidgetCapabilityRuntime, url: string | undefined): Promise<ProbeStatus> {
  const declared = requireDeclaredIntent(runtime, 'deep_link');
  if (declared) return declared;
  const target = url?.trim() || 'utopia://capability-lab/matrix?source=capability-lab';
  const canOpen = await Linking.canOpenURL(target).catch(() => false);
  if (!canOpen) {
    return { state: 'blocked', detail: `Shell cannot open declared deep link: ${target}` };
  }
  await Linking.openURL(target);
  return { state: 'success', detail: `Opened declared deep link: ${target}` };
}

async function runFileOpenProbe(runtime: WidgetCapabilityRuntime): Promise<ProbeStatus> {
  const declared = requireDeclaredIntent(runtime, 'file_open');
  if (declared) return declared;
  return {
    state: 'blocked',
    detail: 'Inbound file-open requires an external OS event and shell adapter. NOT_RUN from inside the app.',
  };
}

async function runShortcutProbe(runtime: WidgetCapabilityRuntime): Promise<ProbeStatus> {
  const declared = requireDeclaredIntent(runtime, 'shortcut');
  if (declared) return declared;
  return {
    state: 'blocked',
    detail: 'Shortcut publishing has no current generic native adapter. NOT_RUN for shortcut creation.',
  };
}

function requireDeclaredIntent(
  runtime: WidgetCapabilityRuntime,
  kind: 'background_task' | 'deep_link' | 'file_open' | 'shortcut',
): ProbeStatus | null {
  const base = requireInstalledPackage(runtime);
  if (base) return base;
  const intents = runtime.activePackage?.nativeCapabilities?.intents ?? [];
  const declared = intents.some((intent) => intent.kind === kind);
  return declared
    ? null
    : { state: 'blocked', detail: `Package did not declare native intent:${kind}.` };
}

function requireDeclaredHealth(runtime: WidgetCapabilityRuntime): ProbeStatus | null {
  const base = requireInstalledPackage(runtime);
  if (base) return base;
  const permissions = runtime.activePackage?.nativeCapabilities?.permissions ?? [];
  const declared = permissions.some((permission) => {
    const raw = typeof permission === 'string' ? permission : permission.permission;
    return raw.includes('health.');
  });
  return declared
    ? null
    : { state: 'blocked', detail: 'Package did not declare Android Health Connect permissions.' };
}

function requireInstalledPackage(runtime: WidgetCapabilityRuntime): ProbeStatus | null {
  if (!runtime.installationId) {
    return { state: 'blocked', detail: 'Package installation is required before native capability probes can run.' };
  }
  if (!runtime.activePackage?.nativeCapabilities) {
    return { state: 'blocked', detail: 'Active package native capabilities are missing.' };
  }
  return null;
}

function isCapabilityExerciserAction(value: unknown): value is CapabilityExerciserAction {
  return value === 'microphone'
    || value === 'background_task'
    || value === 'health'
    || value === 'deep_link'
    || value === 'file_open'
    || value === 'shortcut';
}

function titleize(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function stateStyle(state: CapabilityDiagnosticRuntimeState) {
  if (state === 'success' || state === 'granted') return styles.success;
  if (state === 'denied' || state === 'blocked') return styles.blocked;
  if (state === 'unavailable' || state === 'interrupted') return styles.unavailable;
  if (state === 'requested') return styles.requested;
  return styles.notRun;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  title: { color: '#0F172A', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#475569', fontSize: 14, lineHeight: 20 },
  platform: { color: '#0F766E', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  probe: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 8, padding: 12 },
  probeHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  probeTitle: { color: '#0F172A', flex: 1, fontSize: 16, fontWeight: '700' },
  detail: { color: '#475569', fontSize: 13, lineHeight: 18 },
  button: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#155E75', borderRadius: 8, minHeight: 42, paddingHorizontal: 12, paddingVertical: 10 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  state: { borderRadius: 4, fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 3, textTransform: 'uppercase' },
  requested: { backgroundColor: '#FEF3C7', color: '#92400E' },
  success: { backgroundColor: '#DCFCE7', color: '#166534' },
  blocked: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  unavailable: { backgroundColor: '#E2E8F0', color: '#475569' },
  notRun: { backgroundColor: '#DBEAFE', color: '#1D4ED8' },
  result: { color: '#334155', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  timestamp: { color: '#64748B', fontSize: 11 },
});
