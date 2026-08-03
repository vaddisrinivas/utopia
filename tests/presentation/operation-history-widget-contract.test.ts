import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import counterPackage from '@/apps/counter/counter.v1.json';
import inventoryPackage from '@/apps/inventory-quantity/inventory-quantity.v1.json';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'src/presentation/widgets/operation-history-widget.tsx'), 'utf8');

function widgets(appPackage: Record<string, any>): string[] {
  const screens = appPackage.presentation.ui.screens as Record<string, { components: Array<{ kind: string; widget?: string }> }>;
  return Object.values(screens)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget')
    .map((component) => component.widget ?? '');
}

describe('generic operation history surface', () => {
  it('uses installation and domain scoped durable operations with generic filters', () => {
    expect(source).toContain('SELECT op_id, kind, collection, record_id, actor, origin, status, reject_reason, created_at FROM operations');
    expect(source).toContain('app_installation_id = ?');
    expect(source).toContain('domain = ?');
    expect(source).toContain('collection = ?');
    expect(source).toContain('record_id = ?');
    expect(source).toContain('subscribeToRecordChanges');
    expect(source).toContain('No changes yet.');
    expect(source).toContain('operationHistoryKindLabel(row.kind, props.eventLabels)');
    expect(source).toContain('entries[`${kind}_record`]');
    expect(source).toContain('accessibilityLabel={`${kind} ${subject}, ${status}, ${formatTimestamp(row.created_at)}`}');
    expect(source).not.toMatch(/counter|inventory|hydration|shopping/i);
  });

  it.each([
    ['Counter', counterPackage, 'counter'],
    ['Inventory Quantity', inventoryPackage, 'inventory_item'],
  ] as const)('%s is wired to the generic surface', (_name, appPackage, collection) => {
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('operationHistory');
    expect(widgets(appPackage)).toContain('operationHistory');
    expect(widgets(appPackage).every((widget) => APP_PACKAGE_WIDGET_KINDS.includes(widget as never))).toBe(true);
    const history = Object.values(appPackage.presentation.ui.screens)
      .flatMap((screen) => screen.components)
      .find((component) => component.widget === 'operationHistory');
    expect(history?.props).toMatchObject({ collection });
  });
});
