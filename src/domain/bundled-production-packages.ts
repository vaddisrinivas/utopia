import counterPackageJson from '@/apps/counter/counter.v1.json';
import inventoryQuantityPackageJson from '@/apps/inventory-quantity/inventory-quantity.v1.json';
import offlineChecklistPackageJson from '@/apps/offline-checklist/offline-checklist.v1.json';
import travelPackingListPackageJson from '@/apps/travel-packing-list/travel-packing-list.v1.json';
import shoppingListPackageJson from '@/apps/shopping-list/shopping-list.v1.json';
import pantryRestockPackageJson from '@/apps/pantry-restock/pantry-restock.v1.json';
import simpleTimeTrackerPackageJson from '@/apps/simple-time-tracker/simple-time-tracker.v1.json';
import billableProjectTimerPackageJson from '@/apps/billable-project-timer/billable-project-timer.v1.json';
import workLogPackageJson from '@/apps/work-log/work-log.v1.json';
import shiftLogPackageJson from '@/apps/shift-log/shift-log.v1.json';
import mileageLogPackageJson from '@/apps/mileage-log/mileage-log.v1.json';
import fuelLogPackageJson from '@/apps/fuel-log/fuel-log.v1.json';
import plantCarePackageJson from '@/apps/plant-care/plant-care.v1.json';
import petMedicationPackageJson from '@/apps/pet-medication/pet-medication.v1.json';
import workoutLogV2PackageJson from '@/apps/workout-log-v2/workout-log-v2.v1.json';
import physioRoutinePackageJson from '@/apps/physio-routine/physio-routine.v1.json';
import unitConverterPackageJson from '@/apps/unit-converter/unit-converter.v1.json';
import recipeScalerPackageJson from '@/apps/recipe-scaler/recipe-scaler.v1.json';
import intervalTimerPackageJson from '@/apps/interval-timer/interval-timer.v1.json';
import meditationTimerPackageJson from '@/apps/meditation-timer/meditation-timer.v1.json';
import expenseSplitterPackageJson from '@/apps/expense-splitter/expense-splitter.v1.json';
import rentAllocationPackageJson from '@/apps/rent-allocation/rent-allocation.v1.json';
import readingTrackerPackageJson from '@/apps/reading-tracker/reading-tracker.v1.json';
import courseProgressPackageJson from '@/apps/course-progress/course-progress.v1.json';
import foodPackageJson from '@/apps/food/app-package.v3.json';
import habitGridPackageJson from '@/apps/habit-grid/habit-grid.v1.json';
import audioLoopPackageJson from '@/apps/audio-loop-108/audio-loop-108.v1.json';
import scientificCalculatorPackageJson from '@/apps/scientific-calculator/scientific-calculator.v1.json';
import recurringBillsPackageJson from '@/apps/recurring-bills/recurring-bills.v1.json';
import spacedRepetitionPackageJson from '@/apps/spaced-repetition/spaced-repetition.v1.json';
import householdBudgetPackageJson from '@/apps/household-budget/household-budget.v1.json';
import invoiceReviewPackageJson from '@/apps/invoice-review/invoice-review.v1.json';
import medicationReminderPackageJson from '@/apps/medication-reminder/medication-reminder.v1.json';
import meetingAgendaPackageJson from '@/apps/meeting-agenda/meeting-agenda.v1.json';
import savingsGoalPackageJson from '@/apps/savings-goal/savings-goal.v1.json';
import maintenancePartsPackageJson from '@/apps/maintenance-parts/maintenance-parts.v1.json';
import waterIntakePackageJson from '@/apps/water-intake/water-intake.v1.json';
import emergencyKitPackageJson from '@/apps/emergency-kit/emergency-kit.v1.json';
import budgetForecastPackageJson from '@/apps/budget-forecast/budget-forecast.v1.json';
import compoundInterestPackageJson from '@/apps/compound-interest/compound-interest.v1.json';
import debtPayoffPackageJson from '@/apps/debt-payoff/debt-payoff.v1.json';
import habitStreakPackageJson from '@/apps/habit-streak/habit-streak.v1.json';
import hydrationLogPackageJson from '@/apps/hydration-log/hydration-log.v1.json';
import invoiceAgingPackageJson from '@/apps/invoice-aging/invoice-aging.v1.json';
import loanAmortizationPackageJson from '@/apps/loan-amortization/loan-amortization.v1.json';
import macroPlannerPackageJson from '@/apps/macro-planner/macro-planner.v1.json';
import projectBurndownPackageJson from '@/apps/project-burndown/project-burndown.v1.json';
import shiftPlannerPackageJson from '@/apps/shift-planner/shift-planner.v1.json';
import subscriptionRenewalPackageJson from '@/apps/subscription-renewal/subscription-renewal.v1.json';
import ticketSlaPackageJson from '@/apps/ticket-sla/ticket-sla.v1.json';
import capabilityLabPackageJson from '@/apps/capability-lab/capability-lab.v1.json';

export type BundledProductionPackage = Readonly<{
  portfolioId: string;
  packageJson: Record<string, unknown>;
  description: string;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function defineProductionPackage(
  portfolioId: string,
  packageJson: unknown,
  description: string,
): BundledProductionPackage {
  const raw = asRecord(packageJson);
  // Keep portfolio identity authoritative if a legacy fixture still carries an older id.
  const normalized = raw.id === portfolioId ? raw : { ...raw, id: portfolioId };
  return { portfolioId, packageJson: normalized, description };
}

export const BUNDLED_PRODUCTION_PACKAGES: readonly BundledProductionPackage[] = [
  defineProductionPackage('counter', counterPackageJson, 'Local bundled Counter app.'),
  defineProductionPackage('inventory-quantity', inventoryQuantityPackageJson, 'Local bundled Inventory Quantity app.'),
  defineProductionPackage('offline-checklist', offlineChecklistPackageJson, 'Local bundled Offline Checklist app.'),
  defineProductionPackage('travel-packing-list', travelPackingListPackageJson, 'Local bundled Travel Packing List app.'),
  defineProductionPackage('shopping-list', shoppingListPackageJson, 'Local bundled Shopping List app.'),
  defineProductionPackage('pantry-restock', pantryRestockPackageJson, 'Local bundled Pantry Restock app.'),
  defineProductionPackage('simple-time-tracker', simpleTimeTrackerPackageJson, 'Local bundled Simple Time Tracker app.'),
  defineProductionPackage('billable-project-timer', billableProjectTimerPackageJson, 'Local bundled Billable Project Timer app.'),
  defineProductionPackage('work-log', workLogPackageJson, 'Local bundled Work Log app.'),
  defineProductionPackage('shift-log', shiftLogPackageJson, 'Local bundled Shift Log app.'),
  defineProductionPackage('mileage-log', mileageLogPackageJson, 'Local bundled Mileage Log app.'),
  defineProductionPackage('fuel-log', fuelLogPackageJson, 'Local bundled Fuel Log app.'),
  defineProductionPackage('plant-care', plantCarePackageJson, 'Local bundled Plant Care app.'),
  defineProductionPackage('pet-medication', petMedicationPackageJson, 'Local bundled Pet Medication app.'),
  defineProductionPackage('workout-log-v2', workoutLogV2PackageJson, 'Local bundled Workout Log app.'),
  defineProductionPackage('physio-routine', physioRoutinePackageJson, 'Local bundled Physio Routine app.'),
  defineProductionPackage('unit-converter', unitConverterPackageJson, 'Local bundled Unit Converter app.'),
  defineProductionPackage('recipe-scaler', recipeScalerPackageJson, 'Local bundled Recipe Scaler app.'),
  defineProductionPackage('interval-timer', intervalTimerPackageJson, 'Local bundled Interval Timer app.'),
  defineProductionPackage('meditation-timer', meditationTimerPackageJson, 'Local bundled Meditation Timer app.'),
  defineProductionPackage('expense-splitter', expenseSplitterPackageJson, 'Local bundled Expense Splitter app.'),
  defineProductionPackage('rent-allocation', rentAllocationPackageJson, 'Local bundled Rent Allocation app.'),
  defineProductionPackage('reading-tracker', readingTrackerPackageJson, 'Local bundled Reading Tracker app.'),
  defineProductionPackage('course-progress', courseProgressPackageJson, 'Local bundled Course Progress app.'),
  defineProductionPackage('food', foodPackageJson, 'Local bundled Food reference app.'),
  defineProductionPackage('habit-grid', habitGridPackageJson, 'Local bundled Habit Grid app.'),
  defineProductionPackage('audio-loop-108', audioLoopPackageJson, 'Local bundled Audio Loop app.'),
  defineProductionPackage('scientific-calculator', scientificCalculatorPackageJson, 'Local bundled Scientific Calculator app.'),
  defineProductionPackage('recurring-bills', recurringBillsPackageJson, 'Local bundled Recurring Bills app.'),
  defineProductionPackage('spaced-repetition', spacedRepetitionPackageJson, 'Local bundled Spaced Repetition app.'),
  defineProductionPackage('household-budget', householdBudgetPackageJson, 'Local bundled Household Budget app.'),
  defineProductionPackage('invoice-review', invoiceReviewPackageJson, 'Local bundled Invoice Review app.'),
  defineProductionPackage('medication-reminder', medicationReminderPackageJson, 'Local bundled Medication Reminder app.'),
  defineProductionPackage('meeting-agenda', meetingAgendaPackageJson, 'Local bundled Meeting Agenda app.'),
  defineProductionPackage('savings-goal', savingsGoalPackageJson, 'Local bundled Savings Goal app.'),
  defineProductionPackage('maintenance-parts', maintenancePartsPackageJson, 'Local bundled Maintenance Parts app.'),
  defineProductionPackage('water-intake', waterIntakePackageJson, 'Local bundled Water Intake app.'),
  defineProductionPackage('emergency-kit', emergencyKitPackageJson, 'Local bundled Emergency Kit app.'),
  defineProductionPackage('budget-forecast', budgetForecastPackageJson, 'Local bundled Budget Forecast app.'),
  defineProductionPackage('compound-interest', compoundInterestPackageJson, 'Local bundled Compound Interest app.'),
  defineProductionPackage('debt-payoff', debtPayoffPackageJson, 'Local bundled Debt Payoff app.'),
  defineProductionPackage('habit-streak', habitStreakPackageJson, 'Local bundled Habit Streak app.'),
  defineProductionPackage('hydration-log', hydrationLogPackageJson, 'Local bundled Hydration Log app.'),
  defineProductionPackage('invoice-aging', invoiceAgingPackageJson, 'Local bundled Invoice Aging app.'),
  defineProductionPackage('loan-amortization', loanAmortizationPackageJson, 'Local bundled Loan Amortization app.'),
  defineProductionPackage('macro-planner', macroPlannerPackageJson, 'Local bundled Macro Planner app.'),
  defineProductionPackage('project-burndown', projectBurndownPackageJson, 'Local bundled Project Burndown app.'),
  defineProductionPackage('shift-planner', shiftPlannerPackageJson, 'Local bundled Shift Planner app.'),
  defineProductionPackage('subscription-renewal', subscriptionRenewalPackageJson, 'Local bundled Subscription Renewal app.'),
  defineProductionPackage('ticket-sla', ticketSlaPackageJson, 'Local bundled Ticket SLA app.'),
  defineProductionPackage('capability-lab', capabilityLabPackageJson, 'Local bundled native Capability Lab app.'),
];

export const BUNDLED_PRODUCTION_PORTFOLIO_IDS = BUNDLED_PRODUCTION_PACKAGES.map((item) => item.portfolioId);

export function getBundledProductionPackages(): BundledProductionPackage[] {
  return [...BUNDLED_PRODUCTION_PACKAGES];
}
