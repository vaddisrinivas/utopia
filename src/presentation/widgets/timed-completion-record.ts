import type { StepFlowSnapshot } from '@/packages/runtime-kernel/timed-flow';

export type TimedCompletionConfig = Readonly<{
  collection: string;
  title: string;
  properties: Record<string, unknown>;
}>;

export function normalizeTimedCompletionConfig(input: unknown): TimedCompletionConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const collection = requiredText(row.collection);
  if (!collection) return null;
  return {
    collection,
    title: requiredText(row.title) || 'Completed session',
    properties: row.properties && typeof row.properties === 'object' && !Array.isArray(row.properties)
      ? { ...row.properties as Record<string, unknown> }
      : {},
  };
}

export function buildTimedCompletionRecord(input: {
  runId: string;
  snapshot: StepFlowSnapshot;
  config: TimedCompletionConfig;
  completedAt: string;
}) {
  if (input.snapshot.status !== 'completed') return null;
  const durationMs = input.snapshot.steps.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  const stableRun = input.runId.replace(/[^A-Za-z0-9_-]/g, '-');
  return {
    id: `${stableRun}-completion-${input.snapshot.revision}`,
    collection: input.config.collection,
    title: input.config.title,
    properties: {
      ...input.config.properties,
      workflow_run_id: input.runId,
      completed_at: input.completedAt,
      duration_seconds: Math.round(durationMs / 1000),
      duration_minutes: Math.round((durationMs / 60000) * 100) / 100,
      step_count: input.snapshot.steps.length,
      status: 'completed',
    },
  };
}

function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
