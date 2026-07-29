import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { createMinimalUtopiaAppSource } from '../../scripts/package/create-utopia-app';

describe('create utopia app', () => {
  it('writes a minimal source folder that passes compiler validation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'utopia-create-app-'));
    try {
      const outDir = path.join(root, 'source');
      createMinimalUtopiaAppSource({
        id: 'morning-checklist',
        name: 'Morning Checklist',
        outDir,
        version: '1.0.0',
        force: false,
      });

      expect(JSON.parse(readFileSync(path.join(outDir, 'app.json'), 'utf8'))).toMatchObject({
        schemaVersion: 'wonder.package-source.v1',
        id: 'morning-checklist',
        label: 'Morning Checklist',
        homeSurface: 'home',
      });
      expect(JSON.parse(readFileSync(path.join(outDir, 'collections', 'items.json'), 'utf8'))).toMatchObject({
        fields: {
          id: { type: 'text', required: true, indexed: true },
        },
      });
      expect(JSON.parse(readFileSync(path.join(outDir, 'screens', 'home.json'), 'utf8'))).toMatchObject({
        query: 'home',
        mode: 'list',
      });

      const compiled = compileAppPackageSourceFolder(outDir);
      expect(compiled.valid).toBe(true);
      if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
      expect(compiled.package.id).toBe('morning-checklist');
      expect(compiled.preview.collectionIds).toEqual(['items']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
