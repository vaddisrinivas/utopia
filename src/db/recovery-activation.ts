import { DATABASE_VERSION, runMigrations, type RecoveryExport } from '@/src/db/migrations';
import {
  importRecoverySnapshot,
  type RecoveryDatabase,
  validateRecoverySnapshot,
} from '@/src/db/recovery';

export const RECOVERY_ACTIVATION_VERSION = 'utopia.recovery-activation.v1' as const;

export type RecoveryActivationPhase =
  | 'validate'
  | 'stage'
  | 'migrate'
  | 'import'
  | 'integrity'
  | 'close'
  | 'swap'
  | 'reopen'
  | 'verify'
  | 'rollback'
  | 'complete';

export type RecoveryActivationDatabase = RecoveryDatabase & {
  closeAsync?: () => Promise<void>;
  closeSync?: () => void;
};

export type RecoveryActivationPort<Db extends RecoveryActivationDatabase = RecoveryActivationDatabase> = {
  readActive(): Promise<{ pointer: string; db: Db }>;
  stageSnapshot(input: {
    activationId: string;
    snapshot: RecoveryExport;
  }): Promise<{ pointer: string; db: Db }>;
  closeDatabase(db: Db): Promise<void>;
  /** Must be atomic and fail closed if expectedPointer is no longer active. */
  swapActivePointer(input: {
    activationId: string;
    expectedPointer: string;
    nextPointer: string;
  }): Promise<void>;
  reopen(pointer: string): Promise<Db>;
  /** Must be idempotent when the pointer already equals restorePointer. */
  restoreActivePointer(input: {
    activationId: string;
    expectedPointer: string;
    restorePointer: string;
  }): Promise<void>;
  discardStaged?: (pointer: string) => Promise<void>;
};

export type RecoveryActivationOptions<Db extends RecoveryActivationDatabase = RecoveryActivationDatabase> = {
  activationId?: string;
  migrate?: (db: Db, snapshot: RecoveryExport) => Promise<void>;
  validateDatabase?: (db: Db, snapshot: RecoveryExport) => Promise<void>;
  verifyReopened?: (db: Db, snapshot: RecoveryExport) => Promise<void>;
  onPhase?: (phase: RecoveryActivationPhase) => void | Promise<void>;
};

export type RecoveryActivationResult = {
  version: typeof RECOVERY_ACTIVATION_VERSION;
  activationId: string;
  fromPointer: string;
  toPointer: string;
  phases: RecoveryActivationPhase[];
};

export class RecoveryActivationError extends Error {
  readonly phase: RecoveryActivationPhase;
  readonly rollbackAttempted: boolean;
  readonly rollbackSucceeded: boolean;
  readonly originalError: unknown;
  readonly rollbackError: unknown;

  constructor(input: {
    phase: RecoveryActivationPhase;
    originalError: unknown;
    rollbackAttempted: boolean;
    rollbackSucceeded: boolean;
    rollbackError?: unknown;
  }) {
    const originalMessage = input.originalError instanceof Error
      ? input.originalError.message
      : String(input.originalError);
    super(`Recovery activation failed during ${input.phase}: ${originalMessage}`);
    this.name = 'RecoveryActivationError';
    this.phase = input.phase;
    this.rollbackAttempted = input.rollbackAttempted;
    this.rollbackSucceeded = input.rollbackSucceeded;
    this.originalError = input.originalError;
    this.rollbackError = input.rollbackError;
  }
}

function makeActivationId() {
  return `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function defaultMigrate<Db extends RecoveryActivationDatabase>(db: Db) {
  await runMigrations(db as never);
}

export async function validateRecoveryDatabase<Db extends RecoveryActivationDatabase>(
  db: Db,
  snapshot?: RecoveryExport,
): Promise<void> {
  const integrity = await db.getFirstAsync<Record<string, unknown>>('PRAGMA integrity_check');
  const integrityValue = integrity?.integrity_check;
  if (integrityValue !== 'ok') {
    throw new Error(`Recovery database integrity check failed: ${String(integrityValue ?? 'missing')}`);
  }

  const foreignKeyErrors = await db.getAllAsync<Record<string, unknown>>('PRAGMA foreign_key_check');
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Recovery database foreign-key check failed: ${foreignKeyErrors.length} violation(s)`);
  }

  const version = await db.getFirstAsync<{ user_version: number | string }>('PRAGMA user_version');
  const numericVersion = typeof version?.user_version === 'number'
    ? version.user_version
    : Number.parseInt(String(version?.user_version ?? ''), 10);
  if (!Number.isInteger(numericVersion) || numericVersion < 1 || numericVersion > DATABASE_VERSION) {
    throw new Error(`Recovery database has invalid schema version: ${String(version?.user_version ?? 'missing')}`);
  }
  if (snapshot && numericVersion < Math.min(snapshot.schema_version, DATABASE_VERSION)) {
    throw new Error(`Recovery database schema ${numericVersion} is older than snapshot ${snapshot.schema_version}`);
  }
}

async function closeQuietly<Db extends RecoveryActivationDatabase>(port: RecoveryActivationPort<Db>, db: Db) {
  try {
    await port.closeDatabase(db);
  } catch {
    // Cleanup must not replace the activation failure that triggered it.
  }
}

export async function activateRecoverySnapshot<Db extends RecoveryActivationDatabase>(
  port: RecoveryActivationPort<Db>,
  snapshot: RecoveryExport,
  options: RecoveryActivationOptions<Db> = {},
): Promise<RecoveryActivationResult> {
  const activationId = options.activationId ?? makeActivationId();
  const phases: RecoveryActivationPhase[] = [];
  let phase: RecoveryActivationPhase = 'validate';
  let active: { pointer: string; db: Db } | null = null;
  let staged: { pointer: string; db: Db } | null = null;
  let reopened: Db | null = null;
  let swapAttempted = false;
  let pointerSwapped = false;

  const enter = async (next: RecoveryActivationPhase) => {
    phase = next;
    phases.push(next);
    await options.onPhase?.(next);
  };

  try {
    validateRecoverySnapshot(snapshot);
    await enter('validate');

    active = await port.readActive();
    await enter('stage');
    staged = await port.stageSnapshot({ activationId, snapshot });

    await enter('migrate');
    await (options.migrate ?? ((db, _snapshot) => defaultMigrate(db)))(staged.db, snapshot);

    await enter('import');
    await importRecoverySnapshot(staged.db, snapshot);

    await enter('integrity');
    await (options.validateDatabase ?? validateRecoveryDatabase)(staged.db, snapshot);

    await enter('close');
    await port.closeDatabase(staged.db);
    await port.closeDatabase(active.db);

    swapAttempted = true;
    await enter('swap');
    await port.swapActivePointer({
      activationId,
      expectedPointer: active.pointer,
      nextPointer: staged.pointer,
    });
    pointerSwapped = true;

    await enter('reopen');
    reopened = await port.reopen(staged.pointer);
    await enter('verify');
    await (options.verifyReopened ?? options.validateDatabase ?? validateRecoveryDatabase)(reopened, snapshot);
    await port.closeDatabase(reopened);
    reopened = null;
    await enter('complete');

    return {
      version: RECOVERY_ACTIVATION_VERSION,
      activationId,
      fromPointer: active.pointer,
      toPointer: staged.pointer,
      phases,
    };
  } catch (error) {
    const failedPhase = phase;
    if (reopened) await closeQuietly(port, reopened);
    if (staged && !pointerSwapped) {
      await port.discardStaged?.(staged.pointer);
    }

    const rollbackAttempted = swapAttempted;
    let rollbackSucceeded = false;
    let rollbackError: unknown;
    if (rollbackAttempted && active && staged) {
      try {
        await enter('rollback');
        await port.restoreActivePointer({
          activationId,
          expectedPointer: staged.pointer,
          restorePointer: active.pointer,
        });
        const restored = await port.reopen(active.pointer);
        await (options.verifyReopened ?? options.validateDatabase ?? validateRecoveryDatabase)(restored, snapshot);
        await port.closeDatabase(restored);
        rollbackSucceeded = true;
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
    }

    throw new RecoveryActivationError({
      phase: failedPhase,
      originalError: error,
      rollbackAttempted,
      rollbackSucceeded,
      rollbackError,
    });
  }
}
