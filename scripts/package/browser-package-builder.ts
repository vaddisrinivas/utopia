import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  collectAppPackageValidationIssues,
  type AppPackage,
  type AppPackagePermissionDeclaration,
} from '@/packages/shared/contracts/package';
import { APP_PACKAGE_WIDGET_KINDS } from '@/packages/shared/contracts/ui-widgets';
import {
  nativeCapabilityMatrixRows,
  type NativeCapabilitySupportState,
  UTOPIA_RUNTIME_PLATFORMS,
  type UtopiaRuntimePlatform,
} from '@/packages/shared/contracts/native-capabilities';
import { type AppPackageNativeIntentKind } from '@/packages/shared/contracts/native-capability-kinds';
import {
  compileAppPackageSource,
  readAppPackageSourceFolder,
  type AppPackageSourceCollection,
  type AppPackageSourceFolder,
  type AppPackageSourceQuery,
  type AppPackageSourceRule,
  type AppPackageSourceScreen,
  type PackageCompilationResult,
} from '@/packages/app-compiler';

type BuilderStarter = {
  id: string;
  label: string;
  homeSurface: string;
  path: string;
};

type BuilderArchetypeId = 'records' | 'dashboard' | 'timed-flow' | 'media' | 'capability-lab';

type BuilderArchetypeTemplate = {
  id: BuilderArchetypeId;
  label: string;
  purposeHint: string;
  defaultScreenCount: number;
  collectionId: string;
  collectionLabel: string;
  collectionFields: Record<string, { type: 'text' | 'number' | 'boolean' | 'timestamp' | 'json'; required?: boolean; indexed?: boolean }>;
  queryId: string;
  queryLimit: number;
  screenMode: AppPackageSourceScreen['mode'];
  screenFields: string[];
  componentsByScreen: { readonly [screenIndex: number]: AppPackageSourceScreen['components'] };
  demoData: Array<Record<string, unknown>>;
  defaultCapabilityIds: string[];
};

type BuilderArchetypeDisplay = {
  id: BuilderArchetypeId;
  label: string;
  purposeHint: string;
  defaultScreenCount: number;
  defaultCapabilityIds: string[];
};

type BuilderNativeRequirement = {
  id: string;
  kind: 'permission' | 'intent';
  platform: 'expo' | UtopiaRuntimePlatform;
  capabilityId: string;
  permission?: string;
  intentKind?: AppPackageNativeIntentKind;
  required?: boolean;
};

type BuilderCapabilityTemplate = {
  id: string;
  label: string;
  description: string;
  packageCapabilities: string[];
  nativeRequirements: BuilderNativeRequirement[];
  dependencyPackages?: string[];
  defaultSelectedForArchetypes: BuilderArchetypeId[];
};

type BuilderCapabilityStatus = {
  id: string;
  label: string;
  description: string;
  packageCapabilities: string[];
  support: ReadonlyArray<{ platform: UtopiaRuntimePlatform; state: NativeCapabilitySupportState }>;
  supported: boolean;
  exportable: boolean;
  deviceProofRequired: boolean;
  blocked: boolean;
  requiresNativeBridge: boolean;
};

type BuilderGenerateResponse =
  | {
      status: 'ok';
      source: BuilderCompileRequest;
      capabilityStatuses: BuilderCapabilityStatus[];
      selectedCapabilities: string[];
      warnings: string[];
    }
  | {
      status: 'error';
      reason: string;
      details: string[];
      blockedCapabilityIds: string[];
      warnings: string[];
    };

type BuilderGenerateRequest = {
  appName: string;
  appPurpose: string;
  screenCount: number;
  archetypeId: BuilderArchetypeId;
  targetPlatforms: UtopiaRuntimePlatform[];
  demoData: boolean;
  selectedCapabilityIds: string[];
  preferredDataHome?: string;
};

type BuilderInfo = {
  starters: BuilderStarter[];
  widgetKinds: string[];
  defaultStarter: string;
  archetypes: BuilderArchetypeDisplay[];
  capabilities: BuilderCapabilityStatus[];
  targetPlatforms: UtopiaRuntimePlatform[];
};

type BuilderCompileRequest = AppPackageSourceFolder;
type SuccessfulCompilation = Extract<PackageCompilationResult, { valid: true }>;
type BuilderImportResponse =
  | {
      status: 'source';
      mode: 'package-source';
      source: BuilderCompileRequest;
    }
  | {
      status: 'compiled';
      mode: 'compiled-package';
      source: BuilderCompileRequest;
      sourceChecksum: string;
      packageChecksum: string;
    }
  | {
      status: 'unsupported';
      mode: 'unsupported';
      reason: string;
      details?: string[];
      warnings: string[];
    };

type BuilderCompileResponse =
  | {
      status: 'valid';
      package: SuccessfulCompilation['package'];
      checksum: string;
      preview: SuccessfulCompilation['preview'];
      errors: never[];
    }
  | {
      status: 'invalid';
      package: undefined;
      checksum: undefined;
      preview: undefined;
      errors: { path: string; message: string }[];
    };

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STUBS_DIR = path.resolve(ROOT_DIR, 'tests', 'fixtures', 'package-source');
const MANIFEST_PATH = path.join(STUBS_DIR, 'manifest.json');
const HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-package-builder.html');
const INDEX_HTML = readFileSync(HTML_PATH, 'utf8');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;

const MAX_SCREEN_COUNT = 12;
const MIN_SCREEN_COUNT = 1;
const DEFAULT_SCREEN_COUNT = 2;

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

const BUILDER_ARCHETYPES: BuilderArchetypeTemplate[] = [
  {
    id: 'records',
    label: 'Records',
    purposeHint: 'Track structured records quickly',
    defaultScreenCount: 2,
    collectionId: 'records',
    collectionLabel: 'Records',
    collectionFields: {
      id: { type: 'text', required: true, indexed: true },
      title: { type: 'text', required: true, indexed: true },
      status: { type: 'text', required: true, indexed: true },
      updated_at: { type: 'timestamp', required: true, indexed: true },
    },
    queryId: 'all_records',
    queryLimit: 50,
    screenMode: 'list',
    screenFields: ['title', 'status', 'updated_at'],
    componentsByScreen: {
      0: [
        { kind: 'widget', widget: 'checklistCard', props: { title: 'Recent records' } },
      ],
      1: [
        { kind: 'widget', widget: 'dataTable', props: { title: 'Record table' } },
      ],
    },
    demoData: [
      { id: 'r_1', title: 'Setup builder draft', status: 'active', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r_2', title: 'Review package preview', status: 'planned', updated_at: '2026-01-02T00:00:00.000Z' },
    ],
    defaultCapabilityIds: ['records-read'],
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    purposeHint: 'Track key metrics and summaries',
    defaultScreenCount: 2,
    collectionId: 'metrics',
    collectionLabel: 'Metrics',
    collectionFields: {
      id: { type: 'text', required: true, indexed: true },
      title: { type: 'text', required: true, indexed: true },
      value: { type: 'number', required: true, indexed: true },
      delta: { type: 'number', required: true, indexed: true },
      trend: { type: 'text', required: true, indexed: true },
    },
    queryId: 'all_metrics',
    queryLimit: 40,
    screenMode: 'table',
    screenFields: ['title', 'value', 'delta', 'trend'],
    componentsByScreen: {
      0: [
        { kind: 'widget', widget: 'chartBlock', props: { title: 'Dashboard chart' } },
      ],
      1: [{ kind: 'widget', widget: 'dataTable', props: { title: 'Metric table' } }],
    },
    demoData: [
      { id: 'm_1', title: 'Tasks', value: 8, delta: 2, trend: 'up' },
      { id: 'm_2', title: 'Focus', value: 72, delta: -4, trend: 'down' },
    ],
    defaultCapabilityIds: ['records-read', 'records-write'],
  },
  {
    id: 'timed-flow',
    label: 'Timed Flow',
    purposeHint: 'Sequence timed flow states and checkpoints',
    defaultScreenCount: 3,
    collectionId: 'flows',
    collectionLabel: 'Flows',
    collectionFields: {
      id: { type: 'text', required: true, indexed: true },
      title: { type: 'text', required: true, indexed: true },
      status: { type: 'text', required: true, indexed: true },
      step: { type: 'number', required: true, indexed: true },
      stage: { type: 'text', required: true },
      start_at: { type: 'timestamp', required: true },
    },
    queryId: 'all_flows',
    queryLimit: 40,
    screenMode: 'timeline',
    screenFields: ['title', 'status', 'step', 'stage'],
    componentsByScreen: {
      0: [{ kind: 'widget', widget: 'durationTimer', props: { title: 'Current timer' } }],
      1: [{ kind: 'widget', widget: 'timelineBlock', props: { title: 'Flow timeline' } }],
    },
    demoData: [
      { id: 'f_1', title: 'Warm-up', status: 'active', step: 1, stage: 'ready', start_at: '2026-01-01T08:00:00.000Z' },
      { id: 'f_2', title: 'Execution', status: 'pending', step: 2, stage: 'pending', start_at: '2026-01-02T08:00:00.000Z' },
    ],
    defaultCapabilityIds: ['records-read'],
  },
  {
    id: 'media',
    label: 'Media',
    purposeHint: 'Add media views and playback',
    defaultScreenCount: 2,
    collectionId: 'media',
    collectionLabel: 'Media',
    collectionFields: {
      id: { type: 'text', required: true, indexed: true },
      title: { type: 'text', required: true, indexed: true },
      duration_seconds: { type: 'number', required: true, indexed: true },
      media_type: { type: 'text', required: true, indexed: true },
      source_url: { type: 'text', required: true },
    },
    queryId: 'all_media',
    queryLimit: 24,
    screenMode: 'table',
    screenFields: ['title', 'media_type', 'duration_seconds'],
    componentsByScreen: {
      0: [{ kind: 'widget', widget: 'mediaBlock', props: { title: 'Media feed' } }],
      1: [{ kind: 'widget', widget: 'videoPlayer', props: { title: 'Current video' } }],
    },
    demoData: [
      { id: 'v_1', title: 'Launch Clip', duration_seconds: 42, media_type: 'video', source_url: 'https://example.com/video.mp4' },
      { id: 'a_1', title: 'Ambient Loop', duration_seconds: 60, media_type: 'audio', source_url: 'https://example.com/audio.mp3' },
    ],
    defaultCapabilityIds: ['records-read', 'media-gallery'],
  },
  {
    id: 'capability-lab',
    label: 'Capability Lab',
    purposeHint: 'Preview runtime capability matrix and blockers',
    defaultScreenCount: 2,
    collectionId: 'capabilities',
    collectionLabel: 'Capability Rows',
    collectionFields: {
      id: { type: 'text', required: true, indexed: true },
      title: { type: 'text', required: true, indexed: true },
      platform: { type: 'text', required: true, indexed: true },
      status: { type: 'text', required: true, indexed: true },
      required: { type: 'boolean', required: true },
    },
    queryId: 'all_capabilities',
    queryLimit: 30,
    screenMode: 'table',
    screenFields: ['title', 'platform', 'status', 'required'],
    componentsByScreen: {
      0: [{ kind: 'widget', widget: 'permissionCard', props: { title: 'Capability Proof', subtitle: 'Capability exportability and proof state' } }],
      1: [{ kind: 'widget', widget: 'dataTable', props: { title: 'Matrix', columns: ['Capability', 'Platform', 'State', 'Proof required'] } }],
    },
    demoData: [
      { id: 'c_1', title: 'camera', platform: 'expo', status: 'supported', required: true },
      { id: 'c_2', title: 'contacts', platform: 'expo', status: 'planned', required: false },
      { id: 'c_3', title: 'video', platform: 'web', status: 'preview', required: false },
    ],
    defaultCapabilityIds: ['records-read'],
  },
];

const BUILDER_CAPABILITIES: BuilderCapabilityTemplate[] = [
  {
    id: 'records-read',
    label: 'Records read',
    description: 'Read package records from built-in collection models.',
    packageCapabilities: ['records.read'],
    nativeRequirements: [],
    defaultSelectedForArchetypes: ['records', 'dashboard', 'timed-flow', 'media', 'capability-lab'],
  },
  {
    id: 'records-write',
    label: 'Records write',
    description: 'Allow in-app record write actions.',
    packageCapabilities: ['records.write'],
    nativeRequirements: [],
    defaultSelectedForArchetypes: ['dashboard'],
  },
  {
    id: 'media-gallery',
    label: 'Media picker',
    description: 'Read-only media selection from files.',
    packageCapabilities: ['media.gallery'],
    dependencyPackages: ['expo-document-picker'],
    nativeRequirements: [
      { id: 'media-gallery', kind: 'permission', platform: 'expo', capabilityId: 'files', permission: 'expo-document-picker', required: false },
    ],
    defaultSelectedForArchetypes: ['media'],
  },
  {
    id: 'camera',
    label: 'Camera',
    description: 'Capture photo/video input and render in media screens.',
    packageCapabilities: ['media.camera'],
    dependencyPackages: ['expo-camera'],
    nativeRequirements: [
      { id: 'camera', kind: 'permission', platform: 'expo', capabilityId: 'camera', permission: 'expo-camera', required: false },
      { id: 'camera-intent', kind: 'intent', platform: 'expo', capabilityId: 'deep_link', intentKind: 'deep_link', required: false },
    ],
    defaultSelectedForArchetypes: [],
  },
  {
    id: 'contacts-access',
    label: 'Contacts access',
    description: 'Read local contacts for contact-picker flows.',
    packageCapabilities: ['contacts.read'],
    dependencyPackages: ['expo-contacts'],
    nativeRequirements: [
      { id: 'contacts', kind: 'permission', platform: 'expo', capabilityId: 'contacts', permission: 'expo-contacts', required: false },
    ],
    defaultSelectedForArchetypes: [],
  },
  {
    id: 'location',
    label: 'Location lookup',
    description: 'Read rough location for map/list widgets.',
    packageCapabilities: ['location.lookup'],
    dependencyPackages: ['expo-location'],
    nativeRequirements: [
      { id: 'location', kind: 'permission', platform: 'expo', capabilityId: 'location', permission: 'expo-location', required: false },
    ],
    defaultSelectedForArchetypes: ['media'],
  },
];

const INDEX_BY_ARC_ID = BUILDER_ARCHETYPES.reduce<Record<string, BuilderArchetypeTemplate>>((acc, template) => {
  acc[template.id] = template;
  return acc;
}, {});

const CAPABILITY_BY_ID = BUILDER_CAPABILITIES.reduce<Record<string, BuilderCapabilityTemplate>>((acc, capability) => {
  acc[capability.id] = capability;
  return acc;
}, {});

export function getBuilderArchetypes(): BuilderArchetypeDisplay[] {
  return BUILDER_ARCHETYPES.map((item) => ({
    id: item.id,
    label: item.label,
    purposeHint: item.purposeHint,
    defaultScreenCount: clampScreenCount(item.defaultScreenCount),
    defaultCapabilityIds: [...item.defaultCapabilityIds],
  }));
}

function capabilityNativeSupportState(capabilityId: string, kind: 'permission' | 'intent', platform: UtopiaRuntimePlatform): NativeCapabilitySupportState {
  const entry = nativeCapabilityMatrixRows().find((item) => item.id === capabilityId && item.kind === kind);
  return entry?.support[platform] ?? 'unsupported';
}

function normalizeTargetPlatforms(raw: unknown): UtopiaRuntimePlatform[] {
  if (!Array.isArray(raw)) {
    return [...UTOPIA_RUNTIME_PLATFORMS];
  }
  const filtered = raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is UtopiaRuntimePlatform => UTOPIA_RUNTIME_PLATFORMS.includes(entry as UtopiaRuntimePlatform));
  return filtered.length > 0 ? [...new Set(filtered)] : [...UTOPIA_RUNTIME_PLATFORMS];
}

function isTemplateCapability(platform: string): platform is 'expo' | UtopiaRuntimePlatform {
  return platform === 'expo' || UTOPIA_RUNTIME_PLATFORMS.includes(platform as UtopiaRuntimePlatform);
}

function scopeRequirementPlatforms(platform: 'expo' | UtopiaRuntimePlatform, targetPlatforms: UtopiaRuntimePlatform[]): UtopiaRuntimePlatform[] {
  if (platform === 'expo') {
    return targetPlatforms;
  }
  return targetPlatforms.filter((target) => target === platform);
}

function normalizePreferredDataHome(raw: unknown): string | undefined {
  if (!isText(raw)) return undefined;
  const normalized = raw.trim().toLowerCase();
  return normalized || undefined;
}

export function getArchetypeCapabilityStatuses(targetPlatforms: readonly unknown[] | undefined): BuilderCapabilityStatus[] {
  const targets = normalizeTargetPlatforms(targetPlatforms);
  return BUILDER_CAPABILITIES.map((capability) => {
    if (capability.nativeRequirements.length === 0) {
      return {
        id: capability.id,
        label: capability.label,
        description: capability.description,
        packageCapabilities: [...capability.packageCapabilities],
        support: targets.map((platform) => ({ platform, state: 'supported' as const })),
        supported: true,
        exportable: true,
        deviceProofRequired: false,
        blocked: false,
        requiresNativeBridge: false,
      };
    }

    const support: Record<UtopiaRuntimePlatform, NativeCapabilitySupportState> = targets.reduce((acc, platform) => {
      acc[platform] = 'supported';
      return acc;
    }, {} as Record<UtopiaRuntimePlatform, NativeCapabilitySupportState>);

    for (const requirement of capability.nativeRequirements) {
      const requirementPlatforms = scopeRequirementPlatforms(requirement.platform, targets).filter(isTemplateCapability);
      if (requirementPlatforms.length === 0) continue;

      for (const platform of requirementPlatforms) {
        const state = capabilityNativeSupportState(
          requirement.capabilityId,
          requirement.kind,
          platform,
        );
        const order: NativeCapabilitySupportState[] = ['unsupported', 'planned', 'supported'];
        if (order.indexOf(state) < order.indexOf(support[platform])) {
          support[platform] = state;
        }
      }
    }

    const supportList = Object.entries(support).map(([platform, state]) => ({
      platform: platform as UtopiaRuntimePlatform,
      state,
    }));
    const blocked = supportList.some(({ state }) => state === 'unsupported');
    const supported = supportList.every(({ state }) => state === 'supported');
    const exportable = supportList.every(({ state }) => state !== 'unsupported');

    return {
      id: capability.id,
      label: capability.label,
      description: capability.description,
      packageCapabilities: [...capability.packageCapabilities],
      support: supportList,
      supported,
      exportable,
      deviceProofRequired: capability.nativeRequirements.length > 0,
      blocked,
      requiresNativeBridge: capability.nativeRequirements.length > 0,
    };
  });
}

export function getBuilderInfo(): BuilderInfo {
  const starters = readBuilderManifest();
  return {
    starters,
    widgetKinds: [...APP_PACKAGE_WIDGET_KINDS],
    defaultStarter: starters[0]?.id ?? 'chores-lite',
    archetypes: getBuilderArchetypes(),
    capabilities: getArchetypeCapabilityStatuses(UTOPIA_RUNTIME_PLATFORMS),
    targetPlatforms: [...UTOPIA_RUNTIME_PLATFORMS],
  };
}

export function readStarterSource(id: string): AppPackageSourceFolder {
  const manifest = getBuilderInfo().starters;
  const entry = manifest.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`unknown starter: ${id}`);
  }
  const sourceDir = path.join(STUBS_DIR, entry.path);
  return readAppPackageSourceFolder(sourceDir);
}

export function parseBrowserBuilderArgs(argv: string[]): { host: string; port: number } {
  let port = DEFAULT_PORT;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    }
    if (token === '--port') {
      const rawPort = argv[index + 1];
      if (!rawPort) {
        throw new Error('missing value for --port');
      }
      const parsed = Number.parseInt(rawPort, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`invalid --port: ${rawPort}`);
      }
      port = parsed;
      index += 1;
    }
  }

  return { host: DEFAULT_HOST, port };
}

export function compileBuilderSource(source: BuilderCompileRequest): BuilderCompileResponse {
  const compiled = compileAppPackageSource(source);
  if (!compiled.valid) {
    return {
      status: 'invalid',
      package: undefined,
      checksum: undefined,
      preview: undefined,
      errors: compiled.errors,
    };
  }

  return {
    status: 'valid',
    package: compiled.package,
    checksum: compiled.checksum,
    preview: compiled.preview,
    errors: [],
  };
}

function clampScreenCount(screenCount: number): number {
  if (!Number.isInteger(screenCount)) {
    return DEFAULT_SCREEN_COUNT;
  }
  if (screenCount < MIN_SCREEN_COUNT) return MIN_SCREEN_COUNT;
  if (screenCount > MAX_SCREEN_COUNT) return MAX_SCREEN_COUNT;
  return screenCount;
}

function makeSafeId(input: string): string {
  const fallback = 'untitled-app';
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+)|(-+$)/g, '');
  return slug || fallback;
}

function buildArchetypeScreens(template: BuilderArchetypeTemplate, count: number, purpose: string): Record<string, AppPackageSourceScreen> {
  const normalized = clampScreenCount(count);
  const screens: Record<string, AppPackageSourceScreen> = {};

  for (let index = 0; index < normalized; index += 1) {
    const screenId = index === 0 ? `${template.id}-home` : `${template.id}-${index + 1}`;
    const suffix = index === 0 ? 'Overview' : `Screen ${index + 1}`;
    screens[screenId] = {
      label: `${template.collectionLabel} ${suffix}`,
      collections: [template.collectionId],
      query: template.queryId,
      mode: template.screenMode,
      fields: template.screenFields,
      ...(index === 0 ? { subtitle: purpose || template.purposeHint } : {}),
      ...(template.componentsByScreen[index] ? { components: template.componentsByScreen[index] } : {}),
    };
  }

  return screens;
}

function buildArchetypeQueries(template: BuilderArchetypeTemplate): Record<string, AppPackageSourceQuery> {
  return {
    [template.queryId]: {
      from: template.collectionId,
      limit: template.queryLimit,
    },
  };
}

function buildArchetypeCollections(template: BuilderArchetypeTemplate): Record<string, AppPackageSourceCollection> {
  return {
    [template.collectionId]: {
      ...template.collectionId && { id: template.collectionId },
      fields: template.collectionFields,
    },
  };
}

function buildArchetypeRules(): Record<string, AppPackageSourceRule> {
  return {};
}

function buildArchetypeCapabilities(capabilityIds: string[], preferredDataHome?: string): BuilderCompileRequest['capabilities'] {
  const selected = capabilityIds.map((id) => CAPABILITY_BY_ID[id]).filter((item): item is BuilderCapabilityTemplate => item !== undefined);
  const packageCapabilities = [...new Set(selected.flatMap((item) => item.packageCapabilities))];
  const dataHomeCapability = isText(preferredDataHome) ? `data-home:${normalizePreferredDataHome(preferredDataHome)}` : undefined;
  const requestedCapabilities = [...new Set([...packageCapabilities, ...(dataHomeCapability ? [dataHomeCapability] : [])])];
  const dependencyPackages = [...new Set(selected.flatMap((item) => item.dependencyPackages ?? []))].sort();
  const dependencyPins: Array<{ package: string; version: string; source?: 'npm' | 'maven' | 'gradle' | 'cocoapods' | 'other' }> = [];
  const permissions: AppPackagePermissionDeclaration[] = [];
  const nativeIntents: Array<{
    id: string;
    platform: 'expo' | UtopiaRuntimePlatform;
    kind: AppPackageNativeIntentKind;
    reason: string;
    required?: boolean;
    payload?: Record<string, unknown>;
  }> = [];

  for (const capability of selected) {
    for (const requirement of capability.nativeRequirements) {
      if (requirement.kind === 'permission') {
        if (!requirement.permission || !isTemplateCapability(requirement.platform)) continue;
        permissions.push({
          id: `${capability.id}-${requirement.id}`,
          platform: requirement.platform,
          permission: requirement.permission,
          reason: requirement.id,
          required: requirement.required,
        });
      }

      if (requirement.kind === 'intent' && requirement.intentKind && isTemplateCapability(requirement.platform)) {
        nativeIntents.push({
          id: `${capability.id}-${requirement.id}`,
          platform: requirement.platform,
          kind: requirement.intentKind,
          reason: requirement.id,
          required: requirement.required,
        });
      }
    }
  }

  const native = selected.some((item) => item.nativeRequirements.length > 0) ? {
    schemaVersion: 'wonder.app-package-native-capabilities.v1' as const,
    platform: 'expo' as const,
    packages: dependencyPackages,
    ...(permissions.length > 0 ? { permissions } : {}),
    ...(nativeIntents.length > 0 ? { intents: nativeIntents } : {}),
  } : undefined;

  if (!native) {
    return {
      package: requestedCapabilities,
    };
  }

  return {
    package: requestedCapabilities,
    native,
    dependencyPins,
    pinnedAt: '1970-01-01T00:00:00.000Z',
  };
}

function buildArchetypeSource(request: BuilderGenerateRequest): BuilderCompileRequest {
  const template = INDEX_BY_ARC_ID[request.archetypeId];
  if (!template) {
    throw new Error(`unknown archetype: ${request.archetypeId}`);
  }

  const normalizedPurpose = request.appPurpose.trim();
  const appLabel = normalizedPurpose ? `${request.appName.trim()} - ${normalizedPurpose}` : request.appName.trim();
  const selected = new Set([...template.defaultCapabilityIds, ...request.selectedCapabilityIds]);
  const capabilityStatuses = getArchetypeCapabilityStatuses(request.targetPlatforms);
  const blockedCapabilityIds = [...selected]
    .filter((id) => capabilityStatuses.find((cap) => cap.id === id && cap.blocked))
    .sort();
  if (blockedCapabilityIds.length > 0) {
    throw new Error(`blocked capabilities: ${blockedCapabilityIds.join(', ')}`);
  }
  const unknown = [...selected].filter((id) => CAPABILITY_BY_ID[id] === undefined);
  if (unknown.length > 0) {
    throw new Error(`unknown capability ids: ${unknown.join(', ')}`);
  }

  const selectedCapabilityIds = [...selected].filter((id) => CAPABILITY_BY_ID[id] !== undefined);
  const screens = buildArchetypeScreens(template, request.screenCount, request.appPurpose.trim());
  const firstScreen = Object.keys(screens)[0] ?? `${template.id}-home`;
  const preferredDataHome = normalizePreferredDataHome(request.preferredDataHome);
  const capabilities = buildArchetypeCapabilities(selectedCapabilityIds, preferredDataHome);

  return {
    app: {
      schemaVersion: 'wonder.package-source.v1',
      id: makeSafeId(`${request.appName.trim()}-${template.id}`),
      version: '1.0.0',
      label: appLabel || template.label,
      homeSurface: firstScreen,
      ...(preferredDataHome ? { providerTemplateFields: { preferredDataHome } } : {}),
    },
    collections: buildArchetypeCollections(template),
    queries: buildArchetypeQueries(template),
    screens,
    rules: buildArchetypeRules(),
    ...(request.demoData ? { fixtures: { [template.collectionId]: template.demoData } } : {}),
    capabilities,
  };
}

function parseGuidedRequest(rawPayload: unknown): BuilderGenerateRequest {
  if (!isRecord(rawPayload)) {
    throw new Error('generate request must be an object');
  }

  const appName = isText(rawPayload.appName) ? rawPayload.appName.trim() : '';
  if (!appName) {
    throw new Error('appName is required');
  }

  const appPurpose = isText(rawPayload.appPurpose) ? rawPayload.appPurpose.trim() : '';
  const archetype = typeof rawPayload.archetype === 'string' ? rawPayload.archetype : '';
  if (!INDEX_BY_ARC_ID[archetype]) {
    throw new Error(`archetype must be one of ${Object.keys(INDEX_BY_ARC_ID).join(', ')}`);
  }

  const parsedScreenCount = Number.parseInt(isText(rawPayload.screenCount) ? rawPayload.screenCount : String(rawPayload.screenCount ?? ''), 10);
  const screenCount = clampScreenCount(parsedScreenCount);

  const rawTargets = normalizeTargetPlatforms(rawPayload.targetPlatforms);
  const demoData = rawPayload.demoData === true;
  const selectedCapabilityIds = Array.isArray(rawPayload.selectedCapabilityIds)
    ? rawPayload.selectedCapabilityIds.filter((value) => isText(value)).map((value) => value.trim())
    : [];
  const preferredDataHome = isText(rawPayload.preferredDataHome)
    ? normalizePreferredDataHome(rawPayload.preferredDataHome)
    : undefined;

  return {
    appName,
    appPurpose,
    screenCount,
    archetypeId: archetype as BuilderArchetypeId,
    targetPlatforms: rawTargets,
    demoData,
    selectedCapabilityIds,
    preferredDataHome,
  };
}

export function generateArchetypeSource(rawPayload: unknown): BuilderGenerateResponse {
  try {
    const request = parseGuidedRequest(rawPayload);
    const capabilityStatuses = getArchetypeCapabilityStatuses(request.targetPlatforms);
    const template = INDEX_BY_ARC_ID[request.archetypeId];
    const selectedCapabilityIds = [...new Set([...template.defaultCapabilityIds, ...request.selectedCapabilityIds])];
    const capabilityStatusesById = new Map(capabilityStatuses.map((item) => [item.id, item]));
    const blockedCapabilityIds = selectedCapabilityIds.filter((id) => capabilityStatusesById.get(id)?.blocked);
    const unknownCapabilityIds = selectedCapabilityIds.filter((id) => CAPABILITY_BY_ID[id] === undefined);
    const warnings = selectedCapabilityIds
      .filter((id) => CAPABILITY_BY_ID[id]?.nativeRequirements.length)
      .map((id) => `${id} requires native bridge support and will include native capability declarations`);

    if (unknownCapabilityIds.length > 0) {
      return {
        status: 'error',
        reason: `unknown capability ids: ${unknownCapabilityIds.join(', ')}`,
        details: [`Unknown capabilities selected: ${unknownCapabilityIds.join(', ')}`],
        blockedCapabilityIds: [...new Set(unknownCapabilityIds)],
        warnings: [],
      };
    }

    if (blockedCapabilityIds.length > 0) {
      return {
        status: 'error',
        reason: 'selected capability is blocked',
        details: blockedCapabilityIds.map((id) => `${id} blocked on one or more target platforms`),
        blockedCapabilityIds: [...new Set(blockedCapabilityIds)],
        warnings,
      };
    }

    const source = buildArchetypeSource({ ...request, selectedCapabilityIds });

    return {
      status: 'ok',
      source,
      selectedCapabilities: selectedCapabilityIds,
      capabilityStatuses,
      warnings,
    };
  } catch (error) {
    return {
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
      details: [error instanceof Error ? error.message : String(error)],
      blockedCapabilityIds: [],
      warnings: [],
    };
  }
}

export function looksLikePackageSource(rawPayload: unknown): rawPayload is BuilderCompileRequest {
  if (!isRecord(rawPayload)) return false;
  if (!isRecord(rawPayload.app)) return false;
  if (rawPayload.app.schemaVersion !== 'wonder.package-source.v1') return false;
  return true;
}

export function parseBuilderImportPayload(rawPayload: unknown): BuilderImportResponse {
  if (!isRecord(rawPayload)) {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'import payload must be an object',
      warnings: [],
    };
  }

  if (looksLikePackageSource(rawPayload)) {
    return {
      status: 'source',
      mode: 'package-source',
      source: rawPayload,
    };
  }

  if (rawPayload.schemaVersion !== 'wonder.app-package.v2' && rawPayload.schemaVersion !== 'wonder.app-package.v3') {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'unsupported payload schema version',
      details: ['expected wonder.package-source.v1 or wonder.app-package.v2/v3'],
      warnings: [],
    };
  }

  const validationIssues = collectAppPackageValidationIssues(rawPayload as AppPackage).map(
    (issue) => `${issue.category}: ${issue.message}`,
  );
  if (validationIssues.length > 0) {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'compiled payload must pass app-package validation first',
      details: validationIssues,
      warnings: [],
    };
  }

  const conversion = convertCompiledPackageToSource(rawPayload as AppPackage);
  if (conversion.status === 'unsupported') {
    return conversion;
  }

  const packageChecksum = sha256Canonical(rawPayload);
  const recompiled = compileBuilderSource(conversion.source);
  if (recompiled.status === 'invalid') {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'lossless conversion failed after decompile',
      details: recompiled.errors.map((error) => `${error.path}: ${error.message}`),
      warnings: [],
    };
  }

  if (recompiled.checksum !== packageChecksum) {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'import cannot be converted without data loss',
      details: [`compiled checksum: ${packageChecksum}`, `recompiled checksum: ${recompiled.checksum}`],
      warnings: [],
    };
  }

  return {
    status: 'compiled',
    mode: 'compiled-package',
    source: conversion.source,
    sourceChecksum: recompiled.checksum,
    packageChecksum,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseBrowserBuilderArgs(argv);
  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res);
    } catch (error) {
      writeJsonResponse(res, 500, {
        status: 'error',
        errors: [
          {
            path: '',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.once('error', reject);
  });

  process.stdout.write(`Utopia package browser builder running at http://${options.host}:${options.port}\n`);

  const closeServer = () => {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  const handleExit = async () => {
    await closeServer().catch(() => {
      // ignore close errors during shutdown
    });
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void handleExit();
  });
  process.once('SIGTERM', () => {
    void handleExit();
  });
}

function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cleanUrl = req.url ? req.url.split('?')[0] : '/';

  if (req.method === 'GET' && (cleanUrl === '/' || cleanUrl === '/index.html')) {
    writeResponse(res, 200, HTML_CONTENT_TYPE, INDEX_HTML);
    return Promise.resolve();
  }

  if (req.method === 'GET' && cleanUrl === '/api/builder-info') {
    writeJsonResponse(res, 200, getBuilderInfo());
    return Promise.resolve();
  }

  if (req.method === 'POST' && cleanUrl === '/api/archetype-capabilities') {
    return collectBody(req)
      .then((bodyText) => {
        const payload = parseJsonBody(bodyText);
        const targets = normalizeTargetPlatforms(isRecord(payload) ? payload.targetPlatforms : undefined);
        writeJsonResponse(res, 200, {
          capabilities: getArchetypeCapabilityStatuses(targets),
          targetPlatforms: targets,
        });
      })
      .catch((error) => {
        writeJsonResponse(res, 400, { status: 'error', reason: error instanceof Error ? error.message : String(error) });
      });
  }

  if (req.method === 'POST' && cleanUrl === '/api/archetype-generate') {
    return collectBody(req)
      .then((bodyText) => {
        const payload = parseJsonBody(bodyText);
        const result = generateArchetypeSource(payload);
        writeJsonResponse(res, 200, result);
      })
      .catch((error) => {
        writeJsonResponse(res, 400, {
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
          details: [error instanceof Error ? error.message : String(error)],
          blockedCapabilityIds: [],
          warnings: [],
        });
      });
  }

  if (req.method === 'GET' && cleanUrl.startsWith('/api/starter/')) {
    const starterId = decodeURIComponent(cleanUrl.slice('/api/starter/'.length));
    try {
      const source = readStarterSource(starterId);
      writeJsonResponse(res, 200, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJsonResponse(res, 404, { status: 'not_found', message });
    }
    return Promise.resolve();
  }

  if (req.method === 'POST' && cleanUrl === '/api/compile') {
    return collectBody(req)
      .then((bodyText) => {
        const source = parseSourceJsonBody(bodyText);
        const response = compileBuilderSource(source);
        writeJsonResponse(res, 200, response);
      })
      .catch((error) => {
        writeJsonResponse(res, 400, {
          status: 'invalid',
          package: undefined,
          checksum: undefined,
          preview: undefined,
          errors: [{ path: '', message: error instanceof Error ? error.message : String(error) }],
        });
      });
  }

  if (req.method === 'POST' && cleanUrl === '/api/import') {
    return collectBody(req)
      .then((bodyText) => {
        const payload = parseJsonBody(bodyText);
        const response = parseBuilderImportPayload(payload);
        writeJsonResponse(res, 200, response);
      })
      .catch((error) => {
        writeJsonResponse(res, 400, {
          status: 'unsupported',
          mode: 'unsupported',
          reason: error instanceof Error ? error.message : String(error),
          warnings: [],
        } as BuilderImportResponse);
      });
  }

  writeResponse(res, 404, JSON_CONTENT_TYPE, JSON.stringify({ status: 'not-found' }));
  return Promise.resolve();
}

async function collectBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('request body too large'));
      }
    });
    req.on('error', reject);
    req.on('end', () => {
      resolve(data);
    });
  });
}

function parseJsonBody(bodyText: string): unknown {
  const parsed = JSON.parse(bodyText || '{}') as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be an object');
  }

  return parsed;
}

function parseSourceJsonBody(bodyText: string): BuilderCompileRequest {
  const parsed = parseJsonBody(bodyText);
  if (!looksLikePackageSource(parsed)) {
    throw new Error('request body must be package-source data');
  }
  return parsed;
}

function convertCompiledPackageToSource(pkg: AppPackage):
  | {
      status: 'ok';
      source: BuilderCompileRequest;
    }
  | {
      status: 'unsupported';
      mode: 'unsupported';
      reason: string;
      details: string[];
      warnings: string[];
    } {
  const blockers: string[] = [];
  const collections: Record<string, AppPackageSourceCollection> = Object.fromEntries(
    Object.entries(pkg.collections).map(([id, collection]) => [id, { id, fields: collection.fields }]),
  );
  const queries: Record<string, AppPackageSourceQuery> = Object.fromEntries(
    Object.entries(pkg.queries).map(([id, query]) => [id, { id, ...query }]),
  );
  const presentation = pkg.presentation;
  if (!presentation) {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'compiled package has no presentation metadata',
      details: ['package-source reconstruction requires presentation surfaces'],
      warnings: [],
    };
  }
  if (pkg.computedFields?.length) blockers.push('computed fields are not represented by package-source v1');

  const surfaces = presentation.surfaces;
  const viewSet = pkg.views;
  const uiScreens = presentation.ui?.screens ?? {};
  const surfaceViewIds = new Set<string>();
  const screens: Record<string, AppPackageSourceScreen> = {};

  for (const rawSurface of surfaces) {
    const surfaceId = rawSurface.id;
    const surfaceViews = rawSurface.views;
    if (!Array.isArray(surfaceViews) || surfaceViews.length === 0) {
      blockers.push(`surface ${surfaceId} has no views`);
      continue;
    }
    if (surfaceViews.length !== 1) {
      blockers.push(`surface ${surfaceId} has multiple views`);
    }
    const viewId = surfaceViews[0] ?? '';
    if (!viewId) {
      blockers.push(`surface ${surfaceId} has an invalid view`);
      continue;
    }
    const view = viewSet[viewId];
    if (!view) {
      blockers.push(`surface ${surfaceId} references missing view ${viewId}`);
      continue;
    }
    const uiScreen = uiScreens[surfaceId];
    const rawComponents = uiScreen?.components ?? [];

    surfaceViewIds.add(viewId);
    screens[surfaceId] = {
      id: surfaceId,
      label: rawSurface.label,
      query: view.query,
      mode: view.mode,
      fields: view.fields,
      collections: rawSurface.collections,
      ...(uiScreen?.subtitle ? { subtitle: uiScreen.subtitle } : {}),
      ...(rawSurface.imageUrl ? { imageUrl: rawSurface.imageUrl } : {}),
      ...(rawSurface.icon ? { icon: rawSurface.icon } : {}),
      ...(view.groupBy ? { groupBy: view.groupBy } : {}),
      ...(view.layout ? { layout: view.layout } : {}),
      ...(rawComponents.length ? { components: rawComponents } : {}),
    };
  }

  const extraViews = Object.keys(viewSet).filter((viewId) => !surfaceViewIds.has(viewId));
  if (extraViews.length > 0) {
    blockers.push(`extra views not tied to a surface: ${extraViews.join(', ')}`);
  }

  const extraUiScreens = Object.keys(uiScreens).filter((screenId) => !surfaceViewIds.has(screenId));
  if (extraUiScreens.length > 0) {
    blockers.push(`extra ui screens not tied to a surface: ${extraUiScreens.join(', ')}`);
  }

  const rules: Record<string, AppPackageSourceRule> = Object.fromEntries(
    pkg.rules.map((rule) => [rule.id, { ...rule }]),
  );

  const source: BuilderCompileRequest = {
    app: {
      schemaVersion: 'wonder.package-source.v1',
      id: pkg.id,
      version: pkg.version,
      label: presentation.label,
      ...(presentation.homeSurface ? { homeSurface: presentation.homeSurface } : {}),
      ...(presentation.visualIdentity ? { visualIdentity: presentation.visualIdentity } : {}),
      ...(presentation.providerTemplateFields ? { providerTemplateFields: presentation.providerTemplateFields } : {}),
      ...(presentation.render ? { render: presentation.render } : {}),
      ...(presentation.richDetailSchema ? { richDetailSchema: presentation.richDetailSchema } : {}),
    },
    collections,
    queries,
    screens,
    rules,
    ...(pkg.acceptanceTests && pkg.acceptanceTests.length > 0
      ? {
          acceptance: Object.fromEntries(pkg.acceptanceTests.map((entry) => [entry, entry])),
        }
      : {}),
    capabilities: {
      package: Array.isArray(pkg.capabilities) ? [...pkg.capabilities] : [],
      ...(pkg.schemaVersion === 'wonder.app-package.v3' ? { dependencyPins: Array.isArray(pkg.dependencyPins) ? [...pkg.dependencyPins] : [] } : {}),
      ...(pkg.schemaVersion === 'wonder.app-package.v3' ? { native: pkg.nativeCapabilities } : {}),
      ...(pkg.schemaVersion === 'wonder.app-package.v3' ? { pinnedAt: pkg.contractLock.pinnedAt } : {}),
    },
  };

  if (blockers.length > 0) {
    return {
      status: 'unsupported',
      mode: 'unsupported',
      reason: 'compiled package has non-lossless surface/features',
      details: blockers,
      warnings: [],
    };
  }

  return {
    status: 'ok',
    source,
  };
}

function writeResponse(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

export function readBuilderManifest(): BuilderStarter[] {
  const raw = readJsonFile(MANIFEST_PATH);
  if (!Array.isArray(raw)) {
    throw new Error(`builder manifest must be an array: ${MANIFEST_PATH}`);
  }

  return raw
    .map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error(`builder manifest entry ${index} must be an object`);
      }
      const maybePath = typeof entry.path === 'string' ? entry.path : '';
      const maybeLabel = typeof entry.label === 'string' ? entry.label : maybePath;
      const maybeHomeSurface = typeof entry.homeSurface === 'string' ? entry.homeSurface : 'home';
      if (!maybePath) {
        throw new Error(`builder manifest entry ${index} must include a path`);
      }
      return {
        id: maybePath,
        label: maybeLabel,
        homeSurface: maybeHomeSurface,
        path: maybePath,
      } satisfies BuilderStarter;
    });
}

function writeJsonResponse(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function printUsage(): never {
  process.stdout.write([
    'Usage: npm run package:browser-builder -- [--port 4173]',
    '',
    'Optional flags:',
    '  --port     TCP port for the local builder UI',
  ].join('\n') + '\n');
  process.exit(0);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectRun) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
