export const DATA_HOME_SELECTION_SCHEMA_VERSION = 'utopia.data-home-selection.v1' as const;
export const DEFAULT_DATA_HOME_ADAPTER_ID = 'sqlite' as const;
export const SUPPORTED_DATA_HOME_ADAPTER_IDS = ['sqlite', 'notion', 'google_sheets'] as const;
export const DATA_HOME_COPY = {
  localDefaultHint: 'Data homes are local-only by default. Remote selections require manual export, import, and migration.',
  remoteMigrationHint: 'Switching to a remote home requires manual export, import, and migration.',
  previewRemoteMigrationHint: 'Switching data homes requires manual export, import, and migration before continuing.',
} as const;

export type SupportedDataHomeAdapterId = typeof SUPPORTED_DATA_HOME_ADAPTER_IDS[number];
export type DataHomeAdapterId = SupportedDataHomeAdapterId | (string & {});
export type DataHomeAdapterKind = 'local' | 'remote';
export type DataHomeAdapterReadiness = 'ready' | 'requires_auth' | 'offline' | 'blocked';
export type DataHomeCapability = 'local' | 'read' | 'write' | 'import' | 'export' | 'sync' | 'migrate';
export type DataHomeSelectionStatus = 'ready' | 'blocked';
export type DataHomeSelectionPolicy = Readonly<{
  kind: 'sqlite-only';
  fallbackAdapterId: typeof DEFAULT_DATA_HOME_ADAPTER_ID;
}>;

export type DataHomeAdapterDescriptor = Readonly<{
  id: DataHomeAdapterId;
  kind: DataHomeAdapterKind;
  readiness: DataHomeAdapterReadiness;
  capabilities: readonly DataHomeCapability[];
}>;

export type DataHomeAdapterRegistry = Readonly<{
  get(adapterId: string): DataHomeAdapterDescriptor | null;
  list(): readonly DataHomeAdapterDescriptor[];
}>;

export type DataHomeInstallationSelection = Readonly<{
  installationId: string;
  adapterId: string | null;
  updatedAt: string | null;
}>;

export type DataHomeAdapterContractAvailability = 'available' | 'unconfigured' | 'unsupported' | 'not_ready';

export type DataHomeAdapterSelectionContractOption = Readonly<{
  adapterId: SupportedDataHomeAdapterId;
  label: string;
  availability: DataHomeAdapterContractAvailability;
  declared: boolean;
  readiness: DataHomeAdapterReadiness | 'unsupported';
  reason: string;
  canSelect: boolean;
}>;

export type DataHomeAdapterSelectionContract = Readonly<{
  schemaVersion: typeof DATA_HOME_SELECTION_SCHEMA_VERSION;
  installationId: string;
  options: readonly DataHomeAdapterSelectionContractOption[];
}>;

export type DataHomeSelectionInput = Readonly<{
  installationId: string;
  declaredAdapterIds: readonly string[];
  selection?: DataHomeInstallationSelection | null;
  registry: DataHomeAdapterRegistry;
  now?: string;
}>;

export type DataHomeSelectionResolution = Readonly<{
  schemaVersion: typeof DATA_HOME_SELECTION_SCHEMA_VERSION;
  installationId: string;
  requestedAdapterId: DataHomeAdapterId;
  effectiveAdapterId: DataHomeAdapterId | null;
  fallbackAdapterId: typeof DEFAULT_DATA_HOME_ADAPTER_ID;
  policy: DataHomeSelectionPolicy;
  status: DataHomeSelectionStatus;
  readiness: DataHomeAdapterReadiness;
  kind: DataHomeAdapterKind | null;
  declared: boolean;
  supported: boolean;
  capabilities: readonly DataHomeCapability[];
  reason: string;
  updatedAt: string;
}>;

export type DataHomeSwitchPreviewInput = Readonly<{
  installationId: string;
  declaredAdapterIds: readonly string[];
  currentSelection?: DataHomeInstallationSelection | null;
  nextAdapterId: string | null;
  registry: DataHomeAdapterRegistry;
  now?: string;
}>;

export type DataHomeSwitchPreview = Readonly<{
  schemaVersion: typeof DATA_HOME_SELECTION_SCHEMA_VERSION;
  installationId: string;
  current: DataHomeSelectionResolution;
  next: DataHomeSelectionResolution;
  status: DataHomeSelectionStatus;
  reason: string;
  exportRequired: boolean;
  importRequired: boolean;
  migrationRequired: boolean;
  silentCopyAllowed: false;
  fallbackAdapterId: typeof DEFAULT_DATA_HOME_ADAPTER_ID;
  policy: DataHomeSelectionPolicy;
}>;

const SQLITE_DESCRIPTOR: DataHomeAdapterDescriptor = {
  id: DEFAULT_DATA_HOME_ADAPTER_ID,
  kind: 'local',
  readiness: 'ready',
  capabilities: ['local', 'read', 'write', 'import', 'export', 'migrate'],
};

export function dataHomeAdapterLabel(adapterId: DataHomeAdapterId): string {
  switch (adapterId) {
    case DEFAULT_DATA_HOME_ADAPTER_ID:
      return 'Local SQLite';
    case 'notion':
      return 'Notion';
    case 'google_sheets':
      return 'Google Sheets';
    default:
      return String(adapterId);
  }
}

export function resolveDataHomeSelectionContract(input: {
  installationId: string;
  declaredAdapterIds: readonly string[];
  registry: DataHomeAdapterRegistry;
}): DataHomeAdapterSelectionContract {
  const installationId = normalizeRequiredId(input.installationId, 'installation_id_required');
  const declared = new Set(
    input.declaredAdapterIds
      .map((value) => normalizeAdapterId(value))
      .filter((value): value is string => Boolean(value)),
  );

  return {
    schemaVersion: DATA_HOME_SELECTION_SCHEMA_VERSION,
    installationId,
    options: SUPPORTED_DATA_HOME_ADAPTER_IDS.map((adapterId) => {
      const isDeclared = adapterId === DEFAULT_DATA_HOME_ADAPTER_ID || declared.has(adapterId);
      const descriptor = input.registry.get(adapterId);
      const readiness = descriptor?.readiness ?? 'unsupported';
      const availability = resolveDataHomeAdapterAvailability({
        adapterId,
        isDeclared,
        readiness,
      });
      return {
        adapterId,
        label: dataHomeAdapterLabel(adapterId),
        availability,
        declared: isDeclared,
        readiness,
        canSelect: availability === 'available',
        reason: dataHomeAdapterAvailabilityReason({
          adapterId,
          availability,
          readiness,
        }),
      };
    }),
  };
}

export function createDataHomeAdapterRegistry(adapters: readonly DataHomeAdapterDescriptor[]): DataHomeAdapterRegistry {
  const registry = new Map<string, DataHomeAdapterDescriptor>();
  registry.set(SQLITE_DESCRIPTOR.id, SQLITE_DESCRIPTOR);

  for (const adapter of adapters) {
    const normalized = normalizeAdapterDescriptor(adapter);
    if (normalized.id === SQLITE_DESCRIPTOR.id) {
      registry.set(normalized.id, SQLITE_DESCRIPTOR);
      continue;
    }
    if (registry.has(normalized.id)) {
      throw new Error(`duplicate_data_home_adapter:${normalized.id}`);
    }
    registry.set(normalized.id, normalized);
  }

  return {
    get(adapterId: string): DataHomeAdapterDescriptor | null {
      const id = normalizeAdapterId(adapterId);
      if (!id) return null;
      return registry.get(id) ?? null;
    },
    list(): readonly DataHomeAdapterDescriptor[] {
      return Array.from(registry.values());
    },
  };
}

export function isSupportedDataHomeAdapterId(adapterId: string): adapterId is SupportedDataHomeAdapterId {
  return SUPPORTED_DATA_HOME_ADAPTER_IDS.includes(adapterId as SupportedDataHomeAdapterId);
}

export function resolveDataHomeSelection(
  input: DataHomeSelectionInput,
): DataHomeSelectionResolution {
  const installationId = normalizeRequiredId(input.installationId, 'installation_id_required');
  const updatedAt = input.now ?? input.selection?.updatedAt ?? new Date().toISOString();
  const requestedAdapterId = normalizeAdapterId(input.selection?.adapterId) ?? DEFAULT_DATA_HOME_ADAPTER_ID;
  const policy: DataHomeSelectionPolicy = { kind: 'sqlite-only', fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID };
  const descriptor = lookupAdapter(input.registry, requestedAdapterId);
  const declared = requestedAdapterId === DEFAULT_DATA_HOME_ADAPTER_ID
    || input.declaredAdapterIds.map(normalizeAdapterId).includes(requestedAdapterId);

  if (!descriptor) {
    return blockedSelection({
      installationId,
      requestedAdapterId,
      updatedAt,
      policy,
      declared,
      reason: `unknown_adapter:${requestedAdapterId}`,
    });
  }

  if (!declared) {
    return blockedSelection({
      installationId,
      requestedAdapterId,
      updatedAt,
      policy,
      declared: false,
      reason: `undeclared_adapter:${requestedAdapterId}`,
      descriptor,
    });
  }

  if (descriptor.readiness !== 'ready') {
    return blockedSelection({
      installationId,
      requestedAdapterId,
      updatedAt,
      policy,
      declared: true,
      reason: `adapter_${descriptor.readiness}:${requestedAdapterId}`,
      descriptor,
    });
  }

  return {
    schemaVersion: DATA_HOME_SELECTION_SCHEMA_VERSION,
    installationId,
    requestedAdapterId,
    effectiveAdapterId: requestedAdapterId,
    fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
    policy,
    status: 'ready',
    readiness: descriptor.readiness,
    kind: descriptor.kind,
    declared: true,
    supported: true,
    capabilities: [...descriptor.capabilities],
    reason: requestedAdapterId === DEFAULT_DATA_HOME_ADAPTER_ID ? 'default_local_sqlite' : 'adapter_ready',
    updatedAt,
  };
}

export function previewDataHomeSwitch(input: DataHomeSwitchPreviewInput): DataHomeSwitchPreview {
  const current = resolveDataHomeSelection({
    installationId: input.installationId,
    declaredAdapterIds: input.declaredAdapterIds,
    selection: normalizeSelection(input.currentSelection),
    registry: input.registry,
    now: input.now,
  });
  const nextSelection = normalizeSelection({
    installationId: input.installationId,
    adapterId: input.nextAdapterId,
    updatedAt: input.now ?? current.updatedAt,
  });
  const next = resolveDataHomeSelection({
    installationId: input.installationId,
    declaredAdapterIds: input.declaredAdapterIds,
    selection: nextSelection,
    registry: input.registry,
    now: input.now ?? current.updatedAt,
  });
  const switched = current.effectiveAdapterId !== next.effectiveAdapterId;
  const blocked = current.status === 'blocked' || next.status === 'blocked';

  return {
    schemaVersion: DATA_HOME_SELECTION_SCHEMA_VERSION,
    installationId: current.installationId,
    current,
    next,
    status: blocked ? 'blocked' : 'ready',
    reason: blocked
      ? current.status === 'blocked'
        ? current.reason
        : next.reason
      : switched
        ? 'manual_export_import_required'
        : 'no_switch_needed',
    exportRequired: switched,
    importRequired: switched,
    migrationRequired: switched,
    silentCopyAllowed: false,
    fallbackAdapterId: DEFAULT_DATA_HOME_ADAPTER_ID,
    policy: current.policy,
  };
}

export function extractDeclaredDataHomeAdapterIds(packageInput: unknown): string[] {
  const packageLike = asRecord(packageInput);
  const capabilities = Array.isArray(packageLike?.capabilities) ? packageLike.capabilities : [];
  const declaredFromCapabilities = capabilities
    .flatMap((capability): string[] => {
      if (typeof capability !== 'string') return [];
      const normalized = capability.trim();
      if (!normalized.startsWith('data-home:')) return [];
      return [normalized.slice('data-home:'.length).trim()];
    })
    .filter((value) => value.length > 0);
  const dataHomes = Array.isArray(packageLike?.data_homes) ? packageLike.data_homes : [];
  const declaredFromDomainManifest = dataHomes
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  return sortedUniqueStringSet(['sqlite', ...declaredFromCapabilities, ...declaredFromDomainManifest]);
}

function blockedSelection(input: {
  installationId: string;
  requestedAdapterId: DataHomeAdapterId;
  updatedAt: string;
  policy: DataHomeSelectionPolicy;
  declared: boolean;
  reason: string;
  descriptor?: DataHomeAdapterDescriptor;
}): DataHomeSelectionResolution {
  return {
    schemaVersion: DATA_HOME_SELECTION_SCHEMA_VERSION,
    installationId: input.installationId,
    requestedAdapterId: input.requestedAdapterId,
    effectiveAdapterId: null,
    fallbackAdapterId: input.policy.fallbackAdapterId,
    policy: input.policy,
    status: 'blocked',
    readiness: input.descriptor?.readiness ?? 'blocked',
    kind: input.descriptor?.kind ?? null,
    declared: input.declared,
    supported: Boolean(input.descriptor),
    capabilities: input.descriptor ? [...input.descriptor.capabilities] : [],
    reason: input.reason,
    updatedAt: input.updatedAt,
  };
}

function normalizeSelection(selection?: DataHomeInstallationSelection | null): DataHomeInstallationSelection | null {
  if (!selection) return null;
  return {
    installationId: normalizeRequiredId(selection.installationId, 'installation_id_required'),
    adapterId: normalizeAdapterId(selection.adapterId),
    updatedAt: selection.updatedAt ?? null,
  };
}

function normalizeAdapterDescriptor(adapter: DataHomeAdapterDescriptor): DataHomeAdapterDescriptor {
  const id = normalizeRequiredId(adapter.id, 'data_home_adapter_id_required');
  const kind = adapter.kind === 'local' || adapter.kind === 'remote' ? adapter.kind : null;
  if (!kind) throw new Error(`invalid_data_home_adapter_kind:${id}`);
  const readiness = adapter.readiness === 'ready'
    || adapter.readiness === 'requires_auth'
    || adapter.readiness === 'offline'
    || adapter.readiness === 'blocked'
    ? adapter.readiness
    : null;
  if (!readiness) throw new Error(`invalid_data_home_adapter_readiness:${id}`);
  return {
    id,
    kind,
    readiness,
    capabilities: Array.from(new Set(adapter.capabilities.map((capability) => capability.trim()).filter(Boolean))) as DataHomeCapability[],
  };
}

function resolveDataHomeAdapterAvailability(input: {
  adapterId: SupportedDataHomeAdapterId;
  isDeclared: boolean;
  readiness: DataHomeAdapterReadiness | 'unsupported';
}): DataHomeAdapterContractAvailability {
  if (input.adapterId === DEFAULT_DATA_HOME_ADAPTER_ID) return 'available';
  if (!input.isDeclared) return 'unconfigured';
  if (input.readiness === 'unsupported') return 'unsupported';
  if (input.readiness !== 'ready') return 'not_ready';
  return 'available';
}

function dataHomeAdapterAvailabilityReason(input: {
  adapterId: SupportedDataHomeAdapterId;
  availability: DataHomeAdapterContractAvailability;
  readiness: DataHomeAdapterReadiness | 'unsupported';
}): string {
  const label = dataHomeAdapterLabel(input.adapterId);
  switch (input.availability) {
    case 'available':
      return `${label} is available.`;
    case 'unconfigured':
      return `${label} is not configured by this app.`;
    case 'unsupported':
      return `${label} is not supported by this runtime.`;
    case 'not_ready':
      if (input.readiness === 'requires_auth') return `${label} needs sign-in before use.`;
      if (input.readiness === 'offline') return `${label} is currently offline.`;
      if (input.readiness === 'blocked') return `${label} is blocked by runtime policy.`;
      return `${label} is not available right now.`;
    default:
      return `${label} is not available.`;
  }
}

function lookupAdapter(registry: DataHomeAdapterRegistry, adapterId: string): DataHomeAdapterDescriptor | null {
  if (!normalizeAdapterId(adapterId)) return null;
  return registry.get(adapterId);
}

function normalizeAdapterId(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
}

function sortedUniqueStringSet(values: readonly string[]): string[] {
  const output = new Set<string>(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0),
  );
  return Array.from(output).sort();
}

function normalizeRequiredId(value: string | null | undefined, error: string): string {
  const normalized = normalizeAdapterId(value);
  if (!normalized) throw new Error(error);
  return normalized;
}
