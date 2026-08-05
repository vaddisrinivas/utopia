import { describe, expect, it, vi } from 'vitest';

import { fixtureActivePackage } from './v3-fixtures';

const decisions = new Map<string, 'granted' | 'denied'>();
const camera = { requestCount: 0, statusCount: 0, granted: false as boolean };
const location = { requestCount: 0, statusCount: 0, granted: false as boolean };
const calendar = { requestCount: 0, statusCount: 0, granted: false as boolean };
const notifications = { requestCount: 0, statusCount: 0, granted: false as boolean };
const contacts = { requestCount: 0, statusCount: 0, granted: false as boolean };

vi.mock('@/src/kernel/policy', async () => {
  const actual = await vi.importActual<typeof import('@/src/kernel/policy')>('@/src/kernel/policy');
  return {
    ...actual,
    readCapabilityDecision: vi.fn(async (appId: string, capability: string) => {
      const state = decisions.get(`${appId}:${capability}`);
      if (!state) return undefined;
      return { appId, capability, state, updatedAt: '2026-08-05T00:00:00.000Z' };
    }),
    recordConsent: vi.fn(async (_appId: string, capability: string, state: 'granted' | 'denied') => {
      decisions.set(`${_appId}:${capability}`, state);
      return { appId: _appId, capability, state, updatedAt: '2026-08-05T00:00:00.000Z' };
    }),
  };
});

vi.mock('expo', () => ({}));

vi.mock('expo-sensors', () => ({
  Accelerometer: {
    isAvailableAsync: vi.fn(async () => true),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Gyroscope: {
    isAvailableAsync: vi.fn(async () => true),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Magnetometer: {
    isAvailableAsync: vi.fn(async () => true),
    setUpdateInterval: vi.fn(),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

vi.mock('expo-camera', () => ({
  requestCameraPermissionsAsync: vi.fn(async () => {
    camera.requestCount += 1;
    return { granted: camera.granted, canAskAgain: true };
  }),
  getCameraPermissionsAsync: vi.fn(async () => {
    camera.statusCount += 1;
    return { granted: false, canAskAgain: true };
  }),
  CameraView: () => null,
  useCameraPermissions: () => [null, vi.fn()],
}));

vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(async () => {
    location.requestCount += 1;
    return { granted: location.granted, canAskAgain: true };
  }),
  getForegroundPermissionsAsync: vi.fn(async () => {
    location.statusCount += 1;
    return { granted: false, canAskAgain: true };
  }),
}));

vi.mock('expo-notifications', () => ({
  requestPermissionsAsync: vi.fn(async () => {
    notifications.requestCount += 1;
    return { granted: notifications.granted, canAskAgain: true };
  }),
  getPermissionsAsync: vi.fn(async () => {
    notifications.statusCount += 1;
    return { granted: false, canAskAgain: true };
  }),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
}));

vi.mock('expo-contacts', () => ({
  requestPermissionsAsync: vi.fn(async () => {
    contacts.requestCount += 1;
    return { granted: contacts.granted, canAskAgain: true };
  }),
  getPermissionsAsync: vi.fn(async () => {
    contacts.statusCount += 1;
    return { granted: false, canAskAgain: true };
  }),
  presentContactPickerAsync: vi.fn(),
}));

vi.mock('expo-calendar', () => ({
  requestCalendarPermissionsAsync: vi.fn(async () => {
    calendar.requestCount += 1;
    return { granted: calendar.granted, canAskAgain: true };
  }),
  getCalendarPermissionsAsync: vi.fn(async () => {
    calendar.statusCount += 1;
    return { granted: false, canAskAgain: true };
  }),
  getDefaultCalendarAsync: vi.fn(async () => ({ id: 'cal' })),
  createEventAsync: vi.fn(async () => ({})),
}));

function pkg(overrides: { permissions: Array<unknown> }): ReturnType<typeof fixtureActivePackage> {
  const base = fixtureActivePackage();
  return {
    ...base,
    nativeCapabilities: {
      ...base.nativeCapabilities,
      permissions: overrides.permissions,
    },
  };
}

describe('boot permission bootstrap', () => {
  it('requests declared runtime permissions first boot and persists decision', async () => {
    const { collectPendingRuntimePermissions, requestBootPermission } = await import('@/src/kernel/capabilities');

    decisions.clear();
    camera.requestCount = 0;
    camera.granted = true;

    const app = pkg({ permissions: ['camera'] });
    const pending = await collectPendingRuntimePermissions(app.id, app);
    expect(pending.map((item) => item.capability)).toEqual(['cameraScanner']);

    await requestBootPermission(app.id, pending[0]!);
    expect(camera.requestCount).toBe(1);

    const again = await collectPendingRuntimePermissions(app.id, app);
    expect(again).toHaveLength(0);
  });

  it('keeps denied permissions out on second boot', async () => {
    const { collectPendingRuntimePermissions, requestBootPermission } = await import('@/src/kernel/capabilities');

    decisions.clear();
    location.requestCount = 0;
    location.granted = false;

    const app = pkg({ permissions: ['location'] });
    const pending = await collectPendingRuntimePermissions(app.id, app);
    expect(pending).toHaveLength(1);

    await requestBootPermission(app.id, pending[0]!);

    const again = await collectPendingRuntimePermissions(app.id, app);
    expect(again).toHaveLength(0);
    expect(location.requestCount).toBe(1);
  });

  it('skips undeclared and unsupported permissions', async () => {
    const { collectPendingRuntimePermissions, requestBootPermission } = await import('@/src/kernel/capabilities');

    decisions.clear();
    const app = pkg({ permissions: [{ permission: 'foo-feature' }, { permission: 'camera', prompt: 'Camera prompt' }] });
    const pending = await collectPendingRuntimePermissions(app.id, app);
    expect(pending.map((item) => ({ id: item.permission.id, unsupported: item.unsupported }))).toEqual([
      { id: 'camera', unsupported: false },
      { id: 'foo-feature', unsupported: true },
    ]);

    await requestBootPermission(app.id, pending[0]!);
    expect(camera.requestCount).toBeGreaterThanOrEqual(1);
    await expect(requestBootPermission(app.id, pending[1]!)).rejects.toThrow('unsupported on this platform');
  });
});
