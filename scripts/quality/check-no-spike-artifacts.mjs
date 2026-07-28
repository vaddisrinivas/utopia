import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const spikesDir = path.join(root, 'spikes');
const allowedEntries = new Set(['.gitkeep']);
const violations = [];

if (fs.existsSync(spikesDir)) {
  for (const entry of fs.readdirSync(spikesDir, { withFileTypes: true })) {
    if (allowedEntries.has(entry.name)) continue;
    violations.push(`spikes/${entry.name}: delete completed experiments; production must use converged root/server packages`);
  }
}

if (violations.length > 0) {
  console.error('Spike artifact guard failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Spike artifact guard passed');
