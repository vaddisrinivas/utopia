#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';

const args = parseArgs(process.argv.slice(2));
const packagePath = path.resolve(args.packagePath || args.package || 'dist/github-app-factory/app/package.json');
const privateKeyPath = path.resolve(args.privateKeyPath || process.env.UTOPIA_REGISTRY_SIGNING_PRIVATE_KEY_PATH || '');
const keyId = args.keyId || process.env.UTOPIA_REGISTRY_SIGNING_KEY_ID;
const outputPath = path.resolve(args.output || `${packagePath.replace(/\.json$/, '')}.signed.json`);

if (!privateKeyPath || !keyId) throw new Error('private key path and key id are required');
const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
const privateKey = await webcrypto.subtle.importKey(
  'pkcs8',
  pemBytes(await readFile(privateKeyPath, 'utf8')),
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign'],
);
const signature = await webcrypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  privateKey,
  new TextEncoder().encode(canonicalize(pkg) ?? 'null'),
);
const envelope = {
  package: pkg,
  signature: {
    algorithm: 'ecdsa-p256-sha256',
    keyId,
    value: Buffer.from(signature).toString('base64'),
    signedAt: new Date().toISOString(),
  },
};

await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
console.log(`Signed package envelope: ${outputPath}`);

function pemBytes(value) {
  const base64 = value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  if (!base64) throw new Error('private key PEM is invalid');
  return Buffer.from(base64, 'base64');
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
