import type { QueryPredicate, QuerySort } from './query';
import type { AppPackageUiActionKind, AppPackageUiComponentKind, AppPackageUiTone } from './ui-primitives';
import type { AppPackageWidgetKind } from './ui-widgets';
import type { AppPackageNativeIntentKind } from './native-capability-kinds';

import { canonicalJson, sha256Canonical } from './canonical-json';
import { isAppPackageNativeIntentKind } from './native-capability-kinds';
import { nativeCapabilitySupportErrors } from './native-capabilities';

export type FieldType = 'text' | 'number' | 'boolean' | 'timestamp' | 'json';

export type ComputedFieldSpec = {
  id: string;
  collection: string | '*';
  dependsOn: string[];
  expression: unknown;
};

export type CollectionSpec = {
  id: string;
  fields: Record<string, { type: FieldType; required?: boolean; indexed?: boolean }>;
};

export type ViewSpec = {
  id: string;
  query: string;
  mode: 'list' | 'board' | 'table' | 'calendar' | 'timeline' | 'chart';
  fields: string[];
  groupBy?: string;
  layout?: Record<string, unknown>;
};

export type PackageSurfaceSpec = {
  id: string;
  label: string;
  icon?: string;
  imageUrl?: string;
  views?: string[];
  collections: string[];
};

export type A2UiAction = {
  kind: AppPackageUiActionKind;
  label?: string;
  url?: string;
  command?: string;
  tool?: string;
  payload?: Record<string, unknown>;
};

export type A2UiComponent = {
  kind: AppPackageUiComponentKind;
  id?: string;
  placement?: 'inline' | 'top' | 'fab';
  title?: string;
  subtitle?: string;
  widget?: AppPackageWidgetKind;
  props?: Record<string, unknown>;
  view?: string;
  tone?: AppPackageUiTone;
  query?: {
    collections?: string[];
    match?: string;
    limit?: number;
  };
  action?: A2UiAction;
};

export type A2UiSurface = {
  schemaVersion?: 'a2ui.v0_9';
  openUrlAllowlist?: string[];
  navigation?: {
    items: Array<{
      screen: 'home' | 'overview' | 'chat' | 'sources' | 'settings';
      label: string;
      icon?: 'home' | 'food' | 'sparkles' | 'sync' | 'settings';
    }>;
  };
  components?: A2UiComponent[];
  screens?: Record<string, { title?: string; subtitle?: string; components?: A2UiComponent[] }>;
  defaultScreen?: string;
};

export type PackagePresentationSpec = {
  label: string;
  homeSurface?: string;
  surfaces: PackageSurfaceSpec[];
  visualIdentity?: Record<string, unknown>;
  render?: Record<string, unknown>;
  ui?: A2UiSurface;
  richDetailSchema?: string;
  providerTemplateFields?: Record<string, unknown>;
  sourceSchemaVersion?: string;
};

export type AppPackagePermissionDeclaration = {
  id: string;
  platform: 'expo' | 'android' | 'ios' | 'web';
  permission: string;
  reason: string;
  required?: boolean;
  prompt?: string;
};

export type RuleSpec = {
  id: string;
  trigger: {
    kind: 'operation' | 'schedule' | 'query_transition';
    query?: string;
    transition?: 'enter' | 'leave' | 'change';
  };
  when?: unknown;
  effect: { kind: 'propose_operation'; operation: string | OperationTemplate };
  mode: 'suggest' | 'automatic';
  maxRunsPerEvent: number;
};

export type OperationTemplate = Readonly<
  | { kind: 'custom'; tool: string }
  | { kind: 'create_record'; domain?: string; collection: string; recordId?: string; properties?: Record<string, unknown> }
  | { kind: 'update_record'; domain?: string; collection?: string; recordId: string; expectedRevision?: number; changes: Record<string, unknown> }
  | { kind: 'archive_record'; domain?: string; collection?: string; recordId: string; expectedRevision?: number }
  | { kind: 'restore_record'; domain?: string; collection?: string; recordId: string; expectedRevision?: number }
>;

export type AppPackageV2 = {
  schemaVersion: 'wonder.app-package.v2';
  id: string;
  version: string;
  collections: Record<string, CollectionSpec>;
  queries: Record<string, { from: string; where?: QueryPredicate; orderBy?: QuerySort[]; limit?: number }>;
  views: Record<string, ViewSpec>;
  presentation?: PackagePresentationSpec;
  computedFields?: ComputedFieldSpec[];
  rules: RuleSpec[];
  capabilities: string[];
  acceptanceTests: string[];
};

export type AppPackageDependencyPin = {
  package: string;
  version: string;
  source?: 'npm' | 'maven' | 'gradle' | 'cocoapods' | 'other';
};

export type AppPackageNativeCapability = {
  schemaVersion: 'wonder.app-package-native-capabilities.v1';
  platform: 'expo' | 'android' | 'ios' | 'web';
  packages: string[];
  permissions?: Array<string | AppPackagePermissionDeclaration>;
  intents?: Array<{
    id: string;
    platform: 'expo' | 'android' | 'ios' | 'web';
    kind: AppPackageNativeIntentKind;
    reason: string;
    required?: boolean;
    payload?: Record<string, unknown>;
  }>;
};

export type AppPackageContractLock = {
  schemaVersion: 'wonder.package-contract-lock.v1';
  algorithm: 'sha256';
  checksum: string;
  pinnedAt: string;
  dependencyPins: AppPackageDependencyPin[];
  nativeCapabilities: AppPackageNativeCapability;
};

export type AppPackageV3 = {
  schemaVersion: 'wonder.app-package.v3';
  id: string;
  version: string;
  collections: Record<string, CollectionSpec>;
  queries: Record<string, { from: string; where?: QueryPredicate; orderBy?: QuerySort[]; limit?: number }>;
  views: Record<string, ViewSpec>;
  presentation?: PackagePresentationSpec;
  computedFields?: ComputedFieldSpec[];
  rules: RuleSpec[];
  capabilities: string[];
  acceptanceTests: string[];
  dependencyPins: AppPackageDependencyPin[];
  nativeCapabilities: AppPackageNativeCapability;
  contractLock: AppPackageContractLock;
};

export type AppPackage = AppPackageV2 | AppPackageV3;

export type PackageValidation = { valid: true; package: AppPackage } | { valid: false; errors: string[] };

export const APP_PACKAGE_BASE_REQUIRED_FIELDS = [
  'id',
  'version',
  'collections',
  'queries',
  'views',
  'rules',
  'capabilities',
  'acceptanceTests',
] as const;

export const PACKAGE_VALIDATION_CATEGORIES = {
  packageType: 'package.type',
  schemaVersion: 'schema.version',
  baseId: 'base.id',
  baseVersion: 'base.version',
  baseCollections: 'base.collections',
  baseQueries: 'base.queries',
  baseViews: 'base.views',
  baseRules: 'base.rules',
  baseCapabilities: 'base.capabilities',
  baseAcceptanceTests: 'base.acceptanceTests',
  referenceCollectionId: 'reference.collection.id',
  referenceCollectionFields: 'reference.collection.fields',
  referenceQueryFrom: 'reference.query.from',
  referenceQueryCollection: 'reference.query.collection',
  referenceViewId: 'reference.view.id',
  referenceViewQuery: 'reference.view.query',
  referenceUiCollection: 'reference.ui.collection',
  v3DependencyPins: 'v3.dependencyPins',
  v3NativeCapabilities: 'v3.nativeCapabilities',
  v3NativeCapabilitySupport: 'v3.nativeCapabilities.support',
  v3ContractLock: 'v3.contractLock',
  v3ContractLockDependencyPins: 'v3.contractLock.dependencyPins',
  v3ContractLockNativeCapabilities: 'v3.contractLock.nativeCapabilities',
  v3ContractLockChecksum: 'v3.contractLock.checksum',
} as const;

export type PackageValidationCategory = typeof PACKAGE_VALIDATION_CATEGORIES[keyof typeof PACKAGE_VALIDATION_CATEGORIES];

export type PackageValidationIssue = Readonly<{
  category: PackageValidationCategory;
  message: string;
}>;

export type AppPackageSchemaValidationMode = AppPackage['schemaVersion'] | 'either';

export function collectAppPackageValidationIssues(
  input: unknown,
  mode: AppPackageSchemaValidationMode = 'either',
): PackageValidationIssue[] {
  if (!isRecord(input)) {
    return [{ category: PACKAGE_VALIDATION_CATEGORIES.packageType, message: 'package must be an object' }];
  }

  const errors: PackageValidationIssue[] = [];
  const value = input as Partial<AppPackage>;
  const schemaVersion = value.schemaVersion;
  if (!schemaVersionMatches(schemaVersion, mode)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.schemaVersion,
      message: schemaVersionErrorMessage(mode),
    });
  }

  if (!isNonEmptyString(value.id)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseId, message: 'id is required' });
  }
  if (!isNonEmptyString(value.version)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseVersion, message: 'version is required' });
  }
  if (!isRecord(value.collections)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseCollections, message: 'collections are required' });
  }
  if (!isRecord(value.queries)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseQueries, message: 'queries are required' });
  }
  if (!isRecord(value.views)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseViews, message: 'views are required' });
  }
  if (!Array.isArray(value.rules)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseRules, message: 'rules must be an array' });
  }
  if (!Array.isArray(value.capabilities)) {
    errors.push({ category: PACKAGE_VALIDATION_CATEGORIES.baseCapabilities, message: 'capabilities must be an array' });
  }
  if (!Array.isArray(value.acceptanceTests)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.baseAcceptanceTests,
      message: 'acceptanceTests must be an array',
    });
  }

  const collections = isRecord(value.collections) ? value.collections : {};
  const queries = isRecord(value.queries) ? value.queries : {};
  const views = isRecord(value.views) ? value.views : {};

  for (const [id, collection] of Object.entries(collections)) {
    if (!isRecord(collection) || !isNonEmptyString(collection.id) || collection.id !== id) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceCollectionId,
        message: `collection ${id} must have matching id`,
      });
    }
    if (!isRecord(collection) || !isRecord(collection.fields)) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceCollectionFields,
        message: `collection ${id} fields are required`,
      });
    }
  }

  for (const [id, query] of Object.entries(queries)) {
    if (!isRecord(query) || !isNonEmptyString(query.from)) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceQueryFrom,
        message: `query ${id} must declare from`,
      });
      continue;
    }
    if (query.from !== 'records' && !Object.hasOwn(collections, query.from)) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceQueryCollection,
        message: `query ${id} references missing collection ${query.from}`,
      });
    }
  }

  for (const [id, view] of Object.entries(views)) {
    if (!isRecord(view) || !isNonEmptyString(view.id) || view.id !== id) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceViewId,
        message: `view ${id} must have matching id`,
      });
    }
    if (!isRecord(view) || !isNonEmptyString(view.query)) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceViewQuery,
        message: `view ${id} must reference a query`,
      });
      continue;
    }
    if (!Object.hasOwn(queries, view.query)) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.referenceViewQuery,
        message: `view ${id} references missing query ${view.query}`,
      });
    }
  }

  collectPresentationCollectionIssues(value.presentation, collections, errors);

  if (schemaVersion === 'wonder.app-package.v3' || mode === 'wonder.app-package.v3') {
    collectV3Issues(value as Partial<AppPackageV3>, errors);
  }

  return errors;
}

export function collectAppPackageValidationCategories(
  input: unknown,
  mode: AppPackageSchemaValidationMode = 'either',
): PackageValidationCategory[] {
  return [...new Set(collectAppPackageValidationIssues(input, mode).map((issue) => issue.category))];
}

export function formatAppPackageValidationIssues(issues: readonly PackageValidationIssue[]): string[] {
  return issues.map((issue) => issue.message);
}

function schemaVersionMatches(schemaVersion: unknown, mode: AppPackageSchemaValidationMode): boolean {
  if (mode === 'either') {
    return schemaVersion === 'wonder.app-package.v2' || schemaVersion === 'wonder.app-package.v3';
  }
  return schemaVersion === mode;
}

function schemaVersionErrorMessage(mode: AppPackageSchemaValidationMode): string {
  if (mode === 'wonder.app-package.v2') return 'schemaVersion must be wonder.app-package.v2';
  if (mode === 'wonder.app-package.v3') return 'schemaVersion must be wonder.app-package.v3';
  return 'schemaVersion must be wonder.app-package.v2 or wonder.app-package.v3';
}

function collectPresentationCollectionIssues(
  presentation: AppPackage['presentation'] | undefined,
  collections: Record<string, unknown>,
  errors: PackageValidationIssue[],
): void {
  if (!isRecord(presentation)) return;

  const surfaces = Array.isArray(presentation.surfaces) ? presentation.surfaces : [];
  for (const surface of surfaces) {
    if (!isRecord(surface) || !Array.isArray(surface.collections)) continue;
    for (const collection of surface.collections) {
      if (isNonEmptyString(collection) && !Object.hasOwn(collections, collection)) {
        errors.push({
          category: PACKAGE_VALIDATION_CATEGORIES.referenceUiCollection,
          message: `presentation surface ${String(surface.id ?? '<unknown>')} references missing collection ${collection}`,
        });
      }
    }
  }

  const ui = presentation.ui;
  if (!isRecord(ui)) return;
  collectUiComponentCollectionIssues(ui.components, 'presentation ui.components', collections, errors);
  if (!isRecord(ui.screens)) return;
  for (const [screenId, screenValue] of Object.entries(ui.screens)) {
    if (!isRecord(screenValue)) continue;
    collectUiComponentCollectionIssues(
      screenValue.components,
      `presentation ui.screens.${screenId}.components`,
      collections,
      errors,
    );
  }
}

function collectUiComponentCollectionIssues(
  components: unknown,
  path: string,
  collections: Record<string, unknown>,
  errors: PackageValidationIssue[],
): void {
  if (!Array.isArray(components)) return;
  for (const [index, component] of components.entries()) {
    if (!isRecord(component) || !isRecord(component.query) || !Array.isArray(component.query.collections)) continue;
    for (const collection of component.query.collections) {
      if (isNonEmptyString(collection) && !Object.hasOwn(collections, collection)) {
        errors.push({
          category: PACKAGE_VALIDATION_CATEGORIES.referenceUiCollection,
          message: `${path}[${index}].query.collections references missing collection ${collection}`,
        });
      }
    }
  }
}

function collectV3Issues(value: Partial<AppPackageV3>, errors: PackageValidationIssue[]): void {
  if (!Array.isArray(value.dependencyPins)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.v3DependencyPins,
      message: 'dependencyPins must be an array',
    });
  } else {
    for (const pin of value.dependencyPins) {
      if (!isDependencyPin(pin)) {
        errors.push({
          category: PACKAGE_VALIDATION_CATEGORIES.v3DependencyPins,
          message: 'dependencyPins entries must include package and version',
        });
      }
    }
  }

  if (!isNativeCapability(value.nativeCapabilities)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.v3NativeCapabilities,
      message: 'nativeCapabilities is required',
    });
  } else {
    for (const supportError of nativeCapabilitySupportErrors(value.nativeCapabilities)) {
      errors.push({
        category: PACKAGE_VALIDATION_CATEGORIES.v3NativeCapabilitySupport,
        message: supportError,
      });
    }
  }

  if (!isContractLock(value.contractLock)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.v3ContractLock,
      message: 'contractLock is required',
    });
    return;
  }

  if (Array.isArray(value.dependencyPins) && !sameDependencyPins(value.dependencyPins, value.contractLock.dependencyPins)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.v3ContractLockDependencyPins,
      message: 'contractLock.dependencyPins must match dependencyPins',
    });
  }

  if (isNativeCapability(value.nativeCapabilities) && canonicalJson(value.nativeCapabilities) !== canonicalJson(value.contractLock.nativeCapabilities)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.v3ContractLockNativeCapabilities,
      message: 'contractLock.nativeCapabilities must match nativeCapabilities',
    });
  }

  if (value.contractLock.checksum !== expectedContractLockChecksum(value.contractLock)) {
    errors.push({
      category: PACKAGE_VALIDATION_CATEGORIES.v3ContractLockChecksum,
      message: 'contractLock.checksum mismatch',
    });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDependencyPin(value: unknown): value is AppPackageDependencyPin {
  return isRecord(value) && isNonEmptyString(value.package) && isNonEmptyString(value.version);
}

function isNativeCapability(value: unknown): value is AppPackageNativeCapability {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 'wonder.app-package-native-capabilities.v1') return false;
  if (!isNonEmptyString(value.platform) || !['expo', 'android', 'ios', 'web'].includes(value.platform)) return false;
  if (!Array.isArray(value.packages) || !value.packages.every((item) => isNonEmptyString(item))) return false;
  if (value.permissions !== undefined && !isNativePermissions(value.permissions)) return false;
  if (value.intents !== undefined && !isNativeIntents(value.intents)) return false;
  return true;
}

function isNativePermissions(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((permission) => {
    if (typeof permission === 'string') return isNonEmptyString(permission);
    return isRecord(permission)
      && isNonEmptyString(permission.id)
      && isNonEmptyString(permission.platform)
      && ['expo', 'android', 'ios', 'web'].includes(permission.platform)
      && isNonEmptyString(permission.permission)
      && isNonEmptyString(permission.reason)
      && (permission.required === undefined || typeof permission.required === 'boolean')
      && (permission.prompt === undefined || isNonEmptyString(permission.prompt));
  });
}

function isNativeIntents(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((intent) => {
    return isRecord(intent)
      && isNonEmptyString(intent.id)
      && isNonEmptyString(intent.platform)
      && ['expo', 'android', 'ios', 'web'].includes(intent.platform)
      && isAppPackageNativeIntentKind(intent.kind)
      && isNonEmptyString(intent.reason)
      && (intent.required === undefined || typeof intent.required === 'boolean')
      && (intent.payload === undefined || isRecord(intent.payload));
  });
}

function isContractLock(value: unknown): value is AppPackageContractLock {
  return isRecord(value)
    && value.schemaVersion === 'wonder.package-contract-lock.v1'
    && value.algorithm === 'sha256'
    && isNonEmptyString(value.checksum)
    && /^sha256:[a-f0-9]{64}$/.test(value.checksum)
    && isNonEmptyString(value.pinnedAt)
    && !Number.isNaN(Date.parse(value.pinnedAt))
    && Array.isArray(value.dependencyPins)
    && value.dependencyPins.every((pin) => isDependencyPin(pin))
    && isNativeCapability(value.nativeCapabilities);
}

function sameDependencyPins(
  left: readonly AppPackageV3['dependencyPins'][number][],
  right: readonly AppPackageV3['dependencyPins'][number][],
): boolean {
  if (left.length !== right.length) return false;
  const leftLabels = left.map((pin) => `${pin.package}@${pin.version}`).sort();
  const rightLabels = right.map((pin) => `${pin.package}@${pin.version}`).sort();
  return leftLabels.every((label, index) => label === rightLabels[index]);
}

function expectedContractLockChecksum(lock: AppPackageContractLock): string {
  return sha256Canonical({
    schemaVersion: lock.schemaVersion,
    algorithm: lock.algorithm,
    pinnedAt: lock.pinnedAt,
    dependencyPins: lock.dependencyPins,
    nativeCapabilities: lock.nativeCapabilities,
  });
}
