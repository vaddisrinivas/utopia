import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from 'js-sha256';
import { mutateJsonStateFile, readJsonStateFile } from '../providers/json-state';
import { transitionWorkflow, WorkflowControlEvent, WorkflowControlState } from './control-machine';
import { sha256Canonical } from '@/src/domain/canonical-json';

type WorkflowCheckpointStepStatus = 'ok' | 'failed' | 'skipped' | 'cancelled';
type WorkflowCheckpointRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'compensating' | 'compensated';

export type WorkflowStepCheckpoint = {
  id: string;
  tool: string;
  status: WorkflowCheckpointStepStatus;
  changed_records: string[];
  result?: unknown;
  error?: string;
  started_at: string;
  finished_at: string;
};

export type WorkflowRunCheckpoint = {
  run_id: string;
  workflow_id: string;
  domain: string;
  actor: string;
  status: WorkflowCheckpointRunStatus;
  started_at: string;
  updated_at: string;
  finished_at?: string;
  steps: WorkflowStepCheckpoint[];
  changed_records: string[];
  error?: string;
};

type StorePayload = {
  schema_version: 1;
  updated_at: string;
  runs: Record<string, WorkflowRunCheckpoint>;
};

const WORKFLOW_CHECKPOINT_PATH = process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH
  ?? join(process.cwd(), 'server-data', 'workflow-runs.json');
const STORE_VERSION = 1;
const MAX_WORKFLOW_STEP_RESULT_BYTES = 32 * 1024;
const WORKFLOW_RESULT_PREVIEW_BYTES = 4 * 1024;

let loaded = false;
let store: StorePayload = createEmptyStore();

function nowIso() {
  return new Date().toISOString();
}

function hashValue(value: unknown): string {
  return sha256Canonical(value).slice('sha256:'.length);
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function boundStepResult(result: unknown): unknown {
  if (result === undefined) {
    return undefined;
  }
  const cloned = deepClone(result);
  const serialized = JSON.stringify(cloned);
  if (serialized === undefined) {
    return undefined;
  }
  const byteLength = Buffer.byteLength(serialized, 'utf-8');
  if (byteLength <= MAX_WORKFLOW_STEP_RESULT_BYTES) {
    return cloned;
  }
  return {
    truncated: true,
    original_bytes: byteLength,
    preview_json: serialized.slice(0, WORKFLOW_RESULT_PREVIEW_BYTES),
  };
}

function cloneCheckpoint(run: WorkflowRunCheckpoint): WorkflowRunCheckpoint {
  return {
    ...run,
    steps: deepClone(run.steps),
    changed_records: [...run.changed_records],
  };
}

function createEmptyStore(): StorePayload {
  return {
    schema_version: STORE_VERSION,
    updated_at: nowIso(),
    runs: {},
  };
}

function persistMutation<T>(mutate: (draft: StorePayload) => T): T {
  let result: T | undefined;
  const next = mutateJsonStateFile(WORKFLOW_CHECKPOINT_PATH, {
    label: 'workflow checkpoint state',
    validate: isRunPayload,
    createDefault: createEmptyStore,
    mutate: (current) => {
      const draft: StorePayload = {
        schema_version: STORE_VERSION,
        updated_at: nowIso(),
        runs: deepClone((current.runs as Record<string, WorkflowRunCheckpoint>) || {}),
      };
      result = mutate(draft);
      draft.updated_at = nowIso();
      return draft;
    },
  });
  store = {
    schema_version: STORE_VERSION,
    updated_at: next.updated_at,
    runs: deepClone(next.runs),
  };
  loaded = true;
  return result as T;
}

function isRunPayload(value: unknown): value is StorePayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as {
    schema_version?: number;
    updated_at?: unknown;
    runs?: unknown;
  };
  return (
    (entry.schema_version === undefined || entry.schema_version === STORE_VERSION)
    && typeof entry.updated_at === 'string'
    && typeof entry.runs === 'object'
    && entry.runs !== null
  );
}

function load() {
  if (loaded) {
    return;
  }
  loaded = true;

  if (!existsSync(WORKFLOW_CHECKPOINT_PATH)) {
    return;
  }

  try {
    const parsed = readJsonStateFile(WORKFLOW_CHECKPOINT_PATH, {
      label: 'workflow checkpoint state',
      validate: isRunPayload,
    });
    store = {
      schema_version: STORE_VERSION,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : nowIso(),
      runs: deepClone((parsed.runs as Record<string, WorkflowRunCheckpoint>) || {}),
    };
  } catch {
    store = createEmptyStore();
  }
}

function makeRunId(workflowId: string, actor: string, seed?: string) {
  const seeded = seed ? hashValue({ workflowId, actor, seed }).slice(0, 18) : sha256(`${Date.now()}:${Math.random()}`).slice(0, 18);
  return `${workflowId}:${actor}:${seeded}`;
}

export function startWorkflowCheckpoint(input: {
  workflowId: string;
  domain: string;
  actor: string;
  changedRecords?: string[];
  seed?: string;
}): string {
  load();
  const runId = makeRunId(input.workflowId, input.actor, input.seed);
  persistMutation((draft) => {
    draft.runs[runId] = {
      run_id: runId,
      workflow_id: input.workflowId,
      domain: input.domain,
      actor: input.actor,
      status: 'running',
      started_at: nowIso(),
      updated_at: nowIso(),
      steps: [],
      changed_records: [...(input.changedRecords ?? [])],
    };
  });
  return runId;
}

export function markWorkflowStep(input: {
  runId: string;
  id: string;
  tool: string;
  status: WorkflowCheckpointStepStatus;
  changedRecords?: string[];
  result?: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
}) {
  load();
  persistMutation((draft) => {
    const run = draft.runs[input.runId];
    if (!run) {
      return;
    }
    run.steps.push({
      id: input.id,
      tool: input.tool,
      status: input.status,
      changed_records: input.changedRecords ?? [],
      result: boundStepResult(input.result),
      error: input.error,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
    });
    for (const id of input.changedRecords ?? []) {
      if (!run.changed_records.includes(id)) {
        run.changed_records.push(id);
      }
    }
    run.updated_at = nowIso();
  });
}

export function completeWorkflowCheckpoint(
  runId: string,
  opts: {
    status: 'completed' | 'failed' | 'cancelled';
    error?: string;
    changedRecords?: string[];
  },
): void {
  load();
  persistMutation((draft) => {
    const run = draft.runs[runId];
    if (!run) {
      return;
    }
    const event: WorkflowControlEvent = opts.status === 'completed'
      ? 'COMPLETE'
      : opts.status === 'failed' ? 'FAIL' : 'CANCEL';
    const next = transitionWorkflow(run.status as WorkflowControlState, event);
    if (next !== opts.status) {
      throw new Error(`Invalid workflow transition ${run.status} -> ${opts.status}`);
    }
    run.status = opts.status;
    run.updated_at = nowIso();
    run.finished_at = nowIso();
    run.error = opts.error;
    for (const id of opts.changedRecords ?? []) {
      if (!run.changed_records.includes(id)) {
        run.changed_records.push(id);
      }
    }
  });
}

export function pauseWorkflowCheckpoint(runId: string): void {
  transitionCheckpoint(runId, 'PAUSE', 'paused');
}

export function resumeWorkflowCheckpoint(runId: string): void {
  transitionCheckpoint(runId, 'RESUME', 'running');
}

function transitionCheckpoint(runId: string, event: WorkflowControlEvent, expected: WorkflowCheckpointRunStatus) {
  load();
  persistMutation((draft) => {
    const run = draft.runs[runId];
    if (!run) return;
    const next = transitionWorkflow(run.status as WorkflowControlState, event);
    if (next !== expected) throw new Error(`Invalid workflow transition ${run.status} -> ${expected}`);
    run.status = expected;
    run.updated_at = nowIso();
  });
}

export function finalizeWorkflowCompensated(runId: string, message?: string) {
  load();
  persistMutation((draft) => {
    const run = draft.runs[runId];
    if (!run) {
      return;
    }
    if (run.status === 'failed') {
      const compensating = transitionWorkflow('failed', 'COMPENSATE');
      if (compensating !== 'compensating') throw new Error('Invalid workflow compensation transition');
      run.status = 'compensating';
    }
    const compensated = transitionWorkflow(run.status as WorkflowControlState, 'COMPENSATED');
    if (compensated !== 'compensated') throw new Error(`Invalid workflow transition ${run.status} -> compensated`);
    run.status = 'compensated';
    run.updated_at = nowIso();
    run.finished_at = nowIso();
    if (message) {
      run.error = message;
    }
  });
}

export function getWorkflowCheckpoint(runId: string): WorkflowRunCheckpoint | null {
  load();
  const run = store.runs[runId];
  return run ? cloneCheckpoint(run) : null;
}

export function listWorkflowCheckpoints() {
  load();
  return Object.values(store.runs).map((entry) => cloneCheckpoint(entry));
}
