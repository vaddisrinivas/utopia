import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPackageInstallApprovalReceipt, buildPackageInstallPreview } from '@/packages/shared/contracts/package-install';
import { getActiveAppPackage, getAppInstallation } from '@/src/db/app-package-registry';
import { runMigrations } from '@/src/db/migrations';
import {
  buildOperationStreamDesign,
  buildRegistryInstallDescriptor,
  buildShareInviteDescriptor,
  installSharedPackageInvite,
  validateOperationStreamDesign,
} from '@/src/domain/package-sharing';
import { NodeSqliteDb } from '@/tests/helpers/node-sqlite-db';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const validPackage = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));

describe('Phase 7 sharing bootstrap', () => {
  it('installs an invite descriptor into the target installation only', async () => {
    const db = new NodeSqliteDb() as any;
    await runMigrations(db);
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
    });
    const invite = buildShareInviteDescriptor({
      inviteId: 'invite-one',
      workspaceId: 'workspace-a',
      workspaceLabel: 'Family kitchen',
      targetInstallationId: 'shared-install-a',
      invitedBy: 'owner@example.test',
      invitedAt: '2026-07-28T00:00:00.000Z',
      installDescriptor: descriptor,
      operationStream: buildOperationStreamDesign({
        workspaceId: 'workspace-a',
        installationId: 'shared-install-a',
        cursor: '42',
        entries: [],
      }),
    });
    expect(invite.workspace).toEqual({ id: 'workspace-a', label: 'Family kitchen' });
    expect(validateOperationStreamDesign(invite.operationStream).cursor).toBe('42');
    const preview = buildPackageInstallPreview(validPackage, {
      sourceUrl: descriptor.url,
      registryPackage: descriptor,
    });
    const approval = buildPackageInstallApprovalReceipt(preview, 'recipient@example.test', '2026-07-28T00:00:01.000Z');

    const installation = await installSharedPackageInvite(db, {
      invite,
      packageJson: validPackage,
      approval,
      now: '2026-07-28T00:00:02.000Z',
    });

    expect(installation).toMatchObject({
      id: 'shared-install-a',
      workspaceId: 'workspace-a',
      label: 'Demo Shelf',
      status: 'active',
    });
    expect((await getAppInstallation(db, 'shared-install-a'))?.workspaceId).toBe('workspace-a');
    expect((await getActiveAppPackage(db, 'shared-install-a'))?.id).toBe('demo.shelf');
    expect(await getActiveAppPackage(db, 'default')).toBeNull();
    expect(await getAppInstallation(db, 'shared-install-b')).toBeNull();
    db.close();
  });
});
