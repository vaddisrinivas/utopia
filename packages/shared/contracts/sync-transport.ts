export const SYNC_TRANSPORT_SCHEMA_VERSION = 'utopia.sync-transport.v1' as const;

export type SyncTransportReadiness = 'PASS' | 'BLOCKED';
export type SyncTransportBoundaryStatus = 'SUPPORTED' | 'BLOCKED';

export type SyncTransportCap =
  | 'append_operations'
  | 'per_installation'
  | 'cursor_checkpoint'
  | 'tombstones'
  | 'conflict_manual_review'
  | 'offline_replay';

export type SyncTransportPortContract = Readonly<{
  schemaVersion: typeof SYNC_TRANSPORT_SCHEMA_VERSION;
  transport: {
    kind: 'vendor-neutral-operation-stream';
    requiredCaps: readonly SyncTransportCap[];
    optionalCaps: readonly SyncTransportCap[];
  };
  readiness: {
    localDeterministic: {
      status: SyncTransportReadiness;
    };
    liveProviderDevice: {
      status: SyncTransportReadiness;
      requiredNextProof: string;
    };
  };
  status: SyncTransportBoundaryStatus;
  reason: string;
}>;

export type SyncTransportVendorName = 'powersync';

export type SyncTransportVendorEvaluation = Readonly<{
  schemaVersion: typeof SYNC_TRANSPORT_SCHEMA_VERSION;
  vendor: SyncTransportVendorName;
  evidenceKind: 'documentation_assessment';
  syncPortStatus: SyncTransportBoundaryStatus;
  syncPort: SyncTransportPortContract;
  supported: readonly SyncTransportCap[];
  shimRequired: readonly SyncTransportCap[];
  blocked: readonly SyncTransportCap[];
  notes: readonly string[];
}>;

export type SyncTransportEvaluationEvidence = Readonly<{
  proof: 'vendor_neutral_sync_transport';
  schemaVersion: typeof SYNC_TRANSPORT_SCHEMA_VERSION;
  status: SyncTransportBoundaryStatus;
  syncPort: SyncTransportPortContract;
  vendors: readonly SyncTransportVendorEvaluation[];
}>;
