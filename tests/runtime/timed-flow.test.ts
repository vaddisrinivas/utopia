import { describe, expect, it } from 'vitest';

import {
  applyDurationTimerEvent,
  applyStepFlowEvent,
  startDurationTimer,
  startStepFlow,
  timerRemainingMs,
  type ClockSample,
} from '@/packages/runtime-kernel/timed-flow';

const clock = (utcMs: number, monotonicMs = utcMs, monotonicEpoch = 'boot-a'): ClockSample => ({
  utcMs,
  monotonicMs,
  monotonicEpoch,
});

describe('duration timer recovery policy', () => {
  it('survives background and foreground with monotonic time', () => {
    const timer = startDurationTimer('rest', 90_000, clock(0));
    const observed = applyDurationTimerEvent(timer, { id: 'observe', kind: 'observe' }, clock(30_000));
    expect(observed.status).toBe('running');
    expect(timerRemainingMs(observed)).toBe(60_000);
  });

  it('survives process death before expiry through a bounded wall-clock fallback', () => {
    const timer = startDurationTimer('rest', 90_000, clock(0));
    const restored = applyDurationTimerEvent(
      timer,
      { id: 'restore', kind: 'observe' },
      clock(45_000, 10, 'process-b'),
    );
    expect(restored).toMatchObject({ status: 'running', accumulatedMs: 45_000, confidence: 'wall_clock' });
  });

  it('reopening four hours after expiry completes the current step', () => {
    const timer = startDurationTimer('rest', 90_000, clock(0));
    const restored = applyDurationTimerEvent(
      timer,
      { id: 'restore', kind: 'observe' },
      clock(4 * 60 * 60 * 1000, 10, 'process-b'),
    );
    expect(restored).toMatchObject({ status: 'completed', accumulatedMs: 90_000 });
  });

  it('survives a device restart with trusted UTC elapsed time', () => {
    const timer = startDurationTimer('work', 120_000, clock(1_000, 1_000, 'boot-a'));
    const restored = applyDurationTimerEvent(
      timer,
      { id: 'restart', kind: 'observe' },
      clock(61_000, 500, 'boot-b'),
    );
    expect(restored).toMatchObject({ status: 'running', accumulatedMs: 60_000, confidence: 'wall_clock' });
  });

  it('ignores DST because elapsed policy uses UTC and monotonic samples', () => {
    const timer = startDurationTimer('work', 120_000, clock(1_000, 1_000));
    const observed = applyDurationTimerEvent(
      timer,
      { id: 'dst', kind: 'observe' },
      clock(61_000, 61_000),
    );
    expect(observed.accumulatedMs).toBe(60_000);
  });

  it('uses monotonic time through wall-clock forward and backward adjustments', () => {
    const timer = startDurationTimer('work', 120_000, clock(100_000, 1_000));
    const backward = applyDurationTimerEvent(
      timer,
      { id: 'backward', kind: 'observe' },
      clock(20_000, 31_000),
    );
    expect(backward).toMatchObject({ status: 'running', accumulatedMs: 30_000, confidence: 'monotonic' });
  });

  it('requires confirmation when elapsed integrity is uncertain', () => {
    const timer = startDurationTimer('work', 120_000, clock(100_000, 1_000, 'boot-a'));
    const uncertain = applyDurationTimerEvent(
      timer,
      { id: 'rollback', kind: 'observe' },
      clock(20_000, 5, 'boot-b'),
    );
    expect(uncertain).toMatchObject({ status: 'review_required', uncertaintyReason: 'clock_rollback' });
    const confirmed = applyDurationTimerEvent(
      uncertain,
      { id: 'confirm', kind: 'confirm_elapsed', elapsedMs: 30_000 },
      clock(20_000, 5, 'boot-b'),
    );
    expect(confirmed).toMatchObject({ status: 'running', accumulatedMs: 30_000, confidence: 'confirmed' });
  });

  it('makes cancel/retry and duplicate resume deterministic', () => {
    const timer = startDurationTimer('work', 120_000, clock(0));
    const cancelled = applyDurationTimerEvent(timer, { id: 'cancel', kind: 'cancel' }, clock(20_000));
    const retried = applyDurationTimerEvent(cancelled, { id: 'retry', kind: 'retry' }, clock(30_000));
    const paused = applyDurationTimerEvent(retried, { id: 'pause', kind: 'pause' }, clock(40_000));
    const resumed = applyDurationTimerEvent(paused, { id: 'resume', kind: 'resume' }, clock(50_000));
    expect(applyDurationTimerEvent(resumed, { id: 'resume', kind: 'resume' }, clock(60_000))).toBe(resumed);
  });

  it('preserves active state across an app update because snapshots are versioned data', () => {
    const beforeUpdate = startDurationTimer('work', 120_000, clock(0));
    const serialized = JSON.stringify(beforeUpdate);
    const afterUpdate = applyDurationTimerEvent(
      JSON.parse(serialized),
      { id: 'after-update', kind: 'observe' },
      clock(30_000),
    );
    expect(afterUpdate).toMatchObject({
      schemaVersion: 'utopia.duration-timer.v1',
      status: 'running',
      accumulatedMs: 30_000,
    });
  });
});

describe('step flow', () => {
  it('persists bounded steps and advances only after explicit confirmation', () => {
    const flow = startStepFlow('workout', [
      { id: 'work', title: 'Work', durationMs: 30_000 },
      { id: 'rest', title: 'Rest', durationMs: 15_000 },
      { id: 'log', title: 'Log set' },
    ], clock(0));
    const complete = applyStepFlowEvent(flow, { id: 'observe', kind: 'observe' }, clock(35_000));
    expect(complete.status).toBe('step_complete');
    const next = applyStepFlowEvent(complete, { id: 'next', kind: 'next' }, clock(35_000));
    expect(next).toMatchObject({ currentStep: 1, status: 'running' });
  });

  it('rejects stale concurrent transitions', () => {
    const flow = startStepFlow('workout', [{ id: 'log', title: 'Log set' }], clock(0));
    expect(() => applyStepFlowEvent(
      flow,
      { id: 'stale', kind: 'next', expectedRevision: 0 },
      clock(1),
    )).toThrow('step_flow_revision_conflict');
  });

  it('restarts a completed flow from its first step', () => {
    const flow = startStepFlow('single', [{ id: 'log', title: 'Log set' }], clock(0));
    const completed = applyStepFlowEvent(flow, { id: 'finish', kind: 'next' }, clock(1));
    const restarted = applyStepFlowEvent(completed, { id: 'restart', kind: 'retry' }, clock(2));
    expect(restarted).toMatchObject({ currentStep: 0, status: 'running' });
  });
});
