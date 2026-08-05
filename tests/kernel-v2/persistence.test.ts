import { describe, expect, it } from 'vitest';
import * as Crypto from 'expo-crypto';

import { loadState, saveState } from '@/src/kernel/persistence';
import { applyAction, emptyState } from '@/src/kernel/runtime';
import { hmac256 } from '@/src/kernel/security';

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: async () => value,
    setItem: async (_key: string, next: string) => { value = next; },
  };
}

describe('persistence, restart, and recovery', () => {
  it('matches the SHA-256 HMAC standard', async () => {
    await expect(hmac256('Hi There', '0b'.repeat(20))).resolves.toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

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

  it('migrates v2 envelopes to v3 and preserves integrity', async () => {
    const storage = memoryStorage();
    const state = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one', values: { title: 'Migrated' } });
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(state));
    await storage.setItem('app', JSON.stringify({ schemaVersion: 'utopia.state.v2', state, checksum }));
    await expect(loadState(storage, 'app')).resolves.toStrictEqual(state);
    await saveState(storage, 'app', state);
    const reloaded = JSON.parse((await storage.getItem('app')) as string);
    expect(reloaded.schemaVersion).toBe('utopia.state.v3');
    expect(reloaded.mac).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a v3 envelope with invalid HMAC', async () => {
    const storage = memoryStorage();
    const state = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one', values: { title: 'Signed' } });
    await saveState(storage, 'app', state);
    const original = JSON.parse((await storage.getItem('app')) as string);
    await storage.setItem('app', JSON.stringify({ ...original, mac: '0'.repeat(64) }));
    await expect(loadState(storage, 'app')).rejects.toThrow();
  });

  it('undoes the latest mutation with bounded history', () => {
    const created = applyAction(emptyState, { kind: 'create', collection: 'item', recordId: 'one' });
    expect(applyAction(created, { kind: 'undo' })).toStrictEqual({ records: [], undo: [] });
  });
});
