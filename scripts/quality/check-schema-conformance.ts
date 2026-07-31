import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  APP_PACKAGE_SCHEMA_REGISTRY,
} from '@/packages/schemas/src';
import { runSchemaFixtureCorpus } from '@/packages/shared/contracts/schema/ajv-authority';

type CorpusEntry = Readonly<{ id: string; schemaVersion: string; fixture: string; expected: boolean }>;

type Rule = Readonly<{
  id: string;
  path: string;
  pattern?: string;
  equals?: unknown;
}>;

const root = process.cwd();
const corpusPath = path.join(root, 'tests/conformance/fixtures/schema-corpus.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as CorpusEntry[];
const rules = (JSON.parse(readFileSync(path.join(root, 'schemas/utopia-spectral-rules.json'), 'utf8')) as { rules: Rule[] }).rules;

function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.resolve(path.dirname(corpusPath), relativePath), 'utf8')) as unknown;
}

function readPath(value: unknown, rulePath: string): unknown {
  return rulePath
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value);
}

for (const entry of corpus) {
  const schema = APP_PACKAGE_SCHEMA_REGISTRY.find((candidate) => candidate.schemaVersion === entry.schemaVersion)?.schema;
  if (!schema) throw new Error(`missing schema registry entry: ${entry.schemaVersion}`);
  const result = runSchemaFixtureCorpus([{
    id: entry.id,
    schema,
    data: readFixture(entry.fixture),
    expected: entry.expected,
  }])[0];
  if (result.actual !== result.expected) {
    throw new Error(`${entry.id}: expected ${result.expected}, got ${result.actual}`);
  }
}

for (const entry of APP_PACKAGE_SCHEMA_REGISTRY) {
  for (const rule of rules) {
    const value = readPath(entry.schema, rule.path);
    const valid = rule.pattern ? typeof value === 'string' && new RegExp(rule.pattern).test(value) : value === rule.equals;
    if (!valid) throw new Error(`${entry.key} violates ${rule.id}`);
  }
}

console.log(`Schema conformance passed: ${corpus.length} shared fixtures, ${rules.length} Utopia rules, ${APP_PACKAGE_SCHEMA_REGISTRY.length} schemas.`);
