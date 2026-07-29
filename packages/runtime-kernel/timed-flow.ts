export type ClockSample = {
  utcMs: number;
  monotonicMs: number;
  monotonicEpoch: string;
};

export type TimerStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'review_required';

export type DurationTimerSnapshot = {
  schemaVersion: 'utopia.duration-timer.v1';
  id: string;
  durationMs: number;
  accumulatedMs: number;
  status: TimerStatus;
  startedAt?: ClockSample;
  lastObservedAt: ClockSample;
  confidence: 'monotonic' | 'wall_clock' | 'confirmed';
  uncertaintyReason?: 'clock_rollback' | 'wall_gap_too_large' | 'monotonic_rollback';
  revision: number;
  handledEventIds: string[];
};

export type TimerEvent =
  | { id: string; kind: 'pause'; expectedRevision?: number }
  | { id: string; kind: 'resume'; expectedRevision?: number }
  | { id: string; kind: 'cancel'; expectedRevision?: number }
  | { id: string; kind: 'retry'; expectedRevision?: number }
  | { id: string; kind: 'observe'; expectedRevision?: number }
  | { id: string; kind: 'confirm_elapsed'; elapsedMs: number; resume?: boolean; expectedRevision?: number };

export type StepFlowDefinition = {
  id: string;
  title: string;
  durationMs?: number;
};

export type StepFlowSnapshot = {
  schemaVersion: 'utopia.step-flow.v1';
  id: string;
  steps: StepFlowDefinition[];
  currentStep: number;
  status: 'running' | 'paused' | 'step_complete' | 'completed' | 'cancelled' | 'review_required';
  timer?: DurationTimerSnapshot;
  revision: number;
  handledEventIds: string[];
};

export type StepFlowEvent =
  | { id: string; kind: 'pause'; expectedRevision?: number }
  | { id: string; kind: 'resume'; expectedRevision?: number }
  | { id: string; kind: 'observe'; expectedRevision?: number }
  | { id: string; kind: 'next'; expectedRevision?: number }
  | { id: string; kind: 'cancel'; expectedRevision?: number }
  | { id: string; kind: 'retry'; expectedRevision?: number }
  | { id: string; kind: 'confirm_elapsed'; elapsedMs: number; resume?: boolean; expectedRevision?: number };

const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_TRUSTED_WALL_GAP_MS = 24 * 60 * 60 * 1000;
const MAX_EVENT_IDS = 128;

export function startDurationTimer(
  id: string,
  durationMs: number,
  clock: ClockSample,
): DurationTimerSnapshot {
  assertClock(clock);
  const normalizedDuration = integerInRange(durationMs, 1, MAX_DURATION_MS, 'timer_duration_invalid');
  return {
    schemaVersion: 'utopia.duration-timer.v1',
    id: requiredText(id, 'timer_id_invalid'),
    durationMs: normalizedDuration,
    accumulatedMs: 0,
    status: 'running',
    startedAt: { ...clock },
    lastObservedAt: { ...clock },
    confidence: 'monotonic',
    revision: 1,
    handledEventIds: [],
  };
}

export function observeDurationTimer(
  snapshot: DurationTimerSnapshot,
  clock: ClockSample,
): DurationTimerSnapshot {
  assertClock(clock);
  if (snapshot.status !== 'running' || !snapshot.startedAt) {
    return { ...snapshot, lastObservedAt: { ...clock } };
  }
  const elapsed = elapsedSince(snapshot.startedAt, clock);
  if (!elapsed.ok) {
    return {
      ...snapshot,
      status: 'review_required',
      lastObservedAt: { ...clock },
      uncertaintyReason: elapsed.reason,
      revision: snapshot.revision + 1,
    };
  }
  const accumulatedMs = Math.min(snapshot.durationMs, snapshot.accumulatedMs + elapsed.deltaMs);
  return {
    ...snapshot,
    accumulatedMs,
    status: accumulatedMs >= snapshot.durationMs ? 'completed' : 'running',
    lastObservedAt: { ...clock },
    confidence: elapsed.confidence,
    revision: snapshot.revision + 1,
    ...(accumulatedMs >= snapshot.durationMs ? { startedAt: undefined } : {}),
  };
}

export function applyDurationTimerEvent(
  snapshot: DurationTimerSnapshot,
  event: TimerEvent,
  clock: ClockSample,
): DurationTimerSnapshot {
  if (snapshot.handledEventIds.includes(event.id)) return snapshot;
  if (event.expectedRevision !== undefined && event.expectedRevision !== snapshot.revision) {
    throw new Error('timer_revision_conflict');
  }
  const eventId = requiredText(event.id, 'timer_event_id_invalid');
  let current = event.kind === 'observe' || event.kind === 'pause' || event.kind === 'cancel'
    ? observeDurationTimer(snapshot, clock)
    : snapshot;

  switch (event.kind) {
    case 'observe':
      break;
    case 'pause':
      if (current.status === 'running') {
        current = { ...current, status: 'paused', startedAt: undefined, revision: current.revision + 1 };
      }
      break;
    case 'resume':
      if (current.status === 'paused') {
        current = {
          ...current,
          status: 'running',
          startedAt: { ...clock },
          lastObservedAt: { ...clock },
          confidence: 'monotonic',
          revision: current.revision + 1,
        };
      }
      break;
    case 'cancel':
      if (current.status !== 'completed') {
        current = { ...current, status: 'cancelled', startedAt: undefined, revision: current.revision + 1 };
      }
      break;
    case 'retry':
      current = {
        ...current,
        accumulatedMs: 0,
        status: 'running',
        startedAt: { ...clock },
        lastObservedAt: { ...clock },
        confidence: 'monotonic',
        uncertaintyReason: undefined,
        revision: current.revision + 1,
      };
      break;
    case 'confirm_elapsed': {
      if (current.status !== 'review_required') throw new Error('timer_confirmation_not_required');
      const accumulatedMs = integerInRange(event.elapsedMs, 0, current.durationMs, 'timer_elapsed_invalid');
      const completed = accumulatedMs >= current.durationMs;
      current = {
        ...current,
        accumulatedMs,
        status: completed ? 'completed' : event.resume === false ? 'paused' : 'running',
        startedAt: completed || event.resume === false ? undefined : { ...clock },
        lastObservedAt: { ...clock },
        confidence: 'confirmed',
        uncertaintyReason: undefined,
        revision: current.revision + 1,
      };
      break;
    }
  }
  return rememberTimerEvent(current, eventId);
}

export function timerRemainingMs(snapshot: DurationTimerSnapshot): number {
  return Math.max(0, snapshot.durationMs - snapshot.accumulatedMs);
}

export function startStepFlow(
  id: string,
  steps: readonly StepFlowDefinition[],
  clock: ClockSample,
): StepFlowSnapshot {
  if (!steps.length || steps.length > 100) throw new Error('step_flow_steps_invalid');
  const normalized = steps.map((step) => ({
    id: requiredText(step.id, 'step_flow_step_id_invalid'),
    title: requiredText(step.title, 'step_flow_step_title_invalid'),
    ...(step.durationMs === undefined
      ? {}
      : { durationMs: integerInRange(step.durationMs, 1, MAX_DURATION_MS, 'step_flow_duration_invalid') }),
  }));
  if (new Set(normalized.map((step) => step.id)).size !== normalized.length) {
    throw new Error('step_flow_step_duplicate');
  }
  return {
    schemaVersion: 'utopia.step-flow.v1',
    id: requiredText(id, 'step_flow_id_invalid'),
    steps: normalized,
    currentStep: 0,
    status: 'running',
    timer: normalized[0]?.durationMs
      ? startDurationTimer(`${id}:${normalized[0].id}`, normalized[0].durationMs, clock)
      : undefined,
    revision: 1,
    handledEventIds: [],
  };
}

export function applyStepFlowEvent(
  snapshot: StepFlowSnapshot,
  event: StepFlowEvent,
  clock: ClockSample,
): StepFlowSnapshot {
  if (snapshot.handledEventIds.includes(event.id)) return snapshot;
  if (event.expectedRevision !== undefined && event.expectedRevision !== snapshot.revision) {
    throw new Error('step_flow_revision_conflict');
  }
  const eventId = requiredText(event.id, 'step_flow_event_id_invalid');
  let current = event.kind === 'observe' && snapshot.timer
    ? withObservedTimer(snapshot, observeDurationTimer(snapshot.timer, clock))
    : snapshot;

  switch (event.kind) {
    case 'observe':
      break;
    case 'pause':
    case 'resume':
    case 'cancel':
    case 'confirm_elapsed':
      if (current.timer) {
        const timer = applyDurationTimerEvent(
          current.timer,
          { ...event, id: `${eventId}:timer` } as TimerEvent,
          clock,
        );
        current = withObservedTimer(current, timer);
      } else if (event.kind === 'cancel') {
        current = { ...current, status: 'cancelled', revision: current.revision + 1 };
      }
      break;
    case 'retry': {
      if (current.status === 'completed' || current.currentStep >= current.steps.length) {
        const first = current.steps[0]!;
        current = {
          ...current,
          currentStep: 0,
          status: 'running',
          timer: first.durationMs
            ? startDurationTimer(`${current.id}:${first.id}`, first.durationMs, clock)
            : undefined,
          revision: current.revision + 1,
        };
      } else if (current.timer) {
        current = withObservedTimer(current, applyDurationTimerEvent(
          current.timer,
          { id: `${eventId}:timer`, kind: 'retry' },
          clock,
        ));
      } else {
        current = { ...current, status: 'running', revision: current.revision + 1 };
      }
      break;
    }
    case 'next': {
      if (current.status === 'review_required') throw new Error('step_flow_review_required');
      if (current.status === 'cancelled') throw new Error('step_flow_cancelled');
      const nextStep = current.currentStep + 1;
      if (nextStep >= current.steps.length) {
        current = {
          ...current,
          currentStep: current.steps.length,
          status: 'completed',
          timer: undefined,
          revision: current.revision + 1,
        };
      } else {
        const definition = current.steps[nextStep]!;
        current = {
          ...current,
          currentStep: nextStep,
          status: 'running',
          timer: definition.durationMs
            ? startDurationTimer(`${current.id}:${definition.id}`, definition.durationMs, clock)
            : undefined,
          revision: current.revision + 1,
        };
      }
      break;
    }
  }
  return rememberFlowEvent(current, eventId);
}

function withObservedTimer(snapshot: StepFlowSnapshot, timer: DurationTimerSnapshot): StepFlowSnapshot {
  const status = timer.status === 'completed'
    ? 'step_complete'
    : timer.status === 'review_required'
      ? 'review_required'
      : timer.status === 'cancelled'
        ? 'cancelled'
        : timer.status;
  return {
    ...snapshot,
    timer,
    status,
    revision: snapshot.revision + 1,
  };
}

function elapsedSince(
  startedAt: ClockSample,
  clock: ClockSample,
):
  | { ok: true; deltaMs: number; confidence: 'monotonic' | 'wall_clock' }
  | { ok: false; reason: 'clock_rollback' | 'wall_gap_too_large' | 'monotonic_rollback' } {
  if (startedAt.monotonicEpoch === clock.monotonicEpoch) {
    const deltaMs = clock.monotonicMs - startedAt.monotonicMs;
    if (deltaMs < 0) return { ok: false, reason: 'monotonic_rollback' };
    return { ok: true, deltaMs: Math.floor(deltaMs), confidence: 'monotonic' };
  }
  const wallDelta = clock.utcMs - startedAt.utcMs;
  if (wallDelta < 0) return { ok: false, reason: 'clock_rollback' };
  if (wallDelta > MAX_TRUSTED_WALL_GAP_MS) return { ok: false, reason: 'wall_gap_too_large' };
  return { ok: true, deltaMs: Math.floor(wallDelta), confidence: 'wall_clock' };
}

function rememberTimerEvent(snapshot: DurationTimerSnapshot, id: string): DurationTimerSnapshot {
  return {
    ...snapshot,
    handledEventIds: [...snapshot.handledEventIds, id].slice(-MAX_EVENT_IDS),
  };
}

function rememberFlowEvent(snapshot: StepFlowSnapshot, id: string): StepFlowSnapshot {
  return {
    ...snapshot,
    handledEventIds: [...snapshot.handledEventIds, id].slice(-MAX_EVENT_IDS),
  };
}

function assertClock(clock: ClockSample): void {
  if (
    !Number.isFinite(clock.utcMs)
    || !Number.isFinite(clock.monotonicMs)
    || !clock.monotonicEpoch.trim()
  ) {
    throw new Error('timer_clock_invalid');
  }
}

function requiredText(value: string, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim();
}

function integerInRange(value: number, min: number, max: number, error: string): number {
  if (!Number.isFinite(value)) throw new Error(error);
  const integer = Math.floor(value);
  if (integer < min || integer > max) throw new Error(error);
  return integer;
}
