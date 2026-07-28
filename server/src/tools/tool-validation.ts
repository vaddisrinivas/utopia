import { listMcpTools } from '../tools/catalog';

type JsonSchema = {
  type?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
};

type McpToolDefinition = {
  name: string;
  inputSchema: JsonSchema;
};

type ToolArgs = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPath(path: string, key: string) {
  return path ? `${path}.${key}` : key;
}

function validateToolArguments(
  input: unknown,
  schema: JsonSchema,
  path: string,
  errors: string[],
): void {
  if (schema.type === 'object') {
    if (!isRecord(input)) {
      errors.push(`${path || 'arguments'} must be an object`);
      return;
    }

    const value = input as ToolArgs;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${asPath(path, key)} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`unexpected property ${path ? `${path}.` : ''}${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) validateToolArguments(value[key], childSchema, asPath(path, key), errors);
    }
    return;
  }

  if (schema.type === 'string') {
    if (typeof input !== 'string') {
      errors.push(`${path || 'arguments'} must be a string`);
      return;
    }
    if (typeof schema.minLength === 'number' && input.length < schema.minLength) {
      errors.push(`${path || 'arguments'} must be at least ${schema.minLength} chars`);
    }
    if (typeof schema.maxLength === 'number' && input.length > schema.maxLength) {
      errors.push(`${path || 'arguments'} must be at most ${schema.maxLength} chars`);
    }
    if (schema.enum && !schema.enum.includes(input)) {
      errors.push(`${path || 'arguments'} must be one of ${schema.enum.join(', ')}`);
    }
    return;
  }

  if (schema.type === 'number') {
    if (typeof input !== 'number' || Number.isNaN(input)) {
      errors.push(`${path || 'arguments'} must be a number`);
    }
    return;
  }

  if (schema.type === 'boolean') {
    if (typeof input !== 'boolean') errors.push(`${path || 'arguments'} must be a boolean`);
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(input)) {
      errors.push(`${path || 'arguments'} must be an array`);
      return;
    }
    if (typeof schema.minItems === 'number' && input.length < schema.minItems) {
      errors.push(`${path || 'arguments'} must include at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && input.length > schema.maxItems) {
      errors.push(`${path || 'arguments'} must include at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      input.forEach((entry, index) => {
        validateToolArguments(entry, schema.items!, asPath(path || 'arguments', String(index)), errors);
      });
    }
    return;
  }

  if (schema.enum && input !== undefined && !schema.enum.includes(input)) {
    errors.push(`${path || 'arguments'} must be one of ${schema.enum.join(', ')}`);
  }
}

export function validateArgsForTool(toolName: string, args: unknown): string[] {
  const tool = (listMcpTools() as McpToolDefinition[]).find((entry) => entry.name === toolName);
  if (!tool) return ['tool definition not found'];
  const errors: string[] = [];
  validateToolArguments(args, tool.inputSchema, '', errors);
  return errors;
}
