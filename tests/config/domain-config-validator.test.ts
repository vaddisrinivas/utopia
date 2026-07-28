import { applyPatch } from 'fast-json-patch';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validateDomainConfig } from '../../scripts/domain-config-validator.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoot = join(projectRoot, 'packages/domain-config');
const fixturesRoot = join(projectRoot, 'tests/fixtures/domain-config');

function makeTempRoot() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'utopia-domain-config-'));
  cpSync(packageRoot, tempRoot, { recursive: true });
  return tempRoot;
}

function applyFixture(root: string, targetRelativePath: string, fixtureRelativePath: string) {
  const targetPath = join(root, targetRelativePath);
  const patchPath = join(fixturesRoot, fixtureRelativePath);
  const current = JSON.parse(readFileSync(targetPath, 'utf8'));
  const patch = JSON.parse(readFileSync(patchPath, 'utf8'));
  const next = applyPatch(current, patch, true, false).newDocument;
  writeFileSync(targetPath, `${JSON.stringify(next, null, 2)}\n`);
}

function withTempRoot(run: (root: string) => void) {
  const tempRoot = makeTempRoot();
  try {
    run(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('domain config validator', () => {
  it('accepts the current package and current schemas', () => {
    withTempRoot((root) => {
      expect(validateDomainConfig(root)).toMatchObject({
        domains: 3,
        activeDomain: 'food',
        activeCollections: 29,
        activeWorkflows: 5,
        agents: 7,
      });
    });
  });

  it('fails closed on unknown fields', () => {
    withTempRoot((root) => {
      applyFixture(root, 'domain-catalog.v1.json', 'unknown-field/domain-catalog.patch.json');
      expect(() => validateDomainConfig(root)).toThrow(/additional properties|unexpected/i);
    });
  });

  it('fails closed on missing canonical fields', () => {
    withTempRoot((root) => {
      applyFixture(root, 'domain-catalog.v1.json', 'missing-canonical/domain-catalog.patch.json');
      expect(() => validateDomainConfig(root)).toThrow(/active_domain_id|required property/i);
    });
  });

  it('fails closed on invalid workflow refs', () => {
    withTempRoot((root) => {
      applyFixture(root, 'domains/food.v1.json', 'invalid-ref/domains-food.patch.json');
      expect(() => validateDomainConfig(root)).toThrow(/Missing workflow for food: missing_workflow_ref/);
    });
  });

  it('fails closed on duplicate agent ids', () => {
    withTempRoot((root) => {
      applyFixture(root, 'agents/registry.v1.json', 'duplicate-agent-id/agents-registry.patch.json');
      expect(() => validateDomainConfig(root)).toThrow(/Duplicate agent id: orchestrator/);
    });
  });

  it('fails closed on invalid agent registry capability ops', () => {
    withTempRoot((root) => {
      applyFixture(root, 'agents/registry.v1.json', 'invalid-capability-op/agents-registry.patch.json');
      expect(() => validateDomainConfig(root)).toThrow(/additional property|must be equal to one of the allowed values|invalid/i);
    });
  });

  it('fails closed on unknown agent registry fields', () => {
    withTempRoot((root) => {
      applyFixture(root, 'agents/registry.v1.json', 'unknown-field/agents-registry.patch.json');
      expect(() => validateDomainConfig(root)).toThrow(/additional properties|unexpected/i);
    });
  });
});
