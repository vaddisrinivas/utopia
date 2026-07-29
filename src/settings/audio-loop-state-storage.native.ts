import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'utopia.audio-loop-state.v1';

export async function loadAudioLoopStateValue(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEY);
}

export async function saveAudioLoopStateValue(value: string): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
