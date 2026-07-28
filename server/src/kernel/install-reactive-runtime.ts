import { existsSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildAppPackageFromManifest } from '@/src/domain/app-package-bridge';
import { loadCatalog } from '../../../src/domain/catalog';
import {
  createActionEvent,
  drainOperationCommitOutbox,
  findActionByIdempotencyKey,
  listRecords,
} from '../runtime/state';
import { mutateJsonStateFile, readJsonStateFile } from '../providers/json-state';
import { setOperationCommitFailureObserver, setOperationCommitObserver, type OperationCommitFailure } from './operation-observer';
import { createReactiveCycleObserver } from './reactive-observer';
import { createReactiveReceiptStore, parseReactiveReceiptStore, type ReactiveReceiptStore } from './reactive-receipts';
import { PackageRegistry } from './package-registry';
import {
  createReactiveOutboxStore,
  drainReactiveOutbox,
  enqueueReactiveProposals,
  listRunnableReactiveOutboxItems,
  mergeReactiveOutboxStores,
  parseReactiveOutboxStore,
  recoverReactiveOutboxStore,
  type ReactiveOutboxExecutionResult,
  type ReactiveOutboxItem,
  type ReactiveOutboxStore,
} from './reactive-outbox';
import { executeReactiveProposalLive } from './reactive-proposal-executor';

const REACTIVE_RUNTIME_SCHEMA_VERSION = 'wonder.reactive-runtime.v1' as const;
const DEFAULT_RUNTIME_PATH = process.env.LIFEOS_REACTIVE_RUNTIME_PATH?.trim()
  || `${process.cwd()}/server-data/reactive-runtime.json`;
const DEFAULT_PACKAGE_REGISTRY_PATH = process.env.LIFEOS_PACKAGE_REGISTRY_PATH?.trim()
  || `${process.cwd()}/server-data/package-registry.json`;
const LEGACY_RECEIPT_PATH = process.env.LIFEOS_REACTIVE_RECEIPTS_PATH?.trim()
  || `${process.cwd()}/server-data/reactive-receipts.json`;
const REACTIVE_WORKER_POLL_INTERVAL_MS = positiveIntegerFromEnv(process.env.LIFEOS_REACTIVE_WORKER_POLL_INTERVAL_MS, 15_000);
const REACTIVE_WORKER_LEASE_TTL_MS = positiveIntegerFromEnv(process.env.LIFEOS_REACTIVE_WORKER_LEASE_TTL_MS, 30_000);
const REACTIVE_WORKER_HEARTBEAT_MS = Math.max(1_000, Math.min(
  positiveIntegerFromEnv(process.env.LIFEOS_REACTIVE_WORKER_HEARTBEAT_MS, Math.floor(REACTIVE_WORKER_LEASE_TTL_MS / 2)),
  Math.floor(REACTIVE_WORKER_LEASE_TTL_MS / 2),
));
const REACTIVE_WORKER_MAX_ITEMS_PER_DRAIN = positiveIntegerFromEnv(process.env.LIFEOS_REACTIVE_WORKER_MAX_ITEMS_PER_DRAIN, 8);
const REACTIVE_WORKER_RETRY_DELAY_MS = positiveIntegerFromEnv(process.env.LIFEOS_REACTIVE_WORKER_RETRY_DELAY_MS, 60_000);

type ReactiveRuntimeStore = Readonly<{
  schemaVersion: typeof REACTIVE_RUNTIME_SCHEMA_VERSION;
  receipts: ReactiveReceiptStore;
  outbox: ReactiveOutboxStore;
}>;

type ReactiveRuntimeLease = Readonly<{
  ownerId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}>;

type ReactiveRuntimeWorker = {
  ownerId: string;
  path: string;
  leasePath: string;
  executeProposal: (item: ReactiveOutboxItem) => Promise<ReactiveOutboxExecutionResult> | ReactiveOutboxExecutionResult;
  stopped: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  pollIntervalMs: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  maxItemsPerDrain: number;
  retryDelayMs: number;
};

let activeWorker: ReactiveRuntimeWorker | null = null;
let cleanupHooksInstalled = false;

function positiveIntegerFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createReactiveRuntimeStore(): ReactiveRuntimeStore {
  return {
    schemaVersion: REACTIVE_RUNTIME_SCHEMA_VERSION,
    receipts: createReactiveReceiptStore(),
    outbox: createReactiveOutboxStore(),
  };
}

function loadReceipts(path: string): ReactiveReceiptStore {
  if (!existsSync(path)) return createReactiveReceiptStore();
  return parseReactiveReceiptStore(readFileSync(path, 'utf8'));
}

function parseRuntimeStoreValue(value: unknown): ReactiveRuntimeStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Reactive runtime store is not an object.');
  }
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== REACTIVE_RUNTIME_SCHEMA_VERSION) {
    throw new Error('Reactive runtime store has an unsupported schema version.');
  }
  return {
    schemaVersion: REACTIVE_RUNTIME_SCHEMA_VERSION,
    receipts: parseReactiveReceiptStore(JSON.stringify(row.receipts)),
    outbox: parseReactiveOutboxStore(JSON.stringify(row.outbox)),
  };
}

function isReactiveRuntimeStore(value: unknown): value is ReactiveRuntimeStore {
  try {
    parseRuntimeStoreValue(value);
    return true;
  } catch {
    return false;
  }
}

function parseRuntimeStore(serialized: string): ReactiveRuntimeStore {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Reactive runtime store is not valid JSON.');
  }
  return parseRuntimeStoreValue(value);
}

function createDefaultRuntimeStore(): ReactiveRuntimeStore {
  if (existsSync(LEGACY_RECEIPT_PATH)) {
    return {
      ...createReactiveRuntimeStore(),
      receipts: loadReceipts(LEGACY_RECEIPT_PATH),
    };
  }
  return createReactiveRuntimeStore();
}

function loadRuntimeStore(path: string): ReactiveRuntimeStore {
  if (existsSync(path)) {
    try {
      return parseRuntimeStore(readFileSync(path, 'utf8'));
    } catch {
      try {
        return parseRuntimeStoreValue(readJsonStateFile(path, {
          label: 'reactive runtime state',
          validate: isReactiveRuntimeStore,
        }));
      } catch {
        return createDefaultRuntimeStore();
      }
    }
  }
  return createDefaultRuntimeStore();
}

function persistRuntimeStore(
  path: string,
  mutate: (current: ReactiveRuntimeStore) => ReactiveRuntimeStore,
): ReactiveRuntimeStore {
  return mutateJsonStateFile(path, {
    label: 'reactive runtime state',
    validate: isReactiveRuntimeStore,
    createDefault: createDefaultRuntimeStore,
    mutate: (current) => mutate(parseRuntimeStoreValue(current)),
  });
}

function mergeAndWriteRuntimeOutbox(path: string, outbox: ReactiveOutboxStore): ReactiveRuntimeStore {
  return persistRuntimeStore(path, (current) => ({
    ...current,
    outbox: mergeReactiveOutboxStores(current.outbox, outbox),
  }));
}

function recoverRuntimeOutbox(path: string, now = new Date().toISOString()): ReactiveRuntimeStore {
  return persistRuntimeStore(path, (current) => ({
    ...current,
    outbox: recoverReactiveOutboxStore(current.outbox, {
      now,
      retryDelayMs: 0,
      runningReason: 'worker_recovery',
      awaitingReviewReason: 'approval_resumed',
      shouldResumeAwaitingReview: (item) => {
        const action = findActionByIdempotencyKey(item.proposal.envelope.idempotencyKey);
        return action?.status === 'completed';
      },
    }),
  }));
}

function leasePathForRuntime(path: string): string {
  return `${path}.lease`;
}

function parseLease(serialized: string): ReactiveRuntimeLease | null {
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      typeof value.ownerId === 'string'
      && typeof value.acquiredAt === 'string'
      && typeof value.heartbeatAt === 'string'
      && typeof value.expiresAt === 'string'
    ) {
      return {
        ownerId: value.ownerId,
        acquiredAt: value.acquiredAt,
        heartbeatAt: value.heartbeatAt,
        expiresAt: value.expiresAt,
      };
    }
  } catch {
    // Treat a malformed lease as stale and replaceable.
  }
  return null;
}

function readLease(path: string): ReactiveRuntimeLease | null {
  if (!existsSync(path)) return null;
  return parseLease(readFileSync(path, 'utf8'));
}

function writeLease(path: string, lease: ReactiveRuntimeLease): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, JSON.stringify(lease, null, 2), 'utf8');
  try {
    renameSync(tempPath, path);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLeaseGuard<T>(path: string, mutate: () => T): T {
  const guardPath = `${path}.guard`;
  const deadline = Date.now() + 2_000;
  mkdirSync(dirname(path), { recursive: true });
  while (true) {
    try {
      mkdirSync(guardPath);
      break;
    } catch (error) {
      try {
        if (Date.now() - statSync(guardPath).mtimeMs > 10_000) {
          rmSync(guardPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Timed out waiting for reactive lease guard ${guardPath}: ${detail}`);
      }
      sleepSync(5);
    }
  }
  try {
    return mutate();
  } finally {
    rmSync(guardPath, { recursive: true, force: true });
  }
}

function clearLease(path: string, ownerId?: string): void {
  withLeaseGuard(path, () => {
    const lease = readLease(path);
    if (!lease) {
      unlinkIfExists(path);
      return;
    }
    if (ownerId && lease.ownerId !== ownerId) {
      return;
    }
    unlinkIfExists(path);
  });
}

function unlinkIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function tryAcquireLease(worker: ReactiveRuntimeWorker, now = Date.now()): { acquired: boolean; retryMs: number } {
  return withLeaseGuard(worker.leasePath, () => {
    const lease = readLease(worker.leasePath);
    if (lease && lease.ownerId !== worker.ownerId && Date.parse(lease.expiresAt) > now) {
      return {
        acquired: false,
        retryMs: Math.max(250, Date.parse(lease.expiresAt) - now),
      };
    }
    const acquiredAt = lease?.ownerId === worker.ownerId ? lease.acquiredAt : new Date(now).toISOString();
    writeLease(worker.leasePath, {
      ownerId: worker.ownerId,
      acquiredAt,
      heartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(now + worker.leaseTtlMs).toISOString(),
    });
    const written = readLease(worker.leasePath);
    return {
      acquired: written?.ownerId === worker.ownerId,
      retryMs: worker.pollIntervalMs,
    };
  });
}

function renewLease(worker: ReactiveRuntimeWorker): boolean {
  if (worker.stopped) return false;
  return withLeaseGuard(worker.leasePath, () => {
    const lease = readLease(worker.leasePath);
    if (!lease || lease.ownerId !== worker.ownerId) {
      return false;
    }
    const now = Date.now();
    writeLease(worker.leasePath, {
      ownerId: worker.ownerId,
      acquiredAt: lease.acquiredAt,
      heartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(now + worker.leaseTtlMs).toISOString(),
    });
    return readLease(worker.leasePath)?.ownerId === worker.ownerId;
  });
}

function ownsLiveLease(worker: ReactiveRuntimeWorker): boolean {
  return withLeaseGuard(worker.leasePath, () => {
    const lease = readLease(worker.leasePath);
    return Boolean(
      lease
      && lease.ownerId === worker.ownerId
      && Date.parse(lease.expiresAt) > Date.now(),
    );
  });
}

function ensureHeartbeat(worker: ReactiveRuntimeWorker): void {
  if (worker.heartbeat) return;
  worker.heartbeat = setInterval(() => {
    try {
      if (!renewLease(worker) && worker.heartbeat) {
        clearInterval(worker.heartbeat);
        worker.heartbeat = null;
      }
    } catch {
      // The next wake will attempt to reacquire.
    }
  }, worker.heartbeatMs);
  (worker.heartbeat as unknown as NodeJS.Timeout).unref?.();
}

function clearWorkerTimers(worker: ReactiveRuntimeWorker): void {
  if (worker.timer) {
    clearTimeout(worker.timer);
    worker.timer = null;
  }
  if (worker.heartbeat) {
    clearInterval(worker.heartbeat);
    worker.heartbeat = null;
  }
}

function scheduleWorker(worker: ReactiveRuntimeWorker, delayMs: number): void {
  if (worker.stopped) return;
  if (worker.timer) clearTimeout(worker.timer);
  worker.timer = setTimeout(() => {
    worker.timer = null;
    void runWorkerPass(worker);
  }, Math.max(0, delayMs));
  (worker.timer as unknown as NodeJS.Timeout).unref?.();
}

async function runWorkerPass(worker: ReactiveRuntimeWorker): Promise<void> {
  if (worker.stopped || worker.running) return;
  worker.running = true;
  try {
    const lease = tryAcquireLease(worker);
    if (!lease.acquired) {
      scheduleWorker(worker, Math.min(lease.retryMs, worker.pollIntervalMs));
      return;
    }
    ensureHeartbeat(worker);
    if (!ownsLiveLease(worker)) {
      scheduleWorker(worker, worker.pollIntervalMs);
      return;
    }
    drainOperationCommitOutbox({ maxItems: worker.maxItemsPerDrain });
    recoverRuntimeOutbox(worker.path);
    const result = await drainReactiveRuntimeOutbox({
      path: worker.path,
      executeProposal: async (item) => {
        if (!ownsLiveLease(worker)) {
          return { ok: false, error: 'reactive_worker_lease_lost' };
        }
        return worker.executeProposal(item);
      },
      maxItems: worker.maxItemsPerDrain,
      retryDelayMs: worker.retryDelayMs,
    });
    const store = loadRuntimeStore(worker.path);
    const runnable = listRunnableReactiveOutboxItems(store.outbox).length;
    const resumeReady = Object.values(store.outbox.items).some((item) => {
      if (item.status !== 'awaiting_review') return false;
      return findActionByIdempotencyKey(item.proposal.envelope.idempotencyKey)?.status === 'completed';
    });
    if (runnable > 0 || result.attempted.length >= worker.maxItemsPerDrain || resumeReady) {
      scheduleWorker(worker, 0);
      return;
    }
    scheduleWorker(worker, worker.pollIntervalMs);
  } finally {
    worker.running = false;
  }
}

function installCleanupHooks(): void {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;
  const cleanup = () => {
    try {
      stopReactiveRuntimeWorker();
    } catch {
      // Best effort only.
    }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

export function startReactiveRuntimeWorker(input: {
  path?: string;
  executeProposal?: (item: ReactiveOutboxItem) => Promise<ReactiveOutboxExecutionResult> | ReactiveOutboxExecutionResult;
} = {}) {
  const path = input.path ?? DEFAULT_RUNTIME_PATH;
  if (activeWorker && activeWorker.path !== path) {
    stopReactiveRuntimeWorker();
  }
  if (!activeWorker) {
    activeWorker = {
      ownerId: `reactive-runtime:${process.pid}:${Date.now()}`,
      path,
      leasePath: leasePathForRuntime(path),
      executeProposal: input.executeProposal ?? executeReactiveProposalLive,
      stopped: false,
      running: false,
      timer: null,
      heartbeat: null,
      pollIntervalMs: REACTIVE_WORKER_POLL_INTERVAL_MS,
      leaseTtlMs: REACTIVE_WORKER_LEASE_TTL_MS,
      heartbeatMs: REACTIVE_WORKER_HEARTBEAT_MS,
      maxItemsPerDrain: REACTIVE_WORKER_MAX_ITEMS_PER_DRAIN,
      retryDelayMs: REACTIVE_WORKER_RETRY_DELAY_MS,
    };
  } else {
    activeWorker.executeProposal = input.executeProposal ?? activeWorker.executeProposal;
    activeWorker.path = path;
    activeWorker.leasePath = leasePathForRuntime(path);
    activeWorker.stopped = false;
  }
  installCleanupHooks();
  scheduleWorker(activeWorker, 0);
  return activeWorker;
}

export function wakeReactiveRuntimeWorker(): void {
  if (!activeWorker || activeWorker.stopped) return;
  scheduleWorker(activeWorker, 0);
}

export function stopReactiveRuntimeWorker(): void {
  if (!activeWorker) return;
  activeWorker.stopped = true;
  clearWorkerTimers(activeWorker);
  clearLease(activeWorker.leasePath, activeWorker.ownerId);
  activeWorker = null;
}

/** Install the default manifest-backed observer at server startup. */
export function installReactiveRuntime(path = DEFAULT_RUNTIME_PATH): void {
  const manifest = loadCatalog().activeManifest;
  const registry = new PackageRegistry({ path: DEFAULT_PACKAGE_REGISTRY_PATH });
  const activePackage = registry.getActive();
  const appPackage = activePackage ?? registry.activate(buildAppPackageFromManifest(manifest).package);

  setOperationCommitFailureObserver((failure) => {
    recordReactiveObserverFailure(failure);
  });
  setOperationCommitObserver(createReactiveCycleObserver({
    package: appPackage,
    getRows: () => listRecords({ domain: appPackage.id, includeArchived: true }) as unknown as Record<string, unknown>[],
    getReceiptStore: () => loadRuntimeStore(path).receipts,
    setReceiptStore: (next) => {
      persistRuntimeStore(path, (current) => ({ ...current, receipts: next }));
    },
    commitCycle: ({ receipt, cycle, event }) => {
      persistRuntimeStore(path, (current) => ({
        schemaVersion: REACTIVE_RUNTIME_SCHEMA_VERSION,
        receipts: receipt.store,
        outbox: enqueueReactiveProposals(current.outbox, {
          cycle,
          event,
          proposalIds: receipt.newProposalIds,
        }),
      }));
      wakeReactiveRuntimeWorker();
    },
  }));
  drainOperationCommitOutbox();
  startReactiveRuntimeWorker({ path });
}

export async function drainReactiveRuntimeOutbox(input: {
  path?: string;
  executeProposal?: (item: ReactiveOutboxItem) => Promise<ReactiveOutboxExecutionResult> | ReactiveOutboxExecutionResult;
  now?: string;
  maxItems?: number;
  retryDelayMs?: number;
}) {
  const path = input.path ?? DEFAULT_RUNTIME_PATH;
  const recovered = recoverRuntimeOutbox(path, input.now);
  const result = await drainReactiveOutbox({
    store: recovered.outbox,
    executeProposal: input.executeProposal ?? executeReactiveProposalLive,
    now: input.now,
    maxItems: input.maxItems,
    retryDelayMs: input.retryDelayMs,
    onStoreChange: (outbox) => {
      mergeAndWriteRuntimeOutbox(path, outbox);
    },
  });
  const persisted = mergeAndWriteRuntimeOutbox(path, result.store);
  return {
    ...result,
    store: persisted.outbox,
  };
}

function recordReactiveObserverFailure(failure: OperationCommitFailure): void {
  const event = failure.event;
  const id = `reactive-observer-failure:${event.operationId.replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
  createActionEvent({
    id,
    actor: 'reactive-runtime',
    domain: event.domain,
    tool: 'reactive_observer_failure',
    risk: 'sensitive',
    status: 'failed',
    recordIds: event.recordId ? [event.recordId] : [],
    idempotencyKey: id,
    command: failure.error.message,
    before: event,
    after: failure,
    operationId: `${id}:operation`,
    causeId: event.causeId,
  });
}
