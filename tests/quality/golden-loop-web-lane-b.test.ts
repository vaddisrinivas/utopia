import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { buildWebLaneBEnvironment, resolveWebLaneBReceiptPath } from '../../scripts/quality/golden-loop/run-web-lane-b.mjs';

describe('web lane B environment', () => {
  const root = '/tmp/utopia-web-lane-b-test';
  const emptyEnv = {} as NodeJS.ProcessEnv;

  it('resolves default web lane receipt path from repo root', () => {
    expect(resolveWebLaneBReceiptPath(emptyEnv, root)).toBe(resolve(root, 'app', 'build', 'evidence', 'golden-loop', 'web-execution-receipt.json'));
  });

  it('resolves explicit lane receipt path relative and absolute', () => {
    expect(resolveWebLaneBReceiptPath({ UTOPIA_WEB_LANE_B_RECEIPT_PATH: 'artifacts/web.json' } as unknown as NodeJS.ProcessEnv, root))
      .toBe(join(root, 'artifacts', 'web.json'));

    const absolute = '/tmp/custom/web-execution-receipt.json';
    expect(resolveWebLaneBReceiptPath({ UTOPIA_WEB_LANE_B_RECEIPT_PATH: absolute } as unknown as NodeJS.ProcessEnv, root)).toBe(absolute);
  });

  it('propagates lane bridge request into runtime env', () => {
    const env = buildWebLaneBEnvironment({
      root,
      env: {
        UTOPIA_WEB_LANE_B_RECEIPT_PATH: 'artifacts/web.json',
      } as unknown as NodeJS.ProcessEnv,
      requireBridge: true,
    });

    expect(env.UTOPIA_WEB_GOLDEN_LOOP_EXECUTION_RECEIPT_PATH).toBe(join(root, 'artifacts', 'web.json'));
    expect(env.UTOPIA_WEB_GOLDEN_LOOP_DEBUG_BRIDGE).toBe('1');
  });
});
