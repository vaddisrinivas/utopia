import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { APP_PACKAGE_SCHEMA_REGISTRY } from '@/packages/schemas/src/package-registry';
import { getSchemaValidator, runSchemaFixtureCorpus, type JsonSchema } from '@/packages/shared/contracts/schema/ajv-authority';

type CorpusEntry = Readonly<{ id: string; schemaVersion: string; fixture: string; expected: boolean }>;
type Rule = Readonly<{ id: string; path: string; pattern?: string; equals?: unknown }>;

const here = dirname(fileURLToPath(import.meta.url));
const corpus = readJson<CorpusEntry[]>('fixtures/schema-corpus.json');
const rules = readJson<{ rules: Rule[] }>('../../schemas/utopia-spectral-rules.json').rules;

describe('Utopia schema conformance', () => {
  it('runs the shared corpus through the single AJV authority', () => {
    const cases = corpus.map((entry) => {
      const schema = APP_PACKAGE_SCHEMA_REGISTRY.find((candidate) => candidate.schemaVersion === entry.schemaVersion)?.schema;
      if (!schema) throw new Error(`missing schema registry entry: ${entry.schemaVersion}`);
      return {
        id: entry.id,
        schema,
        data: JSON.parse(readFileSync(resolve(here, 'fixtures', entry.fixture), 'utf8')) as unknown,
        expected: entry.expected,
      };
    });

    for (const result of runSchemaFixtureCorpus(cases)) {
      expect(result.actual, `${result.id}: ${JSON.stringify(result.errors)}`).toBe(result.expected);
    }
  });

  it('applies Utopia Spectral-style schema metadata rules to every registered schema', () => {
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

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(here, relativePath), 'utf8')) as T;
}

function readPath(value: unknown, rulePath: string): unknown {
  return rulePath.replace(/^\$\.?/, '').split('.').filter(Boolean).reduce<unknown>(
    (current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined,
    value,
  );
}
