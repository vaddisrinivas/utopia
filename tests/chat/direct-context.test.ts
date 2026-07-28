import { describe, expect, it } from 'vitest';

import { buildDirectSourceContext, selectDirectSourceRecords } from '@/src/chat/client';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';

function record(id: string, collection: string, title: string, properties: Record<string, unknown> = {}): CanonicalRecord {
  return {
    id,
    domain: 'food',
    collection,
    title,
    properties,
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: id,
      url: null,
      observed_at: '2026-07-28T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
    revision: 1,
    schema_version: 'utopia.domain.v1',
    deleted: false,
    privacy: 'personal',
    provenance: null,
  };
}

describe('direct model source context', () => {
  it('selects inventory facts even when newer unrelated records come first', () => {
    const records = [
      ...Array.from({ length: 10 }, (_, index) => record(`meal-${index}`, 'meal_log', `Meal ${index}`)),
      record('yogurt', 'inventory', 'Greek yogurt', { location: 'fridge', quantity: 1 }),
      record('berries', 'inventory_lot', 'Blueberries', { location: 'fridge', quantity: '1 box' }),
    ];

    const selected = selectDirectSourceRecords('What is in my current inventory?', records);

    expect(selected.map((item) => item.id)).toEqual(expect.arrayContaining(['yogurt', 'berries']));
    expect(selected.slice(0, 2).map((item) => item.id)).toEqual(['yogurt', 'berries']);
  });

  it('loads broad kitchen facts for dinner planning even without exact item names', () => {
    const records = [
      ...Array.from({ length: 12 }, (_, index) => record(`note-${index}`, 'source_record', `Note ${index}`)),
      record('salmon', 'inventory_lot', 'Salmon fillets', { location: 'freezer', status: 'thawed', quantity: '2 fillets' }),
      record('spinach', 'inventory_lot', 'Baby spinach', { location: 'fridge', status: 'use in 2 days' }),
      record('recipe', 'recipe', 'Miso salmon bowl', { status: 'saved', missing_ingredients: 'cucumber' }),
      record('shop-cucumber', 'shopping_item', 'Cucumber', { reason: 'salmon bowl gap' }),
    ];

    const selected = selectDirectSourceRecords('Plan tonight dinner from what we have', records);

    expect(selected.map((item) => item.id).slice(0, 2)).toEqual(['salmon', 'spinach']);
    expect(selected.map((item) => item.id).slice(0, 6)).toEqual(expect.arrayContaining(['recipe', 'shop-cucumber']));
  });

  it('projects bounded facts and removes credentials', () => {
    const context = buildDirectSourceContext([
      record('yogurt', 'inventory', 'Greek yogurt', {
        quantity: 1,
        apiKey: 'must-not-leak',
        password: 'must-not-leak',
      }),
    ]);

    expect(context).toContain('<FACTS>');
    expect(context).toContain('collection=inventory');
    expect(context).toContain('quantity: 1');
    expect(context).not.toContain('must-not-leak');
  });
});
