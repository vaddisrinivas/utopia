import { createHash } from 'node:crypto';

export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;
export const digestStringAsync = async (_algorithm: string, value: string) =>
  createHash('sha256').update(value).digest('hex');
