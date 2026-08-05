import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import { AppStateSchema, emptyState, type AppState } from './runtime';
import { ensureIntegritySecret, hmac256, secretStrategyInfo, verifyHmac } from './security';

const HMAC_KEY_ALIAS = 'utopia.persistence.hmac.v1';
const SchemaVersion = { v2: 'utopia.state.v2', v3: 'utopia.state.v3' } as const;

const EnvelopeV2 = z.object({ schemaVersion: z.literal(SchemaVersion.v2), state: AppStateSchema, checksum: z.string() });
const EnvelopeV3 = z.object({
  schemaVersion: z.literal(SchemaVersion.v3), state: AppStateSchema, checksum: z.string(), keyId: z.string(),
  mac: z.string(), security: z.object({ strategy: z.string(), fallback: z.boolean().optional() }),
});
const Envelope = z.union([EnvelopeV2, EnvelopeV3]);

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type EnvelopeValue = z.infer<typeof Envelope>;
type ParsedEnvelope = { envelope: EnvelopeValue | undefined; invalid: boolean; corrupted: boolean };

function stable(state: AppState) {
  return AppStateSchema.parse(state);
}

async function checksumState(state: AppState) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(stable(state)));
}

function envelopePayload(stateKey: string, checksum: string) {
  return `${stateKey}:${checksum}`;
}

function classify(raw: string): ParsedEnvelope {
  try {
    return { envelope: Envelope.parse(JSON.parse(raw)), invalid: false, corrupted: false };
  } catch {
    try {
      JSON.parse(raw);
      return { envelope: undefined, invalid: true, corrupted: false };
    } catch {
      return { envelope: undefined, invalid: false, corrupted: true };
    }
  }
}

async function readEnvelope(storage: Storage, key: string): Promise<ParsedEnvelope> {
  const raw = await storage.getItem(key);
  if (!raw) return { envelope: undefined, invalid: false, corrupted: false };
  return classify(raw);
}

async function buildV3Envelope(state: AppState, stateKey: string, checksum: string, mac: string): Promise<z.infer<typeof EnvelopeV3>> {
  return EnvelopeV3.parse({
    schemaVersion: SchemaVersion.v3,
    state,
    checksum,
    keyId: HMAC_KEY_ALIAS,
    mac,
    security: secretStrategyInfo(),
  });
}

async function verifyEnvelope(envelope: EnvelopeValue, stateKey: string): Promise<AppState> {
  const expected = await checksumState(envelope.state);
  if (expected !== envelope.checksum) throw new Error('state_checksum_mismatch');
  if (envelope.schemaVersion === SchemaVersion.v2) return envelope.state;

  const secret = await ensureIntegritySecret(envelope.keyId);
  if (!await verifyHmac(envelopePayload(stateKey, envelope.checksum), secret.value, envelope.mac)) {
    throw new Error('state_mac_mismatch');
  }
  return envelope.state;
}

async function writeEnvelope(storage: Storage, stateKey: string, state: AppState): Promise<void> {
  const parsed = stable(state);
  const digest = await checksumState(parsed);
  const secret = await ensureIntegritySecret(HMAC_KEY_ALIAS);
  const mac = await hmac256(envelopePayload(stateKey, digest), secret.value);
  const stableEnvelope = await buildV3Envelope(parsed, stateKey, digest, mac);
  const serialized = JSON.stringify(stableEnvelope);
  await storage.setItem(`${stateKey}:staged`, serialized);
  await storage.setItem(stateKey, serialized);
}

async function recover(storage: Storage, stateKey: string, parsed: ParsedEnvelope, staged: ParsedEnvelope): Promise<AppState> {
  if (parsed.envelope) {
    const recovered = await verifyEnvelope(parsed.envelope, stateKey);
    await writeEnvelope(storage, stateKey, recovered);
    return recovered;
  }

  if (parsed.invalid) throw new Error('state_unrecognized');
  if (parsed.corrupted) {
    if (!staged.envelope) throw new Error('state_corrupt');
    const recovered = await verifyEnvelope(staged.envelope, stateKey);
    await writeEnvelope(storage, stateKey, recovered);
    return recovered;
  }

  if (!staged.envelope) return emptyState;
  if (staged.invalid) throw new Error('state_unrecognized');
  if (staged.corrupted) throw new Error('state_corrupt');
  const recovered = await verifyEnvelope(staged.envelope, stateKey);
  await writeEnvelope(storage, stateKey, recovered);
  return recovered;
}

export async function loadState(storage: Storage, stateKey: string): Promise<AppState> {
  const stagedKey = `${stateKey}:staged`;
  const primary = await readEnvelope(storage, stateKey);
  const staged = await readEnvelope(storage, stagedKey);

  if (primary.envelope) {
    try {
      return await recover(storage, stateKey, primary, staged);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'ZodError') throw cause;
      if (!staged.envelope) throw cause;
      return recover(storage, stateKey, staged, primary);
    }
  }

  if (primary.invalid) throw new Error('state_unrecognized');
  if (primary.corrupted) {
    if (!staged.envelope) throw new Error('state_corrupt');
    return recover(storage, stateKey, staged, primary);
  }
  try {
    return await recover(storage, stateKey, primary, staged);
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'ZodError') throw cause;
    throw cause;
  }
}

export async function saveState(storage: Storage, stateKey: string, state: AppState): Promise<void> {
  await writeEnvelope(storage, stateKey, state);
}
