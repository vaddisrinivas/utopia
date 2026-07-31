import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  checkReceipt,
  findDebugMarkers,
  inspectArtifacts,
  RELEASE_ARTIFACTS,
} from '../../scripts/quality/release/check-local-release-artifacts.mjs';

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'utopia-release-artifacts-'));
  for (const path of Object.values(RELEASE_ARTIFACTS)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, 'unsigned test artifact');
  }
  return root;
}

describe('local release artifact receipt', () => {
  it('blocks missing APK/AAB before any signature claim', () => {
    const root = fixtureRoot();
    rmSync(join(root, RELEASE_ARTIFACTS.aab));
    const result = inspectArtifacts(root);
    expect(result.issues).toEqual(expect.arrayContaining([
      `missing:${RELEASE_ARTIFACTS.aab}`,
    ]));
  });

  it('blocks unsigned artifacts and never treats test bytes as signed proof', () => {
    const root = fixtureRoot();
    const result = inspectArtifacts(root);
    expect(result.issues.some((issue) => issue === 'missing:apksigner' || issue === 'apk_unsigned_or_debug:unsigned')).toBe(true);
    expect(result.issues.some((issue) => issue.includes('unsigned'))).toBe(true);
  });

  it('finds Golden Loop debug markers in release artifact bytes', () => {
    const root = fixtureRoot();
    const apk = join(root, RELEASE_ARTIFACTS.apk);
    writeFileSync(apk, Buffer.from(`release ${'GoldenLoopDebugBridge'}`));
    const inspected = inspectArtifacts(root);
    expect(inspected.debugMarkers).toContain(`${RELEASE_ARTIFACTS.apk}:GoldenLoopDebugBridge`);
  });

  it('blocks absent and stale receipts', () => {
    const root = fixtureRoot();
    expect(checkReceipt(root)).toContain('missing:local_release_artifact_receipt');
    const receiptPath = join(root, 'app/build/evidence/local-release-artifact-receipt.json');
    mkdirSync(join(receiptPath, '..'), { recursive: true });
    writeFileSync(receiptPath, JSON.stringify({ proof: 'utopia_local_release_artifact_receipt', status: 'passed' }));
    expect(checkReceipt(root)).toEqual(expect.arrayContaining(['invalid:checked_at', 'stale:git.head']));
  });

  it('binds receipt hash expectations to actual file bytes', () => {
    const root = fixtureRoot();
    const apk = join(root, RELEASE_ARTIFACTS.apk);
    const hash = createHash('sha256').update('unsigned test artifact').digest('hex');
    expect(hash).toHaveLength(64);
    writeFileSync(apk, 'changed');
    expect(findDebugMarkers(root, {
      apk: { path: RELEASE_ARTIFACTS.apk, absolutePath: apk, issues: [], sha256: hash, bytes: 21 },
      aab: { path: RELEASE_ARTIFACTS.aab, absolutePath: join(root, RELEASE_ARTIFACTS.aab), issues: [], sha256: hash, bytes: 21 },
    })).toEqual([]);
  });
});
