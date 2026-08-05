import { describe, expect, it } from 'vitest';

import { allowsCapability, readConsent, writeConsent } from '@/src/kernel/policy';
import { loadRegistry } from '@/src/kernel/registry';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
  };
}

describe('permission and trust boundaries', () => {
  it('authorizes native widgets only through declared capability aliases', () => {
    expect(allowsCapability(['camera.scan'], 'cameraScanner')).toBe(true);
    expect(allowsCapability(['records.write'], 'cameraScanner')).toBe(false);
    expect(allowsCapability(['notifications.schedule'], 'notificationScheduler')).toBe(true);
  });

  it('persists explicit consent per app and capability', async () => {
    const storage = memoryStorage();
    await writeConsent(storage, { appId: 'food', capability: 'camera', state: 'granted', updatedAt: '2026-08-04T00:00:00.000Z' });
    await expect(readConsent(storage, 'food', 'camera')).resolves.toMatchObject({ state: 'granted' });
    await expect(readConsent(storage, 'other', 'camera')).resolves.toBeUndefined();
  });

  it('rejects malformed persisted consent', async () => {
    const storage = memoryStorage();
    await storage.setItem('utopia:consent:food:camera', '{"state":"granted"}');
    await expect(readConsent(storage, 'food', 'camera')).rejects.toThrow();
  });

  it('requires HTTPS registries before network access', async () => {
    await expect(loadRegistry('http://example.com/registry.json')).rejects.toThrow('HTTPS required');
  });
});
