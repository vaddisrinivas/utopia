import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { createRequire } from 'node:module';
import type Ajv from 'ajv';
import type { Operation } from 'fast-json-patch';
import { z, ZodType } from 'zod';

const require = createRequire(import.meta.url);
const jsonPatch = require('fast-json-patch') as typeof import('fast-json-patch');

export const actionEnvelopeSchema = z.object({
  schema_version: z.string().min(1),
  id: z.string().min(1),
  actor: z.string().min(1),
  domain: z.string().min(1),
  tool: z.string().min(1),
  record_ids: z.array(z.string()),
  source_ids: z.array(z.string()),
  idempotency_key: z.string().nullable(),
  operation_id: z.string().min(1),
  cause_id: z.string().min(1),
});

const DRAFT_07_SCHEMA = 'http://json-schema.org/draft-07/schema#';
const DRAFT_2020_12_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const AJV_OPTIONS = { allErrors: true, strict: false, validateFormats: true };

const ajv2020 = withFormats(new Ajv2020(AJV_OPTIONS));
const ajvDraft07 = loadDraft07Validator();

type AjvLike = {
  compile<T>(schema: object): ValidateFunction<T>;
};

type AjvConstructor = new (options: {
  allErrors: boolean;
  strict: boolean;
  validateFormats: boolean;
}) => AjvLike;

function detectSchemaDialect(schema: object): AjvLike {
  
  if (!isObject(schema) || typeof schema.$schema !== 'string' || !schema.$schema.trim()) {
    throw new Error('schema validation requires explicit $schema; missing or empty $schema');
  }
  const schemaId = schema.$schema;
  if (schemaId === DRAFT_07_SCHEMA) return ajvDraft07;
  if (schemaId === DRAFT_2020_12_SCHEMA) return ajv2020;
  throw new Error(`unsupported schema dialect: ${schemaId}`);
}

function loadDraft07Validator(): AjvLike {
  const direct = safeRequire<unknown>('ajv/dist/draft-07');
  if (direct) {
    const ctor = isFunction(direct) ? direct : isFunction((direct as { default?: unknown }).default)
      ? (direct as { default?: unknown }).default
      : null;
    if (isFunction(ctor)) {
      if (isConstructable(ctor)) {
        return withFormats(new (ctor as unknown as AjvConstructor)(AJV_OPTIONS));
      }
    }
  }

  const ajv = withFormats(new Ajv2020(AJV_OPTIONS));
  const meta07 = safeRequire<Record<string, unknown>>('ajv/dist/refs/json-schema-draft-07.json');
  if (!meta07 || !meta07.$id) {
    throw new Error(`draft-07 validator unavailable (${DRAFT_07_SCHEMA} support requires Ajv draft-07 module or ref schema)`);
  }
  ajv.addMetaSchema(meta07);
  return ajv;
}

function withFormats<T extends AjvLike>(ajv: T): T {
  addFormats(ajv as unknown as Ajv);
  return ajv;
}

function safeRequire<T>(moduleId: string): T | null {
  try {
    return require(moduleId) as T;
  } catch {
    return null;
  }
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

function isConstructable(value: unknown): value is new (...args: unknown[]) => object {
  return typeof value === 'function';
}

function isObject(value: unknown): value is Record<string, unknown> & { $schema?: unknown } {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseWithSchema<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

export function compileJsonSchema<T>(schema: object): ValidateFunction<T> {
  const ajv = detectSchemaDialect(schema);
  return ajv.compile(schema) as ValidateFunction<T>;
}

export function validateJsonSchema<T>(schema: object, input: unknown): { valid: true; value: T } | { valid: false; errors: string[] } {
  const validate = compileJsonSchema(schema);
  if (validate(input)) return { valid: true, value: input as T };
  return { valid: false, errors: (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`) };
}

export function diffJson(before: unknown, after: unknown): Operation[] {
  return jsonPatch.compare(before as object, after as object);
}

export function applyJsonDiff<T>(value: T, patch: Operation[]): T {
  const result = jsonPatch.applyPatch(value as object, patch, true, false);
  return result.newDocument as T;
}
