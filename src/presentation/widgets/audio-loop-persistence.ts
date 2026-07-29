import {
  createAudioLoopState,
  hydrateAudioLoopState,
  recoverAudioLoopState,
  type AudioLoopStateV2,
} from '@/src/presentation/widgets/audio-loop-state';

export type AudioLoopPlayerPersistenceResult = Readonly<{
  state: AudioLoopStateV2;
  ready: boolean;
  needsReselect: boolean;
}>;

type AudioLoopStateLoadInput = {
  loadAudioLoopStateValue(): Promise<string | null>;
  hasDurableUri?: (durableUri: string) => boolean | Promise<boolean>;
};

export async function loadAudioLoopStateFromStorage(input: AudioLoopStateLoadInput): Promise<AudioLoopPlayerPersistenceResult | null> {
  const serialized = await input.loadAudioLoopStateValue();
  if (!serialized) return null;

  const hydrated = hydrateAudioLoopState(serialized);
  const recovered = await recoverAudioLoopState(hydrated, {
    materialize: async () => {
      throw new Error('audio loop restore does not materialize files');
    },
    hasDurableUri: input.hasDurableUri,
  });

  const needsReselect = typeof hydrated.activeAssetId === 'string'
    ? !recovered.availableAssetIds.includes(hydrated.activeAssetId)
    : false;
  const state = {
    ...createAudioLoopState({
      ...recovered.state,
      activeAssetId: needsReselect ? null : recovered.state.activeAssetId,
    }),
    activeAssetId: needsReselect ? null : recovered.state.activeAssetId,
  };

  return {
    state,
    ready: recovered.ready && !needsReselect,
    needsReselect,
  };
}
