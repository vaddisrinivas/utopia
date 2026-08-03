import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppPackage } from '@/packages/shared/contracts/package';
import { validateAppPackage } from '@/server/src/kernel/package';
import { evaluatePackage } from '@/server/src/kernel/runtime';

const PROOF_APPS = [
  ['plant-care', 'plant-care.v1.json'],
  ['pet-medication', 'pet-medication.v1.json'],
  ['workout-log-v2', 'workout-log-v2.v1.json'],
  ['physio-routine', 'physio-routine.v1.json'],
  ['reading-tracker', 'reading-tracker.v1.json'],
  ['course-progress', 'course-progress.v1.json'],
] as const;

const ALLOWED_WIDGETS = new Set([
  'calendarBlock',
  'chartBlock',
  'checklistCard',
  'dataTable',
  'durationTimer',
  'fileExport',
  'formCard',
  'groupedRecordShelf',
  'horizontalRecordCarousel',
  'notificationScheduler',
  'operationHistory',
  'providerStatus',
  'recordContentCard',
  'recordHeroSummary',
  'recordReviewCard',
  'recordTimeline',
  'stepFlow',
  'structuredList',
  'themeDensitySelector',
  'valueControl',
]);

describe('routine and progress proof apps', () => {
  it.each(PROOF_APPS)('validates %s and uses only generic existing primitives', (directory, file) => {
    const appPackage = loadPackage(directory, file);
    const widgets = widgetKinds(appPackage);

    expect(validateAppPackage(appPackage)).toMatchObject({ valid: true });
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets.every((widget) => ALLOWED_WIDGETS.has(widget))).toBe(true);
    expect(widgets.some((widget) => isAppNamedWidget(widget, appPackage.id))).toBe(false);
    expect(appPackage.capabilities).toEqual([]);
    expect(appPackage.acceptanceTests).not.toContain('native-notifications');
    expect(appPackage.acceptanceTests).not.toContain('background-execution');
    expect(appPackage.acceptanceTests).not.toContain('external-metadata-enrichment');
  });

  it('computes deterministic next care and dose occurrences', () => {
    const plantResult = evaluatePackage({
      package: loadPackage('plant-care', 'plant-care.v1.json'),
      collections: {
        plant: [{
          id: 'fern',
          collection: 'plant',
          title: 'Boston fern',
          status: 'active',
          as_of: '2026-08-01T09:00:01-04:00',
          schedule: {
            schemaVersion: 'utopia.recurrence.v1',
            timezone: 'America/New_York',
            anchor: '2026-08-01T09:00:00-04:00',
            dstPolicy: 'compatible',
            rules: [{ id: 'water-every-three-days', kind: 'interval', every: 3, unit: 'day' }],
          },
        }],
        care_log: [],
      },
    });
    const petResult = evaluatePackage({
      package: loadPackage('pet-medication', 'pet-medication.v1.json'),
      collections: {
        medication: [{
          id: 'thyroid',
          collection: 'medication',
          title: 'Thyroid tablet',
          pet_name: 'Milo',
          dose: '1 tablet',
          status: 'active',
          as_of: '2026-08-01T08:00:01-04:00',
          schedule: {
            schemaVersion: 'utopia.recurrence.v1',
            timezone: 'America/New_York',
            anchor: '2026-08-01T08:00:00-04:00',
            dstPolicy: 'compatible',
            rules: [{ id: 'daily-dose', kind: 'interval', every: 1, unit: 'day' }],
          },
        }],
        dose_log: [],
      },
    });

    expect(plantResult.queries['active-plants'].rows[0]?.next_care).toMatchObject({
      instant: '2026-08-04T13:00:00.000Z',
      local: '2026-08-04T09:00:00',
    });
    expect(plantResult.queries['active-plants'].rows[0]?.care_window).toMatchObject({
      status: 'ok',
      occurrences: expect.any(Array),
    });
    expect(petResult.queries['active-medications'].rows[0]?.next_dose).toMatchObject({
      instant: '2026-08-02T12:00:00.000Z',
      local: '2026-08-02T08:00:00',
    });
    expect(petResult.queries['active-medications'].rows[0]?.dose_window).toMatchObject({
      status: 'ok',
      occurrences: expect.any(Array),
    });
  });

  it('computes workout load and physio outcomes without app-specific evaluators', () => {
    const workoutResult = evaluatePackage({
      package: loadPackage('workout-log-v2', 'workout-log-v2.v1.json'),
      collections: {
        routine: [],
        workout_session: [],
        set_log: [{
          id: 'set-1',
          collection: 'set_log',
          title: 'Back squat set 1',
          session_id: 'session-1',
          exercise: 'Back squat',
          set_number: 1,
          reps: 5,
          weight: 80,
          completed_at: '2026-08-01T14:00:00Z',
        }],
      },
    });
    const physioResult = evaluatePackage({
      package: loadPackage('physio-routine', 'physio-routine.v1.json'),
      collections: {
        care_plan: [],
        routine_session: [{
          id: 'session-1',
          collection: 'routine_session',
          title: 'Morning knee routine',
          care_plan_id: 'knee-plan',
          status: 'finished',
          pain_before: 5,
          pain_after: 3,
          started_at: '2026-08-01T12:00:00Z',
        }],
        exercise_log: [{
          id: 'exercise-1',
          collection: 'exercise_log',
          title: 'Straight-leg raise',
          session_id: 'session-1',
          exercise: 'Straight-leg raise',
          sets: 3,
          reps: 12,
          status: 'completed',
        }],
      },
    });

    expect(workoutResult.queries['recent-sets'].rows[0]?.volume).toBe('400.00');
    expect(physioResult.queries['recent-sessions'].rows[0]?.pain_change).toBe('-2.00');
    expect(physioResult.queries['exercise-history'].rows[0]?.total_repetitions).toBe('36.00');
  });

  it('defines reusable timed flows for both routine apps', () => {
    const workout = loadPackage('workout-log-v2', 'workout-log-v2.v1.json');
    const physio = loadPackage('physio-routine', 'physio-routine.v1.json');

    expect(widgetProps(workout, 'stepFlow')).toMatchObject({
      runId: 'strength-session',
      steps: [
        { id: 'warmup', durationSeconds: 300 },
        { id: 'squat' },
        { id: 'rest-squat', durationSeconds: 90 },
        { id: 'press' },
        { id: 'cooldown', durationSeconds: 300 },
      ],
    });
    expect(widgetProps(workout, 'durationTimer')).toMatchObject({
      runId: 'set-recovery',
      durationSeconds: 90,
    });
    expect(widgetProps(physio, 'stepFlow')).toMatchObject({
      runId: 'mobility-routine',
      steps: [
        { id: 'warmup', durationSeconds: 180 },
        { id: 'mobility', durationSeconds: 300 },
        { id: 'strength' },
        { id: 'recovery', durationSeconds: 120 },
        { id: 'symptoms' },
      ],
    });
    expect(widgetProps(physio, 'durationTimer')).toMatchObject({
      runId: 'exercise-hold',
      durationSeconds: 30,
    });
  });

  it('computes reading and course progress with zero-total protection', () => {
    const readingPackage = loadPackage('reading-tracker', 'reading-tracker.v1.json');
    const readingResult = evaluatePackage({
      package: readingPackage,
      collections: {
        book: [
          {
            id: 'book-1',
            collection: 'book',
            title: 'A serious book',
            author: 'A. Writer',
            status: 'reading',
            total_pages: 400,
            pages_read: 150,
            updated_at: '2026-08-01T12:00:00Z',
          },
          {
            id: 'book-2',
            collection: 'book',
            title: 'Unpaginated reference',
            author: 'B. Writer',
            status: 'reading',
            total_pages: 0,
            pages_read: 0,
            updated_at: '2026-07-31T12:00:00Z',
          },
        ],
        reading_session: [{
          id: 'read-1',
          collection: 'reading_session',
          title: 'Morning reading',
          book_id: 'book-1',
          started_at: '2026-08-01T11:00:00Z',
          start_page: 120,
          end_page: 150,
        }],
      },
    });
    const courseResult = evaluatePackage({
      package: loadPackage('course-progress', 'course-progress.v1.json'),
      collections: {
        course: [{
          id: 'course-1',
          collection: 'course',
          title: 'Distributed Systems',
          status: 'active',
          total_lessons: 24,
          completed_lessons: 9,
          target_date: '2026-09-30T00:00:00Z',
        }],
        lesson: [],
        study_session: [],
      },
    });

    const books = readingResult.queries['current-books'].rows;
    expect(books[0]?.progress_ratio).toBe('0.38');
    expect(books[1]?.progress_ratio).toBe(0);
    expect(readingResult.queries.sessions.rows[0]?.pages_completed).toBe('30.00');
    expect(courseResult.queries['active-courses'].rows[0]?.progress_ratio).toBe('0.38');
  });
});

function loadPackage(directory: string, file: string): AppPackage {
  return JSON.parse(readFileSync(join(process.cwd(), 'apps', directory, file), 'utf8')) as AppPackage;
}

function widgetKinds(appPackage: AppPackage): string[] {
  return [...new Set(
    Object.values(appPackage.presentation?.ui?.screens ?? {})
      .flatMap((screen) => screen.components ?? [])
      .filter((component) => component.kind === 'widget')
      .map((component) => String(component.widget)),
  )].sort();
}

function widgetProps(appPackage: AppPackage, widget: string): Record<string, unknown> {
  const component = Object.values(appPackage.presentation?.ui?.screens ?? {})
    .flatMap((screen) => screen.components ?? [])
    .find((candidate) => candidate.kind === 'widget' && candidate.widget === widget);
  return component?.props ?? {};
}

function isAppNamedWidget(widget: string, appId: string): boolean {
  const normalizedWidget = widget.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const appWords = appId.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
  return appWords.some((word) => normalizedWidget.includes(word));
}
