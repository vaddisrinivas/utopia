import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getDomainManifest, loadCatalog } from '../../../src/domain/catalog';
import { isObject, type WorkflowDocument, type WorkflowStep } from './state-types';

const WORKFLOW_DIR = join(process.cwd(), 'packages', 'domain-config', 'workflows');

let workflowCache: WorkflowDocument[] | null = null;

function isWorkflowFileName(value: string) {
  return value.endsWith('.v1.json');
}

function parseWorkflowDocument(raw: unknown, fallbackDomain: string): WorkflowDocument | null {
  if (!isObject(raw)) {
    return null;
  }

  const candidate = raw as {
    schema_version?: string;
    id?: unknown;
    domain?: unknown;
    label?: unknown;
    trigger?: unknown;
    steps?: unknown;
    write_policy?: unknown;
  };

  if (candidate.schema_version !== 'utopia.workflow.v1') {
    return null;
  }
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
    return null;
  }
  if (!Array.isArray(candidate.steps)) {
    return null;
  }
  if (typeof candidate.label !== 'string' || candidate.label.trim().length === 0) {
    return null;
  }
  if (typeof candidate.write_policy !== 'string' || candidate.write_policy.trim().length === 0) {
    return null;
  }

  const steps = candidate.steps
    .map((step) => {
      if (!isObject(step) || typeof step.id !== 'string' || step.id.trim().length === 0) {
        return null;
      }
      const parsed: WorkflowStep = {
        id: step.id.trim(),
      };
      if (typeof (step as { tool?: unknown }).tool === 'string') {
        parsed.tool = String((step as { tool: string }).tool);
      }
      if (typeof (step as { action?: unknown }).action === 'string') {
        parsed.action = String((step as { action: string }).action);
      }
      if (typeof (step as { skill?: unknown }).skill === 'string') {
        parsed.skill = String((step as { skill: string }).skill);
      }
      if (typeof (step as { input?: unknown }).input === 'object' && (step as { input: unknown }).input !== null) {
        parsed.input = (step as { input: Record<string, unknown> }).input;
      }
      if (Array.isArray((step as { input_from?: unknown }).input_from)) {
        parsed.input_from = (step as { input_from: unknown[] }).input_from
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim());
      }
      if (typeof (step as { output?: unknown }).output === 'string') {
        parsed.output = String((step as { output: string }).output);
      }
      if (typeof (step as { required?: unknown }).required === 'boolean') {
        parsed.required = (step as { required: boolean }).required;
      }
      return parsed;
    })
    .filter((step): step is WorkflowStep => step !== null);

  if (steps.length === 0) {
    return null;
  }

  return {
    schema_version: 'utopia.workflow.v1',
    id: candidate.id.trim(),
    domain:
      typeof candidate.domain === 'string' && candidate.domain.trim().length > 0 ? candidate.domain.trim() : fallbackDomain,
    label: candidate.label.trim(),
    ...(isObject(candidate.trigger) ? { trigger: { ...candidate.trigger } } : {}),
    steps,
    write_policy: candidate.write_policy.trim(),
  };
}

export function loadCatalogWorkflows(): WorkflowDocument[] {
  if (workflowCache) {
    return [...workflowCache];
  }

  const catalog = loadCatalog();
  const workflowById = new Map<string, string>();

  for (const entry of catalog.catalog.domains) {
    const manifest = getDomainManifest(catalog.catalog.domains, entry.id);
    if (!manifest) {
      continue;
    }
    for (const workflowId of manifest.workflows) {
      if (typeof workflowId === 'string' && workflowId.trim().length > 0) {
        workflowById.set(workflowId.trim(), entry.id);
      }
    }
  }

  const entries = existsSync(WORKFLOW_DIR) ? readdirSync(WORKFLOW_DIR, { withFileTypes: true }) : [];
  const loaded: WorkflowDocument[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!isWorkflowFileName(entry.name)) {
      continue;
    }
    const workflowId = basename(entry.name, '.v1.json').replace(/-/g, '_');
    if (!workflowById.has(workflowId) || seen.has(workflowId)) {
      continue;
    }

    const filePath = join(WORKFLOW_DIR, entry.name);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = parseWorkflowDocument(JSON.parse(raw), workflowById.get(workflowId) ?? 'food');
      if (!parsed) {
        continue;
      }
      loaded.push(parsed);
      seen.add(workflowId);
    } catch {
      continue;
    }
  }

  workflowCache = loaded;
  return [...loaded];
}
