import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import foodPackage from '@/apps/food/app-package.v3.json';
import readingTrackerPackage from '@/apps/reading-tracker/reading-tracker.v1.json';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const widgetSource = readFileSync(path.join(root, 'src/presentation/widgets/record-content-card-widget.tsx'), 'utf8');

function components(appPackage: Record<string, any>) {
  return Object.values(appPackage.presentation.ui.screens as Record<string, { components: Array<Record<string, any>> }>)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget');
}

describe('record content card primitive', () => {
  it('uses neutral content vocabulary with no domain-specific defaults', () => {
    expect(widgetSource).toContain('RecordContentCardProps');
    expect(widgetSource).toContain('props.chips');
    expect(widgetSource).toContain('props.actions');
    expect(widgetSource).not.toMatch(/recipe|food|pantry|kitchen/i);
  });

  it.each([
    ['Food', foodPackage],
    ['Reading Tracker', readingTrackerPackage],
  ] as const)('%s uses the shared primitive with content and actions', (_name, appPackage) => {
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('recordContentCard');
    const card = components(appPackage).find((component) => component.widget === 'recordContentCard');
    expect(card).toBeDefined();
    expect(card?.props?.emoji).toBeTruthy();
    expect(Array.isArray(card?.props?.chips)).toBe(true);
    expect(Boolean(card?.props?.route) || Array.isArray(card?.props?.actions)).toBe(true);
  });

  it('preserves Food title, chips, and routed action binding', () => {
    const card = components(foodPackage).find((component) => component.widget === 'recordContentCard');
    expect(card?.id).toBe('food-plan-recipe-card');
    expect(card?.title).toBe('Pantry-first dinner');
    expect(card?.props?.chips).toHaveLength(3);
    expect(card?.props?.actions?.[0]?.route).toContain('/chat?prompt=');
  });
});
