import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;
export const digestStringAsync = async (_algorithm: string, value: string) =>
  createHash('sha256').update(value).digest('hex');
export const digest = async (_algorithm: string, value: BufferSource) => {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(createHash('sha256').update(bytes).digest()).buffer;
};
export const getRandomBytesAsync = async (size: number) => new Uint8Array(randomBytes(size));
export { randomUUID };
