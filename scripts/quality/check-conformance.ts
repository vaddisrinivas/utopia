import { runConformanceSuite } from '@/packages/conformance/src/conformance-harness';

async function main(): Promise<void> {
  const checks = await runConformanceSuite();
  const failures = checks.filter((entry) => entry.status === 'fail');
  const blocked = checks.filter((entry) => entry.status === 'blocked');

  for (const check of checks) {
    const detail = check.details.length ? ` - ${check.details.join(' | ')}` : '';
    console.log(`[${check.status.toUpperCase()}] ${check.name}${detail}`);
  }

  if (failures.length > 0) {
    console.error(`Conformance failed (${failures.length} checks): ${failures.map((check) => check.name).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (blocked.length > 0) {
    console.log(`Conformance blocked by unimplemented runtimes (${blocked.length}): ${blocked.map((check) => check.name).join(', ')}`);
  }

  console.log('Conformance suite complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
