import { describe, expect, it } from 'vitest';

import { parseAudioLoopIncomingIntent } from '@/src/platform/incoming-audio-loop';

describe('audio loop intent entry parser', () => {
  it('is parse-only and deterministic for media-session style commands', () => {
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/command?command=play')).toEqual({
      kind: 'command',
      command: { kind: 'play' },
    });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/command?command=play')).toEqual(
      parseAudioLoopIncomingIntent('utopia://audio-loop-108/command?command=play'),
    );
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/path/media/unknown-action')).toMatchObject({
      kind: 'noop',
    });
  });

  it('parses deep-link entry intent without side effects', () => {
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/open')).toEqual({ kind: 'open' });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/open-audio-loop')).toEqual({ kind: 'open' });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/anything')).toEqual({
      kind: 'noop',
      reason: 'No recognized Audio Loop media command in route or query.',
    });
  });

  it('parses voice intent stub entry and keeps behavior stub-only', () => {
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/start-audio-loop-voice')).toEqual({ kind: 'voice' });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/start?intent=start-audio-loop-voice')).toEqual({ kind: 'voice' });
    expect(parseAudioLoopIncomingIntent('utopia://example.local/health')).toEqual(null);
    expect(parseAudioLoopIncomingIntent('utopia://other-app/open')).toEqual(null);
  });

  it('parses playback controls for Android media-session style input', () => {
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/command?command=play')).toEqual({
      kind: 'command',
      command: { kind: 'play' },
    });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/path/media/pause')).toEqual({
      kind: 'command',
      command: { kind: 'pause' },
    });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/media/next')).toEqual({
      kind: 'command',
      command: { kind: 'next' },
    });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/media/previous')).toEqual({
      kind: 'command',
      command: { kind: 'previous' },
    });
  });

  it('parses loop-count and infinite media-session controls deterministically', () => {
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/command?command=loop-count&count=7')).toEqual({
      kind: 'command',
      command: {
        kind: 'set-loop-count',
        loopCount: { kind: 'count', value: 7 },
      },
    });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/loop?loopCount=infinite')).toEqual({
      kind: 'command',
      command: { kind: 'set-loop-count', loopCount: { kind: 'infinite' } },
    });
    expect(parseAudioLoopIncomingIntent('utopia://audio-loop-108/media?command=set-loop-count&loop-count=infinite')).toEqual({
      kind: 'command',
      command: { kind: 'set-loop-count', loopCount: { kind: 'infinite' } },
    });
  });

  it('returns deterministic no-op for unsupported media commands', () => {
    const unsupported = parseAudioLoopIncomingIntent('utopia://audio-loop-108/media?command=rewind');
    expect(unsupported).toEqual({
      kind: 'noop',
      reason: "Unsupported Audio Loop command 'rewind'.",
    });

    const malformedLoop = parseAudioLoopIncomingIntent('utopia://audio-loop-108/command?command=loop-count&count=bad');
    expect(malformedLoop).toEqual({
      kind: 'noop',
      reason: 'Unable to parse loop count value for media command.',
    });
  });
});
