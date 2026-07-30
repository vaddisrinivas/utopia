#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { currentGit } from '../evidence-provenance.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const workspacePath = join(repoRoot, 'macos/macos/UtopiaMac.xcworkspace');
const scheme = process.env.UTOPIA_MACOS_SCHEME || 'UtopiaMac-macOS';
const configuration = process.env.UTOPIA_MACOS_CONFIGURATION || 'Debug';
const derivedDataPath = resolve(repoRoot, process.env.UTOPIA_MACOS_DERIVED_DATA_PATH || 'macos/macos/build');
const outputPath = resolve(repoRoot, process.env.UTOPIA_MACOS_BUILD_RECEIPT_PATH || 'app/build/evidence/macos-build-receipt.json');

const blockers = [];

function walkAppBundles(root) {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const apps = [];
  for (const entry of entries) {
    const path = join(root, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    if (entry.endsWith('.app')) {
      apps.push(path);
      continue;
    }
    if (entry === 'Index.noindex' || entry === 'Build') continue;
    apps.push(...walkAppBundles(path));
  }
  return apps;
}

function findAppBundle() {
  const buildDir = join(derivedDataPath, 'Build', 'Products', configuration);
  const candidates = walkAppBundles(buildDir);
  return candidates.sort()[0] ?? null;
}

function hashDirectory(root) {
  const hash = createHash('sha256');
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) {
      hash.update(relative(repoRoot, current));
      hash.update(readFileSync(current));
      continue;
    }

    const children = readdirSync(current, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const child of children) {
      queue.push(join(current, child));
    }
  }

  return hash.digest('hex');
}

function directoryBytes(root) {
  let bytes = 0;
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) {
      bytes += stats.size;
      continue;
    }
    const children = readdirSync(current, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    for (const child of children) queue.push(join(current, child));
  }

  return bytes;
}

const buildCommand = [
  '-workspace', workspacePath,
  '-scheme', scheme,
  '-configuration', configuration,
  '-derivedDataPath', derivedDataPath,
  'build',
];

let passed = false;
let commandExitCode = 1;
let commandOutput = '';
let commandError = '';
let artifactSha256 = null;
let appPath = null;
let artifactBytes = null;

if (process.platform !== 'darwin') {
  blockers.push('unsupported_platform');
}
if (!existsSync(workspacePath)) {
  blockers.push('missing_macos_workspace');
}

if (blockers.length === 0) {
  const result = spawnSync('xcodebuild', buildCommand, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODE_SIGN_IDENTITY: '',
      CODE_SIGNING_REQUIRED: 'NO',
      CODE_SIGNING_ALLOWED: 'NO',
      CODE_SIGN_STYLE: 'Automatic',
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  commandExitCode = result.status ?? 1;
  commandOutput = String(result.stdout || '');
  commandError = String(result.stderr || '');
  if (result.error) {
    blockers.push(`xcodebuild_failed:${result.error.message}`);
    commandError = `${commandError}\n${result.error.message}`;
  }
  if (commandExitCode === 0) {
    appPath = findAppBundle();
    if (!appPath) {
      blockers.push('missing_macos_bundle');
    } else {
      artifactSha256 = hashDirectory(appPath);
      artifactBytes = directoryBytes(appPath);
      if (!artifactSha256) blockers.push('could_not_hash_app_bundle');
    }
  } else {
    blockers.push(`xcodebuild_exit_${commandExitCode}`);
  }
}

passed = blockers.length === 0;
const status = passed ? 'passed' : 'blocked';

mkdirSync(outputPath.replace(/\/[^/]+$/, ''), { recursive: true });
const receipt = {
  proof: 'utopia_macos_build_receipt',
  status,
  checked_at: new Date().toISOString(),
  git: currentGit(repoRoot),
  pass: passed,
  build_command: `xcodebuild ${buildCommand.join(' ')}`,
  build_exit_code: commandExitCode,
  app_path: appPath ? relative(repoRoot, appPath) : null,
  build_command_parts: buildCommand,
  command_exit_code: commandExitCode,
  command_stdout_tail: commandOutput.slice(-4000),
  command_stderr_tail: commandError.slice(-4000),
  workspace: relative(repoRoot, workspacePath),
  scheme,
  configuration,
  artifact: appPath
    ? {
        path: relative(repoRoot, appPath),
        checksum: artifactSha256 ? `sha256:${artifactSha256}` : null,
        bytes: artifactBytes,
        sha256: artifactSha256,
      }
    : null,
  blockers,
};

writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`utopia_macos_build_receipt: ${status} (${relative(repoRoot, outputPath)})`);
if (blockers.length > 0) console.log(`BLOCKERS=${blockers.join(',')}`);
if (commandOutput) process.stdout.write(commandOutput);
if (commandError) process.stdout.write(commandError);
process.exitCode = status === 'passed' ? 0 : 1;
