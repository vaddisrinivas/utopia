import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'utopia-workflow-checkpoint-'));
  process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH = join(tempDir, 'workflow-runs.json');

  try {
    const checkpoints = await import('../src/workflows/checkpoint');
    const runId = checkpoints.startWorkflowCheckpoint({
      workflowId: 'checkpoint-contract',
      domain: 'food',
      actor: 'hearth',
    });

    checkpoints.markWorkflowStep({
      runId,
      id: 'step-large',
      tool: 'utopia.large_result',
      status: 'ok',
      startedAt: '2026-07-26T00:00:00.000Z',
      finishedAt: '2026-07-26T00:00:01.000Z',
      result: {
        preview: 'x'.repeat(40),
        nested: {
          payload: 'z'.repeat(40 * 1024),
        },
      },
    });

    const stored = checkpoints.getWorkflowCheckpoint(runId);
    const result = stored?.steps[0]?.result as {
      truncated?: boolean;
      original_bytes?: number;
      preview_json?: string;
    } | undefined;

    assert(Boolean(result?.truncated), 'Expected oversized workflow step result to be truncated');
    assert((result?.original_bytes ?? 0) > 32 * 1024, 'Expected oversized workflow step result byte count');
    assert((result?.preview_json?.length ?? 0) <= 4 * 1024, 'Expected workflow preview json to stay bounded');

    if (!result) {
      throw new Error('Expected bounded checkpoint result');
    }
    result.preview_json = 'tampered';
    const reloaded = checkpoints.getWorkflowCheckpoint(runId);
    const reloadedResult = reloaded?.steps[0]?.result as { preview_json?: string } | undefined;
    assert(reloadedResult?.preview_json !== 'tampered', 'Expected checkpoint reads to deep clone nested result payloads');

    console.log('PASS server/test/workflow-checkpoint-contract.ts');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  process.exitCode = 1;
  throw error;
});
