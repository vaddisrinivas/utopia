import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateAndroidProofReceipts, validateAndroidProofReceipt } from '../../scripts/quality/android/validate-android-proof-receipt.mjs';

const base = (serial = 'emulator-5554') => ({
  proof: 'utopia.shell-proof-protocol.v1',
  status: 'PASS',
  checked_at: '2026-07-31T12:00:00.000Z',
  run_id: 'run-1',
  source: { surface: 'android', emulator_serial: serial },
  package_checksum: `sha256:${'a'.repeat(64)}`,
  execution: {
    observations: [{ driver: `adb:${serial}`, artifact: { path: 'observations/runtime.json' } }],
  },
});

describe('Android proof receipt truth gate', () => {
  it('requires fresh receipts with Android runtime observations', () => {
    expect(validateAndroidProofReceipt(base(), { now: Date.parse('2026-07-31T12:05:00.000Z') }).pass).toBe(true);
    expect(validateAndroidProofReceipt(base(), { now: Date.parse('2026-07-31T12:16:00.000Z') }).blockers)
      .toContain('receipt_checked_at_too_old');
  });

  it('rejects fabricated synthetic PASS proof', () => {
    expect(validateAndroidProofReceipt({ ...base(), synthetic_plan_is_not_device_proof: true }, {
      now: Date.parse('2026-07-31T12:05:00.000Z'),
    }).blockers).toContain('synthetic_receipt:android');
  });

  it('keeps unavailable runtime BLOCKED and requires two distinct emulators', () => {
    const blocked = { proof: 'utopia.shell-proof-protocol.v1', status: 'BLOCKED', checked_at: '2026-07-31T12:00:00.000Z', blocker: { reason: 'missing:adb' }, source: { surface: 'android', emulator_serial: 'emulator-5554' } };
    expect(validateAndroidProofReceipt(blocked, { now: Date.parse('2026-07-31T12:05:00.000Z') }).status).toBe('BLOCKED');
    expect(aggregateAndroidProofReceipts([
      { receipt: blocked, root: '.', path: 'a.json', label: 'a' },
    ], { now: Date.parse('2026-07-31T12:05:00.000Z') }).status).toBe('BLOCKED');
  });

  it('accepts the lane blocked receipt emitted when the bridge is absent', () => {
    const blocked = {
      proof: 'utopia.shell-proof-protocol.v1',
      status: 'BLOCKED',
      checked_at: '2026-07-31T12:00:00.000Z',
      blocker: { reason: 'missing:android_golden_loop_debug_bridge' },
      source: { surface: 'android' },
    };
    expect(validateAndroidProofReceipt(blocked, {
      now: Date.parse('2026-07-31T12:05:00.000Z'),
    })).toMatchObject({ status: 'BLOCKED', pass: false });
  });

  it('requires Android release export and debug bridge exclusion checks', () => {
    const workflow = readFileSync(resolve('.github/workflows/golden-loop-android-emulators.yml'), 'utf8');
    const allSurfacesWorkflow = readFileSync(resolve('.github/workflows/golden-loop-all-surfaces.yml'), 'utf8');
    const exclusionGate = readFileSync(resolve('scripts/quality/check-release-debug-bridge-exclusion.mjs'), 'utf8');
    expect(workflow).toContain('UTOPIA_RELEASE_BUNDLE=1 npm run export:android');
    expect(workflow).toContain('node scripts/quality/check-release-debug-bridge-exclusion.mjs');
    expect(workflow).toContain('EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG');
    expect(workflow).toContain('EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN');
    expect(allSurfacesWorkflow).toContain('EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG');
    expect(allSurfacesWorkflow).toContain('EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN');
    expect(exclusionGate).toContain("'GoldenLoopDebugBridge'");
    expect(exclusionGate).toContain("'__UTOPIA_GOLDEN_LOOP_DEBUG__'");
  });
});
