#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const signedPackagePath = path.resolve(process.cwd(), args.signedPackagePath || 'dist/github-app-factory/app/package.signed.json');
const endpoint = (args.endpoint || process.env.UTOPIA_REGISTRY_URL || 'https://utoia.thetechcruise.com').replace(/\/+$/, '');
const token = process.env.UTOPIA_REGISTRY_PUBLISHER_TOKEN?.trim();
const enabled = args.enabled === 'true' || process.env.UTOPIA_REGISTRY_PUBLISH === 'true';
const visibility = args.visibility || 'unlisted';
const source = args.source || 'github_factory';

if (!enabled) {
  console.log('Utopia registry publish skipped: keep publish_to_registry=false unless you explicitly opt in.');
  process.exit(0);
}

if (source !== 'github_factory') {
  throw new Error(`Unsupported registry source "${source}". Hosted publish is scoped to github_factory only.`);
}
if (visibility !== 'public' && visibility !== 'unlisted') {
  throw new Error(`Unsupported visibility "${visibility}". Expected "public" or "unlisted".`);
}
if (!token) {
  throw new Error('UTOPIA_REGISTRY_PUBLISHER_TOKEN is required when registry publishing is enabled.');
}
if (token.length < 96) {
  throw new Error('UTOPIA_REGISTRY_PUBLISHER_TOKEN must be at least 96 characters.');
}

const signed = JSON.parse(readFileSync(signedPackagePath, 'utf8'));
if (!signed || typeof signed !== 'object' || Array.isArray(signed) || !signed.package || !signed.signature) {
  throw new Error('Signed package envelope must contain package and signature. Run scripts/registry/sign-package.mjs first.');
}
const response = await fetch(`${endpoint}/v1/packages`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    package: signed.package,
    signature: signed.signature,
    source,
    visibility,
    publish: true,
  }),
});

const text = await response.text();
let payload;
try {
  payload = text ? JSON.parse(text) : {};
} catch {
  payload = { raw: text };
}

if (!response.ok) {
  throw new Error(`registry_publish_failed:${response.status}:${JSON.stringify(payload)}`);
}

console.log('Utopia registry publish requested (opt-in path).');
console.log(`Utopia registry publish ok: ${payload.web_url || payload.install_url || payload.package_url}`);

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
