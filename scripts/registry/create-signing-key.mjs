#!/usr/bin/env node
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(args.outputDir || process.env.UTOPIA_REGISTRY_SIGNING_KEY_DIR || path.join(process.env.HOME || '.', '.config/utopia/registry-signing'));
const keyId = args.keyId || 'utopia-staging-publisher-2026-07';
const privatePath = path.join(outputDir, `${keyId}.private.pem`);
const publicPath = path.join(outputDir, `${keyId}.public.spki.b64`);

await mkdir(outputDir, { recursive: true, mode: 0o700 });
const keys = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const privateKey = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');

await writeFile(privatePath, pem('PRIVATE KEY', privateKey), { mode: 0o600, flag: 'wx' });
await chmod(privatePath, 0o600);
await writeFile(publicPath, `${publicKey}\n`, { mode: 0o644, flag: 'wx' });

console.log(`Created local signing key: ${privatePath}`);
console.log(`Created public key file: ${publicPath}`);
console.log(`Key id: ${keyId}`);

function pem(label, bytes) {
  const body = bytes.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
