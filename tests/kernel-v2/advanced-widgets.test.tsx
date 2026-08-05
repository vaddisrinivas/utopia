import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react-native', () => ({ ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Pause: 'Pause', Play: 'Play' }));
vi.mock('tamagui', () => ({ Button: 'Button', H2: 'H2', Text: 'Text', XStack: 'XStack', YStack: 'YStack' }));

import { autoAdvanceGameTurn, GameConfigSchema, createGameSession } from '@/src/kernel/game-widget';
import { createMediaManifest } from '@/src/kernel/media-widgets.macos';
import { attachmentMetadata, createMessagingConfig, filterThreads, threadMessages } from '@/src/kernel/messaging-widget';
import type { AppComponent } from '@/src/kernel/schema';
import type { JsonRecord } from '@/src/kernel/runtime';

describe('advanced widget parity helpers', () => {
  it('auto-advances game turns when timer hits zero and run state is active', () => {
    const config = GameConfigSchema.parse({ schemaVersion: 'utopia.game.v3', players: [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bea' }], rounds: 2, win: { kind: 'score', target: 99 } });
    const session = createGameSession(config);
    expect(autoAdvanceGameTurn(session, config, 0, true)?.turnIndex).toBe(1);
    expect(autoAdvanceGameTurn(session, config, 1, true)).toBeNull();
    expect(autoAdvanceGameTurn(session, config, 0, false)).toBeNull();
  });

  it('normalizes media manifests from single URI and collection arrays', () => {
    const collection = createMediaManifest({ kind: 'widget', widget: 'audio-player', title: 'Music', props: { uri: 'file:///tmp/audio.mp3' } } as AppComponent);
    const explicit = createMediaManifest({ kind: 'widget', widget: 'video-player', title: 'Lessons', props: { kind: 'video', items: [{ id: '01', title: 'Clip', uri: '/tmp/clip.mp4', loop: true }] } } as AppComponent);
    expect(collection[0]?.uri).toBe('file:///tmp/audio.mp3');
    expect(explicit[0]).toMatchObject({ id: '01', kind: 'video', title: 'Clip', loop: true });
  });

  it('searches messaging threads without JSON-stringify and orders malformed timestamps safely', () => {
    const config = createMessagingConfig({ kind: 'widget', widget: 'messaging', props: {} } as unknown as AppComponent);
    const threads: JsonRecord[] = [
      { id: 'a', collection: 'threads', values: { title: 'Alpha' }, createdAt: 'bad', updatedAt: 'bad' },
      { id: 'b', collection: 'threads', values: { title: 'Beta' }, createdAt: 'bad', updatedAt: 'bad' },
    ];
    const messages: JsonRecord[] = [
      { id: 'm2', collection: 'messages', values: { threadId: 'a', text: 'Later' }, createdAt: undefined as unknown as string, updatedAt: 'x' },
      { id: 'm1', collection: 'messages', values: { threadId: 'a', text: 'Earlier' }, createdAt: 'bad', updatedAt: 'x' },
      { id: 'b2', collection: 'messages', values: { threadId: 'b', text: 'Billing' }, createdAt: '2026-01-03T00:00:00Z', updatedAt: 'x' },
    ];
    expect(filterThreads(threads, messages, 'billing', config).map((thread) => thread.id)).toEqual(['b']);
    expect(threadMessages(messages, 'a', config).map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(threadMessages(messages, 'missing', config)).toHaveLength(0);
  });

  it('normalizes attachment metadata across mixed input types', () => {
    expect(attachmentMetadata(['voice.m4a', { filename: 'photo.png', size: '8' }, { type: 'text/plain' }])).toEqual([
      { name: 'voice.m4a', type: undefined, size: undefined, uri: undefined },
      { name: 'photo.png', type: undefined, size: 8, uri: undefined },
    ]);
  });
});
