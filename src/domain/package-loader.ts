import {
  collectAppPackageValidationIssues,
  formatAppPackageValidationIssues,
  type AppPackage,
} from '@/packages/shared/contracts/package';
import { createAppRuntime, type AppRuntime } from '@/src/domain/package-runtime';

export function loadAppPackage(candidate: unknown): AppRuntime {
  assertLoadableAppPackage(candidate);
  return createAppRuntime(candidate);
}

function assertLoadableAppPackage(candidate: unknown): asserts candidate is AppPackage {
  const errors = formatAppPackageValidationIssues(collectAppPackageValidationIssues(candidate));
  if (errors.length > 0) {
    throw new Error(`app_package_invalid:${errors.join('|') || 'app_package_invalid'}`);
  }
}
