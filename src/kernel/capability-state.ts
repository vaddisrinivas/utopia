export type CapabilityExecutionState = 'idle' | 'running' | 'success' | 'denied' | 'cancelled' | 'unavailable' | 'retry';
export type CapabilityTerminalState = Exclude<CapabilityExecutionState, 'idle' | 'running'>;

export type CapabilityResult<T = unknown> = {
  state: CapabilityTerminalState;
  message: string;
  value?: T;
  retryable?: boolean;
};

export type CapabilityActionState = {
  state: CapabilityExecutionState;
  message: string;
  retryable?: boolean;
};

export type CapabilityStateConfig = {
  value?: string;
  retryable?: boolean;
};

const stateMessages: Record<CapabilityExecutionState, string> = {
  idle: 'Ready',
  running: 'Running',
  success: 'Done',
  denied: 'Permission denied',
  cancelled: 'Cancelled',
  unavailable: 'Unavailable on platform',
  retry: 'Retry',
};

export function capabilityMessage(state: CapabilityExecutionState, fallback = '') {
  return fallback || stateMessages[state] || 'Unknown';
}

export function isCapabilityTerminal(state: CapabilityExecutionState): state is CapabilityTerminalState {
  return state !== 'idle' && state !== 'running';
}

export class CapabilityStateError extends Error {
  constructor(
    public readonly state: CapabilityTerminalState,
    public readonly retryable = false,
    message?: string,
  ) {
    super(message);
    this.name = 'CapabilityStateError';
  }
}

export function mapCapabilityConfig(_state: CapabilityActionState, config: CapabilityStateConfig): CapabilityActionState {
  if (!config.value) return { ..._state, message: capabilityMessage(_state.state) };
  return { ..._state, message: `${_state.message}: ${config.value}` };
}

function toStringError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'Operation failed';
}

function lower(value: string): string {
  return value.toLowerCase();
}

export function classifyCapabilityError(cause: unknown): CapabilityTerminalState {
  if (cause instanceof CapabilityStateError) return cause.state;

  const message = lower(toStringError(cause));
  if (!message) return 'retry';

  if (message.includes('cancel') || message.includes('dismiss') || message.includes('abandon')) {
    return 'cancelled';
  }
  if (message.includes('denied') || message.includes('permission') || message.includes('forbidden')) {
    return 'denied';
  }
  if (message.includes('unavailable') || message.includes('not available') || message.includes('unsupported') || message.includes('unsupported on this platform')) {
    return 'unavailable';
  }
  if (message.includes('not found')) {
    return 'retry';
  }

  return 'retry';
}

export async function executeCapability<T>(operation: () => Promise<T>): Promise<CapabilityResult<T>> {
  try {
    const value = await operation();
    return { state: 'success', message: capabilityMessage('success'), retryable: false, value };
  } catch (cause) {
    const state = classifyCapabilityError(cause);
    const retryable = cause instanceof CapabilityStateError ? cause.retryable : true;
    return { state, message: toStringError(cause), retryable, value: undefined };
  }
}
