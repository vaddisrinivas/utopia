const STORAGE_KEY = 'utopia.audio-loop-state.v1';

export async function loadAudioLoopStateValue(): Promise<string | null> {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
}

export async function saveAudioLoopStateValue(value: string): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, value);
  }
}
