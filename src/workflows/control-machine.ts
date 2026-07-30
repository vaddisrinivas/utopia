export type WorkflowControlState = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'compensating' | 'compensated';

export type WorkflowControlEvent = 'PAUSE' | 'RESUME' | 'COMPLETE' | 'FAIL' | 'CANCEL' | 'COMPENSATE' | 'COMPENSATED';

const workflowControlTransitions: Record<WorkflowControlState, Partial<Record<WorkflowControlEvent, WorkflowControlState>>> = {
  running: {
    PAUSE: 'paused',
    COMPLETE: 'completed',
    FAIL: 'failed',
    CANCEL: 'cancelled',
  },
  paused: {
    RESUME: 'running',
    CANCEL: 'cancelled',
  },
  failed: {
    COMPENSATE: 'compensating',
  },
  compensating: {
    COMPENSATED: 'compensated',
    FAIL: 'failed',
  },
  completed: {},
  cancelled: {},
  compensated: {},
};

export function transitionWorkflow(state: WorkflowControlState, event: WorkflowControlEvent): WorkflowControlState {
  return workflowControlTransitions[state][event] ?? state;
}

export function canTransitionWorkflow(state: WorkflowControlState, event: WorkflowControlEvent): boolean {
  return transitionWorkflow(state, event) !== state;
}
