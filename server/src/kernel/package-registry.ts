import { validateComputedFieldGraph } from './computed-fields';
import { type AppPackage, type PackageValidation, validateAppPackage } from './package';
import { isAllowedAppPackagePatchPath } from '@/packages/shared/contracts/package-change';
import { sha256Canonical } from '@/src/domain/canonical-json';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import jsonPatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import { z } from 'zod';

const PACKAGE_REGISTRY_SCHEMA_VERSION = 'wonder.package-registry.v1' as const;
export const DEFAULT_WORKSPACE_ID = 'default-workspace' as const;
export const DEFAULT_APP_INSTALLATION_ID = 'default' as const;

export type WorkspaceState = Readonly<{
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}>;

export type InstallationPackageState = Readonly<{
  installationId: string;
  activePackageKey: string | null;
  previousPackageKey: string | null;
  updatedAt: string;
}>;

export type AppInstallationState = Readonly<{
  id: string;
  workspaceId: string;
  label: string;
  status: 'active' | 'archived' | 'disabled';
  createdAt: string;
  updatedAt: string;
}>;

export type PackageRegistryReceipt = Readonly<{
  id: string;
  action: 'activate' | 'rollback';
  workspaceId: string;
  installationId: string;
  packageKey: string | null;
  previousPackageKey: string | null;
  createdAt: string;
  requestHash?: string;
  packageHash?: string;
  approvalHash?: string;
  approvedBy?: string;
}>;

export type PackageChangeRequest = Readonly<{
  patch: readonly Operation[];
  basePackageKey?: string | null;
  requestedBy?: string;
}>;

export type PackageChangeApprovalReceipt = Readonly<{
  schemaVersion: 'wonder.package-change-approval.v1';
  approved: true;
  requestHash: string;
  packageHash: string;
  approvedBy: string;
  approvedAt: string;
}>;

export type PackageChangePreview = Readonly<{
  status: 'valid' | 'invalid';
  requestHash: string;
  packageHash: string | null;
  basePackageKey: string | null;
  package: AppPackage | null;
  validation: PackageValidation;
}>;

type PackageRegistryStore = Readonly<{
  schemaVersion: typeof PACKAGE_REGISTRY_SCHEMA_VERSION;
  activeKey: string | null;
  previousKey: string | null;
  workspaces?: Readonly<Record<string, WorkspaceState>>;
  installations?: Readonly<Record<string, AppInstallationState>>;
  packageState?: Readonly<Record<string, InstallationPackageState>>;
  packages: Readonly<Record<string, AppPackage>>;
  receipts: readonly PackageRegistryReceipt[];
}>;

type PackageRegistryOptions = {
  path?: string;
  now?: () => string;
};

const packageRegistryReceiptSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['activate', 'rollback']),
  workspaceId: z.string().min(1).optional(),
  installationId: z.string().min(1).optional(),
  packageKey: z.string().min(1).nullable(),
  previousPackageKey: z.string().min(1).nullable(),
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp'),
  requestHash: z.string().min(1).optional(),
  packageHash: z.string().min(1).optional(),
  approvalHash: z.string().min(1).optional(),
  approvedBy: z.string().min(1).optional(),
}).strict();

const workspaceStateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp'),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp'),
}).strict();

const appInstallationStateSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(['active', 'archived', 'disabled']),
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp'),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp'),
}).strict();

const installationPackageStateSchema = z.object({
  installationId: z.string().min(1),
  activePackageKey: z.string().min(1).nullable(),
  previousPackageKey: z.string().min(1).nullable(),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp'),
}).strict();

const packageRegistryStoreSchema = z.object({
  schemaVersion: z.literal(PACKAGE_REGISTRY_SCHEMA_VERSION),
  activeKey: z.string().min(1).nullable(),
  previousKey: z.string().min(1).nullable(),
  workspaces: z.record(z.string(), workspaceStateSchema).optional(),
  installations: z.record(z.string(), appInstallationStateSchema).optional(),
  packageState: z.record(z.string(), installationPackageStateSchema).optional(),
  packages: z.record(z.string(), z.unknown()),
  receipts: z.array(packageRegistryReceiptSchema),
}).strict();

export class PackageRegistry {
  private active: AppPackage | null = null;
  private previous: AppPackage | null = null;
  private workspaces = new Map<string, WorkspaceState>();
  private installations = new Map<string, AppInstallationState>();
  private packageState = new Map<string, InstallationPackageState>();
  private packages = new Map<string, AppPackage>();
  private receipts: PackageRegistryReceipt[] = [];
  private readonly path?: string;
  private readonly now: () => string;

  constructor(options: PackageRegistryOptions = {}) {
    this.path = options.path;
    this.now = options.now ?? (() => new Date().toISOString());
    if (this.path) {
      this.load(this.path);
    }
  }

  preview(input: unknown): PackageValidation {
    const result = validateAppPackage(input);
    if (!result.valid) return result;
    try {
      validateComputedFieldGraph({
        specs: result.package.computedFields ?? [],
        collections: Object.keys(result.package.collections),
      });
      return result;
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'computed_field_graph_invalid'],
      };
    }
  }

  previewChange(request: PackageChangeRequest): PackageChangePreview {
    const base = this.active;
    if (!base) throw new Error('package_change_no_active_package');
    validatePackageChangeRequest(request, base);
    const requestHash = hashValue(normalizePackageChangeRequest(request));
    const next = applyPackagePatch(base, request.patch);
    const validation = this.preview(next);
    return {
      status: validation.valid ? 'valid' : 'invalid',
      requestHash,
      packageHash: validation.valid ? hashValue(validation.package) : null,
      basePackageKey: packageKey(base),
      package: validation.valid ? validation.package : null,
      validation,
    };
  }

  activateApprovedChange(request: PackageChangeRequest, approval: PackageChangeApprovalReceipt): AppPackage {
    const preview = this.previewChange(request);
    if (preview.status !== 'valid' || !preview.packageHash || !preview.package) {
      const errors = preview.validation.valid ? ['package_change_invalid'] : preview.validation.errors;
      throw new Error(`package_change_invalid:${errors.join('|')}`);
    }
    if (
      approval.schemaVersion !== 'wonder.package-change-approval.v1'
      || approval.approved !== true
      || approval.requestHash !== preview.requestHash
      || approval.packageHash !== preview.packageHash
      || !approval.approvedBy?.trim()
      || Number.isNaN(Date.parse(approval.approvedAt))
    ) {
      throw new Error('package_change_approval_mismatch');
    }
    return this.activateInternal(preview.package, DEFAULT_APP_INSTALLATION_ID, {
      requestHash: preview.requestHash,
      packageHash: preview.packageHash,
      approvalHash: hashValue(approval),
      approvedBy: approval.approvedBy.trim(),
    });
  }

  activate(input: unknown): AppPackage {
    const result = this.preview(input);
    if (!result.valid) throw new Error(`package_invalid:${result.errors.join('|')}`);
    return this.activateInternal(result.package, DEFAULT_APP_INSTALLATION_ID, {});
  }

  activateForInstallation(installationId: string, input: unknown): AppPackage {
    const result = this.preview(input);
    if (!result.valid) throw new Error(`package_invalid:${result.errors.join('|')}`);
    return this.activateInternal(result.package, installationId, {});
  }

  createAppInstallation(input: {
    id?: string;
    workspaceId?: string;
    label?: string;
    package: unknown;
  }): AppInstallationState {
    const result = this.preview(input.package);
    if (!result.valid) throw new Error(`package_invalid:${result.errors.join('|')}`);
    const now = this.now();
    const workspaceId = input.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
    const installationId = input.id?.trim() || `app-installation:${result.package.id}:${Date.now().toString(36)}`;
    if (this.installations.has(installationId)) throw new Error(`app_installation_exists:${installationId}`);
    this.ensureWorkspace(workspaceId, now);
    this.installations.set(installationId, {
      id: installationId,
      workspaceId,
      label: input.label?.trim() || packageLabel(result.package),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    this.activateInternal(result.package, installationId, {});
    const installation = this.installations.get(installationId);
    if (!installation) throw new Error(`app_installation_missing:${installationId}`);
    return installation;
  }

  private activateInternal(
    pkg: AppPackage,
    installationId: string,
    evidence: Pick<PackageRegistryReceipt, 'requestHash' | 'packageHash' | 'approvalHash' | 'approvedBy'>,
  ): AppPackage {
    const now = this.now();
    const workspaceId = this.installations.get(installationId)?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    this.ensureWorkspace(workspaceId, now);
    this.ensureInstallation(installationId, workspaceId, pkg, now);
    const previousState = this.packageState.get(installationId) ?? null;
    const activeKey = packageKey(pkg);
    this.packages.set(activeKey, pkg);
    this.packageState.set(installationId, {
      installationId,
      activePackageKey: activeKey,
      previousPackageKey: previousState?.activePackageKey ?? null,
      updatedAt: now,
    });
    this.refreshDefaultPackagePointers();
    this.receipts.push(this.receipt('activate', activeKey, previousState?.activePackageKey ?? null, evidence, workspaceId, installationId, now));
    this.persist();
    return pkg;
  }

  rollback(): AppPackage | null {
    return this.rollbackInstallation(DEFAULT_APP_INSTALLATION_ID);
  }

  rollbackInstallation(installationId: string): AppPackage | null {
    const state = this.packageState.get(installationId);
    if (!state?.previousPackageKey) return null;
    const active = this.packages.get(state.previousPackageKey);
    if (!active) return null;
    const now = this.now();
    const workspaceId = this.installations.get(installationId)?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    this.packageState.set(installationId, {
      installationId,
      activePackageKey: state.previousPackageKey,
      previousPackageKey: state.activePackageKey,
      updatedAt: now,
    });
    this.refreshDefaultPackagePointers();
    this.receipts.push(this.receipt('rollback', state.previousPackageKey, state.activePackageKey, {}, workspaceId, installationId, now));
    this.persist();
    return active;
  }

  getActive(): AppPackage | null {
    return this.active;
  }

  getActiveForInstallation(installationId: string): AppPackage | null {
    const key = this.packageState.get(installationId)?.activePackageKey;
    return key ? this.packages.get(key) ?? null : null;
  }

  listAppInstallations(workspaceId = DEFAULT_WORKSPACE_ID): AppInstallationState[] {
    return [...this.installations.values()]
      .filter((installation) => installation.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  getAppInstallation(id: string): AppInstallationState | null {
    return this.installations.get(id) ?? null;
  }

  getInstallationPackageState(id: string): InstallationPackageState | null {
    return this.packageState.get(id) ?? null;
  }

  getReceipts(): readonly PackageRegistryReceipt[] {
    return [...this.receipts];
  }

  private load(path: string): void {
    if (!existsSync(path)) return;
    const parsed = parsePackageRegistryStore(readFileSync(path, 'utf8'));
    this.packages = new Map(Object.entries(parsed.packages));
    this.workspaces = new Map(Object.entries(parsed.workspaces ?? {}));
    this.installations = new Map(Object.entries(parsed.installations ?? {}));
    this.packageState = new Map(Object.entries(parsed.packageState ?? {}));
    this.receipts = [...parsed.receipts];
    this.migrateLegacySingleton(parsed.activeKey, parsed.previousKey);
    this.refreshDefaultPackagePointers();
  }

  private persist(): void {
    if (!this.path) return;
    const store: PackageRegistryStore = {
      schemaVersion: PACKAGE_REGISTRY_SCHEMA_VERSION,
      activeKey: this.active ? packageKey(this.active) : null,
      previousKey: this.previous ? packageKey(this.previous) : null,
      workspaces: Object.fromEntries([...this.workspaces.entries()].sort(([left], [right]) => left.localeCompare(right))),
      installations: Object.fromEntries([...this.installations.entries()].sort(([left], [right]) => left.localeCompare(right))),
      packageState: Object.fromEntries([...this.packageState.entries()].sort(([left], [right]) => left.localeCompare(right))),
      packages: Object.fromEntries([...this.packages.entries()].sort(([left], [right]) => left.localeCompare(right))),
      receipts: [...this.receipts],
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
    renameSync(tempPath, this.path);
  }

  private receipt(
    action: PackageRegistryReceipt['action'],
    key: string | null,
    previousKey: string | null,
    evidence: Pick<PackageRegistryReceipt, 'requestHash' | 'packageHash' | 'approvalHash' | 'approvedBy'>,
    workspaceId: string,
    installationId: string,
    now: string,
  ): PackageRegistryReceipt {
    return {
      id: `package:${action}:${key ?? 'none'}:${this.receipts.length + 1}`,
      action,
      workspaceId,
      installationId,
      packageKey: key,
      previousPackageKey: previousKey,
      createdAt: now,
      ...(evidence.requestHash ? { requestHash: evidence.requestHash } : {}),
      ...(evidence.packageHash ? { packageHash: evidence.packageHash } : {}),
      ...(evidence.approvalHash ? { approvalHash: evidence.approvalHash } : {}),
      ...(evidence.approvedBy ? { approvedBy: evidence.approvedBy } : {}),
    };
  }

  private ensureWorkspace(id: string, now: string): WorkspaceState {
    const existing = this.workspaces.get(id);
    if (existing) return existing;
    const workspace = {
      id,
      label: id === DEFAULT_WORKSPACE_ID ? 'Default workspace' : id,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(id, workspace);
    return workspace;
  }

  private ensureInstallation(installationId: string, workspaceId: string, pkg: AppPackage, now: string): AppInstallationState {
    const existing = this.installations.get(installationId);
    if (existing) return existing;
    const installation = {
      id: installationId,
      workspaceId,
      label: installationId === DEFAULT_APP_INSTALLATION_ID ? 'Default app' : packageLabel(pkg),
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    this.installations.set(installationId, installation);
    return installation;
  }

  private migrateLegacySingleton(activeKey: string | null, previousKey: string | null): void {
    if (!activeKey || this.packageState.has(DEFAULT_APP_INSTALLATION_ID)) return;
    const activePackage = this.packages.get(activeKey);
    if (!activePackage) return;
    const now = this.receipts[0]?.createdAt ?? this.now();
    this.ensureWorkspace(DEFAULT_WORKSPACE_ID, now);
    this.ensureInstallation(DEFAULT_APP_INSTALLATION_ID, DEFAULT_WORKSPACE_ID, activePackage, now);
    this.packageState.set(DEFAULT_APP_INSTALLATION_ID, {
      installationId: DEFAULT_APP_INSTALLATION_ID,
      activePackageKey: activeKey,
      previousPackageKey: previousKey,
      updatedAt: now,
    });
    this.receipts = this.receipts.map((receipt) => ({
      ...receipt,
      workspaceId: receipt.workspaceId ?? DEFAULT_WORKSPACE_ID,
      installationId: receipt.installationId ?? DEFAULT_APP_INSTALLATION_ID,
    }));
  }

  private refreshDefaultPackagePointers(): void {
    const state = this.packageState.get(DEFAULT_APP_INSTALLATION_ID);
    this.active = state?.activePackageKey ? this.packages.get(state.activePackageKey) ?? null : null;
    this.previous = state?.previousPackageKey ? this.packages.get(state.previousPackageKey) ?? null : null;
  }
}

function packageKey(pkg: AppPackage): string {
  return `${pkg.id}@${pkg.version}`;
}

function packageLabel(pkg: AppPackage): string {
  return pkg.presentation?.label ?? pkg.id;
}

function normalizePackageChangeRequest(request: PackageChangeRequest): PackageChangeRequest {
  return {
    basePackageKey: request.basePackageKey ?? null,
    requestedBy: request.requestedBy?.trim() || 'package-builder',
    patch: request.patch,
  };
}

function validatePackageChangeRequest(request: PackageChangeRequest, active: AppPackage): void {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('package_change_request_invalid');
  if (request.basePackageKey && request.basePackageKey !== packageKey(active)) throw new Error('package_change_base_mismatch');
  if (!Array.isArray(request.patch) || request.patch.length < 1 || request.patch.length > 64) throw new Error('package_change_patch_invalid');
  for (const operation of request.patch) {
    if (!operation || typeof operation !== 'object' || typeof operation.path !== 'string') throw new Error('package_change_patch_invalid');
    if (!['add', 'replace', 'remove', 'move', 'copy', 'test'].includes(operation.op)) throw new Error('package_change_patch_op_invalid');
    if (!isAllowedAppPackagePatchPath(operation.path)) throw new Error(`package_change_path_forbidden:${operation.path}`);
    if ((operation.op === 'move' || operation.op === 'copy') && (!operation.from || !isAllowedAppPackagePatchPath(operation.from))) {
      throw new Error(`package_change_path_forbidden:${operation.from ?? '<missing>'}`);
    }
  }
}

function applyPackagePatch(base: AppPackage, patch: readonly Operation[]): AppPackage {
  const clone = JSON.parse(JSON.stringify(base)) as AppPackage;
  const result = jsonPatch.applyPatch(clone, [...patch], true, false);
  return result.newDocument as AppPackage;
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}

function parsePackageRegistryStore(serialized: string): PackageRegistryStore {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('package_registry_invalid_json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package_registry_invalid');
  const row = packageRegistryStoreSchema.safeParse(value);
  if (!row.success) throw new Error('package_registry_schema_invalid');
  const packages: Record<string, AppPackage> = {};
  for (const [key, pkg] of Object.entries(row.data.packages)) {
    const validation = validateAppPackage(pkg);
    if (!validation.valid) throw new Error(`package_registry_package_invalid:${key}:${validation.errors.join('|')}`);
    if (packageKey(validation.package) !== key) throw new Error(`package_registry_package_key_mismatch:${key}`);
    packages[key] = validation.package;
  }
  const activeKey = row.data.activeKey;
  const previousKey = row.data.previousKey;
  if (activeKey && !packages[activeKey]) throw new Error(`package_registry_active_missing:${activeKey}`);
  if (previousKey && !packages[previousKey]) throw new Error(`package_registry_previous_missing:${previousKey}`);
  return {
    schemaVersion: PACKAGE_REGISTRY_SCHEMA_VERSION,
    activeKey,
    previousKey,
    workspaces: row.data.workspaces,
    installations: row.data.installations,
    packageState: row.data.packageState,
    packages,
    receipts: row.data.receipts.map((receipt) => ({
      ...receipt,
      workspaceId: receipt.workspaceId ?? DEFAULT_WORKSPACE_ID,
      installationId: receipt.installationId ?? DEFAULT_APP_INSTALLATION_ID,
    })),
  };
}
