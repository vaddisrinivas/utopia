import { Paperclip, Plus, RotateCcw, Search, Send, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Button, Input, Paragraph, ScrollView, Text, TextArea, XStack, YStack } from 'tamagui';

import type { AppComponent } from './schema';
import type { Store } from './store';
import { usePackageTheme } from './theme';
import type { JsonRecord } from './runtime';

type Values = Record<string, unknown>;
export type MessageStatus = 'queued' | 'sent' | 'failed';
export type AttachmentMeta = { name: string; type?: string; size?: number; uri?: string };
export type MessagingConfig = {
  threads: string; messages: string; drafts: string; attachments: string;
  threadField: string; textField: string; draftField: string; roleField: string; statusField: string;
  attachmentMessageField: string; sendMode: MessageStatus; allowAttachments: boolean;
  attachmentOptions: AttachmentMeta[]; placeholder: string;
};

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const values = (record?: JsonRecord) => record?.values ?? {};
const value = (record: JsonRecord | undefined, field: string) => values(record)[field];

function scalar(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() :
    typeof value === 'number' || typeof value === 'boolean' || value == null ? String(value ?? '').toLowerCase() : '';
}

function gatherThreadTokens(config: MessagingConfig, thread: JsonRecord, messages: JsonRecord[]): string {
  const entries: string[] = [thread.id, text(thread.values?.title), text(thread.values?.name), text(thread.values?.topic), scalar(value(thread, 'status'))];
  const related = messages.filter((message) => value(message, config.threadField) === thread.id);
  for (const message of related) {
    entries.push(
      scalar(message.id),
      text(message.values?.title),
      scalar(value(message, config.textField)),
      scalar(value(message, config.roleField)),
      scalar(value(message, config.statusField)),
      scalar(value(message, config.attachmentMessageField)),
    );
  }
  return entries.filter(Boolean).join(' ');
}

function messageCreatedAt(message: JsonRecord): number {
  if (typeof message.createdAt === 'number' && Number.isFinite(message.createdAt)) return message.createdAt;
  if (typeof message.createdAt === 'string') {
    const parsed = Date.parse(message.createdAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.isFinite(Number(message.id)) ? Number(message.id) : 0;
}

function status(value: unknown): MessageStatus {
  return value === 'failed' || value === 'queued' ? value : 'sent';
}

export function attachmentMetadata(input: unknown): AttachmentMeta[] {
  return list(input).flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ name: item.trim() }];
    if (!item || typeof item !== 'object') return [];
    const entry = item as Values;
    const name = text(entry.name, text(entry.filename));
    return name ? [{ name, type: text(entry.type) || undefined, size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : undefined, uri: text(entry.uri) || undefined }] : [];
  });
}

export function createMessagingConfig(component: AppComponent): MessagingConfig {
  const props = component.props ?? {};
  const mode = status(props.sendMode);
  return {
    threads: text(props.threadsCollection, 'threads'), messages: text(props.messagesCollection, 'messages'),
    drafts: text(props.draftsCollection, 'drafts'), attachments: text(props.attachmentsCollection, 'messageAttachments'),
    threadField: text(props.threadIdField, 'threadId'), textField: text(props.messageTextField, 'text'), draftField: text(props.draftField, 'text'),
    roleField: text(props.messageRoleField, 'role'), statusField: text(props.messageStatusField, 'status'),
    attachmentMessageField: text(props.attachmentMessageField, 'messageId'), sendMode: mode,
    allowAttachments: bool(props.allowAttachments, true), attachmentOptions: attachmentMetadata(props.attachmentOptions ?? props.attachments),
    placeholder: text(props.composerPlaceholder, 'Message'),
  };
}

export function filterThreads(threads: JsonRecord[], messages: JsonRecord[], query: string, config: MessagingConfig): JsonRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return threads;
  return threads.filter((thread) => gatherThreadTokens(config, thread, messages).includes(needle));
}

export function threadMessages(messages: JsonRecord[], threadId: string, config: MessagingConfig): JsonRecord[] {
  return messages
    .filter((message) => value(message, config.threadField) === threadId)
    .sort((a, b) => {
      const order = messageCreatedAt(a) - messageCreatedAt(b);
      return order === 0 ? String(a.id).localeCompare(String(b.id)) : order;
    });
}

const id = (prefix: string) => {
  const uuid = (globalThis as typeof globalThis & { crypto?: { randomUUID?(): string } }).crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? Date.now()}`;
};

function label(record: JsonRecord) {
  return text(value(record, 'title'), text(value(record, 'name'), record.id));
}

function metadataLabel(item: AttachmentMeta) {
  return `${item.name}${item.type ? ` · ${item.type}` : ''}${item.size != null ? ` · ${item.size} B` : ''}`;
}

export function MessagingWidget({ component, runtime }: { component: AppComponent; runtime: Pick<Store, 'state' | 'dispatch'> }) {
  const { state, dispatch } = runtime;
  const theme = usePackageTheme();
  const config = useMemo(() => createMessagingConfig(component), [component]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [pending, setPending] = useState<AttachmentMeta[]>([]);
  const threads = useMemo(() => state.records.filter((record) => record.collection === config.threads), [config.threads, state.records]);
  const messages = useMemo(() => state.records.filter((record) => record.collection === config.messages), [config.messages, state.records]);
  const drafts = useMemo(() => state.records.filter((record) => record.collection === config.drafts), [config.drafts, state.records]);
  const attachments = useMemo(() => state.records.filter((record) => record.collection === config.attachments), [config.attachments, state.records]);
  const visibleThreads = useMemo(() => filterThreads(threads, messages, search, config), [config, messages, search, threads]);
  const selected = threads.find((thread) => thread.id === selectedId) ?? visibleThreads[0] ?? threads[0];
  const selectedMessages = selected ? threadMessages(messages, selected.id, config) : [];
  const draft = selected && drafts.find((record) => value(record, config.threadField) === selected.id);

  const persistDraft = (next: string) => {
    if (!selected) return;
    if (draft) void dispatch({ kind: 'update', recordId: draft.id, values: { [config.draftField]: next } });
    else void dispatch({ kind: 'create', collection: config.drafts, recordId: `${selected.id}-draft`, values: { [config.threadField]: selected.id, [config.draftField]: next } });
  };

  const send = async (retry?: JsonRecord) => {
    if (!selected) return;
    const body = retry ? text(value(retry, config.textField)) : text(value(draft!, config.draftField));
    const files = retry ? attachments.filter((item) => value(item, config.attachmentMessageField) === retry.id).map((item) => ({ name: text(value(item, 'name')), type: text(value(item, 'type')) || undefined, size: Number(value(item, 'size')) || undefined, uri: text(value(item, 'uri')) || undefined })) : pending;
    if (!body && !files.length) return;
    const messageId = retry?.id ?? id('message');
    if (retry) await dispatch({ kind: 'update', recordId: messageId, values: { [config.statusField]: 'queued' } });
    else {
      await dispatch({ kind: 'create', collection: config.messages, recordId: messageId, values: { [config.threadField]: selected.id, [config.textField]: body, [config.roleField]: 'user', [config.statusField]: 'queued', attachments: files } });
      for (const file of files) await dispatch({ kind: 'create', collection: config.attachments, values: { [config.attachmentMessageField]: messageId, [config.threadField]: selected.id, ...file } });
      if (draft) await dispatch({ kind: 'delete', recordId: draft.id });
      setPending([]);
    }
    if (config.sendMode !== 'queued') await dispatch({ kind: 'update', recordId: messageId, values: { [config.statusField]: config.sendMode } });
  };

  const addThread = async () => {
    const threadId = id('thread');
    await dispatch({ kind: 'create', collection: config.threads, recordId: threadId, values: { title: 'New thread' } });
    setSelectedId(threadId);
  };

  return <XStack gap="$3" flex={1} style={{ minHeight: 260 }}>
    <YStack width={220} gap="$2" style={{ borderRightWidth: 1, borderColor: `${theme.accent}33`, paddingRight: 12 }}>
      <XStack gap="$2" style={{ alignItems: 'center' }}><Search size={16} color={theme.muted} /><Input flex={1} value={search} onChangeText={setSearch} placeholder="Search" /></XStack>
      <Button icon={Plus} onPress={() => void addThread()}>New thread</Button>
      <ScrollView>{visibleThreads.map((thread) => <Button key={thread.id} chromeless onPress={() => setSelectedId(thread.id)} style={{ justifyContent: 'flex-start', borderLeftWidth: selected?.id === thread.id ? 3 : 0, borderColor: theme.accent }}><YStack><Text fontWeight="700">{label(thread)}</Text><Text color="$color10" fontSize="$2">{messages.filter((item) => value(item, config.threadField) === thread.id).length} messages</Text></YStack></Button>)}</ScrollView>
      {!visibleThreads.length ? <Paragraph color="$color10">No threads</Paragraph> : null}
    </YStack>
    <YStack flex={1} gap="$2">
      <Text fontSize="$7" fontWeight="800">{selected ? label(selected) : 'Messages'}</Text>
      <ScrollView flex={1}>{selectedMessages.map((message) => {
        const state = status(value(message, config.statusField));
        const mine = value(message, config.roleField) !== 'assistant';
        const files = attachments.filter((item) => value(item, config.attachmentMessageField) === message.id);
        return <YStack key={message.id} gap="$1" style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', padding: 10, borderRadius: 12, backgroundColor: mine ? `${theme.accent}22` : theme.surface }}>
          <Text>{text(value(message, config.textField))}</Text>{files.map((file) => <Text key={file.id} color="$color10" fontSize="$2">📎 {metadataLabel({ name: text(value(file, 'name')), type: text(value(file, 'type')) || undefined, size: Number(value(file, 'size')) || undefined })}</Text>)}
          <XStack gap="$2" style={{ alignItems: 'center' }}><Text color={state === 'failed' ? '$red10' : '$color10'} fontSize="$2">{state}</Text>{state === 'failed' ? <Button size="$2" icon={RotateCcw} onPress={() => void send(message)} aria-label="Retry" /> : null}</XStack>
        </YStack>;
      })}</ScrollView>
      {selected ? <YStack gap="$2" style={{ borderTopWidth: 1, borderColor: `${theme.accent}33`, paddingTop: 8 }}>
        {pending.map((file) => <XStack key={`${file.name}-${file.size ?? 0}`} gap="$2" style={{ alignItems: 'center' }}><Text flex={1} fontSize="$2">📎 {metadataLabel(file)}</Text><Button size="$2" icon={X} onPress={() => setPending((items) => items.filter((item) => item !== file))} aria-label={`Remove ${file.name}`} /></XStack>)}
        <XStack gap="$2" style={{ alignItems: 'flex-end' }}><TextArea flex={1} value={text(value(draft!, config.draftField))} onChangeText={persistDraft} placeholder={config.placeholder} style={{ minHeight: 44, maxHeight: 120 }} /><Button circular icon={Send} disabled={!text(value(draft!, config.draftField)) && !pending.length} onPress={() => void send()} aria-label="Send" />{config.allowAttachments && config.attachmentOptions.length ? <Button circular icon={Paperclip} onPress={() => setPending((items) => [...items, config.attachmentOptions[items.length % config.attachmentOptions.length]])} aria-label="Attach" /> : null}</XStack>
      </YStack> : <Paragraph color="$color10">Create a thread to start.</Paragraph>}
    </YStack>
  </XStack>;
}
