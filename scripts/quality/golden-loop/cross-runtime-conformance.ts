import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { collectAppPackageValidationIssues } from '@/packages/shared/contracts/package';
import { collectArtifactValidationCategories, validateArtifact } from '@/packages/schemas/src';
import {
  evaluateComputedFields as evaluateSharedComputedFields,
} from '@/packages/runtime-kernel/computed-fields';
import {
  evaluateExpression as evaluateSharedExpression,
  validateExpressionBudget as validateSharedExpressionBudget,
  type ExpressionBudget,
} from '@/packages/runtime-kernel/expression';
import { executeQuery as executeSharedQuery } from '@/packages/runtime-kernel/query';
import {
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  type PackageInstallPreview,
} from '@/packages/shared/contracts/package-install';
import {
  nativeCapabilitySupportErrors,
  nativeCapabilitySupportFindings,
} from '@/packages/shared/contracts/native-capabilities';

export type ConformanceCheckStatus = 'pass' | 'fail';

export type ConformanceCheckResult = {
  name: string;
  status: ConformanceCheckStatus;
  details: string[];
};

type CanonicalFixture = {
  value: unknown;
  expectedCanonical: string;
  expectedHash: string;
};

type PackageValidationFixture = {
  valid: unknown;
  invalid: {
    value: unknown;
    expectedFailure: string;
  };
};

type ExpressionFixture = {
  budget: ExpressionBudget & {
    maxNodes: number;
    maxDepth: number;
    maxRows: number;
    maxOperations: number;
  };
  expressionCases: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    expected: unknown;
  }>;
  recurrenceNextCases?: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    expected: Record<string, unknown>;
  }>;
  recurrenceExpandCases?: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    expected: Record<string, unknown>;
  }>;
  expressionErrorCases?: Array<{
    id: string;
    input: unknown;
    expression: unknown;
    budget?: Partial<ExpressionBudget>;
    validate?: boolean;
    expectedError: string;
  }>;
  queryCases: Array<{
    id: string;
    rows: Array<Record<string, unknown>>;
    spec: Record<string, unknown>;
    expectedRows: Array<Record<string, unknown>>;
  }>;
  computedFieldCases?: Array<{
    id: string;
    record: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
    queries: Record<string, unknown>;
    specs: Array<Record<string, unknown>>;
    expected: {
      order: string[];
      values: Record<string, unknown>;
    };
  }>;
};

type LifecycleFixture = {
  installationId: string;
  workspaceId: string;
  actor: string;
  source: {
    baseline: string;
    upgrade: string;
    nowBaseline: string;
    nowUpgrade: string;
  };
  baselinePackage: unknown;
  upgradePackage: unknown;
};

type CapabilityDenialFixture = {
  capability: {
    schemaVersion: 'wonder.app-package-native-capabilities.v1';
    platform: string;
    packages: string[];
    permissions: Array<
      | string
      | {
          id: string;
          platform: string;
          permission: string;
          reason: string;
          required: boolean;
        }
    >;
  };
  targetPlatforms?: string[];
  expectedErrors: string[];
};

const DEFAULT_FIXTURE_DIR = resolve(process.cwd(), 'tests/conformance/fixtures');

function readFixture<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function pass(name: string): ConformanceCheckResult {
  return { name, status: 'pass', details: ['PASS'] };
}

function fail(name: string, details: string[]): ConformanceCheckResult {
  return { name, status: 'fail', details };
}

function withTargetPlatforms(platforms?: string[]): { targetPlatforms?: Array<'web' | 'android' | 'ios' | 'macos'> } {
  if (!platforms?.length) return {};
  const supported = platforms.filter(
    (platform): platform is 'web' | 'android' | 'ios' | 'macos' => (
      platform === 'web' || platform === 'android' || platform === 'ios' || platform === 'macos'
    ),
  );
  if (!supported.length) return {};
  return { targetPlatforms: supported };
}

export async function runCrossRuntimeConformanceSuite(
  fixtureDir = DEFAULT_FIXTURE_DIR,
): Promise<ConformanceCheckResult[]> {
  return [
    runCanonicalFixture(readFixture<CanonicalFixture>(resolve(fixtureDir, 'canonical.json'))),
    runPackageValidationFixture(readFixture<PackageValidationFixture>(resolve(fixtureDir, 'package-validation.json'))),
    runExpressionCorpus(readFixture<ExpressionFixture>(resolve(fixtureDir, 'expression-corpus.json'))),
    runInstallLifecycleFixture(readFixture<LifecycleFixture>(resolve(fixtureDir, 'app-lifecycle.json'))),
    runCapabilityDenialFixture(readFixture<CapabilityDenialFixture>(resolve(fixtureDir, 'capability-denial.json'))),
  ];
}

function runCanonicalFixture(fixture: CanonicalFixture): ConformanceCheckResult {
  const errors: string[] = [];
  const canonical = canonicalJson(fixture.value);
  const hash = sha256Canonical(fixture.value);

  if (canonical !== fixture.expectedCanonical) {
    errors.push(`canonical JSON mismatch\n  expected: ${fixture.expectedCanonical}\n  actual: ${canonical}`);
  }
  if (hash !== fixture.expectedHash) {
    errors.push(`canonical hash mismatch\n  expected: ${fixture.expectedHash}\n  actual: ${hash}`);
  }

  return errors.length ? fail('canonical-json deterministic', errors) : pass('canonical-json deterministic');
}

function runPackageValidationFixture(fixture: PackageValidationFixture): ConformanceCheckResult {
  const errors: string[] = [];
  const validIssues = collectAppPackageValidationIssues(fixture.valid);
  const validArtifact = validateArtifact({ value: fixture.valid });

  if (validIssues.length || !validArtifact.ok) {
    errors.push(`valid fixture failed shared validation: ${JSON.stringify(validIssues.map((issue) => issue.message))}`);
  }

  const invalidIssues = collectAppPackageValidationIssues(fixture.invalid.value);
  if (invalidIssues.length === 0) {
    errors.push('invalid fixture was accepted by shared category check');
  }

  const invalidArtifact = validateArtifact({ value: fixture.invalid.value });
  if (invalidArtifact.ok) {
    errors.push('invalid fixture passed artifact validation');
  }

  const artifactCategories = collectArtifactValidationCategories({ value: fixture.invalid.value });
  const sharedMessages = invalidIssues.map((issue) => issue.message);
  if (!sharedMessages.some((message) => message.includes(fixture.invalid.expectedFailure))) {
    errors.push(`invalid fixture message mismatch: expected ${fixture.invalid.expectedFailure}`);
  }
  if (artifactCategories.length === 0) {
    errors.push('invalid fixture produced no artifact category hints');
  }

  return errors.length ? fail('package-validation shared rules', errors) : pass('package-validation shared rules');
}

function runExpressionCorpus(fixture: ExpressionFixture): ConformanceCheckResult {
  const errors: string[] = [];

  for (const item of fixture.expressionCases) {
    const shared = evaluateSharedExpression(item.input, item.expression as never, fixture.budget);
    if (JSON.stringify(shared) !== JSON.stringify(item.expected)) {
      errors.push(`expression mismatch ${item.id}`);
    }
  }

  for (const item of fixture.recurrenceNextCases ?? []) {
    const shared = evaluateSharedExpression(item.input, item.expression as never, fixture.budget);
    if (JSON.stringify(shared) !== JSON.stringify(item.expected)) {
      errors.push(`recurrence_next mismatch ${item.id}`);
    }
    if (!matchesExpectedShape(shared, item.expected)) {
      errors.push(`recurrence_next baseline mismatch ${item.id}`);
    }
  }

  for (const item of fixture.recurrenceExpandCases ?? []) {
    const shared = evaluateSharedExpression(item.input, item.expression as never, fixture.budget);
    if (!matchesExpectedShape(shared, item.expected)) {
      errors.push(`recurrence_expand baseline mismatch ${item.id}`);
    }
  }

  for (const item of fixture.expressionErrorCases ?? []) {
    const effectiveBudget = { ...fixture.budget, ...(item.budget ?? {}) };

    if (item.validate) {
      try {
        validateSharedExpressionBudget(item.expression as never, effectiveBudget);
        errors.push(`shared validator did not throw for ${item.id}`);
      } catch (error) {
        if (!String(error).includes(item.expectedError)) {
          errors.push(`shared validator error mismatch ${item.id}: expected ${item.expectedError}`);
        }
      }
    }

    let sharedThrown = false;
    try {
      evaluateSharedExpression(item.input, item.expression as never, effectiveBudget);
    } catch (error) {
      sharedThrown = true;
      if (!String(error).includes(item.expectedError)) {
        errors.push(`shared evaluator error mismatch ${item.id}: ${item.expectedError}`);
      }
    }
    if (!sharedThrown) {
      errors.push(`shared evaluator did not throw for ${item.id}`);
    }
  }

  for (const item of fixture.queryCases) {
    const shared = executeSharedQuery(item.rows, item.spec as never);
    if (JSON.stringify(shared.rows) !== JSON.stringify(item.expectedRows)) {
      errors.push(`query baseline mismatch ${item.id}`);
    }
  }

  for (const item of fixture.computedFieldCases ?? []) {
    const computedInput = {
      record: item.record,
      rows: item.rows,
      queries: item.queries as never,
      specs: item.specs as never,
      budget: {
        maxExpressionNodes: fixture.budget.maxNodes,
        maxExpressionDepth: fixture.budget.maxDepth,
        maxExpressionRows: fixture.budget.maxRows,
        maxExpressionOperations: fixture.budget.maxOperations,
      },
    };
    const shared = evaluateSharedComputedFields(computedInput);

    if (JSON.stringify(shared.values) !== JSON.stringify(item.expected.values)) {
      errors.push(`computed baseline mismatch ${item.id}`);
    }
    if (shared.order.length === 0 && item.expected.order.length > 0) {
      errors.push(`computed order missing ${item.id}`);
    }
    if (!matchesExpectedShape(shared.values, item.expected.values)) {
      errors.push(`computed values shape mismatch ${item.id}`);
    }
  }

  return errors.length ? fail('expression-runtime parity', errors) : pass('expression-runtime parity');
}

function matchesExpectedShape(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((entry, index) => matchesExpectedShape(actual[index], entry));
  }
  if (Array.isArray(actual)) return false;
  return Object.entries(expected as Record<string, unknown>)
    .every(([key, value]) => matchesExpectedShape((actual as Record<string, unknown>)[key], value));
}

type InstallRecord = {
  installationId: string;
  workspaceId: string;
  packageId: string;
  packageVersion: string;
  packagePreview: PackageInstallPreview;
  packageChecksum: string;
  label: string;
  sourceUrl: string;
  actor: string;
  installedAt: string;
  updatedAt: string;
};

function runInstallLifecycleFixture(fixture: LifecycleFixture): ConformanceCheckResult {
  const details: string[] = [];
  const stack: InstallRecord[] = [];

  try {
    const baselinePreview = buildPackageInstallPreview(fixture.baselinePackage, {
      sourceUrl: fixture.source.baseline,
    }) as PackageInstallPreview;
    if (baselinePreview.status !== 'ready_for_review') {
      details.push(`baseline preview blocked: ${baselinePreview.validationErrors.join('; ')}`);
    }
    const baselineApproval = buildPackageInstallApprovalReceipt(baselinePreview, fixture.actor, fixture.source.nowBaseline);

    const baselineRecord: InstallRecord = {
      installationId: fixture.installationId,
      workspaceId: fixture.workspaceId,
      packageId: fixture.baselinePackage ? ((fixture.baselinePackage as { id?: string }).id ?? 'missing-id') : 'missing-id',
      packageVersion: fixture.baselinePackage ? ((fixture.baselinePackage as { version?: string }).version ?? 'missing-version') : 'missing-version',
      packagePreview: baselinePreview,
      packageChecksum: baselineApproval.checksum,
      label: baselineApproval.packageId,
      sourceUrl: fixture.source.baseline,
      actor: fixture.actor,
      installedAt: fixture.source.nowBaseline,
      updatedAt: fixture.source.nowBaseline,
    };
    stack.push(baselineRecord);

    const activeAfterInstall = stack[stack.length - 1];
    if (activeAfterInstall.packageId !== baselineRecord.packageId || activeAfterInstall.packageVersion !== baselineRecord.packageVersion) {
      details.push(`install did not activate ${baselineRecord.packageId}@${baselineRecord.packageVersion}`);
    }

    const upgradePreview = buildPackageInstallPreview(fixture.upgradePackage, {
      sourceUrl: fixture.source.upgrade,
    }) as PackageInstallPreview;
    if (upgradePreview.status !== 'ready_for_review') {
      details.push(`upgrade preview blocked: ${upgradePreview.validationErrors.join('; ')}`);
    }

    const upgradeApproval = buildPackageInstallApprovalReceipt(upgradePreview, fixture.actor, fixture.source.nowUpgrade);
    const upgradeRecord: InstallRecord = {
      installationId: fixture.installationId,
      workspaceId: fixture.workspaceId,
      packageId: fixture.upgradePackage ? ((fixture.upgradePackage as { id?: string }).id ?? 'missing-id') : 'missing-id',
      packageVersion: fixture.upgradePackage ? ((fixture.upgradePackage as { version?: string }).version ?? 'missing-version') : 'missing-version',
      packagePreview: upgradePreview,
      packageChecksum: upgradeApproval.checksum,
      label: upgradeApproval.packageId,
      sourceUrl: fixture.source.upgrade,
      actor: fixture.actor,
      installedAt: fixture.source.nowBaseline,
      updatedAt: fixture.source.nowUpgrade,
    };

    stack.push(upgradeRecord);
    const activeAfterUpgrade = stack[stack.length - 1];
    if (activeAfterUpgrade.packageVersion !== upgradeRecord.packageVersion) {
      details.push(`upgrade did not activate ${upgradeRecord.packageId}@${upgradeRecord.packageVersion}`);
    }

    const rolledBack = stack.pop();
    if (!rolledBack || rolledBack.packageId !== baselineRecord.packageId) {
      details.push('rollback did not restore baseline package id');
    }

    const activeAfterRollback = stack[stack.length - 1];
    if (!activeAfterRollback || activeAfterRollback.packageVersion !== baselineRecord.packageVersion) {
      details.push('rollback did not restore baseline package version');
    }

    const installation = activeAfterRollback;
    if (!installation) {
      details.push(`installation missing after lifecycle run: ${fixture.installationId}`);
    }

    if (installation) {
      if (installation.label.length === 0) {
        details.push('installation payload missing expected app name');
      }
      if (installation.packageId !== baselineRecord.packageId) {
        details.push('installation payload missing expected package id after rollback');
      }
      if (installation.sourceUrl !== fixture.source.baseline) {
        details.push('installation sourceUrl changed after rollback');
      }
    }

    if (details.length === 0 && baselineApproval.packageId !== upgradeApproval.packageId) {
      details.push('approval payload package id mismatch');
    }
  } catch (error) {
    details.push(`install/update lifecycle error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return details.length ? fail('install/update lifecycle', details) : pass('install/update lifecycle');
}

function runCapabilityDenialFixture(fixture: CapabilityDenialFixture): ConformanceCheckResult {
  const details: string[] = [];
  const platforms = withTargetPlatforms(fixture.targetPlatforms);
  const errors = nativeCapabilitySupportErrors(fixture.capability as never, platforms);
  const findings = nativeCapabilitySupportFindings(fixture.capability as never, platforms);

  for (const expected of fixture.expectedErrors) {
    if (!errors.includes(expected)) {
      details.push(`expected denial not present: ${expected}`);
    }
  }
  if (errors.length === 0) {
    details.push('no capability denial errors produced');
  }
  if (findings.length === 0) {
    details.push('no capability denial findings produced');
  }

  return details.length ? fail('capability denial contract', details) : pass('capability denial contract');
}

export function compareConformanceSuites(
  nodeResults: Array<{ name: string; status: string; details: string[] }>,
  browserResults: Array<{ name: string; status: string; details: string[] }>,
): string[] {
  const failures: string[] = [];
  const browserByName = new Map(browserResults.map((check) => [check.name, check]));

  for (const nodeCheck of nodeResults) {
    const browserCheck = browserByName.get(nodeCheck.name);
    if (!browserCheck) {
      continue;
    }

    const nodeStatus = nodeCheck.status;
    const browserStatus = browserCheck.status;
    if (nodeStatus === 'blocked' || browserStatus === 'blocked') {
      continue;
    }

    if (nodeStatus === 'fail' && browserStatus === 'pass') {
      failures.push(`browser path passed but node failed: ${nodeCheck.name}`);
      continue;
    }

    if (nodeStatus === 'pass' && browserStatus === 'fail') {
      failures.push(`browser path failed while node passed: ${nodeCheck.name}`);
      continue;
    }

    if (nodeStatus === 'fail' && browserStatus === 'fail') {
      failures.push(`shared corpus regression on ${nodeCheck.name}`);
    }
  }

  return failures;
}
