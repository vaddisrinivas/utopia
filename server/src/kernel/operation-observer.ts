export type OperationCommitEvent = {
  actionId: string;
  operationId: string;
  causeId: string;
  domain: string;
  recordId: string;
  before: unknown;
  after: unknown;
};

export type OperationCommitObserver = (event: OperationCommitEvent) => void;
export type OperationCommitFailure = Readonly<{
  schemaVersion: 'wonder.operation-observer-failure.v1';
  phase: string;
  occurredAt: string;
  event: OperationCommitEvent;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
}>;
export type OperationCommitFailureObserver = (failure: OperationCommitFailure) => void;
export type OperationCommitDeliveryResult =
  | Readonly<{ delivered: true }>
  | Readonly<{ delivered: false; failure: OperationCommitFailure | null }>;

let observer: OperationCommitObserver | null = null;
let failureObserver: OperationCommitFailureObserver | null = null;

/** Install the pure reactive observer at the canonical successful-write boundary. */
export function setOperationCommitObserver(next: OperationCommitObserver | null): void {
  observer = next;
}

export function setOperationCommitFailureObserver(next: OperationCommitFailureObserver | null): void {
  failureObserver = next;
}

/**
 * Attempt delivery of a durable commit event.
 *
 * The canonical store owns retry durability. A failed proposal pass never rolls
 * back the committed operation, and the caller must retain the event until this
 * function reports delivery.
 */
export function notifyOperationCommit(event: OperationCommitEvent): OperationCommitDeliveryResult {
  if (!observer) {
    return { delivered: false, failure: null };
  }
  try {
    observer(event);
    return { delivered: true };
  } catch (error) {
    const failure = toOperationCommitFailure(event, error);
    try {
      failureObserver?.(failure);
    } catch {
      // Failure capture must not affect the committed write boundary.
    }
    return { delivered: false, failure };
  }
}

function toOperationCommitFailure(event: OperationCommitEvent, error: unknown): OperationCommitFailure {
  const err = error instanceof Error ? error : new Error(String(error));
  const phase = typeof (error as { phase?: unknown } | null)?.phase === 'string'
    ? String((error as { phase: string }).phase)
    : 'observer';
  return {
    schemaVersion: 'wonder.operation-observer-failure.v1',
    phase,
    occurredAt: new Date().toISOString(),
    event,
    error: {
      name: err.name || 'Error',
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
    },
  };
}
