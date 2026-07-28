import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  A2UiComponent,
  AppPackage,
  AppPackageContractLock,
  AppPackageDependencyPin,
  AppPackageNativeCapability,
  CollectionSpec,
  FieldType,
  PackagePresentationSpec,
  PackageSurfaceSpec,
  RuleSpec,
  ViewSpec,
} from '@/packages/shared/contracts/package';
import { collectAppPackageValidationIssues, type PackageValidationIssue } from '@/packages/shared/contracts/package';
import { nativeCapabilitySupportErrors } from '@/packages/shared/contracts/native-capabilities';
import { isAppPackageNativeIntentKind } from '@/packages/shared/contracts/native-capability-kinds';
import type { QueryPredicate, QuerySort } from '@/packages/shared/contracts/query';
import { APP_PACKAGE_WIDGET_KIND_SET } from '@/packages/shared/contracts/ui-widgets';
import {
  APP_PACKAGE_UI_ACTION_KIND_SET,
  APP_PACKAGE_UI_COMPONENT_KIND_SET,
  APP_PACKAGE_UI_TONE_SET,
} from '@/packages/shared/contracts/ui-primitives';
import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';

export type AppPackageSourceApp = {
  schemaVersion: 'wonder.package-source.v1';
  id: string;
  version: string;
  label: string;
  homeSurface?: string;
  visualIdentity?: Record<string, unknown>;
  render?: Record<string, unknown>;
  richDetailSchema?: string;
  providerTemplateFields?: Record<string, unknown>;
};

export type AppPackageSourceCollection = {
  id?: string;
  fields: CollectionSpec['fields'];
};

export type AppPackageSourceQuery = {
  id?: string;
  from: string;
  where?: QueryPredicate;
  orderBy?: QuerySort[];
  limit?: number;
};

export type AppPackageSourceScreen = {
  id?: string;
  label: string;
  subtitle?: string;
  collections: string[];
  query: string;
  mode: ViewSpec['mode'];
  fields: string[];
  icon?: string;
  imageUrl?: string;
  groupBy?: string;
  layout?: Record<string, unknown>;
  components?: A2UiComponent[];
};

export type AppPackageSourceRule = Omit<RuleSpec, 'id'> & { id?: string };

export type AppPackageSourceCapabilities = {
  package?: string[];
  dependencyPins?: AppPackageDependencyPin[];
  native?: AppPackageNativeCapability;
  pinnedAt?: string;
};

export type AppPackageSourceFolder = {
  app: AppPackageSourceApp;
  collections?: Record<string, AppPackageSourceCollection>;
  queries?: Record<string, AppPackageSourceQuery>;
  screens?: Record<string, AppPackageSourceScreen>;
  rules?: Record<string, AppPackageSourceRule>;
  workflows?: Record<string, unknown>;
  providers?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  fixtures?: Record<string, unknown>;
  acceptance?: Record<string, unknown>;
  capabilities?: AppPackageSourceCapabilities;
};

export type PackageCompilerIssue = Readonly<{
  path: string;
  message: string;
}>;

export type PackageSemanticDiff = Readonly<{
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
  summary: string;
}>;

export type PackagePreviewMetadata = Readonly<{
  schemaVersion: 'wonder.app-package-preview.v1';
  packageSchemaVersion: AppPackage['schemaVersion'];
  id: string;
  version: string;
  label: string;
  checksum: string;
  homeSurface?: string;
  surfaces: Array<{
    id: string;
    label: string;
    collections: string[];
    views: string[];
  }>;
  collectionIds: string[];
  queryIds: string[];
  ruleIds: string[];
  widgets: string[];
  acceptanceTests: string[];
  sourceCounts: {
    app: number;
    collections: number;
    queries: number;
    screens: number;
    rules: number;
    workflows: number;
    providers: number;
    theme: number;
    fixtures: number;
    acceptance: number;
    capabilities: number;
  };
  nativeCapabilities?: {
    platform: AppPackageNativeCapability['platform'];
    packages: string[];
    permissions: string[];
    intents: string[];
  };
  diffSummary: {
    added: number;
    removed: number;
    changed: number;
  };
}>;

export type PackageCompilationResult =
  | {
      valid: true;
      package: AppPackage;
      checksum: string;
      diff: PackageSemanticDiff[];
      preview: PackagePreviewMetadata;
    }
  | {
      valid: false;
      errors: PackageCompilerIssue[];
    };

const SOURCE_SCHEMA_VERSION = 'wonder.package-source.v1' as const;
const PREVIEW_SCHEMA_VERSION = 'wonder.app-package-preview.v1' as const;
const UI_ACTION_TOOL_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

export function readAppPackageSourceFolder(rootDir: string): AppPackageSourceFolder {
  const appPath = join(rootDir, 'app.json');
  if (!existsSync(appPath)) {
    throw new Error(`missing app.json in ${rootDir}`);
  }

  return {
    app: readJsonFile(appPath) as AppPackageSourceApp,
    collections: readJsonMap(join(rootDir, 'collections')) as Record<string, AppPackageSourceCollection> | undefined,
    queries: readJsonMap(join(rootDir, 'queries')) as Record<string, AppPackageSourceQuery> | undefined,
    screens: readJsonMap(join(rootDir, 'screens')) as Record<string, AppPackageSourceScreen> | undefined,
    rules: readJsonMap(join(rootDir, 'rules')) as Record<string, AppPackageSourceRule> | undefined,
    workflows: readJsonMap(join(rootDir, 'workflows')) as Record<string, unknown> | undefined,
    providers: readJsonMap(join(rootDir, 'providers')) as Record<string, unknown> | undefined,
    theme: readJsonMap(join(rootDir, 'theme')) as Record<string, unknown> | undefined,
    fixtures: readJsonMap(join(rootDir, 'fixtures')) as Record<string, unknown> | undefined,
    acceptance: readJsonMap(join(rootDir, 'acceptance')) as Record<string, unknown> | undefined,
    capabilities: readCapabilitiesFolder(join(rootDir, 'capabilities')),
  };
}

export function compileAppPackageSourceFolder(
  sourceOrRoot: string | AppPackageSourceFolder,
  options: { baselinePackage?: AppPackage } = {},
): PackageCompilationResult {
  const source = typeof sourceOrRoot === 'string' ? readAppPackageSourceFolder(sourceOrRoot) : sourceOrRoot;
  return compileAppPackageSource(source, options);
}

export function compileAppPackageSource(
  source: AppPackageSourceFolder,
  options: { baselinePackage?: AppPackage } = {},
): PackageCompilationResult {
  const sourceIssues = collectSourceIssues(source);
  if (sourceIssues.length > 0) {
    return {
      valid: false,
      errors: sourceIssues,
    };
  }

  const normalizedSource = normalizeSourceFolder(source);
  const packageDraft = buildCompiledPackage(normalizedSource);
  const packageIssues = collectPackageIssues(packageDraft);
  if (packageIssues.length > 0) {
    return {
      valid: false,
      errors: packageIssues,
    };
  }

  const checksum = sha256Canonical(packageDraft);
  const diff = options.baselinePackage ? diffAppPackages(options.baselinePackage, packageDraft) : [];
  const preview = buildPackagePreviewMetadata(packageDraft, checksum, normalizedSource, diff);

  return {
    valid: true,
    package: packageDraft,
    checksum,
    diff,
    preview,
  };
}

export function diffAppPackages(before: AppPackage, after: AppPackage): PackageSemanticDiff[] {
  const diffs: PackageSemanticDiff[] = [];
  diffValues('', before, after, diffs);
  return diffs;
}

export function buildPackagePreviewMetadata(
  packageDraft: AppPackage,
  checksum: string,
  source: NormalizedAppPackageSource,
  diff: PackageSemanticDiff[] = [],
): PackagePreviewMetadata {
  const surfaces = packageDraft.presentation?.surfaces ?? [];
  const screens = packageDraft.presentation?.ui?.screens ?? {};
  const widgets = uniqueStrings(
    Object.values(screens).flatMap((screen) =>
      (screen.components ?? [])
        .filter((component): component is A2UiComponent & { kind: 'widget' } => component.kind === 'widget')
        .map((component) => String(component.widget)),
    ),
  );
  const nativeCapabilities = packageDraft.schemaVersion === 'wonder.app-package.v3'
    ? {
        platform: packageDraft.nativeCapabilities.platform,
        packages: uniqueStrings([...packageDraft.nativeCapabilities.packages]),
        permissions: uniqueStrings((packageDraft.nativeCapabilities.permissions ?? []).map(normalizePermissionLabel)),
        intents: uniqueStrings((packageDraft.nativeCapabilities.intents ?? []).map((intent) => `${intent.platform}:${intent.kind}`)),
      }
    : undefined;

  return {
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    packageSchemaVersion: packageDraft.schemaVersion,
    id: packageDraft.id,
    version: packageDraft.version,
    label: packageDraft.presentation?.label ?? packageDraft.id,
    checksum,
    ...(packageDraft.presentation?.homeSurface ? { homeSurface: packageDraft.presentation.homeSurface } : {}),
    surfaces: surfaces.map((surface) => ({
      id: surface.id,
      label: surface.label,
      collections: [...surface.collections],
      views: surface.views ? [...surface.views] : [],
    })),
    collectionIds: Object.keys(packageDraft.collections),
    queryIds: Object.keys(packageDraft.queries),
    ruleIds: packageDraft.rules.map((rule) => rule.id),
    widgets,
    acceptanceTests: [...packageDraft.acceptanceTests],
    sourceCounts: {
      app: 1,
      collections: Object.keys(source.collections).length,
      queries: Object.keys(source.queries).length,
      screens: Object.keys(source.screens).length,
      rules: Object.keys(source.rules).length,
      workflows: Object.keys(source.workflows).length,
      providers: Object.keys(source.providers).length,
      theme: Object.keys(source.theme).length,
      fixtures: Object.keys(source.fixtures).length,
      acceptance: Object.keys(source.acceptance).length,
      capabilities: countCapabilities(source.capabilities),
    },
    ...(nativeCapabilities ? { nativeCapabilities } : {}),
    diffSummary: {
      added: diff.filter((entry) => entry.kind === 'added').length,
      removed: diff.filter((entry) => entry.kind === 'removed').length,
      changed: diff.filter((entry) => entry.kind === 'changed').length,
    },
  };
}

export function collectSourceIssues(source: AppPackageSourceFolder): PackageCompilerIssue[] {
  const errors: PackageCompilerIssue[] = [];

  if (!isRecord(source)) {
    return [{ path: '', message: 'source must be an object' }];
  }

  if (!isRecord(source.app)) {
    errors.push({ path: '/app', message: 'app.json is required' });
    return errors;
  }

  if (source.app.schemaVersion !== SOURCE_SCHEMA_VERSION) {
    errors.push({ path: '/app/schemaVersion', message: `schemaVersion must be ${SOURCE_SCHEMA_VERSION}` });
  }
  if (!isText(source.app.id)) errors.push({ path: '/app/id', message: 'app.id is required' });
  if (!isText(source.app.version)) errors.push({ path: '/app/version', message: 'app.version is required' });
  if (!isText(source.app.label)) errors.push({ path: '/app/label', message: 'app.label is required' });

  const collections = source.collections ?? {};
  const queries = source.queries ?? {};
  const screens = source.screens ?? {};
  const rules = source.rules ?? {};
  const capabilities = source.capabilities ?? {};

  if (!isRecord(collections)) errors.push({ path: '/collections', message: 'collections must be an object map' });
  if (!isRecord(queries)) errors.push({ path: '/queries', message: 'queries must be an object map' });
  if (!isRecord(screens)) errors.push({ path: '/screens', message: 'screens must be an object map' });
  if (!isRecord(rules)) errors.push({ path: '/rules', message: 'rules must be an object map' });

  const collectionIds = new Set(Object.keys(collections));
  const queryIds = new Set(Object.keys(queries));
  const screenIds = new Set(Object.keys(screens));

  for (const [id, collection] of Object.entries(collections)) {
    if (!isRecord(collection)) {
      errors.push({ path: `/collections/${id}`, message: 'collection must be an object' });
      continue;
    }
    if (collection.id !== undefined && collection.id !== id) {
      errors.push({ path: `/collections/${id}/id`, message: `collection id must match ${id}` });
    }
    if (!isRecord(collection.fields)) {
      errors.push({ path: `/collections/${id}/fields`, message: 'collection.fields is required' });
      continue;
    }
    for (const [fieldId, field] of Object.entries(collection.fields)) {
      if (!isRecord(field)) {
        errors.push({ path: `/collections/${id}/fields/${fieldId}`, message: 'field must be an object' });
        continue;
      }
      if (!isText(field.type)) {
        errors.push({ path: `/collections/${id}/fields/${fieldId}/type`, message: 'field.type is required' });
      }
    }
  }

  for (const [id, query] of Object.entries(queries)) {
    if (!isRecord(query)) {
      errors.push({ path: `/queries/${id}`, message: 'query must be an object' });
      continue;
    }
    if (query.id !== undefined && query.id !== id) {
      errors.push({ path: `/queries/${id}/id`, message: `query id must match ${id}` });
    }
    if (!isText(query.from)) {
      errors.push({ path: `/queries/${id}/from`, message: 'query.from is required' });
      continue;
    }
    if (query.from !== 'records' && !collectionIds.has(query.from)) {
      errors.push({ path: `/queries/${id}/from`, message: `query ${id} references missing collection ${query.from}` });
    }
  }

  for (const [id, screen] of Object.entries(screens)) {
    if (!isRecord(screen)) {
      errors.push({ path: `/screens/${id}`, message: 'screen must be an object' });
      continue;
    }
    if (screen.id !== undefined && screen.id !== id) {
      errors.push({ path: `/screens/${id}/id`, message: `screen id must match ${id}` });
    }
    if (!isText(screen.label)) errors.push({ path: `/screens/${id}/label`, message: `screen ${id} label is required` });
    if (!isText(screen.query)) errors.push({ path: `/screens/${id}/query`, message: `screen ${id} query is required` });
    else if (!queryIds.has(screen.query)) {
      errors.push({ path: `/screens/${id}/query`, message: `screen ${id} references missing query ${screen.query}` });
    }
    if (!Array.isArray(screen.collections)) {
      errors.push({ path: `/screens/${id}/collections`, message: `screen ${id} collections must be an array` });
    } else {
      for (const [index, collectionId] of screen.collections.entries()) {
        if (!isText(collectionId)) {
          errors.push({ path: `/screens/${id}/collections/${index}`, message: 'screen collection id must be a string' });
          continue;
        }
        if (!collectionIds.has(collectionId)) {
          errors.push({ path: `/screens/${id}/collections/${index}`, message: `screen ${id} references missing collection ${collectionId}` });
        }
      }
    }
    if (!isText(screen.mode) || !['list', 'board', 'table', 'calendar', 'timeline', 'chart'].includes(screen.mode)) {
      errors.push({ path: `/screens/${id}/mode`, message: `screen ${id} mode is invalid` });
    }
    if (!Array.isArray(screen.fields) || !screen.fields.every(isText)) {
      errors.push({ path: `/screens/${id}/fields`, message: `screen ${id} fields must be strings` });
    }
    if (screen.components !== undefined) {
      errors.push(...collectUiComponentIssues(screen.components, `/screens/${id}/components`, collectionIds, screenIds));
    }
  }

  for (const [id, rule] of Object.entries(rules)) {
    if (!isRecord(rule)) {
      errors.push({ path: `/rules/${id}`, message: 'rule must be an object' });
      continue;
    }
    if (rule.id !== undefined && rule.id !== id) {
      errors.push({ path: `/rules/${id}/id`, message: `rule id must match ${id}` });
    }
    if (!isRecord(rule.trigger)) {
      errors.push({ path: `/rules/${id}/trigger`, message: `rule ${id} trigger is required` });
    }
    if (!isRecord(rule.effect)) {
      errors.push({ path: `/rules/${id}/effect`, message: `rule ${id} effect is required` });
    }
    if (!isText(rule.mode) || !['suggest', 'automatic'].includes(rule.mode)) {
      errors.push({ path: `/rules/${id}/mode`, message: `rule ${id} mode is invalid` });
    }
    if (!Number.isInteger(rule.maxRunsPerEvent) || rule.maxRunsPerEvent < 1) {
      errors.push({ path: `/rules/${id}/maxRunsPerEvent`, message: `rule ${id} maxRunsPerEvent is invalid` });
    }
  }

  if (capabilities.package !== undefined && (!Array.isArray(capabilities.package) || !capabilities.package.every(isText))) {
    errors.push({ path: '/capabilities/package', message: 'capabilities.package must be an array of strings' });
  }

  if (capabilities.dependencyPins !== undefined) {
    if (!Array.isArray(capabilities.dependencyPins)) {
      errors.push({ path: '/capabilities/dependencyPins', message: 'capabilities.dependencyPins must be an array' });
    } else {
      for (const [index, pin] of capabilities.dependencyPins.entries()) {
        if (!isDependencyPin(pin)) {
          errors.push({ path: `/capabilities/dependencyPins/${index}`, message: 'dependency pin must include package and version' });
        }
      }
    }
  }

  if (capabilities.dependencyPins?.length && !capabilities.native) {
    errors.push({ path: '/capabilities/native', message: 'native capabilities are required when dependency pins are declared' });
  }

  if (capabilities.native !== undefined) {
    if (!isNativeCapability(capabilities.native)) {
      errors.push({ path: '/capabilities/native', message: 'capabilities.native is invalid' });
    } else {
      for (const supportError of nativeCapabilitySupportErrors(capabilities.native)) {
        errors.push({ path: '/capabilities/native', message: supportError });
      }
    }
  }

  if ((capabilities.native || capabilities.dependencyPins?.length) && !isText(capabilities.pinnedAt)) {
    errors.push({ path: '/capabilities/pinnedAt', message: 'capabilities.pinnedAt is required when native capabilities are declared' });
  }

  if (source.app.homeSurface !== undefined && !screenIds.has(source.app.homeSurface)) {
    errors.push({ path: '/app/homeSurface', message: `homeSurface references missing screen ${source.app.homeSurface}` });
  }

  if (source.app.visualIdentity !== undefined && !isRecord(source.app.visualIdentity)) {
    errors.push({ path: '/app/visualIdentity', message: 'app.visualIdentity must be an object' });
  }
  if (source.app.render !== undefined && !isRecord(source.app.render)) {
    errors.push({ path: '/app/render', message: 'app.render must be an object' });
  }
  if (source.app.providerTemplateFields !== undefined && !isRecord(source.app.providerTemplateFields)) {
    errors.push({ path: '/app/providerTemplateFields', message: 'app.providerTemplateFields must be an object' });
  }
  if (source.app.richDetailSchema !== undefined && !isText(source.app.richDetailSchema)) {
    errors.push({ path: '/app/richDetailSchema', message: 'app.richDetailSchema must be a string' });
  }

  for (const [folderName, folderValue] of Object.entries({
    workflows: source.workflows,
    providers: source.providers,
    theme: source.theme,
    fixtures: source.fixtures,
    acceptance: source.acceptance,
  })) {
    if (folderValue !== undefined && !isRecord(folderValue)) {
      errors.push({ path: `/${folderName}`, message: `${folderName} must be an object map` });
    }
  }

  for (const [id, acceptance] of Object.entries(source.acceptance ?? {})) {
    if (!isAcceptableAcceptanceEntry(id, acceptance)) {
      errors.push({ path: `/acceptance/${id}`, message: 'acceptance entry must be a string or object with id' });
    }
  }

  return errors;
}

export function collectPackageIssues(packageDraft: AppPackage): PackageCompilerIssue[] {
  const issues = collectAppPackageValidationIssues(packageDraft).map<PackageCompilerIssue>((issue: PackageValidationIssue) => ({
    path: `/${issue.category}`,
    message: issue.message,
  }));

  if (packageDraft.presentation?.ui?.screens) {
    for (const [screenId, screen] of Object.entries(packageDraft.presentation.ui.screens)) {
      if (!Array.isArray(screen.components)) continue;
      for (const [index, component] of screen.components.entries()) {
        issues.push(...collectUiComponentIssues([component], `/presentation/ui/screens/${screenId}/components/${index}`, new Set(Object.keys(packageDraft.collections)), new Set(Object.keys(packageDraft.presentation?.ui?.screens ?? {}))));
      }
    }
  }

  return issues;
}

export function normalizeSourceFolder(source: AppPackageSourceFolder): NormalizedAppPackageSource {
  const collections = normalizeNamedMap(source.collections ?? {}, normalizeCollectionSource);
  const queries = normalizeNamedMap(source.queries ?? {}, normalizeQuerySource);
  const screens = normalizeNamedMap(source.screens ?? {}, normalizeScreenSource);
  const rules = normalizeNamedMap(source.rules ?? {}, normalizeRuleSource);
  const themes = normalizeUnknownMap(source.theme ?? {});
  const providers = normalizeUnknownMap(source.providers ?? {});
  const fixtures = normalizeUnknownMap(source.fixtures ?? {});
  const workflows = normalizeUnknownMap(source.workflows ?? {});
  const acceptance = normalizeAcceptanceEntries(source.acceptance ?? {});
  const capabilities = normalizeCapabilities(source.capabilities ?? {});

  return {
    app: source.app,
    collections,
    queries,
    screens,
    rules,
    workflows,
    providers,
    theme: themes,
    fixtures,
    acceptance,
    capabilities,
  };
}

export type NormalizedAppPackageSource = Readonly<{
  app: AppPackageSourceApp;
  collections: Record<string, AppPackageSourceCollection & { id: string }>;
  queries: Record<string, AppPackageSourceQuery & { id: string }>;
  screens: Record<string, AppPackageSourceScreen & { id: string }>;
  rules: Record<string, AppPackageSourceRule & { id: string }>;
  workflows: Record<string, unknown>;
  providers: Record<string, unknown>;
  theme: Record<string, unknown>;
  fixtures: Record<string, unknown>;
  acceptance: Record<string, string>;
  capabilities: {
    package: string[];
    dependencyPins: AppPackageDependencyPin[];
    native?: AppPackageNativeCapability;
    pinnedAt?: string;
  };
}>;

type NormalizedCapabilities = NormalizedAppPackageSource['capabilities'];

function buildCompiledPackage(source: NormalizedAppPackageSource): AppPackage {
  const collectionEntries = Object.entries(source.collections).map(([id, collection]) => [id, {
    id,
    fields: normalizeFieldMap(collection.fields),
  } satisfies CollectionSpec]);
  const collections = Object.fromEntries(collectionEntries);

  const queryEntries = Object.entries(source.queries).map(([id, query]) => [id, {
    from: query.from,
    ...(query.where !== undefined ? { where: sortObjectDeep(query.where) as never } : {}),
    ...(query.orderBy !== undefined ? { orderBy: sortObjectDeep(query.orderBy) as never } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  }]);
  const queries = Object.fromEntries(queryEntries);

  const screenEntries = Object.entries(source.screens).map(([id, screen]) => [id, {
    id,
    query: screen.query,
    mode: screen.mode,
    fields: [...screen.fields],
    ...(screen.groupBy ? { groupBy: screen.groupBy } : {}),
    ...(screen.layout !== undefined ? { layout: sortObjectDeep(screen.layout) as Record<string, unknown> } : {}),
  }]);
  const views = Object.fromEntries(screenEntries) as Record<string, ViewSpec>;

  const sortedScreens = Object.entries(source.screens).sort(([left], [right]) => left.localeCompare(right));
  const mergedVisualIdentity = mergeRecordObjects(source.theme, source.app.visualIdentity);
  const mergedProviderTemplateFields = mergeRecordObjects(source.providers, source.app.providerTemplateFields);
  const surfaces = sortedScreens.map(([id, screen]) => ({
    id,
    label: screen.label,
    collections: uniqueStrings([...screen.collections]).sort(localeSort),
    views: [id],
    ...(screen.icon ? { icon: screen.icon } : {}),
    ...(screen.imageUrl ? { imageUrl: screen.imageUrl } : {}),
  })) satisfies PackageSurfaceSpec[];

  const uiScreens = Object.fromEntries(sortedScreens.map(([id, screen]) => [
    id,
    {
      title: screen.label,
      ...(screen.subtitle ? { subtitle: screen.subtitle } : {}),
      ...(screen.components ? { components: normalizeComponents(screen.components) } : {}),
    },
  ]));

  const presentation: PackagePresentationSpec = {
    label: source.app.label,
    ...(source.app.homeSurface ? { homeSurface: source.app.homeSurface } : {}),
    surfaces,
    ...(mergedVisualIdentity.size > 0 ? { visualIdentity: mergedVisualIdentity.value } : {}),
    ...(mergedProviderTemplateFields.size > 0 ? { providerTemplateFields: mergedProviderTemplateFields.value } : {}),
    ...(source.app.render ? { render: sortObjectDeep(source.app.render) as Record<string, unknown> } : {}),
    ...(source.app.richDetailSchema ? { richDetailSchema: source.app.richDetailSchema } : {}),
    ...(Object.keys(uiScreens).length > 0 ? {
      ui: {
        schemaVersion: 'a2ui.v0_9',
        defaultScreen: source.app.homeSurface ?? sortedScreens[0]?.[0],
        screens: uiScreens,
      },
    } : {}),
    sourceSchemaVersion: source.app.schemaVersion,
  };

  const rules = Object.entries(source.rules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, rule]) => ({
      id,
      trigger: sortObjectDeep(rule.trigger) as RuleSpec['trigger'],
      ...(rule.when !== undefined ? { when: sortObjectDeep(rule.when) } : {}),
      effect: sortObjectDeep(rule.effect) as RuleSpec['effect'],
      mode: rule.mode,
      maxRunsPerEvent: rule.maxRunsPerEvent,
    }));

  const acceptanceTests = uniqueStrings(Object.values(source.acceptance)).sort(localeSort);
  const capabilities = uniqueStrings(source.capabilities.package ?? []).sort(localeSort);

  const basePackage: AppPackage = {
    schemaVersion: 'wonder.app-package.v2',
    id: source.app.id,
    version: source.app.version,
    collections,
    queries,
    views,
    presentation,
    rules,
    capabilities,
    acceptanceTests,
  };

  if (!source.capabilities.native) {
    return basePackage;
  }

  const dependencyPins = [...source.capabilities.dependencyPins].sort(compareDependencyPins);
  const nativeCapabilities = source.capabilities.native;
  const pinnedAt = source.capabilities.pinnedAt ?? '1970-01-01T00:00:00.000Z';
  const contractLock: AppPackageContractLock = {
    schemaVersion: 'wonder.package-contract-lock.v1',
    algorithm: 'sha256',
    pinnedAt,
    dependencyPins,
    nativeCapabilities,
    checksum: '',
  };
  contractLock.checksum = sha256Canonical({
    schemaVersion: contractLock.schemaVersion,
    algorithm: contractLock.algorithm,
    pinnedAt: contractLock.pinnedAt,
    dependencyPins: contractLock.dependencyPins,
    nativeCapabilities: contractLock.nativeCapabilities,
  });

  return {
    ...basePackage,
    schemaVersion: 'wonder.app-package.v3',
    dependencyPins,
    nativeCapabilities,
    contractLock,
  };
}

function collectUiComponentIssues(
  components: unknown,
  path: string,
  collectionIds: Set<string>,
  screenIds: Set<string>,
): PackageCompilerIssue[] {
  const errors: PackageCompilerIssue[] = [];
  if (!Array.isArray(components)) return errors;

  for (const [index, component] of components.entries()) {
    const componentPath = `${path}/${index}`;
    if (!isRecord(component)) {
      errors.push({ path: componentPath, message: 'component must be an object' });
      continue;
    }
    if (!isText(component.kind) || !APP_PACKAGE_UI_COMPONENT_KIND_SET.has(component.kind)) {
      errors.push({ path: `${componentPath}/kind`, message: 'component.kind is invalid' });
      continue;
    }
    if (component.kind === 'widget') {
      if (!isText(component.widget) || !APP_PACKAGE_WIDGET_KIND_SET.has(component.widget)) {
        errors.push({ path: `${componentPath}/widget`, message: 'component.widget is invalid' });
      }
      if (component.props !== undefined && !isRecord(component.props)) {
        errors.push({ path: `${componentPath}/props`, message: 'component.props must be an object' });
      }
    }
    if (component.kind === 'action') {
      const action = isRecord(component.action) ? component.action : undefined;
      if (!isText(component.id)) {
        errors.push({ path: `${componentPath}/id`, message: 'action component id is required' });
      }
      if (!action || !isText(action.kind) || !APP_PACKAGE_UI_ACTION_KIND_SET.has(action.kind)) {
        errors.push({ path: `${componentPath}/action/kind`, message: 'action.kind is invalid' });
      } else if (action.kind === 'open_url') {
        if (!isText(action.url)) {
          errors.push({ path: `${componentPath}/action/url`, message: 'open_url action requires url' });
        }
      } else if (action.kind === 'propose') {
        if (!isText(action.command) && !isText(action.tool)) {
          errors.push({ path: `${componentPath}/action`, message: 'propose action requires command or tool' });
        }
      }
      if (action?.payload !== undefined && !isRecord(action.payload)) {
        errors.push({ path: `${componentPath}/action/payload`, message: 'action.payload must be an object' });
      }
    }
    if (component.tone !== undefined && (!isText(component.tone) || !APP_PACKAGE_UI_TONE_SET.has(component.tone))) {
      errors.push({ path: `${componentPath}/tone`, message: 'component.tone is invalid' });
    }
    if (component.view !== undefined && isText(component.view) && !screenIds.has(component.view)) {
      errors.push({ path: `${componentPath}/view`, message: `component references missing view ${component.view}` });
    }
    if (component.query !== undefined) {
      if (!isRecord(component.query)) {
        errors.push({ path: `${componentPath}/query`, message: 'component.query must be an object' });
      } else if (Array.isArray(component.query.collections)) {
        for (const [collectionIndex, collectionId] of component.query.collections.entries()) {
          if (!isText(collectionId) || !collectionIds.has(collectionId)) {
            errors.push({
              path: `${componentPath}/query/collections/${collectionIndex}`,
              message: `component query references missing collection ${String(collectionId)}`,
            });
          }
        }
      }
    }
  }

  return errors;
}

function normalizeComponents(components: A2UiComponent[]): A2UiComponent[] {
  return components.map((component) => sortObjectDeep(component) as A2UiComponent);
}

function normalizeSourceEntry<T extends { id?: string }>(id: string, value: T): T & { id: string } {
  const resolvedId = isText(value.id) ? value.id : id;
  if (value.id !== undefined && value.id !== id) {
    throw new Error(`source id mismatch at ${id}`);
  }
  return {
    ...value,
    id: resolvedId,
  };
}

function normalizeNamedMap<T extends { id?: string }>(
  input: Record<string, T>,
  normalizeValue: (id: string, value: T) => T & { id: string },
): Record<string, T & { id: string }> {
  const entries = Object.entries(input).sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries.map(([id, value]) => [id, normalizeValue(id, value)]));
}

function normalizeUnknownMap(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => [id, sortObjectDeep(value)]),
  );
}

function normalizeCollectionSource(id: string, value: AppPackageSourceCollection): AppPackageSourceCollection & { id: string } {
  return {
    ...normalizeSourceEntry(id, value),
    fields: normalizeFieldMap(value.fields),
  };
}

function normalizeQuerySource(id: string, value: AppPackageSourceQuery): AppPackageSourceQuery & { id: string } {
  return {
    ...normalizeSourceEntry(id, value),
    ...(value.where !== undefined ? { where: sortObjectDeep(value.where) as never } : {}),
    ...(value.orderBy !== undefined ? { orderBy: sortObjectDeep(value.orderBy) as never } : {}),
  };
}

function normalizeScreenSource(id: string, value: AppPackageSourceScreen): AppPackageSourceScreen & { id: string } {
  return {
    ...normalizeSourceEntry(id, value),
    collections: uniqueStrings(value.collections).sort(localeSort),
    fields: [...value.fields],
    ...(value.components ? { components: normalizeComponents(value.components) } : {}),
  };
}

function normalizeRuleSource(id: string, value: AppPackageSourceRule): AppPackageSourceRule & { id: string } {
  return {
    ...normalizeSourceEntry(id, value),
    trigger: sortObjectDeep(value.trigger) as RuleSpec['trigger'],
    ...(value.when !== undefined ? { when: sortObjectDeep(value.when) } : {}),
    effect: sortObjectDeep(value.effect) as RuleSpec['effect'],
  };
}

function normalizeFieldMap(fields: CollectionSpec['fields']): CollectionSpec['fields'] {
  return Object.fromEntries(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => [id, sortObjectDeep(value) as CollectionSpec['fields'][string]]));
}

function normalizeCapabilities(capabilities: AppPackageSourceCapabilities): NormalizedCapabilities {
  return {
    package: uniqueStrings(capabilities.package ?? []).sort(localeSort),
    dependencyPins: [...(capabilities.dependencyPins ?? [])].sort(compareDependencyPins),
    ...(capabilities.native ? { native: normalizeNativeCapability(capabilities.native) } : {}),
    ...(capabilities.pinnedAt ? { pinnedAt: capabilities.pinnedAt } : {}),
  };
}

function normalizeNativeCapability(capability: AppPackageNativeCapability): AppPackageNativeCapability {
  return {
    ...capability,
    packages: uniqueStrings(capability.packages).sort(localeSort),
    ...(capability.permissions
      ? { permissions: [...capability.permissions].map((permission) => sortObjectDeep(permission) as unknown).sort(comparePermissions) as NonNullable<AppPackageNativeCapability['permissions']> }
      : {}),
    ...(capability.intents
      ? { intents: [...capability.intents].map((intent) => sortObjectDeep(intent) as unknown).sort(compareIntents) as NonNullable<AppPackageNativeCapability['intents']> }
      : {}),
  };
}

function normalizeAcceptanceEntries(entries: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => [id, normalizeAcceptanceId(id, value)]),
  );
}

function normalizeAcceptanceId(id: string, value: unknown): string {
  if (typeof value === 'string') {
    return value.trim() || id;
  }
  if (isRecord(value) && isText(value.id)) {
    return value.id;
  }
  return id;
}

function readCapabilitiesFolder(folderPath: string): AppPackageSourceCapabilities | undefined {
  if (!existsSync(folderPath)) return undefined;
  const packageList = readJsonIfExists(join(folderPath, 'package.json')) ?? readJsonIfExists(join(folderPath, 'packages.json'));
  const dependencyPins = readJsonIfExists(join(folderPath, 'dependency-pins.json'));
  const native = readJsonIfExists(join(folderPath, 'native.json'));
  const pinnedAt = readJsonIfExists(join(folderPath, 'pinned-at.json'));

  const capabilities: AppPackageSourceCapabilities = {};
  if (Array.isArray(packageList)) capabilities.package = packageList.filter(isText);
  if (Array.isArray(dependencyPins)) capabilities.dependencyPins = dependencyPins as AppPackageDependencyPin[];
  if (isNativeCapability(native)) capabilities.native = native;
  if (isText(pinnedAt)) capabilities.pinnedAt = pinnedAt;
  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

function readJsonMap(folderPath: string): Record<string, unknown> | undefined {
  if (!existsSync(folderPath)) return undefined;
  const entries = readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort(localeSort);
  return Object.fromEntries(
    entries.map((name) => [name.replace(/\.json$/, ''), readJsonFile(join(folderPath, name))]),
  );
}

function readJsonIfExists(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  return readJsonFile(filePath);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDependencyPin(value: unknown): value is AppPackageDependencyPin {
  return isRecord(value) && isText(value.package) && isText(value.version);
}

function isNativeCapability(value: unknown): value is AppPackageNativeCapability {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 'wonder.app-package-native-capabilities.v1') return false;
  if (!isText(value.platform) || !['expo', 'android', 'ios', 'web'].includes(value.platform)) return false;
  if (!Array.isArray(value.packages) || !value.packages.every(isText)) return false;
  if (value.permissions !== undefined && !Array.isArray(value.permissions)) return false;
  if (Array.isArray(value.permissions) && !value.permissions.every(isNativePermission)) return false;
  if (value.intents !== undefined && !Array.isArray(value.intents)) return false;
  if (Array.isArray(value.intents) && !value.intents.every(isNativeIntent)) return false;
  return true;
}

function isNativePermission(value: unknown): boolean {
  if (typeof value === 'string') return isText(value);
  if (!isRecord(value)) return false;
  return isText(value.id)
    && isText(value.platform)
    && ['expo', 'android', 'ios', 'web'].includes(value.platform)
    && isText(value.permission)
    && isText(value.reason)
    && (value.required === undefined || typeof value.required === 'boolean')
    && (value.prompt === undefined || isText(value.prompt));
}

function isNativeIntent(value: unknown): boolean {
  return isRecord(value)
    && isText(value.id)
    && isText(value.platform)
    && ['expo', 'android', 'ios', 'web'].includes(value.platform)
    && isAppPackageNativeIntentKind(value.kind)
    && isText(value.reason)
    && (value.required === undefined || typeof value.required === 'boolean')
    && (value.payload === undefined || isRecord(value.payload));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(isText))];
}

function compareDependencyPins(left: AppPackageDependencyPin, right: AppPackageDependencyPin): number {
  const byPackage = left.package.localeCompare(right.package);
  if (byPackage !== 0) return byPackage;
  return left.version.localeCompare(right.version);
}

function comparePermissions(left: unknown, right: unknown): number {
  return normalizePermissionLabel(left).localeCompare(normalizePermissionLabel(right));
}

function normalizePermissionLabel(permission: unknown): string {
  if (typeof permission === 'string') return permission;
  if (isRecord(permission) && isText(permission.platform) && isText(permission.permission)) {
    return `${permission.platform}:${permission.permission}`;
  }
  return canonicalJson(permission);
}

function compareIntents(left: unknown, right: unknown): number {
  return normalizeIntentLabel(left).localeCompare(normalizeIntentLabel(right));
}

function normalizeIntentLabel(intent: unknown): string {
  if (isRecord(intent) && isText(intent.platform) && isText(intent.kind) && isText(intent.id)) {
    return `${intent.platform}:${intent.kind}:${intent.id}`;
  }
  return canonicalJson(intent);
}

function localeSort(left: string, right: string): number {
  return left.localeCompare(right);
}

function countCapabilities(capabilities: AppPackageSourceCapabilities | undefined): number {
  if (!capabilities) return 0;
  return [
    capabilities.package?.length ?? 0,
    capabilities.dependencyPins?.length ?? 0,
    capabilities.native ? 1 : 0,
    capabilities.pinnedAt ? 1 : 0,
  ].reduce((total, value) => total + value, 0);
}

function sortObjectDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectDeep(item)) as T;
  }
  if (!isRecord(value)) return value;
  const entries = Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortObjectDeep(child)] as const);
  return Object.fromEntries(entries) as T;
}

function mergeRecordObjects(primary: Record<string, unknown>, secondary?: Record<string, unknown>): { size: number; value: Record<string, unknown> } {
  const merged = {
    ...(secondary ? sortObjectDeep(secondary) as Record<string, unknown> : {}),
    ...(Object.keys(primary).length > 0 ? sortObjectDeep(primary) as Record<string, unknown> : {}),
  };
  return { size: Object.keys(merged).length, value: merged };
}

function diffValues(path: string, before: unknown, after: unknown, diffs: PackageSemanticDiff[]): void {
  if (canonicalJson(before) === canonicalJson(after)) return;

  if (isRecord(before) && isRecord(after)) {
    const keys = uniqueStrings([...Object.keys(before), ...Object.keys(after)]).sort(localeSort);
    for (const key of keys) {
      const nextPath = `${path}/${key}`;
      if (!Object.hasOwn(before, key)) {
        diffs.push({ path: nextPath, kind: 'added', after: after[key], summary: summarizeDiff('added', nextPath) });
      } else if (!Object.hasOwn(after, key)) {
        diffs.push({ path: nextPath, kind: 'removed', before: before[key], summary: summarizeDiff('removed', nextPath) });
      } else {
        diffValues(nextPath, before[key], after[key], diffs);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const nextPath = `${path}/${index}`;
      if (index >= before.length) {
        diffs.push({ path: nextPath, kind: 'added', after: after[index], summary: summarizeDiff('added', nextPath) });
      } else if (index >= after.length) {
        diffs.push({ path: nextPath, kind: 'removed', before: before[index], summary: summarizeDiff('removed', nextPath) });
      } else {
        diffValues(nextPath, before[index], after[index], diffs);
      }
    }
    return;
  }

  diffs.push({
    path,
    kind: 'changed',
    before,
    after,
    summary: summarizeDiff('changed', path),
  });
}

function summarizeDiff(kind: PackageSemanticDiff['kind'], path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return kind;
  if (parts[0] === 'collections' && parts.length >= 2) {
    return `${kind} collection ${parts[1]}${parts[2] === 'fields' && parts[3] ? ` field ${parts[3]}` : ''}`;
  }
  if (parts[0] === 'queries' && parts.length >= 2) {
    return `${kind} query ${parts[1]}`;
  }
  if (parts[0] === 'views' && parts.length >= 2) {
    return `${kind} view ${parts[1]}`;
  }
  if (parts[0] === 'presentation' && parts[1] === 'surfaces' && parts[3]) {
    return `${kind} surface ${parts[2]} ${parts[3]}`;
  }
  if (parts[0] === 'presentation' && parts[1] === 'ui' && parts[2] === 'screens' && parts[3]) {
    return `${kind} screen ${parts[3]}`;
  }
  if (parts[0] === 'rules' && parts[1]) {
    return `${kind} rule ${parts[1]}`;
  }
  if (parts[0] === 'capabilities') {
    return `${kind} capabilities ${parts.slice(1).join('.')}`;
  }
  return `${kind} ${parts.join('.')}`;
}

function isAcceptableAcceptanceEntry(id: string, value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!isRecord(value)) return false;
  return value.id === undefined || value.id === id;
}
