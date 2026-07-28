import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deleteHealthSnapshot, exportHealthSnapshots, listHealthSnapshots, saveHealthSnapshot } from '../src/health/snapshots';

const dir = mkdtempSync(join(tmpdir(), 'utopia-health-snapshot-'));
const path = join(dir, 'snapshots.json');
const previous = process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH;
process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH = path;

try {
  const input = {
    availability: 'available',
    granted: ['read:Steps', 'read:Weight'],
    observedAt: '2026-07-22T23:00:00.000Z',
    range: { startTime: '2026-07-21T23:00:00.000Z', endTime: '2026-07-22T23:00:00.000Z' },
    records: { steps: [{ count: 4200 }], weight: [{ value: 80 }] },
  };
  const first = saveHealthSnapshot(input);
  const second = saveHealthSnapshot(input);
  if (!first.ok || first.status !== 'stored') throw new Error('first health snapshot should store');
  if (!second.ok || second.status !== 'duplicate') throw new Error('same health snapshot should dedupe');
  const rows = listHealthSnapshots();
  if (rows.length !== 1 || rows[0]?.record_counts.steps !== 1) throw new Error('health snapshot summary mismatch');
  const exported = exportHealthSnapshots();
  if (exported.length !== 1 || exported[0]?.records.steps.length !== 1) throw new Error('health snapshot export mismatch');
  const invalid = saveHealthSnapshot({ ...input, range: { startTime: input.range.endTime, endTime: input.range.startTime } });
  if (invalid.ok || invalid.status !== 'invalid') throw new Error('reversed health range should be rejected');
  const deleted = deleteHealthSnapshot(rows[0]!.id);
  if (!deleted.ok || deleted.status !== 'deleted' || listHealthSnapshots().length !== 0) {
    throw new Error('health snapshot delete mismatch');
  }
  console.log('PASS server/test/health-snapshot-sync.ts');
} finally {
  if (previous === undefined) delete process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH;
  else process.env.LIFEOS_HEALTH_SNAPSHOTS_PATH = previous;
  rmSync(dir, { recursive: true, force: true });
}
