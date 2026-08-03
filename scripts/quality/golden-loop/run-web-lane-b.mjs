#!/usr/bin/env node

import { isAbsolute, join, resolve } from 'node:path';
import { runWebGoldenLoopExecution } from './web-execution-receipt.mjs';

const ROOT = process.cwd();

export function resolveWebLaneBReceiptPath(env = process.env, root = ROOT) {
  const requestedPath = env.UTOPIA_WEB_LANE_B_RECEIPT_PATH
    || env.UTOPIA_WEB_GOLDEN_LOOP_EXECUTION_RECEIPT_PATH;
  return requestedPath
    ? (isAbsolute(requestedPath) ? requestedPath : resolve(root, requestedPath))
    : resolve(root, 'app', 'build', 'evidence', 'golden-loop', 'web-execution-receipt.json');
}

export function buildWebLaneBEnvironment(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides.env,
    UTOPIA_GOLDEN_LOOP_RUN_ID: overrides.env?.UTOPIA_GOLDEN_LOOP_RUN_ID
      || process.env.UTOPIA_GOLDEN_LOOP_RUN_ID
      || process.env.GOLDEN_LOOP_RUN_ID
      || overrides.env?.GOLDEN_LOOP_RUN_ID,
    UTOPIA_WEB_GOLDEN_LOOP_EXECUTION_RECEIPT_PATH: resolveWebLaneBReceiptPath(
      {
        ...process.env,
        ...overrides.env,
      },
      overrides.root || ROOT,
    ),
  };

  if (overrides.requireBridge || env.UTOPIA_WEB_LANE_B_REQUIRE_BRIDGE === '1') {
    env.UTOPIA_WEB_GOLDEN_LOOP_DEBUG_BRIDGE = '1';
    env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG = '1';
    const debugToken = env.UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN || env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN;
    if (debugToken) {
      env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN = debugToken;
      env.UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN = debugToken;
    }
  }

  return env;
}

export async function runWebLaneB(overrides = {}) {
  const env = buildWebLaneBEnvironment(overrides);
  const applied = Object.entries(env);

  const previous = new Map();
  for (const [key, value] of applied) {
    if (value == null || value === '') {
      previous.set(key, process.env[key] ?? null);
      delete process.env[key];
      continue;
    }
    previous.set(key, process.env[key] ?? null);
    process.env[key] = value;
  }

  try {
    const receipt = await runWebGoldenLoopExecution();
    if (receipt.status !== 'PASS') {
      console.error(`BLOCKED ${receipt.status_reason || 'web lane b proof is blocked'}`);
      process.exitCode = 1;
    }
    return receipt;
  } finally {
    for (const [key, value] of previous) {
      if (value === null || typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebLaneB().catch((error) => {
    console.error(`web-lane-b failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
