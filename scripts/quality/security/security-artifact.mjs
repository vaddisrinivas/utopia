import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const SENSITIVE_KEY = /(secret|token|password|credential|private.?key|api.?key|authorization|cookie|match|fragment)/i;
const SENSITIVE_VALUE = /(bearer\s+|-----BEGIN .*PRIVATE KEY-----|(?:sk|gh[pousr]|github_pat|xox[baprs])[-_][a-z0-9_-]{12,})/i;

export function redactSecurityValue(value, root, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) return '[REDACTED]';
    return value.replaceAll(resolve(root), '<repo>').replaceAll(process.env.HOME || '', '<home>');
  }
  if (Array.isArray(value)) return value.map((item) => redactSecurityValue(item, root));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactSecurityValue(childValue, root, childKey),
    ]));
  }
  return value;
}

export function writeSecurityArtifact(root, artifactPath, artifact) {
  const absolutePath = resolve(root, artifactPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(redactSecurityValue(artifact, root))}\n`);
  return relative(root, absolutePath);
}
