import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

export function inspectRendererServerSizeRatchet(rootDir = root) {
  const baselinePath = resolve(rootDir, 'scripts/quality/renderer-server-size-baseline.json');
  if (!existsSync(baselinePath)) return { status: 'BLOCKED', errors: ['size baseline is missing'] };
  let baseline;
  try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); }
  catch (error) { return { status: 'BLOCKED', errors: [`invalid size baseline JSON: ${error.message}`] }; }
  if (!baseline.files || typeof baseline.files !== 'object') return { status: 'BLOCKED', errors: ['size baseline files are invalid'] };

  const errors = [];
  const measured = {};
  for (const [relative, limits] of Object.entries(baseline.files)) {
    const filePath = resolve(rootDir, relative);
    if (!existsSync(filePath)) { errors.push(`measured file is missing: ${relative}`); continue; }
    if (!Number.isInteger(limits.maxLines) || !Number.isInteger(limits.maxBytes)) {
      errors.push(`invalid limits for ${relative}`); continue;
    }
    const source = readFileSync(filePath, 'utf8');
    const actual = { lines: source.split(/\r?\n/).length, bytes: statSync(filePath).size };
    measured[relative] = actual;
    if (actual.lines > limits.maxLines) errors.push(`${relative}: ${actual.lines} lines exceeds ${limits.maxLines}`);
    if (actual.bytes > limits.maxBytes) errors.push(`${relative}: ${actual.bytes} bytes exceeds ${limits.maxBytes}`);
  }
  return { status: errors.length ? 'FAIL' : 'PASS', errors, measured };
}

const result = inspectRendererServerSizeRatchet();
if (result.status === 'BLOCKED') {
  console.error(`BLOCKED renderer/server size ratchet: ${result.errors.join('; ')}`);
  process.exitCode = 2;
} else if (result.status === 'FAIL') {
  console.error(`FAIL renderer/server size ratchet (${result.errors.length})`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS renderer/server size ratchet: ${JSON.stringify(result.measured)}`);
}
