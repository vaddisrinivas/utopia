import {
  AUDIO_LOOP_DEEP_LINK_INTENT_ID,
  AUDIO_LOOP_VOICE_INTENT_ID,
} from '@/src/presentation/widgets/audio-loop-contract';

export type AudioLoopLoopCount =
  | { kind: 'infinite' }
  | { kind: 'count'; value: number };

export type AudioLoopMediaSessionCommand =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'next' }
  | { kind: 'previous' }
  | {
      kind: 'set-loop-count';
      loopCount: AudioLoopLoopCount;
    };

export type AudioLoopIncomingIntent =
  | { kind: 'open' }
  | { kind: 'voice' }
  | { kind: 'command'; command: AudioLoopMediaSessionCommand }
  | { kind: 'noop'; reason: string }
  | null;

function normalizeCommand(value: string): string {
  return value.trim().toLowerCase();
}

function parseAudioLoopLoopCount(input: string): AudioLoopLoopCount | null {
  const value = input.trim().toLowerCase();
  if (value === 'infinite' || value === 'inf') {
    return { kind: 'infinite' };
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return { kind: 'count', value: parsed };
}

function parseCommandIntent(input: string | null): AudioLoopMediaSessionCommand | null {
  if (!input) return null;
  const command = normalizeCommand(input);
  if (command === 'play') return { kind: 'play' };
  if (command === 'pause') return { kind: 'pause' };
  if (command === 'next') return { kind: 'next' };
  if (command === 'previous') return { kind: 'previous' };
  if (command === 'loop-count' || command === 'loop') {
    return null;
  }
  return null;
}

function buildNoop(reason: string): AudioLoopIncomingIntent {
  return { kind: 'noop', reason };
}

function parseAudioLoopLoopCountFromParams(params: URLSearchParams): AudioLoopLoopCount | null {
  const rawLoopCount = params.get('loopCount')
    ?? params.get('loop-count')
    ?? params.get('loop')
    ?? params.get('count')
    ?? params.get('targetPlays')
    ?? params.get('target-plays');
  if (!rawLoopCount) return null;
  return parseAudioLoopLoopCount(rawLoopCount);
}

export function parseAudioLoopIncomingIntent(url: string): AudioLoopIncomingIntent {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const route = `${host}${path}`;
    const targetsAudioLoop = route.includes('audio-loop-108') || route.includes('audio-loop');
    if (!targetsAudioLoop) return null;

    if (route.includes(AUDIO_LOOP_DEEP_LINK_INTENT_ID) || path.endsWith('/open')) {
      return { kind: 'open' };
    }

    if (route.includes(AUDIO_LOOP_VOICE_INTENT_ID) || parsed.searchParams.get('intent') === AUDIO_LOOP_VOICE_INTENT_ID) {
      return { kind: 'voice' };
    }

    const segments = path.split('/').filter(Boolean);
    const pathCommand = segments.includes('play') ? 'play'
      : segments.includes('pause') ? 'pause'
        : segments.includes('next') ? 'next'
          : segments.includes('previous') ? 'previous'
            : segments.includes('loop') ? 'loop-count'
              : null;

    const queryCommand = normalizeCommand(parsed.searchParams.get('command') ?? parsed.searchParams.get('intent') ?? '');
    const command = pathCommand ?? queryCommand ?? null;
    if (command === 'infinite') {
      return { kind: 'command', command: { kind: 'set-loop-count', loopCount: { kind: 'infinite' } } };
    }

    if (command === 'loop' || command === 'loop-count' || command === 'set-loop-count') {
      const parsedLoopCount = parseAudioLoopLoopCountFromParams(parsed.searchParams);
      if (!parsedLoopCount) return buildNoop('Unable to parse loop count value for media command.');
      return { kind: 'command', command: { kind: 'set-loop-count', loopCount: parsedLoopCount } };
    }

    const directCommand = parseCommandIntent(command);
    if (directCommand) {
      return { kind: 'command', command: directCommand };
    }

    if (queryCommand || pathCommand) {
      return buildNoop(`Unsupported Audio Loop command '${queryCommand || pathCommand}'.`);
    }

    return buildNoop('No recognized Audio Loop media command in route or query.');
  } catch {
    return null;
  }
}
