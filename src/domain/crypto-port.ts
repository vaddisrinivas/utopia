export type AesGcmCiphertext = Readonly<{
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}>;

/** Synchronous crypto surface used by portable Core code. */
export interface CoreCryptoPort {
  randomBytes(size: number): Uint8Array;
  sha256(value: Uint8Array): Uint8Array;
  pbkdf2Sha256(passphrase: string, salt: Uint8Array, iterations: number, keyBytes: number): Uint8Array;
  encryptAesGcm(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): AesGcmCiphertext;
  decryptAesGcm(input: {
    ciphertext: Uint8Array;
    authTag: Uint8Array;
    iv: Uint8Array;
    key: Uint8Array;
  }): Uint8Array;
}
