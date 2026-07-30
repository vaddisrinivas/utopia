import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileAppPackageSource } from '@/packages/app-compiler';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import type { AppPackage } from '@/packages/shared/contracts/package';
import { getActiveAppPackage } from '@/src/db/app-package-registry';
import { getRecordForInstallation } from '@/src/db/records';
import { runMigrations } from '@/src/db/migrations';
import { executeGoldenLoopDebugCommand } from '@/src/quality/golden-loop-debug-handler';
import {
  type GoldenLoopDebugCommand,
  getGoldenLoopDebugToken,
  isGoldenLoopDebugEnabled,
  validateGoldenLoopDebugCommand,
} from '@/src/quality/golden-loop-debug-protocol';
import { normalizeModelSource } from '@/scripts/factory/generate-app-from-prompt';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const token = '0123456789abcdef0123456789abcdef';
const installationId = 'golden-loop-real-shell-test';
const fixturePath = path.resolve('tests/fixtures/golden-loop/shared-household-board.source.json');
const rawSource = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

function command(
  name: GoldenLoopDebugCommand['command'],
  operationId: string,
  args?: Record<string, unknown>,
): GoldenLoopDebugCommand {
  return {
    mode: 'goldenLoopDebug',
    command: name,
    installation_id: installationId,
    operation_id: operationId,
    authorization_token: token,
    ...(args ? { arguments: args } : {}),
  };
}

function packageFixture(version: '1.0.0' | '1.1.0' = '1.0.0'): AppPackage {
  const source = normalizeModelSource(rawSource, 'Build a shared household board.');
  const compiled = compileAppPackageSource(source);
  if (!compiled.valid) throw new Error('golden_loop_fixture_compile_failed');
  const pkg = structuredClone(compiled.package);
  pkg.version = version;
  if (version === '1.1.0') {
    pkg.collections.task.fields.priority = { type: 'text', required: false, indexed: true };
  }
  return pkg;
}

describe('golden loop debug shell bridge', () => {
  const databases: NodeSqliteDb[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('is disabled unless the explicit public debug flag and long token are set', () => {
    expect(isGoldenLoopDebugEnabled({})).toBe(false);
    expect(isGoldenLoopDebugEnabled({ EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG: '1' })).toBe(true);
    expect(getGoldenLoopDebugToken({
      EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN: 'short',
    })).toBeNull();
    expect(getGoldenLoopDebugToken({
      EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN: token,
    })).toBe(token);
    expect(() => validateGoldenLoopDebugCommand(command('package.install', 'install'), 'wrong-token'))
      .toThrow('golden_loop_debug_token_mismatch');
  });

  it('executes package, record, update, rollback, recovery, consent, and checksum commands through real db services', async () => {
    const db = new NodeSqliteDb();
    databases.push(db);
    await runMigrations(db as never);
    const now = (() => {
      let tick = 0;
      return () => `2026-07-30T00:00:${String(tick++).padStart(2, '0')}.000Z`;
    })();

    const v1 = packageFixture('1.0.0');
    const v2 = packageFixture('1.1.0');
    const install = await executeGoldenLoopDebugCommand(db as never, command('package.install', 'install', {
      package_json: v1,
      source_url: 'https://utoia.thetechcruise.com/p/shared-household-board.json',
    }), {
      expectedToken: token,
      now,
    });
    expect(install).toMatchObject({ status: 'applied', package_version: '1.0.0' });

    const write = await executeGoldenLoopDebugCommand(db as never, command('record.write', 'write-1', {
      record_id: 'task-1',
      field_values_hash: 'sha256:abc',
    }), { expectedToken: token, now });
    expect(write).toMatchObject({ status: 'applied' });
    await expect(getRecordForInstallation(db as never, installationId, 'task-1')).resolves.toMatchObject({
      id: 'task-1',
      collection: 'task',
      properties: {
        field_values_hash: 'sha256:abc',
      },
    });

    const update = await executeGoldenLoopDebugCommand(db as never, command('package.update', 'update', {
      package_json: v2,
      source_url: 'https://utoia.thetechcruise.com/p/shared-household-board-1.1.0.json',
    }), {
      expectedToken: token,
      now,
    });
    expect(update).toMatchObject({ status: 'applied', package_version: '1.1.0' });
    await expect(getActiveAppPackage(db as never, installationId)).resolves.toMatchObject({ version: '1.1.0' });

    const grant = await executeGoldenLoopDebugCommand(db as never, command('capability.grant', 'grant', {
      capability: 'debug.local-sync',
      scope: ['golden-loop'],
    }), { expectedToken: token, now });
    expect(grant).toMatchObject({ status: 'applied' });
    expect(grant.capability_record_id).toMatch(/^sha256:/);

    const revoke = await executeGoldenLoopDebugCommand(db as never, command('capability.revoke', 'revoke', {
      capability: 'debug.local-sync',
      scope: ['golden-loop'],
    }), { expectedToken: token, now });
    expect(revoke).toMatchObject({ status: 'applied', capability_record_id: grant.capability_record_id });

    const backup = await executeGoldenLoopDebugCommand(db as never, command('backup.export', 'backup', {
      backup_id: 'before-reset',
    }), { expectedToken: token, now });
    expect(backup).toMatchObject({ status: 'applied', backup_id: 'before-reset' });
    expect(backup.count).toBeGreaterThan(0);

    const rollback = await executeGoldenLoopDebugCommand(db as never, command('package.rollback', 'rollback'), {
      expectedToken: token,
      now,
    });
    expect(rollback).toMatchObject({ status: 'applied', package_version: '1.0.0' });

    const checksumBeforeReset = await executeGoldenLoopDebugCommand(db as never, command('state.checksum', 'checksum-1'), {
      expectedToken: token,
      now,
    });
    expect(checksumBeforeReset).toMatchObject({ status: 'applied', count: 1 });

    const reset = await executeGoldenLoopDebugCommand(db as never, command('installation.reset', 'reset'), {
      expectedToken: token,
      now,
    });
    expect(reset).toMatchObject({ status: 'applied' });
    await expect(getActiveAppPackage(db as never, installationId)).resolves.toBeNull();

    const restore = await executeGoldenLoopDebugCommand(db as never, command('backup.restore', 'restore', {
      backup_id: 'before-reset',
    }), { expectedToken: token, now });
    expect(restore).toMatchObject({ status: 'applied', backup_id: 'before-reset' });

    const checksumAfterRestore = await executeGoldenLoopDebugCommand(db as never, command('state.checksum', 'checksum-2'), {
      expectedToken: token,
      now,
    });
    expect(checksumAfterRestore).toMatchObject({
      status: 'applied',
      count: 1,
      checksum: checksumBeforeReset.checksum,
    });
  });

  it('does not expose record contents in checksum receipts', async () => {
    const db = new NodeSqliteDb();
    databases.push(db);
    await runMigrations(db as never);
    await executeGoldenLoopDebugCommand(db as never, command('package.install', 'install', {
      package_json: packageFixture('1.0.0'),
      source_url: 'https://utoia.thetechcruise.com/p/shared-household-board.json',
    }), { expectedToken: token });
    await executeGoldenLoopDebugCommand(db as never, command('record.write', 'write-1', {
      record_id: 'task-private',
      title: 'Sensitive task',
      owner: 'Sensitive owner',
      field_values_hash: sha256Canonical({ redacted: true }),
    }), { expectedToken: token });

    const checksum = await executeGoldenLoopDebugCommand(db as never, command('state.checksum', 'checksum'), {
      expectedToken: token,
    });
    const serialized = JSON.stringify(checksum);
    expect(serialized).not.toContain('Sensitive task');
    expect(serialized).not.toContain('Sensitive owner');
    expect(checksum.checksum).toMatch(/^sha256:/);
  });
});
