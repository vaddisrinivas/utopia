import { appendFileSync } from 'node:fs';

const runtimePath = process.env.LIFEOS_REACTIVE_RUNTIME_PATH;
const resultPath = process.env.LIFEOS_REACTIVE_LEASE_RESULT_PATH;
const workerId = process.env.LIFEOS_REACTIVE_LEASE_WORKER_ID;
if (!runtimePath || !resultPath || !workerId) {
  throw new Error('reactive lease fixture env is incomplete');
}

const {
  startReactiveRuntimeWorker,
  stopReactiveRuntimeWorker,
} = await import('../../src/kernel/install-reactive-runtime');

startReactiveRuntimeWorker({
  path: runtimePath,
  executeProposal: async (item) => {
    appendFileSync(resultPath, `${workerId}:${item.proposalId}\n`, 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { ok: true };
  },
});

await new Promise((resolve) => setTimeout(resolve, 750));
stopReactiveRuntimeWorker();
