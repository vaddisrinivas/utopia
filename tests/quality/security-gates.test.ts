import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type GateScript = {
  name: string;
  path: string;
  prefix: string;
};

const gateScripts: GateScript[] = [
  {
    name: 'osv',
    path: join(projectRoot, 'scripts/quality/security/check-osv-gate.mjs'),
    prefix: 'OSV_GATE_JSON=',
  },
  {
    name: 'telemetry-privacy',
    path: join(projectRoot, 'scripts/quality/security/check-telemetry-privacy-boundaries.mjs'),
    prefix: 'TELEMETRY_PRIVACY_GATE_JSON=',
  },
  {
    name: 'sbom',
    path: join(projectRoot, 'scripts/quality/sbom/check-sbom-gate.mjs'),
    prefix: 'SBOM_GATE_JSON=',
  },
];

function runGate(script: GateScript, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script.path], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const payloadLine = output
    .split('\n')
    .find((line) => line.startsWith(script.prefix));
  if (!payloadLine) {
    throw new Error(`Missing payload for ${script.name}. Output: ${output}`);
  }
  return {
    status: result.status ?? 1,
    payload: JSON.parse(payloadLine.slice(script.prefix.length)),
  };
}

const fixtureRoots: string[] = [];
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-security-gate-'));
  fixtureRoots.push(root);
  return root;
}

function writeScript(root: string, name: string, body: string) {
  const path = join(root, name);
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

function fakeJsonScript(root: string, name: string, payload: unknown) {
  const body = `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify(payload)}\nJSON\n`;
  return writeScript(root, name, body);
}

function fakeEmptyScript(root: string, name: string) {
  return writeScript(root, name, '#!/usr/bin/env bash\n');
}

function fakeJsonFindingScript(root: string, name: string, payload: unknown) {
  const body = `#!/usr/bin/env bash\ncat <<'JSON'\n${JSON.stringify(payload)}\nJSON\nexit 1\n`;
  return writeScript(root, name, body);
}

describe('operations and security gate scripts', () => {
  afterAll(() => {
    for (const root of fixtureRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns BLOCKED when gate tooling is unavailable', () => {
    const missingTool = '/usr/bin/does-not-exist-please-block';
    for (const script of gateScripts) {
      const result = runGate(script, {
        QUALITY_GATE_ROOT: projectRoot,
        OSV_SCANNER_CMD: missingTool,
        SYFT_CMD: missingTool,
      });

      if (script.name === 'telemetry-privacy') {
        expect(result.status).toBe(0);
        expect(result.payload.status).toBe('READY');
        continue;
      }

      expect(result.status).toBe(1);
      expect(result.payload.status).toBe('BLOCKED');
      expect(result.payload.blockers.length).toBeGreaterThan(0);
      if (script.name === 'osv') {
        expect(result.payload.blockers).toContain(`osv_scanner_missing:${missingTool}`);
      }
      if (script.name === 'sbom') {
        expect(result.payload.blockers).toContain(`sbom_tool_missing:${missingTool}`);
      }
    }
  });

  it('returns BLOCKED when scanners produce no real artifact output', () => {
    const fakeRoot = fixtureRoot();
    const emptyOsv = fakeEmptyScript(fakeRoot, 'empty-osv-scanner');
    const emptySyft = fakeEmptyScript(fakeRoot, 'empty-syft');
    mkdirSync(join(fakeRoot, 'app/build/evidence'), { recursive: true });
    writeFileSync(join(fakeRoot, 'app/build/evidence/sbom.json'), '{"bomFormat":"CycloneDX","specVersion":"1.5","components":[]}', {
      encoding: 'utf8',
    });

    const resultOsv = runGate(gateScripts[0], {
      QUALITY_GATE_ROOT: projectRoot,
      OSV_SCANNER_CMD: emptyOsv,
      OSV_SCANNER_ARGS: '',
    });
    expect(resultOsv.status).toBe(1);
    expect(resultOsv.payload.status).toBe('BLOCKED');
    expect(resultOsv.payload.blockers).toContain('osv_report_missing:scanner_stdout');

    const resultSbom = runGate(gateScripts[2], {
      QUALITY_GATE_ROOT: projectRoot,
      SYFT_CMD: emptySyft,
      SYFT_ARGS: '.',
      RELEASE_SBOM_PATH: join(fakeRoot, 'app/build/evidence/sbom.json'),
    });
    expect(resultSbom.status).toBe(1);
    expect(resultSbom.payload.status).toBe('BLOCKED');
    expect(resultSbom.payload.blockers).toContain('sbom_output_missing:syft_stdout');
  });

  it('passes on fake OSV and Syft artifacts when command-backed', () => {
    const fakeRoot = fixtureRoot();
    const fakeOsv = fakeJsonScript(fakeRoot, 'fake-osv-scanner', {
      results: [],
    });
    const fakeSyft = fakeJsonScript(fakeRoot, 'fake-syft', {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      version: 1,
      serialNumber: 'urn:uuid:00000000-0000-0000-0000-000000000000',
      components: [],
    });

    const resultOsv = runGate(gateScripts[0], {
      QUALITY_GATE_ROOT: projectRoot,
      OSV_SCANNER_CMD: fakeOsv,
      OSV_SCANNER_ARGS: '',
    });
    expect(resultOsv.status).toBe(0);
    expect(resultOsv.payload.status).toBe('READY');
    expect(resultOsv.payload.blockers).toEqual([]);

    const resultSbom = runGate(gateScripts[2], {
      QUALITY_GATE_ROOT: projectRoot,
      SYFT_CMD: fakeSyft,
      SYFT_ARGS: '.',
      RELEASE_SBOM_PATH: join(fakeRoot, 'app/build/evidence/sbom.json'),
    });
    expect(resultSbom.status).toBe(0);
    expect(resultSbom.payload.status).toBe('READY');
    expect(resultSbom.payload.blockers).toEqual([]);

    const resultTelemetry = runGate(gateScripts[1]);
    expect(resultTelemetry.status).toBe(0);
    expect(resultTelemetry.payload.status).toBe('READY');
    expect(resultTelemetry.payload.blockers).toEqual([]);
  });

  it('records OSV findings without treating report-only mode as a scanner failure', () => {
    const fakeRoot = fixtureRoot();
    const findingOsv = fakeJsonFindingScript(fakeRoot, 'finding-osv-scanner', {
      results: [{ source: { path: 'package-lock.json' }, packages: [{ package: { name: 'example' }, vulns: [{}] }] }],
    });

    const result = runGate(gateScripts[0], {
      QUALITY_GATE_ROOT: projectRoot,
      OSV_SCANNER_CMD: findingOsv,
      OSV_SCANNER_ARGS: '',
    });

    expect(result.status).toBe(0);
    expect(result.payload.status).toBe('READY');
    expect(result.payload.warnings).toContain('osv_findings_reported');
  });
});
