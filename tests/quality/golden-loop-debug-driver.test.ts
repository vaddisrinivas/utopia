import { describe, expect, it } from 'vitest';

import {
  buildGoldenLoopDebugUrl,
  buildSharedHouseholdBoardDebugCommands,
} from '@/scripts/quality/golden-loop/debug-bridge-commands.mjs';
import {
  collectAndroidInputs,
  validateGoldenLoopInputs,
} from '@/scripts/quality/android/run-golden-loop-android-lane.mjs';

const token = '0123456789abcdef0123456789abcdef';

describe('golden loop debug bridge drivers', () => {
  it('builds package-backed debug commands and deep links for shell drivers', () => {
    const { commands, urls } = buildSharedHouseholdBoardDebugCommands({
      token,
      installationId: 'driver-installation',
    });
    expect(commands.map((command) => command.command)).toContain('package.install');
    expect(commands.map((command) => command.command)).toContain('package.update');
    expect(commands.map((command) => command.command)).toContain('record.write');
    expect(commands.map((command) => command.command)).toContain('state.checksum');
    expect((commands[0].arguments as Record<string, unknown>).package_json).toMatchObject({
      id: 'shared-household-board',
      version: '1.0.0',
    });
    expect((commands[2].arguments as Record<string, unknown>).package_json).toMatchObject({
      id: 'shared-household-board',
      version: '1.1.0',
    });
    expect(urls.every((url) => url.startsWith('utopia://golden-loop-debug?payload='))).toBe(true);
    const parsed = JSON.parse(decodeURIComponent(new URL(buildGoldenLoopDebugUrl(commands[0])).searchParams.get('payload') ?? ''));
    expect(parsed).toMatchObject({
      mode: 'goldenLoopDebug',
      command: 'package.install',
      installation_id: 'driver-installation',
    });
  });

  it('blocks Android shell proof when the app/debug driver token is absent', () => {
    const inputs = collectAndroidInputs([], {
      UTOPIA_ANDROID_GOLDEN_LOOP: '1',
      UTOPIA_ANDROID_PACKAGE_ID: 'com.utopia.goldenloop',
      APK_PATH_V1: 'app-v1.apk',
      APK_PATH_V2: 'app-v2.apk',
      APK_V1_SHA256: 'a'.repeat(64),
      APK_V2_SHA256: 'b'.repeat(64),
      ANDROID_EMULATOR_SERIALS: 'emulator-5554,emulator-5556',
    } as unknown as NodeJS.ProcessEnv);
    const normalized = validateGoldenLoopInputs(inputs, {
      requireApkFiles: false,
      source: { UTOPIA_ANDROID_GOLDEN_LOOP: '1' },
    });
    expect(normalized.blockers).toContain('missing:golden_loop_debug_token');
  });

  it('accepts Android shell proof inputs when a debug token is present', () => {
    const inputs = collectAndroidInputs([], {
      UTOPIA_ANDROID_GOLDEN_LOOP: '1',
      UTOPIA_ANDROID_PACKAGE_ID: 'com.utopia.goldenloop',
      APK_PATH_V1: 'app-v1.apk',
      APK_PATH_V2: 'app-v2.apk',
      APK_V1_SHA256: 'a'.repeat(64),
      APK_V2_SHA256: 'b'.repeat(64),
      ANDROID_EMULATOR_SERIALS: 'emulator-5554,emulator-5556',
      UTOPIA_GOLDEN_LOOP_DEBUG_TOKEN: token,
    } as unknown as NodeJS.ProcessEnv);
    const normalized = validateGoldenLoopInputs(inputs, {
      requireApkFiles: false,
      source: { UTOPIA_ANDROID_GOLDEN_LOOP: '1' },
    });
    expect(normalized.blockers).not.toContain('missing:golden_loop_debug_token');
    expect(normalized.debugToken).toBe(token);
  });
});
