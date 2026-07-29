import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  evaluateExpression as evaluateSharedExpression,
  validateExpressionBudget as validateSharedExpressionBudget,
} from '@/packages/runtime-kernel/expression';
import { evaluateComputedFields as evaluateSharedComputedFields } from '@/packages/runtime-kernel/computed-fields';
import { executeQuery as executeSharedQuery } from '@/packages/runtime-kernel/query';
import {
  evaluateExpression as evaluateServerExpression,
  validateExpressionBudget as validateServerExpressionBudget,
} from '@/server/src/kernel/expression';
import { evaluateComputedFields as evaluateServerComputedFields } from '@/server/src/kernel/computed-fields';
import { executeQuery as executeServerQuery } from '@/server/src/kernel/query';

type CorpusBudget = {
  maxNodes: number;
  maxDepth: number;
  maxRows: number;
  maxRelations: number;
  maxOperations: number;
};

type Corpus = {
  budget: CorpusBudget;
  expressionCases: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    expected: unknown;
  }>;
  recurrenceNextCases?: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    expected: Record<string, unknown>;
  }>;
  recurrenceExpandCases?: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    expected: Record<string, unknown>;
    expectedRefusal?: string;
  }>;
  expressionErrorCases?: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    budget?: Partial<CorpusBudget>;
    validate?: boolean;
    expectedError: string;
  }>;
  queryCases: Array<{
    id: string;
    rows: Array<Record<string, unknown>>;
    spec: Record<string, unknown>;
    expectedRows: Array<Record<string, unknown>>;
  }>;
  computedFieldCases: Array<{
    id: string;
    record: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
    queries: Record<string, unknown>;
    specs: Array<Record<string, unknown>>;
    expected: {
      order: string[];
      values: Record<string, unknown>;
    };
  }>;
};

const corpusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/expression-runtime/corpus.json',
);
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;

describe('expression runtime conformance', () => {
  it.each(corpus.expressionCases)('$id matches shared and server evaluation', ({ input, expression, expected }) => {
    validateSharedExpressionBudget(expression as never, corpus.budget);
    validateServerExpressionBudget(expression as never, corpus.budget);

    const shared = evaluateSharedExpression(input, expression as never, corpus.budget);
    const server = evaluateServerExpression(input, expression as never, corpus.budget);

    expect(shared).toEqual(expected);
    expect(server).toEqual(expected);
    expect(server).toEqual(shared);
  });

  it.each(corpus.recurrenceNextCases ?? [])(
    '$id matches shared and server recurrence-next output',
    ({ input, expression, expected }) => {
      const shared = evaluateSharedExpression(input, expression as never, corpus.budget);
      const server = evaluateServerExpression(input, expression as never, corpus.budget);

      expect(shared).toMatchObject(expected);
      expect(server).toMatchObject(expected);
      expect(server).toEqual(shared);
    },
  );

  it.each(corpus.recurrenceExpandCases ?? [])(
    '$id matches shared and server recurrence expansion output',
    ({ expression, input, expected, expectedRefusal }) => {
      const shared = evaluateSharedExpression(input, expression as never, corpus.budget);
      const server = evaluateServerExpression(input, expression as never, corpus.budget);

      expect(shared).toMatchObject(expected);
      expect(server).toMatchObject(expected);
      if (expectedRefusal) {
        expect(shared).toMatchObject({ status: 'refused', reason: expectedRefusal });
      }
      expect(server).toEqual(shared);
    },
  );

  it.each(corpus.expressionErrorCases ?? [])(
    '$id enforces expression failure parity',
    ({ input, expression, budget, validate, expectedError }) => {
      const effectiveBudget = { ...corpus.budget, ...(budget ?? {}) };
      if (validate) {
        expect(() => validateSharedExpressionBudget(expression as never, effectiveBudget)).toThrow(expectedError);
        expect(() => validateServerExpressionBudget(expression as never, effectiveBudget)).toThrow(expectedError);
      }
      expect(() => evaluateSharedExpression(input, expression as never, effectiveBudget)).toThrow(expectedError);
      expect(() => evaluateServerExpression(input, expression as never, effectiveBudget)).toThrow(expectedError);
    },
  );

  it.each(corpus.queryCases)('$id keeps deterministic ordering and hashes', ({ rows, spec, expectedRows }) => {
    const shared = executeSharedQuery(rows, spec as never);
    const server = executeServerQuery(rows, spec as never);

    expect(shared.rows).toEqual(expectedRows);
    expect(server.rows).toEqual(expectedRows);
    expect(server.resultHash).toBe(shared.resultHash);
  });

  it.each(corpus.computedFieldCases)('$id computes the same overlay in shared and server kernels', ({ record, rows, queries, specs, expected }) => {
    const shared = evaluateSharedComputedFields({
      record,
      rows,
      queries: queries as never,
      specs: specs as never,
      budget: {
        maxExpressionNodes: corpus.budget.maxNodes,
        maxExpressionDepth: corpus.budget.maxDepth,
        maxExpressionRows: corpus.budget.maxRows,
        maxExpressionOperations: corpus.budget.maxOperations,
      },
    });
    const server = evaluateServerComputedFields({
      record,
      rows,
      queries: queries as never,
      specs: specs as never,
      budget: {
        maxExpressionNodes: corpus.budget.maxNodes,
        maxExpressionDepth: corpus.budget.maxDepth,
        maxExpressionRows: corpus.budget.maxRows,
        maxExpressionOperations: corpus.budget.maxOperations,
      },
    });

    expect(shared.order).toEqual(expected.order);
    expect(shared.values).toEqual(expected.values);
    expect(server.order).toEqual(expected.order);
    expect(server.values).toEqual(expected.values);
    expect(server.resultHash).toBe(shared.resultHash);
  });

  it('enforces aggregate row budgets', () => {
    expect(() => evaluateSharedExpression(
      { rows: new Array(3).fill({ amount: '1.00' }) },
      {
        group_sum: {
          rows: { var: 'rows' },
          groupBy: 'amount',
          equals: '1.00',
          value: 'amount',
        },
      } as never,
      { maxRows: 2, maxOperations: 32 },
    )).toThrow('expression_row_budget_exceeded');
  });

  it('enforces aggregate operation budgets', () => {
    expect(() => evaluateSharedExpression(
      {
        rows: [
          { participant: 'amy', paid: '4.00', owed: '1.00' },
          { participant: 'ben', paid: '1.00', owed: '4.00' },
          { participant: 'cara', paid: '1.00', owed: '1.00' },
        ],
      },
      {
        balance_transfers: {
          rows: { var: 'rows' },
          participant: 'participant',
          paid: 'paid',
          owed: 'owed',
        },
      } as never,
      { maxRows: 16, maxOperations: 3 },
    )).toThrow('expression_operation_budget_exceeded');
  });

  it('rejects invalid decimal input deterministically', () => {
    expect(() => evaluateSharedExpression(
      {},
      { '+': ['not-a-number', 1] } as never,
      corpus.budget,
    )).toThrow('expression_decimal_invalid');
  });

  it('rejects unsupported operators before execution', () => {
    expect(() => validateSharedExpressionBudget(
      { eval: ['return process.env'] } as never,
      corpus.budget,
    )).toThrow('unsupported_expression_operator:eval');
  });

  it('enforces relation traversal budgets', () => {
    expect(() => evaluateSharedExpression(
      {
        rows: [{ id: 'a' }, { id: 'b' }],
        relations: [{ target_id: 'a' }, { target_id: 'b' }],
      },
      {
        relation_rows: {
          rows: { var: 'rows' },
          relations: { var: 'relations' },
        },
      } as never,
      { maxRelations: 1, maxOperations: 32 },
    )).toThrow('expression_relation_budget_exceeded');
  });
});
