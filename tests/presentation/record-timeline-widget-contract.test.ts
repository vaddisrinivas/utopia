import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import maintenancePartsPackage from '@/apps/maintenance-parts/maintenance-parts.v1.json';
import { compileAppPackageSourceFolder } from '@/packages/app-compiler';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import { validateAppPackage } from '@/server/src/kernel/package';
import { recordTimelineItems, recordTimelineMarker } from '@/src/presentation/widgets/record-timeline-config';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'apps/food/package-source');
const widgetSource = readFileSync(path.join(root, 'src/presentation/widgets/record-timeline-widget.tsx'), 'utf8');
const configSource = readFileSync(path.join(root, 'src/presentation/widgets/record-timeline-config.ts'), 'utf8');

function widgets(appPackage: Record<string, any>): string[] {
  return Object.values(appPackage.presentation.ui.screens as Record<string, { components: Array<{ kind: string; widget?: string }> }>)
    .flatMap((screen) => screen.components)
    .filter((component) => component.kind === 'widget')
    .map((component) => component.widget ?? '');
}

describe('record timeline primitive', () => {
  it('normalizes generic event records without domain assumptions', () => {
    expect(configSource).toContain('props.items');
    expect(widgetSource).toContain('openWidgetTarget');
    expect(`${widgetSource}\n${configSource}`).not.toMatch(/food|meal|pantry|workout|shift|maintenance/i);
    expect(recordTimelineItems({ items: [{ title: 'Inspection', time: 'Today' }, null, 'invalid'] })).toEqual([
      { title: 'Inspection', time: 'Today' },
    ]);
    expect(recordTimelineMarker({ date: '2026-08-01' })).toBe('2026-08-01');
  });

  it('derives timeline rows from query-bound records', () => {
    expect(recordTimelineItems({
      dateField: 'renewal_date',
      records: [{
        id: 'sub-1',
        title: 'Cloud plan',
        properties: { renewal_date: '2026-08-15T09:00:00Z', status: 'paid' },
      }],
    })).toEqual([{
      id: 'sub-1',
      title: 'Cloud plan',
      subtitle: 'paid · 2026-08-15T09:00:00Z',
      date: '2026-08-15T09:00:00Z',
      status: 'paid',
    }]);
  });

  it.each([
    ['Food', () => {
      const compiled = compileAppPackageSourceFolder(sourceRoot);
      if (!compiled.valid) throw new Error(compiled.errors.map((error) => error.message).join(', '));
      return compiled.package;
    }],
    ['Maintenance Parts', () => maintenancePartsPackage],
  ] as const)('%s uses the shared primitive through the package contract', (_name, packageFactory) => {
    const appPackage = packageFactory();
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(APP_PACKAGE_WIDGET_KINDS).toContain('recordTimeline');
    expect(widgets(appPackage)).toContain('recordTimeline');
    expect(widgets(appPackage)).not.toContain('mealTimeline');
  });
});
