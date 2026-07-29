import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '@/src/db/migrations';
import {
  dispatchPersistedStepFlow,
  loadPersistedStepFlow,
  startPersistedStepFlow,
} from '@/src/workflows/timed-flow-runtime';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

describe('persisted timed flow runtime', () => {
  const dbs: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it('restores and reconciles a running timer from SQLite after process death', async () => {
    const db = new NodeSqliteDb();
    dbs.push(db);
    await runMigrations(db as never);

    await startPersistedStepFlow({
      db: db as never,
      runId: 'install-a:workout',
      appInstallationId: 'install-a',
      domain: 'workout-logger',
      workflowId: 'guided-workout',
      steps: [
        { id: 'work', title: 'Work', durationMs: 90_000 },
        { id: 'log', title: 'Log set' },
      ],
      clock: { utcMs: 0, monotonicMs: 0, monotonicEpoch: 'process-a' },
    });

    const restored = await loadPersistedStepFlow(db as never, 'install-a:workout', 'install-a');
    expect(restored).toMatchObject({ status: 'running', currentStep: 0 });

    const reconciled = await dispatchPersistedStepFlow({
      db: db as never,
      runId: 'install-a:workout',
      appInstallationId: 'install-a',
      event: { id: 'restore', kind: 'observe' },
      clock: { utcMs: 45_000, monotonicMs: 10, monotonicEpoch: 'process-b' },
    });
    expect(reconciled.timer).toMatchObject({
      status: 'running',
      accumulatedMs: 45_000,
      confidence: 'wall_clock',
    });

    await expect(loadPersistedStepFlow(
      db as never,
      'install-a:workout',
      'install-a',
    )).resolves.toEqual(reconciled);
  });
});
