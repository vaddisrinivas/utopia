import { RRule } from 'rrule';
import { createMachine, getNextSnapshot, getInitialSnapshot } from 'xstate';
import jsonLogic from 'json-logic-js';

import { matchesWhere, sortByFields, applyQueryPagination, type QueryOptions, normalizeQueryOptions } from './query';
import type { AppPackage } from './schema';
import type { AppState, JsonRecord } from './runtime';

type Predicate = { op?: string; field?: string; value?: unknown; args?: Predicate[]; filter?: string };

function value(record: JsonRecord): Record<string, unknown> {
  return {
    ...record.values,
    id: record.id,
    collection: record.collection,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function matches(record: JsonRecord, predicate?: Predicate): boolean {
  if (!predicate) return true;
  return matchesWhere(predicate, value(record));
}

export function executeQuery(pkg: AppPackage, state: AppState, id: string): JsonRecord[] {
  const query = pkg.queries[id];
  if (!query) throw new Error(`Unknown query ${id}`);
  const normalized: QueryOptions = {
    ...(query as QueryOptions),
    orderBy: query.orderBy ?? [],
    where: query.where,
    limit: query.limit,
    offset: (query as QueryOptions).offset,
    savedFilters: (query as QueryOptions).savedFilters,
  };
  const prepared = normalizeQueryOptions(normalized);

  const rows = computedRecords(pkg, state)
    .filter((record) => record.collection === query.from)
    .map((record) => ({ record, queryValues: value(record) }))
    .filter((entry) => matchesWhere(prepared.where, entry.queryValues, prepared.savedFilters))
    .map((entry) => ({ ...entry.record, ...entry.queryValues })) as Record<string, unknown>[];

  return applyQueryPagination(sortByFields(rows, prepared.orderBy), prepared)
    .map((record) => record as JsonRecord);
}

type ObjectValue = Record<string, unknown>;

const read = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as ObjectValue)[key] : undefined, value);

const object = (value: unknown, error: string): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as ObjectValue;
};

const rows = (value: unknown): ObjectValue[] => {
  if (!Array.isArray(value) || value.length > 500 || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('expression_rows_invalid');
  }
  return value as ObjectValue[];
};

const recurrenceRule = (schedule: unknown, after: Date) => {
  if (typeof schedule === 'string') return RRule.fromString(schedule);
  const spec = object(schedule, 'expression_recurrence_invalid');
  const frequencies: Record<string, number> = {
    yearly: RRule.YEARLY, monthly: RRule.MONTHLY, weekly: RRule.WEEKLY,
    daily: RRule.DAILY, hourly: RRule.HOURLY, minutely: RRule.MINUTELY,
  };
  const freq = frequencies[String(spec.frequency)];
  if (freq == null) throw new Error('expression_recurrence_invalid');
  return new RRule({
    freq,
    interval: Number(spec.interval ?? 1),
    dtstart: spec.start ? new Date(String(spec.start)) : after,
    count: spec.count == null ? undefined : Number(spec.count),
    until: spec.until ? new Date(String(spec.until)) : undefined,
    byweekday: Array.isArray(spec.byWeekday)
      ? spec.byWeekday.map((day) => [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU][Number(day)]).filter(Boolean)
      : undefined,
  });
};

function evaluateDateDiff(spec: ObjectValue, context: unknown): number {
  const start = evaluateExpression(spec.start, context);
  const end = evaluateExpression(spec.end, context);
  const missing = start == null || start === '' || end == null || end === '';
  if (missing) {
    if (spec.onMissing === 'zero') return 0;
    throw new Error('expression_date_diff_missing');
  }
  const left = Date.parse(String(start));
  const right = Date.parse(String(end));
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    if (spec.onInvalid === 'zero') return 0;
    throw new Error('expression_date_diff_invalid');
  }
  if (right < left && spec.onEndBeforeStart === 'error') throw new Error('expression_date_diff_end_before_start');
  if (right < left && spec.onEndBeforeStart === 'zero') return 0;
  const units: ObjectValue = { seconds: 1_000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
  const divisor = Number(units[String(spec.unit)]);
  if (!divisor || spec.timezone !== 'UTC') throw new Error('expression_date_diff_spec_invalid');
  return Math.trunc((right - left) / divisor);
}

export function evaluateExpression(expression: unknown, context: unknown): unknown {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
    return Array.isArray(expression) ? expression.map((item) => evaluateExpression(item, context)) : expression;
  }
  const entries = Object.entries(expression as ObjectValue);
  if (entries.length !== 1) return Object.fromEntries(entries.map(([key, value]) => [key, evaluateExpression(value, context)]));
  const [operator, operand] = entries[0];
  if (operator === 'var') return read(context, String(operand));
  if (operator === 'date_diff') return evaluateDateDiff(object(operand, 'expression_date_diff_spec_invalid'), context);
  if (operator === 'group_sum') {
    const spec = object(operand, 'expression_group_sum_invalid');
    const expected = evaluateExpression(spec.equals, context);
    return rows(evaluateExpression(spec.rows, context))
      .filter((row) => JSON.stringify(read(row, String(spec.groupBy))) === JSON.stringify(expected))
      .reduce((sum, row) => sum + Number(read(row, String(spec.value)) ?? 0), 0);
  }
  if (operator === 'allocate_weighted') {
    const spec = object(operand, 'expression_allocate_weighted_invalid');
    const source = rows(evaluateExpression(spec.rows, context));
    const total = Number(evaluateExpression(spec.total, context));
    const weight = source.reduce((sum, row) => sum + Number(read(row, String(spec.weight)) ?? 0), 0);
    if (!weight) throw new Error('expression_allocate_weighted_invalid');
    return source.map((row) => ({ key: String(read(row, String(spec.key)) ?? ''), weight: String(read(row, String(spec.weight)) ?? 0), amount: String(total * Number(read(row, String(spec.weight)) ?? 0) / weight) }));
  }
  if (operator === 'balance_transfers') {
    const spec = object(operand, 'expression_balance_transfers_invalid');
    const balances = new Map<string, number>();
    for (const row of rows(evaluateExpression(spec.rows, context))) {
      const person = String(read(row, String(spec.participant)) ?? '');
      balances.set(person, (balances.get(person) ?? 0) + Number(read(row, String(spec.paid)) ?? 0) - Number(read(row, String(spec.owed)) ?? 0));
    }
    const debtors = [...balances].filter(([, amount]) => amount < 0).map(([person, amount]) => ({ person, amount: -amount }));
    const creditors = [...balances].filter(([, amount]) => amount > 0).map(([person, amount]) => ({ person, amount }));
    const transfers: ObjectValue[] = [];
    while (debtors.length && creditors.length) {
      const amount = Math.min(debtors[0].amount, creditors[0].amount);
      transfers.push({ from: debtors[0].person, to: creditors[0].person, amount: String(amount) });
      debtors[0].amount -= amount; creditors[0].amount -= amount;
      if (!debtors[0].amount) debtors.shift();
      if (!creditors[0].amount) creditors.shift();
    }
    return transfers;
  }
  if (operator === 'recurrence_next' || operator === 'recurrence_expand') {
    const spec = object(operand, `expression_${operator}_invalid`);
    const after = new Date(String(evaluateExpression(spec.after, context) ?? new Date().toISOString()));
    const rule = recurrenceRule(evaluateExpression(spec.schedule, context), after);
    if (operator === 'recurrence_next') return rule.after(after, false)?.toISOString() ?? null;
    const limit = Math.min(100, Number(evaluateExpression(spec.limit, context) ?? 20));
    const until = spec.until ? new Date(String(evaluateExpression(spec.until, context))) : new Date(after.getTime() + 366 * 86_400_000);
    return rule.between(after, until, false).slice(0, limit).map((date) => date.toISOString());
  }
  try {
    return jsonLogicApply(expression, context);
  } catch {
    throw new Error(`unsupported_expression_operator:${operator}`);
  }
}

function jsonLogicApply(expression: unknown, context: unknown): unknown {
  return jsonLogic.apply(expression as never, context);
}

export function computedRecords(pkg: AppPackage, state: AppState): JsonRecord[] {
  if (!pkg.computedFields.length) return state.records;
  const queryContext = Object.fromEntries(Object.entries(pkg.queries).map(([id, query]) => [
    id,
    { rows: state.records.filter((record) => record.collection === query.from).map((record) => ({ id: record.id, ...record.values })) },
  ]));
  return state.records.map((record) => {
    const values = { ...record.values };
    for (const field of pkg.computedFields.filter((item) => item.collection === record.collection)) {
      values[field.id] = evaluateExpression(field.expression, { record: { id: record.id, ...values }, queries: queryContext });
    }
    return { ...record, values };
  });
}

export function recurrence(rule: string, after: Date, count = 20): Date[] {
  return RRule.fromString(rule).all((date, index) => date >= after && index < count);
}

export type WorkflowDefinition = {
  initial: string;
  states: Record<string, { on?: Record<string, string> }>;
};

export function workflow(definition: WorkflowDefinition) {
  const machine = createMachine(definition);
  return {
    initial: () => getInitialSnapshot(machine).value,
    transition: (state: string, event: string) =>
      getNextSnapshot(machine, machine.resolveState({ value: state, context: {} }), { type: event }).value,
  };
}
