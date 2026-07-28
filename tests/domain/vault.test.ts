import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { AppInstallation, InstallationPackageState } from '@/packages/shared/contracts/app-installation';
import type { Operation } from '@/packages/shared/contracts/operation';
import type { CanonicalRecord } from '@/packages/shared/contracts/records';
import {
  buildOperationStreamDesign,
  buildRegistryInstallDescriptor,
  exportEncryptedWorkspaceVault,
  exportEncryptedPackageVault,
  parseVaultExport,
  previewEncryptedWorkspaceVault,
  previewEncryptedPackageVault,
  restoreEncryptedPackageVault,
  restoreEncryptedWorkspaceVault,
  serializeVaultExport,
  validateOperationStreamDesign,
} from '@/src/domain/package-sharing';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const validPackage = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));

describe('Phase 7 encrypted vault', () => {
  it('exports a private encrypted package backup and restores a preview', () => {
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
    });
    const vault = exportEncryptedPackageVault({
      packageJson: validPackage,
      installDescriptor: descriptor,
      passphrase: 'correct horse battery phase7',
      now: '2026-07-28T00:00:00.000Z',
    });

    const serialized = JSON.stringify(vault);
    expect(serialized).not.toContain('Demo Shelf');
    expect(serialized).not.toContain('demo.shelf');
    expect(serialized).not.toContain('correct horse battery phase7');

    const preview = previewEncryptedPackageVault({
      vault,
      passphrase: 'correct horse battery phase7',
    });
    expect(preview.installDescriptor).toEqual(descriptor);
    expect((preview.packageJson as { id: string }).id).toBe('demo.shelf');
  });

  it('fails closed on wrong passphrase or tampered checksum', () => {
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
    });
    const vault = exportEncryptedPackageVault({
      packageJson: validPackage,
      installDescriptor: descriptor,
      passphrase: 'correct horse battery phase7',
    });

    expect(() => previewEncryptedPackageVault({
      vault,
      passphrase: 'wrong horse battery phase7',
    })).toThrow();
    expect(() => previewEncryptedPackageVault({
      vault: { ...vault, packageChecksum: `sha256:${'0'.repeat(64)}` },
      passphrase: 'correct horse battery phase7',
    })).toThrow('vault_package_checksum_mismatch');
  });

  it('fails closed on malformed, truncated, and unknown-version envelopes', () => {
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/release-1/apps/demo.package.json',
    });
    const vault = exportEncryptedPackageVault({
      packageJson: validPackage,
      installDescriptor: descriptor,
      passphrase: 'correct horse battery phase7',
      now: '2026-07-28T00:00:00.000Z',
    });

    expect(() => previewEncryptedPackageVault({
      vault: { ...vault, schemaVersion: 'utopia.package-vault.v999' as typeof vault.schemaVersion },
      passphrase: 'correct horse battery phase7',
    })).toThrow('vault_schema_invalid');
    expect(() => previewEncryptedPackageVault({
      vault: { ...vault, ciphertext: vault.ciphertext.slice(0, -4) },
      passphrase: 'correct horse battery phase7',
    })).toThrow();
    expect(() => previewEncryptedPackageVault({
      vault: { ...vault, iv: '%%%%' },
      passphrase: 'correct horse battery phase7',
    })).toThrow('vault_iv_invalid');
    expect(() => previewEncryptedPackageVault({
      vault: { ...vault, ciphertext: 'A'.repeat(12_000_000) },
      passphrase: 'correct horse battery phase7',
    })).toThrow('vault_ciphertext_invalid');
    expect(() => parseVaultExport('{"schemaVersion":"utopia.package-vault.v1"}')).toThrow('vault_crypto_params_invalid');
    expect(() => parseVaultExport('{nope')).toThrow('vault_export_json_invalid');
  });

  it('serializes and parses vault envelopes without leaking payload fields', () => {
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
    });
    const vault = exportEncryptedPackageVault({
      packageJson: validPackage,
      installDescriptor: descriptor,
      passphrase: 'correct horse battery phase7',
      now: '2026-07-28T00:00:00.000Z',
    });

    const serialized = serializeVaultExport(vault);
    expect(serialized).not.toContain('demo.shelf');
    expect(parseVaultExport(serialized)).toEqual(vault);
  });

  it('exports encrypted workspace backup with restore counts, checksums, and conflicts', () => {
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/main/apps/demo.package.json',
    });
    const installation: AppInstallation = {
      id: 'install-a',
      workspaceId: 'workspace-a',
      label: 'Demo Shelf',
      status: 'active',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    };
    const packageState: InstallationPackageState = {
      installationId: 'install-a',
      activePackageKey: 'demo.shelf@1.0.0',
      previousPackageKey: null,
      updatedAt: '2026-07-28T00:00:00.000Z',
    };
    const records = [record('item-a', 'Apples'), record('item-b', 'Bananas')];
    const stream = buildOperationStreamDesign({
      workspaceId: 'workspace-a',
      installationId: 'install-a',
      entries: [
        {
          cursor: '1',
          opId: 'op-item-a-create',
          recordId: 'item-a',
          createdAt: '2026-07-28T00:00:01.000Z',
          operation: operation('op-item-a-create', 'item-a', records[0]),
        },
      ],
    });

    const vault = exportEncryptedWorkspaceVault({
      workspaceId: 'workspace-a',
      workspaceLabel: 'Family kitchen',
      installations: [installation],
      packageStates: [packageState],
      installDescriptors: [descriptor],
      records,
      operationStreams: [stream],
      passphrase: 'workspace phase7 passphrase',
      now: '2026-07-28T00:00:02.000Z',
    });

    const serialized = JSON.stringify(vault);
    expect(serialized).not.toContain('Family kitchen');
    expect(serialized).not.toContain('Apples');
    expect(serialized).not.toContain('op-item-a-create');

    const preview = previewEncryptedWorkspaceVault({
      vault,
      passphrase: 'workspace phase7 passphrase',
      current: {
        installations: [{ ...installation, label: 'Different label' }],
        records: [{ ...records[0], title: 'Different apples' }],
        operationStreams: [buildOperationStreamDesign({
          workspaceId: 'workspace-a',
          installationId: 'install-a',
          entries: [
            {
              cursor: '1',
              opId: 'op-item-a-create',
              recordId: 'item-a',
              createdAt: '2026-07-28T00:00:01.000Z',
              operation: operation('op-item-a-create', 'item-a', records[0]),
            },
            {
              cursor: '2',
              opId: 'op-item-b-create',
              recordId: 'item-b',
              createdAt: '2026-07-28T00:00:02.000Z',
              operation: operation('op-item-b-create', 'item-b', records[1]),
            },
          ],
        })],
      },
    });

    expect(preview.counts).toEqual({
      installations: 1,
      packageStates: 1,
      installDescriptors: 1,
      records: 2,
      operationStreams: 1,
      operations: 1,
    });
    expect(preview.checksums.payload).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(preview.conflicts.map((conflict) => `${conflict.kind}:${conflict.reason}`).sort()).toEqual([
      'installation:checksum_mismatch',
      'operation_stream:cursor_regression',
      'record:checksum_mismatch',
    ]);

    expect(() => restoreEncryptedWorkspaceVault({
      vault,
      passphrase: 'workspace phase7 passphrase',
      current: {
        installations: [{ ...installation, label: 'Different label' }],
        records: [{ ...records[0], title: 'Different apples' }],
        operationStreams: [buildOperationStreamDesign({
          workspaceId: 'workspace-a',
          installationId: 'install-a',
          entries: [
            {
              cursor: '1',
              opId: 'op-item-a-create',
              recordId: 'item-a',
              createdAt: '2026-07-28T00:00:01.000Z',
              operation: operation('op-item-a-create', 'item-a', records[0]),
            },
            {
              cursor: '2',
              opId: 'op-item-b-create',
              recordId: 'item-b',
              createdAt: '2026-07-28T00:00:02.000Z',
              operation: operation('op-item-b-create', 'item-b', records[1]),
            },
          ],
        })],
      },
    })).toThrow('vault_restore_conflicts_present');

    const restored = restoreEncryptedWorkspaceVault({
      vault,
      passphrase: 'workspace phase7 passphrase',
      policy: 'backup_wins',
    });
    expect(restored.payload.workspace).toEqual({
      id: 'workspace-a',
      label: 'Family kitchen',
      exportedAt: '2026-07-28T00:00:02.000Z',
    });
    expect(restored.counts.operations).toBe(1);
  });

  it('validates operation stream checksums and cursor ordering', () => {
    const item = record('item-a', 'Apples');
    const stream = buildOperationStreamDesign({
      installationId: 'install-a',
      entries: [
        {
          cursor: '1',
          opId: 'op-item-a-create',
          recordId: 'item-a',
          createdAt: '2026-07-28T00:00:01.000Z',
          operation: operation('op-item-a-create', 'item-a', item),
        },
      ],
    });

    expect(validateOperationStreamDesign(stream)).toEqual(stream);
    expect(() => validateOperationStreamDesign({
      ...stream,
      entries: [
        stream.entries[0],
        { ...stream.entries[0], opId: 'op-late', cursor: '1', operation: operation('op-late', 'item-a', item) },
      ],
      checkpointChecksum: stream.checkpointChecksum,
    })).toThrow('operation_stream_cursor_regression');
  });

  it('restores a package payload after preview', () => {
    const descriptor = buildRegistryInstallDescriptor({
      packageJson: validPackage,
      name: 'Demo Shelf',
      url: 'https://raw.githubusercontent.com/utopia/utopia-packages/release-1/apps/demo.package.json',
    });
    const vault = exportEncryptedPackageVault({
      packageJson: validPackage,
      installDescriptor: descriptor,
      passphrase: 'correct horse battery phase7',
    });

    expect(restoreEncryptedPackageVault({
      vault,
      passphrase: 'correct horse battery phase7',
    }).installDescriptor).toEqual(descriptor);
  });
});

function record(id: string, title: string): CanonicalRecord {
  return {
    id,
    domain: 'food',
    collection: 'inventory',
    title,
    properties: { body: title },
    relations: [],
    source: {
      provider: 'sqlite',
      external_id: id,
      url: null,
      observed_at: '2026-07-28T00:00:00.000Z',
      content_hash: null,
    },
    archived_at: null,
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
    revision: 1,
    schema_version: 'food.v1',
    deleted: false,
    privacy: 'shared',
    provenance: null,
  };
}

function operation(opId: string, recordId: string, item: CanonicalRecord): Operation {
  return {
    op_id: opId,
    kind: 'create',
    domain: item.domain,
    collection: item.collection,
    record_id: recordId,
    record: item,
    actor: 'user',
    origin: 'share',
    reason: `Share ${item.title}`,
  };
}
