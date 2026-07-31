import type { ErrorObject, ValidateFunction } from 'ajv';

import {
  collectAppPackageValidationIssues,
  type AppPackage,
  type AppPackageSchemaValidationMode,
  type PackageValidationCategory,
} from '@/packages/shared/contracts/package';
import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { getSchemaValidator } from '@/packages/shared/contracts/schema/ajv-authority';
import { getAppPackageSchemaEntry, type AppPackageSchemaRegistryEntry } from './package-registry';


export type ArtifactValidationCategory = 'structural' | 'reference' | 'compatibility' | 'capability' | 'checksum' | 'policy';

export type ArtifactValidationIssue = Readonly<{
  code: string;
  category: ArtifactValidationCategory;
  path: string;
  message: string;
}>;

export type ValidateArtifactInput = Readonly<{
  schemaId?: string;
  value: unknown;
}>;

export type ValidateArtifactResult<T> =
  | Readonly<{ ok: true; schema: AppPackageSchemaRegistryEntry; value: T }>
  | Readonly<{ ok: false; schema: AppPackageSchemaRegistryEntry | null; issues: ArtifactValidationIssue[] }>;

export function validateArtifact(input: ValidateArtifactInput): ValidateArtifactResult<AppPackage> {
  const schema = resolveSchemaEntry(input);
  if (!schema) {
    return {
      ok: false,
      schema: null,
      issues: [{
        code: 'schema.version.unsupported',
        category: 'compatibility',
        path: '/schemaVersion',
        message: 'schemaVersion must be wonder.app-package.v2 or wonder.app-package.v3',
      }],
    };
  }

  const issues = dedupeIssues([
    ...collectStructuralIssues(schema, input.value),
    ...collectSemanticIssues(input.value, schema.schemaVersion),
    ...collectPolicyIssues(input.value),
  ]);
  if (issues.length > 0) return { ok: false, schema, issues };
  return { ok: true, schema, value: input.value as AppPackage };
}

export function collectArtifactCategories(input: ValidateArtifactInput): ArtifactValidationCategory[] {
  const result = validateArtifact(input);
  if (result.ok) return [];
  return [...new Set(result.issues.map((issue) => issue.category))];
}

export function collectArtifactValidationCategories(input: ValidateArtifactInput): ReadonlyArray<PackageValidationCategory> {
  const result = validateArtifact(input);
  if (result.ok) return [];
  return [...new Set(result.issues.map((issue) => semanticCategoryFromCode(issue.code)).filter(Boolean))] as PackageValidationCategory[];
}

export function canonicalArtifactHash(value: unknown): string {
  return sha256Canonical(value);
}

export function canonicalArtifactJson(value: unknown): string {
  return canonicalJson(value);
}

function resolveSchemaEntry(input: ValidateArtifactInput): AppPackageSchemaRegistryEntry | null {
  if (input.schemaId) return getAppPackageSchemaEntry({ schemaId: input.schemaId });
  if (isRecord(input.value) && typeof input.value.schemaVersion === 'string') {
    return getAppPackageSchemaEntry({ schemaVersion: input.value.schemaVersion });
  }
  return null;
}

function collectStructuralIssues(schema: AppPackageSchemaRegistryEntry, value: unknown): ArtifactValidationIssue[] {
  const validate = getValidator(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map(mapAjvError);
}

function collectSemanticIssues(value: unknown, mode: AppPackageSchemaValidationMode): ArtifactValidationIssue[] {
  return collectAppPackageValidationIssues(value, mode).map((issue) => ({
    code: semanticCodeMap[issue.category] ?? 'semantic.unknown',
    category: semanticCategoryMap[issue.category] ?? 'compatibility',
    path: semanticPathMap[issue.category] ?? '/',
    message: issue.message,
  }));
}

function collectPolicyIssues(value: unknown): ArtifactValidationIssue[] {
  if (!hasExecutableCode(value)) return [];
  return [{
    code: 'policy.executableCode',
    category: 'policy',
    path: '/',
    message: 'executable package code is forbidden',
  }];
}

function mapAjvError(error: ErrorObject): ArtifactValidationIssue {
  const path = error.instancePath || '/';
  switch (error.keyword) {
    case 'required':
      return { code: 'schema.required', category: 'structural', path, message: `${path} missing required property ${String(error.params.missingProperty)}` };
    case 'additionalProperties':
      return { code: 'schema.additionalProperties', category: 'structural', path, message: `${path} has unknown property ${String(error.params.additionalProperty)}` };
    case 'type':
      return { code: 'schema.type', category: 'structural', path, message: `${path} must be ${String(error.params.type)}` };
    case 'enum':
      return { code: 'schema.enum', category: 'structural', path, message: `${path} must be one of the allowed values` };
    case 'const':
      return { code: 'schema.const', category: 'compatibility', path, message: `${path} must match the required constant` };
    default:
      return { code: `schema.${error.keyword}`, category: 'structural', path, message: `${path} ${error.message ?? 'is invalid'}` };
  }
}

function getValidator(schema: AppPackageSchemaRegistryEntry): ValidateFunction<AppPackage> {
  return getSchemaValidator(schema.schema) as ValidateFunction<AppPackage>;
}

function hasExecutableCode(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasExecutableCode);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === 'code' || key === 'javascript' || key === 'script' || hasExecutableCode(child));
}

function dedupeIssues(issues: readonly ArtifactValidationIssue[]): ArtifactValidationIssue[] {
  const seen = new Set<string>();
  const unique: ArtifactValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}|${issue.category}|${issue.path}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const semanticCodeMap: Partial<Record<PackageValidationCategory, string>> = {
  'package.type': 'package.type',
  'schema.version': 'schema.version.unsupported',
  'base.id': 'package.id.required',
  'base.version': 'package.version.required',
  'base.collections': 'package.collections.required',
  'base.queries': 'package.queries.required',
  'base.views': 'package.views.required',
  'base.rules': 'package.rules.required',
  'base.capabilities': 'package.capabilities.required',
  'base.acceptanceTests': 'package.acceptanceTests.required',
  'reference.collection.id': 'reference.collection.id',
  'reference.collection.fields': 'reference.collection.fields',
  'reference.query.from': 'reference.query.from',
  'reference.query.collection': 'reference.query.collection',
  'reference.view.id': 'reference.view.id',
  'reference.view.query': 'reference.view.query',
  'reference.ui.collection': 'reference.ui.collection',
  'v3.dependencyPins': 'compatibility.dependencyPins',
  'v3.nativeCapabilities': 'compatibility.nativeCapabilities',
  'v3.nativeCapabilities.support': 'capability.nativeCapabilities.support',
  'v3.contractLock': 'compatibility.contractLock',
  'v3.contractLock.dependencyPins': 'compatibility.contractLock.dependencyPins',
  'v3.contractLock.nativeCapabilities': 'compatibility.contractLock.nativeCapabilities',
  'v3.contractLock.checksum': 'checksum.contractLock',
};

const semanticCategoryMap: Partial<Record<PackageValidationCategory, ArtifactValidationCategory>> = {
  'package.type': 'structural',
  'schema.version': 'compatibility',
  'base.id': 'structural',
  'base.version': 'structural',
  'base.collections': 'structural',
  'base.queries': 'structural',
  'base.views': 'structural',
  'base.rules': 'structural',
  'base.capabilities': 'structural',
  'base.acceptanceTests': 'structural',
  'reference.collection.id': 'reference',
  'reference.collection.fields': 'reference',
  'reference.query.from': 'reference',
  'reference.query.collection': 'reference',
  'reference.view.id': 'reference',
  'reference.view.query': 'reference',
  'reference.ui.collection': 'reference',
  'v3.dependencyPins': 'compatibility',
  'v3.nativeCapabilities': 'compatibility',
  'v3.nativeCapabilities.support': 'capability',
  'v3.contractLock': 'compatibility',
  'v3.contractLock.dependencyPins': 'compatibility',
  'v3.contractLock.nativeCapabilities': 'compatibility',
  'v3.contractLock.checksum': 'checksum',
};

const semanticPathMap: Partial<Record<PackageValidationCategory, string>> = {
  'package.type': '/',
  'schema.version': '/schemaVersion',
  'base.id': '/id',
  'base.version': '/version',
  'base.collections': '/collections',
  'base.queries': '/queries',
  'base.views': '/views',
  'base.rules': '/rules',
  'base.capabilities': '/capabilities',
  'base.acceptanceTests': '/acceptanceTests',
  'v3.dependencyPins': '/dependencyPins',
  'v3.nativeCapabilities': '/nativeCapabilities',
  'v3.nativeCapabilities.support': '/nativeCapabilities',
  'v3.contractLock': '/contractLock',
  'v3.contractLock.dependencyPins': '/contractLock/dependencyPins',
  'v3.contractLock.nativeCapabilities': '/contractLock/nativeCapabilities',
  'v3.contractLock.checksum': '/contractLock/checksum',
};

function semanticCategoryFromCode(code: string): PackageValidationCategory | null {
  const entry = Object.entries(semanticCodeMap).find(([, value]) => value === code);
  return (entry?.[0] as PackageValidationCategory | undefined) ?? null;
}
