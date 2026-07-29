import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToString,
  maybeParseComparableDecimal,
  parseDecimal,
} from '@/packages/runtime-kernel/decimal';
import { readPath, stableJson } from '@/packages/runtime-kernel/query';
import { expandRecurrenceSchedule, nextRecurrenceOccurrence } from '@/packages/runtime-kernel/recurrence';

export type Expression = boolean | string | number | null | Record<string, unknown> | Expression[];

export type ExpressionBudget = {
  maxNodes?: number;
  maxDepth?: number;
  maxRows?: number;
  maxRelations?: number;
  maxOperations?: number;
};

type EvaluationState = {
  budget: Required<ExpressionBudget>;
  operations: number;
};

const DEFAULT_BUDGET: Required<ExpressionBudget> = {
  maxNodes: 256,
  maxDepth: 32,
  maxRows: 256,
  maxRelations: 256,
  maxOperations: 512,
};
const SUPPORTED_OPERATORS = new Set([
  'var',
  'if',
  'and',
  'or',
  '!',
  '+',
  '-',
  '*',
  '/',
  '>',
  '>=',
  '<',
  '<=',
  '==',
  '===',
  '!=',
  '!==',
  'group_sum',
  'allocate_weighted',
  'balance_transfers',
  'relation_rows',
  'recurrence_next',
  'recurrence_expand',
]);

export function validateExpressionBudget(expression: Expression, budget: ExpressionBudget = {}): void {
  const limits = { ...DEFAULT_BUDGET, ...budget };
  measure(expression, 0, limits);
  validateOperatorTree(expression);
}

export function evaluateExpression(input: unknown, expression: Expression, budget: ExpressionBudget = {}): unknown {
  const limits = { ...DEFAULT_BUDGET, ...budget };
  validateExpressionBudget(expression, limits);
  return evaluateNode(input, expression, { budget: limits, operations: 0 });
}

function evaluateNode(input: unknown, expression: Expression, state: EvaluationState): unknown {
  if (expression === null || typeof expression === 'boolean' || typeof expression === 'number' || typeof expression === 'string') {
    return expression;
  }
  if (Array.isArray(expression)) {
    return expression.map((entry) => evaluateNode(input, entry, state));
  }
  const entries = Object.entries(expression);
  if (entries.length !== 1) {
    return Object.fromEntries(entries.map(([key, value]) => [key, evaluateNode(input, value as Expression, state)]));
  }
  const [operator, operand] = entries[0];
  tick(state);
  switch (operator) {
    case 'var':
      return evaluateVar(input, operand, state);
    case 'if':
      return evaluateIf(input, operand, state);
    case 'and':
      return evaluateAnd(input, operand, state);
    case 'or':
      return evaluateOr(input, operand, state);
    case '!':
      return !truthy(evaluateNode(input, operand as Expression, state));
    case '+':
      return foldDecimal(input, operand, state, decimalAdd, 0n);
    case '-':
      return evaluateSubtract(input, operand, state);
    case '*':
      return foldDecimal(input, operand, state, decimalMultiply, parseDecimal(1), true);
    case '/':
      return evaluateDivide(input, operand, state);
    case '>':
    case '>=':
    case '<':
    case '<=':
      return evaluateComparison(input, operand, state, operator);
    case '==':
    case '===':
      return evaluateEquality(input, operand, state, true);
    case '!=':
    case '!==':
      return evaluateEquality(input, operand, state, false);
    case 'group_sum':
      return evaluateGroupSum(input, operand, state);
    case 'allocate_weighted':
      return evaluateWeightedAllocation(input, operand, state);
    case 'balance_transfers':
      return evaluateBalanceTransfers(input, operand, state);
    case 'relation_rows':
      return evaluateRelationRows(input, operand, state);
    case 'recurrence_next':
      return evaluateRecurrenceNext(input, operand, state);
    case 'recurrence_expand':
      return evaluateRecurrenceExpand(input, operand, state);
    default:
      throw new Error(`unsupported_expression_operator:${operator}`);
  }
}

function evaluateVar(input: unknown, operand: unknown, state: EvaluationState): unknown {
  if (typeof operand === 'string') return readPath(input, operand);
  if (Array.isArray(operand)) {
    const [path, fallback] = operand;
    if (typeof path !== 'string') throw new Error('expression_var_invalid');
    const value = readPath(input, path);
    return value === undefined ? evaluateNode(input, fallback as Expression, state) : value;
  }
  throw new Error('expression_var_invalid');
}

function evaluateIf(input: unknown, operand: unknown, state: EvaluationState): unknown {
  if (!Array.isArray(operand) || operand.length < 3) throw new Error('expression_if_invalid');
  for (let index = 0; index < operand.length - 1; index += 2) {
    if (truthy(evaluateNode(input, operand[index] as Expression, state))) {
      return evaluateNode(input, operand[index + 1] as Expression, state);
    }
  }
  return evaluateNode(input, operand[operand.length - 1] as Expression, state);
}

function evaluateAnd(input: unknown, operand: unknown, state: EvaluationState): unknown {
  if (!Array.isArray(operand)) throw new Error('expression_and_invalid');
  let result: unknown = true;
  for (const part of operand) {
    result = evaluateNode(input, part as Expression, state);
    if (!truthy(result)) return result;
  }
  return result;
}

function evaluateOr(input: unknown, operand: unknown, state: EvaluationState): unknown {
  if (!Array.isArray(operand)) throw new Error('expression_or_invalid');
  let result: unknown = false;
  for (const part of operand) {
    result = evaluateNode(input, part as Expression, state);
    if (truthy(result)) return result;
  }
  return result;
}

function foldDecimal(
  input: unknown,
  operand: unknown,
  state: EvaluationState,
  reducer: (left: bigint, right: bigint) => bigint,
  seed: bigint,
  requireArgs = false,
): string {
  if (!Array.isArray(operand) || (requireArgs && operand.length === 0)) {
    throw new Error('expression_decimal_invalid');
  }
  const result = operand.reduce(
    (current, entry) => reducer(current, parseDecimal(evaluateNode(input, entry as Expression, state))),
    seed,
  );
  return decimalToString(result);
}

function evaluateSubtract(input: unknown, operand: unknown, state: EvaluationState): string {
  if (!Array.isArray(operand) || operand.length === 0) throw new Error('expression_decimal_invalid');
  const values = operand.map((entry) => parseDecimal(evaluateNode(input, entry as Expression, state)));
  const result = values.length === 1
    ? decimalSubtract(0n, values[0]!)
    : values.slice(1).reduce((current, entry) => decimalSubtract(current, entry), values[0]!);
  return decimalToString(result);
}

function evaluateDivide(input: unknown, operand: unknown, state: EvaluationState): string {
  if (!Array.isArray(operand) || operand.length < 2) throw new Error('expression_divide_invalid');
  const values = operand.map((entry) => parseDecimal(evaluateNode(input, entry as Expression, state)));
  const result = values.slice(1).reduce((current, entry) => decimalDivide(current, entry), values[0]!);
  return decimalToString(result);
}

function evaluateComparison(
  input: unknown,
  operand: unknown,
  state: EvaluationState,
  operator: '>' | '>=' | '<' | '<=',
): boolean {
  if (!Array.isArray(operand) || operand.length !== 2) throw new Error('expression_comparison_invalid');
  const [left, right] = operand.map((entry) => evaluateNode(input, entry as Expression, state));
  const numericLeft = maybeParseComparableDecimal(left);
  const numericRight = maybeParseComparableDecimal(right);
  const result = numericLeft !== null && numericRight !== null
    ? decimalCompare(numericLeft, numericRight)
    : compareAsString(left, right);
  switch (operator) {
    case '>':
      return result > 0;
    case '>=':
      return result >= 0;
    case '<':
      return result < 0;
    case '<=':
      return result <= 0;
  }
}

function evaluateEquality(input: unknown, operand: unknown, state: EvaluationState, equal: boolean): boolean {
  if (!Array.isArray(operand) || operand.length !== 2) throw new Error('expression_equality_invalid');
  const [left, right] = operand.map((entry) => evaluateNode(input, entry as Expression, state));
  const numericLeft = maybeParseComparableDecimal(left);
  const numericRight = maybeParseComparableDecimal(right);
  const result = numericLeft !== null && numericRight !== null
    ? decimalCompare(numericLeft, numericRight) === 0
    : stableJson(left) === stableJson(right);
  return equal ? result : !result;
}

function evaluateGroupSum(input: unknown, operand: unknown, state: EvaluationState): string {
  const spec = object(operand, 'expression_group_sum_invalid');
  const rows = evaluateRows(input, spec.rows, state);
  const groupBy = text(spec.groupBy, 'expression_group_sum_invalid');
  const valueField = text(spec.value, 'expression_group_sum_invalid');
  const expected = spec.equals === undefined
    ? readPath(input, groupBy)
    : evaluateNode(input, spec.equals as Expression, state);
  let total = 0n;
  for (const row of rows) {
    tick(state);
    if (stableJson(readPath(row, groupBy)) !== stableJson(expected)) continue;
    total = decimalAdd(total, parseDecimal(readPath(row, valueField)));
  }
  return decimalToString(total);
}

function evaluateWeightedAllocation(input: unknown, operand: unknown, state: EvaluationState): Array<{ key: string; amount: string; weight: string }> {
  const spec = object(operand, 'expression_allocate_weighted_invalid');
  const rows = evaluateRows(input, spec.rows, state);
  const keyField = text(spec.key, 'expression_allocate_weighted_invalid');
  const weightField = text(spec.weight, 'expression_allocate_weighted_invalid');
  const total = parseDecimal(resolveValue(input, spec.total, state));

  const normalized = rows.map((row) => {
    tick(state);
    return {
      key: String(readPath(row, keyField) ?? ''),
      weight: parseDecimal(readPath(row, weightField)),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  const totalWeight = normalized.reduce((sum, row) => sum + row.weight, 0n);
  if (totalWeight <= 0n) throw new Error('expression_allocate_weighted_invalid');

  const sign = total < 0n ? -1n : 1n;
  const absoluteTotal = total < 0n ? -total : total;
  const baseRows = normalized.map((row) => {
    const numerator = absoluteTotal * row.weight;
    return {
      ...row,
      base: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });
  let assigned = baseRows.reduce((sum, row) => sum + row.base, 0n);
  let remainder = absoluteTotal - assigned;
  const priority = [...baseRows].sort((left, right) => {
    const remainderOrder = decimalCompare(right.remainder, left.remainder);
    if (remainderOrder !== 0) return remainderOrder;
    return left.key.localeCompare(right.key);
  });
  for (const row of priority) {
    if (remainder <= 0n) break;
    tick(state);
    row.base += 1n;
    assigned += 1n;
    remainder -= 1n;
  }

  return baseRows
    .map((row) => ({
      key: row.key,
      amount: decimalToString(row.base * sign),
      weight: decimalToString(row.weight),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function evaluateBalanceTransfers(
  input: unknown,
  operand: unknown,
  state: EvaluationState,
): Array<{ from: string; to: string; amount: string }> {
  const spec = object(operand, 'expression_balance_transfers_invalid');
  const rows = evaluateRows(input, spec.rows, state);
  const participantField = text(spec.participant, 'expression_balance_transfers_invalid');
  const paidField = text(spec.paid, 'expression_balance_transfers_invalid');
  const owedField = text(spec.owed, 'expression_balance_transfers_invalid');

  const balances = new Map<string, bigint>();
  for (const row of rows) {
    tick(state);
    const participant = String(readPath(row, participantField) ?? '');
    const current = balances.get(participant) ?? 0n;
    const paid = parseDecimal(readPath(row, paidField));
    const owed = parseDecimal(readPath(row, owedField));
    balances.set(participant, decimalAdd(current, decimalSubtract(paid, owed)));
  }

  const creditors = [...balances.entries()]
    .filter(([, value]) => value > 0n)
    .map(([participant, value]) => ({ participant, value }))
    .sort((left, right) => {
      const amountOrder = decimalCompare(right.value, left.value);
      if (amountOrder !== 0) return amountOrder;
      return left.participant.localeCompare(right.participant);
    });
  const debtors = [...balances.entries()]
    .filter(([, value]) => value < 0n)
    .map(([participant, value]) => ({ participant, value: -value }))
    .sort((left, right) => {
      const amountOrder = decimalCompare(right.value, left.value);
      if (amountOrder !== 0) return amountOrder;
      return left.participant.localeCompare(right.participant);
    });

  const transfers: Array<{ from: string; to: string; amount: string }> = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    tick(state);
    const creditor = creditors[creditorIndex]!;
    const debtor = debtors[debtorIndex]!;
    const amount = creditor.value < debtor.value ? creditor.value : debtor.value;
    transfers.push({
      from: debtor.participant,
      to: creditor.participant,
      amount: decimalToString(amount),
    });
    creditor.value -= amount;
    debtor.value -= amount;
    if (creditor.value === 0n) creditorIndex += 1;
    if (debtor.value === 0n) debtorIndex += 1;
  }
  return transfers;
}

function evaluateRelationRows(
  input: unknown,
  operand: unknown,
  state: EvaluationState,
): Array<Record<string, unknown>> {
  const spec = object(operand, 'expression_relation_rows_invalid');
  const rows = evaluateRows(input, spec.rows, state);
  const relationsValue = resolveValue(input, spec.relations, state);
  if (!Array.isArray(relationsValue)) throw new Error('expression_relations_invalid');
  if (relationsValue.length > state.budget.maxRelations) {
    throw new Error('expression_relation_budget_exceeded');
  }
  const relationName = spec.name === undefined ? null : text(spec.name, 'expression_relation_rows_invalid');
  const targetField = spec.targetField === undefined
    ? 'target_id'
    : text(spec.targetField, 'expression_relation_rows_invalid');
  const rowKey = spec.rowKey === undefined ? 'id' : text(spec.rowKey, 'expression_relation_rows_invalid');
  const targetIds = new Set<string>();
  for (const relation of relationsValue) {
    tick(state);
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
      throw new Error('expression_relations_invalid');
    }
    const relationRecord = relation as Record<string, unknown>;
    if (relationName !== null && relationRecord.name !== relationName) continue;
    const targetId = relationRecord[targetField];
    if (typeof targetId === 'string' && targetId) targetIds.add(targetId);
  }
  return rows.filter((row) => {
    tick(state);
    return targetIds.has(String(readPath(row, rowKey) ?? ''));
  });
}

function evaluateRecurrenceNext(input: unknown, operand: unknown, state: EvaluationState): unknown {
  const spec = object(operand, 'expression_recurrence_next_invalid');
  const schedule = evaluateNode(input, spec.schedule as Expression, state);
  const after = spec.after === undefined ? undefined : evaluateNode(input, spec.after as Expression, state);
  const budget = spec.budget === undefined ? undefined : evaluateNode(input, spec.budget as Expression, state);
  return nextRecurrenceOccurrence({
    schedule,
    after,
    budget: budget && typeof budget === 'object' && !Array.isArray(budget)
      ? budget as Record<string, number>
      : undefined,
  });
}

function evaluateRecurrenceExpand(input: unknown, operand: unknown, state: EvaluationState): unknown {
  const spec = object(operand, 'expression_recurrence_expand_invalid');
  const schedule = evaluateNode(input, spec.schedule as Expression, state);
  const after = spec.after === undefined ? undefined : evaluateNode(input, spec.after as Expression, state);
  const until = spec.until === undefined ? undefined : evaluateNode(input, spec.until as Expression, state);
  const limit = spec.limit === undefined ? undefined : Number(evaluateNode(input, spec.limit as Expression, state));
  const budget = spec.budget === undefined ? undefined : evaluateNode(input, spec.budget as Expression, state);
  return expandRecurrenceSchedule({
    schedule,
    after,
    until,
    limit,
    budget: budget && typeof budget === 'object' && !Array.isArray(budget)
      ? budget as Record<string, number>
      : undefined,
  });
}

function evaluateRows(input: unknown, operand: unknown, state: EvaluationState): Array<Record<string, unknown>> {
  const value = resolveValue(input, operand, state);
  if (!Array.isArray(value)) throw new Error('expression_rows_invalid');
  if (value.length > state.budget.maxRows) throw new Error('expression_row_budget_exceeded');
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('expression_rows_invalid');
    return row as Record<string, unknown>;
  });
}

function resolveValue(input: unknown, operand: unknown, state: EvaluationState): unknown {
  return isExpression(operand) ? evaluateNode(input, operand, state) : operand;
}

function tick(state: EvaluationState, amount = 1): void {
  state.operations += amount;
  if (state.operations > state.budget.maxOperations) throw new Error('expression_operation_budget_exceeded');
}

function measure(value: unknown, depth: number, budget: Required<ExpressionBudget>): number {
  if (depth > budget.maxDepth) throw new Error('expression_budget_exceeded');
  if (!value || typeof value !== 'object') return 1;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const count = 1 + children.reduce((sum, child) => sum + measure(child, depth + 1, budget), 0);
  if (count > budget.maxNodes) throw new Error('expression_budget_exceeded');
  return count;
}

function validateOperatorTree(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(validateOperatorTree);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1) {
    entries.forEach(([, entry]) => validateOperatorTree(entry));
    return;
  }
  const [operator, operand] = entries[0]!;
  if (!SUPPORTED_OPERATORS.has(operator)) {
    throw new Error(`unsupported_expression_operator:${operator}`);
  }
  if (
    operator === 'group_sum'
    || operator === 'allocate_weighted'
    || operator === 'balance_transfers'
    || operator === 'relation_rows'
  ) {
    const spec = object(operand, `expression_${operator}_invalid`);
    for (const key of ['rows', 'equals', 'total', 'relations']) {
      if (spec[key] !== undefined) validateOperatorTree(spec[key]);
    }
    return;
  }
  validateOperatorTree(operand);
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function object(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function text(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim();
}

function isExpression(value: unknown): value is Expression {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
    || Array.isArray(value)
    || typeof value === 'object';
}

function compareAsString(left: unknown, right: unknown): number {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText === rightText) return 0;
  return leftText < rightText ? -1 : 1;
}
