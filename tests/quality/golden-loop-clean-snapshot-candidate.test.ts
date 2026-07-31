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
  const runCandidate = (outPath: string) => {
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
    tempFiles.push(outPath);

    return JSON.parse(readFileSync(outPath, 'utf8')) as {
      status: string;
      git: { head: string | null; fullHead: string | null };
      snapshot: {
        touches_main_index: boolean;
        commit: string | null;
        tree: string | null;
        tree_reproducible: boolean;
      };
      source_git: { head: string | null; fullHead: string | null };
      commands: Array<{
        id: string;
        command: string[];
        status: number;
        exit_code: number;
        result: 'PASS' | 'FAIL';
        stdout_tail: string;
        stderr_tail: string;
      }>;
    };
  };

  it('creates a temporary tree-only snapshot candidate and rejects main-index edits', () => {
    const outPath = join(tmpdir(), `utopia-clean-snapshot-${process.pid}-${Date.now()}.json`);
    const evidence = runCandidate(outPath);

    expect(evidence.status).toBe('CANDIDATE_PASS');
    expect(evidence.snapshot.touches_main_index).toBe(false);
    expect(evidence.snapshot.commit).toBeNull();
    expect(evidence.snapshot.tree).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.snapshot.tree_reproducible).toBe(true);
    expect(evidence.commands.map((command) => command.id)).toEqual([
      'read_tree_head',
      'add_current_filesystem',
      'write_tree',
      'write_tree_reproducibility',
    ]);
    expect(evidence.commands[0].command).toEqual(['git', 'read-tree', 'HEAD']);
    expect(evidence.commands[0].status).toBe(0);
    expect(evidence.commands[0].exit_code).toBe(0);
    expect(evidence.commands[0].result).toBe('PASS');
    expect(evidence.source_git?.head).toBe(evidence.git.head);
    expect(
      evidence.commands.some(
        ({ stdout_tail, stderr_tail }) => String(stdout_tail).includes(root) || String(stderr_tail).includes(root),
      ),
    ).toBe(false);
  });

  it('reproduces the same snapshot tree on repeated runs', () => {
    const firstPath = join(tmpdir(), `utopia-clean-snapshot-${process.pid}-first-${Date.now()}.json`);
    const secondPath = join(tmpdir(), `utopia-clean-snapshot-${process.pid}-second-${Date.now()}.json`);
    const first = runCandidate(firstPath);
    const second = runCandidate(secondPath);

    expect(first.snapshot.tree).toBeDefined();
    expect(second.snapshot.tree).toBeDefined();
    expect(first.snapshot.tree).toBe(second.snapshot.tree);
    expect(second.snapshot.tree_reproducible).toBe(true);
  });
});
