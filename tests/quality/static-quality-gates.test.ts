import { mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectDependencyDeadCodeOwnership } from '../../scripts/quality/check-dependency-dead-code-ownership.mjs';
import { inspectRendererServerSizeRatchet } from '../../scripts/quality/check-renderer-server-size-ratchet.mjs';

const root = process.cwd();

describe('static quality gates', () => {
  it('passes the committed ownership and dependency baseline', () => {
    const result = inspectDependencyDeadCodeOwnership(root);
    expect(result.status).toBe('PASS');
    expect(result.errors).toEqual([]);
  });

  it('fails closed when the ownership baseline is missing', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'utopia-ownership-'));
    mkdirSync(resolve(fixture, 'scripts/quality'), { recursive: true });
    cpSync(resolve(root, 'package.json'), resolve(fixture, 'package.json'));
    const result = inspectDependencyDeadCodeOwnership(fixture);
    expect(result.status).toBe('BLOCKED');
  });

  it('passes the committed renderer/server size ceilings', () => {
    const result = inspectRendererServerSizeRatchet(root);
    expect(result.status).toBe('PASS');
    expect(result.errors).toEqual([]);
  });

  it('fails closed when the size baseline is missing', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'utopia-size-'));
    mkdirSync(resolve(fixture, 'scripts/quality'), { recursive: true });
    writeFileSync(resolve(fixture, 'scripts/quality/renderer-server-size-baseline.json'), '{');
    const result = inspectRendererServerSizeRatchet(fixture);
    expect(result.status).toBe('BLOCKED');
  });
});
