import type { ComponentRenderProps } from '@json-render/react-native';
import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  CAPABILITY_DIAGNOSTIC_RUNTIME_STATES,
  type CapabilityDiagnosticObservation,
  type CapabilityDiagnosticRuntimeState,
} from '@/packages/shared/contracts/ui-widgets';
import {
  nativeCapabilityMatrixRows,
  type NativeCapabilityMatrixEntry,
  type NativeCapabilitySupportState,
  type UtopiaRuntimePlatform,
} from '@/packages/shared/contracts/native-capabilities';
import { text, type WidgetProps } from '@/src/presentation/widgets/widget-sdk';

export const CAPABILITY_LAB_DIAGNOSTIC_IDS = [
  'camera',
  'microphone',
  'files',
  'notifications',
  'background_task',
  'location',
  'contacts',
  'calendar',
  'biometrics',
  'health',
  'sensors',
  'speech',
  'share',
  'deep_link',
  'file_open',
  'shortcut',
] as const;

export type CapabilityLabDiagnosticId = typeof CAPABILITY_LAB_DIAGNOSTIC_IDS[number];

export type CapabilityDiagnosticRow = Readonly<{
  id: CapabilityLabDiagnosticId;
  label: string;
  support: NativeCapabilitySupportState;
  state: CapabilityDiagnosticRuntimeState;
  observed: boolean;
  detail: string;
  harness: 'executable' | 'blocked' | 'not_run';
  controls: readonly string[];
  harnessDetail: string;
  platformSupport: Readonly<Record<UtopiaRuntimePlatform, NativeCapabilitySupportState>>;
}>;

export type CapabilityDiagnosticExecutor = Readonly<{
  capabilityId: CapabilityLabDiagnosticId;
  controls: readonly string[];
  detail: string;
  mode?: 'executable' | 'blocked';
}>;

export function resolveCapabilityDiagnosticRows(input: {
  platform: UtopiaRuntimePlatform;
  capabilityIds?: readonly string[];
  observations?: readonly CapabilityDiagnosticObservation[];
  executors?: readonly CapabilityDiagnosticExecutor[];
}): CapabilityDiagnosticRow[] {
  const entries = new Map(nativeCapabilityMatrixRows().map((entry) => [entry.id, entry]));
  const requestedIds = input.capabilityIds?.length ? input.capabilityIds : CAPABILITY_LAB_DIAGNOSTIC_IDS;
  const observations = new Map(
    (input.observations ?? [])
      .filter((item) => isCapabilityLabDiagnosticId(item.capabilityId))
      .map((item) => [item.capabilityId, item]),
  );
  const executors = new Map(
    (input.executors ?? [])
      .filter((item) => isCapabilityLabDiagnosticId(item.capabilityId) && item.controls.length > 0)
      .map((item) => [item.capabilityId, item]),
  );

  return requestedIds
    .filter(isCapabilityLabDiagnosticId)
    .map((id) => resolveDiagnosticRow(entries.get(id), input.platform, observations.get(id), executors.get(id)));
}

export function isCapabilityLabDiagnosticId(value: string): value is CapabilityLabDiagnosticId {
  return (CAPABILITY_LAB_DIAGNOSTIC_IDS as readonly string[]).includes(value);
}

function resolveDiagnosticRow(
  entry: NativeCapabilityMatrixEntry | undefined,
  platform: UtopiaRuntimePlatform,
  observation: CapabilityDiagnosticObservation | undefined,
  executor: CapabilityDiagnosticExecutor | undefined,
): CapabilityDiagnosticRow {
  if (!entry || !isCapabilityLabDiagnosticId(entry.id)) {
    throw new Error('Capability Lab requires a known native capability entry.');
  }
  const support = entry.support[platform];
  const verified = observation?.observed === true && isDiagnosticRuntimeState(observation.state);
  const observedState = verified && support === 'supported' ? observation.state : null;
  const state = support === 'unsupported'
    ? 'unavailable'
    : observedState ?? 'unrequested';
  const observed = Boolean(observedState);
  const detail = support === 'unsupported'
    ? 'Unsupported by the current platform contract. No runtime attempt is available.'
    : support === 'planned'
      ? 'Planned in the platform contract. No runtime outcome has been recorded.'
      : observed
        ? observation?.detail?.trim() || `Observed ${state}.`
        : 'Not observed. This diagnostic does not execute the capability.';
  const harness = executor && support === 'supported'
    ? executor.mode === 'blocked' ? 'blocked' : 'executable'
    : 'not_run';
  const controls = executor?.controls ?? [];
  const harnessDetail = support === 'unsupported'
    ? 'NOT_RUN: unavailable under this shell contract.'
    : support === 'planned'
      ? 'NOT_RUN: planned in the current platform contract, even when a generic control is mounted.'
      : executor?.mode === 'blocked'
        ? executor.detail
      : executor
      ? executor.detail
      : 'NOT_RUN: this Lab surface has no registered generic control for the capability.';
  return {
    id: entry.id,
    label: entry.label,
    support,
    state,
    observed,
    detail,
    harness,
    controls,
    harnessDetail,
    platformSupport: entry.support,
  };
}

function isDiagnosticRuntimeState(value: string): value is CapabilityDiagnosticRuntimeState {
  return (CAPABILITY_DIAGNOSTIC_RUNTIME_STATES as readonly string[]).includes(value);
}

function parsePlatform(value: unknown): UtopiaRuntimePlatform {
  return value === 'android' || value === 'ios' || value === 'macos' ? value : 'web';
}

function parseCapabilityIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((item): item is string => typeof item === 'string' && isCapabilityLabDiagnosticId(item));
  return ids.length ? ids : undefined;
}

function parseObservations(value: unknown): CapabilityDiagnosticObservation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.capabilityId !== 'string' || typeof record.state !== 'string' || !isDiagnosticRuntimeState(record.state)) return [];
    return [{
      capabilityId: record.capabilityId,
      state: record.state,
      observed: record.observed === true,
      observedAt: typeof record.observedAt === 'string' ? record.observedAt : undefined,
      detail: typeof record.detail === 'string' ? record.detail : undefined,
    }];
  });
}

function parseExecutors(value: unknown): CapabilityDiagnosticExecutor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.capabilityId !== 'string' || !isCapabilityLabDiagnosticId(record.capabilityId) || !Array.isArray(record.controls)) return [];
    const controls = record.controls.filter((control): control is string => typeof control === 'string' && control.trim().length > 0);
    if (!controls.length) return [];
    return [{
      capabilityId: record.capabilityId,
      controls,
      detail: typeof record.detail === 'string' && record.detail.trim()
        ? record.detail
        : `Use ${controls.join(' or ')} below.`,
      mode: record.mode === 'blocked' ? 'blocked' : 'executable',
    }];
  });
}

export function CapabilityDiagnosticWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = (element.props ?? {}) as WidgetProps & Record<string, unknown>;
  const platform = parsePlatform(props.runtimePlatform ?? Platform.OS);
  const diagnostics = resolveCapabilityDiagnosticRows({
    platform,
    capabilityIds: parseCapabilityIds(props.capabilityIds),
    observations: parseObservations(props.observations),
    executors: parseExecutors(props.executors),
  });
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{text(props.title, 'Capability diagnostics')}</Text>
      <Text style={styles.subtitle}>{text(props.subtitle, 'Contract status is separate from observed runtime evidence.')}</Text>
      <Text accessibilityRole="summary" style={styles.platform}>Current shell: {platform}</Text>
      {diagnostics.map((diagnostic) => (
        <View key={diagnostic.id} style={styles.row}>
          <View style={styles.rowHeading}>
            <Text style={styles.rowTitle}>{diagnostic.label}</Text>
            <Text style={[styles.support, supportStyle(diagnostic.support)]}>{diagnostic.support}</Text>
          </View>
          <Text accessibilityLabel={`${diagnostic.label} result ${diagnostic.state}`} style={styles.state}>{diagnostic.state}</Text>
          <Text style={styles.detail}>{diagnostic.detail}</Text>
          <Text style={[styles.harness, diagnostic.harness === 'executable' ? styles.executable : diagnostic.harness === 'blocked' ? styles.blocked : styles.notRun]}>
            {diagnostic.harness === 'executable' ? `TEST CONTROL: ${diagnostic.controls.join(' + ')}` : diagnostic.harness === 'blocked' ? `BROKER BLOCK: ${diagnostic.controls.join(' + ')}` : 'NOT_RUN'}
          </Text>
          <Text style={styles.detail}>{diagnostic.harnessDetail}</Text>
          <Text style={styles.platforms}>
            Web {diagnostic.platformSupport.web} | Android {diagnostic.platformSupport.android} | iOS {diagnostic.platformSupport.ios} | macOS {diagnostic.platformSupport.macos}
          </Text>
        </View>
      ))}
      <Text style={styles.footer}>Native controls below are user-initiated. Only an explicit observed record can show granted, denied, blocked, success, or interrupted here.</Text>
    </View>
  );
}

function supportStyle(support: NativeCapabilitySupportState) {
  if (support === 'supported') return styles.supported;
  if (support === 'planned') return styles.planned;
  return styles.unsupported;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 12, padding: 16 },
  title: { color: '#0F172A', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#475569', fontSize: 14, lineHeight: 20 },
  platform: { color: '#0F766E', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  row: { borderTopColor: '#E2E8F0', borderTopWidth: StyleSheet.hairlineWidth, gap: 4, paddingTop: 12 },
  rowHeading: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  rowTitle: { color: '#0F172A', flex: 1, fontSize: 16, fontWeight: '700' },
  support: { borderRadius: 4, fontSize: 12, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2, textTransform: 'uppercase' },
  supported: { backgroundColor: '#DCFCE7', color: '#166534' },
  planned: { backgroundColor: '#FEF3C7', color: '#92400E' },
  unsupported: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  state: { color: '#334155', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  detail: { color: '#475569', fontSize: 13, lineHeight: 18 },
  harness: { alignSelf: 'flex-start', borderRadius: 4, fontSize: 11, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2 },
  executable: { backgroundColor: '#DBEAFE', color: '#1D4ED8' },
  blocked: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  notRun: { backgroundColor: '#E2E8F0', color: '#475569' },
  platforms: { color: '#64748B', fontSize: 11, lineHeight: 16 },
  footer: { color: '#475569', fontSize: 12, lineHeight: 17 },
});
