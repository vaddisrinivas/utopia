import type {
  AppPackage,
  AppPackageContractLock,
  AppPackageDependencyPin,
  AppPackageNativeCapability,
  AppPackageV3,
  AppPackageV2,
  CollectionSpec,
  ComputedFieldSpec,
  FieldType,
  OperationTemplate,
  PackagePresentationSpec,
  PackageSurfaceSpec,
  PackageValidation,
  RuleSpec,
  ViewSpec,
} from '@/packages/shared/contracts/package';
import { canonicalArtifactHash, canonicalArtifactJson, validateArtifact } from '@/packages/schemas/src';
import type { QueryPredicate, QuerySort } from '@/packages/shared/contracts/query';
import { nativeCapabilitySupportErrors } from '@/packages/shared/contracts/native-capabilities';
import { isAppPackageNativeIntentKind } from '@/packages/shared/contracts/native-capability-kinds';
import { APP_PACKAGE_UI_ACTION_KIND_SET, APP_PACKAGE_UI_COMPONENT_KIND_SET, APP_PACKAGE_UI_TONE_SET } from '@/packages/shared/contracts/ui-primitives';
import { APP_PACKAGE_WIDGET_KIND_SET } from '@/packages/shared/contracts/ui-widgets';

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function name(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExecutableCode(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExecutableCode);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === 'code' || key === 'javascript' || key === 'script' || hasExecutableCode(child));
}

const UI_ACTION_TOOL_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function isTextArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const out: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!text(item)) throw new Error(`Expected non-empty string at ${path}[${index}]`);
    out.push(item);
  }
  return out;
}

function isUiAction(value: unknown, path: string): { command: string; tool: string } {
  if (!object(value)) throw new Error(`${path} must be an object`);
  const action = value as Record<string, unknown>;
  if (!text(action.kind) || !APP_PACKAGE_UI_ACTION_KIND_SET.has(action.kind)) throw new Error(`${path}.kind must be one of open_url|propose`);
  if (action.kind === 'open_url' && !text(action.url)) throw new Error(`${path}.url required for open_url actions`);
  if (action.kind === 'propose' && !text(action.tool) && !text(action.command)) {
    throw new Error(`${path}.tool or ${path}.command required for propose actions`);
  }
  const command = text(action.command) ? action.command : text(action.tool) ? String(action.tool) : '';
  return {
    command,
    tool: action.kind === 'propose' && text(action.tool) ? String(action.tool) : command,
  };
}

function isUiComponent(value: unknown, path: string, packageCollections: Record<string, unknown>, packageViews: Record<string, unknown>): { hasQuery: boolean } {
  if (!object(value)) throw new Error(`${path} must be an object`);
  const component = value as Record<string, unknown>;
  if (!text(component.kind) || !APP_PACKAGE_UI_COMPONENT_KIND_SET.has(component.kind)) throw new Error(`${path}.kind is invalid`);
  if (component.kind === 'action' && !text(component.id)) throw new Error(`${path}.id required for action components`);
  if (component.kind === 'widget') {
    if (!text(component.widget) || !APP_PACKAGE_WIDGET_KIND_SET.has(component.widget)) throw new Error(`${path}.widget is invalid`);
    if (component.props !== undefined && !object(component.props)) throw new Error(`${path}.props must be an object`);
  }

  if (component.view !== undefined && !text(component.view)) throw new Error(`${path}.view must be text`);
  if (typeof component.view === 'string' && component.view && !Object.hasOwn(packageViews, component.view)) {
    throw new Error(`${path}.view must reference an existing view`);
  }

  if (component.tone !== undefined && !APP_PACKAGE_UI_TONE_SET.has(String(component.tone))) {
    throw new Error(`${path}.tone is invalid`);
  }
  if (component.placement !== undefined && !['inline', 'top', 'fab'].includes(String(component.placement))) {
    throw new Error(`${path}.placement is invalid`);
  }
  if (component.placement !== undefined && component.kind !== 'action') {
    throw new Error(`${path}.placement is only valid for action components`);
  }
  if (component.action !== undefined) {
    const { tool, command } = isUiAction(component.action, `${path}.action`);
    if (command && !UI_ACTION_TOOL_PATTERN.test(command)) {
      throw new Error(`${path}.action.command invalid`);
    }
    if (tool && !UI_ACTION_TOOL_PATTERN.test(tool)) {
      throw new Error(`${path}.action.tool invalid`);
    }
  }

  const query = component.query;
  if (query === undefined) {
    return { hasQuery: false };
  }
  if (!object(query)) throw new Error(`${path}.query must be an object`);
  const rawQuery = query as Record<string, unknown>;
  if (rawQuery.collections !== undefined) {
    const collections = isTextArray(rawQuery.collections, `${path}.query.collections`);
    for (const collection of collections) {
      if (!Object.hasOwn(packageCollections, collection)) throw new Error(`${path}.query.collections references missing collection ${collection}`);
    }
  }
  if (rawQuery.limit !== undefined) {
    if (
      rawQuery.limit === null
      || typeof rawQuery.limit !== 'number'
      || !Number.isInteger(rawQuery.limit)
      || rawQuery.limit < 1
      || rawQuery.limit > 200
    ) {
      throw new Error(`${path}.query.limit must be 1..200`);
    }
  }
  if (rawQuery.match !== undefined && !text(rawQuery.match)) {
    throw new Error(`${path}.query.match must be a non-empty string`);
  }
  if (text(rawQuery.match)) {
    try {
      new RegExp(rawQuery.match);
    } catch {
      throw new Error(`${path}.query.match is invalid regular expression`);
    }
  }
  return { hasQuery: true };
}

export {
  AppPackage,
  AppPackageV3,
  AppPackageV2,
  CollectionSpec,
  ComputedFieldSpec,
  FieldType,
  OperationTemplate,
  PackagePresentationSpec,
  PackageSurfaceSpec,
  PackageValidation,
  RuleSpec,
  ViewSpec,
};
export type { QueryPredicate, QuerySort } from '@/packages/shared/contracts/query';

export function validateAppPackage(input: unknown): PackageValidation {
  const result = validateArtifact({ value: input });
  if (!result.ok) return { valid: false, errors: result.issues.map((issue) => issue.message) };
  const errors: string[] = [];
  const value = result.value as Partial<AppPackage>;
  if (value.presentation !== undefined && !object(value.presentation)) errors.push('presentation must be an object');
  if (value.computedFields !== undefined && !Array.isArray(value.computedFields)) errors.push('computedFields must be an array');

  const presentation = value.presentation as Partial<PackagePresentationSpec> | undefined;
  if (presentation) {
    if (!text(presentation.label)) errors.push('presentation label is required');
    if (!Array.isArray(presentation.surfaces)) errors.push('presentation surfaces must be an array');
    const surfaceIds = new Set<string>();
    for (const surface of presentation.surfaces ?? []) {
      const item = surface as unknown as {
        id?: unknown;
        label?: unknown;
        collections?: unknown;
      };
      if (!text(item?.id)) errors.push('presentation surface id is required');
      else if (surfaceIds.has(item.id)) errors.push(`presentation surface ${item.id} is duplicated`);
      else surfaceIds.add(item.id);
      if (!text(item?.label)) errors.push(`presentation surface ${item?.id ?? '<unknown>'} label is required`);
      if (!Array.isArray(item?.collections)) {
        errors.push(`presentation surface ${item?.id ?? '<unknown>'} collections must be an array`);
      } else {
        for (const collection of item.collections) {
          if (!text(collection)) errors.push(`presentation surface ${item?.id ?? '<unknown>'} collection id is invalid`);
          else if (!value.collections?.[collection]) errors.push(`presentation surface ${item?.id ?? '<unknown>'} references missing collection ${collection}`);
        }
      }
    }
    if (presentation.homeSurface !== undefined && (!text(presentation.homeSurface) || !surfaceIds.has(presentation.homeSurface))) {
      errors.push(`presentation homeSurface references missing surface ${String(presentation.homeSurface)}`);
    }

    const ui = presentation.ui;
    if (ui !== undefined) {
      if (!object(ui)) {
        errors.push('presentation ui must be an object');
      } else {
        if (ui.schemaVersion !== undefined && ui.schemaVersion !== 'a2ui.v0_9') {
          errors.push('presentation ui.schemaVersion must be a2ui.v0_9');
        }
        if (ui.openUrlAllowlist !== undefined && !Array.isArray(ui.openUrlAllowlist)) {
          errors.push('presentation ui.openUrlAllowlist must be an array');
        }
        if (Array.isArray(ui.openUrlAllowlist)) {
          for (const [index, allowlistItem] of ui.openUrlAllowlist.entries()) {
            if (!text(allowlistItem)) errors.push(`presentation ui.openUrlAllowlist[${index}] must be a non-empty string`);
          }
        }
        const screens = ui.screens;
        if (screens !== undefined && !object(screens)) {
          errors.push('presentation ui.screens must be an object');
        }
        const screenIds = new Set<string>();
        if (object(screens)) {
          for (const [screenId, screenValue] of Object.entries(screens)) {
            if (!text(screenId)) {
              errors.push('presentation ui screen id must be non-empty');
              continue;
            }
            if (screenIds.has(screenId)) {
              errors.push(`presentation ui screen ${screenId} is duplicated`);
            } else {
              screenIds.add(screenId);
            }
            if (!object(screenValue)) {
              errors.push(`presentation ui screen ${screenId} must be an object`);
            } else {
              if (screenValue.components !== undefined && !Array.isArray(screenValue.components)) {
                errors.push(`presentation ui screen ${screenId}.components must be an array`);
              }
              if (Array.isArray(screenValue.components)) {
                for (const [index, rawComponent] of screenValue.components.entries()) {
                  try {
                    isUiComponent(rawComponent, `presentation.ui.screens.${screenId}.components[${index}]`, value.collections ?? {}, value.views ?? {});
                  } catch (error) {
                    if (error instanceof Error) {
                      errors.push(error.message);
                    } else {
                      errors.push(`presentation.ui.screens.${screenId}.components[${index}] invalid`);
                    }
                  }
                }
              }
            }
          }
        }
        if (ui.defaultScreen !== undefined && !text(ui.defaultScreen)) {
          errors.push('presentation ui.defaultScreen must be a non-empty string');
        }
        if (ui.defaultScreen !== undefined) {
          if (!object(screens)) {
            errors.push('presentation ui.defaultScreen requires screens');
          } else if (!Object.hasOwn(screens, ui.defaultScreen)) {
            errors.push(`presentation ui.defaultScreen references missing screen ${String(ui.defaultScreen)}`);
          }
        }

        if (ui.components !== undefined && !Array.isArray(ui.components)) {
          errors.push('presentation ui.components must be an array');
        }
        if (Array.isArray(ui.components)) {
          for (const [index, rawComponent] of ui.components.entries()) {
            try {
              isUiComponent(rawComponent, `presentation.ui.components[${index}]`, value.collections ?? {}, value.views ?? {});
            } catch (error) {
              if (error instanceof Error) {
                errors.push(error.message);
              } else {
                errors.push(`presentation.ui.components[${index}] invalid`);
              }
            }
          }
        }

        if (ui.components === undefined && !screens) {
          errors.push('presentation ui requires components or screens');
        }
      }
    }
  }
  for (const rule of value.rules ?? []) {
    if (!identifier(rule?.id)) errors.push('rule id is required');
    if (!rule?.trigger?.kind) errors.push(`rule ${rule?.id ?? '<unknown>'} trigger is required`);
    if (rule?.trigger?.kind === 'query_transition' && (!text(rule.trigger.query) || !value.queries?.[rule.trigger.query])) {
      errors.push(`rule ${rule?.id ?? '<unknown>'} references missing query ${rule?.trigger?.query ?? '<missing>'}`);
    }
    if (!validateOperationTemplate(rule?.effect?.operation, value).valid) {
      errors.push(`rule ${rule?.id ?? '<unknown>'} operation is required`);
    }
    if (!Number.isInteger(rule?.maxRunsPerEvent) || (rule?.maxRunsPerEvent ?? 0) < 1) errors.push(`rule ${rule?.id ?? '<unknown>'} maxRunsPerEvent must be positive`);
    else if ((rule.maxRunsPerEvent ?? 0) > 64) errors.push(`rule ${rule?.id ?? '<unknown>'} maxRunsPerEvent must be <= 64`);
  }
  for (const field of value.computedFields ?? []) {
    const item = field as unknown as ComputedFieldSpec & { id?: unknown; collection?: unknown };
    if (!text(item?.id)) errors.push('computed field id is required');
    if (!text(item?.collection)) errors.push(`computed field ${item?.id ?? '<unknown>'} collection is required`);
    if (!Array.isArray(item?.dependsOn)) errors.push(`computed field ${item?.id ?? '<unknown>'} dependsOn must be an array`);
    if (item?.expression === undefined) errors.push(`computed field ${item?.id ?? '<unknown>'} expression is required`);
  }
  for (const capability of value.capabilities ?? []) {
    if (!name(capability)) errors.push(`capability invalid:${String(capability)}`);
  }
  for (const acceptanceTest of value.acceptanceTests ?? []) {
    if (!name(acceptanceTest)) errors.push(`acceptance test invalid:${String(acceptanceTest)}`);
  }

  return errors.length ? { valid: false, errors } : { valid: true, package: value as AppPackage };
}

export function normalizeOperationTemplate(input: string | OperationTemplate): OperationTemplate {
  return typeof input === 'string' ? { kind: 'custom', tool: input } : input;
}

export function operationTemplateName(input: OperationTemplate): string {
  const template = normalizeOperationTemplate(input);
  return template.kind === 'custom' ? template.tool : template.kind;
}

function validateOperationTemplate(input: unknown, pkg: Partial<AppPackage>): { valid: true } | { valid: false } {
  if (identifier(input)) return { valid: true };
  if (!object(input) || typeof input.kind !== 'string') return { valid: false };
  if (input.kind === 'custom') return identifier(input.tool) ? { valid: true } : { valid: false };
  if (input.domain !== undefined && !text(input.domain)) return { valid: false };
  const expectedRevision = input.expectedRevision;
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || typeof expectedRevision !== 'number' || expectedRevision < 0)) return { valid: false };
  if (input.kind === 'create_record') {
    if (!text(input.collection) || !pkg.collections?.[input.collection]) return { valid: false };
    if (input.recordId !== undefined && !text(input.recordId)) return { valid: false };
    if (input.properties !== undefined && !object(input.properties)) return { valid: false };
    return { valid: true };
  }
  if (input.kind === 'update_record') {
    if (!text(input.recordId) || !object(input.changes)) return { valid: false };
    if (input.collection !== undefined && !text(input.collection)) return { valid: false };
    return { valid: true };
  }
  if (input.kind === 'archive_record' || input.kind === 'restore_record') {
    if (!text(input.recordId)) return { valid: false };
    if (input.collection !== undefined && !text(input.collection)) return { valid: false };
    return { valid: true };
  }
  return { valid: false };
}

function isDependencyPin(value: unknown, index: number, errors: string[], seen?: Set<string>): value is AppPackageDependencyPin {
  if (!object(value)) {
    errors.push(`dependencyPins[${index}] must be an object`);
    return false;
  }
  const raw = value as AppPackageDependencyPin;
  if (!text(raw.package) || !text(raw.version)) {
    errors.push(`dependencyPins[${index}] must include package and version`);
    return false;
  }
  const key = `${raw.package}@${raw.version}`;
  if (seen?.has(key)) {
    errors.push(`dependencyPins[${index}] duplicates ${key}`);
    return false;
  }
  seen?.add(key);
  return true;
}

function isDependencyPinMatch(left: readonly AppPackageDependencyPin[], right: unknown): boolean {
  if (!Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const leftLabels = left
    .map((pin) => `${pin.package}@${pin.version}`)
    .sort();
  const rightLabels = right
    .filter((pin) => isPlainObject(pin) && text(pin.package) && text(pin.version))
    .map((pin) => `${(pin as AppPackageDependencyPin).package}@${(pin as AppPackageDependencyPin).version}`)
    .sort();
  if (leftLabels.length !== rightLabels.length) return false;
  return leftLabels.every((label, index) => label === rightLabels[index]);
}

function isNativeCapability(value: unknown): value is AppPackageNativeCapability {
  if (!object(value)) return false;
  const raw = value as AppPackageNativeCapability;
  if (raw.schemaVersion !== 'wonder.app-package-native-capabilities.v1') return false;
  if (!text(raw.platform)) return false;
  if (!Array.isArray(raw.packages) || raw.packages.length < 1) return false;
  if (!raw.packages.every((item) => text(item))) return false;
  if (raw.permissions !== undefined && !isNativePermissions(raw.permissions)) return false;
  if (raw.intents !== undefined && !isNativeIntents(raw.intents)) return false;
  return true;
}

function isNativePermissions(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((permission) => {
    if (typeof permission === 'string') return text(permission);
    if (!object(permission)) return false;
    return text(permission.id)
      && text(permission.platform)
      && ['expo', 'android', 'ios', 'web'].includes(permission.platform)
      && text(permission.permission)
      && text(permission.reason)
      && (permission.required === undefined || typeof permission.required === 'boolean')
      && (permission.prompt === undefined || text(permission.prompt));
  });
}

function isNativeIntents(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((intent) => {
    if (!object(intent)) return false;
    return text(intent.id)
      && text(intent.platform)
      && ['expo', 'android', 'ios', 'web'].includes(intent.platform)
      && text(intent.kind)
      && isAppPackageNativeIntentKind(intent.kind)
      && text(intent.reason)
      && (intent.required === undefined || typeof intent.required === 'boolean')
      && (intent.payload === undefined || isPlainObject(intent.payload));
  });
}

function isNativeCapabilityMatch(left: AppPackageNativeCapability, right: AppPackageNativeCapability): boolean {
  if (left.schemaVersion !== right.schemaVersion || left.platform !== right.platform) return false;
  const leftPackages = [...left.packages].sort();
  const rightPackages = [...right.packages].sort();
  if (leftPackages.length !== rightPackages.length) return false;
  if (!leftPackages.every((item, index) => item === rightPackages[index])) return false;
  return stableJson(left.permissions ?? []) === stableJson(right.permissions ?? [])
    && stableJson(left.intents ?? []) === stableJson(right.intents ?? []);
}

function isContractLock(value: unknown): value is AppPackageContractLock {
  if (!object(value)) return false;
  const lock = value as AppPackageContractLock;
  return text(lock.schemaVersion) && text(lock.algorithm) && text(lock.checksum) && text(lock.pinnedAt)
    && Array.isArray(lock.dependencyPins)
    && lock.nativeCapabilities !== undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return object(value) && !Array.isArray(value);
}

function expectedContractLockChecksum(lock: AppPackageContractLock): string {
  return canonicalArtifactHash({
    schemaVersion: lock.schemaVersion,
    algorithm: lock.algorithm,
    pinnedAt: lock.pinnedAt,
    dependencyPins: lock.dependencyPins,
    nativeCapabilities: lock.nativeCapabilities,
  });
}

function stableJson(value: unknown): string {
  return canonicalArtifactJson(value);
}
