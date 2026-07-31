import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

import type { CoreCryptoPort } from '@/src/domain/crypto-port';

export const defaultCoreCryptoPort: CoreCryptoPort = {
  randomBytes(size) {
    return Uint8Array.from(randomBytes(size));
  },
  sha256(value) {
    return Uint8Array.from(createHash('sha256').update(value).digest());
  },
  pbkdf2Sha256(passphrase, salt, iterations, keyBytes) {
    return Uint8Array.from(pbkdf2Sync(passphrase, salt, iterations, keyBytes, 'sha256'));
  },
  encryptAesGcm(plaintext, key, iv) {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    return {
      ciphertext: Uint8Array.from(Buffer.concat([cipher.update(plaintext), cipher.final()])),
      authTag: Uint8Array.from(cipher.getAuthTag()),
    };
  },
  decryptAesGcm({ ciphertext, authTag, iv, key }) {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  },
};
