import assert from 'node:assert/strict';
import { canTransitionWorkflow, transitionWorkflow } from '../src/workflows/control-machine';

assert.equal(transitionWorkflow('running', 'PAUSE'), 'paused');
assert.equal(transitionWorkflow('paused', 'RESUME'), 'running');
assert.equal(transitionWorkflow('running', 'CANCEL'), 'cancelled');
assert.equal(transitionWorkflow('failed', 'COMPENSATE'), 'compensating');
assert.equal(transitionWorkflow('compensating', 'COMPENSATED'), 'compensated');
assert.equal(canTransitionWorkflow('completed', 'CANCEL'), false);
assert.equal(transitionWorkflow('completed', 'CANCEL'), 'completed');
console.log('workflow-control-machine: passed');
