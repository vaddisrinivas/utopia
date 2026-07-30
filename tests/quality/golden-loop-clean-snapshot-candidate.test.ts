import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const scriptPath = join(root, 'scripts/quality/golden-loop/run-clean-snapshot-candidate.mjs');
const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true });
});

describe('Golden Loop clean snapshot candidate', () => {
  it('creates a temporary commit candidate without staging the main index', () => {
    const outPath = join(tmpdir(), `utopia-clean-snapshot-${process.pid}-${Date.now()}.json`);
    tempFiles.push(outPath);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        UTOPIA_CLEAN_SNAPSHOT_CANDIDATE_PATH: outPath,
      },
    });

    expect(result.status).toBe(0);
    expect(existsSync(outPath)).toBe(true);
    const evidence = JSON.parse(readFileSync(outPath, 'utf8')) as {
      status: string;
      snapshot: {
        touches_main_index: boolean;
        commit: string | null;
        tree: string | null;
      };
      commands: Array<{ id: string; status: number }>;
    };
    expect(evidence.status).toBe('CANDIDATE_PASS');
    expect(evidence.snapshot.touches_main_index).toBe(false);
    expect(evidence.snapshot.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.snapshot.tree).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.commands.map((command) => command.id)).toEqual([
      'read_tree_head',
      'add_current_filesystem',
      'write_tree',
      'commit_tree',
    ]);
  });
});
