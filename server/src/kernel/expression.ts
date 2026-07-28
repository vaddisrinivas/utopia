import jsonLogic from 'json-logic-js';

/** JSON-Logic rule data. Kept as JSON so packages remain executable-data only. */
export type Expression = boolean | string | number | null | Record<string, unknown> | Expression[];

export type ExpressionBudget = { maxNodes?: number; maxDepth?: number };

function measure(value: unknown, depth: number, budget: Required<ExpressionBudget>): number {
  if (depth > budget.maxDepth) throw new Error('expression_budget_exceeded');
  if (!value || typeof value !== 'object') return 1;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const count = 1 + children.reduce((sum, child) => sum + measure(child, depth + 1, budget), 0);
  if (count > budget.maxNodes) throw new Error('expression_budget_exceeded');
  return count;
}

export function validateExpressionBudget(expression: Expression, budget: ExpressionBudget = {}): void {
  const limits = { maxNodes: budget.maxNodes ?? 256, maxDepth: budget.maxDepth ?? 32 };
  measure(expression, 0, limits);
}

export function evaluateExpression(input: unknown, expression: Expression, budget: ExpressionBudget = {}): unknown {
  validateExpressionBudget(expression, budget);
  return jsonLogic.apply(expression, input);
}
