export const REACTIVE_RECEIPT_SCHEMA_VERSION = 'wonder.reactive-receipts.v1' as const;

export type ReactiveCycleReceipt = Readonly<{
  cycleId: string;
  proposalIds: readonly string[];
}>;

export type ReactiveProposalReceipt = Readonly<{
  proposalId: string;
  firstCycleId: string;
}>;

export type ReactiveReceiptStore = Readonly<{
  schemaVersion: typeof REACTIVE_RECEIPT_SCHEMA_VERSION;
  cycles: Readonly<Record<string, ReactiveCycleReceipt>>;
  proposals: Readonly<Record<string, ReactiveProposalReceipt>>;
}>;

export type ReactiveCycleReceiptInput = Readonly<{
  cycleId: string;
  proposals: readonly Readonly<{ id: string }>[];
}>;

export type RecordReactiveCycleResult = Readonly<{
  store: ReactiveReceiptStore;
  receipt: ReactiveCycleReceipt;
  isNewCycle: boolean;
  newProposalIds: readonly string[];
  duplicateProposalIds: readonly string[];
}>;

export function createReactiveReceiptStore(): ReactiveReceiptStore {
  return immutable({
    schemaVersion: REACTIVE_RECEIPT_SCHEMA_VERSION,
    cycles: {},
    proposals: {},
  });
}

/**
 * Records deterministic cycle/proposal identifiers without executing proposals
 * or mutating the provided store. Callers persist `result.store` at their
 * operation commit boundary and execute only `result.newProposalIds`.
 */
export function recordReactiveCycle(
  store: ReactiveReceiptStore,
  cycle: ReactiveCycleReceiptInput,
): RecordReactiveCycleResult {
  const cycleId = requiredId(cycle.cycleId, 'cycle id');
  const proposalIds = cycle.proposals.map((proposal) => requiredId(proposal.id, 'proposal id'));
  const uniqueProposalIds = [...new Set(proposalIds)].sort();
  if (uniqueProposalIds.length !== proposalIds.length) {
    throw new Error(`Reactive cycle ${cycleId} contains duplicate proposal ids.`);
  }

  const existingCycle = store.cycles[cycleId];
  if (existingCycle) {
    if (!sameIds(existingCycle.proposalIds, uniqueProposalIds)) {
      throw new Error(`Reactive cycle ${cycleId} conflicts with its persisted receipt.`);
    }
    return immutable({
      store,
      receipt: existingCycle,
      isNewCycle: false,
      newProposalIds: [],
      duplicateProposalIds: uniqueProposalIds,
    });
  }

  const newProposalIds: string[] = [];
  const duplicateProposalIds: string[] = [];
  const proposals: Record<string, ReactiveProposalReceipt> = { ...store.proposals };
  for (const proposalId of uniqueProposalIds) {
    if (proposals[proposalId]) {
      duplicateProposalIds.push(proposalId);
      continue;
    }
    newProposalIds.push(proposalId);
    proposals[proposalId] = {
      proposalId,
      firstCycleId: cycleId,
    };
  }

  const receipt: ReactiveCycleReceipt = {
    cycleId,
    proposalIds: uniqueProposalIds,
  };
  const nextStore = immutable({
    schemaVersion: REACTIVE_RECEIPT_SCHEMA_VERSION,
    cycles: sortRecord({
      ...store.cycles,
      [cycleId]: receipt,
    }),
    proposals: sortRecord(proposals),
  });

  return immutable({
    store: nextStore,
    receipt: nextStore.cycles[cycleId],
    isNewCycle: true,
    newProposalIds,
    duplicateProposalIds,
  });
}

export function serializeReactiveReceiptStore(store: ReactiveReceiptStore): string {
  return JSON.stringify(store);
}

export function parseReactiveReceiptStore(serialized: string): ReactiveReceiptStore {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Reactive receipt store is not valid JSON.');
  }
  if (!isObject(value) || value.schemaVersion !== REACTIVE_RECEIPT_SCHEMA_VERSION) {
    throw new Error('Reactive receipt store has an unsupported schema version.');
  }
  if (!isObject(value.cycles) || !isObject(value.proposals)) {
    throw new Error('Reactive receipt store must contain cycle and proposal maps.');
  }

  const cycles: Record<string, ReactiveCycleReceipt> = {};
  for (const [key, rawReceipt] of Object.entries(value.cycles)) {
    if (!isObject(rawReceipt) || rawReceipt.cycleId !== key || !Array.isArray(rawReceipt.proposalIds)) {
      throw new Error(`Reactive cycle receipt ${key} is invalid.`);
    }
    const proposalIds = rawReceipt.proposalIds.map((id) => requiredId(id, 'proposal id'));
    const uniqueProposalIds = [...new Set(proposalIds)].sort();
    if (uniqueProposalIds.length !== proposalIds.length) {
      throw new Error(`Reactive cycle receipt ${key} contains duplicate proposal ids.`);
    }
    cycles[key] = { cycleId: key, proposalIds: uniqueProposalIds };
  }

  const proposals: Record<string, ReactiveProposalReceipt> = {};
  for (const [key, rawReceipt] of Object.entries(value.proposals)) {
    if (
      !isObject(rawReceipt)
      || rawReceipt.proposalId !== key
      || typeof rawReceipt.firstCycleId !== 'string'
      || !cycles[rawReceipt.firstCycleId]?.proposalIds.includes(key)
    ) {
      throw new Error(`Reactive proposal receipt ${key} is invalid.`);
    }
    proposals[key] = {
      proposalId: key,
      firstCycleId: rawReceipt.firstCycleId,
    };
  }

  for (const receipt of Object.values(cycles)) {
    for (const proposalId of receipt.proposalIds) {
      if (!proposals[proposalId]) {
        throw new Error(`Reactive proposal receipt ${proposalId} is missing.`);
      }
    }
  }

  return immutable({
    schemaVersion: REACTIVE_RECEIPT_SCHEMA_VERSION,
    cycles: sortRecord(cycles),
    proposals: sortRecord(proposals),
  });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Reactive ${field} is required.`);
  }
  return value.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sortRecord<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    immutable(child);
  }
  return Object.freeze(value);
}
