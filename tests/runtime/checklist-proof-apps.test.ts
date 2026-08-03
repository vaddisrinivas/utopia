import checklistPackage from '@/apps/offline-checklist/offline-checklist.v1.json';
import packingPackage from '@/apps/travel-packing-list/travel-packing-list.v1.json';
import { validateAppPackage } from '@/server/src/kernel/package';
import { describe, expect, it } from 'vitest';

describe('persistent checklist proof apps', () => {
  it.each([
    ['Offline Checklist', checklistPackage],
    ['Travel Packing List', packingPackage],
  ])('%s validates with the same data-bound checklist primitive', (_name, appPackage) => {
    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    const checklist = Object.values(appPackage.presentation.ui.screens)
      .flatMap((screen) => screen.components)
      .find((component) => component.kind === 'widget' && component.widget === 'checklistCard');
    expect(checklist).toMatchObject({
      widget: 'checklistCard',
      props: { checkedField: 'checked' },
    });
    expect(checklist?.query).toBeDefined();
  });

  it('keeps packing relational without adding a travel-specific renderer', () => {
    expect(packingPackage.collections.packing_item.fields.trip_id).toMatchObject({
      type: 'text',
      indexed: true,
      required: true,
    });
    expect(JSON.stringify(packingPackage.presentation.ui)).not.toMatch(/travelPacking|packingChecklist/i);
  });
});
