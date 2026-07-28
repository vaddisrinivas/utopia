import { describe, expect, it } from 'vitest';

import {
  confidenceBandFromScore,
  normalizeConfidence,
} from '@/packages/shared/contracts/confidence';
import { evaluateCommandPolicy } from '@/src/actions/policy';

describe('confidence contract', () => {
  it('normalizes numeric and qualitative confidence into one shape', () => {
    expect(normalizeConfidence('high')).toEqual({ score: 0.9, band: 'high' });
    expect(normalizeConfidence(0.51)).toEqual({ score: 0.51, band: 'medium' });
    expect(normalizeConfidence({ score: 1.4 })).toEqual({ score: 1, band: 'high' });
    expect(normalizeConfidence({ band: 'low' })).toEqual({ score: 0.25, band: 'low' });
    expect(confidenceBandFromScore(0.39)).toBe('low');
    expect(confidenceBandFromScore(0.4)).toBe('medium');
    expect(confidenceBandFromScore(0.75)).toBe('high');
  });

  it('uses the shared confidence contract across policy outcomes', () => {
    const denied = evaluateCommandPolicy({
      domain: 'food',
      tool: 'chat_execute_command',
      command: 'delete credential export',
    });
    expect(denied.decision).toBe('deny');
    expect(denied.confidence).toEqual(normalizeConfidence('high'));

    const clarified = evaluateCommandPolicy({
      domain: 'food',
      tool: 'chat_execute_command',
      command: 'update this',
    });
    expect(clarified.decision).toBe('clarify');
    expect(clarified.confidence).toEqual(normalizeConfidence('medium'));

    const executed = evaluateCommandPolicy({
      domain: 'food',
      tool: 'chat_execute_command',
      command: 'create recipe dal',
    });
    expect(executed.decision).toBe('execute');
    expect(executed.confidence).toEqual(normalizeConfidence('high'));
  });
});
