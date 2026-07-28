import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CRITICAL_PRIORITIES = new Set(['P0', 'P1']);
const BLOCKING_STATUSES = new Set(['OPEN', 'PARTIAL']);

export function readAcceptanceRegistry(root, relativePath = 'docs/V1-ACCEPTANCE-REGISTRY.json') {
  const value = JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
  assertAcceptanceRegistry(value, relativePath);
  return value;
}

export function assertAcceptanceRegistry(value, relativePath = 'acceptance-registry') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid acceptance registry: ${relativePath}`);
  }
  if (!Array.isArray(value.issues)) {
    throw new Error(`Invalid acceptance registry issues: ${relativePath}`);
  }
  if (!Array.isArray(value.acceptance_modes)) {
    throw new Error(`Invalid acceptance registry modes: ${relativePath}`);
  }
  return value;
}

export function listBlockingIssues(registry) {
  assertAcceptanceRegistry(registry);
  return registry.issues.filter((issue) => CRITICAL_PRIORITIES.has(issue.priority) && BLOCKING_STATUSES.has(issue.status));
}

export function getAcceptanceMode(registry, id) {
  assertAcceptanceRegistry(registry);
  return registry.acceptance_modes.find((mode) => mode.id === id) ?? null;
}

export function getDebugAppAcceptance(registry) {
  const blockers = listBlockingIssues(registry);
  return {
    id: 'debug_app',
    label: 'Debug app acceptance',
    status: blockers.length === 0 ? 'passed' : 'missing',
    blockers,
  };
}

export function getSignedReleaseAcceptance(registry) {
  const mode = getAcceptanceMode(registry, 'signed_release');
  return {
    id: 'signed_release',
    label: 'Signed release acceptance',
    status: mode?.status ?? 'blocked',
    summary: mode?.summary ?? 'Release signing and store env are not yet fully accepted.',
  };
}
