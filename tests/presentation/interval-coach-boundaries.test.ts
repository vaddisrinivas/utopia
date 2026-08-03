import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PACKAGE_PATH = join(process.cwd(), 'apps', 'focus-intervals', 'focus-intervals.v1.json');

type ScreenComponent = {
  kind?: string;
  widget?: string;
  props?: Record<string, unknown>;
};

type PackageShape = {
  capabilities?: unknown[];
  presentation: {
    ui: {
      screens: Record<string, {
        subtitle?: string;
        components?: ScreenComponent[];
      }>;
    };
  };
};

describe('interval coach boundary copy', () => {
  it('does not expose reminder scheduling controls or notification capabilities', () => {
    const appPackage = loadPackage();
    const widgets = allWidgets(appPackage);

    expect(appPackage.capabilities ?? []).toEqual([]);
    expect(widgets).not.toContain('notificationScheduler');
  });

  it('tells the truth about foreground timing, local recovery, and missing native proof', () => {
    const appPackage = loadPackage();
    const allText = JSON.stringify(appPackage.presentation.ui.screens);
    const providerStatus = findWidget(appPackage, 'providerStatus');

    expect(allText).toContain('no fake background magic');
    expect(allText).toContain('Nothing schedules or runs silently.');
    expect(allText).toContain('Push reminders and background execution need separate native proof');
    expect(allText).toContain('foreground-only');
    expect(providerStatus?.props?.unavailableText).toBe(
      'Timing, notes, and restart recovery work locally. Push reminders and background execution need separate native proof and are not claimed by this package.',
    );
  });
});

function loadPackage(): PackageShape {
  return JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as PackageShape;
}

function allWidgets(appPackage: PackageShape): string[] {
  return Object.values(appPackage.presentation.ui.screens)
    .flatMap((screen) => screen.components ?? [])
    .map((component) => component.widget)
    .filter((widget): widget is string => typeof widget === 'string')
    .sort();
}

function findWidget(appPackage: PackageShape, widgetName: string): ScreenComponent | undefined {
  return Object.values(appPackage.presentation.ui.screens)
    .flatMap((screen) => screen.components ?? [])
    .find((component) => component.widget === widgetName);
}
