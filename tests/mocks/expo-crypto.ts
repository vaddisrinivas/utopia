import { createHash } from 'node:crypto';

export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;

export async function digestStringAsync(_algorithm: string, value: string): Promise<string> {
  return createHash('sha256').update(value).digest('hex');
}
