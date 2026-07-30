import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { canonicalJson, sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { collectAppPackageValidationIssues } from '@/packages/shared/contracts/package';
import { collectArtifactValidationCategories, validateArtifact } from '@/packages/schemas/src';
import { nativeCapabilitySupportErrors, nativeCapabilitySupportFindings } from '@/packages/shared/contracts/native-capabilities';
import {
  evaluateComputedFields as evaluateSharedComputedFields,
  type ComputedFieldResult,
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
  activateApprovedAppPackageUpdate,
  getActiveAppPackage,
  getAppInstallation,
  installApprovedAppPackage,
  previewAppPackageUpdate,
  rollbackAppPackage,
} from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

export type ConformanceCheckStatus = 'pass' | 'fail' | 'blocked';

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
  budget: ExpressionBudget;
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

function blocked(name: string, reason: string): ConformanceCheckResult {
  return { name, status: 'blocked', details: [`BLOCKED: ${reason}`] };
}

function withTargetPlatforms(platforms?: string[]): { targetPlatforms?: Array<'web' | 'android' | 'ios' | 'macos'> } {
  if (!platforms?.length) return {};
  const supported = platforms.filter((platform): platform is 'web' | 'android' | 'ios' | 'macos' => (
    platform === 'web' || platform === 'android' || platform === 'ios' || platform === 'macos'
  ));
  if (!supported.length) return {};
  return { targetPlatforms: supported };
}

async function loadServerPackageValidator() {
  try {
    const module = await import('@/server/src/kernel/package');
    return module.validateAppPackage as (input: unknown) => { valid: boolean; errors?: string[] };
  } catch {
    return null;
  }
}

async function loadServerExpressionRuntime() {
  try {
    const [expressionModule, queryModule, computedFieldsModule] = await Promise.all([
      import('@/server/src/kernel/expression'),
      import('@/server/src/kernel/query'),
      import('@/server/src/kernel/computed-fields'),
    ]);
    return {
      evaluateExpression: expressionModule.evaluateExpression as (
        input: unknown,
        expression: unknown,
        budget?: Partial<ExpressionBudget>,
      ) => unknown,
      validateExpressionBudget: expressionModule.validateExpressionBudget as (expression: unknown, budget?: Partial<ExpressionBudget>) => void,
      executeQuery: queryModule.executeQuery as unknown as (
        rows: Array<Record<string, unknown>>,
        spec: Record<string, unknown>,
      ) => { rows: Array<Record<string, unknown>>; resultHash: string },
      evaluateComputedFields: computedFieldsModule.evaluateComputedFields as unknown as (payload: {
        record: Record<string, unknown>;
        rows: Array<Record<string, unknown>>;
        queries: Record<string, unknown>;
        specs: Array<Record<string, unknown>>;
        budget: {
          maxExpressionNodes: number;
          maxExpressionDepth: number;
          maxExpressionRows: number;
          maxExpressionOperations: number;
        };
      }) => ComputedFieldResult,
    };
  } catch {
    return null;
  }
}

export async function runConformanceSuite(fixtureDir = DEFAULT_FIXTURE_DIR): Promise<ConformanceCheckResult[]> {
  return [
    runCanonicalFixture(readFixture<CanonicalFixture>(resolve(fixtureDir, 'canonical.json'))),
    runPackageValidationFixture(readFixture<PackageValidationFixture>(resolve(fixtureDir, 'package-validation.json'))),
    await runPackageValidationParity(readFixture<PackageValidationFixture>(resolve(fixtureDir, 'package-validation.json'))),
    await runExpressionCorpus(readFixture<ExpressionFixture>(resolve(fixtureDir, 'expression-corpus.json'))),
    await runInstallLifecycleFixture(readFixture<LifecycleFixture>(resolve(fixtureDir, 'app-lifecycle.json'))),
    runCapabilityDenialFixture(readFixture<CapabilityDenialFixture>(resolve(fixtureDir, 'capability-denial.json'))),
    blocked('install-runtime-mobile', 'requires physical-device/runner to execute end-to-end lifecycle evidence'),
    blocked('server-runtime-android-capability', 'not claimed without emulator/device parity evidence'),
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

async function runPackageValidationParity(fixture: PackageValidationFixture): Promise<ConformanceCheckResult> {
  const server = await loadServerPackageValidator();
  if (!server) {
    return blocked('package-validation server parity', 'server module import failed');
  }

  const errors: string[] = [];
  const sharedValid = validateArtifact({ value: fixture.valid }).ok;
  const serverValid = server(fixture.valid).valid;
  if (sharedValid !== serverValid) {
    errors.push(`shared/server valid mismatch for valid fixture (shared=${sharedValid}, server=${serverValid})`);
  }

  const sharedInvalid = validateArtifact({ value: fixture.invalid.value }).ok;
  const serverInvalid = server(fixture.invalid.value).valid;
  if (sharedInvalid !== serverInvalid) {
    errors.push(`shared/server valid mismatch for invalid fixture (shared=${sharedInvalid}, server=${serverInvalid})`);
  }

  return errors.length ? fail('package-validation server parity', errors) : pass('package-validation server parity');
}

async function runExpressionCorpus(fixture: ExpressionFixture): Promise<ConformanceCheckResult> {
  const server = await loadServerExpressionRuntime();
  if (!server) {
    return blocked('expression-runtime parity', 'server runtime module import failed');
  }

  const errors: string[] = [];

  for (const item of fixture.expressionCases) {
    const shared = evaluateSharedExpression(item.input, item.expression as never, fixture.budget);
    const remote = server.evaluateExpression(item.input, item.expression, fixture.budget);
    if (JSON.stringify(shared) !== JSON.stringify(remote)) {
      errors.push(`expression mismatch ${item.id}`);
    }
    if (JSON.stringify(shared) !== JSON.stringify(item.expected)) {
      errors.push(`expression baseline mismatch ${item.id}`);
    }
  }

  for (const item of fixture.recurrenceNextCases ?? []) {
    const shared = evaluateSharedExpression(item.input, item.expression as never, fixture.budget);
    const remote = server.evaluateExpression(item.input, item.expression, fixture.budget);
    if (JSON.stringify(shared) !== JSON.stringify(remote)) {
      errors.push(`recurrence_next mismatch ${item.id}`);
    }
    if (JSON.stringify(shared) !== JSON.stringify(item.expected)) {
      errors.push(`recurrence_next baseline mismatch ${item.id}`);
    }
  }

  for (const item of fixture.recurrenceExpandCases ?? []) {
    const shared = evaluateSharedExpression(item.input, item.expression as never, fixture.budget);
    const remote = server.evaluateExpression(item.input, item.expression, fixture.budget);
    if (JSON.stringify(shared) !== JSON.stringify(remote)) {
      errors.push(`recurrence_expand mismatch ${item.id}`);
    }
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

    let serverThrown = false;
    try {
      server.evaluateExpression(item.input, item.expression, effectiveBudget);
    } catch (error) {
      serverThrown = true;
      if (!String(error).includes(item.expectedError)) {
        errors.push(`server evaluator error mismatch ${item.id}: ${item.expectedError}`);
      }
    }
    if (!serverThrown) {
      errors.push(`server evaluator did not throw for ${item.id}`);
    }
  }

  for (const item of fixture.queryCases) {
    const shared = executeSharedQuery(item.rows, item.spec as never);
    const remote = server.executeQuery(item.rows, item.spec);
    if (JSON.stringify(shared.rows) !== JSON.stringify(remote.rows)) {
      errors.push(`query rows mismatch ${item.id}`);
    }
    if (shared.resultHash !== remote.resultHash) {
      errors.push(`query hash mismatch ${item.id}`);
    }
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
        maxExpressionNodes: fixture.budget.maxNodes ?? 0,
        maxExpressionDepth: fixture.budget.maxDepth ?? 0,
        maxExpressionRows: fixture.budget.maxRows ?? 0,
        maxExpressionOperations: fixture.budget.maxOperations ?? 0,
      },
    };
    const shared = evaluateSharedComputedFields(computedInput);
    const remote = server.evaluateComputedFields(computedInput);

    if (JSON.stringify(shared.order) !== JSON.stringify(remote.order)) {
      errors.push(`computed order mismatch ${item.id}`);
    }
    if (JSON.stringify(shared.values) !== JSON.stringify(remote.values)) {
      errors.push(`computed values mismatch ${item.id}`);
    }
    if (JSON.stringify(shared.values) !== JSON.stringify(item.expected.values)) {
      errors.push(`computed baseline mismatch ${item.id}`);
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

async function runInstallLifecycleFixture(fixture: LifecycleFixture): Promise<ConformanceCheckResult> {
  const db = new NodeSqliteDb();
  const details: string[] = [];

  try {
    await runMigrations(db as never);
    const baselinePackage = fixture.baselinePackage as { id: string; version: string };
    const upgradePackage = fixture.upgradePackage as { id: string; version: string };

    const baselinePreview = buildPackageInstallPreview(fixture.baselinePackage, {
      sourceUrl: fixture.source.baseline,
    }) as PackageInstallPreview;
    if (baselinePreview.status !== 'ready_for_review') {
      details.push(`baseline preview blocked: ${baselinePreview.validationErrors.join('; ')}`);
    }
    const baselineApproval = buildPackageInstallApprovalReceipt(baselinePreview, fixture.actor, fixture.source.nowBaseline);
    await installApprovedAppPackage(db as never, {
      packageJson: fixture.baselinePackage,
      preview: baselinePreview,
      approval: baselineApproval,
      installationId: fixture.installationId,
      workspaceId: fixture.workspaceId,
      now: fixture.source.nowBaseline,
    });

    const activeAfterInstall = await getActiveAppPackage(db as never, fixture.installationId);
    if (!activeAfterInstall || activeAfterInstall.id !== baselinePackage.id || activeAfterInstall.version !== baselinePackage.version) {
      details.push(`install did not activate ${baselinePackage.id}@${baselinePackage.version}`);
    }

    const upgradePreview = buildPackageInstallPreview(fixture.upgradePackage, {
      sourceUrl: fixture.source.upgrade,
    }) as PackageInstallPreview;
    if (upgradePreview.status !== 'ready_for_review') {
      details.push(`upgrade preview blocked: ${upgradePreview.validationErrors.join('; ')}`);
    }
    const updatePreview = await previewAppPackageUpdate(db as never, fixture.installationId, fixture.upgradePackage, upgradePreview);
    if (updatePreview.status !== 'ready_for_review') {
      details.push(`server update preview blocked: ${updatePreview.errors.join('; ')}`);
    }

    const upgradeApproval = buildPackageInstallApprovalReceipt(upgradePreview, fixture.actor, fixture.source.nowUpgrade);
    await activateApprovedAppPackageUpdate(db as never, {
      packageJson: fixture.upgradePackage,
      preview: upgradePreview,
      approval: upgradeApproval,
      installationId: fixture.installationId,
      now: fixture.source.nowUpgrade,
    });

    const activeAfterUpgrade = await getActiveAppPackage(db as never, fixture.installationId);
    if (!activeAfterUpgrade || activeAfterUpgrade.version !== upgradePackage.version) {
      details.push(`upgrade did not activate ${upgradePackage.id}@${upgradePackage.version}`);
    }

    const rolledBack = await rollbackAppPackage(db as never, fixture.installationId);
    if (!rolledBack || rolledBack.version !== baselinePackage.version) {
      details.push('rollback did not restore baseline package version');
    }

    const installation = await getAppInstallation(db as never, fixture.installationId);
    if (!installation) {
      details.push(`installation missing after lifecycle run: ${fixture.installationId}`);
    }

    if (installation) {
      if (typeof installation.label !== 'string' || !installation.label.length) {
        details.push('installation payload missing expected app name');
      }

      if (installation.packageBinding?.packageId !== baselinePackage.id) {
        details.push('installation payload missing expected package id after rollback');
      }
    }
  } catch (error) {
    details.push(`install/update lifecycle error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db.close();
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
