import { z } from 'zod';
import { findPackage } from './catalog';
import storage from './storage';

type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> };
type ConsentState = 'granted' | 'denied';
type CapabilityDecision = { appId: string; capability: string; state: ConsentState; updatedAt: string };

const Decision = z.object({ appId: z.string().min(1), capability: z.string().min(1), state: z.enum(['granted', 'denied']), updatedAt: z.string().datetime() });
export type ConsentDecision = z.infer<typeof Decision>;

const normalize = (value: string) => value.toLowerCase().trim();
const key = (appId: string, capability: string, scope: 'install') => `utopia:consent:${scope}:${appId}:${normalize(capability)}`;
const legacyKey = (appId: string, capability: string) => `utopia:consent:${appId}:${normalize(capability)}`;

const parseConsent = (value: string) => Decision.parse(JSON.parse(value) as CapabilityDecision);

export const installScopedConsentKey = (appId: string, capability: string) => key(appId, capability, 'install');

export const nativeCapabilityAliases = {
  cameraScanner: ['camera', 'camera.scan', 'native.camera.scan', 'native.camera', 'native.camera.optional'],
  filePicker: ['file.import', 'files.import', 'files.read', 'native.files.read', 'native.file_open'],
  fileExport: ['file.export', 'files.export', 'export', 'native.share'],
  locationMap: ['location', 'location.current', 'location.background', 'locationMap', 'native.location.read', 'location.optional'],
  notificationScheduler: ['notification', 'notifications', 'notifications.schedule', 'notifications.optional'],
  contactPicker: ['contacts', 'contacts.read', 'contacts.readonly'],
  calendarEvent: ['calendar', 'calendar.events', 'calendar.write', 'calendar.create'],
  biometricGate: ['biometric.optional', 'auth.local'],
  speechTool: ['speech', 'speech.speak', 'native.speech.speak'],
  sensorReadout: ['sensor.read', 'sensors.read', 'native.sensors.read'],
  healthConnect: ['health.read'],
  healthKitStatus: ['health.read'],
} as const;

type Capability = keyof typeof nativeCapabilityAliases;
const entries = Object.entries(nativeCapabilityAliases) as Array<[Capability, readonly string[]]>;
const aliasToCapability = new Map<
  string,
  Capability
>([
  ...entries.flatMap(([capability, aliases]) => aliases.map((alias) => [normalize(alias), capability] as const)),
  ...entries.map(([capability]) => [normalize(capability), capability] as const),
]);

export const resolvePermissionCapabilityForDeclaration = (permissionId: string): Capability | undefined => {
  return aliasToCapability.get(normalize(permissionId));
};

export function resolveDeclaredCapability(declared: readonly string[], widget: string): Capability | undefined {
  const target = resolvePermissionCapabilityForDeclaration(widget);
  if (!target) return;
  for (const declaration of declared) {
    if (resolvePermissionCapabilityForDeclaration(declaration) === target) return target;
  }
  return;
}

export const allowsCapability = (declared: readonly string[], widget: string) => Boolean(resolveDeclaredCapability(declared, widget));

export async function assertCapability(appId: string, widget: string): Promise<void> {
  const pkg = await findPackage(appId);
  if (!pkg || !allowsCapability(pkg.capabilities, widget)) throw new Error(`Capability not declared: ${widget}`);
}

export async function resolveCapability(appId: string, widget: string): Promise<Capability | undefined> {
  const pkg = await findPackage(appId);
  return pkg ? resolveDeclaredCapability(pkg.capabilities, widget) : undefined;
}

export async function readConsent(storage: Storage, appId: string, capability: string): Promise<ConsentDecision | undefined> {
  const primary = await storage.getItem(installScopedConsentKey(appId, capability));
  if (primary) return parseConsent(primary);

  const legacy = await storage.getItem(legacyKey(appId, capability));
  if (!legacy) return undefined;

  const normalized = parseConsent(legacy);
  await storage.setItem(installScopedConsentKey(appId, capability), JSON.stringify(normalized));
  return normalized;
}

export async function readCapabilityDecision(appId: string, capability: string): Promise<ConsentDecision | undefined> {
  return readConsent(storage, appId, capability);
}

export async function writeConsent(storage: Storage, decision: ConsentDecision): Promise<ConsentDecision> {
  const valid = Decision.parse(decision);
  await storage.setItem(installScopedConsentKey(valid.appId, valid.capability), JSON.stringify(valid));
  return valid;
}

export async function recordConsent(appId: string, capability: string, state: ConsentState) {
  return writeConsent(storage, { appId, capability, state, updatedAt: new Date().toISOString() });
}
