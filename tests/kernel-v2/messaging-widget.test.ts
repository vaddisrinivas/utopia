import { describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react-native', () => ({ Paperclip: 'Paperclip', Plus: 'Plus', RotateCcw: 'RotateCcw', Search: 'Search', Send: 'Send', X: 'X' }));
vi.mock('tamagui', () => ({ Button: 'Button', Input: 'Input', Paragraph: 'Paragraph', ScrollView: 'ScrollView', Text: 'Text', TextArea: 'TextArea', XStack: 'XStack', YStack: 'YStack' }));
vi.mock('@/src/kernel/store', () => ({ useAppStore: () => ({ state: { records: [] }, dispatch: async () => {} }) }));
vi.mock('@/src/kernel/theme', () => ({ usePackageTheme: () => ({ accent: '#000', canvas: '#fff', surface: '#fff', ink: '#000', muted: '#777' }) }));

import { attachmentMetadata, createMessagingConfig, filterThreads, threadMessages } from '@/src/kernel/messaging-widget';
import type { AppComponent } from '@/src/kernel/schema';
import type { JsonRecord } from '@/src/kernel/runtime';

const component = (props: Record<string, unknown> = {}): AppComponent => ({ kind: 'widget', widget: 'messaging', props });
const record = (id: string, collection: string, values: Record<string, unknown>, createdAt = id): JsonRecord => ({ id, collection, values, createdAt, updatedAt: createdAt });

describe('messaging widget contract', () => {
  it('derives JSON-configured collections, local send mode, and attachment metadata', () => {
    const config = createMessagingConfig(component({ threadsCollection: 'rooms', messagesCollection: 'posts', sendMode: 'failed', attachmentOptions: [{ name: 'photo.jpg', type: 'image/jpeg', size: 12 }] }));
    expect(config).toMatchObject({ threads: 'rooms', messages: 'posts', sendMode: 'failed', allowAttachments: true });
    expect(config.attachmentOptions).toEqual([{ name: 'photo.jpg', type: 'image/jpeg', size: 12, uri: undefined }]);
  });

  it('normalizes attachment names and ignores malformed metadata', () => {
    expect(attachmentMetadata(['voice.m4a', { filename: 'photo.png', size: '8' }, { type: 'text/plain' }])).toEqual([
      { name: 'voice.m4a' }, { name: 'photo.png', type: undefined, size: 8, uri: undefined },
    ]);
  });

  it('searches threads through labels and message values, then orders timelines', () => {
    const config = createMessagingConfig(component());
    const threads = [record('a', 'threads', { title: 'Design' }), record('b', 'threads', { title: 'Support' })];
    const messages = [record('m2', 'messages', { threadId: 'a', text: 'Later' }, '2026-02-02'), record('m1', 'messages', { threadId: 'a', text: 'Earlier' }, '2026-02-01'), record('m3', 'messages', { threadId: 'b', text: 'Billing' }, '2026-02-03')];
    expect(filterThreads(threads, messages, 'billing', config).map((item) => item.id)).toEqual(['b']);
    expect(threadMessages(messages, 'a', config).map((item) => item.id)).toEqual(['m1', 'm2']);
  });
});
