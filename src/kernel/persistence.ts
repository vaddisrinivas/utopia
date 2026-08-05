import { z } from 'zod';
import { AppStateSchema, emptyState, type AppState } from './runtime';

const Envelope = z.object({ schemaVersion: z.literal('utopia.state.v1'), state: AppStateSchema });
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export async function loadState(storage: Storage, key: string): Promise<AppState> {
  const raw = await storage.getItem(key);
  return raw ? Envelope.parse(JSON.parse(raw)).state : emptyState;
}

export async function saveState(storage: Storage, key: string, state: AppState): Promise<void> {
  await storage.setItem(key, JSON.stringify(Envelope.parse({ schemaVersion: 'utopia.state.v1', state })));
}
