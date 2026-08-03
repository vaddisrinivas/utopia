import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const script = 'scripts/quality/check-widget-catalog.mjs';

function runCheckWidgetCatalog(envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  const { status, stdout, stderr } = spawnSync(process.execPath, [script], {
    cwd: root,
    env,
    encoding: 'utf8',
  });

  if (status !== 0) {
    throw new Error(`check-widget-catalog failed with env ${JSON.stringify(envOverrides)}\n${stdout}\n${stderr}`);
  }

  return stdout;
}

function parseBudget(output) {
  const match = output.match(/domain widget debt: \d+\/(\d+)/);
  assert.match(output, /domain widget debt: \d+\/\d+/, 'missing domain widget debt assertion line');
  return Number.parseInt(match[1], 10);
}

const cleanEnv = { ...process.env };
delete cleanEnv.UTOPIA_MAX_DOMAIN_WIDGETS;

const defaultOutput = runCheckWidgetCatalog(cleanEnv);
assert.equal(parseBudget(defaultOutput), 1, 'UTOPIA_MAX_DOMAIN_WIDGETS default should be 1');

const raisedOutput = runCheckWidgetCatalog({ ...cleanEnv, UTOPIA_MAX_DOMAIN_WIDGETS: '12' });
assert.equal(parseBudget(raisedOutput), 12, 'UTOPIA_MAX_DOMAIN_WIDGETS override should accept a raised limit');

console.log('Widget catalog env budget assertions: PASS');
