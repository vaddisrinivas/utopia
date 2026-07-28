import type {
  PluginCompatibilityRequest,
  PluginCompatibilityResult,
  PluginManifest,
  PluginLock,
  PluginResolverConsumer,
} from '@/packages/shared/contracts/plugin';
import {
  lockPluginManifest,
  resolvePluginCompatibility,
  resolveBuildPluginCompatibility,
  resolveRuntimePluginCompatibility,
  resolveServerPluginCompatibility,
  validatePluginManifest,
} from '@/packages/shared/contracts/plugin';

export type {
  PluginCompatibilityRequest,
  PluginCompatibilityResult,
  PluginManifest,
  PluginLock,
  PluginResolverConsumer,
};

export function buildLockedPlugin(manifest: PluginManifest): PluginLock {
  return lockPluginManifest(manifest);
}

export function checkPluginCompatibility(
  manifest: PluginManifest,
  request: PluginCompatibilityRequest,
): PluginCompatibilityResult {
  return resolvePluginCompatibility(manifest, request);
}

export function checkRuntimePluginCompatibility(
  manifest: PluginManifest,
  request: Omit<PluginCompatibilityRequest, 'consumer'>,
): PluginCompatibilityResult {
  return resolveRuntimePluginCompatibility(manifest, request);
}

export function checkBuildPluginCompatibility(
  manifest: PluginManifest,
  request: Omit<PluginCompatibilityRequest, 'consumer'>,
): PluginCompatibilityResult {
  return resolveBuildPluginCompatibility(manifest, request);
}

export function checkServerPluginCompatibility(
  manifest: PluginManifest,
  request: Omit<PluginCompatibilityRequest, 'consumer'>,
): PluginCompatibilityResult {
  return resolveServerPluginCompatibility(manifest, request);
}

export function validatePlugin(manifest: unknown) {
  return validatePluginManifest(manifest);
}
