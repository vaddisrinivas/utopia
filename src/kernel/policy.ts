import { z } from 'zod';
import { findPackage } from './catalog';
import storage from './storage';

const Decision = z.object({
  appId: z.string().min(1),
  capability: z.string().min(1),
  state: z.enum(['granted', 'denied']),
  updatedAt: z.string().datetime(),
});

export type ConsentDecision = z.infer<typeof Decision>;
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

const key = (appId: string, capability: string) => `utopia:consent:${appId}:${capability}`;
const grants: Record<string, string[]> = {
  cameraScanner: ['camera.scan', 'native.camera.scan', 'native.camera.optional'],
  filePicker: ['file.import', 'files.import', 'files.read', 'native.files.read', 'native.file_open'],
  fileExport: ['file.export', 'files.export', 'export', 'native.share'],
  locationMap: ['location.current', 'location.optional', 'native.location.read'],
  notificationScheduler: ['notifications.schedule', 'notifications.optional'],
  contactPicker: ['contacts.read'],
  calendarEvent: ['calendar.create', 'calendar.events'],
  biometricGate: ['biometric.optional', 'auth.local'],
  speechTool: ['native.speech.speak'],
  sensorReadout: ['sensors.read', 'native.sensors.read'],
  healthConnect: ['health.read'],
  healthKitStatus: ['health.read'],
};

export function allowsCapability(declared: readonly string[], widget: string): boolean {
  return (grants[widget] ?? [widget]).some((capability) => declared.includes(capability));
}

export async function assertCapability(appId: string, widget: string): Promise<void> {
  const pkg = await findPackage(appId);
  if (!pkg || !allowsCapability(pkg.capabilities, widget)) throw new Error(`Capability not declared: ${widget}`);
}

export async function readConsent(storage: Storage, appId: string, capability: string): Promise<ConsentDecision | undefined> {
  const value = await storage.getItem(key(appId, capability));
  return value ? Decision.parse(JSON.parse(value)) : undefined;
}

export async function writeConsent(storage: Storage, decision: ConsentDecision): Promise<ConsentDecision> {
  const valid = Decision.parse(decision);
  await storage.setItem(key(valid.appId, valid.capability), JSON.stringify(valid));
  return valid;
}

export async function recordConsent(appId: string, capability: string, state: ConsentDecision['state']) {
  return writeConsent(storage, { appId, capability, state, updatedAt: new Date().toISOString() });
}
