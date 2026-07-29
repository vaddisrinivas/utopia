import { canonicalJson } from '@/packages/shared/contracts/canonical-json';

export const AUDIO_LOOP_PACKAGE_ID = 'audio-loop-108' as const;
export const AUDIO_LOOP_LABEL = 'Audio Loop' as const;

export type AudioLoopAssetSource = 'imported' | 'recorded';

export type AudioLoopLoopCount =
  | Readonly<{ kind: 'count'; value: number }>
  | Readonly<{ kind: 'infinite' }>;

export type AudioLoopPlaybackSettings = Readonly<{
  schemaVersion: 'wonder.audio-loop-playback-settings.v1';
  loopCount: AudioLoopLoopCount;
  startDelaySeconds: number;
  betweenPlayDelaySeconds: number;
  resumePositionSeconds: number;
  volume: number;
}>;

export type AudioLoopAssetReference = Readonly<{
  schemaVersion: 'wonder.audio-loop-asset-reference.v1';
  id: string;
  displayName: string;
  source: AudioLoopAssetSource;
  durableUri: string;
  sourceUri: string | null;
  mimeType: string | null;
  originalName: string | null;
  bytes: number | null;
  checksum: string | null;
  createdAt: string;
  recordedAt: string | null;
  lastOpenedAt: string | null;
  lastPositionSeconds: number | null;
}>;

export type AudioLoopPlaylist = Readonly<{
  schemaVersion: 'wonder.audio-loop-playlist.v1';
  id: string;
  name: string;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
}>;

export type AudioLoopHistoryEntry = Readonly<{
  schemaVersion: 'wonder.audio-loop-history-entry.v1';
  id: string;
  assetId: string | null;
  playlistId: string | null;
  status: 'completed' | 'stopped' | 'skipped' | 'failed' | 'paused';
  startedAt: string;
  finishedAt: string | null;
  completedLoops: number;
  loopCount: AudioLoopLoopCount;
  settings: AudioLoopPlaybackSettings;
  note: string | null;
}>;

export type AudioLoopPlaylistNavigation = Readonly<{
  playlistId: string | null;
  assetIds: readonly string[];
  activeAssetId: string | null;
  activeIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
}>;

export type AudioLoopStateV2 = Readonly<{
  schemaVersion: 'wonder.audio-loop-state.v2';
  packageId: typeof AUDIO_LOOP_PACKAGE_ID;
  label: typeof AUDIO_LOOP_LABEL;
  activeAssetId: string | null;
  activePlaylistId: string | null;
  assets: AudioLoopAssetReference[];
  playlists: AudioLoopPlaylist[];
  history: AudioLoopHistoryEntry[];
  lastPlaybackSettings: AudioLoopPlaybackSettings;
  lastPositionSeconds: number;
  updatedAt: string;
}>;

export type AudioLoopStateV1 = Readonly<{
  schemaVersion: 'wonder.audio-loop-state.v1';
  fileName?: string | null;
  durableUri?: string | null;
  sourceUri?: string | null;
  source?: AudioLoopAssetSource | null;
  displayName?: string | null;
  mimeType?: string | null;
  originalName?: string | null;
  bytes?: number | null;
  checksum?: string | null;
  recordedAt?: string | null;
  completedPlays?: number | null;
  loopCount?: unknown;
  delaySeconds?: unknown;
  startDelaySeconds?: unknown;
  resumePositionSeconds?: unknown;
  volume?: unknown;
  activePlaylistId?: string | null;
  history?: Array<{
    id?: string | null;
    assetId?: string | null;
    playlistId?: string | null;
    status?: AudioLoopHistoryEntry['status'] | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    completedLoops?: unknown;
    loopCount?: unknown;
    delaySeconds?: unknown;
    startDelaySeconds?: unknown;
    resumePositionSeconds?: unknown;
    volume?: unknown;
    note?: string | null;
  }>;
  playlists?: Array<{
    id?: string | null;
    name?: string | null;
    assetIds?: unknown[];
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
}>;

export type AudioLoopStateEnvelope = AudioLoopStateV1 | AudioLoopStateV2;

export type AudioLoopAssetMaterialization = Readonly<{
  durableUri: string;
  fileName: string;
  displayName?: string;
  mimeType?: string | null;
  bytes?: number | null;
  checksum?: string | null;
}>;

export type AudioLoopAssetMaterializer = Readonly<{
  materialize(input: {
    sourceUri: string;
    source: AudioLoopAssetSource;
    preferredName: string;
    recordedAt: string;
  }): Promise<AudioLoopAssetMaterialization>;
  hasDurableUri?(durableUri: string): boolean | Promise<boolean>;
}>;

export type AudioLoopRecoverySnapshot = Readonly<{
  schemaVersion: 'wonder.audio-loop-recovery.v1';
  ready: boolean;
  state: AudioLoopStateV2;
  availableAssetIds: string[];
  missingAssetIds: string[];
  resumeAssetId: string | null;
  resumePlaylistId: string | null;
  resumePositionSeconds: number;
  resumeSettings: AudioLoopPlaybackSettings;
}>;

export function normalizeAudioLoopLoopCount(value: unknown, fallback: AudioLoopLoopCount = { kind: 'count', value: 1 }): AudioLoopLoopCount {
  if (isRecord(value)) {
    const mode = text(value.kind, text(value.mode));
    if (mode === 'infinite') return { kind: 'infinite' };
    if (mode === 'count' || 'value' in value || 'count' in value) {
      const candidate = positiveWholeNumber(value.value ?? value.count ?? value.loopCount);
      return candidate ? { kind: 'count', value: candidate } : fallback;
    }
  }
  if (text(value) === 'infinite') return { kind: 'infinite' };
  const candidate = positiveWholeNumber(value);
  return candidate ? { kind: 'count', value: candidate } : fallback;
}

export function normalizeAudioLoopPlaybackSettings(input: unknown, fallback?: Partial<AudioLoopPlaybackSettings>): AudioLoopPlaybackSettings {
  const source = isRecord(input) ? input : {};
  return {
    schemaVersion: 'wonder.audio-loop-playback-settings.v1',
    loopCount: normalizeAudioLoopLoopCount(source.loopCount ?? source.targetPlays ?? fallback?.loopCount),
    startDelaySeconds: nonNegativeSeconds(source.startDelaySeconds ?? source.delaySeconds ?? fallback?.startDelaySeconds),
    betweenPlayDelaySeconds: nonNegativeSeconds(source.betweenPlayDelaySeconds ?? source.delaySeconds ?? fallback?.betweenPlayDelaySeconds),
    resumePositionSeconds: nonNegativeSeconds(source.resumePositionSeconds ?? source.positionSeconds ?? fallback?.resumePositionSeconds),
    volume: boundedRatio(source.volume ?? fallback?.volume, fallback?.volume ?? 1),
  };
}

export function makeAudioLoopCollisionSafeName(baseName: unknown, existingNames: readonly string[] = []): string {
  const base = text(baseName, 'Untitled recording');
  const taken = new Set(existingNames.map((value) => text(value).toLowerCase()).filter(Boolean));
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  return candidate;
}

export function createAudioLoopAssetReference(input: {
  id?: string;
  durableUri: string;
  source: AudioLoopAssetSource;
  displayName?: string;
  sourceUri?: string | null;
  mimeType?: string | null;
  originalName?: string | null;
  bytes?: number | null;
  checksum?: string | null;
  createdAt?: string;
  recordedAt?: string | null;
  lastOpenedAt?: string | null;
  lastPositionSeconds?: number | null;
  existingNames?: readonly string[];
}): AudioLoopAssetReference {
  const createdAt = isoTimestamp(input.createdAt);
  const originalName = text(input.originalName, text(input.sourceUri ? fileNameFromUri(input.sourceUri) : null));
  const fallbackName = input.source === 'recorded'
    ? makeAudioLoopRecordingDisplayName(createdAt)
    : text(input.displayName, text(originalName, text(input.durableUri ? fileNameFromUri(input.durableUri) : null, 'Untitled audio')));
  const displayName = makeAudioLoopCollisionSafeName(input.displayName ?? fallbackName, input.existingNames ?? []);
  return {
    schemaVersion: 'wonder.audio-loop-asset-reference.v1',
    id: text(input.id, `asset-${shortHash([input.durableUri, createdAt])}`),
    displayName,
    source: input.source,
    durableUri: text(input.durableUri),
    sourceUri: textOrNull(input.sourceUri),
    mimeType: textOrNull(input.mimeType),
    originalName: textOrNull(originalName),
    bytes: numberOrNull(input.bytes),
    checksum: textOrNull(input.checksum),
    createdAt,
    recordedAt: textOrNull(input.recordedAt ?? (input.source === 'recorded' ? createdAt : null)),
    lastOpenedAt: textOrNull(input.lastOpenedAt),
    lastPositionSeconds: numberOrNull(input.lastPositionSeconds),
  };
}

export function makeAudioLoopRecordingDisplayName(recordedAt: string): string {
  const normalized = isoTimestamp(recordedAt);
  return `Recording ${normalized.slice(0, 19).replace('T', ' ').replace(/:/g, '-')}`;
}

export function createAudioLoopPlaylist(input: {
  id?: string;
  name: unknown;
  assetIds?: readonly string[];
  createdAt?: string;
  updatedAt?: string;
}): AudioLoopPlaylist {
  const createdAt = isoTimestamp(input.createdAt);
  const updatedAt = isoTimestamp(input.updatedAt ?? createdAt);
  return {
    schemaVersion: 'wonder.audio-loop-playlist.v1',
    id: text(input.id, `playlist-${shortHash([text(input.name, 'Playlist'), createdAt])}`),
    name: text(input.name, 'Playlist'),
    assetIds: normalizeIdList(input.assetIds ?? []),
    createdAt,
    updatedAt,
  };
}

export function createAudioLoopHistoryEntry(input: {
  id?: string;
  assetId?: string | null;
  playlistId?: string | null;
  status?: AudioLoopHistoryEntry['status'];
  startedAt?: string;
  finishedAt?: string | null;
  completedLoops?: unknown;
  loopCount?: unknown;
  settings?: unknown;
  note?: string | null;
}): AudioLoopHistoryEntry {
  const startedAt = isoTimestamp(input.startedAt);
  return {
    schemaVersion: 'wonder.audio-loop-history-entry.v1',
    id: text(input.id, `history-${shortHash([text(input.assetId), startedAt, text(input.playlistId)])}`),
    assetId: textOrNull(input.assetId),
    playlistId: textOrNull(input.playlistId),
    status: input.status ?? 'completed',
    startedAt,
    finishedAt: textOrNull(input.finishedAt),
    completedLoops: positiveWholeNumber(input.completedLoops) ?? 0,
    loopCount: normalizeAudioLoopLoopCount(input.loopCount),
    settings: normalizeAudioLoopPlaybackSettings(input.settings),
    note: textOrNull(input.note),
  };
}

export function createAudioLoopState(input: Partial<AudioLoopStateV2> & {
  assets?: readonly AudioLoopAssetReference[];
  playlists?: readonly AudioLoopPlaylist[];
  history?: readonly AudioLoopHistoryEntry[];
  lastPlaybackSettings?: Partial<AudioLoopPlaybackSettings>;
} = {}): AudioLoopStateV2 {
  const updatedAt = isoTimestamp(input.updatedAt);
  return normalizeAudioLoopState({
    schemaVersion: 'wonder.audio-loop-state.v2',
    packageId: AUDIO_LOOP_PACKAGE_ID,
    label: AUDIO_LOOP_LABEL,
    activeAssetId: textOrNull(input.activeAssetId),
    activePlaylistId: textOrNull(input.activePlaylistId),
    assets: input.assets ?? [],
    playlists: input.playlists ?? [],
    history: input.history ?? [],
    lastPlaybackSettings: normalizeAudioLoopPlaybackSettings(input.lastPlaybackSettings),
    lastPositionSeconds: nonNegativeSeconds(input.lastPositionSeconds),
    updatedAt,
  });
}

export function normalizeAudioLoopState(input: AudioLoopStateEnvelope): AudioLoopStateV2 {
  if (input.schemaVersion === 'wonder.audio-loop-state.v1') {
    return upgradeAudioLoopStateV1(input);
  }
  return normalizeAudioLoopStateV2(input);
}

export function normalizeAudioLoopStateV2(input: AudioLoopStateV2): AudioLoopStateV2 {
  const assets = dedupeById(input.assets ?? []).map((asset) => createAudioLoopAssetReference({
    ...asset,
    existingNames: dedupeById(input.assets ?? []).filter((candidate) => candidate.id !== asset.id).map((candidate) => candidate.displayName),
  }));
  const playlists = dedupeById(input.playlists ?? []).map((playlist) => ({
    ...createAudioLoopPlaylist(playlist),
    assetIds: normalizeIdList(playlist.assetIds),
    createdAt: isoTimestamp(playlist.createdAt),
    updatedAt: isoTimestamp(playlist.updatedAt ?? playlist.createdAt),
  }));
  const history = dedupeById(input.history ?? []).map((entry) => createAudioLoopHistoryEntry({
    ...entry,
    settings: entry.settings,
  }));
  const activeAssetId = pickExistingId(input.activeAssetId, assets.map((asset) => asset.id));
  const activePlaylistId = pickExistingId(input.activePlaylistId, playlists.map((playlist) => playlist.id));
  const lastPlaybackSettings = normalizeAudioLoopPlaybackSettings(input.lastPlaybackSettings);
  const lastPositionSeconds = nonNegativeSeconds(input.lastPositionSeconds);
  return {
    schemaVersion: 'wonder.audio-loop-state.v2',
    packageId: AUDIO_LOOP_PACKAGE_ID,
    label: AUDIO_LOOP_LABEL,
    activeAssetId,
    activePlaylistId,
    assets,
    playlists: playlists.map((playlist) => ({
      ...playlist,
      assetIds: normalizeIdList(playlist.assetIds.filter((assetId) => assets.some((asset) => asset.id === assetId))),
    })),
    history,
    lastPlaybackSettings,
    lastPositionSeconds,
    updatedAt: isoTimestamp(input.updatedAt),
  };
}

export function upgradeAudioLoopStateV1(input: AudioLoopStateV1): AudioLoopStateV2 {
  const createdAt = isoTimestamp(input.recordedAt ?? input.playlists?.[0]?.createdAt ?? input.history?.[0]?.startedAt);
  const fileName = text(input.fileName, text(input.displayName, text(input.sourceUri ? fileNameFromUri(input.sourceUri) : null, 'Untitled audio')));
  const asset = createAudioLoopAssetReference({
    id: input.durableUri ? `asset-${shortHash([input.durableUri])}` : undefined,
    durableUri: text(input.durableUri, `audio-loop-legacy://${encodeURIComponent(fileName)}`),
    source: input.source ?? 'imported',
    displayName: fileName,
    sourceUri: textOrNull(input.sourceUri),
    mimeType: textOrNull(input.mimeType),
    originalName: text(input.originalName, fileName),
    bytes: numberOrNull(input.bytes),
    checksum: textOrNull(input.checksum),
    createdAt,
    recordedAt: textOrNull(input.recordedAt ?? (input.source === 'recorded' ? createdAt : null)),
    lastOpenedAt: createdAt,
    lastPositionSeconds: nonNegativeSeconds(input.resumePositionSeconds),
  });
  const playlistEntries = (input.playlists ?? []).map((playlist, index) => createAudioLoopPlaylist({
    id: text(playlist?.id, `playlist-${index + 1}`),
    name: playlist?.name ?? `Playlist ${index + 1}`,
    assetIds: normalizeIdList(playlist?.assetIds ?? [asset.id]),
    createdAt,
    updatedAt: playlist?.updatedAt ?? createdAt,
  }));
  return normalizeAudioLoopStateV2({
    schemaVersion: 'wonder.audio-loop-state.v2',
    packageId: AUDIO_LOOP_PACKAGE_ID,
    label: AUDIO_LOOP_LABEL,
    activeAssetId: asset.id,
    activePlaylistId: text(input.activePlaylistId, playlistEntries[0]?.id ?? null),
    assets: [asset],
    playlists: playlistEntries,
    history: normalizeLegacyHistory(input.history, asset.id, input.completedPlays, input.loopCount, input.delaySeconds, input.startDelaySeconds, input.resumePositionSeconds, input.volume),
    lastPlaybackSettings: normalizeAudioLoopPlaybackSettings({
      loopCount: input.loopCount,
      startDelaySeconds: input.startDelaySeconds,
      delaySeconds: input.delaySeconds,
      resumePositionSeconds: input.resumePositionSeconds,
      volume: input.volume,
    }),
    lastPositionSeconds: nonNegativeSeconds(input.resumePositionSeconds),
    updatedAt: createdAt,
  });
}

export function serializeAudioLoopState(state: AudioLoopStateEnvelope): string {
  return canonicalJson(normalizeAudioLoopState(state));
}

export function hydrateAudioLoopState(input: unknown): AudioLoopStateV2 {
  if (typeof input === 'string') {
    try {
      return hydrateAudioLoopState(JSON.parse(input) as unknown);
    } catch {
      return createAudioLoopState();
    }
  }
  if (!isRecord(input)) return createAudioLoopState();
  if (input.schemaVersion === 'wonder.audio-loop-state.v1') {
    return upgradeAudioLoopStateV1(input as AudioLoopStateV1);
  }
  if (input.schemaVersion === 'wonder.audio-loop-state.v2') {
    return normalizeAudioLoopStateV2(input as AudioLoopStateV2);
  }
  return createAudioLoopState();
}

export async function importAudioLoopAsset(
  state: AudioLoopStateEnvelope,
  input: {
    sourceUri: string;
    source?: AudioLoopAssetSource;
    preferredName?: string;
    recordedAt?: string;
  },
  driver: AudioLoopAssetMaterializer,
): Promise<AudioLoopStateV2> {
  const normalizedState = hydrateAudioLoopState(serializeAudioLoopState(state));
  const source = input.source ?? 'imported';
  const recordedAt = isoTimestamp(input.recordedAt);
  const fallbackName = source === 'recorded'
    ? makeAudioLoopRecordingDisplayName(recordedAt)
    : text(input.sourceUri ? fileNameFromUri(input.sourceUri) : null, 'Imported audio');
  const preferredName = text(input.preferredName, fallbackName);
  const materialized = await driver.materialize({
    sourceUri: input.sourceUri,
    source,
    preferredName,
    recordedAt,
  });
  const asset = createAudioLoopAssetReference({
    id: `asset-${shortHash([materialized.durableUri, recordedAt])}`,
    durableUri: materialized.durableUri,
    source,
    displayName: materialized.displayName ?? materialized.fileName ?? preferredName,
    sourceUri: input.sourceUri,
    mimeType: materialized.mimeType ?? null,
    originalName: materialized.fileName,
    bytes: materialized.bytes ?? null,
    checksum: materialized.checksum ?? null,
    createdAt: recordedAt,
    recordedAt: input.source === 'recorded' ? recordedAt : null,
    lastOpenedAt: recordedAt,
    lastPositionSeconds: 0,
    existingNames: normalizedState.assets.map((item) => item.displayName),
  });
  return normalizeAudioLoopStateV2({
    ...normalizedState,
    activeAssetId: asset.id,
    assets: [...normalizedState.assets, asset],
    lastPlaybackSettings: {
      ...normalizedState.lastPlaybackSettings,
      resumePositionSeconds: 0,
    },
    updatedAt: recordedAt,
  });
}

export function renameAudioLoopAsset(state: AudioLoopStateEnvelope, assetId: string, nextName: unknown): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const asset = normalized.assets.find((item) => item.id === assetId);
  if (!asset) return normalized;
  const names = normalized.assets.filter((item) => item.id !== assetId).map((item) => item.displayName);
  return normalizeAudioLoopStateV2({
    ...normalized,
    assets: normalized.assets.map((item) => item.id === assetId ? { ...item, displayName: makeAudioLoopCollisionSafeName(nextName, names) } : item),
    updatedAt: normalized.updatedAt,
  });
}

export function reorderAudioLoopAssets(state: AudioLoopStateEnvelope, assetIds: readonly string[]): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  return normalizeAudioLoopStateV2({
    ...normalized,
    assets: reorderById(normalized.assets, assetIds),
    playlists: normalized.playlists.map((playlist) => ({
      ...playlist,
      assetIds: normalizeIdList(playlist.assetIds.filter((id) => normalized.assets.some((asset) => asset.id === id))),
    })),
    activeAssetId: pickExistingId(normalized.activeAssetId, reorderById(normalized.assets, assetIds).map((asset) => asset.id)),
    updatedAt: normalized.updatedAt,
  });
}

export function removeAudioLoopAsset(state: AudioLoopStateEnvelope, assetId: string): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const assets = normalized.assets.filter((asset) => asset.id !== assetId);
  const playlists = normalized.playlists.map((playlist) => ({
    ...playlist,
    assetIds: normalizeIdList(playlist.assetIds.filter((id) => id !== assetId && assets.some((asset) => asset.id === id))),
  }));
  const history = normalized.history.filter((entry) => entry.assetId !== assetId);
  return normalizeAudioLoopStateV2({
    ...normalized,
    assets,
    playlists,
    history,
    activeAssetId: pickExistingId(normalized.activeAssetId, assets.map((asset) => asset.id)),
    updatedAt: normalized.updatedAt,
  });
}

export function renameAudioLoopImportedAsset(state: AudioLoopStateEnvelope, assetId: string, nextName: unknown): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const asset = normalized.assets.find((item) => item.id === assetId);
  if (!asset || asset.source !== 'imported') return normalized;
  return renameAudioLoopAsset(normalized, assetId, nextName);
}

export function renameAudioLoopRecordedAsset(state: AudioLoopStateEnvelope, assetId: string, nextName: unknown): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const asset = normalized.assets.find((item) => item.id === assetId);
  if (!asset || asset.source !== 'recorded') return normalized;
  return renameAudioLoopAsset(normalized, assetId, nextName);
}

export function removeAudioLoopPlaylist(state: AudioLoopStateEnvelope, playlistId: string): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlists = normalized.playlists.filter((playlist) => playlist.id !== playlistId);
  return normalizeAudioLoopStateV2({
    ...normalized,
    playlists,
    activePlaylistId: pickExistingId(normalized.activePlaylistId, playlists.map((playlist) => playlist.id)),
    updatedAt: normalized.updatedAt,
  });
}

export function removeAudioLoopAssetFromActivePlaylistAndHistory(state: AudioLoopStateEnvelope, assetId: string): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlistId = normalized.activePlaylistId;
  if (!playlistId) return normalized;
  const playlist = normalized.playlists.find((candidate) => candidate.id === playlistId);
  if (!playlist) return normalized;
  const nextAssetIds = normalizeIdList(playlist.assetIds.filter((id) => id !== assetId));
  if (nextAssetIds.length === playlist.assetIds.length) return normalized;
  return normalizeAudioLoopStateV2({
    ...normalized,
    playlists: normalized.playlists.map((candidate) => candidate.id === playlistId ? {
      ...candidate,
      assetIds: nextAssetIds,
      updatedAt: normalized.updatedAt,
    } : candidate),
    history: normalized.history.filter((entry) => entry.assetId !== assetId),
    activeAssetId: pickExistingId(normalized.activeAssetId, nextAssetIds),
    updatedAt: normalized.updatedAt,
  });
}

export function removeAudioLoopImportedAssetFromActivePlaylistAndHistory(state: AudioLoopStateEnvelope, assetId: string): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const asset = normalized.assets.find((item) => item.id === assetId);
  if (!asset || asset.source !== 'imported') return normalized;
  return removeAudioLoopAssetFromActivePlaylistAndHistory(normalized, assetId);
}

export function removeAudioLoopRecordedAssetFromActivePlaylistAndHistory(state: AudioLoopStateEnvelope, assetId: string): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const asset = normalized.assets.find((item) => item.id === assetId);
  if (!asset || asset.source !== 'recorded') return normalized;
  return removeAudioLoopAssetFromActivePlaylistAndHistory(normalized, assetId);
}

export function addAudioLoopPlaylist(state: AudioLoopStateEnvelope, input: { id?: string; name: unknown; assetIds?: readonly string[]; createdAt?: string }): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlist = createAudioLoopPlaylist({
    ...input,
    name: makeAudioLoopCollisionSafeName(input.name, normalized.playlists.map((item) => item.name)),
    assetIds: normalizeIdList(input.assetIds ?? []),
  });
  return normalizeAudioLoopStateV2({
    ...normalized,
    playlists: [...normalized.playlists, playlist],
    activePlaylistId: playlist.id,
    updatedAt: playlist.updatedAt,
  });
}

export function renameAudioLoopPlaylist(state: AudioLoopStateEnvelope, playlistId: string, nextName: unknown): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlist = normalized.playlists.find((item) => item.id === playlistId);
  if (!playlist) return normalized;
  const name = makeAudioLoopCollisionSafeName(nextName, normalized.playlists.filter((item) => item.id !== playlistId).map((item) => item.name));
  return normalizeAudioLoopStateV2({
    ...normalized,
    playlists: normalized.playlists.map((item) => item.id === playlistId ? { ...item, name, updatedAt: normalized.updatedAt } : item),
    updatedAt: normalized.updatedAt,
  });
}

export function reorderAudioLoopPlaylists(state: AudioLoopStateEnvelope, playlistIds: readonly string[]): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlists = reorderById(normalized.playlists, playlistIds);
  return normalizeAudioLoopStateV2({
    ...normalized,
    playlists,
    activePlaylistId: pickExistingId(normalized.activePlaylistId, playlists.map((playlist) => playlist.id)),
    updatedAt: normalized.updatedAt,
  });
}

export function setAudioLoopPlaylistAssets(state: AudioLoopStateEnvelope, playlistId: string, assetIds: readonly string[]): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  return normalizeAudioLoopStateV2({
    ...normalized,
    playlists: normalized.playlists.map((playlist) => playlist.id === playlistId ? {
      ...playlist,
      assetIds: normalizeIdList(assetIds.filter((assetId) => normalized.assets.some((asset) => asset.id === assetId))),
      updatedAt: normalized.updatedAt,
    } : playlist),
    updatedAt: normalized.updatedAt,
  });
}

export function getAudioLoopPlaylistNavigation(state: AudioLoopStateEnvelope): AudioLoopPlaylistNavigation {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlist = normalized.playlists.find((item) => item.id === normalized.activePlaylistId) ?? null;
  const assetIds = playlist
    ? playlist.assetIds.filter((assetId) => normalized.assets.some((asset) => asset.id === assetId))
    : [];
  const activeIndex = normalized.activeAssetId ? assetIds.indexOf(normalized.activeAssetId) : -1;
  return {
    playlistId: normalized.activePlaylistId,
    assetIds,
    activeAssetId: normalized.activeAssetId,
    activeIndex,
    hasPrevious: activeIndex > 0,
    hasNext: activeIndex >= 0 && activeIndex < assetIds.length - 1,
  };
}

export function moveAudioLoopAssetInActivePlaylist(state: AudioLoopStateEnvelope, direction: 'previous' | 'next'): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const navigation = getAudioLoopPlaylistNavigation(normalized);
  if (!navigation.assetIds.length) return normalized;
  let nextIndex = navigation.activeIndex;
  if (nextIndex < 0) {
    nextIndex = direction === 'previous' ? navigation.assetIds.length - 1 : 0;
  } else if (direction === 'previous') {
    nextIndex -= 1;
  } else {
    nextIndex += 1;
  }
  if (nextIndex < 0 || nextIndex >= navigation.assetIds.length) return normalized;
  const nextAssetId = navigation.assetIds[nextIndex];
  if (!nextAssetId) return normalized;
  return normalizeAudioLoopStateV2({
    ...normalized,
    activeAssetId: nextAssetId,
    updatedAt: normalized.updatedAt,
  });
}

export function createAudioLoopRecentPlaylist(
  state: AudioLoopStateEnvelope,
  input: {
    id?: string;
    name: unknown;
    createdAt?: string;
    maxAssets?: number;
  },
): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const maxAssets = (typeof input.maxAssets === 'number' && Number.isInteger(input.maxAssets) && input.maxAssets > 0)
    ? input.maxAssets
    : undefined;
  const recentAssetIds = [...normalized.assets]
    .sort((a, b) => {
      const aTime = Date.parse(a.lastOpenedAt ?? a.createdAt);
      const bTime = Date.parse(b.lastOpenedAt ?? b.createdAt);
      return bTime - aTime;
    })
    .map((asset) => asset.id)
    .slice(0, maxAssets ?? normalized.assets.length);
  const recentIds = normalizeIdList(recentAssetIds);
  if (!recentIds.length) return normalized;
  return addAudioLoopPlaylist(normalized, {
    id: input.id,
    name: text(input.name, 'Recent queue'),
    assetIds: recentIds,
    createdAt: input.createdAt,
  });
}

export function setAudioLoopActivePlaylist(state: AudioLoopStateEnvelope, playlistId: string): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const activePlaylistId = pickExistingId(playlistId, normalized.playlists.map((playlist) => playlist.id));
  if (activePlaylistId === normalized.activePlaylistId) return normalized;
  return normalizeAudioLoopStateV2({
    ...normalized,
    activePlaylistId,
  });
}

export function addCurrentAssetToActivePlaylist(state: AudioLoopStateEnvelope): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlistId = normalized.activePlaylistId;
  const assetId = normalized.activeAssetId;
  if (!playlistId || !assetId) return normalized;
  const playlist = normalized.playlists.find((candidate) => candidate.id === playlistId);
  if (!playlist || playlist.assetIds.includes(assetId)) return normalized;
  return setAudioLoopPlaylistAssets(normalized, playlistId, [...playlist.assetIds, assetId]);
}

export function removeCurrentAssetFromActivePlaylist(state: AudioLoopStateEnvelope): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlistId = normalized.activePlaylistId;
  const assetId = normalized.activeAssetId;
  if (!playlistId || !assetId) return normalized;
  const playlist = normalized.playlists.find((candidate) => candidate.id === playlistId);
  if (!playlist) return normalized;
  const nextAssetIds = playlist.assetIds.filter((id) => id !== assetId);
  if (nextAssetIds.length === playlist.assetIds.length) return normalized;
  return setAudioLoopPlaylistAssets(normalized, playlistId, nextAssetIds);
}

export function moveCurrentAssetInActivePlaylist(state: AudioLoopStateEnvelope, direction: 'up' | 'down'): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const playlistId = normalized.activePlaylistId;
  const assetId = normalized.activeAssetId;
  if (!playlistId || !assetId) return normalized;
  const playlist = normalized.playlists.find((candidate) => candidate.id === playlistId);
  if (!playlist) return normalized;
  const currentIndex = playlist.assetIds.indexOf(assetId);
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= playlist.assetIds.length) return normalized;
  const reordered = [...playlist.assetIds];
  [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
  return setAudioLoopPlaylistAssets(normalized, playlistId, reordered);
}

export function appendAudioLoopHistoryEntry(
  state: AudioLoopStateEnvelope,
  input: {
    assetId?: string | null;
    playlistId?: string | null;
    status?: AudioLoopHistoryEntry['status'];
    startedAt?: string;
    finishedAt?: string | null;
    completedLoops?: unknown;
    loopCount?: unknown;
    settings?: unknown;
    note?: string | null;
  },
): AudioLoopStateV2 {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const startedAt = isoTimestamp(input.startedAt);
  const history = [
    ...normalized.history,
    createAudioLoopHistoryEntry({
      ...input,
      startedAt,
    }),
  ];
  return normalizeAudioLoopStateV2({
    ...normalized,
    history,
    activeAssetId: pickExistingId(input.assetId ?? normalized.activeAssetId, normalized.assets.map((asset) => asset.id)),
    activePlaylistId: pickExistingId(input.playlistId ?? normalized.activePlaylistId, normalized.playlists.map((playlist) => playlist.id)),
    lastPlaybackSettings: normalizeAudioLoopPlaybackSettings(input.settings ?? normalized.lastPlaybackSettings),
    lastPositionSeconds: normalizeAudioLoopPlaybackSettings(input.settings ?? normalized.lastPlaybackSettings).resumePositionSeconds,
    updatedAt: startedAt,
  });
}

export async function recoverAudioLoopState(
  state: AudioLoopStateEnvelope,
  driver?: AudioLoopAssetMaterializer,
): Promise<AudioLoopRecoverySnapshot> {
  const normalized = hydrateAudioLoopState(serializeAudioLoopState(state));
  const availableAssetIds: string[] = [];
  const missingAssetIds: string[] = [];
  for (const asset of normalized.assets) {
    const available = driver?.hasDurableUri ? await driver.hasDurableUri(asset.durableUri) : true;
    if (available) availableAssetIds.push(asset.id);
    else missingAssetIds.push(asset.id);
  }
  const resumeAssetId = pickExistingId(
    normalized.activeAssetId,
    [...latestHistoryAssetIds(normalized.history, availableAssetIds), ...availableAssetIds],
  );
  const resumePlaylistId = pickExistingId(normalized.activePlaylistId, normalized.playlists.map((playlist) => playlist.id));
  const resumeSettings = normalized.lastPlaybackSettings;
  const resumePositionSeconds = normalized.lastPositionSeconds;
  return {
    schemaVersion: 'wonder.audio-loop-recovery.v1',
    ready: availableAssetIds.length > 0,
    state: normalizeAudioLoopStateV2({
      ...normalized,
      activeAssetId: resumeAssetId,
      activePlaylistId: resumePlaylistId,
      updatedAt: normalized.updatedAt,
    }),
    availableAssetIds,
    missingAssetIds,
    resumeAssetId,
    resumePlaylistId,
    resumePositionSeconds,
    resumeSettings,
  };
}

function normalizeLegacyHistory(
  history: AudioLoopStateV1['history'],
  assetId: string,
  completedPlays: number | null | undefined,
  loopCount: unknown,
  delaySeconds: unknown,
  startDelaySeconds: unknown,
  resumePositionSeconds: unknown,
  volume: unknown,
): AudioLoopHistoryEntry[] {
  if (history?.length) {
    return history.map((entry, index) => createAudioLoopHistoryEntry({
      ...entry,
      id: entry.id ?? `history-${index + 1}`,
      assetId: entry.assetId ?? assetId,
      playlistId: entry.playlistId ?? null,
      status: entry.status ?? 'completed',
      startedAt: entry.startedAt ?? new Date(0).toISOString(),
      finishedAt: entry.finishedAt ?? null,
      completedLoops: entry.completedLoops ?? completedPlays ?? 0,
      loopCount: entry.loopCount ?? loopCount,
      settings: {
        loopCount: entry.loopCount ?? loopCount,
        startDelaySeconds: entry.startDelaySeconds ?? startDelaySeconds ?? 0,
        betweenPlayDelaySeconds: entry.delaySeconds ?? delaySeconds ?? 0,
        resumePositionSeconds: entry.resumePositionSeconds ?? resumePositionSeconds ?? 0,
        volume: entry.volume ?? volume ?? 1,
      },
      note: entry.note ?? null,
    }));
  }
  if (!completedPlays) return [];
  return [
    createAudioLoopHistoryEntry({
      id: 'history-1',
      assetId,
      playlistId: null,
      status: 'completed',
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      completedLoops: completedPlays,
      loopCount,
      settings: {
        loopCount,
        startDelaySeconds,
        betweenPlayDelaySeconds: delaySeconds,
        resumePositionSeconds,
        volume,
      },
      note: 'legacy-v1',
    }),
  ];
}

function latestHistoryAssetIds(history: readonly AudioLoopHistoryEntry[], availableAssetIds: readonly string[]): string[] {
  const available = new Set(availableAssetIds);
  return [...history]
    .reverse()
    .map((entry) => entry.assetId)
    .filter((assetId): assetId is string => typeof assetId === 'string' && available.has(assetId));
}

function reorderById<T extends { id: string }>(items: readonly T[], nextOrder: readonly string[]): T[] {
  const seen = new Set<string>();
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const ordered: T[] = [];
  for (const id of nextOrder) {
    const item = byId.get(id);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    ordered.push(item);
  }
  return [...ordered, ...items.filter((item) => !seen.has(item.id))];
}

function normalizeIdList(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const id = text(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function positiveWholeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  if (isRecord(value)) {
    return positiveWholeNumber(value.value ?? value.count ?? value.loopCount);
  }
  return null;
}

function nonNegativeSeconds(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  if (isRecord(value)) return nonNegativeSeconds(value.value ?? value.seconds ?? value.positionSeconds);
  return 0;
}

function boundedRatio(value: unknown, fallback = 1): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.min(1, Math.max(0, parsed));
  }
  return Math.min(1, Math.max(0, fallback));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown, fallback: string | null = ''): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback ?? '';
}

function textOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isoTimestamp(value?: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function fileNameFromUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    const fromPath = parsed.pathname.split('/').filter(Boolean).pop();
    return text(fromPath, uri);
  } catch {
    return text(uri.split(/[\\/]/).filter(Boolean).pop(), uri);
  }
}

function shortHash(parts: unknown[]): string {
  return canonicalJson(parts).replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'audio';
}

function pickExistingId(candidate: string | null, availableIds: readonly string[]): string | null {
  if (candidate && availableIds.includes(candidate)) return candidate;
  return availableIds[0] ?? null;
}
