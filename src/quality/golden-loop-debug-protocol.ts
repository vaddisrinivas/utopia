export const GOLDEN_LOOP_DEBUG_MODE = 'goldenLoopDebug' as const;
export const GOLDEN_LOOP_DEBUG_BRIDGE_VERSION = 'utopia.golden-loop-debug.v1' as const;

export const GOLDEN_LOOP_DEBUG_COMMANDS = [
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
] as const;

export type GoldenLoopDebugCommandName = typeof GOLDEN_LOOP_DEBUG_COMMANDS[number];

export type GoldenLoopDebugCommand = Readonly<{
  mode: typeof GOLDEN_LOOP_DEBUG_MODE;
  command: GoldenLoopDebugCommandName;
  installation_id: string;
  operation_id: string;
  authorization_token: string;
  arguments?: Record<string, unknown>;
}>;

export type GoldenLoopDebugResult = Readonly<{
  status: 'applied' | 'blocked' | 'failed';
  command: GoldenLoopDebugCommandName;
  installation_id: string;
  operation_id: string;
  receipt_id: string;
  checksum?: string;
  count?: number;
  package_version?: string | null;
  capability_record_id?: string;
  backup_id?: string;
  blockers?: string[];
  error?: string;
  applied_at: string;
}>;

export type GoldenLoopDebugBridgeStatus = Readonly<{
  enabled: boolean;
  ready: boolean;
  version: typeof GOLDEN_LOOP_DEBUG_BRIDGE_VERSION;
  commands: readonly GoldenLoopDebugCommandName[];
}>;

const commandSet = new Set<string>(GOLDEN_LOOP_DEBUG_COMMANDS);
const compiledGoldenLoopDebugEnabled = process.env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG === '1';
const globalGoldenLoopDebug = globalThis as typeof globalThis & {
  __UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN__?: string;
};

export function isGoldenLoopDebugEnabled(env?: Record<string, string | undefined>): boolean {
  if (env) return env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_DEBUG === '1';
  return compiledGoldenLoopDebugEnabled;
}

export function getGoldenLoopDebugToken(env?: Record<string, string | undefined>): string | null {
  const token = (env
    ? env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN
    : (globalGoldenLoopDebug.__UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN__
      || process.env.EXPO_PUBLIC_UTOPIA_GOLDEN_LOOP_TOKEN))?.trim();
  return token && token.length >= 32 ? token : null;
}

export function validateGoldenLoopDebugCommand(
  input: unknown,
  expectedToken: string | null,
): asserts input is GoldenLoopDebugCommand {
  if (!expectedToken) throw new Error('golden_loop_debug_token_unavailable');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('golden_loop_debug_command_invalid');
  }
  const command = input as Partial<GoldenLoopDebugCommand>;
  if (command.mode !== GOLDEN_LOOP_DEBUG_MODE) throw new Error('golden_loop_debug_mode_invalid');
  if (typeof command.command !== 'string' || !commandSet.has(command.command)) {
    throw new Error('golden_loop_debug_command_unknown');
  }
  if (!isText(command.installation_id)) throw new Error('golden_loop_debug_installation_id_required');
  if (!isText(command.operation_id)) throw new Error('golden_loop_debug_operation_id_required');
  if (command.authorization_token !== expectedToken) throw new Error('golden_loop_debug_token_mismatch');
  if (command.arguments !== undefined && (!command.arguments || typeof command.arguments !== 'object' || Array.isArray(command.arguments))) {
    throw new Error('golden_loop_debug_arguments_invalid');
  }
}

export function parseGoldenLoopDebugPayload(input: string): unknown {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object') throw new Error('golden_loop_debug_payload_invalid');
  return parsed;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
