import type { AppPackage } from './package';
import { recordReactiveCycle, type ReactiveReceiptStore, type RecordReactiveCycleResult } from './reactive-receipts';
import { runLivingRuleWorker } from './living-rule-worker';
import type { ReactiveCycleResult } from './reactive-cycle';
import type { OperationCommitEvent, OperationCommitObserver } from './operation-observer';

type ReactiveObserverPhase = 'snapshot_rows' | 'run_cycle' | 'record_receipt' | 'commit_cycle' | 'publish_proposals';

export type ReactiveObserverConfig = {
  package: AppPackage;
  getRows: () => readonly Record<string, unknown>[];
  getReceiptStore: () => ReactiveReceiptStore;
  setReceiptStore: (store: ReactiveReceiptStore) => void;
  commitCycle?: (input: {
    receipt: RecordReactiveCycleResult;
    cycle: ReactiveCycleResult;
    event: OperationCommitEvent;
  }) => void;
  onNewProposals?: (proposalIds: readonly string[], cycle: ReactiveCycleResult, event: OperationCommitEvent) => void;
  onFailure?: (input: {
    event: OperationCommitEvent;
    phase: ReactiveObserverPhase;
    error: Error;
  }) => void;
};

/** Adapt committed operations to the pure reactive cycle and receipt ledger. */
export function createReactiveCycleObserver(config: ReactiveObserverConfig): OperationCommitObserver {
  return (event) => {
    const afterRows = attempt('snapshot_rows', config, event, () => [...config.getRows()]);
    const beforeRows = afterRows.filter((row) => row.id !== event.recordId);
    if (event.before && typeof event.before === 'object') {
      beforeRows.push(event.before as Record<string, unknown>);
    }
    const cycle = attempt('run_cycle', config, event, () => runLivingRuleWorker({
      package: config.package,
      beforeRows,
      afterRows,
      event: { kind: 'operation', id: event.operationId },
      data: event,
      causeId: event.causeId,
    }));
    const receipt = attempt('record_receipt', config, event, () => recordReactiveCycle(config.getReceiptStore(), {
      cycleId: cycle.cycleId,
      proposals: cycle.proposals,
    }));
    if (config.commitCycle) {
      attempt('commit_cycle', config, event, () => {
        config.commitCycle?.({ receipt, cycle, event });
      });
      return;
    }
    attempt('commit_cycle', config, event, () => {
      config.setReceiptStore(receipt.store);
    });
    if (receipt.newProposalIds.length && config.onNewProposals) {
      attempt('publish_proposals', config, event, () => {
        config.onNewProposals?.(receipt.newProposalIds, cycle, event);
      });
    }
  };
}

function attempt<T>(
  phase: ReactiveObserverPhase,
  config: ReactiveObserverConfig,
  event: OperationCommitEvent,
  run: () => T,
): T {
  try {
    return run();
  } catch (error) {
    const wrapped = toReactiveObserverError(phase, error);
    config.onFailure?.({ event, phase, error: wrapped });
    throw wrapped;
  }
}

function toReactiveObserverError(phase: ReactiveObserverPhase, error: unknown): Error & { phase: ReactiveObserverPhase } {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  return Object.assign(wrapped, { phase });
}
