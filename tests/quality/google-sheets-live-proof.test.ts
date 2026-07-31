import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { providerAuthorizationDigest } from '../../scripts/quality/require-disposable-lane.mjs';

const rootDir = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

function writeFakePython(binaryPath: string, callLogPath: string) {
  const pyScriptVar = '${' + 'py_script' + '}';
  const script = `#!/usr/bin/env bash
set -euo pipefail

call_log="${callLogPath}"
py_script="$(cat)"

if [[ "${pyScriptVar}" == *"sheets.googleapis.com/v4/spreadsheets"* ]]; then
  echo "create-spreadsheet" >> "$call_log"
  echo "mock-disposable-spreadsheet-id"
  exit 0
fi

if [[ "${pyScriptVar}" == *"drive/v3/files/"* ]]; then
  echo "archive-spreadsheet" >> "$call_log"
  echo "{}"
  exit 0
fi

if [[ "${pyScriptVar}" == *"openidconnect.googleapis.com/v1/userinfo"* ]]; then
  echo "userinfo" >> "$call_log"
  echo '{"sub":"sheet-workspace@example.invalid"}'
  exit 0
fi

echo "unhandled-call" >> "$call_log"
echo '{}'
`;
  writeFileSync(binaryPath, script);
  chmodSync(binaryPath, 0o755);
}

function writeFakeScenarioScript(scriptPath: string, spreadsheetPathVar: string, ackPathVar: string) {
  const scenarioSpreadsheetVar = '${' + 'GOOGLE_SHEETS_TEST_SPREADSHEET_ID' + '}';
  const scenarioAckVar = '${' + 'WONDERFOOD_LIVE_PROVIDER_ACK_SHEETS' + '}';
  const script = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "${scenarioSpreadsheetVar}" > "${spreadsheetPathVar}"
printf '%s\\n' "${scenarioAckVar}" > "${ackPathVar}"
`;
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
}

describe('run-google-sheets-live-proof', () => {
  it('creates a disposable workbook, binds disposable HMAC, runs the scenario, and archives on exit', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'utopia-ls-proofs-'));
    const callLogPath = join(tempRoot, 'python-calls.log');
    const scenarioSpreadsheetPath = join(tempRoot, 'scenario-spreadsheet-id.txt');
    const scenarioAckPath = join(tempRoot, 'scenario-ack.txt');
    const fakePython = join(tempRoot, 'bin', 'python3');
    const fakeScenario = join(tempRoot, 'run-google-sheets-scenario-proof.sh');

    mkdirSync(join(tempRoot, 'bin'), { recursive: true });
    writeFakePython(fakePython, callLogPath);
    writeFakeScenarioScript(
      fakeScenario,
      '${' + 'GOOGLE_SHEETS_SCENARIO_OUTPUT_ID' + '}',
      '${' + 'GOOGLE_SHEETS_SCENARIO_OUTPUT_ACK' + '}',
    );

    const env = {
      ...process.env,
      WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV: '1',
      GOOGLE_SHEETS_ACCESS_TOKEN: 'mock-access-token',
      GOOGLE_SHEETS_PROVISION_DISPOSABLE: '1',
      GOOGLE_SHEETS_TEST_ACCOUNT_ID: 'sheet-workspace@example.invalid',
      WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY: 'fixture-provider-authorization-key-32-characters',
      GOOGLE_SHEETS_SCENARIO_COMMAND: fakeScenario,
      GOOGLE_SHEETS_SCENARIO_OUTPUT_ID: scenarioSpreadsheetPath,
      GOOGLE_SHEETS_SCENARIO_OUTPUT_ACK: scenarioAckPath,
      PYTHON_CALL_LOG_PATH: callLogPath,
      PATH: `${join(tempRoot, 'bin')}:${process.env.PATH}`,
    } as NodeJS.ProcessEnv;
    delete env.GOOGLE_SHEETS_TEST_SPREADSHEET_ID;

    const result = spawnSync('bash', [join(rootDir, 'scripts/quality/run-google-sheets-live-proof.sh')], {
      cwd: rootDir,
      env,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status).toBe(0);
    expect(readFileSync(callLogPath, 'utf8')).toContain('create-spreadsheet');
    expect(readFileSync(callLogPath, 'utf8')).toContain('archive-spreadsheet');
    expect(readFileSync(scenarioSpreadsheetPath, 'utf8')).toBe('mock-disposable-spreadsheet-id\n');
    const ack = readFileSync(scenarioAckPath, 'utf8').trim();
    const expectedAck = `DISPOSABLE_PROVIDER_ONLY:hmac-sha256:${providerAuthorizationDigest(
      'sheets',
      'mock-disposable-spreadsheet-id',
      'sheet-workspace@example.invalid',
      'fixture-provider-authorization-key-32-characters',
    )}`;
    expect(ack).toBe(expectedAck);
    expect(output).not.toContain('mock-access-token');
  });

  it('fails closed when an explicit disposable authorization key is too short', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'utopia-ls-proofs-weak-key-'));
    const callLogPath = join(tempRoot, 'python-calls.log');
    const fakePython = join(tempRoot, 'bin', 'python3');

    mkdirSync(join(tempRoot, 'bin'), { recursive: true });
    writeFakePython(fakePython, callLogPath);

    const env = {
      ...process.env,
      WONDERFOOD_LIVE_PROOF_SKIP_AGENT_ENV: '1',
      GOOGLE_SHEETS_ACCESS_TOKEN: 'mock-access-token',
      GOOGLE_SHEETS_PROVISION_DISPOSABLE: '1',
      GOOGLE_SHEETS_TEST_ACCOUNT_ID: 'sheet-workspace@example.invalid',
      WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY: 'too-short-key',
      GOOGLE_SHEETS_SCENARIO_COMMAND: `${join(tempRoot, 'run-google-sheets-scenario-proof.sh')}`,
      GOOGLE_SHEETS_SCENARIO_OUTPUT_ID: join(tempRoot, 'scenario-spreadsheet-id.txt'),
      GOOGLE_SHEETS_SCENARIO_OUTPUT_ACK: join(tempRoot, 'scenario-ack.txt'),
      PYTHON_CALL_LOG_PATH: callLogPath,
      PATH: `${join(tempRoot, 'bin')}:${process.env.PATH}`,
    } as NodeJS.ProcessEnv;

    const result = spawnSync('bash', [join(rootDir, 'scripts/quality/run-google-sheets-live-proof.sh')], {
      cwd: rootDir,
      env,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    expect(result.status).toBe(1);
    expect(output).toContain('WONDERFOOD_DISPOSABLE_PROVIDER_AUTHORIZATION_KEY must be at least 32 characters');
    if (existsSync(callLogPath)) {
      expect(readFileSync(callLogPath, 'utf8')).toBe('');
    } else {
      expect(existsSync(callLogPath)).toBe(false);
    }
  });
});
