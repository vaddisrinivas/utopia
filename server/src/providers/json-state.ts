import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

function ensureDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function quarantinePath(path: string) {
  const extension = extname(path);
  const stem = extension ? basename(path, extension) : basename(path);
  const suffix = `${Date.now()}-${process.pid}`;
  return join(dirname(path), `${stem}.corrupt-${suffix}${extension || '.json'}`);
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fsyncPath(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function acquireLock(path: string, input: {
  timeoutMs?: number;
  staleMs?: number;
} = {}) {
  const lockPath = `${path}.lock`;
  const timeoutMs = input.timeoutMs ?? 5_000;
  const staleMs = input.staleMs ?? 30_000;
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, 'owner'), JSON.stringify({
        pid: process.pid,
        acquired_at: new Date().toISOString(),
      }), 'utf-8');
      return () => {
        rmSync(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      try {
        const stats = statSync(lockPath);
        if ((Date.now() - stats.mtimeMs) > staleMs) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if ((Date.now() - startedAt) > timeoutMs) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Timed out waiting for JSON state lock ${lockPath}: ${detail}`);
      }
      sleepSync(10);
    }
  }
}

export function readJsonStateFile<T>(path: string, input: {
  label: string;
  validate: (value: unknown) => value is T;
}): T {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!input.validate(parsed)) {
      throw new Error(`${input.label} schema validation failed`);
    }
    return parsed;
  } catch (error) {
    const quarantined = quarantinePath(path);
    try {
      renameSync(path, quarantined);
    } catch (renameError) {
      const reason = renameError instanceof Error ? renameError.message : String(renameError);
      throw new Error(`Corrupt ${input.label} at ${path}; quarantine failed: ${reason}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Corrupt ${input.label} at ${path}; quarantined to ${quarantined}: ${detail}`);
  }
}

export function writeJsonStateFileAtomic(path: string, value: unknown) {
  ensureDir(path);
  const tmpPath = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  const fd = openSync(tmpPath, 'w');
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2), 'utf-8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmpPath, path);
    fsyncPath(dirname(path));
  } finally {
    rmSync(tmpPath, { force: true });
  }
}

export function mutateJsonStateFile<T>(path: string, input: {
  label: string;
  validate: (value: unknown) => value is T;
  createDefault: () => T;
  mutate: (current: T) => T;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}): T {
  ensureDir(path);
  const release = acquireLock(path, {
    timeoutMs: input.lockTimeoutMs,
    staleMs: input.staleLockMs,
  });
  try {
    const current = (() => {
      try {
        return readJsonStateFile(path, {
          label: input.label,
          validate: input.validate,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`Corrupt ${input.label}`)) {
          return input.createDefault();
        }
        throw error;
      }
    })();
    const next = input.mutate(current);
    writeJsonStateFileAtomic(path, next);
    return next;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      const next = input.mutate(input.createDefault());
      writeJsonStateFileAtomic(path, next);
      return next;
    }
    throw error;
  } finally {
    release();
  }
}
