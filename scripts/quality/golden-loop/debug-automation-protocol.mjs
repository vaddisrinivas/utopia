#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEBUG_AUTOMATION_MODE = 'goldenLoopDebug';

export const DEBUG_AUTOMATION_COMMANDS = Object.freeze([
  'package.install',
  'record.write',
  'transport.disconnect',
  'transport.reconnect',
  'package.update',
  'package.rollback',
  'backup.export',
  'installation.reset',
  'backup.restore',
  'capability.grant',
  'capability.revoke',
  'state.checksum',
]);

const COMMAND_SET = new Set(DEBUG_AUTOMATION_COMMANDS);
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CAPABILITY_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const CHECKSUM_RE = /^sha256:[a-f0-9]{64}$/i;
const SAFE_ARGUMENT_KEYS = new Set([
  'package_id',
  'package_checksum',
  'package_version',
  'collection',
  'record_id',
  'field_values_hash',
  'transport_endpoint',
  'transport_session',
  'capability',
  'backup_id',
  'expected_checksum',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asSafeId(value) {
  return typeof value === 'string' && ID_RE.test(value) ? value : null;
}

function asChecksum(value) {
  return typeof value === 'string' && CHECKSUM_RE.test(value) ? value.toLowerCase() : null;
}

function validateArguments(command, args, blockers) {
  const normalized = asObject(args) || {};
  if (!asObject(args)) blockers.push('arguments_not_object');

  for (const key of Object.keys(normalized)) {
    if (!SAFE_ARGUMENT_KEYS.has(key)) blockers.push(`argument_key_not_allowed:${key}`);
  }

  for (const [key, value] of Object.entries(normalized)) {
    if (key.endsWith('_hash') || key.endsWith('_checksum') || key === 'expected_checksum') {
      if (!asChecksum(String(value))) blockers.push(`argument_checksum_invalid:${key}`);
      continue;
    }
    if (key === 'transport_endpoint') {
      if (value !== 'localhost' && value !== 'adb-reverse' && value !== 'macos-loopback' && value !== 'web-loopback') {
        blockers.push(`argument_endpoint_not_loopback:${String(value)}`);
      }
      continue;
    }
    if (key === 'capability') {
      if (typeof value !== 'string' || !CAPABILITY_RE.test(value)) blockers.push(`argument_capability_invalid:${String(value)}`);
      continue;
    }
    if (typeof value !== 'string' || value.length > 128) blockers.push(`argument_value_invalid:${key}`);
  }

  if (command === 'record.write') {
    if (!asSafeId(normalized.collection)) blockers.push('missing_or_invalid_collection');
    if (!asSafeId(normalized.record_id)) blockers.push('missing_or_invalid_record_id');
    if (!asChecksum(normalized.field_values_hash)) blockers.push('missing_or_invalid_field_values_hash');
  }
  if (command === 'package.install' || command === 'package.update') {
    if (!asSafeId(normalized.package_id)) blockers.push('missing_or_invalid_package_id');
    if (!asChecksum(normalized.package_checksum)) blockers.push('missing_or_invalid_package_checksum');
    if (!asSafeId(normalized.package_version)) blockers.push('missing_or_invalid_package_version');
  }
  if (command === 'capability.grant' || command === 'capability.revoke') {
    if (typeof normalized.capability !== 'string' || !CAPABILITY_RE.test(normalized.capability)) {
      blockers.push('missing_or_invalid_capability');
    }
  }
  if (command === 'backup.restore') {
    if (!asSafeId(normalized.backup_id)) blockers.push('missing_or_invalid_backup_id');
  }
  if (command === 'transport.disconnect' || command === 'transport.reconnect') {
    if (normalized.transport_endpoint && normalized.transport_endpoint !== 'localhost') {
      blockers.push(`transport_endpoint_not_local:${normalized.transport_endpoint}`);
    }
  }

  return normalized;
}

export function generateDebugAutomationToken() {
  return `utopia-golden-loop-${randomBytes(32).toString('hex')}`;
}

export function verifyDebugAutomationToken(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * @param {unknown} raw
 * @param {{ expectedToken?: string; mode?: string }} [options]
 */
export function validateDebugAutomationCommand(raw, {
  expectedToken,
  mode = DEBUG_AUTOMATION_MODE,
} = {}) {
  const blockers = [];
  const node = asObject(raw);
  if (!node) {
    return { pass: false, blockers: ['command_not_object'], command: null };
  }

  if (node.mode !== DEBUG_AUTOMATION_MODE || mode !== DEBUG_AUTOMATION_MODE) {
    blockers.push('debug_automation_mode_disabled');
  }
  if (typeof expectedToken === 'string' && !verifyDebugAutomationToken(node.authorization_token, expectedToken)) {
    blockers.push('authorization_token_invalid');
  }

  const command = typeof node.command === 'string' ? node.command : null;
  if (!command || !COMMAND_SET.has(command)) blockers.push(`command_not_allowed:${command || 'missing'}`);

  const installationId = asSafeId(node.installation_id);
  if (!installationId) blockers.push('missing_or_invalid_installation_id');

  const operationId = asSafeId(node.operation_id);
  if (!operationId) blockers.push('missing_or_invalid_operation_id');

  const argumentsNode = validateArguments(command || '', node.arguments, blockers);

  return {
    pass: blockers.length === 0,
    blockers,
    command,
    installation_id: installationId,
    operation_id: operationId,
    arguments: argumentsNode,
  };
}

export function redactDebugAutomationCommand(raw) {
  const node = asObject(raw) || {};
  const argumentsHash = createHash('sha256')
    .update(JSON.stringify(asObject(node.arguments) || {}))
    .digest('hex');
  return {
    mode: node.mode === DEBUG_AUTOMATION_MODE ? DEBUG_AUTOMATION_MODE : 'invalid',
    command: typeof node.command === 'string' ? node.command : null,
    installation_id: asSafeId(node.installation_id),
    operation_id: asSafeId(node.operation_id),
    arguments_hash: `sha256:${argumentsHash}`,
    authorization_token: node.authorization_token ? '<redacted>' : null,
  };
}

export function buildDebugAutomationCommand({
  command,
  installationId,
  operationId,
  authorizationToken,
  args = {},
}) {
  return {
    mode: DEBUG_AUTOMATION_MODE,
    command,
    installation_id: installationId,
    operation_id: operationId,
    authorization_token: authorizationToken,
    arguments: args,
  };
}
