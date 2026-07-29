export type UtopiaPublisherTrustSnapshotFloor = Readonly<{
  minimumAcceptedSnapshotVersion: number;
  snapshotId: string;
  rootKeyId: string;
}>;

export type UtopiaPublisherTrustPersistence = Readonly<{
  load: () => Promise<UtopiaPublisherTrustSnapshotFloor | null>;
  /**
   * Implementations must atomically retain the highest version and must never
   * replace an equal version with a different snapshot or root identity.
   */
  save: (floor: UtopiaPublisherTrustSnapshotFloor) => Promise<void>;
}>;
