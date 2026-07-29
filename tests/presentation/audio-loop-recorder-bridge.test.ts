import { describe, expect, it } from 'vitest';

import * as widgetNativeBridges from '@/src/presentation/widget-native-bridges';
import {
  buildRecorderStartCommand,
  startAudioLoopRecording,
  type AudioLoopRecorderCommand,
  type AudioLoopRecorderDriver,
} from '@/src/presentation/widgets/audio-loop-storage-bridge';

describe('audio loop recorder bridge', () => {
  it('reports unavailable native recorder API instead of fake recording', async () => {
    await expect(widgetNativeBridges.createAudioLoopRecorderDriver({})).rejects.toThrow(
      'expo-audio recorder API is unavailable in this build.',
    );
  });

  it('builds recorder command without silent microphone startup', () => {
    expect(buildRecorderStartCommand('/tmp/audio-loop.m4a')).toEqual({
      outputFile: '/tmp/audio-loop.m4a',
      isMuted: false,
    });
  });

  it('forwards explicit audio-loop recorder command payload to the native driver', async () => {
    const commands: AudioLoopRecorderCommand[] = [];
    const driver: AudioLoopRecorderDriver = {
      startRecording: async (command) => {
        commands.push(command);
        return { sourceUri: command.outputFile };
      },
      stopRecording: async () => {},
    };

    await expect(startAudioLoopRecording(driver, '/tmp/audio-loop.m4a')).resolves.toEqual({
      sourceUri: '/tmp/audio-loop.m4a',
    });
    expect(commands).toEqual([{ outputFile: '/tmp/audio-loop.m4a', isMuted: false }]);
  });
});
