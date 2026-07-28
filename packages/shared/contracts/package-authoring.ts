import type { AppPackage } from './package';

export const PACKAGE_AUTHORING_CHANGE_SCHEMA_VERSION = 'utopia.authoring-change.v1' as const;
export const PACKAGE_AUTHORING_EVALUATION_SCHEMA_VERSION = 'utopia.authoring-evaluation.v1' as const;
export const PACKAGE_AUTHORING_APPROVAL_SCHEMA_VERSION = 'utopia.authoring-approval.v1' as const;
export const PACKAGE_AUTHORING_MAX_PATCH_OPERATIONS = 24 as const;
export const PACKAGE_AUTHORING_MAX_PATCH_BYTES = 32768 as const;
export const PACKAGE_AUTHORING_MAX_POINTER_DEPTH = 8 as const;

export type PackageAuthoringPatchOp = 'add' | 'replace' | 'remove' | 'test';

export type PackageAuthoringPatchProposal = Readonly<{
  op: PackageAuthoringPatchOp;
  path: string;
  value?: unknown;
}>;

export type PackageAuthoringBounds = Readonly<{
  maxOperations: number;
  maxBytes: number;
  maxPointerDepth: number;
}>;

export type PackageAuthoringChange = Readonly<{
  schemaVersion: typeof PACKAGE_AUTHORING_CHANGE_SCHEMA_VERSION;
  baseSourceRevision: string;
  intent: string;
  proposedBy: string;
  proposals: PackageAuthoringPatchProposal[];
  bounds: PackageAuthoringBounds;
}>;

export type PackageAuthoringIssue = Readonly<{
  path: string;
  message: string;
}>;

export type PackageAuthoringEvaluation =
  | Readonly<{
      schemaVersion: typeof PACKAGE_AUTHORING_EVALUATION_SCHEMA_VERSION;
      valid: true;
      changeId: string;
      proposedBy: string;
      intent: string;
      baseSourceRevision: string;
      nextSourceRevision: string;
      packageChecksum: string;
      package: AppPackage;
      preview: unknown;
      diff: unknown[];
      requiresApproval: true;
      risk: string[];
    }>
  | Readonly<{
      schemaVersion: typeof PACKAGE_AUTHORING_EVALUATION_SCHEMA_VERSION;
      valid: false;
      changeId?: string;
      proposedBy?: string;
      intent?: string;
      baseSourceRevision?: string;
      errors: PackageAuthoringIssue[];
    }>;

export type PackageAuthoringApprovalReceipt = Readonly<{
  schemaVersion: typeof PACKAGE_AUTHORING_APPROVAL_SCHEMA_VERSION;
  changeId: string;
  approvedBy: string;
  proposedBy: string;
  approvedAt: string;
  baseSourceRevision: string;
  nextSourceRevision: string;
  packageChecksum: string;
  activationAllowed: true;
  rollbackSourceRevision: string;
}>;

export const PACKAGE_AUTHORING_ALLOWED_ROOTS = [
  'app',
  'collections',
  'queries',
  'screens',
  'rules',
  'workflows',
  'providers',
  'capabilities',
  'theme',
  'fixtures',
  'acceptance',
] as const;

const EXECUTABLE_SOURCE_PATTERN = /\.(?:cjs|cts|js|jsx|mjs|mts|sql|ts|tsx)$/i;
const DEFAULT_BOUNDS: PackageAuthoringBounds = {
  maxOperations: PACKAGE_AUTHORING_MAX_PATCH_OPERATIONS,
  maxBytes: PACKAGE_AUTHORING_MAX_PATCH_BYTES,
  maxPointerDepth: PACKAGE_AUTHORING_MAX_POINTER_DEPTH,
};

export function collectPackageAuthoringChangeIssues(change: unknown): PackageAuthoringIssue[] {
  const issues: PackageAuthoringIssue[] = [];
  if (!isRecord(change)) return [{ path: '', message: 'authoring change must be an object' }];
  if (change.schemaVersion !== PACKAGE_AUTHORING_CHANGE_SCHEMA_VERSION) {
    issues.push({ path: '/schemaVersion', message: `schemaVersion must be ${PACKAGE_AUTHORING_CHANGE_SCHEMA_VERSION}` });
  }
  if (!isText(change.baseSourceRevision) || !change.baseSourceRevision.startsWith('sha256:')) {
    issues.push({ path: '/baseSourceRevision', message: 'baseSourceRevision must be a sha256 revision' });
  }
  if (!isText(change.intent)) issues.push({ path: '/intent', message: 'intent is required' });
  if (!isText(change.proposedBy)) issues.push({ path: '/proposedBy', message: 'proposedBy is required' });
  issues.push(...collectBoundsIssues(change.bounds));
  if (!Array.isArray(change.proposals) || change.proposals.length === 0) {
    issues.push({ path: '/proposals', message: 'proposals must be a non-empty array' });
    return issues;
  }
  if (change.proposals.length > DEFAULT_BOUNDS.maxOperations) {
    issues.push({ path: '/proposals', message: `proposal count exceeds ${DEFAULT_BOUNDS.maxOperations}` });
  }
  if (estimateJsonBytes(change.proposals) > DEFAULT_BOUNDS.maxBytes) {
    issues.push({ path: '/proposals', message: `proposal payload exceeds ${DEFAULT_BOUNDS.maxBytes} bytes` });
  }
  const bounds = isPackageAuthoringBounds(change.bounds) ? change.bounds : DEFAULT_BOUNDS;
  for (const [index, patch] of change.proposals.entries()) {
    issues.push(...collectPatchIssues(patch, `/proposals/${index}`, bounds));
  }
  return issues;
}

export function isPackageAuthoringChange(value: unknown): value is PackageAuthoringChange {
  return collectPackageAuthoringChangeIssues(value).length === 0;
}

export function normalizeAuthoringSourcePath(path: string): string[] {
  return path.split('/').filter(Boolean).map(unescapeJsonPointerToken);
}

export function createDefaultPackageAuthoringBounds(): PackageAuthoringBounds {
  return { ...DEFAULT_BOUNDS };
}

function collectBoundsIssues(bounds: unknown): PackageAuthoringIssue[] {
  if (!isRecord(bounds)) return [{ path: '/bounds', message: 'bounds are required' }];
  const issues: PackageAuthoringIssue[] = [];
  if (bounds.maxOperations !== DEFAULT_BOUNDS.maxOperations) {
    issues.push({ path: '/bounds/maxOperations', message: `maxOperations must be ${DEFAULT_BOUNDS.maxOperations}` });
  }
  if (bounds.maxBytes !== DEFAULT_BOUNDS.maxBytes) {
    issues.push({ path: '/bounds/maxBytes', message: `maxBytes must be ${DEFAULT_BOUNDS.maxBytes}` });
  }
  if (bounds.maxPointerDepth !== DEFAULT_BOUNDS.maxPointerDepth) {
    issues.push({ path: '/bounds/maxPointerDepth', message: `maxPointerDepth must be ${DEFAULT_BOUNDS.maxPointerDepth}` });
  }
  return issues;
}

function isPackageAuthoringBounds(value: unknown): value is PackageAuthoringBounds {
  return isRecord(value)
    && value.maxOperations === DEFAULT_BOUNDS.maxOperations
    && value.maxBytes === DEFAULT_BOUNDS.maxBytes
    && value.maxPointerDepth === DEFAULT_BOUNDS.maxPointerDepth;
}

function collectPatchIssues(patch: unknown, path: string, bounds: PackageAuthoringBounds): PackageAuthoringIssue[] {
  const issues: PackageAuthoringIssue[] = [];
  if (!isRecord(patch)) return [{ path, message: 'change patch must be an object' }];
  if (!['add', 'replace', 'remove', 'test'].includes(String(patch.op))) {
    issues.push({ path: `${path}/op`, message: 'patch op must be add, replace, remove, or test' });
  }
  if (!isText(patch.path)) {
    issues.push({ path: `${path}/path`, message: 'patch path is required' });
    return issues;
  }
  const sourcePath = patch.path.trim();
  const parts = normalizeAuthoringSourcePath(sourcePath);
  const root = parts[0];
  if (!sourcePath.startsWith('/') || sourcePath.includes('..') || sourcePath.includes('\\')) {
    issues.push({ path: `${path}/path`, message: 'patch path must be a package-source JSON Pointer' });
  }
  if (!root || !PACKAGE_AUTHORING_ALLOWED_ROOTS.includes(root as never)) {
    issues.push({ path: `${path}/path`, message: `patch root is not package-source safe: ${root ?? ''}` });
  }
  if (parts.length > bounds.maxPointerDepth) {
    issues.push({ path: `${path}/path`, message: `patch path depth exceeds ${bounds.maxPointerDepth}` });
  }
  if (EXECUTABLE_SOURCE_PATTERN.test(sourcePath)) {
    issues.push({ path: `${path}/path`, message: 'patch path cannot target executable code or SQL' });
  }
  if (sourcePath === '/app/version' || sourcePath === '/app/id') {
    issues.push({ path: `${path}/path`, message: 'patch path cannot change package identity' });
  }
  if (patch.op !== 'remove' && !Object.hasOwn(patch, 'value')) {
    issues.push({ path: `${path}/value`, message: 'add, replace, and test patches require value' });
  }
  if (containsExecutablePayload(patch.value)) {
    issues.push({ path: `${path}/value`, message: 'patch value cannot include executable code or SQL markers' });
  }
  return issues;
}

function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function unescapeJsonPointerToken(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function containsExecutablePayload(value: unknown): boolean {
  if (typeof value === 'string') return /\b(?:function|eval|import|require|select|insert|update|delete|drop|alter)\b/i.test(value);
  if (Array.isArray(value)) return value.some(containsExecutablePayload);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => EXECUTABLE_SOURCE_PATTERN.test(key) || containsExecutablePayload(child));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
