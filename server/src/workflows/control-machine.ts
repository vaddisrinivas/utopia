import { createActor, createMachine } from 'xstate';

export type WorkflowControlState = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'compensating' | 'compensated';
export type WorkflowControlEvent = 'PAUSE' | 'RESUME' | 'COMPLETE' | 'FAIL' | 'CANCEL' | 'COMPENSATE' | 'COMPENSATED';

const machine = createMachine({
  id: 'utopia-workflow-control',
  initial: 'running',
  states: {
    running: { on: { PAUSE: 'paused', COMPLETE: 'completed', FAIL: 'failed', CANCEL: 'cancelled' } },
    paused: { on: { RESUME: 'running', CANCEL: 'cancelled' } },
    failed: { on: { COMPENSATE: 'compensating' } },
    compensating: { on: { COMPENSATED: 'compensated', FAIL: 'failed' } },
    completed: {},
    cancelled: {},
    compensated: {},
  },
});

/**
 * XState owns lifecycle transitions only. Effects and record writes remain
 * outside this module and must be emitted as kernel Operations.
 */
export function transitionWorkflow(state: WorkflowControlState, event: WorkflowControlEvent): WorkflowControlState {
  const actor = createActor(machine, { snapshot: machine.resolveState({ value: state }) }).start();
  actor.send({ type: event });
  return actor.getSnapshot().value as WorkflowControlState;
}

export function canTransitionWorkflow(state: WorkflowControlState, event: WorkflowControlEvent): boolean {
  return transitionWorkflow(state, event) !== state;
}
