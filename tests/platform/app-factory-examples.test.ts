import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compileAppPackageSource } from '@/packages/app-compiler';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import { validateArtifact } from '@/packages/schemas/src';
import { validateAppPackage } from '@/server/src/kernel/package';
import {
  assessFactoryPrompt,
  normalizeModelSource,
  writeFactoryArtifact,
} from '@/scripts/factory/generate-app-from-prompt';

type PackageOnlyExample = Readonly<{
  id: string;
  outcome: 'package-only';
  prompt: string;
  rawModelOutput: unknown;
}>;

type BlockedExample = Readonly<{
  id: string;
  outcome: 'blocked';
  prompt?: string;
  promptSeed?: string;
  repeatCount?: number;
  missingCapability: string;
  blockedReason: string;
}>;

type AppFactoryExample = PackageOnlyExample | BlockedExample;

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/app-factory-prompts');
const manifestPath = path.join(fixtureRoot, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  schemaVersion: string;
  entries: AppFactoryExample[];
};

describe('app factory examples', () => {
  it('loads the expected example matrix', () => {
    expect(manifest.schemaVersion).toBe('utopia.app-factory-examples.v1');
    expect(manifest.entries).toHaveLength(12);
  });

  for (const example of manifest.entries) {
    if (example.outcome === 'package-only') {
      it(`${example.id} compiles, validates, and keeps a stable checksum`, () => {
        const prompt = example.prompt.trim();
        const source = normalizeModelSource(example.rawModelOutput, prompt);
        const compiledA = compileAppPackageSource(source);
        const compiledB = compileAppPackageSource(JSON.parse(JSON.stringify(source)));

        expect(compiledA.valid).toBe(true);
        expect(compiledB.valid).toBe(true);
        if (!compiledA.valid || !compiledB.valid) {
          throw new Error('expected a valid compiled package');
        }

        expect(compiledA.checksum).toBe(compiledB.checksum);
        expect(compiledA.package.id).toBe(source.app.id);
        expect(compiledA.package.presentation?.label).toBe(source.app.label);

        const artifactValidation = validateArtifact({ value: compiledA.package });
        expect(artifactValidation.ok).toBe(true);
        if (!artifactValidation.ok) {
          throw new Error(artifactValidation.issues.map((issue) => issue.message).join('\n'));
        }

        const serverValidation = validateAppPackage(compiledA.package);
        expect(serverValidation.valid).toBe(true);
        if (!serverValidation.valid) {
          throw new Error(serverValidation.errors.join('\n'));
        }

        const root = mkdtempSync(path.join(tmpdir(), `utopia-app-factory-${example.id}-`));
        try {
          const manifestArtifact = writeFactoryArtifact({
            outputDir: path.join(root, 'artifact'),
            promptPath: `tests/fixtures/app-factory-prompts/${example.id}/prompt.md`,
            prompt,
            model: 'fixture-model',
            rawModelOutput: example.rawModelOutput,
            source,
            force: false,
          });

          expect(manifestArtifact.packageChecksum).toBe(compiledA.checksum);
          expect(manifestArtifact.previewHash).toBe(sha256Canonical(compiledA.preview));
          expect(manifestArtifact.promptHash).toBe(sha256Canonical({ prompt }));
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
      continue;
    }

    it(`${example.id} is blocked by ${example.missingCapability}`, () => {
      const prompt = buildBlockedPrompt(example);
      const assessment = assessFactoryPrompt(prompt);

      expect(assessment.allowed).toBe(false);
      if (assessment.allowed) throw new Error('expected blocked assessment');
      expect(example.blockedReason).toMatch(/\S/);
      expect(assessment.missingCapability).toBe(example.missingCapability);
      expect(assessment.blockedReason).toBe(example.blockedReason);
      expect(prompt).toMatch(/\S/);
      if (example.id === 'oversized-input') {
        expect(prompt.length).toBeGreaterThan(12000);
      }
      if (example.id === 'prompt-injection') {
        expect(prompt.toLowerCase()).toContain('ignore');
      }
      if (example.id === 'secret-exfiltration') {
        expect(prompt.toLowerCase()).toContain('api key');
      }
      if (example.id === 'unsupported-native-access') {
        expect(prompt.toLowerCase()).toContain('bluetooth');
      }
    });
  }

  it('blocks explicit code execution requests', () => {
    const assessment = assessFactoryPrompt('Run JavaScript code to generate custom scoring rules and execute it at runtime.');
    expect(assessment).toMatchObject({
      allowed: false,
      missingCapability: 'codeExecutionCapability',
    });
  });

  it('blocks explicit SQL requests', () => {
    const assessment = assessFactoryPrompt('Create an app that runs SQL statements: SELECT * FROM users; INSERT INTO events values ...');
    expect(assessment).toMatchObject({
      allowed: false,
      missingCapability: 'sqlCapability',
    });
  });

  it('blocks oversized multi-line prompts', () => {
    const assessment = assessFactoryPrompt(`${'a'.repeat(7000)}\n${'b'.repeat(7000)}`);
    expect(assessment).toMatchObject({
      allowed: false,
      missingCapability: 'requestSizeLimit',
    });
  });
});

function buildBlockedPrompt(example: BlockedExample): string {
  if (typeof example.prompt === 'string') return example.prompt.trim();
  const seed = example.promptSeed?.trim() ?? 'Build a large app request.';
  const repeatCount = example.repeatCount ?? 1;
  return Array.from({ length: repeatCount }, () => seed).join(' ');
}
