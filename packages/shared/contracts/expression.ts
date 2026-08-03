export const EXPRESSION_SCHEMA_VERSION = 'utopia.expression.v1' as const;

export const EXPRESSION_OPERATOR_NAMES = [
  'var',
  'if',
  'and',
  'or',
  '!',
  '+',
  '-',
  '*',
  '/',
  'pow',
  'date_diff',
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
] as const;

export type ExpressionOperator = typeof EXPRESSION_OPERATOR_NAMES[number];

export const DATE_DIFF_UNITS = ['seconds', 'minutes', 'hours', 'days'] as const;
export type DateDiffUnit = typeof DATE_DIFF_UNITS[number];

export const DATE_DIFF_INPUT_KINDS = ['instant', 'date'] as const;
export type DateDiffInputKind = typeof DATE_DIFF_INPUT_KINDS[number];

export const DATE_DIFF_POLICIES = ['error', 'zero', 'negative'] as const;
export type DateDiffPolicy = typeof DATE_DIFF_POLICIES[number];

export type DateDiffSpec = {
  start: unknown;
  end: unknown;
  unit: DateDiffUnit;
  inputKind: DateDiffInputKind;
  timezone: 'UTC';
  onMissing: Extract<DateDiffPolicy, 'error' | 'zero'>;
  onInvalid: Extract<DateDiffPolicy, 'error' | 'zero'>;
  onEndBeforeStart: DateDiffPolicy;
};

// This is the single package-schema expression shape. Operand semantics stay in
// the runtime validator so client and server share one executable policy.
export const expressionSchemaDefinition = {
  anyOf: [
    { type: 'null' },
    { type: 'boolean' },
    { type: 'number' },
    { type: 'string' },
    { type: 'array', items: { $ref: '#/$defs/expression' } },
    {
      type: 'object',
      minProperties: 1,
      maxProperties: 1,
      propertyNames: { enum: EXPRESSION_OPERATOR_NAMES },
      additionalProperties: {},
    },
  ],
} as const;
