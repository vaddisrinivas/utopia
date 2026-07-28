import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const tempDir = mkdtempSync(join(tmpdir(), 'utopia-json-state-concurrency-'));
const statePath = join(tempDir, 'concurrency.json');
const tsxBinary = join(root, 'server', 'node_modules', '.bin', 'tsx');
const workerPath = join(root, 'server', 'test', 'fixtures', 'json-state-concurrency-worker.ts');

function runWorker() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(tsxBinary, [workerPath], {
      cwd: root,
      env: {
        ...process.env,
        JSON_STATE_CONCURRENCY_PATH: statePath,
        JSON_STATE_CONCURRENCY_LOOPS: '25',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `worker exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

try {
  await Promise.all([runWorker(), runWorker()]);
  const payload = JSON.parse(readFileSync(statePath, 'utf-8')) as { count?: number };
  assert.equal(payload.count, 50, 'concurrent writers should preserve every increment');
  assert.equal(
    readdirSync(tempDir).some((name) => name.endsWith('.lock')),
    false,
    'concurrency helper should not leave lock directories behind',
  );

  console.log('PASS server/test/json-state-concurrency.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
