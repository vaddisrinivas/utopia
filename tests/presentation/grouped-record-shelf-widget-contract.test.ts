import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pantryRestockPackage from '@/apps/pantry-restock/pantry-restock.v1.json';
import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { groupedRecordShelfGroups } from '@/src/presentation/widgets/grouped-record-shelf-config';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'apps/food/package-source');
const widgetSource = readFileSync(path.join(root, 'src/presentation/widgets/grouped-record-shelf-widget.tsx'), 'utf8');
const configSource = readFileSync(path.join(root, 'src/presentation/widgets/grouped-record-shelf-config.ts'), 'utf8');

function widgets(appPackage: Record<string, any>): string[] {
  return Object.values(appPackage.presentation.ui.screens as Record<string, { components: Array<{ kind: string; widget?: string }> }>)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget')
    .map((component) => component.widget ?? '');
}

describe('grouped record shelf primitive', () => {
  it('has generic groups, item metadata, and route targets without Food vocabulary', () => {
    expect(configSource).toContain('props.groups');
    expect(widgetSource).toContain('openWidgetTarget');
    expect(widgetSource).toContain('gridColumns');
    expect(`${widgetSource}\n${configSource}`).not.toMatch(/pantry|kitchen|recipe|food|inventory/i);

    expect(groupedRecordShelfGroups({
      groups: [{ title: 'Area A', items: [{ title: 'Item one', route: '/collection/items' }] }],
    })).toEqual([{
      title: 'Area A',
      subtitle: '',
      action: null,
      items: [{ title: 'Item one', route: '/collection/items' }],
    }]);
  });

  it('groups queried records by a package field with package-selected details', () => {
    expect(groupedRecordShelfGroups({
      groupBy: 'category',
      subtitleFields: ['from_unit', 'to_unit', 'converted_value'],
      records: [{
        id: 'conversion-1',
        title: 'Workshop length',
        properties: {
          category: 'Basic',
          from_unit: 'm',
          to_unit: 'cm',
          converted_value: '100.00',
        },
      }],
    })).toEqual([{
      title: 'Basic',
      subtitle: '',
      action: null,
      items: [{
        id: 'conversion-1',
        title: 'Workshop length',
        subtitle: 'm · cm · 100.00',
        category: 'Basic',
        from_unit: 'm',
        to_unit: 'cm',
        converted_value: '100.00',
      }],
    }]);
  });

  it.each([
    ['Food', () => {
      const compiled = compileAppPackageSourceFolder(sourceRoot);
      if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
      return compiled.package;
    }],
    ['Pantry Restock', () => pantryRestockPackage],
  ] as const)('%s uses the shared primitive through the package contract', (_name, packageFactory) => {
    const appPackage = packageFactory();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('groupedRecordShelf');
    expect(widgets(appPackage)).toContain('groupedRecordShelf');
    expect(widgets(appPackage)).not.toContain('pantryShelf');
  });
});
