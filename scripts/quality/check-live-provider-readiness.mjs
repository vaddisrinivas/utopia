#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence');
const evidencePath = join(evidenceDir, 'live-provider-readiness.json');
mkdirSync(evidenceDir, { recursive: true });

const PROOF_COMMANDS = {
  notion: [
    './scripts/quality/run-notion-live-proof.sh',
    './scripts/quality/run-notion-scenario-proof.sh',
    'npm run check:notion-data-home',
  ],
  sheets: [
    './scripts/quality/run-google-sheets-live-proof.sh',
    './scripts/quality/run-google-sheets-scenario-proof.sh',
    'npm run check:google-sheets-data-home',
  ],
};

const PROVIDER_REQUIREMENTS = {
  notion: [
    { label: 'credential', oneOf: true, names: ['NOTION_TOKEN', 'NOTION_API_KEY'] },
    { label: 'target page', names: ['NOTION_TEST_PAGE_ID'] },
    { label: 'account', oneOf: true, names: ['NOTION_TEST_ACCOUNT_ID', 'NOTION_WORKSPACE_ID'] },
    { label: 'guard key', names: ['WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY'] },
    { label: 'guard ack', oneOf: true, names: ['WONDERFOOD_LIVE_PROVIDER_ACK', 'WONDERFOOD_LIVE_PROVIDER_ACK_NOTION'] },
  ],
  sheets: [
    { label: 'test spreadsheet', names: ['GOOGLE_SHEETS_TEST_SPREADSHEET_ID'] },
    { label: 'account', oneOf: true, names: ['GOOGLE_SHEETS_TEST_ACCOUNT_ID', 'GOOGLE_ACCOUNT_ID'] },
    { label: 'oauth client id', names: ['GOOGLE_CLIENT_ID'] },
    { label: 'oauth client secret', names: ['GOOGLE_CLIENT_SECRET'] },
    { label: 'guard key', names: ['WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY'] },
    { label: 'guard ack', oneOf: true, names: ['WONDERFOOD_LIVE_PROVIDER_ACK', 'WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS'] },
  ],
};

function runGuard(provider, env) {
  const result = spawnSync(process.execPath, [join(root, 'scripts/quality/require-disposable-lane.mjs'), 'provider', provider], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === 0) {
    return { status: 'READY', reason: 'Disposable provider lane guard passed.' };
  }
  return { status: 'BLOCKED', reason: output || 'Disposable provider lane guard did not pass.' };
}

function valuePresent(name, env) {
  return Boolean((env[name] || '').trim());
}

function evaluateRequirements(provider, env) {
  const requirements = [];
  let allReady = true;
  for (const req of PROVIDER_REQUIREMENTS[provider]) {
    const present = req.names.map((name) => ({ name, present: valuePresent(name, env) }));
    const requiredMissing = req.oneOf
      ? present.every((entry) => !entry.present)
      : present.some((entry) => !entry.present);
    if (requiredMissing) {
      allReady = false;
    }
    requirements.push({
      label: req.label,
      mode: req.oneOf ? 'oneOf' : 'all',
      values: present,
      status: requiredMissing ? 'BLOCKED' : 'READY',
    });
  }
  return { allReady, requirements };
}

function evaluateProvider(provider, env) {
  const requirements = evaluateRequirements(provider, env);
  const guard = runGuard(provider, env);
  const envReady = requirements.allReady;
  const status = envReady && guard.status === 'READY' ? 'READY' : 'BLOCKED';
  return {
    status,
    env_ready: envReady,
    guard,
    requirements: requirements.requirements,
    proof_commands: PROOF_COMMANDS[provider],
  };
}

const providers = {
  notion: evaluateProvider('notion', process.env),
  sheets: evaluateProvider('sheets', process.env),
};
const overallStatus = providers.notion.status === 'READY' && providers.sheets.status === 'READY' ? 'READY' : 'BLOCKED';
const blockers = [];
if (providers.notion.status !== 'READY') blockers.push('notion_not_ready');
if (providers.sheets.status !== 'READY') blockers.push('sheets_not_ready');

const payload = {
  proof: 'utopia_live_provider_readiness',
  checked_at: new Date().toISOString(),
  status: overallStatus,
  blockers,
  providers: {
    notion: {
      status: providers.notion.status,
      disposable_lane: providers.notion.guard.status,
      env: providers.notion.requirements,
      proof_commands: providers.notion.proof_commands,
    },
    sheets: {
      status: providers.sheets.status,
      disposable_lane: providers.sheets.guard.status,
      env: providers.sheets.requirements,
      proof_commands: providers.sheets.proof_commands,
    },
  },
  proof_commands: [
    './scripts/quality/run-provider-live-proofs.sh notion sheets',
    'npm run check:live-providers',
  ],
  no_secret_values_written: true,
};

writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
console.log(`Live provider readiness: ${payload.status} (${blockers.join(', ') || 'none'}; evidence: ${evidencePath})`);
console.log(`LIVE_PROVIDER_READINESS_JSON=${JSON.stringify(payload)}`);

if (overallStatus === 'BLOCKED') {
  process.exit(1);
}
