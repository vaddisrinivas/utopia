import type { ComponentRenderProps } from '@json-render/react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  applyStepFlowEvent,
  timerRemainingMs,
  type StepFlowDefinition,
  type StepFlowEvent,
  type StepFlowSnapshot,
} from '@/packages/runtime-kernel/timed-flow';
import { useUtopiaDatabase } from '@/src/db/provider';
import { useAppRuntime } from '@/src/domain/runtime-context';
import type { WidgetProps } from '@/src/presentation/widgets/widget-sdk';
import { upsertRecord } from '@/src/db/records';
import {
  buildTimedCompletionRecord,
  normalizeTimedCompletionConfig,
} from '@/src/presentation/widgets/timed-completion-record';
import {
  currentFlowClock,
  dispatchPersistedStepFlow,
  loadPersistedStepFlow,
  startPersistedStepFlow,
} from '@/src/workflows/timed-flow-runtime';
import {
  timerActionAccessibilityLabel,
  timerControlTestId,
  timerStatusAccessibilityLabel,
  timerStatusTestId,
} from '@/src/presentation/widgets/timed-flow-accessibility';

export function StepFlowWidget({ element }: ComponentRenderProps<WidgetProps>) {
  return <TimedFlowWidget element={element} singleTimer={false} />;
}

export function DurationTimerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  return <TimedFlowWidget element={element} singleTimer />;
}

function TimedFlowWidget({
  element,
  singleTimer,
}: {
  element: ComponentRenderProps<WidgetProps>['element'];
  singleTimer: boolean;
}) {
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const props = element.props ?? {};
  const configuredSteps = useMemo(
    () => singleTimer ? timerDefinition(props) : flowDefinitions(props.steps),
    [props.durationSeconds, props.label, props.steps, singleTimer],
  );
  const packageId = runtime.activePackage?.id ?? runtime.activeManifest?.id ?? 'app';
  const installationId = runtime.installationId ?? 'default';
  const localRunId = stringValue(props.runId, singleTimer ? 'timer' : 'flow');
  const runId = `${installationId}:${packageId}:${localRunId}`;
  const [persisted, setPersisted] = useState<StepFlowSnapshot | null>(null);
  const [display, setDisplay] = useState<StepFlowSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eventSequence = useRef(0);
  const completionConfig = useMemo(
    () => normalizeTimedCompletionConfig(props.completionRecord),
    [props.completionRecord],
  );

  useEffect(() => {
    let cancelled = false;
    if (!db) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    void loadPersistedStepFlow(db, runId, installationId)
      .then((snapshot) => {
        if (!cancelled) {
          setPersisted(snapshot);
          setDisplay(snapshot);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(message(reason));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [db, installationId, runId]);

  useEffect(() => {
    if (!persisted || persisted.status !== 'running') {
      setDisplay(persisted);
      return undefined;
    }
    const update = () => {
      eventSequence.current += 1;
      setDisplay(applyStepFlowEvent(
        persisted,
        { id: `display-${eventSequence.current}`, kind: 'observe' },
        currentFlowClock(),
      ));
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [persisted]);

  const start = useCallback(async () => {
    if (!db || !configuredSteps.length) return;
    setBusy(true);
    setError('');
    try {
      const snapshot = await startPersistedStepFlow({
        db,
        runId,
        appInstallationId: installationId,
        domain: packageId,
        workflowId: localRunId,
        steps: configuredSteps,
      });
      setPersisted(snapshot);
      setDisplay(snapshot);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }, [configuredSteps, db, installationId, localRunId, packageId, runId]);

  const dispatch = useCallback(async (event: {
    kind: StepFlowEvent['kind'];
    elapsedMs?: number;
    resume?: boolean;
  }) => {
    if (!db || !persisted) return;
    eventSequence.current += 1;
    setBusy(true);
    setError('');
    try {
      const snapshot = await dispatchPersistedStepFlow({
        db,
        runId,
        appInstallationId: installationId,
        event: { ...event, id: `${runId}:${eventSequence.current}` } as StepFlowEvent,
      });
      const completion = completionConfig
        ? buildTimedCompletionRecord({
          runId,
          snapshot,
          config: completionConfig,
          completedAt: new Date().toISOString(),
        })
        : null;
      if (completion && runtime.activeManifest && runtime.installationId) {
        const now = String(completion.properties.completed_at);
        await upsertRecord(db, runtime.activeManifest, {
          ...completion,
          relations: [],
          source: {
            provider: 'user',
            external_id: completion.id,
            url: null,
            observed_at: now,
            content_hash: null,
          },
          archived_at: null,
          created_at: now,
          updated_at: now,
          operation_actor: 'workflow',
          operation_origin: 'workflow',
          operation_id: `op-${completion.id}`,
          idempotency_key: `timed-completion:${runtime.installationId}:${completion.id}`,
          app_installation_id: runtime.installationId,
        });
      }
      setPersisted(snapshot);
      setDisplay(snapshot);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }, [completionConfig, db, installationId, persisted, runId, runtime.activeManifest, runtime.installationId]);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#276749" />
      </View>
    );
  }

  const snapshot = display ?? persisted;
  const currentStep = snapshot && snapshot.currentStep < snapshot.steps.length
    ? snapshot.steps[snapshot.currentStep]
    : null;
  const remaining = snapshot?.timer ? timerRemainingMs(snapshot.timer) : null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{stringValue(props.title, singleTimer ? 'Timer' : 'Flow')}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{stringValue(props.subtitle)}</Text> : null}
      {!snapshot ? (
        <Pressable
          accessible
          accessibilityLabel={timerActionAccessibilityLabel('Start')}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !configuredSteps.length }}
          disabled={busy || !configuredSteps.length}
          onPress={() => void start()}
          testID={timerControlTestId(localRunId, 'Start')}
          style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
        >
          <Text style={styles.primaryText}>{busy ? 'Starting...' : 'Start'}</Text>
        </Pressable>
      ) : (
        <>
          {!singleTimer ? (
            <Text style={styles.stepCount}>
              {snapshot.status === 'completed'
                ? 'Complete'
                : `Step ${Math.min(snapshot.currentStep + 1, snapshot.steps.length)} of ${snapshot.steps.length}`}
            </Text>
          ) : null}
          <Text style={styles.stepTitle}>{currentStep?.title ?? 'Finished'}</Text>
          {remaining !== null ? <Text style={styles.time}>{formatDuration(remaining)}</Text> : null}
          <Text
            accessible
            accessibilityLabel={timerStatusAccessibilityLabel(snapshot.status)}
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy }}
            accessibilityRole="text"
            testID={timerStatusTestId(localRunId)}
            style={styles.status}
          >
            {statusLabel(snapshot.status)}
          </Text>
          <View style={styles.actions}>
            {snapshot.status === 'running' ? (
              <Action runId={localRunId} label="Pause" disabled={busy} onPress={() => void dispatch({ kind: 'pause' })} />
            ) : null}
            {snapshot.status === 'paused' ? (
              <Action runId={localRunId} label="Resume" disabled={busy} onPress={() => void dispatch({ kind: 'resume' })} />
            ) : null}
            {snapshot.status === 'step_complete' || (!snapshot.timer && snapshot.status === 'running') ? (
              <Action runId={localRunId} label={singleTimer ? 'Finish' : 'Next'} disabled={busy} primary onPress={() => void dispatch({ kind: 'next' })} />
            ) : null}
            {snapshot.status === 'review_required' ? (
              <Action
                runId={localRunId}
                label="Resume saved time"
                disabled={busy}
                primary
                onPress={() => void dispatch({
                  kind: 'confirm_elapsed',
                  elapsedMs: snapshot.timer?.accumulatedMs ?? 0,
                })}
              />
            ) : null}
            {snapshot.status === 'cancelled' || snapshot.status === 'completed' ? (
              <Action runId={localRunId} label="Restart" disabled={busy} primary onPress={() => void dispatch({ kind: 'retry' })} />
            ) : (
              <Action runId={localRunId} label="Cancel" disabled={busy} onPress={() => void dispatch({ kind: 'cancel' })} />
            )}
          </View>
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Action({
  runId,
  label,
  onPress,
  disabled,
  primary = false,
}: {
  runId: string;
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessible
      accessibilityLabel={timerActionAccessibilityLabel(label)}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={timerControlTestId(runId, label)}
      style={({ pressed }) => [
        primary ? styles.primary : styles.secondary,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text style={primary ? styles.primaryText : styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function flowDefinitions(value: unknown): StepFlowDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const title = stringValue(row.title, stringValue(row.label));
    if (!title) return [];
    const durationSeconds = numericValue(row.durationSeconds);
    return [{
      id: stringValue(row.id, `step-${index + 1}`),
      title,
      ...(durationSeconds > 0 ? { durationMs: Math.floor(durationSeconds * 1000) } : {}),
    }];
  });
}

function timerDefinition(props: Record<string, unknown>): StepFlowDefinition[] {
  const durationSeconds = numericValue(props.durationSeconds);
  if (durationSeconds <= 0) return [];
  return [{
    id: 'timer',
    title: stringValue(props.label, 'Timer'),
    durationMs: Math.floor(durationSeconds * 1000),
  }];
}

function numericValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function statusLabel(status: StepFlowSnapshot['status']): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8FAF9',
    borderColor: '#D8E3DC',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  title: { color: '#17261D', fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#53645A', fontSize: 14, lineHeight: 20 },
  stepCount: { color: '#53645A', fontSize: 12, fontWeight: '600' },
  stepTitle: { color: '#17261D', fontSize: 20, fontWeight: '700' },
  time: { color: '#17261D', fontSize: 40, fontVariant: ['tabular-nums'], fontWeight: '700' },
  status: { color: '#53645A', fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primary: { backgroundColor: '#276749', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  secondary: { borderColor: '#AABBB0', borderRadius: 6, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  secondaryText: { color: '#244332', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  error: { color: '#A52A2A', fontSize: 13 },
});
