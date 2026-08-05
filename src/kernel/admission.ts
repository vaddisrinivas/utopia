import { z } from 'zod';

import type { AppPackage } from './schema';
import { supportsWidget } from './widget-support';

const normalizeHash = (value: string) => value.trim().toLowerCase().replace(/^sha256:/, '');

const Hash = z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/i).transform((value) => normalizeHash(value));
const Receipt = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  sha256: Hash,
  checkedAt: z.string().datetime(),
  status: z.literal('passed'),
}).strict();
const Artifact = z.object({
  platform: z.enum(['web', 'android', 'ios', 'macos']),
  build: z.object({ path: z.string().min(1), sha256: Hash }).strict(),
  runtime: Receipt.extend({ driver: z.enum(['playwright', 'adb', 'simctl', 'xctest', 'macos-ui']) }),
  screenshot: z.object({ path: z.string().min(1), sha256: Hash }).strict(),
}).strict();

export const AdmissionEvidenceSchema = z.object({
  schemaVersion: z.literal('utopia.admission-evidence.v2'),
  packageId: z.string().min(1),
  version: z.string().min(1),
  packageSha256: Hash,
  author: z.string().min(1),
  reviewer: z.string().min(1),
  artifacts: z.array(Artifact).length(4),
  oracles: z.array(Receipt),
  accessibility: Receipt,
  persistence: Receipt,
  errorPaths: Receipt,
  nativeCapabilities: z.array(Receipt),
}).strict();

export type AdmissionEvidence = z.infer<typeof AdmissionEvidenceSchema>;
export type AdmissionResult = { admitted: boolean; issues: string[] };

const drivers = {
  web: new Set(['playwright']),
  android: new Set(['adb']),
  ios: new Set(['simctl', 'xctest']),
  macos: new Set(['macos-ui', 'xctest']),
};

const forbiddenReviewers = new Set(['builder', 'system', 'ci', 'auto', 'automated', 'self']);

function permissionId(permission: unknown): string | undefined {
  if (typeof permission === 'string') return permission.trim();
  if (permission && typeof permission === 'object') {
    if ('id' in permission && typeof (permission as { id?: unknown }).id === 'string') {
      return String((permission as { id?: unknown }).id).trim();
    }
    if ('permission' in permission && typeof (permission as { permission?: unknown }).permission === 'string') {
      return String((permission as { permission?: unknown }).permission).trim();
    }
  }
  return undefined;
}

export function admission(pkg: AppPackage, raw: unknown): AdmissionResult {
  const parsed = AdmissionEvidenceSchema.safeParse(raw);
  if (!parsed.success) return { admitted: false, issues: parsed.error.issues.map((issue) => issue.message) };
  const evidence = parsed.data;
  const issues: string[] = [];
  if (pkg.catalog.status !== 'active') issues.push('inactive package cannot be admitted');
  if (evidence.packageId !== pkg.id || evidence.version !== pkg.version) issues.push('artifact identity mismatch');
  if (normalizeHash(evidence.packageSha256) !== normalizeHash(pkg.contractLock.checksum)) issues.push('contract checksum mismatch');
  if (evidence.author === evidence.reviewer || forbiddenReviewers.has(evidence.reviewer.trim().toLowerCase())) issues.push('independent reviewer required');

  const platforms = new Set(evidence.artifacts.map((artifact) => artifact.platform));
  for (const platform of ['web', 'android', 'ios', 'macos'] as const) {
    const artifact = evidence.artifacts.find((item) => item.platform === platform);
    if (!artifact) issues.push(`${platform} runtime proof missing`);
    else if (!drivers[platform].has(artifact.runtime.driver)) issues.push(`${platform} proof driver mismatch`);
  }
  if (platforms.size !== evidence.artifacts.length) issues.push('duplicate platform artifact');

  const oracleIds = new Set(evidence.oracles.map((receipt) => receipt.id));
  if (evidence.oracles.length !== oracleIds.size) issues.push('duplicate oracle ids');
  for (const id of pkg.acceptanceTests) if (!oracleIds.has(id)) issues.push(`oracle missing: ${id}`);
  if (!pkg.acceptanceTests.length) issues.push('acceptance tests missing');

  const nativePermissionIds = new Set(
    (pkg.nativeCapabilities.permissions ?? [])
      .map(permissionId)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase()),
  );
  const nativeProofIds = new Set(evidence.nativeCapabilities.map((receipt) => receipt.id.toLowerCase()));
  for (const requiredPermissionId of nativePermissionIds) {
    if (!nativeProofIds.has(requiredPermissionId)) issues.push(`native capability proof missing: ${requiredPermissionId}`);
  }
  for (const nativeProofId of nativeProofIds) {
    if (!nativePermissionIds.has(nativeProofId)) issues.push(`unrequested native capability proof: ${nativeProofId}`);
  }

  const specialProofs = [evidence.accessibility, evidence.persistence, evidence.errorPaths];
  const hasSpecialProofCollision = (values: string[]) => new Set(values).size !== values.length;
  if (
    hasSpecialProofCollision(specialProofs.map((proof) => proof.id))
    || hasSpecialProofCollision(specialProofs.map((proof) => proof.path))
    || hasSpecialProofCollision(specialProofs.map((proof) => normalizeHash(proof.sha256)))
  ) {
    issues.push('proof identity collision');
  }

  for (const [screenId, screen] of Object.entries(pkg.presentation.ui.screens)) {
    if (!screen.components.length) issues.push(`${screenId} is empty`);
    for (const component of screen.components) {
      if (component.kind === 'widget' && !supportsWidget(component.widget)) issues.push(`${screenId}: unsupported widget ${component.widget}`);
    }
  }
  if (!evidence.author || evidence.author.trim().length < 3) issues.push('author id invalid');
  if (!evidence.reviewer || evidence.reviewer.trim().length < 3) issues.push('reviewer id invalid');

  return { admitted: issues.length === 0, issues };
}
