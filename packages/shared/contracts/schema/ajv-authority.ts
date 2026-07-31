import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import AjvDraft07 from 'ajv';
import addFormats from 'ajv-formats';

const DRAFT_07_SCHEMA = 'http://json-schema.org/draft-07/schema#';
const DRAFT_2020_12_SCHEMA = 'https://json-schema.org/draft-2020-12/schema';
const AJV_OPTIONS = { allErrors: true, strict: false, validateFormats: true };

const ajv2020 = withFormats(new Ajv2020(AJV_OPTIONS));
const ajvDraft07 = withFormats(new AjvDraft07(AJV_OPTIONS));
const validatorCache = new Map<string, ValidateFunction>();

type AjvCompiler = {
  compile<T>(schema: JsonSchema): ValidateFunction<T>;
  addMetaSchema(schema: JsonSchema): void;
};

export type JsonSchema = Record<string, unknown>;

export type SchemaValidationEntry = Readonly<{
  id: string;
  schema: JsonSchema;
  compiler: 'draft-07' | 'draft-2020-12';
  validate: ValidateFunction;
}>;

export type SchemaFixture = Readonly<{
  id: string;
  schema: JsonSchema;
  data: unknown;
  expected: boolean;
}>;

export type SchemaFixtureResult = Readonly<SchemaFixture & {
  actual: boolean;
  errors: readonly ErrorObject[];
}>;

export function getSchemaValidator(schema: JsonSchema): ValidateFunction {
  const cacheKey = cacheKeyFromSchema(schema);
  const cached = validatorCache.get(cacheKey);
  if (cached) return cached;
  const compiler = detectSchemaCompiler(schema);
  const validate = compiler.compile(schema);
  validatorCache.set(cacheKey, validate);
  return validate;
}

export function clearSchemaValidatorCache(): void {
  validatorCache.clear();
}

export function runSchemaFixtureCorpus(fixtures: readonly SchemaFixture[]): SchemaFixtureResult[] {
  return fixtures.map((fixture) => {
    const validate = getSchemaValidator(fixture.schema);
    const actual = Boolean(validate(fixture.data));
    return { ...fixture, actual, errors: validate.errors ?? [] };
  });
}

export function mapAjvValidationErrors(validate: ValidateFunction, fallbackPath = '/'): string[] {
  if (!validate.errors) return [];
  return validate.errors.map((error: ErrorObject) => `${fallbackPath}${String(error.instancePath || '')} ${error.keyword}:${error.message ?? 'invalid'}`);
}

function detectSchemaCompiler(schema: JsonSchema): AjvCompiler {
  if (!isRecord(schema) || typeof schema.$schema !== 'string' || !schema.$schema.trim()) {
    throw new Error('schema validation requires explicit $schema; missing or empty $schema');
  }
  if (schema.$schema === DRAFT_07_SCHEMA) return ajvDraft07;
  if (schema.$schema === DRAFT_2020_12_SCHEMA) return ajv2020;
  throw new Error(`unsupported schema dialect: ${schema.$schema}`);
}

function withFormats<T extends AjvCompiler>(ajv: T): T {
  addFormats(ajv as any);
  return ajv;
}

function cacheKeyFromSchema(schema: JsonSchema): string {
  if (typeof schema.$id === 'string' && schema.$id.trim()) return schema.$id;
  if (typeof schema.title === 'string' && schema.title.trim()) return `title:${schema.title}`;
  return `anonymous:${JSON.stringify(schema)}`;
}

function isRecord(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
