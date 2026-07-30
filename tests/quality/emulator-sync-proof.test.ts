import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EMULATOR_IDENTITIES,
  buildInstallProfiles,
  buildSyncScenario,
  evaluateSyncScenario,
  normalizeAvdIdentities,
  parseAdbDevices,
} from '../../scripts/quality/emulator-sync/emulator-sync-plan.mjs';

describe('emulator sync proof planner', () => {
  it('normalizes requested AVD identities deterministically', () => {
    const avds = normalizeAvdIdentities('emulator-5554, emulator-5556, emulator-5554, emulator-5558');
    expect(avds).toEqual(['emulator-5554', 'emulator-5556', 'emulator-5558']);
  });

  it('defaults to canonical AVD identities when input is empty', () => {
    const avds = normalizeAvdIdentities('');
    expect(avds).toEqual(DEFAULT_EMULATOR_IDENTITIES);
  });

  it('parses adb device list entries', () => {
    const output = [
      'List of devices attached',
      'emulator-5554 device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 device:emulator64_x86_64 transport_id:12',
      'emulator-5556 offline',
      'emulator-5558 device',
      '',
    ].join('\n');

    const devices = parseAdbDevices(output);
    expect(devices).toHaveLength(3);
    expect(devices[0]?.serial).toBe('emulator-5554');
    expect(devices[0]?.status).toBe('device');
    expect(devices[1]?.status).toBe('offline');
  });

  it('builds deterministic scenario assertions for distinct installations', () => {
    const profiles = buildInstallProfiles(['emulator-5554', 'emulator-5556', 'emulator-5558'], 'qa');
    const scenario = buildSyncScenario(profiles);
    const evaluation = evaluateSyncScenario(scenario);

    expect(scenario.scenario_id).toBe('convergence-conflict-rollback-v1');
    expect(scenario.operations).toHaveLength(3);
    expect(evaluation.all_passed).toBe(true);
    expect(evaluation.assertions.conflict_detected).toBe(true);
    expect(evaluation.assertions.rollback_replayed_for_losers).toBe(1);
    expect(evaluation.conflict_events).toHaveLength(1);
    expect(evaluation.conflict_events[0]?.winner.installation_id).toBe(
      profiles[0]?.installationId,
    );
    expect(evaluation.record_after.last_writer).toBe(profiles[0]?.installationId);
    expect(evaluation.rollback_operations[0]?.status).toBe('replayed');
  });
});
