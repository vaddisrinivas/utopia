import { mutateJsonStateFile } from '../../src/providers/json-state';

const path = process.env.JSON_STATE_CONCURRENCY_PATH;
const loops = Number(process.env.JSON_STATE_CONCURRENCY_LOOPS ?? '25');

if (!path) {
  throw new Error('JSON_STATE_CONCURRENCY_PATH is required');
}

for (let index = 0; index < loops; index += 1) {
  mutateJsonStateFile(path, {
    label: 'concurrency test state',
    validate: (value): value is { version: 1; count: number } => {
      return Boolean(value)
        && typeof value === 'object'
        && (value as { version?: unknown }).version === 1
        && typeof (value as { count?: unknown }).count === 'number';
    },
    createDefault: () => ({ version: 1 as const, count: 0 }),
    mutate: (current) => ({
      version: 1 as const,
      count: current.count + 1,
    }),
  });
}
