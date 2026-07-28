import { executeProviderUndo, type ProviderUndoInput } from './undo';

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    throw new Error('Provider undo payload argument is required.');
  }
  const input = JSON.parse(raw) as ProviderUndoInput;
  const result = await executeProviderUndo(input);
  process.stdout.write(JSON.stringify(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(JSON.stringify({ ok: false, message }));
  process.exitCode = 1;
});
