import type { AppInstallation } from '@/packages/shared/contracts/app-installation';
import type { UtopiaRegistryManifest, UtopiaRegistryPackage } from '@/packages/shared/contracts/package-install';

export type FeaturedAppLibraryEntry = Readonly<{
  id: string;
  name: string;
  capability: string;
  description: string;
  route?: '/food';
  registryPackage?: UtopiaRegistryPackage;
  installation?: AppInstallation;
  action: 'open' | 'review' | 'unavailable';
}>;

const FEATURED_APPS = [
  {
    id: 'food',
    name: 'Food',
    capability: 'Relational planning',
    description: 'Pantry, recipes, meal plans, shopping, history, and assistant workflows.',
    route: '/food' as const,
  },
  {
    id: 'scientific-calculator',
    name: 'Scientific Workbench',
    capability: 'Deterministic computation',
    description: 'Scientific expressions, angle modes, memory, saved calculations, and recovery.',
  },
  {
    id: 'audio-loop-108',
    name: 'Audio Loop',
    capability: 'Local media',
    description: 'Durable local audio, loop playback, speed controls, and practice history.',
  },
  {
    id: 'focus-intervals',
    name: 'Focus Intervals',
    capability: 'Lifecycle timers',
    description: 'Persisted focus cycles, interval timing, interruption notes, and session history.',
  },
  {
    id: 'capability-lab',
    name: 'Capability Lab',
    capability: 'Native frontiers',
    description: 'Explicit camera, microphone, permission, sensor, file, link, and shell diagnostics.',
  },
  {
    id: 'habit-grid',
    name: 'Habit Grid',
    capability: 'Package-only tracking',
    description: 'Habit check-ins and progress views built from reusable package primitives.',
  },
  {
    id: 'expense-splitter',
    name: 'Expense Splitter',
    capability: 'Exact settlement',
    description: 'Groups, expenses, balances, and deterministic who-pays-whom settlement.',
  },
  {
    id: 'split-rent',
    name: 'Split Rent',
    capability: 'Weighted allocation',
    description: 'Transparent weighted rent allocation with editable inputs and exact totals.',
  },
  {
    id: 'workout-logger',
    name: 'Workout Logger',
    capability: 'Persisted workflows',
    description: 'Timed workout steps, completion history, notes, and restart recovery.',
  },
] as const;

export const FEATURED_APP_LIBRARY_IDS = FEATURED_APPS.map((item) => item.id);

export function buildFeaturedAppLibraryEntries(input: {
  registry: UtopiaRegistryManifest;
  installations: readonly AppInstallation[];
}): FeaturedAppLibraryEntry[] {
  return FEATURED_APPS.map((definition) => {
    const route = 'route' in definition ? definition.route : undefined;
    const registryPackage = input.registry.packages.find((item) => item.id === definition.id);
    const installation = input.installations.find((item) => (
      item.status === 'active' && item.packageBinding?.packageId === definition.id
    ));
    return {
      ...definition,
      route,
      registryPackage,
      installation,
      action: route || installation
        ? 'open'
        : registryPackage
          ? 'review'
          : 'unavailable',
    };
  });
}
