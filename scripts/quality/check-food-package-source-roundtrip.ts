import { join } from 'node:path';

import { validateFoodPackageSourceRoundTrip } from '@/packages/app-compiler';

const root = process.cwd();
const sourceDir = join(root, 'apps/food/source');
const runtimePath = join(root, 'apps/food/food.v1.json');

const result = validateFoodPackageSourceRoundTrip(sourceDir, runtimePath);

if (!result.matches) {
  throw new Error('food source round-trip did not match apps/food/food.v1.json');
}

if (result.index.source !== 'apps/food/food.v1.json') {
  throw new Error(`unexpected food source index source: ${result.index.source}`);
}

console.log(`PASS food source round-trip (${result.index.chunks.length} chunks, ${result.checksum})`);
