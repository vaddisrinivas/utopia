#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence');
const evidencePath = join(evidenceDir, 'cross-platform-behavior-parity.json');
const issues = [];

mkdirSync(evidenceDir, { recursive: true });

const appJson = readJson('app.json');
const expo = appJson.expo ?? {};
const expectedPlatforms = ['web', 'android', 'ios'];
for (const platform of expectedPlatforms) {
  if (!expo.platforms?.includes(platform)) issues.push(`app_json_missing_platform:${platform}`);
}
if (expo.scheme !== 'utopia') issues.push('scheme_mismatch');
if (expo.android?.package !== 'app.utopia') issues.push('android_package_mismatch');
if (expo.ios?.bundleIdentifier !== 'app.utopia') issues.push('ios_bundle_identifier_mismatch');

const routeSources = [
  'app/(tabs)/index.tsx',
  'app/install.tsx',
  'app/apps/[installationId].tsx',
  'src/domain/package-install.ts',
  'src/db/app-package-registry.ts',
  'src/presentation/json-render-surface.tsx',
  'src/presentation/json-render-widgets.tsx',
];
for (const source of routeSources) {
  if (!existsSync(join(root, source))) issues.push(`route_source_missing:${source}`);
}

const webIndex = artifact('dist/web/index.html');
const androidMetadata = metadataArtifact('dist/android/metadata.json', 'android');
const iosMetadata = metadataArtifact('dist/ios/metadata.json', 'ios');

const bundleArtifacts = {
  web: webIndex,
  android: androidMetadata,
  ios: iosMetadata,
};
for (const [platform, artifactValue] of Object.entries(bundleArtifacts)) {
  if (!artifactValue) issues.push(`export_missing:${platform}`);
}

const evidence = {
  proof: 'utopia_cross_platform_behavior_parity',
  status: issues.length ? 'blocked' : 'passed',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  app_identity: {
    name: expo.name,
    version: expo.version,
    scheme: expo.scheme,
    android_package: expo.android?.package,
    ios_bundle_identifier: expo.ios?.bundleIdentifier,
    platforms: expo.platforms ?? [],
  },
  route_sources: routeSources,
  exports: bundleArtifacts,
  claims: {
    same_app_identity: !issues.some((issue) => issue.includes('mismatch') || issue.includes('app_json_missing_platform')),
    install_route_present: existsSync(join(root, 'app/install.tsx')),
    package_runtime_present: existsSync(join(root, 'src/domain/package-install.ts')) && existsSync(join(root, 'src/db/app-package-registry.ts')),
    exported_for_web_android_ios: Boolean(webIndex && androidMetadata && iosMetadata),
    device_behavior_proven: false,
  },
  device_proof_required: 'npm run release:collect:physical-device && npm run release:proof:physical-device',
  issues,
};

writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
if (issues.length) {
  console.error(`cross-platform-behavior-parity: BLOCKED (${issues.join(', ')}; evidence: ${evidencePath})`);
  process.exit(1);
}

console.log(`cross-platform-behavior-parity: PASS (${evidencePath})`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function metadataArtifact(relativePath, platform) {
  const metadataPath = join(root, relativePath);
  if (!existsSync(metadataPath)) return null;
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const platformMetadata = metadata.fileMetadata?.[platform];
  const bundle = platformMetadata?.bundle;
  if (!bundle) return null;
  const bundlePath = join(root, `dist/${platform}`, bundle);
  if (!existsSync(bundlePath)) return null;
  return {
    metadata: artifact(relativePath),
    bundle: artifact(`dist/${platform}/${bundle}`),
    asset_count: Array.isArray(platformMetadata.assets) ? platformMetadata.assets.length : 0,
  };
}

function artifact(relativePath) {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) return null;
  const bytes = statSync(fullPath).size;
  const sha256 = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
  return { path: relativePath, bytes, sha256 };
}
