#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { writeSecurityArtifact } from './security-artifact.mjs';

const root = resolve(process.env.QUALITY_GATE_ROOT?.trim() || process.cwd());
const workflowDir = resolve(root, '.github/workflows');
const artifactPath = process.env.ACTION_PERMISSIONS_REPORT_PATH?.trim() || 'app/build/evidence/action-permissions.json';
const blockers = [];
const workflows = [];

function permissionBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)permissions:\s*$/);
    if (!match) continue;
    const indent = match[1].length;
    const values = [];
    for (const line of lines.slice(index + 1)) {
      if (line.trim() && line.length - line.trimStart().length <= indent) break;
      const value = line.match(new RegExp(`^\\s{${indent + 2}}[\\w-]+:\\s*(read|write|none)\\s*$`));
      if (value) values.push(line.trim());
    }
    blocks.push(values);
  }
  return blocks;
}

if (!existsSync(workflowDir)) blockers.push('workflows_directory_missing');
else for (const name of readdirSync(workflowDir).filter((file) => /\.(yml|yaml)$/.test(file)).sort()) {
  const text = readFileSync(resolve(workflowDir, name), 'utf8');
  const permissions = permissionBlocks(text);
  if (!permissions.length) blockers.push(`missing_workflow_permissions:${name}`);
  const writes = permissions.flat().filter((entry) => entry.endsWith(': write')).map((entry) => entry.split(':')[0]);
  if (writes.some((permission) => permission !== 'id-token')) blockers.push(`workflow_write_permission:${name}:${writes.filter((permission) => permission !== 'id-token').join(',')}`);
  if (/^permissions:\s*write-all\s*$/m.test(text)) blockers.push(`workflow_write_all:${name}`);
  workflows.push({ name, permissions });
}

writeSecurityArtifact(root, artifactPath, {
  schemaVersion: 'utopia.security-artifact.v1',
  kind: 'github-action-permissions',
  workflows,
});
const payload = {
  proof: 'utopia_action_permissions_gate',
  checked_at: new Date().toISOString(),
  status: blockers.length ? 'BLOCKED' : 'READY',
  blockers,
  artifact_path: relative(root, resolve(root, artifactPath)),
  workflows: workflows.length,
};
console.log(`ACTION_PERMISSIONS_GATE_JSON=${JSON.stringify(payload)}`);
if (blockers.length) process.exit(1);
