export const RECURRENCE_SCHEMA_VERSION = 'utopia.recurrence.v1' as const;

export const RECURRENCE_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const RECURRENCE_DST_POLICIES = ['compatible', 'skip'] as const;

export type RecurrenceWeekday = typeof RECURRENCE_WEEKDAYS[number];

export type RecurrenceDstPolicy = typeof RECURRENCE_DST_POLICIES[number];

export type RecurrenceRuleKind = 'interval' | 'weekday' | 'monthday';

export type RecurrenceRuleUnit = 'day' | 'week' | 'month' | 'year';

export type RecurrenceIntervalRuleSpec = Readonly<{
  id: string;
  kind: 'interval';
  every: number;
  unit: RecurrenceRuleUnit;
}>;

export type RecurrenceWeekdayRuleSpec = Readonly<{
  id: string;
  kind: 'weekday';
  every: number;
  weekdays: readonly RecurrenceWeekday[];
}>;

export type RecurrenceMonthdayRuleSpec = Readonly<{
  id: string;
  kind: 'monthday';
  every: number;
  monthDays: readonly number[];
}>;

export type RecurrenceRuleSpec =
  | RecurrenceIntervalRuleSpec
  | RecurrenceWeekdayRuleSpec
  | RecurrenceMonthdayRuleSpec;

export type RecurrenceScheduleOverride = Readonly<{
  at: string;
  replaceWith?: string;
  cancelled?: boolean;
  reason?: string;
}>;

export type RecurrenceScheduleSpec = Readonly<{
  schemaVersion: typeof RECURRENCE_SCHEMA_VERSION;
  timezone: string;
  anchor: string;
  dstPolicy?: RecurrenceDstPolicy;
  rules: readonly RecurrenceRuleSpec[];
  exclusions?: readonly string[];
  overrides?: readonly RecurrenceScheduleOverride[];
}>;

export type RecurrenceBudget = Readonly<{
  maxOccurrences: number;
  maxIterations: number;
  maxRuleEvaluations: number;
  maxLookaheadDays: number;
  maxExclusions: number;
  maxOverrides: number;
}>;

export type RecurrenceSource = Readonly<{
  kind: 'rule' | 'override';
  ids: readonly string[];
  ruleKinds?: readonly RecurrenceRuleKind[];
}>;

export type RecurrenceOccurrence = Readonly<{
  instant: string;
  timezone: string;
  local: string;
  offset: string;
  source: RecurrenceSource;
  sequence: number;
}>;

export type RecurrenceBudgetUsage = Readonly<{
  iterations: number;
  ruleEvaluations: number;
  emitted: number;
  skipped: number;
}>;

export type RecurrenceExpansionResult =
  | Readonly<{
      status: 'ok';
      schedule: RecurrenceScheduleSpec;
      nextOccurrence: RecurrenceOccurrence | null;
      occurrences: RecurrenceOccurrence[];
      exhausted: boolean;
      budget: RecurrenceBudget;
      used: RecurrenceBudgetUsage;
    }>
  | Readonly<{
      status: 'refused';
      schedule: RecurrenceScheduleSpec;
      reason: string;
      nextOccurrence: null;
      occurrences: RecurrenceOccurrence[];
      exhausted: false;
      budget: RecurrenceBudget;
      used: RecurrenceBudgetUsage;
    }>;

export function isRecurrenceWeekday(value: unknown): value is RecurrenceWeekday {
  return typeof value === 'string' && (RECURRENCE_WEEKDAYS as readonly string[]).includes(value);
}

export function isRecurrenceSchedule(value: unknown): value is RecurrenceScheduleSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const schedule = value as Partial<RecurrenceScheduleSpec>;
  return schedule.schemaVersion === RECURRENCE_SCHEMA_VERSION
    && typeof schedule.timezone === 'string' && schedule.timezone.trim().length > 0
    && typeof schedule.anchor === 'string' && schedule.anchor.trim().length > 0
    && (schedule.dstPolicy === undefined || (RECURRENCE_DST_POLICIES as readonly string[]).includes(schedule.dstPolicy))
    && Array.isArray(schedule.rules) && schedule.rules.every(isRecurrenceRule)
    && (
      schedule.exclusions === undefined
      || (Array.isArray(schedule.exclusions) && schedule.exclusions.every((value) => typeof value === 'string'))
    )
    && (
      schedule.overrides === undefined
      || (Array.isArray(schedule.overrides) && schedule.overrides.every((value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)))
    );
}

function isRecurrenceRule(value: unknown): value is RecurrenceRuleSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rule = value as Partial<RecurrenceRuleSpec>;
  if (typeof rule.id !== 'string' || rule.id.trim().length === 0) return false;
  if (rule.kind === 'interval') {
    return typeof rule.every === 'number' && (rule.unit === 'day' || rule.unit === 'week' || rule.unit === 'month' || rule.unit === 'year');
  }
  if (rule.kind === 'weekday') {
    return typeof rule.every === 'number' && Array.isArray(rule.weekdays) && rule.weekdays.every(isRecurrenceWeekday);
  }
  if (rule.kind === 'monthday') {
    return typeof rule.every === 'number' && Array.isArray(rule.monthDays) && rule.monthDays.every((day) => typeof day === 'number');
  }
  return false;
}
