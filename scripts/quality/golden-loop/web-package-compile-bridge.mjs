#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compileAppPackageSource,
  readAppPackageSourceFolder,
} from '../../../packages/app-compiler';

let rawInput = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  rawInput += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(rawInput || '{}');
    const sourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath : null;
    const version = typeof payload.version === 'string' ? payload.version : null;
    const addPriorityLane = Boolean(payload.addPriorityLane);

    const sourcePayload = (() => {
      if (payload.source !== undefined) return payload.source;
      if (sourcePath === null) return undefined;

      const resolvedSourcePath = resolve(process.cwd(), sourcePath);
      if (!existsSync(resolvedSourcePath)) {
        throw new Error(`app_compiler_bridge_missing_source_path:${resolvedSourcePath}`);
      }

      const stats = statSync(resolvedSourcePath);
      if (stats.isDirectory()) {
        return readAppPackageSourceFolder(resolvedSourcePath);
      }

      const rawSource = readFileSync(resolvedSourcePath, 'utf8');
      const source = JSON.parse(rawSource || '{}');
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('app_compiler_bridge_invalid_source_file');
      }
      return source;
    })();

    if (!sourcePayload || typeof sourcePayload !== 'object' || Array.isArray(sourcePayload)) {
      throw new Error('app_compiler_bridge_invalid_source');
    }

    let source = sourcePayload;
    if (version) {
      source = {
        ...source,
        app: {
          ...source.app,
          version,
        },
      };
    }

    if (addPriorityLane && source?.collections?.task?.fields) {
      const fields = source.collections.task.fields;
      if (!fields.priority_lane) {
        source = {
          ...source,
          collections: {
            ...source.collections,
            task: {
              ...source.collections.task,
              fields: {
                ...fields,
                priority_lane: {
                  type: 'text',
                  required: false,
                  indexed: true,
                },
              },
            },
          },
        };
      }
    }

    const result = compileAppPackageSource(source);
    if (!result.valid) {
      process.stdout.write(JSON.stringify({ valid: false, errors: result.errors }));
      process.exit(1);
    }

    process.stdout.write(JSON.stringify({
      valid: true,
      package: result.package,
      checksum: result.checksum,
      preview: result.preview,
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      valid: false,
      errors: [String(error instanceof Error ? error.message : error)],
    }));
    process.exit(1);
  }
});
