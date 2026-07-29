import { describe, expect, it } from 'vitest';

import { loadAudioLoopStateFromStorage } from '@/src/presentation/widgets/audio-loop-persistence';
import {
  createAudioLoopAssetReference,
  createAudioLoopPlaylist,
  createAudioLoopState,
  normalizeAudioLoopPlaybackSettings,
  serializeAudioLoopState,
} from '@/src/presentation/widgets/audio-loop-state';

describe('audio loop state persistence loader', () => {
  it('clears active selection when stored active asset is missing', async () => {
    const state = createAudioLoopState({
      assets: [
        createAudioLoopAssetReference({
          id: 'keep',
          durableUri: 'audio-loop://keep',
          source: 'imported',
          displayName: 'Keep',
          createdAt: '2026-07-29T10:00:00.000Z',
        }),
      ],
      activeAssetId: 'keep',
      playlists: [createAudioLoopPlaylist({
        id: 'recent',
        name: 'Recent',
        createdAt: '2026-07-29T10:00:00.000Z',
        assetIds: ['keep'],
      })],
      history: [{
        schemaVersion: 'wonder.audio-loop-history-entry.v1',
        id: 'history-1',
        assetId: 'keep',
        playlistId: 'recent',
        status: 'completed',
        startedAt: '2026-07-29T10:00:00.000Z',
        finishedAt: '2026-07-29T10:00:10.000Z',
        completedLoops: 1,
        loopCount: { kind: 'count', value: 3 },
        settings: normalizeAudioLoopPlaybackSettings({
          loopCount: { kind: 'count', value: 3 },
          startDelaySeconds: 2,
          betweenPlayDelaySeconds: 1,
          resumePositionSeconds: 0.25,
          volume: 0.5,
        }),
        note: 'moved asset',
      }],
      lastPlaybackSettings: normalizeAudioLoopPlaybackSettings({
        loopCount: { kind: 'count', value: 7 },
        startDelaySeconds: 2,
        betweenPlayDelaySeconds: 1,
        resumePositionSeconds: 0.25,
        volume: 0.5,
      }),
      lastPositionSeconds: 0.25,
      activePlaylistId: 'recent',
    });

    const restored = await loadAudioLoopStateFromStorage({
      loadAudioLoopStateValue: async () => serializeAudioLoopState(state),
      hasDurableUri: async () => false,
    });

    expect(restored).not.toBeNull();
    expect(restored?.ready).toBe(false);
    expect(restored?.needsReselect).toBe(true);
    expect(restored?.state.activeAssetId).toBeNull();
    expect(restored?.state.playlists.map((playlist) => playlist.id)).toEqual(['recent']);
    expect(restored?.state.history).toHaveLength(1);
    expect(restored?.state.lastPlaybackSettings).toMatchObject({
      loopCount: { kind: 'count', value: 7 },
      startDelaySeconds: 2,
      betweenPlayDelaySeconds: 1,
      volume: 0.5,
    });
  });

  it('keeps active selection when stored active asset exists', async () => {
    const state = createAudioLoopState({
      assets: [
        createAudioLoopAssetReference({
          id: 'keep',
          durableUri: 'audio-loop://keep',
          source: 'imported',
          displayName: 'Keep',
          createdAt: '2026-07-29T10:00:00.000Z',
        }),
      ],
      activeAssetId: 'keep',
      playlists: [createAudioLoopPlaylist({
        id: 'recent',
        name: 'Recent',
        createdAt: '2026-07-29T10:00:00.000Z',
      })],
      activePlaylistId: 'recent',
    });

    const restored = await loadAudioLoopStateFromStorage({
      loadAudioLoopStateValue: async () => serializeAudioLoopState(state),
      hasDurableUri: async () => true,
    });

    expect(restored?.ready).toBe(true);
    expect(restored?.needsReselect).toBe(false);
    expect(restored?.state.activeAssetId).toBe('keep');
  });
});
