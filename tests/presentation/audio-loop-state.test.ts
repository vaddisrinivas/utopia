import { describe, expect, it } from 'vitest';

import {
  AUDIO_LOOP_LABEL,
  AUDIO_LOOP_PACKAGE_ID,
  addAudioLoopPlaylist,
  addCurrentAssetToActivePlaylist,
  createAudioLoopAssetReference,
  createAudioLoopRecentPlaylist,
  removeAudioLoopRecordedAssetFromActivePlaylistAndHistory,
  makeAudioLoopRecordingDisplayName,
  createAudioLoopPlaylist,
  createAudioLoopState,
  hydrateAudioLoopState,
  importAudioLoopAsset,
  makeAudioLoopCollisionSafeName,
  renameAudioLoopImportedAsset,
  renameAudioLoopRecordedAsset,
  normalizeAudioLoopLoopCount,
  normalizeAudioLoopPlaybackSettings,
  getAudioLoopPlaylistNavigation,
  renameAudioLoopPlaylist,
  recoverAudioLoopState,
  moveAudioLoopAssetInActivePlaylist,
  removeCurrentAssetFromActivePlaylist,
  removeAudioLoopPlaylist,
  moveCurrentAssetInActivePlaylist,
  reorderAudioLoopAssets,
  reorderAudioLoopPlaylists,
  serializeAudioLoopState,
  setAudioLoopActivePlaylist,
  setAudioLoopPlaylistAssets,
  type AudioLoopStateV1,
} from '@/src/presentation/widgets/audio-loop-state';
import {
  buildRecorderStartCommand,
  createAudioLoopStorageMaterializer,
  startAudioLoopRecording,
  type AudioLoopStorageFileSystem,
} from '@/src/presentation/widgets/audio-loop-storage-bridge';

describe('audio loop state', () => {
  it('normalizes arbitrary whole counts and explicit infinite mode', () => {
    expect(normalizeAudioLoopLoopCount(1_000_000)).toEqual({ kind: 'count', value: 1_000_000 });
    expect(normalizeAudioLoopLoopCount({ kind: 'count', value: '7' })).toEqual({ kind: 'count', value: 7 });
    expect(normalizeAudioLoopLoopCount('infinite')).toEqual({ kind: 'infinite' });
    expect(normalizeAudioLoopLoopCount(0, { kind: 'count', value: 9 })).toEqual({ kind: 'count', value: 9 });
    expect(normalizeAudioLoopLoopCount(3.5, { kind: 'count', value: 9 })).toEqual({ kind: 'count', value: 9 });
    expect(normalizeAudioLoopLoopCount('nope', { kind: 'count', value: 9 })).toEqual({ kind: 'count', value: 9 });
  });

  it('collision-proofs names and keeps source labels intact', () => {
    expect(makeAudioLoopCollisionSafeName('Track', ['Track', 'Track (2)'])).toBe('Track (3)');

    const recorded = createAudioLoopAssetReference({
      durableUri: 'audio-loop://recorded/1',
      source: 'recorded',
      createdAt: '2026-07-29T10:00:00.000Z',
      existingNames: ['Recording 2026-07-29 10-00-00'],
    });

    expect(recorded.displayName).toBe('Recording 2026-07-29 10-00-00 (2)');
    expect(recorded.source).toBe('recorded');
  });

  it('keeps playlist ordering stable across add, reorder, and remove', () => {
    const state = createAudioLoopState({
      assets: [
        asset('a', 'alpha'),
        asset('b', 'bravo'),
        asset('c', 'charlie'),
      ],
    });

    const withPlaylist = addAudioLoopPlaylist(state, {
      id: 'road',
      name: 'Road',
      assetIds: ['c', 'a', 'c'],
      createdAt: '2026-07-29T00:00:00.000Z',
    });
    const reorderedAssets = reorderAudioLoopAssets(withPlaylist, ['c', 'a']);
    const reorderedPlaylists = reorderAudioLoopPlaylists({
      ...reorderedAssets,
      playlists: [
        createAudioLoopPlaylist({ id: 'slow', name: 'Slow', createdAt: '2026-07-29T00:00:00.000Z' }),
        createAudioLoopPlaylist({ id: 'fast', name: 'Fast', createdAt: '2026-07-29T00:00:01.000Z' }),
      ],
    }, ['fast']);
    const trimmed = setAudioLoopPlaylistAssets(reorderedPlaylists, 'fast', ['b', 'a', 'b']);
    const removed = removeAudioLoopPlaylist(trimmed, 'slow');

    expect(reorderedAssets.assets.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(trimmed.playlists.map((item) => item.id)).toEqual(['fast', 'slow']);
    expect(trimmed.playlists.find((item) => item.id === 'fast')?.assetIds).toEqual(['b', 'a']);
    expect(removed.playlists.map((item) => item.id)).toEqual(['fast']);
  });

  it('collision-safes playlist rename while preserving unrelated names', () => {
    const state = createAudioLoopState({
      playlists: [
        createAudioLoopPlaylist({
          id: 'main',
          name: 'Road',
          createdAt: '2026-07-29T00:00:00.000Z',
        }),
        createAudioLoopPlaylist({
          id: 'loop',
          name: 'Road (2)',
          createdAt: '2026-07-29T00:00:01.000Z',
        }),
        createAudioLoopPlaylist({
          id: 'backup',
          name: 'Backup',
          createdAt: '2026-07-29T00:00:02.000Z',
        }),
      ],
      activePlaylistId: 'backup',
    });

    const renamed = renameAudioLoopPlaylist(state, 'backup', 'ROAD');

    expect(renamed.activePlaylistId).toBe('backup');
    expect(renamed.playlists.find((playlist) => playlist.id === 'backup')?.name).toBe('ROAD (3)');
    expect(renamed.playlists.find((playlist) => playlist.id === 'main')?.name).toBe('Road');
    expect(renamed.playlists.find((playlist) => playlist.id === 'loop')?.name).toBe('Road (2)');
  });

  it('reorders playlists while keeping the selected playlist active', () => {
    const state = createAudioLoopState({
      playlists: [
        createAudioLoopPlaylist({ id: 'a', name: 'A', createdAt: '2026-07-29T00:00:00.000Z' }),
        createAudioLoopPlaylist({ id: 'b', name: 'B', createdAt: '2026-07-29T00:00:01.000Z' }),
        createAudioLoopPlaylist({ id: 'c', name: 'C', createdAt: '2026-07-29T00:00:02.000Z' }),
      ],
      activePlaylistId: 'c',
    });

    const reordered = reorderAudioLoopPlaylists(state, ['b', 'a']);

    expect(reordered.activePlaylistId).toBe('c');
    expect(reordered.playlists.map((playlist) => playlist.id)).toEqual(['b', 'a', 'c']);
  });

  it('renames imported and recorded assets with source-specific helpers', () => {
    const state = createAudioLoopState({
      assets: [
        asset('a', 'Kick', 'audio-loop://a', '2026-07-29T00:00:00.000Z'),
        asset('b', 'Focus', 'audio-loop://b', '2026-07-29T00:00:01.000Z'),
        recordedAsset('r', 'Recording', 'audio-loop://r', '2026-07-29T00:00:02.000Z'),
      ],
    });

    const renamedImported = renameAudioLoopImportedAsset(state, 'a', 'Focus');
    const renamedRecorded = renameAudioLoopRecordedAsset(state, 'r', 'Bell');

    expect(renamedImported.assets.find((item) => item.id === 'a')?.displayName).toBe('Focus (2)');
    expect(renamedRecorded.assets.find((item) => item.id === 'r')?.displayName).toBe('Bell');

    const ignoredRename = renameAudioLoopRecordedAsset(state, 'a', 'Wrong source');
    expect(ignoredRename.assets.find((item) => item.id === 'a')?.displayName).toBe('Kick');
  });

  it('removes an asset from the active playlist and history without removing it from other playlists', () => {
    const state = createAudioLoopState({
      assets: [
        asset('a', 'Kick', 'audio-loop://a', '2026-07-29T00:00:00.000Z'),
        recordedAsset('r', 'Session', 'audio-loop://r', '2026-07-29T00:00:01.000Z'),
        asset('c', 'Keep', 'audio-loop://c', '2026-07-29T00:00:02.000Z'),
      ],
      playlists: [
        createAudioLoopPlaylist({ id: 'active', name: 'Active', assetIds: ['a', 'r', 'c'], createdAt: '2026-07-29T00:00:10.000Z' }),
        createAudioLoopPlaylist({ id: 'later', name: 'Later', assetIds: ['r'], createdAt: '2026-07-29T00:00:11.000Z' }),
      ],
      activeAssetId: 'r',
      activePlaylistId: 'active',
      history: [
        appendHistory('r', '2026-07-29T00:03:00.000Z'),
        appendHistory('a', '2026-07-29T00:04:00.000Z'),
      ],
    });

    const removedRecorded = removeAudioLoopRecordedAssetFromActivePlaylistAndHistory(state, 'r');
    expect(removedRecorded.playlists.find((item) => item.id === 'active')?.assetIds).toEqual(['a', 'c']);
    expect(removedRecorded.playlists.find((item) => item.id === 'later')?.assetIds).toEqual(['r']);
    expect(removedRecorded.history.map((entry) => entry.assetId)).toEqual(['a']);
    expect(removedRecorded.activeAssetId).toBe('a');

    const ignoredRemove = removeAudioLoopRecordedAssetFromActivePlaylistAndHistory(state, 'a');
    expect(ignoredRemove.playlists.find((item) => item.id === 'active')?.assetIds).toEqual(['a', 'r', 'c']);
    expect(ignoredRemove.history).toHaveLength(2);
  });

  it('returns queue navigation state and moves active asset through playlist without wrapping', () => {
    const state = createAudioLoopState({
      assets: [
        asset('a', 'alpha', 'audio-loop://a'),
        asset('b', 'bravo', 'audio-loop://b'),
        asset('c', 'charlie', 'audio-loop://c'),
      ],
      playlists: [createAudioLoopPlaylist({ id: 'road', name: 'Road', assetIds: ['a', 'b', 'c'], createdAt: '2026-07-29T00:00:00.000Z' })],
      activeAssetId: 'b',
      activePlaylistId: 'road',
    });
    const navigation = getAudioLoopPlaylistNavigation(state);
    expect(navigation.activeIndex).toBe(1);
    expect(navigation.hasPrevious).toBe(true);
    expect(navigation.hasNext).toBe(true);

    const next = moveAudioLoopAssetInActivePlaylist(state, 'next');
    expect(next.activeAssetId).toBe('c');

    const atEnd = moveAudioLoopAssetInActivePlaylist(next, 'next');
    expect(atEnd.activeAssetId).toBe('c');

    const previous = moveAudioLoopAssetInActivePlaylist(next, 'previous');
    expect(previous.activeAssetId).toBe('b');
  });

  it('moves from the normalized active item when no active asset is supplied', () => {
    const state = createAudioLoopState({
      assets: [
        asset('a', 'alpha', 'audio-loop://a'),
        asset('b', 'bravo', 'audio-loop://b'),
      ],
      playlists: [createAudioLoopPlaylist({ id: 'road', name: 'Road', assetIds: ['a', 'b'], createdAt: '2026-07-29T00:00:00.000Z' })],
      activePlaylistId: 'road',
    });
    const next = moveAudioLoopAssetInActivePlaylist(state, 'next');
    const previous = moveAudioLoopAssetInActivePlaylist(state, 'previous');
    expect(state.activeAssetId).toBe('a');
    expect(next.activeAssetId).toBe('b');
    expect(previous.activeAssetId).toBe('a');
  });

  it('builds a recent-assets playlist and updates active queue with current-asset edits', () => {
    const base = createAudioLoopState({
      assets: [
        asset('a', 'alpha', 'audio-loop://a', '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'),
        asset('b', 'bravo', 'audio-loop://b', '2026-07-29T00:00:01.000Z', '2026-07-29T00:00:03.000Z'),
        asset('c', 'charlie', 'audio-loop://c', '2026-07-29T00:00:02.000Z', '2026-07-29T00:00:01.000Z'),
      ],
      activeAssetId: 'b',
      playlists: [createAudioLoopPlaylist({
        id: 'morning',
        name: 'Morning',
        assetIds: ['a', 'c'],
        createdAt: '2026-07-29T00:00:00.000Z',
      })],
      activePlaylistId: 'morning',
    });

    const withRecent = createAudioLoopRecentPlaylist(base, { id: 'recent', name: 'Recent', createdAt: '2026-07-29T00:00:10.000Z' });
    expect(withRecent.playlists.map((playlist) => playlist.id)).toContain('recent');
    expect(withRecent.playlists.find((playlist) => playlist.id === 'recent')?.assetIds).toEqual(['b', 'c', 'a']);
    expect(withRecent.activePlaylistId).toBe('recent');

    const withActiveQueue = setAudioLoopActivePlaylist(withRecent, 'morning');
    const withAdded = addCurrentAssetToActivePlaylist(withActiveQueue);
    expect(withAdded.playlists.find((playlist) => playlist.id === 'morning')?.assetIds).toEqual(['a', 'c', 'b']);

    const withMoved = moveCurrentAssetInActivePlaylist(withAdded, 'up');
    expect(withMoved.playlists.find((playlist) => playlist.id === 'morning')?.assetIds).toEqual(['a', 'b', 'c']);

    const withRemoved = removeCurrentAssetFromActivePlaylist(withMoved);
    expect(withRemoved.playlists.find((playlist) => playlist.id === 'morning')?.assetIds).toEqual(['a', 'c']);
  });

  it('hydrates legacy v1 state and preserves restart-ready playback settings', () => {
    const legacy: AudioLoopStateV1 = {
      schemaVersion: 'wonder.audio-loop-state.v1',
      fileName: 'session.wav',
      durableUri: 'audio-loop://legacy/session',
      source: 'imported',
      loopCount: 12,
      delaySeconds: 5,
      startDelaySeconds: 2,
      resumePositionSeconds: 17.25,
      volume: 0.6,
      completedPlays: 3,
      history: [
        {
          id: 'legacy-play',
          startedAt: '2026-07-29T00:00:00.000Z',
          finishedAt: '2026-07-29T00:01:00.000Z',
          completedLoops: 3,
          loopCount: 12,
          delaySeconds: 5,
          startDelaySeconds: 2,
          resumePositionSeconds: 17.25,
          volume: 0.6,
          note: 'legacy-v1',
        },
      ],
    };

    const hydrated = hydrateAudioLoopState(legacy);

    expect(hydrated.packageId).toBe(AUDIO_LOOP_PACKAGE_ID);
    expect(hydrated.label).toBe(AUDIO_LOOP_LABEL);
    expect(hydrated.assets).toHaveLength(1);
    expect(hydrated.history).toHaveLength(1);
    expect(hydrated.lastPlaybackSettings).toMatchObject({
      loopCount: { kind: 'count', value: 12 },
      startDelaySeconds: 2,
      betweenPlayDelaySeconds: 5,
      resumePositionSeconds: 17.25,
      volume: 0.6,
    });
    expect(serializeAudioLoopState(hydrated)).toBe(serializeAudioLoopState(hydrateAudioLoopState(JSON.parse(serializeAudioLoopState(hydrated)))));
  });

  it('resumes from the latest available history item and flags missing files', async () => {
    const base = createAudioLoopState({
      assets: [
        asset('missing', 'missing-track', 'audio-loop://missing', '2026-07-29T00:00:00.000Z'),
        asset('keep', 'keep-track', 'audio-loop://keep', '2026-07-29T00:01:00.000Z'),
      ],
      history: [
        appendHistory('missing', '2026-07-29T00:02:00.000Z'),
        appendHistory('keep', '2026-07-29T00:03:00.000Z'),
      ],
      activeAssetId: 'missing',
      activePlaylistId: 'road',
      lastPlaybackSettings: normalizeAudioLoopPlaybackSettings({
        loopCount: { kind: 'infinite' },
        startDelaySeconds: 8,
        delaySeconds: 13,
        resumePositionSeconds: 44,
        volume: 0.75,
      }),
      lastPositionSeconds: 44,
    });

    const recovery = await recoverAudioLoopState(base, {
      materialize: async () => ({ durableUri: 'audio-loop://unused', fileName: 'unused' }),
      hasDurableUri: async (durableUri) => durableUri.includes('keep'),
    });

    expect(recovery.missingAssetIds).toEqual(['missing']);
    expect(recovery.availableAssetIds).toEqual(['keep']);
    expect(recovery.resumeAssetId).toBe('keep');
    expect(recovery.resumeSettings.loopCount).toEqual({ kind: 'infinite' });
    expect(recovery.ready).toBe(true);
  });

  it('copies imported audio into app-owned durable storage', async () => {
    const fileSystem = createFakeFileSystem();
    const imported = await importAudioLoopAsset(createAudioLoopState(), {
      sourceUri: 'file:///tmp/loop.wav',
      source: 'imported',
      preferredName: 'Loop',
      recordedAt: '2026-07-29T11:00:00.000Z',
    }, createAudioLoopStorageMaterializer({
      fileSystem,
    }));

    expect(imported.assets).toHaveLength(1);
    expect(imported.assets[0]?.source).toBe('imported');
    expect(imported.assets[0]?.durableUri).toBe('file:///app/audio-loop-108/assets/Loop.wav');
    expect(imported.activeAssetId).toBe(imported.assets[0]?.id ?? null);
    expect(fileSystem.copies).toEqual([{ from: 'file:///tmp/loop.wav', to: 'file:///app/audio-loop-108/assets/Loop.wav' }]);
  });

  it('auto-names recordings when no preferred name is provided', async () => {
    const fileSystem = createFakeFileSystem();
    const imported = await importAudioLoopAsset(createAudioLoopState(), {
      sourceUri: 'file:///tmp/session.wav',
      source: 'recorded',
      recordedAt: '2026-07-29T10:00:00.000Z',
    }, createAudioLoopStorageMaterializer({
      fileSystem,
    }));
    const expected = makeAudioLoopRecordingDisplayName('2026-07-29T10:00:00.000Z');
    expect(imported.assets[0]?.source).toBe('recorded');
    expect(imported.assets[0]?.displayName).toBe(expected);
    expect(fileSystem.copies[0]?.to).toContain('Recording-2026-07-29-10-00-00');
  });

  it('formats generated recording names with timestamp and no timezone punctuation', () => {
    expect(makeAudioLoopRecordingDisplayName('2026-07-29T10:20:30.456Z')).toBe('Recording 2026-07-29 10-20-30');
  });

  it('marks recovery as not ready when durable files are missing', async () => {
    const base = createAudioLoopState({
      assets: [
        asset('missing', 'missing-track', 'audio-loop://missing', '2026-07-29T00:00:00.000Z'),
        asset('gone', 'gone-track', 'audio-loop://gone', '2026-07-29T00:01:00.000Z'),
      ],
      history: [
        appendHistory('missing', '2026-07-29T00:02:00.000Z'),
        appendHistory('gone', '2026-07-29T00:03:00.000Z'),
      ],
      activeAssetId: 'missing',
      activePlaylistId: 'road',
    });

    const recovery = await recoverAudioLoopState(base, {
      materialize: async () => ({ durableUri: 'audio-loop://unused', fileName: 'unused' }),
      hasDurableUri: async () => false,
    });

    expect(recovery.ready).toBe(false);
    expect(recovery.availableAssetIds).toEqual([]);
    expect(recovery.missingAssetIds).toEqual(['missing', 'gone']);
    expect(recovery.resumeAssetId).toBeNull();
  });

  it('preserves active asset, playlists, history, and loop settings across storage round-trip', () => {
    const original = createAudioLoopState({
      assets: [
        asset('a', 'one', 'audio-loop://a', '2026-07-29T00:00:00.000Z'),
        asset('b', 'two', 'audio-loop://b', '2026-07-29T00:01:00.000Z'),
      ],
      playlists: [
        createAudioLoopPlaylist({ id: 'recent', name: 'Recent', createdAt: '2026-07-29T00:00:10.000Z', assetIds: ['b', 'a'] }),
        createAudioLoopPlaylist({ id: 'favorites', name: 'Favorites', createdAt: '2026-07-29T00:00:20.000Z', assetIds: ['a'] }),
      ],
      activeAssetId: 'b',
      activePlaylistId: 'recent',
      history: [
        appendHistory('b', '2026-07-29T00:02:00.000Z'),
        appendHistory('a', '2026-07-29T00:03:00.000Z'),
      ],
      lastPlaybackSettings: normalizeAudioLoopPlaybackSettings({
        loopCount: { kind: 'count', value: 7 },
        startDelaySeconds: 11,
        delaySeconds: 3,
        resumePositionSeconds: 2.5,
        volume: 0.92,
      }),
    });
    const restored = hydrateAudioLoopState(serializeAudioLoopState(original));

    expect(restored.activeAssetId).toBe('b');
    expect(restored.playlists.map((playlist) => playlist.id)).toEqual(['recent', 'favorites']);
    expect(restored.history.map((entry) => entry.id)).toEqual(original.history.map((entry) => entry.id));
    expect(restored.lastPlaybackSettings).toMatchObject({
      loopCount: { kind: 'count', value: 7 },
      startDelaySeconds: 11,
      betweenPlayDelaySeconds: 3,
      resumePositionSeconds: 2.5,
      volume: 0.92,
    });
  });

  it('starts a recorder without silent microphone mode', async () => {
    const recordedCommands: Array<{ outputFile: string; isMuted: boolean }> = [];
    const driver = {
      startRecording: async (command: { outputFile: string; isMuted: boolean }) => {
        recordedCommands.push(command);
        return { sourceUri: command.outputFile };
      },
      stopRecording: async () => {},
    };
    const command = buildRecorderStartCommand('file:///app/audio-loop-108/assets/recording.m4a');
    expect(command.isMuted).toBe(false);
    const started = await startAudioLoopRecording(driver, command.outputFile);

    expect(recordedCommands).toEqual([command]);
    expect(started.sourceUri).toBe('file:///app/audio-loop-108/assets/recording.m4a');
  });
});

function asset(id: string, displayName: string, durableUri = `audio-loop://${id}`, createdAt = '2026-07-29T00:00:00.000Z', lastOpenedAt: string | null = null) {
  return createAudioLoopAssetReference({
    id,
    durableUri,
    source: 'imported',
    displayName,
    sourceUri: `file:///tmp/${displayName}.wav`,
    createdAt,
    lastOpenedAt,
  });
}

function recordedAsset(id: string, displayName: string, durableUri = `audio-loop://${id}`, createdAt = '2026-07-29T00:00:00.000Z', lastOpenedAt: string | null = null) {
  return createAudioLoopAssetReference({
    id,
    durableUri,
    source: 'recorded',
    displayName,
    sourceUri: `file:///tmp/${displayName}.wav`,
    createdAt,
    lastOpenedAt,
  });
}

function appendHistory(assetId: string, startedAt: string) {
  return {
    schemaVersion: 'wonder.audio-loop-history-entry.v1' as const,
    id: `history-${assetId}-${startedAt}`,
    assetId,
    playlistId: null,
    status: 'completed' as const,
    startedAt,
    finishedAt: startedAt,
    completedLoops: 1,
    loopCount: { kind: 'count' as const, value: 1 },
    settings: normalizeAudioLoopPlaybackSettings({
      loopCount: 1,
      startDelaySeconds: 0,
      delaySeconds: 0,
      resumePositionSeconds: 0,
      volume: 1,
    }),
    note: null,
  };
}

function createFakeFileSystem(): AudioLoopStorageFileSystem & {
  copies: Array<{ from: string; to: string }>;
} {
  const copies: Array<{ from: string; to: string }> = [];
  return {
    documentDirectory: 'file:///app',
    cacheDirectory: null,
    copies,
    async copyAsync({ from, to }) {
      copies.push({ from, to });
    },
    async makeDirectoryAsync() {
      return;
    },
    async getInfoAsync(uri) {
      const hasCopyTarget = copies.some((entry) => entry.to === uri);
      return {
        exists: hasCopyTarget || uri === 'file:///app/audio-loop-108/assets',
      };
    },
  };
}
