#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const evidenceDir = path.join(root, 'app', 'build', 'evidence', 'launch-readiness');
mkdirSync(evidenceDir, { recursive: true });
const privacyPolicyUrlEnv = process.env.UTOPIA_PRIVACY_POLICY_URL?.trim();
const blockers = [];
const releaseBlockers = [];
const releaseBlockerActions = {};

function parseJsonOrNull(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isLikelyUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseTomlVar(rawText, sectionName, key) {
  const sectionHeader = `[${sectionName}]`;
  const start = rawText.indexOf(sectionHeader);
  if (start === -1) return undefined;

  const sectionBody = rawText.slice(start + sectionHeader.length);
  const nextSection = sectionBody.search(/^\[[^\r\n]+\]/m);
  const currentSection = nextSection === -1 ? sectionBody : sectionBody.slice(0, nextSection);

  const line = currentSection.split('\n').find((candidate) => candidate.startsWith(`${key} =`));
  if (!line) return undefined;

  const match = line.match(/=\s*"([^"]*)"/);
  return match ? match[1].trim() : undefined;
}

function isPlaceholderToken(value) {
  if (!value) return true;
  if (value.startsWith('REPLACE_WITH_')) return true;
  return value === 'TEAMID.app.utopia';
}

function isSignedReleaseProofReady() {
  const artifactsPath = path.join(root, 'app', 'build', 'evidence', 'android-release-artifacts.json');
  const receiptPath = path.join(root, 'app', 'build', 'evidence', 'android-release-build-receipt.json');
  const artifacts = parseJsonOrNull(artifactsPath);
  const receipt = parseJsonOrNull(receiptPath);

  const hasArtifacts = Boolean(artifacts && artifacts.status === 'passed' && artifacts.apk && artifacts.aab);
  const hasReceipt = Boolean(receipt && receipt.status === 'passed' && receipt.proof === 'utopia_android_release_build_receipt');
  return {
    hasArtifacts,
    hasReceipt,
    artifactsPath: 'app/build/evidence/android-release-artifacts.json',
    receiptPath: 'app/build/evidence/android-release-build-receipt.json',
  };
}

const requiredFiles = [
  'cloudflare/utopia-registry-worker.ts',
  'cloudflare/wrangler.toml',
  'cloudflare/README.md',
  'docs/store-policy-remote-packages.md',
  'docs/cloudflare-registry-launch.md',
  'docs/custom-gpt-utopia-builder.md',
  'docs/custom-gpt-action.openapi.yaml',
  'docs/telemetry-and-privacy-contract.md',
  'docs/play-store-launch-readiness.md',
  'agents/utopia-package-builder/SKILL.md',
  '.github/actions/publish-utopia-package/action.yml',
  'scripts/registry/publish-package.mjs',
  'packages/shared/contracts/telemetry.ts',
  'tests/contracts/telemetry.test.ts',
  'tests/platform/registry-worker.test.ts',
  'app.json',
  'docs/launch-readiness.md',
];

const failures = [];
const requiredFileStatus = {};
for (const file of requiredFiles) {
  const exists = existsSync(path.join(root, file));
  requiredFileStatus[file] = exists;
  if (!exists) failures.push(`missing:${file}`);
}

const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const extractSectionBullets = (markdown, heading) => {
  const header = `## ${heading}`;
  const start = markdown.indexOf(header);
  if (start === -1) return [];
  const rest = markdown.slice(start + header.length);
  const next = rest.indexOf('\n## ');
  const sectionBody = next === -1 ? rest : rest.slice(0, next);
  return sectionBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
};

const launchReadinessText = requiredFileStatus['docs/launch-readiness.md']
  ? readText('docs/launch-readiness.md')
  : '';
const launchReadinessReadyNow = extractSectionBullets(launchReadinessText, 'Ready Now');
const launchReadinessParked = extractSectionBullets(launchReadinessText, 'Parked For Later');
if (!launchReadinessText.includes('## Not Launching Today')) {
  failures.push('launch_readiness_inventory_missing:Not Launching Today');
}

const actionSpec = requiredFileStatus['docs/custom-gpt-action.openapi.yaml']
  ? readText('docs/custom-gpt-action.openapi.yaml')
  : '';
const builderDoc = requiredFileStatus['docs/custom-gpt-utopia-builder.md']
  ? readText('docs/custom-gpt-utopia-builder.md')
  : '';
const builderSkill = requiredFileStatus['agents/utopia-package-builder/SKILL.md']
  ? readText('agents/utopia-package-builder/SKILL.md')
  : '';

if (!actionSpec.includes('/v1/packages') || !actionSpec.includes('publishUtopiaPackage')) {
  failures.push('custom_gpt_action_missing_publish_contract');
}
if (!actionSpec.includes('package_url') || !actionSpec.includes('install_url')) {
  failures.push('custom_gpt_action_missing_publish_response_fields');
}
if (!builderDoc.includes('Use `docs/custom-gpt-action.openapi.yaml`.')) {
  failures.push('custom_gpt_builder_missing_action_reference');
}
if (!builderSkill.includes('Use this skill when a user wants a Utopia app package they can open in the Utopia app.')) {
  failures.push('builder_skill_scope_drift');
}

const externalGenerationSurface = {
  customGptOpenApi: requiredFileStatus['docs/custom-gpt-action.openapi.yaml'],
  customGptDocs: requiredFileStatus['docs/custom-gpt-utopia-builder.md'],
  builderSkill: requiredFileStatus['agents/utopia-package-builder/SKILL.md'],
  publishWorkflow: requiredFileStatus['.github/actions/publish-utopia-package/action.yml'],
  packagePublisherScript: requiredFileStatus['scripts/registry/publish-package.mjs'],
};

const expectedParked = [
  { id: 'github_pages_builder', keyword: 'github pages static builder' },
  { id: 'drag_drop_builder', keyword: 'drag/drop builder' },
  { id: 'public_marketplace', keyword: 'public package marketplace browsing' },
  { id: 'reviews_ratings', keyword: 'reviews/ratings' },
  { id: 'accounts', keyword: 'accounts' },
  { id: 'donations', keyword: 'donations' },
  { id: 'hosted_sync_commercialization', keyword: 'hosted sync commercialization' },
];

const parkedSurface = Object.fromEntries(
  expectedParked.map((item) => {
    const listed = launchReadinessParked.some((line) => line.toLowerCase().includes(item.keyword));
    if (!listed) failures.push(`launch_readiness_parked_missing:${item.id}`);
    return [item.id, listed];
  }),
);

const appJson = requiredFileStatus['app.json'] ? readFileSync(path.join(root, 'app.json'), 'utf8') : '{}';
const appConfig = (() => {
  try {
    return JSON.parse(appJson);
  } catch {
    failures.push('app_json_invalid');
    return {};
  }
})();
const host = 'utoia.thetechcruise.com';
const androidFilters = appConfig.expo?.android?.intentFilters ?? [];
const iosDomains = appConfig.expo?.ios?.associatedDomains ?? [];
if (!androidFilters.some((filter) =>
  filter.action === 'VIEW'
  && filter.autoVerify === true
  && (filter.data ?? []).some((data) => data.scheme === 'https' && data.host === host && data.pathPrefix === '/install')
)) {
  failures.push('android_app_link_filter_missing');
}
if (!iosDomains.includes(`applinks:${host}`)) failures.push('ios_associated_domain_missing');

if (requiredFileStatus['packages/shared/contracts/telemetry.ts']) {
  const telemetry = readText('packages/shared/contracts/telemetry.ts');
  for (const forbidden of ['prompt', 'apiKey', 'records', 'audio', 'health', 'contacts', 'location']) {
    if (!telemetry.includes(forbidden)) failures.push(`telemetry_forbidden_marker_missing:${forbidden}`);
  }
}

if (requiredFileStatus['cloudflare/wrangler.toml']) {
  const wrangler = readText('cloudflare/wrangler.toml');
  for (const marker of ['utoia.thetechcruise.com', 'PACKAGES', 'TELEMETRY']) {
    if (!wrangler.includes(marker)) failures.push(`wrangler_marker_missing:${marker}`);
  }
  const iosAppId = parseTomlVar(wrangler, 'vars', 'IOS_APP_ID');
  const iosAppIdStaging = parseTomlVar(wrangler, 'env.staging.vars', 'IOS_APP_ID');
  const androidFingerprint = parseTomlVar(wrangler, 'vars', 'ANDROID_SHA256_CERT_FINGERPRINT');
  const androidFingerprintStaging = parseTomlVar(wrangler, 'env.staging.vars', 'ANDROID_SHA256_CERT_FINGERPRINT');

  if (isPlaceholderToken(iosAppId)) {
    failures.push('release_blocker:ios_team_id_missing');
    releaseBlockers.push('ios_team_id_missing');
    releaseBlockerActions.ios_team_id_missing = [
      'Set [vars].IOS_APP_ID in cloudflare/wrangler.toml.',
      'Use your Apple App ID in TEAMID.app.ID format, e.g. "TEAMID.app.utopia".',
      'Use REPLACE_WITH_YOUR_IOS_TEAM_ID.app.utopia until the real value is ready.',
    ];
  }
  if (isPlaceholderToken(iosAppIdStaging)) {
    failures.push('release_blocker:ios_team_id_missing_in_staging');
    releaseBlockers.push('ios_team_id_missing_in_staging');
    releaseBlockerActions.ios_team_id_missing_in_staging = [
      'Set [env.staging.vars].IOS_APP_ID in cloudflare/wrangler.toml before staging launch checks run.',
      'Do not leave REPLACE_WITH_YOUR_IOS_TEAM_ID.app.utopia in staging.',
    ];
  }
  if (isPlaceholderToken(androidFingerprint)) {
    failures.push('release_blocker:android_fingerprint_missing');
    releaseBlockers.push('android_fingerprint_missing');
    releaseBlockerActions.android_fingerprint_missing = [
      'Set [vars].ANDROID_SHA256_CERT_FINGERPRINT in cloudflare/wrangler.toml.',
      'Copy the full uppercase SHA-256 fingerprint from the release cert used in play signing.',
    ];
  }
  if (isPlaceholderToken(androidFingerprintStaging)) {
    failures.push('release_blocker:android_fingerprint_missing_in_staging');
    releaseBlockers.push('android_fingerprint_missing_in_staging');
    releaseBlockerActions.android_fingerprint_missing_in_staging = [
      'Set [env.staging.vars].ANDROID_SHA256_CERT_FINGERPRINT in cloudflare/wrangler.toml.',
      'Keep staging and prod fingerprints explicit when staging proof checks run.',
    ];
  }
}

const launchReadinessInventory = {
  readyNowCount: launchReadinessReadyNow.length,
  parkedCount: launchReadinessParked.length,
  implementedSurfaceCount: Object.values(externalGenerationSurface).filter(Boolean).length,
};

if (!requiredFileStatus['cloudflare/utopia-registry-worker.ts']) {
  blockers.push('registry_worker_not_found');
}
if (!requiredFileStatus['docs/cloudflare-registry-launch.md']) {
  blockers.push('registry_deploy_runbook_missing');
}

const privacyUrl = (() => {
  const explicit = typeof appConfig.expo?.privacyPolicy === 'string' ? appConfig.expo.privacyPolicy.trim() : '';
  if (explicit) return explicit;
  if (privacyPolicyUrlEnv) return privacyPolicyUrlEnv;
  return '';
})();

if (!privacyUrl) {
  failures.push('release_blocker:privacy_policy_url_missing');
  releaseBlockers.push('privacy_policy_url_missing');
  releaseBlockerActions.privacy_policy_url_missing = [
    'Set expo.privacyPolicy in app.json (preferred), or UTOPIA_PRIVACY_POLICY_URL in environment.',
    'Use a HTTPS URL that is public and resolvable by store review.',
  ];
} else if (!isLikelyUrl(privacyUrl)) {
  failures.push('release_blocker:privacy_policy_url_invalid');
  releaseBlockers.push('privacy_policy_url_invalid');
  releaseBlockerActions.privacy_policy_url_invalid = [
    'Set expo.privacyPolicy in app.json, or UTOPIA_PRIVACY_POLICY_URL, to a valid URL.',
    `Current value is "${privacyUrl}".`,
  ];
}

const signedReleaseProof = isSignedReleaseProofReady();
if (!signedReleaseProof.hasArtifacts || !signedReleaseProof.hasReceipt) {
  failures.push('release_blocker:signed_android_release_proof_missing_or_invalid');
  releaseBlockers.push('signed_android_release_proof_missing_or_invalid');
  releaseBlockerActions.signed_android_release_proof_missing_or_invalid = [
    `Run: BUILD_RELEASE_ARTIFACTS=1 npm run release:proof:signed-android`,
    `Publish proof evidence files must exist and pass: ${signedReleaseProof.artifactsPath} + ${signedReleaseProof.receiptPath}.`,
  ];
}

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'failed' : 'passed',
  host,
  failures,
  releaseBlockers: [...new Set([...blockers, ...releaseBlockers])],
  releaseBlockerActions,
  checkedFiles: requiredFiles,
  fileExists: requiredFileStatus,
  externalGenerationSurface,
  launchReadiness: {
    readyNow: launchReadinessReadyNow,
    parked: launchReadinessParked,
    parkedSurface,
  },
  inventory: launchReadinessInventory,
};
writeFileSync(path.join(evidenceDir, 'launch-readiness.json'), JSON.stringify(result, null, 2));

if (failures.length) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(`launch readiness check PASS; implemented=${launchReadinessInventory.implementedSurfaceCount}/${Object.keys(externalGenerationSurface).length}, blockers=${releaseBlockers.length + blockers.length}`);
