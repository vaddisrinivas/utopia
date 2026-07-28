#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { currentGit } from './evidence-provenance.mjs';

const root = process.cwd();
const [apkPathArg, aabPathArg, outputPathArg] = process.argv.slice(2);

function fail(message) {
  console.error(`Android release build receipt: FAIL (${message})`);
  process.exit(1);
}

function artifact(pathArg) {
  if (!pathArg) fail('missing artifact path');
  const absolutePath = resolve(root, pathArg);
  if (!existsSync(absolutePath)) fail(`missing artifact: ${pathArg}`);
  return {
    path: relative(root, absolutePath),
    bytes: statSync(absolutePath).size,
    sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
  };
}

const outputPath = resolve(root, outputPathArg || 'app/build/evidence/android-release-build-receipt.json');
mkdirSync(dirname(outputPath), { recursive: true });

const payload = {
  proof: 'utopia_android_release_build_receipt',
  status: 'passed',
  checked_at: new Date().toISOString(),
  git: currentGit(root),
  build_command: process.env.WF_ANDROID_BUILD_COMMAND || 'android/gradlew :app:assembleRelease :app:bundleRelease',
  artifacts: {
    apk: artifact(apkPathArg),
    aab: artifact(aabPathArg),
  },
};

writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`Android release build receipt: PASS (${relative(root, outputPath)})`);
