import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  expandRecurrenceSchedule as expandSharedRecurrenceSchedule,
  nextRecurrenceOccurrence as nextSharedRecurrenceOccurrence,
} from '@/packages/runtime-kernel/recurrence';
import {
  expandRecurrenceSchedule as expandServerRecurrenceSchedule,
  nextRecurrenceOccurrence as nextServerRecurrenceOccurrence,
} from '@/server/src/kernel/recurrence';

type Corpus = {
  budget: {
    maxOccurrences: number;
    maxIterations: number;
    maxRuleEvaluations: number;
    maxLookaheadDays: number;
    maxExclusions: number;
    maxOverrides: number;
  };
  nextCases: Array<{
    id: string;
    schedule: Record<string, unknown>;
    after: string;
    expected: {
      instant: string;
      local: string;
      offset: string;
    };
  }>;
  expandCases: Array<{
    id: string;
    schedule: Record<string, unknown>;
    after: string;
    limit: number;
    budget?: Partial<Corpus['budget']>;
    expectedInstants?: string[];
    expectedRefusal?: string;
  }>;
  invalidCases: Array<{
    id: string;
    schedule: Record<string, unknown>;
    expected: string;
  }>;
};

const corpusPath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/recurrence-runtime/corpus.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;

describe('recurrence runtime', () => {
  it.each(corpus.nextCases)('$id matches shared and server next-occurrence output', ({ schedule, after, expected }) => {
    const shared = nextSharedRecurrenceOccurrence({ schedule, after, budget: corpus.budget });
    const server = nextServerRecurrenceOccurrence({ schedule, after, budget: corpus.budget });

    expect(shared).toEqual(server);
    expect(shared).toMatchObject(expected);
  });

  it.each(corpus.expandCases)('$id matches shared and server expansion output', ({ schedule, after, limit, budget, expectedInstants, expectedRefusal }) => {
    const shared = expandSharedRecurrenceSchedule({ schedule, after, limit, budget: budget ?? corpus.budget });
    const server = expandServerRecurrenceSchedule({ schedule, after, limit, budget: budget ?? corpus.budget });

    expect(shared).toEqual(server);
    if (expectedRefusal) {
      expect(shared).toMatchObject({ status: 'refused', reason: expectedRefusal });
      return;
    }

    expect(shared).toMatchObject({ status: 'ok' });
    if (shared.status === 'ok') {
      expect(shared.occurrences.map((occurrence) => occurrence.instant)).toEqual(expectedInstants);
    }
  });

  it.each(corpus.invalidCases)('$id rejects malformed schedules deterministically', ({ schedule, expected }) => {
    expect(() => nextSharedRecurrenceOccurrence({ schedule, budget: corpus.budget })).toThrow(expected);
    expect(() => nextServerRecurrenceOccurrence({ schedule, budget: corpus.budget })).toThrow(expected);
    expect(() => expandSharedRecurrenceSchedule({ schedule, after: '2026-07-01T00:00:00Z', limit: 1, budget: corpus.budget })).toThrow(expected);
    expect(() => expandServerRecurrenceSchedule({ schedule, after: '2026-07-01T00:00:00Z', limit: 1, budget: corpus.budget })).toThrow(expected);
  });

  it('refuses malformed budgets instead of running unbounded', () => {
    const schedule = corpus.nextCases[0]!.schedule;
    const result = expandSharedRecurrenceSchedule({
      schedule,
      after: corpus.nextCases[0]!.after,
      limit: 1,
      budget: { ...corpus.budget, maxIterations: Number.NaN },
    });
    expect(result).toMatchObject({ status: 'refused', reason: 'recurrence_budget_invalid' });
  });

  it('rejects malformed optional arrays deterministically', () => {
    const schedule = { ...corpus.nextCases[0]!.schedule, exclusions: 'not-an-array' };
    expect(() => nextSharedRecurrenceOccurrence({ schedule, budget: corpus.budget })).toThrow('recurrence_schedule_invalid');
  });
});
