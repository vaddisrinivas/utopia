import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeModelSource,
  parseArgs,
  parseOpenAIJsonOutput,
  writeFactoryArtifact,
} from '@/scripts/factory/generate-app-from-prompt';

describe('github app factory', () => {
  it('turns structured model output into a compiled review artifact', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'utopia-github-factory-'));
    try {
      const source = normalizeModelSource({
        app: {
          schemaVersion: 'wonder.package-source.v1',
          id: 'family-chores',
          version: '1.0.0',
          label: 'Family Chores',
          homeSurface: 'today',
        },
        collections: {
          chore: {
            fields: {
              owner: { type: 'text', indexed: true },
              due_at: { type: 'timestamp' },
              status: { type: 'text', indexed: true },
              notes: { type: 'text' },
            },
          },
        },
        queries: {
          today: { from: 'chore', limit: 25 },
        },
        screens: {
          today: {
            label: 'Today',
            collections: ['chore'],
            query: 'today',
            mode: 'list',
            fields: ['title', 'owner', 'due_at', 'status'],
          },
        },
      }, 'Build a family chore tracker.');

      const manifest = writeFactoryArtifact({
        outputDir: path.join(root, 'artifact'),
        promptPath: 'requests/app-idea.md',
        prompt: 'Build a family chore tracker.',
        model: 'test-model',
        rawModelOutput: source,
        source,
        force: false,
      });

      expect(manifest.packageId).toBe('family-chores');
      expect(manifest.requiresApproval).toBe(true);
      expect(readJson(path.join(root, 'artifact', 'package.json')).id).toBe('family-chores');
      expect(readJson(path.join(root, 'artifact', 'source', 'collections', 'chore.json'))).toMatchObject({
        fields: {
          id: { type: 'text', required: true, indexed: true },
          owner: { type: 'text', indexed: true },
        },
      });
      expect(readJson(path.join(root, 'artifact', 'preview.json')).schemaVersion).toBe('wonder.app-package-preview.v1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps natural-language tools and games widget-backed instead of CRUD-only', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'utopia-github-factory-widget-'));
    try {
      const source = normalizeModelSource({
        app: {
          schemaVersion: 'wonder.package-source.v1',
          id: 'habit-graph',
          version: '1.0.0',
          label: 'Habit Graph',
          homeSurface: 'graph',
        },
        collections: [{
          id: 'habit',
          fields: [
            { id: 'streak', type: 'number', required: false, indexed: true },
            { id: 'done_at', type: 'timestamp', required: false, indexed: true },
            { id: 'mood', type: 'text', required: false, indexed: false },
          ],
        }],
        queries: [{ id: 'recent', from: 'habit', limit: 50 }],
        screens: [{
          id: 'graph',
          label: 'Graph',
          subtitle: 'Git-like habit history.',
          collections: ['habit'],
          query: 'recent',
          mode: 'chart',
          fields: ['title', 'streak', 'done_at'],
          components: [{
            kind: 'widget',
            widget: 'chartBlock',
            props: {
              chart: 'contribution-grid',
              collection: 'habit',
              dateField: 'done_at',
            },
          }],
        }],
      }, 'Build a GitHub-style habit tracker with a contribution graph.');

      const manifest = writeFactoryArtifact({
        outputDir: path.join(root, 'artifact'),
        promptPath: 'requests/examples/habit-graph.md',
        prompt: 'Build a GitHub-style habit tracker with a contribution graph.',
        model: 'test-model',
        rawModelOutput: source,
        source,
        force: false,
      });
      const screen = readJson(path.join(root, 'artifact', 'source', 'screens', 'graph.json'));
      const appPackage = readJson(path.join(root, 'artifact', 'package.json'));

      expect(manifest.packageId).toBe('habit-graph');
      expect(screen.components).toEqual([{
        kind: 'widget',
        widget: 'chartBlock',
        props: {
          chart: 'contribution-grid',
          collection: 'habit',
          dateField: 'done_at',
        },
      }]);
      expect(appPackage.presentation).toMatchObject({
        ui: {
          screens: {
            graph: {
              components: [{
                kind: 'widget',
                widget: 'chartBlock',
              }],
            },
          },
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('extracts JSON from an OpenAI Responses API output shape', () => {
    expect(parseOpenAIJsonOutput({
      output: [{
        content: [{
          type: 'output_text',
          text: JSON.stringify({ app: { id: 'demo' } }),
        }],
      }],
    })).toEqual({ app: { id: 'demo' } });
  });

  it('defaults to a plain-English request path and force-safe output', () => {
    expect(parseArgs([])).toMatchObject({
      promptPath: 'requests/app-idea.md',
      outputDir: 'dist/github-app-factory/app',
      model: 'gpt-5.4-mini',
      force: false,
    });
  });

  it('keeps the workflow fork-safe and issue-triggered without pull request secrets', () => {
    const workflow = readFileSync('.github/workflows/generate-utopia-app.yml', 'utf8');
    const issueTemplate = readFileSync('.github/ISSUE_TEMPLATE/utopia-app-request.yml', 'utf8');

    expect(workflow).toContain('OPENAI_API_KEY');
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('utopia-app-request');
    expect(workflow).toContain('Prepare issue request');
    expect(workflow).not.toMatch(/\bpull_request\b/);
    expect(issueTemplate).toContain('labels: ["utopia-app-request"]');
  });
});

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}
