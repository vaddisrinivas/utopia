export const CONFIDENCE_BANDS = ['low', 'medium', 'high'] as const;

export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export type ConfidenceValue = Readonly<{
  score: number;
  band: ConfidenceBand;
}>;

const BAND_TO_SCORE: Record<ConfidenceBand, number> = {
  low: 0.25,
  medium: 0.6,
  high: 0.9,
};

export function clampConfidenceScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

export function confidenceBandFromScore(score: number): ConfidenceBand {
  if (score >= 0.75) {
    return 'high';
  }
  if (score >= 0.4) {
    return 'medium';
  }
  return 'low';
}

export function normalizeConfidence(
  value: ConfidenceBand | number | { score?: unknown; band?: unknown } | null | undefined,
  fallback: ConfidenceBand = 'medium',
): ConfidenceValue {
  const fallbackScore = BAND_TO_SCORE[fallback];

  if (value === 'low' || value === 'medium' || value === 'high') {
    return {
      score: BAND_TO_SCORE[value],
      band: value,
    };
  }

  const scoreFromObject = clampConfidenceScore((value as { score?: unknown } | null | undefined)?.score);
  if (scoreFromObject !== null) {
    return {
      score: scoreFromObject,
      band: confidenceBandFromScore(scoreFromObject),
    };
  }

  const score = clampConfidenceScore(value);
  if (score !== null) {
    return {
      score,
      band: confidenceBandFromScore(score),
    };
  }

  const band = (value as { band?: unknown } | null | undefined)?.band;
  if (band === 'low' || band === 'medium' || band === 'high') {
    return {
      score: BAND_TO_SCORE[band],
      band,
    };
  }

  return {
    score: fallbackScore,
    band: fallback,
  };
}
