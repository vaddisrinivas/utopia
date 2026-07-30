import { createHash } from 'node:crypto';

import {
  buildSharedHouseholdBoardWebPackageArtifacts,
  SHARED_HOUSEHOLD_BOARD_V1_URL,
  SHARED_HOUSEHOLD_BOARD_V2_URL,
} from './web-package-artifacts.mjs';

export const GOLDEN_LOOP_DEBUG_MODE = 'goldenLoopDebug';

export function requireGoldenLoopDebugToken(env = process.env) {
  const token = String(env.UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN
    || env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN
    || '').trim();
  if (token.length < 32) {
    throw new Error('missing:golden_loop_debug_token');
  }
  return token;
}

export function buildGoldenLoopDebugCommand({
  token,
  command,
  operationId,
  installationId,
  args = {},
}) {
  return {
    mode: GOLDEN_LOOP_DEBUG_MODE,
    command,
    installation_id: installationId,
    operation_id: operationId,
    authorization_token: token,
    arguments: args,
  };
}

export function buildGoldenLoopDebugUrl(command) {
  const payload = encodeURIComponent(JSON.stringify(command));
  return `utopia://golden-loop-debug?payload=${payload}`;
}

export function hashDebugCommand(command) {
  return `sha256:${createHash('sha256').update(JSON.stringify(command)).digest('hex')}`;
}

export function buildSharedHouseholdBoardDebugCommands({
  root = process.cwd(),
  sourceFixturePath = undefined,
  token,
  installationId,
  recordId = 'golden-loop-task-1',
}) {
  const artifacts = buildSharedHouseholdBoardWebPackageArtifacts({ root, sourceFixturePath });
  const commands = [
    buildGoldenLoopDebugCommand({
      token,
      command: 'package.install',
      operationId: 'debug-install-v1',
      installationId,
      args: {
        package_json: artifacts.v1.package,
        source_url: SHARED_HOUSEHOLD_BOARD_V1_URL,
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'record.write',
      operationId: 'debug-write-record',
      installationId,
      args: {
        record_id: recordId,
        field_values_hash: hashDebugCommand({ recordId, phase: 'write' }),
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'package.update',
      operationId: 'debug-update-v2',
      installationId,
      args: {
        package_json: artifacts.v2.package,
        source_url: SHARED_HOUSEHOLD_BOARD_V2_URL,
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'backup.export',
      operationId: 'debug-backup',
      installationId,
      args: {
        backup_id: 'debug-before-reset',
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'package.rollback',
      operationId: 'debug-rollback',
      installationId,
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'transport.disconnect',
      operationId: 'debug-transport-disconnect',
      installationId,
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'record.write',
      operationId: 'debug-offline-write',
      installationId,
      args: {
        record_id: `${recordId}-offline`,
        field_values_hash: hashDebugCommand({ recordId, phase: 'offline' }),
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'transport.reconnect',
      operationId: 'debug-transport-reconnect',
      installationId,
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'capability.grant',
      operationId: 'debug-capability-grant',
      installationId,
      args: {
        capability: 'debug.local-sync',
        scope: ['golden-loop'],
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'capability.revoke',
      operationId: 'debug-capability-revoke',
      installationId,
      args: {
        capability: 'debug.local-sync',
        scope: ['golden-loop'],
      },
    }),
    buildGoldenLoopDebugCommand({
      token,
      command: 'state.checksum',
      operationId: 'debug-state-checksum',
      installationId,
    }),
  ];

  return {
    artifacts,
    commands,
    urls: commands.map(buildGoldenLoopDebugUrl),
  };
}
