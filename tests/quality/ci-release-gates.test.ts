import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function readText(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('CI and release gate wiring', () => {
  it('keeps the Expo quality workflow truthful and cached', () => {
    const workflow = readText('.github/workflows/expo-quality.yml');
    const appFactoryWorkflow = readText('.github/workflows/generate-utopia-app.yml');

    expect(workflow).toContain('cache: npm');
    expect(workflow).toContain('cache-dependency-path: |');
    expect(workflow).toContain('package-lock.json');
    expect(workflow).toContain('server/package-lock.json');
    expect(workflow).toContain('permissions:');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('- name: Run unit tests');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('npm run config:validate');
    expect(workflow).toContain('npm run typecheck');
    expect(workflow).toContain('npm run export:web');
    expect(workflow).toContain('npm run export:android');
    expect(workflow).not.toContain('continue-on-error: true');

    expect(appFactoryWorkflow).toContain('cache: npm');
    expect(appFactoryWorkflow).toContain('cache-dependency-path: package-lock.json');
  });

  it('runs widget catalog checks before package compiler in dev-fast', () => {
    const devFastGate = readText('scripts/gates/dev-fast.sh');
    const widgetCatalogLine = devFastGate.indexOf('npm run check:widget-catalog');
    const widgetCatalogEnvLine = devFastGate.indexOf('npm run check:widget-catalog-env-assertions');
    const packageCompilerLine = devFastGate.indexOf('npm run check:package-compiler');
    expect(widgetCatalogLine).toBeGreaterThan(-1);
    expect(widgetCatalogEnvLine).toBeGreaterThan(-1);
    expect(packageCompilerLine).toBeGreaterThan(-1);
    expect(widgetCatalogLine).toBeLessThan(packageCompilerLine);
    expect(widgetCatalogEnvLine).toBeLessThan(packageCompilerLine);
    expect(widgetCatalogEnvLine).toBeGreaterThan(widgetCatalogLine);
  });

  it('keeps release export proof separate from signing and device proof', () => {
    const exportGate = readText('scripts/gates/release-proof-exports.sh');
    const signedGate = readText('scripts/gates/release-proof-signed-android.sh');
    const signedArtifactsCheck = readText('scripts/quality/check-android-release-artifacts.sh');
    const deviceGate = readText('scripts/gates/release-proof-physical-device.sh');
    const releaseLocal = readText('scripts/gates/release-local.sh');

    expect(exportGate).toContain('npm test');
    expect(exportGate).toContain('npm run export:web');
    expect(exportGate).toContain('npm run export:android');
    expect(exportGate).toContain('npm run check:ios-export');
    expect(exportGate).toContain('npm run release:proof:cross-platform');
    expect(exportGate).not.toContain('REQUIRE_RELEASE_SIGNING');
    expect(exportGate).not.toContain('physical-device');

    expect(signedGate).toContain('REQUIRE_RELEASE_SIGNING=1');
    expect(signedGate).not.toContain('physical-device');
    expect(signedGate).toContain('android_build_receipt');
    expect(signedGate).toContain('android-release-artifacts.json');
    expect(signedGate).toContain('android-release-build-receipt.json');
    expect(signedGate).toContain('check_android_release_artifacts_script_failed_without_payload');
    expect(signedArtifactsCheck).toContain('BUILD_RELEASE_ARTIFACTS=1 npm run release:proof:signed-android');
    expect(signedArtifactsCheck).toContain('UTOPIA_RELEASE_BUNDLE=1');
    expect(signedArtifactsCheck).toContain('WF_ANDROID_BUILD_COMMAND="UTOPIA_RELEASE_BUNDLE=1 android/gradlew :app:assembleRelease :app:bundleRelease"');

    expect(deviceGate).toContain('physical_device_evidence_missing');
    expect(deviceGate).toContain('validatePhysicalDeviceReleaseEvidence');
    expect(deviceGate).toContain('REQUIRE_RELEASE_SIGNING=1');
    expect(deviceGate).toContain('required_device_mode: real physical device only');
    expect(deviceGate).toContain('freshness_rule');
    expect(deviceGate).toContain('PHYSICAL_DEVICE_PROOF_MAX_AGE_HOURS');
    expect(deviceGate).toContain('not older than linked android artifact evidence checked_at');

    expect(releaseLocal).toContain('npm test');
  });
});
