type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type WorkflowEvent = string;
export type WorkflowControlState = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'compensating' | 'compensated';

type ControlEvent =
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'COMPLETE'
  | 'FAIL'
  | 'COMPENSATE'
  | 'COMPENSATED';

export type WorkflowDefinition = {
  initial: string;
  states: Record<string, { on?: Record<WorkflowEvent, string> }>;
};

export type WorkflowCheckpoint = Record<string, JsonValue>;

export type WorkflowSnapshot<TCheckpoint extends WorkflowCheckpoint = WorkflowCheckpoint> = {
  schemaVersion: 'workflow.snapshot.v3';
  state: string;
  control: WorkflowControlState;
  revision: number;
  updatedAt: string;
  checkpoint: TCheckpoint;
};

type TimerStatus = 'idle' | 'running' | 'paused' | 'completed' | 'review';

export type TimerSnapshot = {
  durationMs: number;
  elapsedMs: number;
  status: TimerStatus;
  updatedAt: string;
};

const controlTransitions: Record<WorkflowControlState, Partial<Record<ControlEvent, WorkflowControlState>>> = {
  running: { PAUSE: 'paused', COMPLETE: 'completed', FAIL: 'failed', CANCEL: 'cancelled' },
  paused: { RESUME: 'running', CANCEL: 'cancelled' },
  completed: {},
  failed: { COMPENSATE: 'compensating', COMPLETE: 'completed' },
  cancelled: {},
  compensating: { COMPENSATED: 'compensated', FAIL: 'failed' },
  compensated: {},
};

const nextControlState = (current: WorkflowControlState, event: ControlEvent): WorkflowControlState => {
  const next = controlTransitions[current]?.[event];
  if (!next) throw new Error(`workflow_control_illegal:${current}:${event}`);
  return next;
};

const parseISO = (value: string): number => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
};

const nextCheckpoint = <T extends WorkflowCheckpoint>(snapshot: WorkflowSnapshot<T> | undefined, checkpoint?: T): T =>
  checkpoint ?? (snapshot?.checkpoint ?? ({} as T));

const buildSnapshot = <TCheckpoint extends WorkflowCheckpoint>(
  kind: WorkflowControlState,
  snapshot: WorkflowSnapshot<TCheckpoint> | undefined,
  revision: number,
  at: string,
  state: string,
  checkpoint?: TCheckpoint,
): WorkflowSnapshot<TCheckpoint> => ({
  schemaVersion: 'workflow.snapshot.v3',
  state,
  control: kind,
  revision,
  updatedAt: at,
  checkpoint: nextCheckpoint(snapshot, checkpoint),
});

const nextState = (definition: WorkflowDefinition, state: string, event: WorkflowEvent): string => {
  const stateDefinition = definition.states[state];
  if (!stateDefinition) throw new Error(`workflow_unknown_state:${state}`);
  const next = stateDefinition.on?.[event];
  if (!next) throw new Error(`workflow_illegal_transition:${state}:${event}`);
  return next;
};

export function reconcileTimer(snapshot: TimerSnapshot, now = Date.now()): TimerSnapshot {
  const updatedAt = parseISO(snapshot.updatedAt);
  if (!Number.isFinite(updatedAt) || Number.isNaN(updatedAt) || now < updatedAt) {
    return {
      ...snapshot,
      status: 'review',
      updatedAt: Number.isNaN(updatedAt) ? snapshot.updatedAt : new Date(now).toISOString(),
    };
  }

  if (snapshot.durationMs < 0) return { ...snapshot, status: 'review' };

  const elapsed = Math.max(0, snapshot.elapsedMs);
  if (snapshot.status !== 'running') {
    return { ...snapshot, elapsedMs: Math.min(elapsed, snapshot.durationMs) };
  }

  const nextElapsed = Math.max(elapsed, elapsed + Math.max(0, now - updatedAt));
  const clampedElapsed = Math.min(nextElapsed, snapshot.durationMs);

  return {
    ...snapshot,
    elapsedMs: clampedElapsed,
    status: clampedElapsed >= snapshot.durationMs ? 'completed' : 'running',
    updatedAt: new Date(now).toISOString(),
  };
}

export function workflow<TCheckpoint extends WorkflowCheckpoint = WorkflowCheckpoint>(definition: WorkflowDefinition) {
  return {
    definition,

    initialState(): string {
      if (!definition.initial) throw new Error('workflow_initial_state_missing');
      if (!definition.states[definition.initial]) throw new Error(`workflow_unknown_state:${definition.initial}`);
      return definition.initial;
    },

    transition(state: string, event: WorkflowEvent): string {
      return nextState(definition, state, event);
    },

    control(
      snapshot: WorkflowSnapshot<TCheckpoint> | undefined,
      event: ControlEvent,
      at = new Date().toISOString(),
      checkpoint?: TCheckpoint,
    ): WorkflowSnapshot<TCheckpoint> {
      const current = snapshot?.control ?? 'running';
      const next = nextControlState(current, event);
      return buildSnapshot(next, snapshot, (snapshot?.revision ?? 0) + 1, at, snapshot?.state ?? definition.initial, checkpoint);
    },

    advance(
      snapshot: WorkflowSnapshot<TCheckpoint> | undefined,
      event: WorkflowEvent,
      at = new Date().toISOString(),
      checkpoint?: TCheckpoint,
    ): WorkflowSnapshot<TCheckpoint> {
      const current = snapshot?.state ?? definition.initial;
      const control = snapshot?.control ?? 'running';
      if (control !== 'running') throw new Error(`workflow_control_blocked:${control}`);
      const next = nextState(definition, current, event);
      return buildSnapshot(control, snapshot, (snapshot?.revision ?? 0) + 1, at, next, checkpoint);
    },
  };
}
