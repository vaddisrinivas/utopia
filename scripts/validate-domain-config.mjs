import { validateDomainConfig } from './domain-config-validator.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/domain-config');

try {
  const summary = validateDomainConfig(root);
  console.log(`Domain config valid: ${summary.domains} domains, active=${summary.activeDomain}, ${summary.activeCollections} active collections, ${summary.activeWorkflows} active workflows, ${summary.agents} agents.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
