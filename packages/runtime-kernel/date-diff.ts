import {
  DATE_DIFF_INPUT_KINDS,
  DATE_DIFF_POLICIES,
  DATE_DIFF_UNITS,
  type DateDiffSpec,
} from '@/packages/shared/contracts/expression';

const MAX_DATE_DIFF_DAYS = 36_600;
const MAX_DATE_DIFF_MILLISECONDS = MAX_DATE_DIFF_DAYS * 24 * 60 * 60 * 1_000;
const UNIT_MILLISECONDS = {
  seconds: 1_000,
  minutes: 60 * 1_000,
  hours: 60 * 60 * 1_000,
  days: 24 * 60 * 60 * 1_000,
} as const;

export function evaluateDateDiff(spec: DateDiffSpec): number {
  validateDateDiffSpec(spec);
  const start = parseDateValue(spec.start, spec.inputKind, spec.onMissing, spec.onInvalid, 'start');
  const end = parseDateValue(spec.end, spec.inputKind, spec.onMissing, spec.onInvalid, 'end');
  if (start === null || end === null) return 0;

  const deltaMilliseconds = end - start;
  if (deltaMilliseconds < 0) {
    if (spec.onEndBeforeStart === 'error') throw new Error('expression_date_diff_end_before_start');
    if (spec.onEndBeforeStart === 'zero') return 0;
  }
  if (Math.abs(deltaMilliseconds) > MAX_DATE_DIFF_MILLISECONDS) {
    throw new Error('expression_date_diff_range_exceeded');
  }

  return Math.trunc(deltaMilliseconds / UNIT_MILLISECONDS[spec.unit]);
}

function validateDateDiffSpec(spec: DateDiffSpec): void {
  if (!spec || typeof spec !== 'object') throw new Error('expression_date_diff_spec_invalid');
  if (!DATE_DIFF_UNITS.includes(spec.unit)) throw new Error('expression_date_diff_unit_invalid');
  if (!DATE_DIFF_INPUT_KINDS.includes(spec.inputKind)) throw new Error('expression_date_diff_input_kind_invalid');
  if (spec.timezone !== 'UTC') throw new Error('expression_date_diff_timezone_invalid');
  if (!['error', 'zero'].includes(spec.onMissing)) throw new Error('expression_date_diff_missing_policy_invalid');
  if (!['error', 'zero'].includes(spec.onInvalid)) throw new Error('expression_date_diff_invalid_policy_invalid');
  if (!DATE_DIFF_POLICIES.includes(spec.onEndBeforeStart)) throw new Error('expression_date_diff_order_policy_invalid');
}

function parseDateValue(
  value: unknown,
  inputKind: DateDiffSpec['inputKind'],
  onMissing: DateDiffSpec['onMissing'],
  onInvalid: DateDiffSpec['onInvalid'],
  side: 'start' | 'end',
): number | null {
  if (value === undefined || value === null || value === '') {
    if (onMissing === 'zero') return null;
    throw new Error(`expression_date_diff_missing:${side}`);
  }
  if (typeof value !== 'string') {
    if (onInvalid === 'zero') return null;
    throw new Error(`expression_date_diff_invalid:${side}`);
  }

  const parsed = inputKind === 'instant' ? parseInstant(value) : parseDate(value);
  if (parsed !== null) return parsed;
  if (onInvalid === 'zero') return null;
  throw new Error(`expression_date_diff_invalid:${side}`);
}

function parseInstant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.test(value)) {
    return null;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function parseDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date.getTime();
}
