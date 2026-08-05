import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import { AppStateSchema, emptyState, type AppState } from './runtime';

const Envelope = z.object({ schemaVersion: z.literal('utopia.state.v2'), state: AppStateSchema, checksum: z.string() });
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

export async function loadState(storage: Storage, key: string): Promise<AppState> {
  const raw = await storage.getItem(key);
  if (raw) {
    try {
      const envelope = Envelope.parse(JSON.parse(raw));
      const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(envelope.state));
      if (checksum !== envelope.checksum) throw new Error('state_checksum_mismatch');
      return envelope.state;
    } catch (cause) {
      if (cause instanceof SyntaxError) {
        const staged = await storage.getItem(`${key}:staged`);
        if (!staged) throw cause;
        const stagedEnvelope = Envelope.parse(JSON.parse(staged));
        const stagedChecksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(stagedEnvelope.state));
        if (stagedChecksum !== stagedEnvelope.checksum) throw new Error('state_checksum_mismatch');
        return stagedEnvelope.state;
      }
      throw cause;
    }
  }

  const staged = await storage.getItem(`${key}:staged`);
  if (!staged) return emptyState;
  const envelope = Envelope.parse(JSON.parse(staged));
  const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(envelope.state));
  if (checksum !== envelope.checksum) throw new Error('state_checksum_mismatch');
  return envelope.state;
}

export async function saveState(storage: Storage, key: string, state: AppState): Promise<void> {
  const parsed = AppStateSchema.parse(state);
  const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(parsed));
  const value = JSON.stringify(Envelope.parse({ schemaVersion: 'utopia.state.v2', state: parsed, checksum }));
  await storage.setItem(`${key}:staged`, value);
  await storage.setItem(key, value);
}
