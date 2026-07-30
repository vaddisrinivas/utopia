import { describe, expect, it } from 'vitest';

import {
  DEBUG_AUTOMATION_COMMANDS,
  buildDebugAutomationCommand,
  generateDebugAutomationToken,
  redactDebugAutomationCommand,
  validateDebugAutomationCommand,
} from '../../scripts/quality/golden-loop/debug-automation-protocol.mjs';

describe('Golden Loop debug automation protocol', () => {
  it('accepts only the bounded command set with a valid per-run token', () => {
    const token = generateDebugAutomationToken();
    const command = buildDebugAutomationCommand({
      command: 'record.write',
      installationId: 'android-a',
      operationId: 'op-123',
      authorizationToken: token,
      args: {
        collection: 'tasks',
        record_id: 'task-1',
        field_values_hash: `sha256:${'a'.repeat(64)}`,
      },
    });

    const result = validateDebugAutomationCommand(command, { expectedToken: token });

    expect(DEBUG_AUTOMATION_COMMANDS).toContain('state.checksum');
    expect(result.pass).toBe(true);
    expect(result.command).toBe('record.write');
    expect(result.installation_id).toBe('android-a');
  });

  it('blocks missing or wrong authorization tokens', () => {
    const command = buildDebugAutomationCommand({
      command: 'state.checksum',
      installationId: 'web',
      operationId: 'op-checksum',
      authorizationToken: 'wrong',
    });

    const result = validateDebugAutomationCommand(command, { expectedToken: 'expected' });

    expect(result.pass).toBe(false);
    expect(result.blockers).toContain('authorization_token_invalid');
  });

  it('blocks arbitrary commands and non-loopback endpoints', () => {
    const token = generateDebugAutomationToken();
    const command = buildDebugAutomationCommand({
      command: 'sql.execute',
      installationId: 'macos',
      operationId: 'op-danger',
      authorizationToken: token,
      args: {
        transport_endpoint: 'https://example.com',
        raw_sql: 'drop table records',
      },
    });

    const result = validateDebugAutomationCommand(command, { expectedToken: token });

    expect(result.pass).toBe(false);
    expect(result.blockers).toContain('command_not_allowed:sql.execute');
    expect(result.blockers).toContain('argument_key_not_allowed:raw_sql');
    expect(result.blockers).toContain('argument_endpoint_not_loopback:https://example.com');
  });

  it('redacts tokens and hashes arguments for receipts', () => {
    const command = buildDebugAutomationCommand({
      command: 'package.install',
      installationId: 'android-a',
      operationId: 'op-install',
      authorizationToken: 'secret-token',
      args: {
        package_id: 'shared-household-board',
        package_version: '1.0.0',
        package_checksum: `sha256:${'b'.repeat(64)}`,
      },
    });

    const redacted = redactDebugAutomationCommand(command);

    expect(redacted.authorization_token).toBe('<redacted>');
    expect(redacted.arguments_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(redacted)).not.toContain('secret-token');
    expect(JSON.stringify(redacted)).not.toContain('shared-household-board');
  });
});
