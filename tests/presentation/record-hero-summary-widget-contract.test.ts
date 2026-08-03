import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import courseProgressPackage from '@/apps/course-progress/course-progress.v1.json';
import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { interpolateRecordTemplate } from '@/src/presentation/widgets/widget-sdk';
import emergencyKitPackage from '@/apps/emergency-kit/emergency-kit.v1.json';
import hydrationLogPackage from '@/apps/hydration-log/hydration-log.v1.json';
import waterIntakePackage from '@/apps/water-intake/water-intake.v1.json';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'apps/food/package-source');
const widgetSource = readFileSync(path.join(root, 'src/presentation/widgets/record-hero-summary-widget.tsx'), 'utf8');

function widgets(appPackage: Record<string, any>): string[] {
  return Object.values(appPackage.presentation.ui.screens as Record<string, { components: Array<{ kind: string; widget?: string }> }>)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget')
    .map((component) => component.widget ?? '');
}

describe('record hero summary primitive', () => {
  it('is generic and has no Food-specific assumptions', () => {
    expect(widgetSource).toContain('rawProps.stats');
    expect(widgetSource).toContain('openWidgetTarget');
    expect(widgetSource).not.toMatch(/food|meal|recipe|pantry|kitchen/i);
  });

  it.each([
    ['Food', () => {
      const compiled = compileAppPackageSourceFolder(sourceRoot);
      if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
      return compiled.package;
    }],
    ['Course Progress', () => courseProgressPackage],
  ] as const)('%s uses the shared primitive through the package contract', (_name, packageFactory) => {
    const appPackage = packageFactory();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('recordHeroSummary');
    expect(widgets(appPackage)).toContain('recordHeroSummary');
    expect(widgets(appPackage)).not.toContain('foodHero');
  });

  it('resolves package stat templates from the current record without leaking braces', () => {
    const record = {
      id: 'hydration-today',
      title: 'Today',
      collection: 'hydration',
      properties: {
        category: 'Water',
        glasses: 8,
        goal_day: '2026-08-01',
        priority: 'Critical',
        unit: 'ml',
        volume_ml: 2250,
      },
    };

    expect(interpolateRecordTemplate('{unit}', [record])).toBe('ml');
    expect(interpolateRecordTemplate('{glasses}', [record])).toBe('8');
    expect(interpolateRecordTemplate('Goal {goal_day}: {volume_ml} ml', [record])).toBe('Goal 2026-08-01: 2250 ml');
    expect(interpolateRecordTemplate('{missing_value}', [record])).toBe('-');
    expect(interpolateRecordTemplate('\\{unit\\}', [record])).toBe('{unit}');
  });

  it.each([
    ['water-intake', waterIntakePackage, { unit: 'ml', glasses: 8, daily_goal_glasses: 10 }],
    ['emergency-kit', emergencyKitPackage, { category: 'Water', priority: 'Critical' }],
    ['hydration-log', hydrationLogPackage, { goal_day: '2026-08-01', volume_ml: 2250 }],
  ] as const)('%s recordHeroSummary stats render from queried records', (_id, appPackage, properties) => {
    const stats = Object.values(appPackage.presentation.ui.screens as Record<string, any>)
      .flatMap((screen) => screen.components)
      .find((component) => component.widget === 'recordHeroSummary')
      ?.props?.stats;
    expect(Array.isArray(stats)).toBe(true);

    const rendered = stats.map((stat: Record<string, unknown>) => interpolateRecordTemplate(stat.value, [{
      id: 'current',
      title: 'Current',
      collection: 'primary',
      properties,
    }]));

    expect(rendered.every((value: string) => !/[{}]/.test(value))).toBe(true);
    expect(rendered.every((value: string) => value !== '-')).toBe(true);
  });
});
