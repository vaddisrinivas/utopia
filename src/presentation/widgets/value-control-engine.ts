export type ValueControlConfig = Readonly<{
  step: number;
  min: number | null;
  max: number | null;
  resetValue: number;
  precision: number;
}>;

export function normalizeValueControlConfig(input: {
  step?: unknown;
  min?: unknown;
  max?: unknown;
  resetValue?: unknown;
  precision?: unknown;
}): ValueControlConfig {
  const precision = clampInteger(input.precision, 0, 6, 0);
  const step = positiveFinite(input.step, 1);
  const min = optionalFinite(input.min);
  const max = optionalFinite(input.max);
  const normalizedMax = min !== null && max !== null && max < min ? min : max;
  const fallbackReset = min ?? 0;
  return {
    step: round(step, precision),
    min,
    max: normalizedMax,
    resetValue: clamp(round(finite(input.resetValue, fallbackReset), precision), min, normalizedMax),
    precision,
  };
}

export function nextValueControlValue(
  current: unknown,
  action: 'increment' | 'decrement' | 'reset' | 'set',
  config: ValueControlConfig,
  explicitValue?: unknown,
): number {
  const value = finite(current, config.resetValue);
  if (action === 'reset') return config.resetValue;
  const candidate = action === 'set'
    ? finite(explicitValue, value)
    : value + (action === 'increment' ? config.step : -config.step);
  return clamp(round(candidate, config.precision), config.min, config.max);
}

export function formatValueControlValue(value: unknown, precision: number): string {
  const parsed = finite(value, 0);
  return precision > 0 ? parsed.toFixed(precision) : String(Math.round(parsed));
}

function finite(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalFinite(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = finite(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveFinite(value: unknown, fallback: number): number {
  const parsed = finite(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.max(min, Math.min(max, Math.floor(finite(value, fallback))));
}

function clamp(value: number, min: number | null, max: number | null): number {
  return Math.max(min ?? Number.NEGATIVE_INFINITY, Math.min(max ?? Number.POSITIVE_INFINITY, value));
}

function round(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
