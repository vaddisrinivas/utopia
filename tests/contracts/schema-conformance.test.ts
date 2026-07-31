import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_PACKAGE_SCHEMA_REGISTRY } from '@/packages/schemas/src/package-registry';
import { getSchemaValidator, runSchemaFixtureCorpus, type JsonSchema } from '@/packages/shared/contracts/schema/ajv-authority';

type CorpusEntry = Readonly<{ id: string; schemaVersion: string; fixture: string; expected: boolean }>;
type Rule = Readonly<{ id: string; path: string; pattern?: string; equals?: unknown }>;
const root = process.cwd();
const corpus = JSON.parse(readFileSync(path.join(root, 'tests/conformance/fixtures/schema-corpus.json'), 'utf8')) as CorpusEntry[];
const rules = (JSON.parse(readFileSync(path.join(root, 'schemas/utopia-spectral-rules.json'), 'utf8')) as { rules: Rule[] }).rules;

describe('Utopia schema conformance', () => {
  it('runs the shared fixture corpus through the single AJV authority', () => {
    const cases = corpus.map((entry) => {
      const schema = APP_PACKAGE_SCHEMA_REGISTRY.find((candidate) => candidate.schemaVersion === entry.schemaVersion)?.schema;
      if (!schema) throw new Error(`missing schema registry entry: ${entry.schemaVersion}`);
      return { id: entry.id, schema, data: JSON.parse(readFileSync(path.resolve(root, 'tests/conformance/fixtures', entry.fixture), 'utf8')), expected: entry.expected };
    });
    for (const result of runSchemaFixtureCorpus(cases)) expect(result.actual, `${result.id}: ${JSON.stringify(result.errors)}`).toBe(result.expected);
  });

  it('applies Utopia Spectral-style rules to every registered schema', () => {
    for (const entry of APP_PACKAGE_SCHEMA_REGISTRY) {
      const schema = entry.schema as JsonSchema;
      for (const rule of rules) {
        const value = readPath(schema, rule.path);
        const valid = rule.pattern ? typeof value === 'string' && new RegExp(rule.pattern).test(value) : value === rule.equals;
        expect(valid, `${entry.key} violates ${rule.id}`).toBe(true);
      }
      expect(getSchemaValidator(schema)).toBeTypeOf('function');
    }
  });
});

function readPath(value: unknown, rulePath: string): unknown {
  return rulePath.replace(/^\$\.?/, '').split('.').filter(Boolean).reduce<unknown>((current, key) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
  ), value);
}
