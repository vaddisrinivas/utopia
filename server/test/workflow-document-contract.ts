import { listWorkflows } from '../src/runtime/state';

function ensure(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const workflows = listWorkflows();

const weeklyReset = workflows.find((workflow) => workflow.id === 'weekly_food_reset');
ensure(Boolean(weeklyReset), 'Expected weekly_food_reset workflow to load.');
ensure(weeklyReset?.trigger?.kind === 'schedule', 'Expected workflow trigger kind to survive loading.');
ensure(weeklyReset?.trigger?.expression === 'SUN 18:00', 'Expected workflow trigger expression to survive loading.');
ensure(weeklyReset?.trigger?.timezone === 'user', 'Expected workflow trigger timezone to survive loading.');

const mealPlan = workflows.find((workflow) => workflow.id === 'meal_plan_to_shopping');
ensure(Boolean(mealPlan), 'Expected meal_plan_to_shopping workflow to load.');

const calculateGaps = mealPlan?.steps.find((step) => step.id === 'calculate_gaps');
ensure(calculateGaps?.skill === 'food', 'Expected workflow skill to survive loading.');
ensure(
  calculateGaps?.input_from?.join(',') === 'read_plan,read_kitchen',
  'Expected workflow input_from dependencies to survive loading.',
);
ensure(calculateGaps?.output === 'ingredient_gaps', 'Expected workflow output binding to survive loading.');

const updateShopping = mealPlan?.steps.find((step) => step.id === 'update_shopping');
ensure(updateShopping?.tool === 'update_record', 'Expected workflow tool to survive loading.');
ensure(updateShopping?.input_from?.join(',') === 'calculate_gaps', 'Expected dependent input_from to survive loading.');
ensure(updateShopping?.output === 'shopping_changes', 'Expected dependent output to survive loading.');

console.log('PASS server/test/workflow-document-contract.ts');
