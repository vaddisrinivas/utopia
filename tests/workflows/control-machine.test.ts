import { describe, expect, it } from 'vitest';

import {
  canTransitionWorkflow,
  transitionWorkflow,
  type WorkflowControlEvent,
  type WorkflowControlState,
} from '@/src/workflows/control-machine';

describe('workflow control contract', () => {
  it('advances through main lifecycle transitions', () => {
    const transitions: Array<{ from: WorkflowControlState; event: WorkflowControlEvent; to: WorkflowControlState }> = [
      { from: 'running', event: 'PAUSE', to: 'paused' },
      { from: 'paused', event: 'RESUME', to: 'running' },
      { from: 'running', event: 'COMPLETE', to: 'completed' },
      { from: 'running', event: 'FAIL', to: 'failed' },
      { from: 'running', event: 'CANCEL', to: 'cancelled' },
      { from: 'failed', event: 'COMPENSATE', to: 'compensating' },
      { from: 'compensating', event: 'COMPENSATED', to: 'compensated' },
    ];

    for (const { from, event, to } of transitions) {
      expect(transitionWorkflow(from, event)).toBe(to);
      expect(canTransitionWorkflow(from, event)).toBe(true);
    }
  });

  it('rejects terminal transitions as no-op', () => {
    expect(canTransitionWorkflow('completed', 'CANCEL')).toBe(false);
    expect(transitionWorkflow('completed', 'CANCEL')).toBe('completed');
  });
});
