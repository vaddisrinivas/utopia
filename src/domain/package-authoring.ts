import jsonPatch, { type Operation as JsonPatchOperation } from 'fast-json-patch';

import type { AppPackage } from '@/packages/shared/contracts/package';
import {
  PACKAGE_AUTHORING_APPROVAL_SCHEMA_VERSION,
  PACKAGE_AUTHORING_EVALUATION_SCHEMA_VERSION,
  collectPackageAuthoringChangeIssues,
  createDefaultPackageAuthoringBounds,
  isPackageAuthoringChange,
  normalizeAuthoringSourcePath,
  type PackageAuthoringApprovalReceipt,
  type PackageAuthoringChange,
  type PackageAuthoringEvaluation,
  type PackageAuthoringIssue,
  type PackageAuthoringPatchProposal,
} from '@/packages/shared/contracts/package-authoring';
import {
  compileAppPackageSource,
  type AppPackageSourceFolder,
} from '@/packages/app-compiler';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';

export type PackageAuthoringEvaluationOptions = Readonly<{
  baselinePackage?: AppPackage;
}>;

export function createPackageAuthoringChange(input: {
  baseSourceRevision: string;
  intent: string;
  proposedBy: string;
  proposals: readonly PackageAuthoringPatchProposal[];
}): PackageAuthoringChange {
  return {
    schemaVersion: 'utopia.authoring-change.v1',
    baseSourceRevision: input.baseSourceRevision,
    intent: input.intent,
    proposedBy: input.proposedBy,
    proposals: [...input.proposals],
    bounds: createDefaultPackageAuthoringBounds(),
  };
}

export function evaluatePackageAuthoringChange(
  baseSource: AppPackageSourceFolder,
  change: unknown,
  options: PackageAuthoringEvaluationOptions = {},
): PackageAuthoringEvaluation {
  const contractIssues = collectPackageAuthoringChangeIssues(change);
  if (contractIssues.length > 0 || !isPackageAuthoringChange(change)) {
    return invalid(contractIssues);
  }

  const baseSourceRevision = computePackageSourceRevision(baseSource);
  const changeId = computePackageAuthoringChangeId(change);
  if (change.baseSourceRevision !== baseSourceRevision) {
    return invalid([
      {
        path: '/baseSourceRevision',
        message: `baseSourceRevision mismatch: expected ${baseSourceRevision}`,
      },
    ], changeId, change);
  }

  const baselineCompilation = options.baselinePackage ? undefined : compileAppPackageSource(baseSource);
  if (baselineCompilation && !baselineCompilation.valid) {
    return invalid(baselineCompilation.errors, changeId, change);
  }

  const patched = cloneSource(baseSource);
  const patchIssues = applyAuthoringPatches(patched, change.proposals);
  if (patchIssues.length > 0) return invalid(patchIssues, changeId, change);

  const compiled = compileAppPackageSource(patched, {
    baselinePackage: options.baselinePackage ?? baselineCompilation?.package,
  });
  if (!compiled.valid) {
    return invalid(compiled.errors, changeId, change);
  }

  return {
    schemaVersion: PACKAGE_AUTHORING_EVALUATION_SCHEMA_VERSION,
    valid: true,
    changeId,
    proposedBy: change.proposedBy,
    intent: change.intent,
    baseSourceRevision,
    nextSourceRevision: computePackageSourceRevision(patched),
    packageChecksum: compiled.checksum,
    package: compiled.package,
    preview: compiled.preview,
    diff: compiled.diff,
    requiresApproval: true,
    risk: classifyAuthoringRisk(change),
  };
}

export function approvePackageAuthoringEvaluation(
  evaluation: PackageAuthoringEvaluation,
  input: { approvedBy: string; approvedAt?: string },
): PackageAuthoringApprovalReceipt {
  if (!evaluation.valid) throw new Error('cannot approve invalid package authoring evaluation');
  if (!input.approvedBy.trim()) throw new Error('approvedBy is required');
  if (input.approvedBy === evaluation.proposedBy) throw new Error('AI package authoring changes cannot be self-approved');
  return {
    schemaVersion: PACKAGE_AUTHORING_APPROVAL_SCHEMA_VERSION,
    changeId: evaluation.changeId,
    approvedBy: input.approvedBy,
    proposedBy: evaluation.proposedBy,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    baseSourceRevision: evaluation.baseSourceRevision,
    nextSourceRevision: evaluation.nextSourceRevision,
    packageChecksum: evaluation.packageChecksum,
    activationAllowed: true,
    rollbackSourceRevision: evaluation.baseSourceRevision,
  };
}

export function computePackageSourceRevision(source: AppPackageSourceFolder): string {
  return sha256Canonical(source);
}

export function computePackageAuthoringChangeId(change: PackageAuthoringChange): string {
  return sha256Canonical(change);
}

function applyAuthoringPatches(source: AppPackageSourceFolder, changes: readonly PackageAuthoringPatchProposal[]): PackageAuthoringIssue[] {
  const issues: PackageAuthoringIssue[] = [];
  try {
    const patched = jsonPatch.applyPatch(source as unknown as Record<string, unknown>, changes as JsonPatchOperation[], true, true)
      .newDocument as AppPackageSourceFolder;
    Object.assign(source, patched);
  } catch (error) {
    issues.push({
      path: '/proposals',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  issues.push(...collectPostPatchIssues(source, changes));
  return issues;
}

function classifyAuthoringRisk(change: PackageAuthoringChange): string[] {
  const risks = new Set<string>(['approval_required']);
  for (const patch of change.proposals) {
    const root = normalizeAuthoringSourcePath(patch.path)[0];
    if (root === 'capabilities') risks.add('native_or_dependency_capability_change');
    if (root === 'providers') risks.add('provider_configuration_change');
    if (root === 'rules' || root === 'workflows') risks.add('automation_change');
    if (patch.op === 'remove') risks.add('destructive_source_change');
  }
  return [...risks].sort();
}

function invalid(
  errors: readonly PackageAuthoringIssue[],
  changeId?: string,
  change?: PackageAuthoringChange,
): PackageAuthoringEvaluation {
  return {
    schemaVersion: PACKAGE_AUTHORING_EVALUATION_SCHEMA_VERSION,
    valid: false,
    ...(changeId ? { changeId } : {}),
    ...(change?.proposedBy ? { proposedBy: change.proposedBy } : {}),
    ...(change?.intent ? { intent: change.intent } : {}),
    ...(change?.baseSourceRevision ? { baseSourceRevision: change.baseSourceRevision } : {}),
    errors: [...errors],
  };
}

function cloneSource(source: AppPackageSourceFolder): AppPackageSourceFolder {
  return cloneJson(source) as AppPackageSourceFolder;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function collectPostPatchIssues(
  source: AppPackageSourceFolder,
  changes: readonly PackageAuthoringPatchProposal[],
): PackageAuthoringIssue[] {
  const issues: PackageAuthoringIssue[] = [];
  if (!source.app || typeof source.app !== 'object') {
    issues.push({ path: '/app', message: 'app source must remain an object' });
  }
  if (changes.some((patch) => patch.path === '/app' && patch.op === 'remove')) {
    issues.push({ path: '/proposals', message: 'app source cannot be removed' });
  }
  return issues;
}
