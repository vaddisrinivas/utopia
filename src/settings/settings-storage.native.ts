import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'utopia.settings.v1';

export async function readSettingsValue(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEY);
}

export async function writeSettingsValue(value: string): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
