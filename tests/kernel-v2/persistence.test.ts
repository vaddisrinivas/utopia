import { describe, expect, it } from 'vitest';

import { loadState, saveState } from '@/src/kernel/persistence';
import { applyAction, emptyState } from '@/src/kernel/runtime';

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: async () => value,
    setItem: async (_key: string, next: string) => { value = next; },
  };
}

describe('persistence, restart, and recovery', () => {
  it('restores the latest state after restart', async () => {
    const storage = memoryStorage();
    const state = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one', values: { title: 'Saved' } });
    await saveState(storage, 'app', state);
    await expect(loadState(storage, 'app')).resolves.toStrictEqual(state);
  });

  it('fails closed on obsolete or corrupt state', async () => {
    const storage = memoryStorage();
    await storage.setItem('app', JSON.stringify({ schemaVersion: 'utopia.state.v0', state: emptyState }));
    await expect(loadState(storage, 'app')).rejects.toThrow();
  });

  it('undoes the latest mutation with bounded history', () => {
    const created = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one' });
    expect(applyAction(created, { kind: 'undo' })).toStrictEqual({ records: [], undo: [] });
  });
});
