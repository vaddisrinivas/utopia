import { describe, expect, it } from 'vitest';

import { reconcileTimer, workflow } from '@/src/kernel/workflows';

describe('durable workflows', () => {
  it('enforces control transitions and illegal blocks', () => {
    const flow = workflow<{ stage: string }>({
      initial: 'idle',
      states: {
        idle: { on: { START: 'running' } },
        running: { on: { PAUSE: 'paused', FAIL: 'failed' } },
        paused: { on: { RESUME: 'running', CANCEL: 'cancelled' } },
        failed: { on: { COMPENSATE: 'compensating', COMPLETE: 'completed' } },
        compensating: { on: { COMPENSATED: 'compensated', FAIL: 'failed' } },
        compensated: {},
        cancelled: {},
        completed: {},
      },
    });

    const started = flow.advance(undefined, 'START', '2026-08-05T00:00:00.000Z', { stage: 'begin' });
    expect(started).toMatchObject({ state: 'running', control: 'running', revision: 1, checkpoint: { stage: 'begin' } });

    const paused = flow.control(started, 'PAUSE', '2026-08-05T00:00:00.100Z');
    expect(paused.control).toBe('paused');

    expect(() => flow.control(paused, 'PAUSE', '2026-08-05T00:00:00.200Z')).toThrow('workflow_control_illegal');
    expect(() => flow.advance(paused, 'PAUSE')).toThrow('workflow_control_blocked');

    const resumed = flow.control(paused, 'RESUME', '2026-08-05T00:00:00.300Z');
    expect(resumed.control).toBe('running');

    const failed = flow.advance(resumed, 'FAIL', '2026-08-05T00:00:00.400Z');
    expect(failed).toMatchObject({ state: 'failed', revision: 4 });

    const failedControl = flow.control(failed, 'FAIL', '2026-08-05T00:00:00.450Z');
    const repaired = flow.control(failedControl, 'COMPENSATE', '2026-08-05T00:00:00.500Z');
    expect(repaired.state).toBe('failed');
    expect(repaired.control).toBe('compensating');
  });

  it('reconciles timers to review and completed states', () => {
    const running = reconcileTimer({
      durationMs: 200,
      elapsedMs: 20,
      status: 'running',
      updatedAt: '2026-08-05T00:00:00.000Z',
    }, Date.parse('2026-08-05T00:00:00.250Z'));
    expect(running.status).toBe('completed');

    const paused = reconcileTimer({
      durationMs: 500,
      elapsedMs: 50,
      status: 'paused',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(paused).toMatchObject({ status: 'paused', elapsedMs: 50 });

    const reviewed = reconcileTimer({
      durationMs: 500,
      elapsedMs: 0,
      status: 'idle',
      updatedAt: 'not-a-date',
    }, Date.parse('2026-08-05T00:00:00.000Z'));
    expect(reviewed.status).toBe('review');

    const backstep = reconcileTimer({
      durationMs: 100,
      elapsedMs: 90,
      status: 'running',
      updatedAt: '2026-08-05T00:00:00.900Z',
    }, Date.parse('2026-08-05T00:00:00.100Z'));
    expect(backstep.status).toBe('review');
  });
});
