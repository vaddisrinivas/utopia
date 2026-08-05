import { describe, expect, it } from 'vitest';

import { normalizeWidgetKind, supportsWidget } from '@/src/kernel/widget-support';

describe('v3 visual parity', () => {
  it.each([
    ['foodHero', 'postCard'],
    ['useFirstCarousel', 'galleryGrid'],
    ['mealTimeline', 'calendarBlock'],
    ['recipeCard', 'postCard'],
    ['receiptReviewCard', 'permissionCard'],
    ['pantryShelf', 'widgetCatalog'],
  ])('maps %s to %s', (alias, canonical) => {
    expect(normalizeWidgetKind(alias)).toBe(canonical);
    expect(supportsWidget(alias)).toBe(true);
  });

  it.each(['menuStrip', 'segmentedControl', 'progressStatus', 'statusBanner', 'emptyState'])(
    'supports %s without a schema revision',
    (widget) => expect(supportsWidget(widget)).toBe(true),
  );
});
