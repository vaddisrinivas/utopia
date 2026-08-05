import { Platform } from 'react-native';

import type { AppState } from './runtime';
import type { AppPackage } from './schema';
import { CapabilityStateError, executeCapability, type CapabilityResult } from './capability-state';

export function exportPayload(pkg: AppPackage, state: AppState) {
  return {
    schemaVersion: 'utopia.app-data.v1',
    package: { id: pkg.id, version: pkg.version },
    exportedAt: new Date().toISOString(),
    records: state.records,
  };
}

export async function exportAppData(pkg: AppPackage, state: AppState): Promise<CapabilityResult<string>> {
  const content = JSON.stringify(exportPayload(pkg, state), null, 2);
  const name = `${pkg.id}-${new Date().toISOString().slice(0, 10)}.json`;

  const result = await executeCapability(async () => {
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      return name;
    }

    const { File, Paths } = await import('expo-file-system');
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    file.write(content);

    const sharing = await import('expo-sharing');
    const available = await sharing.isAvailableAsync();
    if (!available) {
      throw new CapabilityStateError('unavailable', false, 'Share unavailable on this platform');
    }

    await sharing.shareAsync(file.uri, { mimeType: 'application/json' });
    return file.uri;
  });

  return result;
}
