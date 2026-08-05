import { RRule } from 'rrule';
import jsonLogic from 'json-logic-js';

import type { AppPackage } from './schema';
import type { AppState, JsonRecord } from './runtime';

type Budget = { steps: number };
type Decimal = { value: bigint; scale: number; };
type QueryRows = Record<string, { rows: JsonRow[] }>;
type JsonRow = Record<string, unknown>;
type ObjectRecord = Record<string, unknown>;
type ComputedExpression = { id: string; collection: string; dependsOn: string[]; expression: unknown };
type JsonValue = unknown;

type DecimalLike = Decimal | null;

type ComputedContext = {
  record: Record<string, unknown> & { id: string };
  queries: QueryRows;
};

type BalanceTransferRow = { from: string; to: string; amount: string };
type AllocationRow = Record<string, string>;

const MAX_WORK = 500;
const MAX_DECIMAL_SCALE = 18;
const WEEKDAY_MAP: ReadonlyArray<number> = [Number(RRule.SU), Number(RRule.MO), Number(RRule.TU), Number(RRule.WE), Number(RRule.TH), Number(RRule.FR), Number(RRule.SA)];

const FREQUENCY_BY_NAME: Record<string, number> = {
  yearly: RRule.YEARLY,
  monthly: RRule.MONTHLY,
  weekly: RRule.WEEKLY,
  daily: RRule.DAILY,
  hourly: RRule.HOURLY,
  minutely: RRule.MINUTELY,
};

const DATE_UNITS: Record<string, number> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

const MATH_OPERATORS = new Set(['+', '-', '*', '/', '%']);

const isObject = (value: JsonValue): value is ObjectRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const consume = (value: JsonValue, budget: Budget): void => {
  budget.steps += 1;
  if (budget.steps > MAX_WORK) throw new Error('expression_budget_exceeded');
  if (Array.isArray(value)) {
    value.forEach((item) => consume(item, budget));
    return;
  }
  if (isObject(value)) {
    for (const entry of Object.values(value)) consume(entry, budget);
  }
};

const read = (value: JsonValue, path: string): JsonValue =>
  path
    .split('.')
    .reduce<JsonValue>((current, key) => {
      if (current == null) return undefined;
      if (Array.isArray(current)) {
        const index = Number(key);
        return Number.isInteger(index) ? current[index] : undefined;
      }
      return isObject(current) ? current[key] : undefined;
    }, value);

const object = (value: JsonValue, error: string): ObjectRecord => {
  if (!isObject(value)) throw new Error(error);
  return value;
};

const readRows = (value: JsonValue): JsonRow[] => {
  if (!Array.isArray(value) || value.length > MAX_WORK || value.some((row) => !isObject(row))) {
    throw new Error('expression_rows_invalid');
  }
  return value as JsonRow[];
};

const decimalFromNumber = (value: number): Decimal => {
  if (!Number.isFinite(value)) throw new Error('expression_number_invalid');
  const text = value.toString();
  return parseDecimal(text) ?? { value: BigInt(Math.trunc(value)), scale: 0 };
};

const parseDecimal = (value: JsonValue): DecimalLike => {
  if (value == null || value === false) return null;
  if (value === true) return { value: 1n, scale: 0 };
  if (typeof value === 'number') return decimalFromNumber(value);
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const match = /^[+-]?(?:\d+|\d*\.\d+)$/;
  if (!match.test(normalized)) return null;

  const signed = normalized;
  const isNegative = signed.startsWith('-');
  const unsigned = isNegative || signed.startsWith('+') ? signed.slice(1) : signed;
  const [integerPartRaw = '0', fractionRaw = ''] = unsigned.split('.');

  if (!integerPartRaw && !fractionRaw) return null;
  if (integerPartRaw.length > 20 || fractionRaw.length > MAX_DECIMAL_SCALE) return null;

  if (!/^\d*$/.test(integerPartRaw) || !/^\d*$/.test(fractionRaw)) return null;

  const removed = `${integerPartRaw || '0'}${fractionRaw}`;
  const valueBig = removed ? BigInt(`${isNegative ? '-' : ''}${removed}`) : 0n;
  const scale = fractionRaw.length;
  return normalizeDecimal({ value: valueBig, scale });
};

const pow10 = (scale: number): bigint => 10n ** BigInt(Math.max(0, scale));

const normalizeDecimal = (input: Decimal): Decimal => {
  let value = input.value;
  let scale = input.scale;
  if (scale <= 0) return { value, scale: 0 };
  while (scale > 0 && value % 10n === 0n) {
    value /= 10n;
    scale -= 1;
  }
  return { value, scale };
};

const alignScale = (left: Decimal, right: Decimal): [Decimal, Decimal] => {
  if (left.scale === right.scale) return [left, right];
  if (left.scale > right.scale) {
    const factor = pow10(left.scale - right.scale);
    return [left, { value: right.value * factor, scale: left.scale }];
  }
  const factor = pow10(right.scale - left.scale);
  return [{ value: left.value * factor, scale: right.scale }, right];
};

const decimalAdd = (left: Decimal, right: Decimal): Decimal => {
  const [a, b] = alignScale(left, right);
  return normalizeDecimal({ value: a.value + b.value, scale: a.scale });
};

const decimalSub = (left: Decimal, right: Decimal): Decimal => {
  const [a, b] = alignScale(left, right);
  return normalizeDecimal({ value: a.value - b.value, scale: a.scale });
};

const decimalMul = (left: Decimal, right: Decimal): Decimal => {
  const scale = Math.min(MAX_DECIMAL_SCALE, left.scale + right.scale);
  let value = left.value * right.value;
  const rawScale = left.scale + right.scale;
  if (rawScale > scale) {
    value /= pow10(rawScale - scale);
  }
  return normalizeDecimal({ value, scale });
};

const decimalDiv = (left: Decimal, right: Decimal, budget: Budget): Decimal => {
  if (right.value === 0n) throw new Error('expression_divide_by_zero');
  if (left.value === 0n) return { value: 0n, scale: 0 };

  const targetScale = Math.min(MAX_DECIMAL_SCALE, Math.max(9, left.scale, right.scale) + 6);
  const numerator = left.value * pow10(targetScale + right.scale);
  const value = numerator / right.value;
  return normalizeDecimal({ value, scale: targetScale + left.scale - right.scale });
};

const decimalMod = (left: Decimal, right: Decimal): Decimal => {
  if (right.value === 0n) throw new Error('expression_divide_by_zero');
  const [a, b] = alignScale(left, right);
  return normalizeDecimal({ value: a.value % b.value, scale: a.scale });
};

const decimalToString = ({ value, scale }: Decimal): string => {
  if (scale <= 0) return value.toString();
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const unit = pow10(scale);
  const integer = absolute / unit;
  const fraction = (absolute % unit).toString().padStart(scale, '0').replace(/0+$/, '');
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
};

const parseDate = (value: JsonValue): number => {
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new Error('expression_date_diff_invalid');
  return parsed;
};

const sameValue = (left: JsonValue, right: JsonValue): boolean => JSON.stringify(left) === JSON.stringify(right);

const toNumeric = (value: JsonValue): number => {
  if (typeof value === 'number') return value;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const evaluateDateDiff = (spec: ObjectRecord, context: ComputedContext, budget: Budget): number => {
  const start = evaluate(spec.start, context, budget);
  const end = evaluate(spec.end, context, budget);

  if (start == null || end == null || start === '' || end === '') {
    if (spec.onMissing === 'zero') return 0;
    throw new Error('expression_date_diff_missing');
  }

  let left = parseDate(start);
  let right = parseDate(end);
  const onInvalid = String(spec.onInvalid ?? 'error');

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    if (onInvalid === 'zero') return 0;
    throw new Error('expression_date_diff_invalid');
  }

  if (right < left && spec.onEndBeforeStart === 'error') throw new Error('expression_date_diff_end_before_start');
  if (right < left && spec.onEndBeforeStart === 'zero') return 0;

  const unit = String(spec.unit ?? 'days');
  const divisor = DATE_UNITS[unit];
  if (!divisor || String(spec.timezone) !== 'UTC') throw new Error('expression_date_diff_spec_invalid');
  return Math.floor((right - left) / divisor);
};

const parseWeekday = (value: JsonValue): number | undefined => {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > 6) return;
  return WEEKDAY_MAP[index];
};

const buildRecurrence = (schedule: JsonValue, after: Date): RRule => {
  if (typeof schedule === 'string') return RRule.fromString(schedule);

  const spec = object(schedule, 'expression_recurrence_invalid');
  const frequency = FREQUENCY_BY_NAME[String(spec.frequency)];
  if (!frequency) throw new Error('expression_recurrence_invalid');

  const byweekday = Array.isArray(spec.byWeekday)
    ? spec.byWeekday
      .map(parseWeekday)
      .filter((item): item is number => item !== undefined)
      .map((weekday) => WEEKDAY_MAP[weekday] as number)
    : undefined;

  const interval = Math.max(1, Number(spec.interval ?? 1));
  const count = spec.count == null ? undefined : Number(spec.count);

  return new RRule({
    freq: frequency,
    interval,
    dtstart: spec.start ? new Date(String(spec.start)) : after,
    count: Number.isFinite(count) ? count : undefined,
    until: spec.until ? new Date(String(spec.until)) : undefined,
    byweekday,
  });
};

const evaluateGroupSum = (operand: JsonValue, context: ComputedContext, budget: Budget): JsonValue => {
  const spec = object(operand, 'expression_group_sum_invalid');
  const rows = readRows(evaluate(spec.rows, context, budget));
  const expected = evaluate(spec.equals, context, budget);
  const groupBy = String(spec.groupBy);
  const valueKey = String(spec.value);

  let total: DecimalLike = null;
  let totalNumber = 0;
  let usedDecimal = false;

  for (const row of rows) {
    if (!sameValue(read(row, groupBy), expected)) continue;
    const raw = read(row, valueKey);
    const parsed = parseDecimal(raw);
    if (parsed) {
      usedDecimal = true;
      total = total ? decimalAdd(total, parsed) : parsed;
      continue;
    }

    const numberValue = toNumeric(raw);
    totalNumber += numberValue;
  }

  if (!usedDecimal) return totalNumber;
  return decimalToString(decimalAdd(total ?? { value: 0n, scale: 0 }, parseDecimal(String(totalNumber)) ?? { value: 0n, scale: 0 }));
};

const evaluateAllocation = (operand: JsonValue, context: ComputedContext, budget: Budget): AllocationRow[] => {
  const spec = object(operand, 'expression_allocate_weighted_invalid');
  const rows = readRows(evaluate(spec.rows, context, budget));
  if (!rows.length) throw new Error('expression_allocate_weighted_invalid');

  const keyKey = String(spec.key);
  const weightKey = String(spec.weight);
  const amountKey = String(spec.amount ?? 'amount');
  const total = parseDecimal(evaluate(spec.total, context, budget));
  if (!total) throw new Error('expression_allocate_weighted_invalid');

  const totalWeight = rows
    .map((row) => parseDecimal(read(row, weightKey)))
    .reduce<Decimal | undefined>((acc, item) => (item ? (acc ? decimalAdd(acc, item) : item) : undefined), undefined);

  if (!totalWeight || totalWeight.value === 0n) throw new Error('expression_allocate_weighted_invalid');

  return rows.map((row) => {
    const weight = parseDecimal(read(row, weightKey));
    if (!weight) throw new Error('expression_allocate_weighted_invalid');
    const share = decimalDiv(decimalMul(total, weight), totalWeight, budget);
    return {
      [keyKey]: String(read(row, keyKey) ?? ''),
      [weightKey]: decimalToString(weight),
      [amountKey]: decimalToString(share),
    };
  });
};

const evaluateBalanceTransfers = (operand: JsonValue, context: ComputedContext, budget: Budget): BalanceTransferRow[] => {
  const spec = object(operand, 'expression_balance_transfers_invalid');
  const rows = readRows(evaluate(spec.rows, context, budget));

  const participantKey = String(spec.participant);
  const paidKey = String(spec.paid);
  const owedKey = String(spec.owed);

  const balances = new Map<string, Decimal>();
  for (const row of rows) {
    const participant = String(read(row, participantKey) ?? '');
    const paid = parseDecimal(read(row, paidKey));
    const owed = parseDecimal(read(row, owedKey));

    const paidDecimal = paid ?? decimalFromNumber(toNumeric(read(row, paidKey)));
    const owedDecimal = owed ?? decimalFromNumber(toNumeric(read(row, owedKey)));

    const current = balances.get(participant) ?? { value: 0n, scale: 0 };
    balances.set(participant, decimalSub(decimalAdd(current, paidDecimal), owedDecimal));
  }

  const debtors = [...balances.entries()]
    .filter(([, amount]) => amount.value < 0n)
    .map(([person, amount]) => ({ person, amount: { ...amount, value: -amount.value } }));
  const creditors = [...balances.entries()]
    .filter(([, amount]) => amount.value > 0n)
    .map(([person, amount]) => ({ person, amount }));

  const transfers: BalanceTransferRow[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    const amount: Decimal = debtor.amount.value >= creditor.amount.value
      ? creditor.amount
      : debtor.amount;

    if (amount.value > 0n) {
      transfers.push({ from: debtor.person, to: creditor.person, amount: decimalToString(amount) });
    }

    const remainingDebtor = decimalSub(debtor.amount, amount);
    const remainingCreditor = decimalSub(creditor.amount, amount);

    if (remainingDebtor.value === 0n) {
      debtorIndex += 1;
    } else {
      debtors[debtorIndex] = { ...debtor, amount: remainingDebtor };
    }

    if (remainingCreditor.value === 0n) {
      creditorIndex += 1;
    } else {
      creditors[creditorIndex] = { ...creditor, amount: remainingCreditor };
    }
  }

  return transfers;
};

const evaluateRecurrence = (operator: 'recurrence_next' | 'recurrence_expand', operand: JsonValue, context: ComputedContext, budget: Budget): JsonValue => {
  const spec = object(operand, `expression_${operator}_invalid`);
  const after = new Date(String(evaluate(spec.after, context, budget) ?? new Date().toISOString()));
  const rule = buildRecurrence(evaluate(spec.schedule, context, budget), after);

  if (operator === 'recurrence_next') {
    return rule.after(after, false)?.toISOString() ?? null;
  }

  const until = spec.until ? new Date(String(evaluate(spec.until, context, budget))) : undefined;
  const limit = Math.min(MAX_WORK, Number(evaluate(spec.limit, context, budget) ?? 20));
  return rule
    .between(after, until ?? new Date(after.getTime() + (MAX_WORK * 86_400_000)), false)
    .slice(0, limit)
    .map((date) => date.toISOString());
};

const evalMath = (operator: string, args: unknown[], context: ComputedContext, budget: Budget): JsonValue => {
  if (!args.length) return operator === '-' ? 0 : 1;
  const values = args.map((item) => evaluate(item, context, budget));
  const first = values[0] as JsonValue;

  const toDecimalOrNumber = (raw: unknown): DecimalLike => parseDecimal(raw);

  if (values.length === 1 && operator === '-') {
    const unary = toDecimalOrNumber(first);
    if (unary) return decimalToString({ ...unary, value: -unary.value });
    return -toNumeric(first);
  }

  return values.slice(1).reduce<JsonValue>((accumulator, currentArg) => {
    const leftDecimal = toDecimalOrNumber(accumulator);
    const rightDecimal = toDecimalOrNumber(currentArg);

    if (leftDecimal && rightDecimal) {
      const handlers = {
        '+': () => decimalToString(decimalAdd(leftDecimal, rightDecimal)),
        '-': () => decimalToString(decimalSub(leftDecimal, rightDecimal)),
        '*': () => decimalToString(decimalMul(leftDecimal, rightDecimal)),
        '/': () => decimalToString(decimalDiv(leftDecimal, rightDecimal, budget)),
        '%': () => decimalToString(decimalMod(leftDecimal, rightDecimal)),
      };
      return handlers[operator as keyof typeof handlers]();
    }

    const lhs = leftDecimal ? Number(leftDecimal.value) / Number(pow10(leftDecimal.scale)) : toNumeric(accumulator);
    const rhs = rightDecimal ? Number(rightDecimal.value) / Number(pow10(rightDecimal.scale)) : toNumeric(currentArg);

    const handlers = {
      '+': lhs + rhs,
      '-': lhs - rhs,
      '*': lhs * rhs,
      '/': rhs === 0 ? null : lhs / rhs,
      '%': lhs % rhs,
    };
    return handlers[operator as keyof typeof handlers];
  }, first);
};

const resolveMath = (operator: string, operand: unknown, context: ComputedContext, budget: Budget) => {
  if (!Array.isArray(operand)) return operator === '-' ? 0 : 1;
  return evalMath(operator, operand, context, budget);
};

const evaluateByOperator: Record<string, (operand: JsonValue, context: ComputedContext, budget: Budget) => JsonValue> = {
  var: (operand, context) => read(context, String(operand)),
  date_diff: (operand, context, budget) => evaluateDateDiff(object(operand, 'expression_date_diff_spec_invalid'), context, budget),
  group_sum: (operand, context, budget) => evaluateGroupSum(operand, context, budget),
  allocate_weighted: (operand, context, budget) => evaluateAllocation(operand, context, budget),
  balance_transfers: (operand, context, budget) => evaluateBalanceTransfers(operand, context, budget),
  recurrence_next: (operand, context, budget) => evaluateRecurrence('recurrence_next', operand, context, budget),
  recurrence_expand: (operand, context, budget) => evaluateRecurrence('recurrence_expand', operand, context, budget),
};

const dependsOnFromExpression = (expression: JsonValue): string[] => {
  const deps = new Set<string>();

  const visit = (value: JsonValue): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const objectValue = value as ObjectRecord;
    const entries = Object.entries(objectValue);

    if (entries.length === 1 && entries[0][0] === 'var') {
      const candidate = String(entries[0][1] ?? '');
      if (candidate.startsWith('record.')) {
        const field = candidate.slice('record.'.length);
        const first = field.split('.')[0];
        if (first) deps.add(first);
      }
      return;
    }

    for (const [, child] of entries) visit(child);
  };

  visit(expression);
  return [...deps];
};

function evaluate(expression: JsonValue, context: ComputedContext, budget: Budget): JsonValue {
  if (++budget.steps > MAX_WORK) throw new Error('expression_budget_exceeded');

  if (expression === null || expression === undefined || typeof expression !== 'object' || Array.isArray(expression)) {
    return Array.isArray(expression) ? expression.map((item) => evaluate(item, context, budget)) : expression;
  }

  const entries = Object.entries(expression);
  if (!entries.length) return expression;
  if (entries.length !== 1) {
    return Object.fromEntries(entries.map(([key, value]) => [key, evaluate(value, context, budget)]));
  }

  const [operator, operand] = entries[0];
  if (evaluateByOperator[operator]) return evaluateByOperator[operator](operand, context, budget);
  if (MATH_OPERATORS.has(operator)) return resolveMath(operator, operand, context, budget);

  try {
    consume(operand, budget);
    return jsonLogic.apply(expression as never, context);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expression_')) throw error;
    throw new Error(`unsupported_expression_operator:${operator}`);
  }
}

export function evaluateExpression(expression: unknown, context: ComputedContext): unknown {
  return evaluate(expression, context, { steps: 0 });
}

export const sortComputedFields = (fields: ComputedExpression[]): ComputedExpression[] => {
  const lookup = new Map<string, ComputedExpression>(fields.map((field) => [field.id, field]));
  const state = new Map<string, 'pending' | 'visiting' | 'done'>();
  const ordered: ComputedExpression[] = [];

  const edges = new Map<string, Set<string>>();
  for (const field of fields) {
    const explicit = field.dependsOn ?? [];
    const inferred = dependsOnFromExpression(field.expression).filter((dependency) => dependency !== field.id);
    const dependencies = [...new Set([...explicit, ...inferred])];
    edges.set(field.id, new Set(dependencies));
  }

  const visit = (id: string, stack: string[]): void => {
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') throw new Error(`computed_field_cycle:${[...stack, id].join('>')}`);

    const field = lookup.get(id);
    if (!field) throw new Error(`computed_field_dependency_missing:${stack.at(-1) ?? 'unknown'}:${id}`);

    state.set(id, 'visiting');
    for (const dependency of edges.get(id) ?? []) {
      if (!lookup.has(dependency)) throw new Error(`computed_field_dependency_missing:${id}:${dependency}`);
      visit(dependency, [...stack, id]);
    }
    state.set(id, 'done');
    ordered.push(field);
  };

  for (const field of fields) {
    if (state.get(field.id) !== 'done') visit(field.id, []);
  }

  return ordered;
};

export function computedRecords(pkg: AppPackage, state: AppState): JsonRecord[] {
  if (!pkg.computedFields.length) return state.records;

  const queryContext: QueryRows = Object.fromEntries(
    Object.entries(pkg.queries).map(([id, query]) => [id, { rows: state.records
      .filter((record) => record.collection === query.from)
      .map((record) => ({ id: record.id, ...record.values })), }]),
  );

  return state.records.map((record) => {
    const values: Record<string, unknown> = { ...record.values };
    const fields = pkg.computedFields.filter((field) => field.collection === record.collection);
    if (!fields.length) return record;

    const ordered = sortComputedFields(fields);
    const context: ComputedContext = { record: { ...record.values, id: record.id }, queries: queryContext };

    for (const field of ordered) {
      const computed = evaluateExpression(field.expression, context);
      values[field.id] = computed;
      context.record[field.id] = computed;
    }

    return { ...record, values };
  });
}
