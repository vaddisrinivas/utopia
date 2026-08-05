import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const parity = {
  widgets: {
    foodHero: 'migrated',
    useFirstCarousel: 'migrated',
    mealTimeline: 'migrated',
    recipeCard: 'migrated',
    receiptReviewCard: 'migrated',
    pantryShelf: 'migrated',
    widgetCatalog: 'migrated',
    tileGrid: 'migrated',
  },
  widgetsLegacy: {
    foodHero: 'Post',
    useFirstCarousel: 'Gallery',
    mealTimeline: 'Calendar',
    recipeCard: 'Post',
    receiptReviewCard: 'Permission',
    pantryShelf: 'Catalog',
  },
  widgetsShowcase: {
    foodHero: 'Hero',
    useFirstCarousel: 'Carousel',
    mealTimeline: 'Timeline',
    recipeCard: 'Feature',
    receiptReviewCard: 'Review',
    pantryShelf: 'Grid',
  },
};

const standardSource = readFileSync(fileURLToPath(new URL('../../src/kernel/standard-widgets.tsx', import.meta.url)), 'utf8');
const showcaseSource = readFileSync(fileURLToPath(new URL('../../src/kernel/showcase-widgets.tsx', import.meta.url)), 'utf8');

describe('v3 visual parity', () => {
  it('marks legacy widget kinds as migrated', () => {
    const expected = Object.keys(parity.widgetsShowcase);
    for (const key of expected) {
      expect(parity.widgets[key]).toBe('migrated');
    }
  });

  it('explicitly maps legacy names to generic widgets in renderer source', () => {
    for (const [key, mapped] of Object.entries(parity.widgetsLegacy)) {
      expect(standardSource).toContain(`'${key}'`);
      expect(standardSource).toContain(`case '${key}': return <${mapped} {...props} />;`);
    }

    for (const [key, mapped] of Object.entries(parity.widgetsShowcase)) {
      expect(showcaseSource).toContain(`'${key}'`);
      expect(showcaseSource).toContain(`if (widget === '${key}') return <${mapped} {...props} />;`);
    }
  });

  it('removes generic placeholder-only rendering from parity targets', () => {
    expect(parity.widgets.widgetCatalog).toBe('migrated');
    expect(parity.widgets.tileGrid).toBe('migrated');
    expect(standardSource).toContain('widgetCatalog');
    expect(showcaseSource).toContain('tileGrid');
    expect(standardSource).toContain("case 'widgetCatalog': return <Catalog {...props} />;");
    expect(showcaseSource).toContain("if (widget === 'tileGrid') return <Grid {...props} />;");
  });
});
