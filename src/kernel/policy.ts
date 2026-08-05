import { z } from 'zod';
import storage from './storage';

const Decision = z.object({
  appId: z.string().min(1),
  capability: z.string().min(1),
  state: z.enum(['granted', 'denied']),
  updatedAt: z.string().datetime(),
});

export type ConsentDecision = z.infer<typeof Decision>;
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

const key = (appId: string, capability: string) => `utopia:consent:${appId}:${capability}`;

export async function readConsent(storage: Storage, appId: string, capability: string): Promise<ConsentDecision | undefined> {
  const value = await storage.getItem(key(appId, capability));
  return value ? Decision.parse(JSON.parse(value)) : undefined;
}

export async function writeConsent(storage: Storage, decision: ConsentDecision): Promise<ConsentDecision> {
  const valid = Decision.parse(decision);
  await storage.setItem(key(valid.appId, valid.capability), JSON.stringify(valid));
  return valid;
}

export async function recordConsent(appId: string, capability: string, state: ConsentDecision['state']) {
  return writeConsent(storage, { appId, capability, state, updatedAt: new Date().toISOString() });
}
