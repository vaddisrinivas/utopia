import { describe, expect, it } from 'vitest';

import { makeWelcomeAnswer } from '@/src/chat/client';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';

describe('domain chat render contracts', () => {
  it('renders Health records without Food-specific columns or source quotes', () => {
    const record: CanonicalRecord = {
      id: 'health-steps',
      domain: 'health',
      collection: 'health_measurement',
      title: 'Morning steps',
      properties: {
        status: 'Synced',
        body: '8,400 steps synced from Health Connect.',
        meta: 'Today movement signal',
      },
      relations: [],
      source: {
        provider: 'sqlite',
        external_id: 'health-steps',
        url: null,
        observed_at: '2026-07-23T00:00:00.000Z',
        content_hash: null,
      },
      archived_at: null,
      created_at: '2026-07-23T00:00:00.000Z',
      updated_at: '2026-07-23T00:00:00.000Z',
      revision: 1,
      schema_version: 'utopia.domain.v1',
      deleted: false,
      privacy: 'personal',
      provenance: null,
    };

    const answer = makeWelcomeAnswer([record], 'Health');
    const visibleText = [
      answer.title,
      answer.intro,
      ...(answer.columns ?? []),
      ...answer.rows.flatMap((row) => row.cells ?? []),
      ...(answer.sourceCards ?? []).flatMap((card) => [card.label, card.detail, card.quote, ...(card.fields ?? [])]),
      ...(answer.recordCards ?? []).flatMap((card) => [card.title, card.collection, card.status, card.detail, card.source, ...(card.bullets ?? [])]),
      ...answer.citations.flatMap((citation) => [citation.label, citation.detail]),
    ].join(' ').toLowerCase();

    expect(answer.title).toContain('Health');
    expect(answer.columns).toEqual(['Record', 'Signal', 'Context']);
    expect(visibleText).not.toContain('food');
    expect(visibleText).not.toContain('ingredient');
    expect(visibleText).not.toContain('shopping');
    expect(answer.sourceCards?.[0]?.quote).toContain('8,400 steps');
  });
});
