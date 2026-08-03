import counterPackage from '@/apps/counter/counter.v1.json';
import inventoryPackage from '@/apps/inventory-quantity/inventory-quantity.v1.json';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { describe, expect, it } from 'vitest';

function packageWidgets(appPackage: {
  presentation: {
    ui: {
      screens: Record<string, { components: Array<{ kind: string; widget?: string }> }>;
    };
  };
}): string[] {
  return Object.values(appPackage.presentation.ui.screens)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget')
    .flatMap((component) => component.widget ?? []);
}

function defaultComponents(appPackage: {
  presentation: { ui: { defaultScreen: string; screens: Record<string, { components: Array<{ kind: string; widget?: string; props?: Record<string, unknown> }> }>; }; };
}) {
  return appPackage.presentation.ui.screens[appPackage.presentation.ui.defaultScreen].components;
}

function findDefaultWidget(appPackage: Parameters<typeof defaultComponents>[0], widget: string) {
  return defaultComponents(appPackage).find((component) => component.widget === widget);
}

describe('value-control proof apps', () => {
  it.each([
    ['Counter', counterPackage],
    ['Inventory Quantity', inventoryPackage],
  ])('%s validates and uses only registered generic widgets', (_name, appPackage) => {
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(packageWidgets(appPackage)).toContain('valueControl');
    expect(packageWidgets(appPackage).every((widget) => APP_PACKAGE_WIDGET_KINDS.includes(widget as never))).toBe(true);
  });

  it('reuses one capability primitive across unrelated value shapes', () => {
    expect(findDefaultWidget(counterPackage, 'valueControl')).toMatchObject({
      widget: 'valueControl',
      props: { valueField: 'value', step: 1, precision: 0 },
    });
    expect(findDefaultWidget(inventoryPackage, 'valueControl')).toMatchObject({
      widget: 'valueControl',
      props: { valueField: 'quantity', step: 0.5, precision: 1 },
    });
  });
});
