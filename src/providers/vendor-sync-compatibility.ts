import { createInMemorySharedStateSyncAdapter, runSharedStateSyncProof, type SharedStateSyncProof } from '@/src/providers/shared-state-sync';

export const VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION = 'utopia.vendor-sync-compatibility.v1' as const;

export type VendorName = 'powersync' | 'electric';
export type CompatibilityStatus = 'supported' | 'shim-required' | 'blocked';
export type CompatibilityFacet =
  | 'workspace_scope'
  | 'append_operations'
  | 'tombstones'
  | 'cursor_checkpoint'
  | 'conflict_manual_review'
  | 'offline_replay';

export type CompatibilityFacetReport = Readonly<{
  facet: CompatibilityFacet;
  status: CompatibilityStatus;
  mapping: string;
  evidence: readonly string[];
}>;

export type VendorCompatibilityReport = Readonly<{
  schemaVersion: typeof VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION;
  evidenceKind: 'documentation_assessment';
  liveServiceProof: false;
  vendor: VendorName;
  sharedStateSync: SharedStateSyncProof;
  facets: readonly CompatibilityFacetReport[];
  supported: readonly CompatibilityFacet[];
  shimRequired: readonly CompatibilityFacet[];
  blocked: readonly CompatibilityFacet[];
}>;

export type VendorCompatibilityAssessment = Readonly<{
  vendor: VendorName;
  assess(proof: SharedStateSyncProof): VendorCompatibilityReport;
}>;

export type VendorCompatibilityEvidence = Readonly<{
  schemaVersion: typeof VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION;
  sharedStateSync: SharedStateSyncProof;
  vendors: readonly VendorCompatibilityReport[];
}>;

const POWER_SYNC_DOCS = [
  'https://docs.powersync.com/intro/setup-guide',
  'https://docs.powersync.com/handling-writes/handling-update-conflicts',
  'https://docs.powersync.com/handling-writes/custom-conflict-resolution',
  'https://docs.powersync.com/handling-writes/custom-write-checkpoints',
  'https://docs.powersync.com/architecture/consistency',
] as const;

const ELECTRIC_DOCS = [
  'https://electric-sql.com/docs/intro',
  'https://electric-sql.com/docs/guides/client-development',
  'https://electric-sql.com/docs/guides/writes',
] as const;

const FACET_ORDER: readonly CompatibilityFacet[] = [
  'workspace_scope',
  'append_operations',
  'tombstones',
  'cursor_checkpoint',
  'conflict_manual_review',
  'offline_replay',
];

const POWER_SYNC_MATRIX: Record<CompatibilityFacet, Omit<CompatibilityFacetReport, 'facet'>> = {
  workspace_scope: {
    status: 'shim-required',
    mapping: 'workspace_id and installation_id require Utopia-owned Sync Stream or Sync Rules filters.',
    evidence: POWER_SYNC_DOCS,
  },
  append_operations: {
    status: 'supported',
    mapping: 'append-only CRUD batches map cleanly to PowerSync uploads with per-client operation ids.',
    evidence: POWER_SYNC_DOCS,
  },
  tombstones: {
    status: 'shim-required',
    mapping: 'PowerSync carries DELETE operations; Utopia backend must enforce tombstone retention and delete-wins policy.',
    evidence: POWER_SYNC_DOCS,
  },
  cursor_checkpoint: {
    status: 'shim-required',
    mapping: 'PowerSync checkpoints exist, but Utopia must persist and translate its per-device cursor contract.',
    evidence: POWER_SYNC_DOCS,
  },
  conflict_manual_review: {
    status: 'shim-required',
    mapping: 'PowerSync can surface conflicts, but the manual-review queue remains app-owned.',
    evidence: POWER_SYNC_DOCS,
  },
  offline_replay: {
    status: 'supported',
    mapping: 'queued local writes replay through the sync cursor after reconnect.',
    evidence: POWER_SYNC_DOCS,
  },
};

const ELECTRIC_MATRIX: Record<CompatibilityFacet, Omit<CompatibilityFacetReport, 'facet'>> = {
  workspace_scope: {
    status: 'shim-required',
    mapping: 'workspace scope maps to a shape definition plus table/where filters in the client stream.',
    evidence: ELECTRIC_DOCS,
  },
  append_operations: {
    status: 'blocked',
    mapping: 'Electric is read-path only; local append/writeback is not built in.',
    evidence: ELECTRIC_DOCS,
  },
  tombstones: {
    status: 'shim-required',
    mapping: 'row deletes can be projected, but local tombstone semantics need an app-layer shim.',
    evidence: ELECTRIC_DOCS,
  },
  cursor_checkpoint: {
    status: 'shim-required',
    mapping: 'Electric shape offsets support resumption; Utopia must translate them into its per-device cursor contract.',
    evidence: ELECTRIC_DOCS,
  },
  conflict_manual_review: {
    status: 'blocked',
    mapping: 'there is no built-in write conflict path to hand to a review queue.',
    evidence: ELECTRIC_DOCS,
  },
  offline_replay: {
    status: 'shim-required',
    mapping: 'the app must persist the last cursor/offset and rebuild any offline mutation queue itself.',
    evidence: ELECTRIC_DOCS,
  },
};

function buildVendorReport(
  vendor: VendorName,
  proof: SharedStateSyncProof,
  matrix: Record<CompatibilityFacet, Omit<CompatibilityFacetReport, 'facet'>>,
): VendorCompatibilityReport {
  const facets = FACET_ORDER.map((facet) => ({ facet, ...matrix[facet] }));
  return {
    schemaVersion: VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION,
    evidenceKind: 'documentation_assessment',
    liveServiceProof: false,
    vendor,
    sharedStateSync: proof,
    facets,
    supported: facets.filter((facet) => facet.status === 'supported').map((facet) => facet.facet),
    shimRequired: facets.filter((facet) => facet.status === 'shim-required').map((facet) => facet.facet),
    blocked: facets.filter((facet) => facet.status === 'blocked').map((facet) => facet.facet),
  };
}

export function createPowerSyncCompatibilityAssessment(): VendorCompatibilityAssessment {
  return {
    vendor: 'powersync',
    assess(proof: SharedStateSyncProof): VendorCompatibilityReport {
      return buildVendorReport('powersync', proof, POWER_SYNC_MATRIX);
    },
  };
}

export function createElectricCompatibilityAssessment(): VendorCompatibilityAssessment {
  return {
    vendor: 'electric',
    assess(proof: SharedStateSyncProof): VendorCompatibilityReport {
      return buildVendorReport('electric', proof, ELECTRIC_MATRIX);
    },
  };
}

export function runVendorCompatibilityEvidence(): VendorCompatibilityEvidence {
  const proof = runSharedStateSyncProof(createInMemorySharedStateSyncAdapter());
  return {
    schemaVersion: VENDOR_SYNC_COMPATIBILITY_SCHEMA_VERSION,
    sharedStateSync: proof,
    vendors: [
      createPowerSyncCompatibilityAssessment().assess(proof),
      createElectricCompatibilityAssessment().assess(proof),
    ],
  };
}
