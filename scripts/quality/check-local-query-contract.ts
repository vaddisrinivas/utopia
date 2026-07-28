import { execSync } from 'node:child_process';

try {
  execSync('./server/node_modules/.bin/tsx --tsconfig tsconfig.json server/test/local-query-contract.ts', {
    stdio: 'inherit',
  });
  execSync('./server/node_modules/.bin/tsx --tsconfig tsconfig.json scripts/quality/check-local-query-server-contract.ts', {
    stdio: 'inherit',
  });
  console.log('localQuery contract checks: passed');
} catch {
  console.error('localQuery contract checks: failed');
  process.exit(1);
}
