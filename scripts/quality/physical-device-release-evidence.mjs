import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentGit } from './evidence-provenance.mjs';

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function fileHash(path) {
  if (!existsSync(path)) return null;
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

export function buildPhysicalDeviceReleaseEvidence({
  root,
  artifactDir = 'app/build/evidence/physical-device-release',
  packageName = 'app.utopia',
  installStatus = 1,
  device = {},
  checkedAt = new Date().toISOString(),
}) {
  const absoluteArtifactDir = join(root, artifactDir);
  const packageDump = read(join(absoluteArtifactDir, 'package.txt'));
  const installLog = read(join(absoluteArtifactDir, 'install.txt'));
  const launchMain = read(join(absoluteArtifactDir, 'launch-main.txt'));
  const launchInstall = read(join(absoluteArtifactDir, 'launch-install.txt'));
  const uiDump = read(join(absoluteArtifactDir, 'window.xml'));
  const installed = Number(installStatus) === 0
    && (packageDump.includes(`Package [${packageName}]`) || packageDump.includes(`packageName=${packageName}`));
  const launchVerified = launchMain.includes('Status: ok') || launchInstall.includes('Status: ok');
  const basicFlowVerified = ['Install an app', 'Utopia install', 'Registry', 'Installed apps'].some((needle) => uiDump.includes(needle));
  const screenshotPath = join(absoluteArtifactDir, 'install-screen.png');

  return {
    proof: 'utopia_physical_device_release',
    status: installed && launchVerified && basicFlowVerified ? 'passed' : 'blocked',
    checked_at: checkedAt,
    git: currentGit(root),
    device: {
      manufacturer: device.manufacturer || null,
      model: device.model || null,
      sdk: device.sdk || null,
      build_fingerprint_sha256: device.buildFingerprintSha256 || null,
    },
    app: {
      installed,
      launch_verified: launchVerified,
      basic_flow_verified: basicFlowVerified,
      package_name: packageName,
      install_status: Number(installStatus ?? 1),
      install_error: Number(installStatus) === 0 ? null : installLog.trim().slice(0, 500),
    },
    artifacts: {
      adb_devices: `${artifactDir}/adb-devices.txt`,
      package_dump: `${artifactDir}/package.txt`,
      launch_main: `${artifactDir}/launch-main.txt`,
      launch_install: `${artifactDir}/launch-install.txt`,
      ui_dump: `${artifactDir}/window.xml`,
      screenshot: `${artifactDir}/install-screen.png`,
      screenshot_sha256: fileHash(screenshotPath),
    },
    no_device_serial_written: true,
  };
}
