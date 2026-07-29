import { describe, expect, it } from 'vitest';

import { buildAppLifecycleConfirmation } from '@/src/domain/package-install';
import { confirmLifecycleAction } from '@/src/presentation/lifecycle-confirmation';

describe('lifecycle confirmation helper', () => {
  it('fails closed on web when confirm is unavailable', async () => {
    let mutations = 0;
    const prompt = buildAppLifecycleConfirmation('delete-data', 'Demo Shelf');

    await expect(runGuardedMutation(prompt, {
      platform: 'web',
    }, () => {
      mutations += 1;
    })).resolves.toBe(false);

    expect(mutations).toBe(0);
  });

  it('blocks web cancel', async () => {
    let mutations = 0;
    const prompt = buildAppLifecycleConfirmation('uninstall', 'Demo Shelf');

    await expect(runGuardedMutation(prompt, {
      platform: 'web',
      webConfirm: () => false,
    }, () => {
      mutations += 1;
    })).resolves.toBe(false);

    expect(mutations).toBe(0);
  });

  it('blocks native cancel and dismiss exactly once', async () => {
    const prompt = buildAppLifecycleConfirmation('restore', 'Demo Shelf');
    let onDismiss: (() => void) | undefined;
    let cancelPress: (() => void) | undefined;
    let mutations = 0;
    const result = runGuardedMutation(prompt, {
      platform: 'native',
      alert: {
        alert: (_title, _message, buttons, options) => {
          const cancelButton = buttons?.[0];
          cancelPress = cancelButton?.onPress ? () => cancelButton.onPress?.() : undefined;
          onDismiss = options?.onDismiss ?? undefined;
        },
      },
    }, () => {
      mutations += 1;
    });

    cancelPress?.();
    onDismiss?.();
    onDismiss?.();

    await expect(result).resolves.toBe(false);
    expect(mutations).toBe(0);
  });

  it('permits native confirm once', async () => {
    const prompt = buildAppLifecycleConfirmation('update', 'Demo Shelf', {
      version: '1.0.0',
      nextVersion: '1.1.0',
    });
    let confirmPress: (() => void) | undefined;
    let onDismiss: (() => void) | undefined;
    let mutations = 0;
    const result = runGuardedMutation(prompt, {
      platform: 'native',
      alert: {
        alert: (_title, _message, buttons, options) => {
          const confirmButton = buttons?.[1];
          confirmPress = confirmButton?.onPress ? () => confirmButton.onPress?.() : undefined;
          onDismiss = options?.onDismiss ?? undefined;
        },
      },
    }, () => {
      mutations += 1;
    });

    confirmPress?.();
    onDismiss?.();

    await expect(result).resolves.toBe(true);
    expect(mutations).toBe(1);
  });
});

async function runGuardedMutation(
  prompt: Parameters<typeof confirmLifecycleAction>[0],
  drivers: Parameters<typeof confirmLifecycleAction>[1],
  mutate: () => void,
) {
  if (await confirmLifecycleAction(prompt, drivers)) {
    mutate();
    return true;
  }
  return false;
}
