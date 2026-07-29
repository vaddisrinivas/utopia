import { describe, expect, it } from 'vitest';

import { createInMemorySharedStateSyncAdapter, runSharedStateSyncProof } from '@/src/providers/shared-state-sync';
import {
  createElectricCompatibilityAssessment,
  createPowerSyncCompatibilityAssessment,
  runVendorCompatibilityEvidence,
  VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION,
} from '@/src/providers/vendor-sync-compatibility';

describe('vendor sync compatibility', () => {
  it('runs PowerSync and Electric against the same shared-state proof', () => {
    const sharedStateProof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());
    const powerSync = createPowerSyncCompatibilityAssessment().assess(sharedStateProof);
    const electric = createElectricCompatibilityAssessment().assess(sharedStateProof);
    const evidence = runVendorCompatibilityEvidence();

    expect(sharedStateProof.all_passed).toBe(true);
    expect(powerSync.schemaVersion).toBe(VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION);
    expect(electric.schemaVersion).toBe(VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION);
    expect(powerSync.sharedStateSync.offline_writes).toEqual(sharedStateProof.offline_writes);
    expect(electric.sharedStateSync.offline_writes).toEqual(sharedStateProof.offline_writes);
    expect(powerSync.evidenceKind).toBe('documentation_assessment');
    expect(powerSync.liveServiceProof).toBe(false);
    expect(powerSync.supported).toEqual(['append_operations', 'offline_replay']);
    expect(powerSync.shimRequired).toEqual([
      'workspace_scope',
      'tombstones',
      'cursor_checkpoint',
      'conflict_manual_review',
    ]);
    expect(powerSync.blocked).toEqual([]);
    expect(electric.supported).toEqual([]);
    expect(electric.shimRequired).toEqual([
      'workspace_scope',
      'tombstones',
      'cursor_checkpoint',
      'offline_replay',
    ]);
    expect(electric.blocked).toEqual([
      'append_operations',
      'conflict_manual_review',
    ]);
    expect(powerSync.facets.find((facet) => facet.facet === 'append_operations')?.mapping).toContain('operation ids');
    expect(electric.facets.find((facet) => facet.facet === 'append_operations')?.mapping).toContain('read-path only');
    expect(evidence.vendors.map((vendor) => vendor.vendor)).toEqual(['powersync', 'electric']);
  });
});
