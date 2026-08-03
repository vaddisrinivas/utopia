import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import readingTrackerPackage from '@/apps/reading-tracker/reading-tracker.v1.json';
import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { horizontalRecordCarouselItems } from '@/src/presentation/widgets/horizontal-record-carousel-config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const foodSource = path.join(root, 'apps/food/package-source');
const widgetSource = readFileSync(path.join(root, 'src/presentation/widgets/horizontal-record-carousel-widget.tsx'), 'utf8');
const configSource = readFileSync(path.join(root, 'src/presentation/widgets/horizontal-record-carousel-config.ts'), 'utf8');

function widgets(appPackage: Record<string, any>): string[] {
  return Object.values(appPackage.presentation?.ui?.screens ?? {})
    .flatMap((screen: any) => screen.components ?? [])
    .filter((component: any) => component.kind === 'widget')
    .map((component: any) => component.widget ?? '');
}

describe('horizontal record carousel primitive', () => {
  it('uses neutral record/item bindings and has deterministic optional sorting', () => {
    expect(horizontalRecordCarouselItems({
      records: [{ title: 'Later', order: 2 }, { title: 'First', order: 1 }],
      sortBy: 'order',
    })).toEqual([{ title: 'First', order: 1 }, { title: 'Later', order: 2 }]);
    expect(horizontalRecordCarouselItems({ items: [{ title: 'Configured' }] })).toEqual([{ title: 'Configured' }]);
    expect(`${widgetSource}\n${configSource}`).not.toMatch(/food|pantry|kitchen|recipe|inventory|useFirst/i);
  });

  it.each([
    ['Food', () => {
      const compiled = compileAppPackageSourceFolder(foodSource);
      if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
      return compiled.package;
    }],
    ['Reading Tracker', () => readingTrackerPackage],
  ] as const)('%s uses the generic carousel through the package contract', (_name, packageFactory) => {
    const appPackage = packageFactory();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('horizontalRecordCarousel');
    expect(widgets(appPackage)).toContain('horizontalRecordCarousel');
    expect(widgets(appPackage)).not.toContain('useFirstCarousel');
  });
});
