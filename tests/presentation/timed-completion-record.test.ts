import { startStepFlow, applyStepFlowEvent } from '@/packages/runtime-kernel/timed-flow';
import {
  buildTimedCompletionRecord,
  normalizeTimedCompletionConfig,
} from '@/src/presentation/widgets/timed-completion-record';
import { describe, expect, it } from 'vitest';

const clock = { utcMs: 1_000, monotonicMs: 1_000, monotonicEpoch: 'test' };

describe('timed completion record', () => {
  it('normalizes only configured generic record targets', () => {
    expect(normalizeTimedCompletionConfig(null)).toBeNull();
    expect(normalizeTimedCompletionConfig({ title: 'Missing collection' })).toBeNull();
    expect(normalizeTimedCompletionConfig({
      collection: 'time_entry',
      title: 'Work session',
      properties: { project: 'Internal' },
    })).toEqual({
      collection: 'time_entry',
      title: 'Work session',
      properties: { project: 'Internal' },
    });
  });

  it('emits one deterministic record shape only for completed flows', () => {
    const started = startStepFlow('install:app:timer', [{ id: 'timer', title: 'Timer', durationMs: 90_000 }], clock);
    expect(buildTimedCompletionRecord({
      runId: started.id,
      snapshot: started,
      config: { collection: 'time_entry', title: 'Session', properties: {} },
      completedAt: '2026-08-01T12:00:00.000Z',
    })).toBeNull();
    const elapsed = applyStepFlowEvent(started, { id: 'observe', kind: 'observe' }, {
      ...clock,
      utcMs: 91_000,
      monotonicMs: 91_000,
    });
    const completed = applyStepFlowEvent(elapsed, { id: 'next', kind: 'next' }, {
      ...clock,
      utcMs: 91_000,
      monotonicMs: 91_000,
    });
    expect(buildTimedCompletionRecord({
      runId: completed.id,
      snapshot: completed,
      config: { collection: 'time_entry', title: 'Session', properties: { project: 'Utopia' } },
      completedAt: '2026-08-01T12:00:00.000Z',
    })).toMatchObject({
      collection: 'time_entry',
      title: 'Session',
      properties: {
        project: 'Utopia',
        duration_seconds: 90,
        duration_minutes: 1.5,
        status: 'completed',
      },
    });
  });
});
