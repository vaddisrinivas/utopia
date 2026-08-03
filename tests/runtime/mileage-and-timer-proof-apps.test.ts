import fuelPackage from '@/apps/fuel-log/fuel-log.v1.json';
import intervalPackage from '@/apps/interval-timer/interval-timer.v1.json';
import meditationPackage from '@/apps/meditation-timer/meditation-timer.v1.json';
import mileagePackage from '@/apps/mileage-log/mileage-log.v1.json';
import { validateAppPackage } from '@/server/src/kernel/package';
import { describe, expect, it } from 'vitest';

describe('mileage and timer proof apps', () => {
  it.each([
    ['Mileage Log', mileagePackage],
    ['Fuel Log', fuelPackage],
    ['Interval Timer', intervalPackage],
    ['Meditation Timer', meditationPackage],
  ])('%s validates as a package-only app', (_name, appPackage) => {
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
  });

  it('reuses generic arithmetic expressions for mileage and fuel', () => {
    expect(mileagePackage.computedFields.map((field) => field.id)).toEqual(['distance', 'reimbursement']);
    expect(fuelPackage.computedFields.map((field) => field.id)).toEqual(['cost', 'efficiency']);
  });

  it('reuses generic timer widgets for distinct interval shapes', () => {
    expect(widgetKinds(intervalPackage)).toContain('stepFlow');
    expect(widgetKinds(meditationPackage)).toContain('durationTimer');
  });
});

function widgetKinds(appPackage: any) {
  return appPackage.presentation.ui.screens.home.components
    .map((component: any) => component.widget)
    .filter(Boolean);
}
