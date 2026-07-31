#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const evidenceDir = join(root, 'app', 'build', 'evidence');
const evidencePath = join(evidenceDir, 'live-provider-readiness.json');
const SHEETS_TOKEN_FILE_DEFAULT = join(root, 'build', 'evidence', 'live-workspace', 'google-sheets-token.json');
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
    { id: 'notion_credentials', label: 'credential', oneOf: true, names: ['NOTION_TOKEN', 'NOTION_API_KEY'] },
    { id: 'notion_target_page', label: 'target page', names: ['NOTION_TEST_PAGE_ID'] },
    { id: 'notion_account', label: 'account', oneOf: true, names: ['NOTION_TEST_ACCOUNT_ID', 'NOTION_WORKSPACE_ID'] },
    { id: 'notion_guard_key', label: 'guard key', names: ['WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY'] },
    { id: 'notion_guard_ack', label: 'guard ack', oneOf: true, names: ['WONDERFOOD_LIVE_PROVIDER_ACK', 'WONDERFOOD_LIVE_PROVIDER_ACK_NOTION'] },
  ],
  sheets: [
    { id: 'sheets_test_spreadsheet', label: 'test spreadsheet', names: ['GOOGLE_SHEETS_TEST_SPREADSHEET_ID'] },
    { id: 'sheets_oauth_source', label: 'oauth token source', oneOf: true, names: ['GOOGLE_SHEETS_ACCESS_TOKEN', 'GOOGLE_SHEETS_TOKEN_FILE'] },
    { id: 'sheets_account', label: 'account', oneOf: true, names: ['GOOGLE_SHEETS_TEST_ACCOUNT_ID', 'GOOGLE_ACCOUNT_ID'] },
    { id: 'sheets_oauth_client_id', label: 'oauth client id', names: ['GOOGLE_CLIENT_ID'] },
    { id: 'sheets_oauth_client_secret', label: 'oauth client secret', names: ['GOOGLE_CLIENT_SECRET'] },
    { id: 'sheets_guard_key', label: 'guard key', names: ['WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY'] },
    { id: 'sheets_guard_ack', label: 'guard ack', oneOf: true, names: ['WONDERFOOD_LIVE_PROVIDER_ACK', 'WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS'] },
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
  if (name === 'GOOGLE_SHEETS_TOKEN_FILE') {
    const tokenFile = (env.GOOGLE_SHEETS_TOKEN_FILE || SHEETS_TOKEN_FILE_DEFAULT).trim();
    return tokenFile.length > 0 && existsSync(tokenFile);
  }
  return Boolean((env[name] || '').trim());
}

function evaluateRequirements(provider, env) {
  const requirements = [];
  let allReady = true;
  const missing_configs = [];
  for (const req of PROVIDER_REQUIREMENTS[provider]) {
    const present = req.names.map((name) => ({ name, present: valuePresent(name, env) }));
    const requiredMissing = req.oneOf
      ? present.every((entry) => !entry.present)
      : present.some((entry) => !entry.present);
    if (requiredMissing) {
      allReady = false;
      if (req.oneOf) {
        missing_configs.push(req.id);
      } else {
        missing_configs.push(...present.filter((entry) => !entry.present).map((entry) => entry.name));
      }
    }
    requirements.push({
      id: req.id,
      label: req.label,
      mode: req.oneOf ? 'oneOf' : 'all',
      values: present,
      status: requiredMissing ? 'BLOCKED' : 'READY',
    });
  }
  return { allReady, requirements, missing_configs: [...new Set(missing_configs)] };
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
    missing_configs: requirements.missing_configs,
    proof_commands: PROOF_COMMANDS[provider],
  };
}

const providers = {
  notion: evaluateProvider('notion', process.env),
  sheets: evaluateProvider('sheets', process.env),
};
const overallStatus = providers.notion.status === 'READY' && providers.sheets.status === 'READY' ? 'READY' : 'BLOCKED';
const blockers = [
  ...new Set([
    ...providers.notion.missing_configs,
    ...providers.sheets.missing_configs,
  ]),
];
if (overallStatus === 'BLOCKED' && providers.notion.status !== 'READY' && !providers.notion.missing_configs.length) {
  blockers.push('notion_disposable_lane');
}
if (overallStatus === 'BLOCKED' && providers.sheets.status !== 'READY' && !providers.sheets.missing_configs.length) {
  blockers.push('sheets_disposable_lane');
}

const payload = {
  proof: 'utopia_live_provider_readiness',
  proof_readiness: true,
  proof_stage: 'preflight',
  checked_at: new Date().toISOString(),
  status: overallStatus,
  status_explanation: 'Readiness only; does not execute live provider proof runs.',
  blockers,
  providers: {
    notion: {
      status: providers.notion.status,
      disposable_lane: providers.notion.guard.status,
      env: providers.notion.requirements,
      proof_commands: providers.notion.proof_commands,
      missing_configs: providers.notion.missing_configs,
    },
    sheets: {
      status: providers.sheets.status,
      disposable_lane: providers.sheets.guard.status,
      env: providers.sheets.requirements,
      proof_commands: providers.sheets.proof_commands,
      missing_configs: providers.sheets.missing_configs,
      oauth_readiness_command: './scripts/quality/run-google-sheets-live-proof.sh',
    },
  },
  proof_commands: [
    './scripts/quality/run-provider-live-proofs.sh notion sheets',
    'npm run check:live-providers',
  ],
  no_secret_values_written: true,
};

writeFileSync(evidencePath, JSON.stringify(payload, null, 2));
console.log(`Live provider readiness (preflight only): ${payload.status} (${blockers.join(', ') || 'none'}; evidence: ${evidencePath})`);
console.log(`LIVE_PROVIDER_READINESS_JSON=${JSON.stringify(payload)}`);

if (overallStatus === 'BLOCKED') {
  process.exit(1);
}
