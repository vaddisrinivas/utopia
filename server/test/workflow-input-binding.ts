import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowDependencyResult } from '../src/tools/catalog';
import type { WorkflowDocument } from '../src/runtime/state';

function ensure(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(join(tmpdir(), 'utopia-workflow-binding-'));
process.env.WONDER_RUNTIME_STATE_PATH = join(tempDir, 'wonder-runtime.json');
process.env.LIFEOS_WORKFLOW_CHECKPOINT_PATH = join(tempDir, 'workflow-runs.json');

const { bindWorkflowStepInput, runWorkflow } = await import('../src/tools/catalog');

try {
  const completed: WorkflowDependencyResult[] = [
  {
    step_id: 'read_plan',
    output: 'meal_plan',
    result: { records: ['meal-1'] },
  },
  {
    step_id: 'read_kitchen',
    output: 'available_inventory',
    result: { records: ['inventory-1'] },
  },
  ];

  const bound = bindWorkflowStepInput(
    {
      input_from: ['read_plan', 'read_kitchen'],
      input: {
        mode: 'strict',
        meal_plan: { records: ['explicit-override'] },
      },
    },
    completed,
  );

  ensure(bound.ok, 'Expected completed dependencies to bind.');
  ensure(
    JSON.stringify(bound.bindings.meal_plan) === JSON.stringify({ records: ['meal-1'] }),
    'Expected dependency result to bind under its declared output name.',
  );
  ensure(
    JSON.stringify(bound.input.available_inventory) === JSON.stringify({ records: ['inventory-1'] }),
    'Expected every dependency output to reach tool input.',
  );
  ensure(
    JSON.stringify(bound.input.meal_plan) === JSON.stringify({ records: ['explicit-override'] }),
    'Expected explicit step input to override a bound dependency deterministically.',
  );
  ensure(bound.input.mode === 'strict', 'Expected explicit input to survive binding.');

  const fallbackName = bindWorkflowStepInput(
    { input_from: ['read_plan'], input: {} },
    [{ step_id: 'read_plan', result: { count: 2 } }],
  );
  ensure(fallbackName.ok, 'Expected dependency without output alias to bind.');
  ensure(fallbackName.input.count === 2, 'Expected object dependency fields to reach tool input.');
  ensure(
    JSON.stringify(fallbackName.input.read_plan) === JSON.stringify({ count: 2 }),
    'Expected step id to be the fallback binding name.',
  );

  const missing = bindWorkflowStepInput(
    { input_from: ['read_plan', 'not_run'], input: { mode: 'safe' } },
    completed,
  );
  ensure(!missing.ok, 'Expected missing dependency to reject binding.');
  ensure(!missing.ok && missing.missing.join(',') === 'not_run', 'Expected exact missing dependency receipt.');
  ensure(missing.input.mode === 'safe', 'Expected explicit input in missing-dependency receipt.');

  const workflow: WorkflowDocument = {
    schema_version: 'utopia.workflow.v1',
    id: 'workflow_input_binding_probe',
    domain: 'food',
    label: 'Workflow input binding probe',
    write_policy: 'reversible',
    steps: [
      {
        id: 'create',
        tool: 'create_record',
        output: 'created_record',
        input: {
          id: 'workflow-input-binding-record',
          domain: 'food',
          collection: 'recipe',
          title: 'Workflow input binding record',
        },
      },
      {
        id: 'archive',
        tool: 'archive_record',
        input_from: ['create'],
        output: 'archived_record',
      },
    ],
  };
  const runtime = await runWorkflow(
    workflow,
    'workflow-contract',
    {
      seenWorkflows: new Set<string>(),
      visitedRecords: new Set<string>(),
    },
  );
  ensure(runtime.status === 'ok', `Expected bound workflow to complete, got ${runtime.status}.`);
  ensure(runtime.details?.[1]?.status === 'ok', 'Expected downstream archive to consume upstream record id.');
  ensure(
    runtime.stepResult.outputs?.created_record != null,
    'Expected named create output in workflow receipt.',
  );
  ensure(
    runtime.stepResult.outputs?.archived_record != null,
    'Expected named downstream output in workflow receipt.',
  );

  console.log('PASS server/test/workflow-input-binding.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
