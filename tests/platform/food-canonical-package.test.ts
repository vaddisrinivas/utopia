import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileAppPackageSourceFolder,
  readAppPackageSourceFolder,
} from '@/packages/app-compiler';
import { canonicalJson } from '@/packages/shared/contracts/canonical-json';
import type { AppPackagePermissionDeclaration } from '@/packages/shared/contracts/package';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const foodRoot = path.join(root, 'apps/food');
const sourceRoot = path.join(foodRoot, 'package-source');
const legacy = JSON.parse(readFileSync(path.join(foodRoot, 'food.v1.json'), 'utf8')) as Record<string, any>;
const canonical = JSON.parse(readFileSync(path.join(foodRoot, 'app-package.v3.json'), 'utf8')) as Record<string, any>;
const FOOD_WIDGET_KINDS: string[] = [];

describe('Food canonical package authority', () => {
  it('compiles canonical V3 output from source without replacing the legacy manifest', () => {
    const source = readAppPackageSourceFolder(sourceRoot);
    const compiled = compileAppPackageSourceFolder(sourceRoot);

    expect(legacy.schema_version).toBe('utopia.domain.v1');
    expect(legacy.id).toBe('food');
    expect(source.app.id).toBe(legacy.id);
    expect(source.app.homeSurface).toBe(legacy.ui.defaultScreen);
    expect(compiled.valid).toBe(true);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    expect(compiled.package.schemaVersion).toBe('wonder.app-package.v3');
    expect(compiled.package.id).toBe('food');
    expect(canonicalJson(compiled.package)).toBe(canonicalJson(canonical));
  });

  it('preserves Food collections, screens, workflows, and optional Health Connect declarations', () => {
    const compiled = compileAppPackageSourceFolder(sourceRoot);
    if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));

    const source = readAppPackageSourceFolder(sourceRoot);
    const compatibility = compiled.package.presentation?.render?.legacyCompatibility as Record<string, any>;
    const native = compiled.package.schemaVersion === 'wonder.app-package.v3'
      ? compiled.package.nativeCapabilities
      : undefined;

    expect(Object.keys(compiled.package.collections).sort()).toEqual([...legacy.collections].sort());
    expect(Object.keys(compiled.package.presentation?.ui?.screens ?? {}).sort()).toEqual(Object.keys(legacy.ui.screens).sort());
    expect(Object.keys(source.workflows ?? {}).sort()).toEqual([...legacy.workflows].sort());
    expect(compatibility.preservedWorkflowIds).toEqual(legacy.workflows);
    expect(compatibility.preservedRelations).toHaveLength(legacy.relations.length);
    expect(compatibility.preservedRelations.map(({ from, sourceKey, to }: any) => ({
      from,
      name: sourceKey,
      to,
    }))).toEqual(legacy.relations);
    expect(compatibility.preservedRelations.every((relation: any) =>
      typeof relation.name === 'string' && !relation.name.includes('_'),
    )).toBe(true);
    expect(native?.platform).toBe('expo');
    expect(native?.packages).toContain('react-native-health-connect');

    const healthPermissions = (native?.permissions ?? [])
      .filter((permission): permission is AppPackagePermissionDeclaration => typeof permission !== 'string')
      .filter((permission) => String(permission.id).startsWith('health-connect-'));
    expect(healthPermissions).toHaveLength(6);
    expect(healthPermissions.every((permission) => permission.platform === 'android')).toBe(true);
    expect(healthPermissions.every((permission) => permission.required === false)).toBe(true);
    expect(healthPermissions.map((permission) => permission.permission).sort()).toEqual([
      'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
      'android.permission.health.READ_HYDRATION',
      'android.permission.health.READ_NUTRITION',
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_WEIGHT',
      'android.permission.health.WRITE_HYDRATION',
    ]);
  });

  it('keeps Food widget debt explicit and blocked rather than hiding it', () => {
    const debt = canonical.presentation?.render?.legacyCompatibility?.foodSpecificWidgetDebt as Record<string, any>;

    expect(debt.status).toBe('PASS');
    expect(debt.widgetKinds).toEqual(FOOD_WIDGET_KINDS);
    expect(debt.widgetKindCount).toBe(0);
    expect(debt.referenceCount).toBe(0);
    expect(debt.references).toEqual([]);
    expect(debt.rendererCatalogDebt).toEqual({
      registeredDomainWidgets: 1,
      includedOutsideFood: 'askFoodBar',
    });
  });
});
