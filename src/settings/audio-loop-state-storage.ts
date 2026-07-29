const STORAGE_KEY = 'utopia.audio-loop-state.v1';

export async function loadAudioLoopStateValue(): Promise<string | null> {
  void STORAGE_KEY;
  return null;
}

export async function saveAudioLoopStateValue(_value: string): Promise<void> {
  void STORAGE_KEY;
}
