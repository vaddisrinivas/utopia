import jsonPatch, { type Operation as JsonPatchOperation } from 'fast-json-patch';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  approvePackageAuthoringEvaluation,
  computePackageSourceRevision,
  evaluatePackageAuthoringChange,
  type PackageAuthoringEvaluationOptions,
} from '@/src/domain/package-authoring';
import {
  activateAppPackage,
  getActiveAppPackage,
  type AppPackageChangeApprovalReceipt,
  type AppPackageChangeRequest,
} from '@/src/db/app-package-registry';
import { canonicalJson, sha256Canonical } from '@/src/domain/canonical-json';
import { buildSafePackageChangeRequest } from '@/src/domain/package-change-templates';
import { loadAppPackage } from '@/src/domain/package-loader';
import { compileAppPackageSource, type AppPackageSourceFolder, type PackageSemanticDiff } from '@/packages/app-compiler';
import { isAllowedAppPackagePatchPath } from '@/packages/shared/contracts/package-change';
import type { AppInstallationId } from '@/packages/shared/contracts/app-installation';
import {
  normalizeAuthoringSourcePath,
  type PackageAuthoringApprovalReceipt,
  type PackageAuthoringChange,
  type PackageAuthoringEvaluation,
} from '@/packages/shared/contracts/package-authoring';
import {
  collectAppPackageValidationIssues,
  formatAppPackageValidationIssues,
  type AppPackage,
  type FieldType,
} from '@/packages/shared/contracts/package';

const FIELD_TYPES = ['text', 'number', 'boolean', 'timestamp', 'json'] as const satisfies readonly FieldType[];

export type ControlRoomSourceTree = Readonly<{
  schemaVersion: 'wonder.package-control-room.source-tree.v1';
  packageKey: string;
  sections: readonly ControlRoomSourceTreeSection[];
}>;

export type ControlRoomSourceTreeSection = Readonly<{
  id: 'app' | 'collections' | 'screens' | 'queries' | 'rules' | 'workflows' | 'providers' | 'theme' | 'capabilities';
  label: string;
  path: string;
  children: readonly ControlRoomSourceTreeNode[];
}>;

export type ControlRoomSourceTreeNode = Readonly<{
  id: string;
  label: string;
  path: string;
  kind: string;
}>;

export type CollectionFieldFormValue = Readonly<{
  collectionId: string;
  fieldId: string;
  type: FieldType;
  required?: boolean;
  indexed?: boolean;
}>;

export type ControlRoomFormSchema = Readonly<{
  schemaVersion: 'wonder.package-control-room.form.v1';
  formId: 'collection-field';
  jsonSchema: {
    type: 'object';
    required: readonly string[];
    additionalProperties: false;
    properties: Record<string, unknown>;
  };
  uiSchema: Record<string, unknown>;
}>;

export type ControlRoomProposal = Readonly<{
  schemaVersion: 'wonder.package-control-room.proposal.v1';
  kind: 'schema-form' | 'ai';
  request: AppPackageChangeRequest;
}>;

export type ControlRoomDiffEntry = Readonly<{
  section: string;
  kind: 'added' | 'removed' | 'changed';
  id: string;
  path: string;
  detail: string;
}>;

export type ControlRoomPreview = Readonly<{
  schemaVersion: 'wonder.package-control-room.preview.v1';
  status: 'valid' | 'invalid';
  installationId: AppInstallationId;
  requestHash: string;
  packageHash: string | null;
  basePackageKey: string | null;
  package: AppPackage | null;
  sourceTree: ControlRoomSourceTree | null;
  diff: readonly ControlRoomDiffEntry[];
  errors: readonly string[];
}>;

export type ControlRoomSourceRevision = Readonly<{
  schemaVersion: 'wonder.package-control-room.source-revision.v1';
  installationId: AppInstallationId;
  revision: string;
  parentRevision: string | null;
  createdAt: string;
  createdBy: string;
  changeId: string | null;
  packageChecksum: string;
  packageKey: string;
  source: AppPackageSourceFolder;
  package: AppPackage;
}>;

export type ControlRoomSourceState = Readonly<{
  schemaVersion: 'wonder.package-control-room.state.v1';
  workspaceId: string;
  installationId: AppInstallationId;
  activeRevision: string;
  revisions: Record<string, ControlRoomSourceRevision>;
  approvals: Record<string, ControlRoomSourceApprovalReceipt>;
}>;

export type ControlRoomSourceProposal = Readonly<{
  schemaVersion: 'wonder.package-control-room.source-proposal.v1';
  kind: 'schema-form' | 'ai' | 'manual';
  change: PackageAuthoringChange;
}>;

export type ControlRoomSourcePreview =
  | Readonly<{
      schemaVersion: 'wonder.package-control-room.source-preview.v1';
      status: 'valid';
      workspaceId: string;
      installationId: AppInstallationId;
      proposalHash: string;
      changeId: string;
      baseSourceRevision: string;
      basePackageChecksum: string;
      nextSourceRevision: string;
      nextPackageChecksum: string;
      sourceTree: ControlRoomSourceTree;
      diff: readonly ControlRoomDiffEntry[];
      package: AppPackage;
      preview: PackageAuthoringEvaluation & { valid: true };
      errors: readonly [];
    }>
  | Readonly<{
      schemaVersion: 'wonder.package-control-room.source-preview.v1';
      status: 'invalid';
      workspaceId: string;
      installationId: AppInstallationId;
      proposalHash: string;
      changeId: string | null;
      baseSourceRevision: string;
      basePackageChecksum: string;
      nextSourceRevision: null;
      nextPackageChecksum: null;
      sourceTree: null;
      diff: readonly [];
      package: null;
      preview: PackageAuthoringEvaluation & { valid: false };
      errors: readonly string[];
    }>;

export type ControlRoomSourceApprovalReceipt = Readonly<{
  schemaVersion: 'wonder.package-control-room.approval.v1';
  changeId: string;
  proposalHash: string;
  operationsHash: string;
  workspaceId: string;
  installationId: AppInstallationId;
  approvedBy: string;
  proposedBy: string;
  approvedAt: string;
  expiresAt: string;
  policyCategory: string;
  nonce: string;
  baseSourceRevision: string;
  nextSourceRevision: string;
  basePackageChecksum: string;
  nextPackageChecksum: string;
  rollbackSourceRevision: string;
  consumedAt: string | null;
  activationAllowed: true;
  authoringApproval: PackageAuthoringApprovalReceipt;
}>;

export type ControlRoomActivationReceipt = Readonly<{
  schemaVersion: 'wonder.package-control-room.activation.v1';
  changeId: string;
  workspaceId: string;
  installationId: AppInstallationId;
  approvedBy: string;
  activatedBy: string;
  activatedAt: string;
  approvalNonce: string;
  approvalHash: string;
  previousSourceRevision: string;
  activeSourceRevision: string;
  packageChecksum: string;
}>;

export type ControlRoomRollbackReceipt = Readonly<{
  schemaVersion: 'wonder.package-control-room.rollback.v1';
  workspaceId: string;
  installationId: AppInstallationId;
  rolledBackBy: string;
  rolledBackAt: string;
  fromSourceRevision: string;
  toSourceRevision: string;
  packageChecksum: string;
}>;

export function indexPackageSourceTree(appPackage: AppPackage): ControlRoomSourceTree {
  const screens = appPackage.presentation?.ui?.screens ?? {};
  const providerFields = appPackage.presentation?.providerTemplateFields ?? {};
  const theme = appPackage.presentation?.visualIdentity ?? {};
  return {
    schemaVersion: 'wonder.package-control-room.source-tree.v1',
    packageKey: packageKey(appPackage),
    sections: [
      section('app', 'App', '', [
        node(appPackage.id, appPackage.presentation?.label ?? appPackage.id, '', 'package'),
      ]),
      section('collections', 'Collections', '/collections', Object.keys(appPackage.collections).sort().map((id) => (
        node(id, id, `/collections/${escapeJsonPointer(id)}`, 'collection')
      ))),
      section('screens', 'Screens', '/presentation/ui/screens', Object.keys(screens).sort().map((id) => (
        node(id, screens[id]?.title ?? id, `/presentation/ui/screens/${escapeJsonPointer(id)}`, 'screen')
      ))),
      section('queries', 'Queries', '/queries', Object.keys(appPackage.queries).sort().map((id) => (
        node(id, id, `/queries/${escapeJsonPointer(id)}`, 'query')
      ))),
      section('rules', 'Rules', '/rules', appPackage.rules.map((rule, index) => (
        node(rule.id, rule.id, `/rules/${index}`, 'rule')
      )).sort(compareNode)),
      section('workflows', 'Workflows', '/rules', appPackage.rules
        .filter((rule) => rule.effect.kind === 'propose_operation')
        .map((rule, index) => node(rule.id, rule.id, `/rules/${index}`, 'workflow'))
        .sort(compareNode)),
      section('providers', 'Providers', '/presentation/providerTemplateFields', Object.keys(providerFields).sort().map((id) => (
        node(id, id, `/presentation/providerTemplateFields/${escapeJsonPointer(id)}`, 'provider')
      ))),
      section('theme', 'Theme', '/presentation/visualIdentity', Object.keys(theme).sort().map((id) => (
        node(id, id, `/presentation/visualIdentity/${escapeJsonPointer(id)}`, 'theme-token')
      ))),
      section('capabilities', 'Capabilities', '/capabilities', appPackage.capabilities.slice().sort().map((id) => (
        node(id, id, `/capabilities/${escapeJsonPointer(id)}`, 'capability')
      ))),
    ],
  };
}

export function buildCollectionFieldFormSchema(appPackage: AppPackage): ControlRoomFormSchema {
  return {
    schemaVersion: 'wonder.package-control-room.form.v1',
    formId: 'collection-field',
    jsonSchema: {
      type: 'object',
      required: ['collectionId', 'fieldId', 'type'],
      additionalProperties: false,
      properties: {
        collectionId: { type: 'string', enum: Object.keys(appPackage.collections).sort() },
        fieldId: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
        type: { type: 'string', enum: [...FIELD_TYPES] },
        required: { type: 'boolean', default: false },
        indexed: { type: 'boolean', default: false },
      },
    },
    uiSchema: {
      collectionId: { widget: 'select' },
      fieldId: { widget: 'text' },
      type: { widget: 'segmented' },
      required: { widget: 'checkbox' },
      indexed: { widget: 'checkbox' },
    },
  };
}

export function proposeCollectionFieldPatch(
  activePackage: AppPackage,
  value: CollectionFieldFormValue,
): ControlRoomProposal {
  validateCollectionFieldValue(activePackage, value);
  const field = cleanJson({
    type: value.type,
    required: value.required === true ? true : undefined,
    indexed: value.indexed === true ? true : undefined,
  });
  const seed = { kind: 'schema-form', collectionId: value.collectionId, fieldId: value.fieldId, field };
  return {
    schemaVersion: 'wonder.package-control-room.proposal.v1',
    kind: 'schema-form',
    request: {
      basePackageKey: packageKey(activePackage),
      requestedBy: 'control-room-schema-form',
      patch: [
        deterministicVersionPatch(activePackage.version, seed),
        {
          op: 'add',
          path: `/collections/${escapeJsonPointer(value.collectionId)}/fields/${escapeJsonPointer(value.fieldId)}`,
          value: field,
        },
      ],
    },
  };
}

export function proposeAiScreenPatch(activePackage: AppPackage, prompt: string): ControlRoomProposal {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) throw new Error('control_room_prompt_required');
  const request = buildSafePackageChangeRequest(activePackage, normalizedPrompt);
  return {
    schemaVersion: 'wonder.package-control-room.proposal.v1',
    kind: 'ai',
    request: {
      ...request,
      basePackageKey: packageKey(activePackage),
      requestedBy: 'control-room-ai',
      patch: request.patch.map((operation) => (
        operation.path === '/version'
          ? deterministicVersionPatch(activePackage.version, { kind: 'ai', prompt: normalizedPrompt })
          : operation
      )),
    },
  };
}

export async function previewControlRoomChange(
  db: SQLiteDatabase,
  input: { installationId: AppInstallationId; request: AppPackageChangeRequest },
): Promise<ControlRoomPreview> {
  const installationId = normalizeInstallationId(input.installationId);
  const requestHash = hashValue(normalizeRequest(input.request));
  const active = await getActiveAppPackage(db, installationId);
  if (!active) throw new Error(`control_room_no_active_package:${installationId}`);
  const basePackageKey = packageKey(active);
  try {
    validateRequest(input.request, active);
    const nextCandidate = applyPackagePatch(active, input.request.patch);
    const validationErrors = formatAppPackageValidationIssues(collectAppPackageValidationIssues(nextCandidate, nextCandidate.schemaVersion));
    if (validationErrors.length > 0) throw new Error(`app_package_invalid:${validationErrors.join('|')}`);
    const next = loadAppPackage(nextCandidate).activePackage;
    return {
      schemaVersion: 'wonder.package-control-room.preview.v1',
      status: 'valid',
      installationId,
      requestHash,
      packageHash: hashValue(next),
      basePackageKey,
      package: next,
      sourceTree: indexPackageSourceTree(next),
      diff: semanticDiff(active, next),
      errors: [],
    };
  } catch (error) {
    return {
      schemaVersion: 'wonder.package-control-room.preview.v1',
      status: 'invalid',
      installationId,
      requestHash,
      packageHash: null,
      basePackageKey,
      package: null,
      sourceTree: null,
      diff: [],
      errors: [error instanceof Error ? error.message : 'control_room_invalid_proposal'],
    };
  }
}

export async function activateApprovedControlRoomChange(
  db: SQLiteDatabase,
  input: {
    installationId: AppInstallationId;
    request: AppPackageChangeRequest;
    approval: AppPackageChangeApprovalReceipt;
  },
): Promise<{ package: AppPackage; preview: ControlRoomPreview }> {
  const preview = await previewControlRoomChange(db, {
    installationId: input.installationId,
    request: input.request,
  });
  if (preview.status !== 'valid' || !preview.package || !preview.packageHash) {
    throw new Error(`control_room_invalid_proposal:${preview.errors.join('|') || 'control_room_invalid_proposal'}`);
  }
  if (
    input.approval.schemaVersion !== 'wonder.package-change-approval.v1'
    || input.approval.approved !== true
    || input.approval.requestHash !== preview.requestHash
    || input.approval.packageHash !== preview.packageHash
    || !input.approval.approvedBy.trim()
    || Number.isNaN(Date.parse(input.approval.approvedAt))
  ) {
    throw new Error('control_room_approval_mismatch');
  }

  const activated = await activateAppPackage(db, preview.installationId, preview.package, 'activate', {
    requestHash: preview.requestHash,
    packageHash: preview.packageHash,
    approvalHash: hashValue(input.approval),
    approvedBy: input.approval.approvedBy,
  });
  return { package: activated, preview };
}

export function approveControlRoomPreview(
  preview: ControlRoomPreview,
  input: { approvedBy: string; approvedAt?: string },
): AppPackageChangeApprovalReceipt {
  if (preview.status !== 'valid' || !preview.packageHash) {
    throw new Error('control_room_invalid_preview');
  }
  return {
    schemaVersion: 'wonder.package-change-approval.v1',
    approved: true,
    requestHash: preview.requestHash,
    packageHash: preview.packageHash,
    approvedBy: normalizeActor(input.approvedBy, 'control_room_approved_by_required'),
    approvedAt: normalizeIsoTimestamp(input.approvedAt ?? new Date().toISOString(), 'control_room_approved_at_invalid'),
  };
}

export function createControlRoomSourceState(input: {
  installationId: AppInstallationId;
  workspaceId?: string;
  source: AppPackageSourceFolder;
  createdBy: string;
  createdAt?: string;
  options?: PackageAuthoringEvaluationOptions;
}): ControlRoomSourceState {
  const installationId = normalizeInstallationId(input.installationId);
  const createdAt = normalizeIsoTimestamp(input.createdAt ?? new Date().toISOString(), 'control_room_created_at_invalid');
  const createdBy = normalizeActor(input.createdBy, 'control_room_created_by_required');
  const compiled = previewSourceCompilation(input.source, input.options);
  const revision = buildSourceRevision({
    installationId,
    parentRevision: null,
    createdAt,
    createdBy,
    changeId: null,
    source: input.source,
    package: compiled.package,
    packageChecksum: compiled.packageChecksum,
  });
  return {
    schemaVersion: 'wonder.package-control-room.state.v1',
    workspaceId: normalizeWorkspaceId(input.workspaceId ?? 'default-workspace'),
    installationId,
    activeRevision: revision.revision,
    revisions: { [revision.revision]: revision },
    approvals: {},
  };
}

export function previewControlRoomSourceProposal(
  state: ControlRoomSourceState,
  proposal: ControlRoomSourceProposal,
  options: PackageAuthoringEvaluationOptions = {},
): ControlRoomSourcePreview {
  const activeRevision = getActiveSourceRevision(state);
  const proposalHash = hashValue(normalizeSourceProposal(proposal));
  const evaluation = evaluatePackageAuthoringChange(activeRevision.source, proposal.change, {
    ...options,
    baselinePackage: options.baselinePackage ?? activeRevision.package,
  });
  if (!evaluation.valid) {
    return {
      schemaVersion: 'wonder.package-control-room.source-preview.v1',
      status: 'invalid',
      workspaceId: state.workspaceId,
      installationId: state.installationId,
      proposalHash,
      changeId: null,
      baseSourceRevision: activeRevision.revision,
      basePackageChecksum: activeRevision.packageChecksum,
      nextSourceRevision: null,
      nextPackageChecksum: null,
      sourceTree: null,
      diff: [],
      package: null,
      preview: evaluation,
      errors: evaluation.errors.map((error) => `${error.path}:${error.message}`),
    };
  }
  return {
    schemaVersion: 'wonder.package-control-room.source-preview.v1',
    status: 'valid',
    workspaceId: state.workspaceId,
    installationId: state.installationId,
    proposalHash,
    changeId: evaluation.changeId,
    baseSourceRevision: evaluation.baseSourceRevision,
    basePackageChecksum: activeRevision.packageChecksum,
    nextSourceRevision: evaluation.nextSourceRevision,
    nextPackageChecksum: evaluation.packageChecksum,
    sourceTree: indexPackageSourceTree(evaluation.package),
    diff: toControlRoomDiff(evaluation.diff as PackageSemanticDiff[]),
    package: evaluation.package,
    preview: evaluation,
    errors: [],
  };
}

export function approveControlRoomSourcePreview(
  state: ControlRoomSourceState,
  proposal: ControlRoomSourceProposal,
  preview: ControlRoomSourcePreview,
  input: {
    approvedBy: string;
    policyCategory: string;
    approvedAt?: string;
    expiresAt: string;
    nonce: string;
  },
): ControlRoomSourceApprovalReceipt {
  if (preview.status !== 'valid') throw new Error('control_room_invalid_preview');
  const approvedBy = normalizeActor(input.approvedBy, 'control_room_approved_by_required');
  const nonce = normalizeActor(input.nonce, 'control_room_nonce_required');
  const policyCategory = normalizeActor(input.policyCategory, 'control_room_policy_category_required');
  const approvedAt = normalizeIsoTimestamp(input.approvedAt ?? new Date().toISOString(), 'control_room_approved_at_invalid');
  const expiresAt = normalizeIsoTimestamp(input.expiresAt, 'control_room_expires_at_invalid');
  if (Date.parse(expiresAt) <= Date.parse(approvedAt)) throw new Error('control_room_approval_expired');
  const activeRevision = getActiveSourceRevision(state);
  if (activeRevision.revision !== preview.baseSourceRevision) throw new Error('control_room_base_revision_moved');
  const authoringApproval = approvePackageAuthoringEvaluation(preview.preview, { approvedBy, approvedAt });
  return {
    schemaVersion: 'wonder.package-control-room.approval.v1',
    changeId: preview.changeId,
    proposalHash: preview.proposalHash,
    operationsHash: hashValue(proposal.change.proposals),
    workspaceId: state.workspaceId,
    installationId: state.installationId,
    approvedBy,
    proposedBy: preview.preview.proposedBy,
    approvedAt,
    expiresAt,
    policyCategory,
    nonce,
    baseSourceRevision: preview.baseSourceRevision,
    nextSourceRevision: preview.nextSourceRevision,
    basePackageChecksum: preview.basePackageChecksum,
    nextPackageChecksum: preview.nextPackageChecksum,
    rollbackSourceRevision: preview.baseSourceRevision,
    consumedAt: null,
    activationAllowed: true,
    authoringApproval,
  };
}

export function activateControlRoomSourceProposal(
  state: ControlRoomSourceState,
  proposal: ControlRoomSourceProposal,
  approval: ControlRoomSourceApprovalReceipt,
  input: { activatedBy: string; activatedAt?: string },
  options: PackageAuthoringEvaluationOptions = {},
): { state: ControlRoomSourceState; preview: ControlRoomSourcePreview; receipt: ControlRoomActivationReceipt } {
  const activatedAt = normalizeIsoTimestamp(input.activatedAt ?? new Date().toISOString(), 'control_room_activated_at_invalid');
  const activatedBy = normalizeActor(input.activatedBy, 'control_room_activated_by_required');
  const storedApproval = state.approvals[approval.nonce] ?? approval;
  assertControlRoomApproval(state, proposal, storedApproval, activatedAt);
  const preview = previewControlRoomSourceProposal(state, proposal, options);
  if (preview.status !== 'valid') throw new Error(`control_room_invalid_proposal:${preview.errors.join('|')}`);
  if (
    preview.changeId !== storedApproval.changeId
    || preview.baseSourceRevision !== storedApproval.baseSourceRevision
    || preview.nextSourceRevision !== storedApproval.nextSourceRevision
    || preview.nextPackageChecksum !== storedApproval.nextPackageChecksum
  ) {
    throw new Error('control_room_approval_mismatch');
  }
  const activeRevision = getActiveSourceRevision(state);
  const nextRevision = buildSourceRevision({
    installationId: state.installationId,
    parentRevision: activeRevision.revision,
    createdAt: activatedAt,
    createdBy: activatedBy,
    changeId: preview.changeId,
    source: applySourceProposal(activeRevision.source, proposal.change),
    package: preview.package,
    packageChecksum: preview.nextPackageChecksum,
  });
  const nextApproval: ControlRoomSourceApprovalReceipt = { ...storedApproval, consumedAt: activatedAt };
  return {
    state: {
      ...state,
      activeRevision: nextRevision.revision,
      revisions: { ...state.revisions, [nextRevision.revision]: nextRevision },
      approvals: { ...state.approvals, [nextApproval.nonce]: nextApproval },
    },
    preview,
    receipt: {
      schemaVersion: 'wonder.package-control-room.activation.v1',
      changeId: storedApproval.changeId,
      workspaceId: state.workspaceId,
      installationId: state.installationId,
      approvedBy: storedApproval.approvedBy,
      activatedBy,
      activatedAt,
      approvalNonce: storedApproval.nonce,
      approvalHash: hashValue(storedApproval),
      previousSourceRevision: activeRevision.revision,
      activeSourceRevision: nextRevision.revision,
      packageChecksum: nextRevision.packageChecksum,
    },
  };
}

export function rollbackControlRoomSource(
  state: ControlRoomSourceState,
  input: { targetRevision: string; rolledBackBy: string; rolledBackAt?: string },
): { state: ControlRoomSourceState; receipt: ControlRoomRollbackReceipt } {
  const rolledBackAt = normalizeIsoTimestamp(input.rolledBackAt ?? new Date().toISOString(), 'control_room_rollback_at_invalid');
  const rolledBackBy = normalizeActor(input.rolledBackBy, 'control_room_rolled_back_by_required');
  const activeRevision = getActiveSourceRevision(state);
  const targetRevision = state.revisions[input.targetRevision];
  if (!targetRevision) throw new Error(`control_room_revision_not_found:${input.targetRevision}`);
  if (targetRevision.revision === activeRevision.revision) throw new Error('control_room_revision_already_active');
  return {
    state: {
      ...state,
      activeRevision: targetRevision.revision,
    },
    receipt: {
      schemaVersion: 'wonder.package-control-room.rollback.v1',
      workspaceId: state.workspaceId,
      installationId: state.installationId,
      rolledBackBy,
      rolledBackAt,
      fromSourceRevision: activeRevision.revision,
      toSourceRevision: targetRevision.revision,
      packageChecksum: targetRevision.packageChecksum,
    },
  };
}

function validateCollectionFieldValue(activePackage: AppPackage, value: CollectionFieldFormValue): void {
  if (!Object.hasOwn(activePackage.collections, value.collectionId)) throw new Error(`control_room_collection_not_found:${value.collectionId}`);
  if (!/^[a-z][a-z0-9_]*$/.test(value.fieldId)) throw new Error(`control_room_field_id_invalid:${value.fieldId}`);
  if (!FIELD_TYPES.includes(value.type)) throw new Error(`control_room_field_type_invalid:${value.type}`);
  if (Object.hasOwn(activePackage.collections[value.collectionId].fields, value.fieldId)) {
    throw new Error(`control_room_field_exists:${value.collectionId}.${value.fieldId}`);
  }
}

function validateRequest(request: AppPackageChangeRequest, activePackage: AppPackage): void {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('control_room_request_invalid');
  if (request.basePackageKey && request.basePackageKey !== packageKey(activePackage)) throw new Error('control_room_base_mismatch');
  if (!Array.isArray(request.patch) || request.patch.length < 1 || request.patch.length > 64) throw new Error('control_room_patch_invalid');
  for (const operation of request.patch) {
    if (!operation || typeof operation !== 'object' || typeof operation.path !== 'string') throw new Error('control_room_patch_invalid');
    if (!['add', 'replace', 'remove', 'move', 'copy', 'test'].includes(operation.op)) throw new Error('control_room_patch_op_invalid');
    if (!isAllowedAppPackagePatchPath(operation.path)) throw new Error(`control_room_path_forbidden:${operation.path}`);
    if ((operation.op === 'move' || operation.op === 'copy') && (!operation.from || !isAllowedAppPackagePatchPath(operation.from))) {
      throw new Error(`control_room_path_forbidden:${operation.from ?? '<missing>'}`);
    }
  }
}

function semanticDiff(base: AppPackage, next: AppPackage): readonly ControlRoomDiffEntry[] {
  return [
    ...diffRecordKeys('collections', '/collections', base.collections, next.collections),
    ...diffCollectionFields(base, next),
    ...diffRecordKeys('queries', '/queries', base.queries, next.queries),
    ...diffRecordKeys('views', '/views', base.views, next.views),
    ...diffRecordKeys('screens', '/presentation/ui/screens', base.presentation?.ui?.screens ?? {}, next.presentation?.ui?.screens ?? {}),
    ...diffArrayValues('capabilities', '/capabilities', base.capabilities, next.capabilities),
    ...diffRules(base, next),
    ...diffTheme(base, next),
  ].sort((left, right) => `${left.section}:${left.id}:${left.kind}`.localeCompare(`${right.section}:${right.id}:${right.kind}`));
}

function diffCollectionFields(base: AppPackage, next: AppPackage): ControlRoomDiffEntry[] {
  const entries: ControlRoomDiffEntry[] = [];
  for (const collectionId of unionKeys(base.collections, next.collections)) {
    const baseFields = base.collections[collectionId]?.fields ?? {};
    const nextFields = next.collections[collectionId]?.fields ?? {};
    for (const fieldId of unionKeys(baseFields, nextFields)) {
      const path = `/collections/${escapeJsonPointer(collectionId)}/fields/${escapeJsonPointer(fieldId)}`;
      if (!Object.hasOwn(baseFields, fieldId) && Object.hasOwn(nextFields, fieldId)) {
        entries.push({ section: 'collections', kind: 'added', id: `${collectionId}.${fieldId}`, path, detail: `field added:${fieldId}` });
      } else if (Object.hasOwn(baseFields, fieldId) && !Object.hasOwn(nextFields, fieldId)) {
        entries.push({ section: 'collections', kind: 'removed', id: `${collectionId}.${fieldId}`, path, detail: `field removed:${fieldId}` });
      } else if (canonicalJson(baseFields[fieldId]) !== canonicalJson(nextFields[fieldId])) {
        entries.push({ section: 'collections', kind: 'changed', id: `${collectionId}.${fieldId}`, path, detail: `field changed:${fieldId}` });
      }
    }
  }
  return entries;
}

function diffRecordKeys(sectionName: string, root: string, base: Record<string, unknown>, next: Record<string, unknown>): ControlRoomDiffEntry[] {
  const entries: ControlRoomDiffEntry[] = [];
  for (const id of unionKeys(base, next)) {
    const path = `${root}/${escapeJsonPointer(id)}`;
    if (!Object.hasOwn(base, id) && Object.hasOwn(next, id)) {
      entries.push({ section: sectionName, kind: 'added', id, path, detail: `${sectionName} added:${id}` });
    } else if (Object.hasOwn(base, id) && !Object.hasOwn(next, id)) {
      entries.push({ section: sectionName, kind: 'removed', id, path, detail: `${sectionName} removed:${id}` });
    } else if (canonicalJson(base[id]) !== canonicalJson(next[id])) {
      entries.push({ section: sectionName, kind: 'changed', id, path, detail: `${sectionName} changed:${id}` });
    }
  }
  return entries;
}

function diffArrayValues(sectionName: string, root: string, base: readonly string[], next: readonly string[]): ControlRoomDiffEntry[] {
  const baseSet = new Set(base);
  const nextSet = new Set(next);
  const entries: ControlRoomDiffEntry[] = [];
  for (const id of [...new Set([...base, ...next])].sort()) {
    const path = `${root}/${escapeJsonPointer(id)}`;
    if (!baseSet.has(id) && nextSet.has(id)) {
      entries.push({ section: sectionName, kind: 'added', id, path, detail: `${sectionName} added:${id}` });
    } else if (baseSet.has(id) && !nextSet.has(id)) {
      entries.push({ section: sectionName, kind: 'removed', id, path, detail: `${sectionName} removed:${id}` });
    }
  }
  return entries;
}

function diffRules(base: AppPackage, next: AppPackage): ControlRoomDiffEntry[] {
  const baseRules = Object.fromEntries(base.rules.map((rule) => [rule.id, rule]));
  const nextRules = Object.fromEntries(next.rules.map((rule) => [rule.id, rule]));
  return diffRecordKeys('rules', '/rules', baseRules, nextRules);
}

function diffTheme(base: AppPackage, next: AppPackage): ControlRoomDiffEntry[] {
  const baseTheme = base.presentation?.visualIdentity ?? {};
  const nextTheme = next.presentation?.visualIdentity ?? {};
  if (canonicalJson(baseTheme) === canonicalJson(nextTheme)) return [];
  return [{ section: 'theme', kind: 'changed', id: 'visualIdentity', path: '/presentation/visualIdentity', detail: 'theme changed:visualIdentity' }];
}

function applyPackagePatch(base: AppPackage, patch: readonly JsonPatchOperation[]): AppPackage {
  const clone = JSON.parse(JSON.stringify(base)) as AppPackage;
  return jsonPatch.applyPatch(clone, [...patch], true, false).newDocument as AppPackage;
}

function normalizeRequest(request: AppPackageChangeRequest): AppPackageChangeRequest {
  return {
    basePackageKey: request.basePackageKey ?? null,
    requestedBy: request.requestedBy?.trim() || 'control-room',
    patch: request.patch,
  };
}

function deterministicVersionPatch(version: string, seed: unknown): AppPackageChangeRequest['patch'][number] {
  return { op: 'replace', path: '/version', value: nextControlVersion(version, seed) };
}

function nextControlVersion(version: string, seed: unknown): string {
  const cleanVersion = version.replace(/\+control\.[a-f0-9]{12}$/i, '').replace(/\+ai\.[a-z0-9]+$/i, '');
  return `${cleanVersion}+control.${hashValue(seed).slice('sha256:'.length, 'sha256:'.length + 12)}`;
}

function cleanJson<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function section(id: ControlRoomSourceTreeSection['id'], label: string, path: string, children: readonly ControlRoomSourceTreeNode[]): ControlRoomSourceTreeSection {
  return { id, label, path, children };
}

function node(id: string, label: string, path: string, kind: string): ControlRoomSourceTreeNode {
  return { id, label, path, kind };
}

function compareNode(left: ControlRoomSourceTreeNode, right: ControlRoomSourceTreeNode): number {
  return left.id.localeCompare(right.id);
}

function unionKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
}

function packageKey(appPackage: AppPackage): string {
  return `${appPackage.id}@${appPackage.version}`;
}

function hashValue(value: unknown): string {
  return sha256Canonical(value);
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function normalizeInstallationId(value: AppInstallationId): AppInstallationId {
  const id = String(value ?? '').trim();
  if (!id) throw new Error('app_installation_id_required');
  return id;
}

function normalizeWorkspaceId(value: string): string {
  const workspaceId = String(value ?? '').trim();
  if (!workspaceId) throw new Error('control_room_workspace_id_required');
  return workspaceId;
}

function normalizeActor(value: string, code: string): string {
  const actor = String(value ?? '').trim();
  if (!actor) throw new Error(code);
  return actor;
}

function normalizeIsoTimestamp(value: string, code: string): string {
  const timestamp = String(value ?? '').trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error(code);
  return timestamp;
}

function getActiveSourceRevision(state: ControlRoomSourceState): ControlRoomSourceRevision {
  const revision = state.revisions[state.activeRevision];
  if (!revision) throw new Error(`control_room_active_revision_missing:${state.activeRevision}`);
  return revision;
}

function previewSourceCompilation(
  source: AppPackageSourceFolder,
  options: PackageAuthoringEvaluationOptions = {},
): { package: AppPackage; packageChecksum: string } {
  const compiled = compileAppPackageSource(source, options);
  if (!compiled.valid) throw new Error(compiled.errors.map((error) => `${error.path}:${error.message}`).join('|'));
  return { package: compiled.package, packageChecksum: compiled.checksum };
}

function buildSourceRevision(input: {
  installationId: AppInstallationId;
  parentRevision: string | null;
  createdAt: string;
  createdBy: string;
  changeId: string | null;
  source: AppPackageSourceFolder;
  package: AppPackage;
  packageChecksum: string;
}): ControlRoomSourceRevision {
  const source = cleanJson(input.source) as AppPackageSourceFolder;
  return {
    schemaVersion: 'wonder.package-control-room.source-revision.v1',
    installationId: input.installationId,
    revision: computePackageSourceRevision(source),
    parentRevision: input.parentRevision,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    changeId: input.changeId,
    packageChecksum: input.packageChecksum,
    packageKey: packageKey(input.package),
    source,
    package: cleanJson(input.package) as AppPackage,
  };
}

function normalizeSourceProposal(proposal: ControlRoomSourceProposal): ControlRoomSourceProposal {
  return {
    schemaVersion: 'wonder.package-control-room.source-proposal.v1',
    kind: proposal.kind,
    change: proposal.change,
  };
}

function toControlRoomDiff(entries: readonly PackageSemanticDiff[]): readonly ControlRoomDiffEntry[] {
  return entries.map((entry) => {
    const section = normalizeAuthoringSourcePath(entry.path)[0] ?? 'package';
    return {
      section,
      kind: entry.kind,
      id: entry.path,
      path: entry.path,
      detail: entry.summary,
    };
  });
}

function assertControlRoomApproval(
  state: ControlRoomSourceState,
  proposal: ControlRoomSourceProposal,
  approval: ControlRoomSourceApprovalReceipt,
  activatedAt: string,
): void {
  const activeRevision = getActiveSourceRevision(state);
  if (approval.schemaVersion !== 'wonder.package-control-room.approval.v1') throw new Error('control_room_approval_mismatch');
  if (approval.workspaceId !== state.workspaceId || approval.installationId !== state.installationId) throw new Error('control_room_approval_scope_mismatch');
  if (approval.baseSourceRevision !== activeRevision.revision) throw new Error('control_room_base_revision_moved');
  if (approval.consumedAt) throw new Error('control_room_approval_consumed');
  if (Date.parse(approval.expiresAt) < Date.parse(activatedAt)) throw new Error('control_room_approval_expired');
  if (approval.operationsHash !== hashValue(proposal.change.proposals)) throw new Error('control_room_approval_operations_mismatch');
}

function applySourceProposal(source: AppPackageSourceFolder, change: PackageAuthoringChange): AppPackageSourceFolder {
  const clone = cleanJson(source) as AppPackageSourceFolder;
  return jsonPatch.applyPatch(clone as unknown as Record<string, unknown>, change.proposals as JsonPatchOperation[], true, true)
    .newDocument as AppPackageSourceFolder;
}
