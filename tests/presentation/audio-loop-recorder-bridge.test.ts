import { describe, expect, it, vi } from 'vitest';

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

  it('uses the installed expo-audio recorder lifecycle and returns its result URI', async () => {
    const recorder = {
      uri: 'file:///recordings/audio-loop.m4a',
      prepareToRecordAsync: vi.fn().mockResolvedValue(undefined),
      record: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const AudioRecorder = vi.fn(function AudioRecorder() {
      return recorder;
    });
    const requestRecordingPermissionsAsync = vi.fn().mockResolvedValue({ granted: true });
    const audio = {
      AudioModule: { AudioRecorder },
      RecordingPresets: {
        HIGH_QUALITY: {
          extension: '.m4a',
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
          android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
          ios: { outputFormat: 'aac ', audioQuality: 127 },
          web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
        },
      },
      requestRecordingPermissionsAsync,
    };

    const driver = await widgetNativeBridges.createAudioLoopRecorderDriver(audio);
    await expect(driver.startRecording({ outputFile: '/ignored-by-expo-audio.m4a', isMuted: false })).resolves.toEqual({
      sourceUri: 'file:///recordings/audio-loop.m4a',
    });
    await expect(driver.stopRecording()).resolves.toEqual({ sourceUri: 'file:///recordings/audio-loop.m4a' });

    expect(requestRecordingPermissionsAsync).toHaveBeenCalledOnce();
    expect(AudioRecorder).toHaveBeenCalledOnce();
    expect(AudioRecorder).toHaveBeenCalledWith(expect.objectContaining({
      extension: '.m4a',
      directory: 'document',
      mimeType: 'audio/webm',
    }));
    expect(recorder.prepareToRecordAsync).toHaveBeenCalledOnce();
    expect(recorder.record).toHaveBeenCalledOnce();
    expect(recorder.stop).toHaveBeenCalledOnce();
  });

  it('does not start when microphone permission is denied', async () => {
    const recorder = {
      uri: null,
      prepareToRecordAsync: vi.fn(),
      record: vi.fn(),
      stop: vi.fn(),
    };
    const audio = {
      AudioModule: { AudioRecorder: vi.fn(function AudioRecorder() { return recorder; }) },
      RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 1, bitRate: 64000, web: {} } },
      requestRecordingPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
    };

    const driver = await widgetNativeBridges.createAudioLoopRecorderDriver(audio);
    await expect(driver.startRecording({ outputFile: '/ignored.m4a', isMuted: false })).rejects.toThrow(
      'Microphone permission was not granted.',
    );
    expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('rejects a muted recording request before touching the microphone', async () => {
    const recorder = {
      uri: 'file:///recordings/audio-loop.m4a',
      prepareToRecordAsync: vi.fn(),
      record: vi.fn(),
      stop: vi.fn(),
    };
    const requestRecordingPermissionsAsync = vi.fn().mockResolvedValue({ granted: true });
    const audio = {
      AudioModule: { AudioRecorder: vi.fn(function AudioRecorder() { return recorder; }) },
      RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 1, bitRate: 64000, web: {} } },
      requestRecordingPermissionsAsync,
    };

    const driver = await widgetNativeBridges.createAudioLoopRecorderDriver(audio);
    await expect(driver.startRecording({ outputFile: '/ignored.m4a', isMuted: true })).rejects.toThrow(
      'Audio loop recording cannot start muted.',
    );
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    expect(recorder.prepareToRecordAsync).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('propagates native start and stop errors and rejects a missing result URI', async () => {
    const startError = new Error('prepare failed');
    const recorder = {
      uri: null,
      prepareToRecordAsync: vi.fn().mockRejectedValueOnce(startError).mockResolvedValue(undefined),
      record: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const audio = {
      AudioModule: { AudioRecorder: vi.fn(function AudioRecorder() { return recorder; }) },
      RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, numberOfChannels: 1, bitRate: 64000, web: {} } },
      requestRecordingPermissionsAsync: vi.fn().mockResolvedValue({ granted: true }),
    };

    const driver = await widgetNativeBridges.createAudioLoopRecorderDriver(audio);
    await expect(driver.startRecording({ outputFile: '/ignored.m4a', isMuted: false })).rejects.toBe(startError);
    await expect(driver.startRecording({ outputFile: '/ignored.m4a', isMuted: false })).resolves.toEqual({
      sourceUri: '/ignored.m4a',
    });
    await expect(driver.stopRecording()).rejects.toThrow(
      'expo-audio recorder did not return a recording URI.',
    );

    recorder.stop.mockRejectedValueOnce(new Error('stop failed'));
    await expect(driver.stopRecording()).rejects.toThrow('stop failed');
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
