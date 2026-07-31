import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/routes/chat-control-routes.ts', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/chat-control-service.ts', import.meta.url), 'utf8');

for (const forbidden of ['../runtime/state', '../chat-runtime-state', 'createActionEvent', 'getActionEvent', 'runUndo']) {
  assert.equal(route.includes(forbidden), false, `route must not own ${forbidden}`);
}
assert.equal(service.includes('repository.setRunState'), true);
assert.equal(service.includes('repository.setRunController'), true);
assert.equal(service.includes('repository.completeScopedIdempotencyReservation'), true);
assert.equal(index.includes('setRunState('), false, 'index must not mutate chat run state');
assert.equal(index.includes('runUndo('), false, 'index must not execute undo');
assert.equal(index.includes('createActionEvent('), false, 'index must not create actions');
assert.equal(index.includes('/chat/send'), false, 'index must not own /chat/send');
assert.equal(index.includes('parseChatSend'), false, 'index must not own chat request parsing');

console.log('PASS server/test/chat-control-boundary-contract.ts');
