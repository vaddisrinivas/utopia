import { Alert, Platform } from 'react-native';

import type { LifecycleConfirmation } from '@/src/domain/package-install';

export type LifecycleConfirmationDrivers = Readonly<{
  platform?: 'web' | 'native';
  webConfirm?: (message: string) => boolean;
  alert?: Pick<typeof Alert, 'alert'>;
}>;

export async function confirmLifecycleAction(
  prompt: LifecycleConfirmation,
  drivers: LifecycleConfirmationDrivers = {},
): Promise<boolean> {
  const platform = drivers.platform ?? Platform.OS;
  if (platform === 'web') {
    const webConfirm = drivers.webConfirm ?? (globalThis as { confirm?: (message: string) => boolean }).confirm;
    if (!webConfirm) return false;
    return webConfirm(`${prompt.title}\n\n${prompt.message}`);
  }

  const alert = drivers.alert ?? Alert;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    alert.alert(
      prompt.title,
      prompt.message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => finish(false) },
        { text: prompt.confirmLabel, style: prompt.destructive ? 'destructive' : 'default', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}
