export const DECIMAL_SCALE = 2n;
export const DECIMAL_BASE = 10n ** DECIMAL_SCALE;
export const MAX_POWER_EXPONENT = 128n;
export const MAX_POWER_RESULT_DIGITS = 128;

// Fixed-point decimal math:
// 2-digit cents, deterministic half-away-from-zero rounding, and no locale-dependent formatting.
// Power uses integer exponents only; every intermediate multiply/divide is rounded at this scale.
const DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

export function isCanonicalDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value);
}

export function decimalToString(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / DECIMAL_BASE;
  const fraction = (absolute % DECIMAL_BASE).toString().padStart(Number(DECIMAL_SCALE), '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

export function decimalCompare(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function decimalAdd(left: bigint, right: bigint): bigint {
  return left + right;
}

export function decimalSubtract(left: bigint, right: bigint): bigint {
  return left - right;
}

export function decimalMultiply(left: bigint, right: bigint): bigint {
  return divideHalfAway(left * right, DECIMAL_BASE);
}

export function decimalDivide(left: bigint, right: bigint): bigint {
  if (right === 0n) throw new Error('expression_divide_by_zero');
  return divideHalfAway(left * DECIMAL_BASE, right);
}

export function decimalPower(base: bigint, exponentValue: unknown): bigint {
  const exponent = parseIntegerPowerExponent(exponentValue);
  if (exponent < -MAX_POWER_EXPONENT || exponent > MAX_POWER_EXPONENT) {
    throw new Error('expression_power_exponent_out_of_range');
  }
  if (exponent === 0n) {
    if (base === 0n) throw new Error('expression_power_zero_to_zero');
    return DECIMAL_BASE;
  }
  if (exponent < 0n && base === 0n) {
    throw new Error('expression_power_zero_negative_exponent');
  }

  let remaining = exponent < 0n ? -exponent : exponent;
  let factor = base;
  let result = DECIMAL_BASE;
  while (remaining > 0n) {
    if (remaining % 2n === 1n) {
      result = checkedPowerValue(decimalMultiply(result, factor));
    }
    remaining /= 2n;
    if (remaining > 0n) factor = checkedPowerValue(decimalMultiply(factor, factor));
  }
  return exponent < 0n ? decimalDivide(DECIMAL_BASE, result) : result;
}

export function parseDecimal(value: unknown, error = 'expression_decimal_invalid'): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(error);
    return parseDecimal(normalizeNumberish(value), error);
  }
  if (typeof value !== 'string') throw new Error(error);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(error);
  const normalized = expandExponent(trimmed);
  if (!DECIMAL_RE.test(normalized)) throw new Error(error);

  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^[+-]/, '');
  const [wholeText, fractionText = ''] = unsigned.split('.');
  const whole = BigInt(wholeText);
  const padded = `${fractionText}000`;
  const kept = padded.slice(0, Number(DECIMAL_SCALE));
  const discarded = padded.slice(Number(DECIMAL_SCALE));
  const fraction = BigInt(kept || '0');
  let result = whole * DECIMAL_BASE + fraction;
  if (shouldRoundHalfAway(discarded)) result += 1n;
  return negative ? -result : result;
}

export function maybeParseComparableDecimal(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return parseDecimal(value);
  }
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = expandExponent(trimmed);
    if (!DECIMAL_RE.test(normalized)) return null;
    return parseDecimal(normalized);
  }
  return null;
}

function shouldRoundHalfAway(discarded: string): boolean {
  if (!discarded) return false;
  const [first = '0'] = discarded;
  if (first > '5') return true;
  if (first < '5') return false;
  return true;
}

function divideHalfAway(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('expression_divide_by_zero');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  let quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  if (remainder * 2n >= absoluteDenominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

function normalizeNumberish(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return expandExponent(value.toString());
}

function parseIntegerPowerExponent(value: unknown): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error('expression_power_exponent_non_integer');
    }
    return BigInt(value);
  }
  if (typeof value !== 'string') throw new Error('expression_power_exponent_non_integer');
  const normalized = expandExponent(value.trim());
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error('expression_power_exponent_non_integer');
  }
  const unsigned = normalized.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction && /[1-9]/.test(fraction)) {
    throw new Error('expression_power_exponent_non_integer');
  }
  const parsed = BigInt(whole);
  return normalized.startsWith('-') ? -parsed : parsed;
}

function checkedPowerValue(value: bigint): bigint {
  const digits = (value < 0n ? -value : value).toString().length;
  if (digits > MAX_POWER_RESULT_DIGITS) throw new Error('expression_power_overflow');
  return value;
}

function expandExponent(value: string): string {
  if (!/[eE]/.test(value)) return value;
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return value;
  const [, sign, whole, fraction = '', exponentText] = match;
  const exponent = Number.parseInt(exponentText, 10);
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length;
  const shifted = decimalIndex + exponent;
  if (shifted <= 0) {
    return `${sign}0.${'0'.repeat(Math.abs(shifted))}${digits}`.replace(/\.$/, '');
  }
  if (shifted >= digits.length) {
    return `${sign}${digits}${'0'.repeat(shifted - digits.length)}`;
  }
  return `${sign}${digits.slice(0, shifted)}.${digits.slice(shifted)}`;
}
