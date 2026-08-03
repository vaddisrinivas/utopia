import { RRule, type Options as RRuleOptions } from 'rrule';

import {
  RECURRENCE_WEEKDAYS,
  type RecurrenceBudget,
  type RecurrenceBudgetUsage,
  type RecurrenceExpansionResult,
  type RecurrenceOccurrence,
  type RecurrenceRuleSpec,
  type RecurrenceRuleUnit,
  type RecurrenceScheduleOverride,
  type RecurrenceScheduleSpec,
  type RecurrenceWeekday,
  isRecurrenceSchedule,
} from '@/packages/shared/contracts/recurrence';

const DEFAULT_RECURRENCE_BUDGET: RecurrenceBudget = {
  maxOccurrences: 64,
  maxIterations: 512,
  maxRuleEvaluations: 1_024,
  maxLookaheadDays: 3650,
  maxExclusions: 128,
  maxOverrides: 128,
};

type RecurrenceStream = {
  id: string;
  kind: RecurrenceRuleSpec['kind'] | 'override';
  rule?: RRule;
  nextLocal?: Date | null;
  timezone?: string;
  next: Date | null;
  sourceRuleIds: string[];
  ruleKind?: RecurrenceRuleSpec['kind'];
};

type NormalizedOverride = {
  id: string;
  at: Date;
  replaceWith?: Date;
  cancelled: boolean;
};

type MutableBudgetUsage = {
  iterations: number;
  ruleEvaluations: number;
  emitted: number;
  skipped: number;
};

export function normalizeRecurrenceSchedule(input: unknown): RecurrenceScheduleSpec {
  if (!isRecurrenceSchedule(input)) {
    throw new Error('recurrence_schedule_invalid');
  }
  if (!validateTimezone(input.timezone)) {
    throw new Error(`recurrence_timezone_invalid:${input.timezone}`);
  }
  if (!parseInstant(input.anchor)) {
    throw new Error('recurrence_anchor_invalid');
  }
  if (!input.rules.length) {
    throw new Error('recurrence_rules_required');
  }

  const seen = new Set<string>();
  for (const rule of input.rules) {
    if (seen.has(rule.id)) {
      throw new Error(`recurrence_rule_duplicate:${rule.id}`);
    }
    seen.add(rule.id);
    validateRule(rule);
  }
  if (input.exclusions) {
    for (const exclusion of input.exclusions) {
      if (!parseInstant(exclusion)) throw new Error(`recurrence_exclusion_invalid:${exclusion}`);
    }
  }
  if (input.overrides) {
    for (const override of input.overrides) {
      validateOverride(override);
    }
  }
  return input;
}

export function expandRecurrenceSchedule(input: {
  schedule: unknown;
  after?: unknown;
  until?: unknown;
  limit?: number;
  budget?: Partial<RecurrenceBudget>;
}): RecurrenceExpansionResult {
  const schedule = normalizeRecurrenceSchedule(input.schedule);
  const after = normalizeCursor(input.after ?? schedule.anchor);
  const until = input.until === undefined ? undefined : normalizeCursor(input.until);
  const budget = { ...DEFAULT_RECURRENCE_BUDGET, ...(input.budget ?? {}) };
  const limit = input.limit ?? budget.maxOccurrences;

  if (!Number.isInteger(limit) || limit < 1) {
    return refusal(schedule, budget, 'recurrence_limit_invalid');
  }
  if (limit > budget.maxOccurrences) {
    return refusal(schedule, budget, 'recurrence_limit_exceeds_budget');
  }
  if (!isValidBudget(budget)) {
    return refusal(schedule, budget, 'recurrence_budget_invalid');
  }
  if ((schedule.exclusions?.length ?? 0) > budget.maxExclusions) {
    return refusal(schedule, budget, 'recurrence_exclusion_budget_exceeded');
  }
  if ((schedule.overrides?.length ?? 0) > budget.maxOverrides) {
    return refusal(schedule, budget, 'recurrence_override_budget_exceeded');
  }

  const horizon = until ?? addDays(after, budget.maxLookaheadDays);
  const anchorInstant = parseInstant(schedule.anchor)!;
  const expectedLocalTime = formatLocalTime(anchorInstant, schedule.timezone);
  const overrides = normalizeOverrides(schedule.overrides ?? []);
  const exclusionSet = new Set([
    ...(schedule.exclusions ?? []).map((value) => parseInstant(value)!.toISOString()),
    ...overrides.filter((override) => Boolean(override.replaceWith)).map((override) => override.at.toISOString()),
  ]);
  const streams = buildStreams(schedule, after, overrides);
  const emitted: RecurrenceOccurrence[] = [];
  const used: MutableBudgetUsage = { iterations: 0, ruleEvaluations: 0, emitted: 0, skipped: 0 };

  let cursor = after;
  while (used.emitted < limit) {
    used.iterations += 1;
    if (used.iterations > budget.maxIterations) {
      return refusal(schedule, budget, 'recurrence_iteration_budget_exceeded', emitted, used);
    }

    const candidate = nextCandidate(streams, overrides, cursor);
    if (!candidate) break;
    if (candidate.date > horizon) break;

    used.ruleEvaluations += candidate.evaluations;
    if (used.ruleEvaluations > budget.maxRuleEvaluations) {
      return refusal(schedule, budget, 'recurrence_rule_evaluation_budget_exceeded', emitted, used);
    }

    if (exclusionSet.has(candidate.date.toISOString()) || candidate.skip) {
      used.skipped += 1;
      advanceStreams(streams, candidate.date);
      cursor = candidate.date;
      continue;
    }

    const local = formatLocalInstant(candidate.date, schedule.timezone);
    if (schedule.dstPolicy === 'skip' && local.time !== expectedLocalTime.time) {
      used.skipped += 1;
      advanceStreams(streams, candidate.date);
      cursor = candidate.date;
      continue;
    }

    emitted.push({
      instant: candidate.date.toISOString(),
      timezone: schedule.timezone,
      local: local.local,
      offset: local.offset,
      source: {
        kind: candidate.kind,
        ids: candidate.ids,
        ...(candidate.ruleKinds.length ? { ruleKinds: candidate.ruleKinds } : {}),
      },
      sequence: emitted.length,
    });
    used.emitted += 1;
    advanceStreams(streams, candidate.date);
    cursor = candidate.date;
  }

  return {
    status: 'ok',
    schedule,
    nextOccurrence: emitted[0] ?? null,
    occurrences: emitted,
    exhausted: emitted.length < limit && !hasAnyFutureCandidate(streams, overrides, cursor, horizon),
    budget,
    used,
  };
}

export function nextRecurrenceOccurrence(input: {
  schedule: unknown;
  after?: unknown;
  budget?: Partial<RecurrenceBudget>;
}): RecurrenceOccurrence | null {
  const result = expandRecurrenceSchedule({
    schedule: input.schedule,
    after: input.after,
    limit: 1,
    budget: input.budget,
  });
  return result.status === 'ok' ? result.nextOccurrence : null;
}

export function recurrenceScheduleSummary(scheduleInput: unknown): RecurrenceScheduleSpec {
  return normalizeRecurrenceSchedule(scheduleInput);
}

function buildStreams(schedule: RecurrenceScheduleSpec, after: Date, overrides: NormalizedOverride[]): RecurrenceStream[] {
  const streams: RecurrenceStream[] = schedule.rules.map((rule) => {
    const ruleInstance = buildRule(schedule, rule);
    const nextLocal = ruleInstance.after(toRRuleLocalDate(after, schedule.timezone), false);
    return {
      id: rule.id,
      kind: rule.kind,
      rule: ruleInstance,
      nextLocal,
      timezone: schedule.timezone,
      next: nextLocal ? fromRRuleLocalDate(nextLocal, schedule.timezone) : null,
      sourceRuleIds: [rule.id],
      ruleKind: rule.kind,
    };
  });

  for (const override of overrides) {
    if (override.cancelled || !override.replaceWith) continue;
    if (override.replaceWith <= after) continue;
    streams.push({
      id: override.id,
      kind: 'override',
      next: override.replaceWith,
      sourceRuleIds: [override.id],
    });
  }

  return streams;
}

function nextCandidate(
  streams: RecurrenceStream[],
  overrides: NormalizedOverride[],
  cursor: Date,
): { date: Date; kind: 'rule' | 'override'; ids: string[]; ruleKinds: RecurrenceRuleSpec['kind'][]; skip: boolean; evaluations: number } | null {
  let earliest: Date | null = null;
  for (const stream of streams) {
    if (!stream.next || stream.next <= cursor) continue;
    if (!earliest || stream.next < earliest) earliest = stream.next;
  }
  if (!earliest) return null;

  const matchingStreams = streams.filter((stream) => stream.next && stream.next.getTime() === earliest!.getTime());
  const matchingOverrides = overrides.filter((override) => override.at.getTime() === earliest!.getTime());
  const ids = [...new Set([
    ...matchingStreams.flatMap((stream) => stream.sourceRuleIds),
    ...matchingOverrides.map((override) => override.id),
  ])].sort();
  const ruleKinds = [...new Set(matchingStreams.flatMap((stream) => stream.ruleKind ? [stream.ruleKind] : []))];
  const skip = matchingOverrides.some((override) => override.cancelled);
  return {
    date: earliest,
    kind: matchingOverrides.length && !matchingStreams.length ? 'override' : 'rule',
    ids,
    ruleKinds,
    skip,
    evaluations: matchingStreams.length,
  };
}

function advanceStreams(streams: RecurrenceStream[], date: Date): void {
  const instant = date.getTime();
  for (const stream of streams) {
    if (!stream.next || stream.next.getTime() !== instant) continue;
    if (stream.rule) {
      stream.nextLocal = stream.nextLocal ? stream.rule.after(stream.nextLocal, false) : null;
      stream.next = stream.nextLocal && stream.timezone
        ? fromRRuleLocalDate(stream.nextLocal, stream.timezone)
        : null;
    } else if (stream.kind === 'override') {
      stream.next = null;
    }
  }
}

function hasAnyFutureCandidate(streams: RecurrenceStream[], overrides: NormalizedOverride[], cursor: Date, horizon: Date): boolean {
  return streams.some((stream) => stream.next && stream.next > cursor && stream.next <= horizon)
    || overrides.some((override) => override.replaceWith && override.replaceWith > cursor && override.replaceWith <= horizon && !override.cancelled);
}

function buildRule(schedule: RecurrenceScheduleSpec, rule: RecurrenceRuleSpec): RRule {
  const anchorInstant = parseInstant(schedule.anchor)!;
  const options = {
    // RRule with tzid expects UTC fields to carry the intended local wall time.
    // Passing the real instant makes recurrence output depend on the host timezone.
    dtstart: toRRuleLocalDate(anchorInstant, schedule.timezone),
    tzid: null,
    interval: rule.every,
    wkst: null,
    count: null,
    until: null,
    bysetpos: null,
    bymonth: null,
    bymonthday: null,
    bynmonthday: null,
    byyearday: null,
    byweekno: null,
    byweekday: null,
    bynweekday: null,
    byhour: null,
    byminute: null,
    bysecond: null,
    byeaster: null,
  } as RRuleOptions;

  switch (rule.kind) {
    case 'interval':
      options.freq = ruleUnitToFreq(rule.unit);
      break;
    case 'weekday':
      options.freq = RRule.WEEKLY;
      options.byweekday = rule.weekdays.map((weekday) => weekdayToRRule(weekday));
      break;
    case 'monthday':
      options.freq = RRule.MONTHLY;
      options.bymonthday = [...rule.monthDays];
      break;
  }

  return new RRule(options);
}

function toRRuleLocalDate(date: Date, timezone: string): Date {
  const { local } = formatLocalInstant(date, timezone);
  return new Date(`${local}Z`);
}

function fromRRuleLocalDate(localDate: Date, timezone: string): Date {
  const desiredWallTime = localDate.getTime();
  const offsets = new Set<number>();
  for (const deltaHours of [-36, 0, 36]) {
    const sample = new Date(desiredWallTime + (deltaHours * 60 * 60 * 1000));
    offsets.add(offsetToMilliseconds(formatLocalInstant(sample, timezone).offset));
  }

  const candidates = [...offsets].map((offset) => {
    const instant = new Date(desiredWallTime - offset);
    return {
      instant,
      wallTime: toRRuleLocalDate(instant, timezone).getTime(),
    };
  });
  const exact = candidates
    .filter((candidate) => candidate.wallTime === desiredWallTime)
    .sort((left, right) => left.instant.getTime() - right.instant.getTime());
  if (exact.length) return exact[0]!.instant;

  // Compatible DST-gap behavior moves forward by the size of the gap.
  const afterGap = candidates
    .filter((candidate) => candidate.wallTime > desiredWallTime)
    .sort((left, right) => left.wallTime - right.wallTime || left.instant.getTime() - right.instant.getTime());
  if (afterGap.length) return afterGap[0]!.instant;

  return candidates.sort((left, right) => right.wallTime - left.wallTime)[0]!.instant;
}

function offsetToMilliseconds(offset: string): number {
  const match = /^(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2})$/.exec(offset);
  if (!match?.groups) return 0;
  const minutes = (Number(match.groups.hours) * 60) + Number(match.groups.minutes);
  return (match.groups.sign === '-' ? -1 : 1) * minutes * 60 * 1000;
}

function validateRule(rule: RecurrenceRuleSpec): void {
  if (rule.kind === 'interval') {
    if (!Number.isInteger(rule.every) || rule.every < 1) throw new Error(`recurrence_rule_invalid:${rule.id}:every`);
    if (!['day', 'week', 'month', 'year'].includes(rule.unit)) throw new Error(`recurrence_rule_invalid:${rule.id}:unit`);
    return;
  }
  if (rule.kind === 'weekday') {
    if (!Number.isInteger(rule.every) || rule.every < 1) throw new Error(`recurrence_rule_invalid:${rule.id}:every`);
    if (!Array.isArray(rule.weekdays) || !rule.weekdays.length || !rule.weekdays.every((weekday) => RECURRENCE_WEEKDAYS.includes(weekday))) {
      throw new Error(`recurrence_rule_invalid:${rule.id}:weekdays`);
    }
    return;
  }
  if (rule.kind === 'monthday') {
    if (!Number.isInteger(rule.every) || rule.every < 1) throw new Error(`recurrence_rule_invalid:${rule.id}:every`);
    if (!Array.isArray(rule.monthDays) || !rule.monthDays.length || !rule.monthDays.every((day) => Number.isInteger(day) && day >= 1 && day <= 31)) {
      throw new Error(`recurrence_rule_invalid:${rule.id}:monthDays`);
    }
    return;
  }
  throw new Error('recurrence_rule_invalid');
}

function validateOverride(override: RecurrenceScheduleOverride): void {
  if (!override || typeof override !== 'object') throw new Error('recurrence_override_invalid');
  if (!parseInstant(override.at)) throw new Error('recurrence_override_at_invalid');
  if (override.replaceWith !== undefined && !parseInstant(override.replaceWith)) throw new Error('recurrence_override_replace_invalid');
  if (override.cancelled !== undefined && typeof override.cancelled !== 'boolean') throw new Error('recurrence_override_cancelled_invalid');
}

function normalizeOverrides(overrides: readonly RecurrenceScheduleOverride[]): NormalizedOverride[] {
  return overrides
    .map((override, index) => ({
      id: `override:${index + 1}`,
      at: parseInstant(override.at)!,
      replaceWith: override.replaceWith ? parseInstant(override.replaceWith)! : undefined,
      cancelled: override.cancelled ?? false,
    }))
    .sort((left, right) => left.at.getTime() - right.at.getTime() || left.id.localeCompare(right.id));
}

function ruleUnitToFreq(unit: RecurrenceRuleUnit): number {
  switch (unit) {
    case 'day':
      return RRule.DAILY;
    case 'week':
      return RRule.WEEKLY;
    case 'month':
      return RRule.MONTHLY;
    case 'year':
      return RRule.YEARLY;
    default:
      return RRule.DAILY;
  }
}

function weekdayToRRule(weekday: RecurrenceWeekday): any {
  switch (weekday) {
    case 'sun':
      return RRule.SU;
    case 'mon':
      return RRule.MO;
    case 'tue':
      return RRule.TU;
    case 'wed':
      return RRule.WE;
    case 'thu':
      return RRule.TH;
    case 'fri':
      return RRule.FR;
    case 'sat':
      return RRule.SA;
  }
}

function normalizeCursor(value: unknown): Date {
  const instant = parseInstant(value);
  if (!instant) throw new Error('recurrence_cursor_invalid');
  return instant;
}

function parseInstant(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function formatLocalInstant(date: Date, timezone: string): { local: string; time: string; offset: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'iso8601',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    local,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset: normalizeOffset(parts.timeZoneName ?? 'GMT'),
  };
}

function formatLocalTime(date: Date, timezone: string): { local: string; time: string } {
  const { local, time } = formatLocalInstant(date, timezone);
  return { local, time };
}

function normalizeOffset(value: string): string {
  const match = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(value);
  if (!match || !match.groups?.sign) return '+00:00';
  const sign = match.groups.sign;
  const hours = match.groups.hours?.padStart(2, '0') ?? '00';
  const minutes = match.groups.minutes ?? '00';
  return `${sign}${hours}:${minutes}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
}

function isValidBudget(budget: RecurrenceBudget): boolean {
  return Number.isInteger(budget.maxOccurrences) && budget.maxOccurrences > 0
    && Number.isInteger(budget.maxIterations) && budget.maxIterations > 0
    && Number.isInteger(budget.maxRuleEvaluations) && budget.maxRuleEvaluations > 0
    && Number.isInteger(budget.maxLookaheadDays) && budget.maxLookaheadDays >= 0
    && Number.isInteger(budget.maxExclusions) && budget.maxExclusions >= 0
    && Number.isInteger(budget.maxOverrides) && budget.maxOverrides >= 0;
}

function refusal(
  schedule: RecurrenceScheduleSpec,
  budget: RecurrenceBudget,
  reason: string,
  occurrences: RecurrenceOccurrence[] = [],
  used: RecurrenceBudgetUsage = { iterations: 0, ruleEvaluations: 0, emitted: 0, skipped: 0 },
): RecurrenceExpansionResult {
  return {
    status: 'refused',
    schedule,
    reason,
    nextOccurrence: null,
    occurrences,
    exhausted: false,
    budget,
    used,
  };
}
