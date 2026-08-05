import * as ExpoCrypto from 'expo-crypto';

const SECRET_PREFIX = 'utopia:security:secret:';
const HMAC_KEY_ALIAS = 'utopia.persistence.hmac.v1';
const STORAGE_BYTE_LENGTH = 32;

type SecretStrategy = 'expo-secure-store' | 'localStorage' | 'memory';
type SecretStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; deleteItem(key: string): Promise<void> };

const enc = new TextEncoder();
const HMAC_BLOCK = 64;
const memoryStore = new Map<string, string>();

type IntegritySecret = { keyId: string; value: string; strategy: SecretStrategy };

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function equalHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function asBytes(value: string) {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16));
}

function xor(bytes: Uint8Array, key: number) {
  return bytes.map((byte) => byte ^ key);
}

function concat(values: Uint8Array[]) {
  const joined = new Uint8Array(values.reduce((size, it) => size + it.length, 0));
  let offset = 0;
  for (const item of values) {
    joined.set(item, offset);
    offset += item.length;
  }
  return joined;
}

function resolveStorage() {
  const attempts = [
    () => {
      const secureStore = require('expo-secure-store') as {
        getItemAsync(key: string): Promise<string | null>;
        setItemAsync(key: string, value: string, options?: unknown): Promise<void>;
        deleteItemAsync(key: string): Promise<void>;
        AfterFirstUnlock?: unknown;
      };
      return {
        strategy: 'expo-secure-store' as const,
        storage: {
          getItem: (key: string) => secureStore.getItemAsync(key),
          setItem: (key: string, value: string) => secureStore.setItemAsync(key, value, {
            keychainAccessible: secureStore.AfterFirstUnlock,
            requireAuthentication: false,
          } as never),
          deleteItem: (key: string) => secureStore.deleteItemAsync(key),
        },
      };
    },
    () => {
      if (typeof localStorage === 'undefined') return null;
      return {
        strategy: 'localStorage' as const,
        storage: {
          getItem: (key: string) => localStorage.getItem(key),
          setItem: (key: string, value: string) => { localStorage.setItem(key, value); },
          deleteItem: (key: string) => { localStorage.removeItem(key); },
        },
      };
    },
  ];

  for (const create of attempts) {
    try {
      const result = create();
      if (result) return result;
    } catch { }
  }

  return {
    strategy: 'memory' as const,
    storage: {
      getItem: async (key: string) => memoryStore.get(key) ?? null,
      setItem: async (key: string, value: string) => { memoryStore.set(key, value); },
      deleteItem: async (key: string) => { memoryStore.delete(key); },
    },
  };
}

const active = resolveStorage();

function keyOf(name: string) {
  return `${SECRET_PREFIX}${name}`;
}

async function randomHexSecret() {
  return hex(await ExpoCrypto.getRandomBytesAsync(STORAGE_BYTE_LENGTH));
}

export async function readSecret(name: string): Promise<string | undefined> {
  const value = await active.storage.getItem(keyOf(name));
  return value ?? undefined;
}

export async function writeSecret(name: string, value: string): Promise<void> {
  await active.storage.setItem(keyOf(name), value);
}

export async function deleteSecret(name: string): Promise<void> {
  await active.storage.deleteItem(keyOf(name));
}

export async function ensureIntegritySecret(name: string = HMAC_KEY_ALIAS): Promise<IntegritySecret> {
  const existing = await readSecret(name);
  if (existing) return { keyId: name, value: existing, strategy: active.strategy };
  const value = await randomHexSecret();
  await writeSecret(name, value);
  return { keyId: name, value, strategy: active.strategy };
}

async function sha256(value: ArrayBuffer | Uint8Array | string) {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : enc.encode(value);
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Uint8Array(await ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, payload));
}

export async function hmac256(message: string, key: string): Promise<string> {
  const keyBytes = asBytes(key);
  const normalized = keyBytes.length > HMAC_BLOCK ? await sha256(keyBytes) : keyBytes;
  const block = new Uint8Array(HMAC_BLOCK);
  block.set(normalized);
  const digest = await sha256(concat([xor(block, 0x36), enc.encode(message)]));
  const mac = await sha256(concat([xor(block, 0x5c), digest]));
  return hex(mac);
}

export async function verifyHmac(message: string, key: string, mac: string): Promise<boolean> {
  const expected = await hmac256(message, key);
  return expected.length === mac.length && equalHex(expected, mac);
}

export function secretStrategyInfo() {
  return { strategy: active.strategy, fallback: active.strategy !== 'expo-secure-store' };
}

export function hasSecureStore() {
  return active.strategy === 'expo-secure-store';
}
