import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readFoodPackageSourceIndex,
  reassembleFoodPackageSource,
} from '@/packages/app-compiler';
import { canonicalJson } from '@/packages/shared/contracts/canonical-json';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDir = path.join(rootDir, 'apps/food/source');
const runtimePath = path.join(rootDir, 'apps/food/food.v1.json');

describe('food package source round-trip', () => {
  it('reassembles apps/food/source back to apps/food/food.v1.json', () => {
    const index = readFoodPackageSourceIndex(sourceDir);
    const reassembled = reassembleFoodPackageSource(sourceDir);
    const runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as unknown;

    expect(index.source).toBe('apps/food/food.v1.json');
    expect(index.strategy).toBe('top-level-key split');
    expect(index.chunks.length).toBeGreaterThan(0);
    expect(canonicalJson(reassembled)).toBe(canonicalJson(runtime));
  });
});
