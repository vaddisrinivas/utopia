import { describe, expect, it } from 'vitest';

import {
  CapabilityResult,
  CapabilityStateError,
  classifyCapabilityError,
  executeCapability,
  isCapabilityTerminal,
} from '@/src/kernel/capability-state';

describe('lane C capability state machine', () => {
  it('classifies native-denied errors as denied', () => {
    const state = classifyCapabilityError(new CapabilityStateError('denied', true, 'Permission denied by user'));
    expect(state).toBe('denied');
  });

  it('classifies cancelled workflow as cancelled', () => {
    const state = classifyCapabilityError(new Error('user cancelled camera scan'));
    expect(state).toBe('cancelled');
  });

  it('classifies unavailable modules as unavailable', () => {
    const state = classifyCapabilityError(new Error('Feature unavailable on this platform'));
    expect(state).toBe('unavailable');
  });

  it('executes a happy path to terminal success', async () => {
    const result: CapabilityResult<number> = await executeCapability(async () => 7);
    expect(result.state).toBe('success');
    expect(result.value).toBe(7);
    expect(isCapabilityTerminal(result.state)).toBe(true);
  });

  it('executes failure path to terminal terminal state', async () => {
    const result = await executeCapability(async () => {
      throw new CapabilityStateError('unavailable', false, 'health unavailable');
    });

    expect(result.state).toBe('unavailable');
    expect(result.message).toBe('health unavailable');
    expect(isCapabilityTerminal(result.state)).toBe(true);
  });
});
