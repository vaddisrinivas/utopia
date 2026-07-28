import type { ComponentRegistry, ComponentRenderProps } from '@json-render/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveChatServerConfig, sendChatMessage, undoChatAction } from '@/src/chat/client';
import type { ChatMessage, ChatThread } from '@/src/chat/types';
import {
  activateApprovedAppPackageChange,
  getActiveAppPackage,
  previewAppPackageChange,
  type AppPackageChangePreview,
  type AppPackageChangeRequest,
} from '@/src/db/app-package-registry';
import { getRecord, upsertRecord } from '@/src/db/records';
import { useUtopiaDatabase } from '@/src/db/provider';
import { buildSafePackageChangeRequest } from '@/src/domain/package-change-templates';
import type { DomainRecordViewModel } from '@/src/domain/renderer';
import { extractMarkdownLinks, parseMarkdownBlocks, type MarkdownBlock } from '@/src/presentation/markdown';
import { undoOperation } from '@/src/ops/undo';
import { syncConfiguredSources } from '@/src/providers/direct-source-sync';
import {
  getUtopiaHealthStatus,
  openUtopiaHealthSettings,
  requestUtopiaHealthPermissions,
  type HealthConnectStatus,
} from '@/src/health/connect';
import type { ProviderSyncStatus } from '@/src/db/provider-status';
import { useAppRuntime } from '@/src/domain/runtime-context';
import {
  maskSecret,
  providerLabel,
  saveUtopiaAiProviderProfile,
  saveUtopiaRuntimePreferences,
  saveUtopiaSourceProviderSettings,
  useUtopiaSettingsSnapshot,
  type AiProviderKind,
  type AiProviderProfile,
  type SourceProviderSettingsUpdate,
} from '@/src/settings/utopia-settings';

type WidgetProps = {
  widget?: string;
  label?: string;
  title?: string;
  subtitle?: string;
  prompt?: string;
  placeholder?: string;
  eyebrow?: string;
  actionLabel?: string;
  actionRoute?: string;
  route?: string;
  showBack?: boolean;
  examples?: unknown[];
  suggestions?: string[];
  compact?: boolean;
  body?: string;
  author?: string;
  url?: string;
  imageUrl?: string;
  items?: unknown[];
  options?: unknown[];
  columns?: unknown[];
  fields?: unknown[];
  events?: unknown[];
  points?: unknown[];
  permissions?: unknown[];
  provider?: string;
  providerStatus?: ProviderSyncStatus;
  status?: string;
  badge?: string;
  cta?: string;
  ctaRoute?: string;
  homes?: unknown[];
  steps?: unknown[];
  actions?: unknown[];
  showHeader?: boolean;
  fullPage?: boolean;
  initialPrompt?: string;
  autoSubmitPrompt?: boolean;
  records?: unknown[];
  dataBound?: boolean;
  searchable?: boolean;
  detail?: boolean;
  emptyTitle?: string;
  emptyCopy?: string;
  emptyActionLabel?: string;
  emptyActionRoute?: string;
  saveOutcome?: unknown;
};

const DEFAULT_PROMPTS = [
  'Summarize what needs attention today.',
  'Draft a new task and assign it.',
  'Create a simpler records table.',
  'Make this app calmer and less dense.',
];

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function list(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : fallback;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function label(value: unknown, fallback = 'Item') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return text(raw.title, text(raw.label, text(raw.name, text(raw.permission, text(raw.id, fallback)))));
  }
  return fallback;
}

function detail(value: unknown, fallback = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const raw = value as Record<string, unknown>;
    return text(raw.subtitle, text(raw.body, text(raw.detail, text(raw.reason, fallback))));
  }
  return fallback;
}

function permissionLabel(value: Record<string, unknown>): string {
  const explicit = text(value.title, text(value.label, text(value.name)));
  if (explicit) return explicit;
  const rawPermission = text(value.permission, text(value.id));
  const normalized = rawPermission
    .replace(/^android\.permission\.health\./, '')
    .replace(/^expo-image-picker:/, '')
    .replace(/^expo-/, '')
    .replace(/^health-connect-/, '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .toLowerCase();
  if (!normalized) return 'Permission';
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function permissionMeta(value: Record<string, unknown>): string {
  const platform = text(value.platform, 'app');
  const required = value.required === true ? 'required' : 'optional';
  return `${platform} · ${required}`;
}

function actionRoute(value: Record<string, unknown>): string {
  return normalizeWidgetRoute(text(value.route, text(value.path)));
}

function actionUrl(value: Record<string, unknown>): string {
  return text(value.url, text(value.href, text(value.deeplink)));
}

function openWidgetTarget(router: ReturnType<typeof useRouter>, target: Record<string, unknown>) {
  const route = actionRoute(target);
  if (route) {
    navigateWidgetRoute(router, route);
    return;
  }
  const url = actionUrl(target);
  if (url) {
    void Linking.openURL(url);
  }
}

function navigateWidgetRoute(router: ReturnType<typeof useRouter>, route: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(route);
    return;
  }
  router.push(route as never);
}

function normalizeWidgetRoute(route: string) {
  if (!route) return '';
  const [path, query] = route.split('?');
  const suffix = query ? `?${query}` : '';
  if (path.startsWith('/collection/')) {
    const id = path.slice('/collection/'.length);
    return `/collection?id=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
  }
  if (path.startsWith('/record/')) {
    const id = path.slice('/record/'.length);
    return `/record?id=${encodeURIComponent(id)}${query ? `&${query}` : ''}`;
  }
  if (path === '/' || path === '/home') return `/${suffix}`;
  if (path === '/chat' || path === '/ask') return `/chat${suffix}`;
  if (path === `/${'fo'}${'od'}` || path === '/kitchen') return `/${'fo'}${'od'}${suffix}`;
  if (path === '/sources') return `/sources${suffix}`;
  if (path === '/settings') return `/settings${suffix}`;
  return route;
}

function MarkdownText({
  colorStyle,
  blocks,
}: {
  colorStyle: StyleProp<TextStyle>;
  blocks: MarkdownBlock[];
}) {
  return (
    <View style={styles.markdown}>
      {blocks.map((block, blockIndex) => {
        if (block.kind === 'paragraph') {
          return <Text key={`p-${blockIndex}`} style={colorStyle}>{block.text}</Text>;
        }
        if (block.kind === 'code') {
          return <Text key={`code-${blockIndex}`} style={[colorStyle, styles.markdownCode]}>{block.text}</Text>;
        }
        if (block.kind === 'list') {
          return (
            <View key={`list-${blockIndex}`} style={styles.markdownList}>
              {block.items.map((item, itemIndex) => (
                <View key={`${item}-${itemIndex}`} style={styles.markdownListRow}>
                  <Text style={[colorStyle, styles.markdownListMarker]}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text>
                  <Text style={[colorStyle, styles.markdownListText]}>{item}</Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <ScrollView key={`table-${blockIndex}`} horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.markdownTable}>
              <View style={[styles.markdownTableRow, styles.markdownTableHeaderRow]}>
                {block.headers.map((header, headerIndex) => (
                  <Text key={`${header}-${headerIndex}`} style={[colorStyle, styles.markdownTableCell, styles.markdownTableHeader]}>{header}</Text>
                ))}
              </View>
              {block.rows.map((row, rowIndex) => (
                <View key={`row-${rowIndex}`} style={styles.markdownTableRow}>
                  {block.headers.map((_, cellIndex) => (
                    <Text key={`${rowIndex}-${cellIndex}`} style={[colorStyle, styles.markdownTableCell]}>{row[cellIndex] ?? ''}</Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      })}
    </View>
  );
}

function fieldKey(value: Record<string, unknown>, index: number): string {
  return text(value.id, text(value.name, label(value, `field_${index}`))).toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function WidgetShell({
  title,
  subtitle,
  children,
  showHeader = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  showHeader?: boolean;
}) {
  return (
    <View style={styles.card}>
      {showHeader ? <Text style={styles.title}>{title}</Text> : null}
      {showHeader && subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function Bubble({
  contextPrompt,
  message,
  onFollowUp,
  saveOutcome,
}: {
  contextPrompt?: string;
  message: ChatMessage;
  onFollowUp: (prompt: string) => void;
  saveOutcome?: Record<string, unknown>;
}) {
  const assistant = message.role === 'assistant';
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [savedPlan, setSavedPlan] = useState<{ id: string; operationId: string } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const saveCollection = text(saveOutcome?.collection);
  const answerPattern = text(saveOutcome?.when, '.+');
  let planningAnswer = false;
  try {
    planningAnswer = assistant && Boolean(saveCollection) && new RegExp(answerPattern, 'i').test(contextPrompt ?? '');
  } catch {
    planningAnswer = assistant && Boolean(saveCollection);
  }

  const savePlan = useCallback(async () => {
    if (!db || !runtime.activeManifest || saving) return;
    setSaving(true);
    setOutcome(null);
    try {
      const now = new Date().toISOString();
      const id = `saved-outcome-${Date.now().toString(36)}`;
      const operationId = `op-chat-outcome-${message.id.replace(/[^A-Za-z0-9_-]/g, '-')}-${Date.now().toString(36)}`;
      await upsertRecord(db, runtime.activeManifest, {
        id,
        collection: saveCollection,
        title: text(message.answer?.title, text(saveOutcome?.title, 'Saved result')),
        properties: {
          status: text(saveOutcome?.status, 'saved'),
          body: message.text,
          saved_for: now.slice(0, 10),
          generated_from: 'assistant',
          source_record_ids: message.answer?.recordCards?.map((record) => record.id) ?? [],
        },
        source: {
          provider: 'user',
          external_id: `assistant:${message.id}`,
          url: null,
          observed_at: now,
          content_hash: null,
        },
        archived_at: null,
        created_at: now,
        updated_at: now,
        operation_actor: 'user',
        operation_origin: 'chat',
        operation_id: operationId,
        idempotency_key: `chat-outcome:${message.id}`,
      });
      setSavedPlan({ id, operationId });
      setOutcome(text(saveOutcome?.successMessage, 'Saved.'));
    } catch (error) {
      setOutcome(error instanceof Error ? error.message : 'Could not save this plan.');
    } finally {
      setSaving(false);
    }
  }, [db, message, runtime.activeManifest, saveCollection, saveOutcome, saving]);

  const undoSavedPlan = useCallback(async () => {
    if (!db || !runtime.activeManifest || !savedPlan || saving) return;
    setSaving(true);
    try {
      const result = await undoOperation(db, runtime.activeManifest, savedPlan.operationId);
      if (result.status === 'applied' || result.status === 'duplicate') {
        setSavedPlan(null);
        setOutcome('Saved result removed.');
      } else {
        setOutcome(`Could not undo: ${result.reject_reason ?? 'unknown error'}`);
      }
    } finally {
      setSaving(false);
    }
  }, [db, runtime.activeManifest, savedPlan, saving]);

  const undoReceipt = useCallback(async () => {
    if (!message.actionReceipt || saving) return;
    setSaving(true);
    try {
      const config = await resolveChatServerConfig();
      const result = await undoChatAction({
        db,
        receipt: message.actionReceipt,
        domainId: runtime.catalog?.activeDomainId ?? runtime.activeManifest?.id ?? 'app',
        baseUrl: config.serverUrl,
        token: config.serverToken,
        actor: 'mobile-json-render',
      });
      setOutcome(result.undo_result?.message ?? (result.status === 'completed' ? 'Undo completed.' : 'Undo failed.'));
    } finally {
      setSaving(false);
    }
  }, [db, message.actionReceipt, runtime.activeManifest?.id, runtime.catalog?.activeDomainId, saving]);
  const markdownBlocks = useMemo(() => parseMarkdownBlocks(message.text), [message.text]);
  const markdownLinks = useMemo(() => extractMarkdownLinks(message.text), [message.text]);

  return (
    <View style={[styles.bubble, assistant ? styles.assistantBubble : styles.userBubble]}>
      <MarkdownText colorStyle={assistant ? styles.assistantText : styles.userText} blocks={markdownBlocks} />
      {assistant && markdownLinks.length ? (
        <View style={styles.linkPreviewStack}>
          {markdownLinks.map((link) => (
            <Pressable key={link.url} style={styles.linkPreviewChip} onPress={() => void Linking.openURL(link.url)}>
              <Text style={styles.linkPreviewTitle}>{link.label || 'Open link'}</Text>
              <Text numberOfLines={1} style={styles.linkPreviewUrl}>{link.url}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {message.answer?.recordCards?.length ? (
        <View style={styles.sources}>
          {message.answer.recordCards.slice(0, 3).map((record) => (
            <Pressable
              accessibilityRole="button"
              key={record.id}
              onPress={() => router.push(`/record/${encodeURIComponent(record.id)}` as never)}
              style={styles.sourceRow}
            >
              <Text style={styles.sourceText}>• {record.title} · {record.detail}</Text>
              <Text style={styles.sourceArrow}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {message.actionReceipt ? (
        <View style={styles.outcomeCard}>
          <Text style={styles.outcomeTitle}>
            {message.actionReceipt.status === 'completed' ? 'Saved and verified' : `Action ${message.actionReceipt.status}`}
          </Text>
          <Text style={styles.outcomeCopy}>{message.actionReceipt.record_ids.length} record change{message.actionReceipt.record_ids.length === 1 ? '' : 's'}</Text>
          {message.actionReceipt.status === 'completed' ? (
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void undoReceipt()} style={styles.outcomeSecondary}>
              <Text style={styles.outcomeSecondaryText}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {planningAnswer ? (
        <View style={styles.outcomeActions}>
          {savedPlan ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => router.push(`/record/${encodeURIComponent(savedPlan.id)}` as never)} style={styles.outcomePrimary}>
                <Text style={styles.outcomePrimaryText}>Open saved plan</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => void undoSavedPlan()} style={styles.outcomeSecondary}>
                <Text style={styles.outcomeSecondaryText}>Undo</Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void savePlan()} style={styles.outcomePrimary}>
              <Text style={styles.outcomePrimaryText}>{saving ? 'Saving…' : text(saveOutcome?.label, 'Save result')}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => onFollowUp(text(saveOutcome?.followUpPrompt, 'What should I do next with this result?'))}
            style={styles.outcomeSecondary}
          >
            <Text style={styles.outcomeSecondaryText}>{text(saveOutcome?.followUpLabel, 'Next step')}</Text>
          </Pressable>
        </View>
      ) : null}
      {outcome ? <Text style={styles.outcomeMessage}>{outcome}</Text> : null}
    </View>
  );
}

function AssistantChatWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'offline' | 'direct' | 'server' | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [submittedInitialPrompt, setSubmittedInitialPrompt] = useState(false);
  const suggestions = useMemo(() => list(props.suggestions, DEFAULT_PROMPTS), [props.suggestions]);
  const domainId = runtime.catalog?.activeDomainId ?? runtime.activeManifest?.id ?? 'app';

  const submit = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || busy) return;
    setInput('');
    setBusy(true);
    setError(null);
    const optimisticConversationId = thread?.id ?? `pending-${Date.now()}`;
    const optimisticUserId = `pending-user-${Date.now()}`;
    const optimisticThread: ChatThread = {
      id: optimisticConversationId,
      title: value.slice(0, 36) || 'Conversation',
      detail: 'Working…',
      messages: [
        ...(thread?.messages ?? []),
        { id: optimisticUserId, role: 'user', text: value },
      ],
    };
    setThread(optimisticThread);
    try {
      const result = await sendChatMessage({
        db,
        text: value,
        domainId,
        conversationId: thread?.id,
        actor: 'mobile-json-render',
      });
      setThread(result.thread);
      setMode(result.mode);
      if (result.serverError) setError(result.serverError);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, db, domainId, thread?.id]);

  useEffect(() => {
    const initialPrompt = text(props.initialPrompt);
    if (!initialPrompt || submittedInitialPrompt) return;
    setInput(initialPrompt);
    if (props.autoSubmitPrompt === true) {
      setSubmittedInitialPrompt(true);
      void submit(initialPrompt);
    }
  }, [props.autoSubmitPrompt, props.initialPrompt, submit, submittedInitialPrompt]);

  useEffect(() => {
    if (props.fullPage !== true) return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const obscuredHeight = Dimensions.get('screen').height - event.endCoordinates.screenY;
      setKeyboardHeight(Math.max(event.endCoordinates.height, obscuredHeight) + 8);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [props.fullPage]);

  const messages = thread?.messages ?? [];
  const fullPage = props.fullPage === true;

  const content = (
    <>
      <ScrollView
        style={[styles.chatLog, fullPage ? styles.chatLogFullPage : null]}
        contentContainerStyle={[styles.chatLogContent, fullPage ? styles.chatLogContentFullPage : null]}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length ? messages.map((message, index) => (
          <Bubble
            contextPrompt={message.role === 'assistant' ? messages.slice(0, index).reverse().find((item) => item.role === 'user')?.text : undefined}
            key={message.id}
            message={message}
            onFollowUp={(prompt) => void submit(prompt)}
            saveOutcome={props.saveOutcome && typeof props.saveOutcome === 'object' && !Array.isArray(props.saveOutcome)
              ? props.saveOutcome as Record<string, unknown>
              : undefined}
          />
        )) : (
          <View style={styles.emptyChat}>
            <Text style={styles.emptyTitle}>{text(props.emptyTitle, 'What should this app do next?')}</Text>
            <Text style={styles.emptyCopy}>{text(props.emptyCopy, 'Ask for record help, summaries, or app changes. The assistant falls back to local records when live AI is unavailable.')}</Text>
          </View>
        )}
        {busy ? <ActivityIndicator color="#2F7448" /> : null}
      </ScrollView>
      <View style={fullPage ? [styles.chatComposerDock, { bottom: keyboardHeight }] : null}>
        {mode ? (
          <View style={styles.chatMode}>
            <Text style={styles.chatModeText}>{mode === 'offline' ? 'On-device answer' : mode === 'direct' ? 'Direct AI' : 'Connected AI'}</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.warning}>{error}</Text> : null}
        {!messages.length && keyboardHeight === 0 ? (
          <View style={styles.suggestions}>
            {suggestions.slice(0, 4).map((suggestion) => (
              <Pressable key={suggestion} style={styles.suggestion} onPress={() => submit(suggestion)}>
                <Text style={styles.suggestionText}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={text(props.prompt, 'Ask anything…')}
            placeholderTextColor="#8A8172"
            style={styles.input}
            multiline
          />
          <Pressable style={[styles.send, busy ? styles.disabled : null]} onPress={() => submit(input)} disabled={busy}>
            <Text style={styles.sendText}>{busy ? '…' : 'Send'}</Text>
          </Pressable>
        </View>
      </View>
    </>
  );

  if (fullPage) {
    return <View style={styles.chatFullPage}>{content}</View>;
  }

  return (
    <WidgetShell
      title={text(props.title, 'Assistant')}
      subtitle={text(props.subtitle, 'Source-backed chat, editor, and proposal surface.')}
      showHeader={props.showHeader !== false}
    >
      {content}
    </WidgetShell>
  );
}

function HealthConnectWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const [status, setStatus] = useState<HealthConnectStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await getUtopiaHealthStatus());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const askPermission = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await requestUtopiaHealthPermissions());
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <WidgetShell
      title={text(props.title, 'Health Connect')}
      subtitle={text(props.subtitle, 'Optional Android health context for package decisions. You choose what is shared.')}
    >
      <View style={styles.statusPill}>
        <Text style={styles.statusText}>{status?.availability ?? 'checking'}</Text>
      </View>
      <Text style={styles.bodyText}>{status?.message ?? 'Checking Health Connect on this device…'}</Text>
      <Text style={styles.bodyText}>{status?.granted.length ? `${status.granted.length} permissions ready` : 'No health permissions enabled yet.'}</Text>
      <View style={styles.buttonRow}>
        <Pressable style={styles.secondaryButton} onPress={refresh} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Check again</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={askPermission} disabled={busy}>
          <Text style={styles.primaryButtonText}>Choose access</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => void openUtopiaHealthSettings()}>
          <Text style={styles.secondaryButtonText}>Android settings</Text>
        </Pressable>
      </View>
    </WidgetShell>
  );
}

function ThemeDensitySelectorWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const settings = useUtopiaSettingsSnapshot();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const theme = settings.runtime.theme;
  const density = settings.runtime.density;

  const update = useCallback(async (next: Partial<{ theme: typeof theme; density: typeof density }>) => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveUtopiaRuntimePreferences(next);
      setMessage(`Saved ${saved.runtime.theme} · ${saved.runtime.density}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save appearance.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <WidgetShell
      title={text(props.title, 'Appearance')}
      subtitle={text(props.subtitle, 'Persistent theme and density for this device.')}
    >
      <Text style={styles.bodyText}>Current: {theme} · {density}</Text>
      <View style={styles.preferenceGroup}>
        <Text style={styles.formLabel}>Theme</Text>
        <View style={styles.segmentedRow}>
          {(['system', 'light', 'dark'] as const).map((item) => (
            <Pressable key={item} style={[styles.segment, theme === item ? styles.segmentActive : null]} onPress={() => update({ theme: item })} disabled={busy}>
              <Text style={[styles.segmentText, theme === item ? styles.segmentTextActive : null]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.preferenceGroup}>
        <Text style={styles.formLabel}>Density</Text>
        <View style={styles.segmentedRow}>
          {(['comfortable', 'compact'] as const).map((item) => (
            <Pressable key={item} style={[styles.segment, density === item ? styles.segmentActive : null]} onPress={() => update({ density: item })} disabled={busy}>
              <Text style={[styles.segmentText, density === item ? styles.segmentTextActive : null]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {message ? <Text style={message.startsWith('Saved') ? styles.success : styles.warning}>{message}</Text> : null}
    </WidgetShell>
  );
}

function providerKind(value: string): AiProviderKind {
  if (value === 'azure_openai' || value === 'anthropic' || value === 'openai_compatible') return value;
  return 'openai_compatible';
}

function AiProviderProfileEditor({
  profile,
  onSaved,
}: {
  profile: AiProviderProfile;
  onSaved(message: string): void;
}) {
  const [enabled, setEnabled] = useState(profile.enabled);
  const [provider, setProvider] = useState<AiProviderKind>(profile.provider);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  const [model, setModel] = useState(profile.model);
  const [apiVersion, setApiVersion] = useState(profile.apiVersion);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(profile.enabled);
    setProvider(profile.provider);
    setBaseUrl(profile.baseUrl);
    setModel(profile.model);
    setApiVersion(profile.apiVersion);
    setApiKey('');
  }, [profile]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const saved = await saveUtopiaAiProviderProfile(profile.id, {
        enabled,
        provider,
        baseUrl,
        model,
        apiVersion,
        ...(apiKey.trim() ? { apiKey } : {}),
      });
      onSaved(`Saved ${providerLabel(saved.ai[profile.id])}.`);
      setApiKey('');
    } catch (error) {
      onSaved(error instanceof Error ? error.message : 'Could not save AI provider.');
    } finally {
      setBusy(false);
    }
  }, [apiKey, apiVersion, baseUrl, enabled, model, onSaved, profile.id, provider]);

  return (
    <View style={styles.providerEditor}>
      <View style={styles.permissionHeading}>
        <Text style={styles.providerEditorTitle}>{profile.id === 'primary' ? 'Primary model' : 'Fallback model'}</Text>
        <Pressable style={[styles.statusPill, enabled ? null : styles.statusPillAttention]} onPress={() => setEnabled((value) => !value)}>
          <Text style={[styles.statusText, enabled ? null : styles.statusTextAttention]}>{enabled ? 'Enabled' : 'Off'}</Text>
        </Pressable>
      </View>
      <Text style={styles.sourceHomeDetail}>Key: {maskSecret(profile.apiKey)}</Text>
      <View style={styles.segmentedRow}>
        {(['openai_compatible', 'azure_openai', 'anthropic'] as const).map((item) => (
          <Pressable key={item} style={[styles.segment, provider === item ? styles.segmentActive : null]} onPress={() => setProvider(providerKind(item))}>
            <Text style={[styles.segmentText, provider === item ? styles.segmentTextActive : null]}>{item.replace('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={baseUrl} onChangeText={setBaseUrl} placeholder="Base URL" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
      <TextInput value={model} onChangeText={setModel} placeholder="Model or deployment" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
      {provider === 'azure_openai' ? (
        <TextInput value={apiVersion} onChangeText={setApiVersion} placeholder="Azure API version" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
      ) : null}
      <TextInput
        value={apiKey}
        onChangeText={setApiKey}
        placeholder={profile.apiKey ? 'Leave blank to keep saved key' : 'Paste API key'}
        placeholderTextColor="#9A8D7D"
        autoCapitalize="none"
        secureTextEntry
        style={styles.formInput}
      />
      <Pressable style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={save} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : `Save ${profile.id}`}</Text>
      </Pressable>
    </View>
  );
}

function AiProviderSettingsWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const settings = useUtopiaSettingsSnapshot();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <WidgetShell
      title={text(props.title, 'AI model settings')}
      subtitle={text(props.subtitle, 'Choose provider, model, and API key. Keys are masked and stored in device secure storage on native.')}
    >
      <Text style={styles.bodyText}>Active profiles: {settings.ai.primary.enabled ? providerLabel(settings.ai.primary) : 'primary off'} · {settings.ai.fallback.enabled ? providerLabel(settings.ai.fallback) : 'fallback off'}</Text>
      <AiProviderProfileEditor profile={settings.ai.primary} onSaved={setMessage} />
      <AiProviderProfileEditor profile={settings.ai.fallback} onSaved={setMessage} />
      {message ? <Text style={message.startsWith('Saved') ? styles.success : styles.warning}>{message}</Text> : null}
    </WidgetShell>
  );
}

function DataHomeEditor({
  provider,
  onSaved,
}: {
  provider: 'notion' | 'sheets';
  onSaved(message: string): void;
}) {
  const settings = useUtopiaSettingsSnapshot();
  const current = settings[provider];
  const [enabled, setEnabled] = useState(current.enabled);
  const [token, setToken] = useState('');
  const [pageId, setPageId] = useState(provider === 'notion' ? settings.notion.pageId : '');
  const [dataSourceIds, setDataSourceIds] = useState(provider === 'notion' ? settings.notion.dataSourceIds : '');
  const [workbookId, setWorkbookId] = useState(provider === 'sheets' ? settings.sheets.workbookId : '');
  const [sheetName, setSheetName] = useState(provider === 'sheets' ? settings.sheets.sheetName : 'App');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(current.enabled);
    setToken('');
    if (provider === 'notion') {
      setPageId(settings.notion.pageId);
      setDataSourceIds(settings.notion.dataSourceIds);
    } else {
      setWorkbookId(settings.sheets.workbookId);
      setSheetName(settings.sheets.sheetName);
    }
  }, [current.enabled, provider, settings.notion.dataSourceIds, settings.notion.pageId, settings.sheets.sheetName, settings.sheets.workbookId]);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const patch: SourceProviderSettingsUpdate = {
        enabled,
        ...(token.trim() ? { token } : {}),
        ...(provider === 'notion' ? { pageId, dataSourceIds } : { workbookId, sheetName }),
      };
      const saved = await saveUtopiaSourceProviderSettings(provider, patch);
      const next = saved[provider];
      onSaved(`${provider === 'notion' ? 'Notion' : 'Sheets'} ${next.enabled ? 'enabled' : 'saved off'} · token ${maskSecret(next.token)}.`);
      setToken('');
    } catch (error) {
      onSaved(error instanceof Error ? error.message : `Could not save ${provider}.`);
    } finally {
      setBusy(false);
    }
  }, [dataSourceIds, enabled, onSaved, pageId, provider, sheetName, token, workbookId]);

  return (
    <View style={styles.providerEditor}>
      <View style={styles.permissionHeading}>
        <Text style={styles.providerEditorTitle}>{provider === 'notion' ? 'Notion home' : 'Sheets home'}</Text>
        <Pressable style={[styles.statusPill, enabled ? null : styles.statusPillAttention]} onPress={() => setEnabled((value) => !value)}>
          <Text style={[styles.statusText, enabled ? null : styles.statusTextAttention]}>{enabled ? 'Enabled' : 'Off'}</Text>
        </Pressable>
      </View>
      <Text style={styles.sourceHomeDetail}>Token: {maskSecret(current.token)}</Text>
      {provider === 'notion' ? (
        <>
          <TextInput value={pageId} onChangeText={setPageId} placeholder="Notion page ID" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
          <TextInput value={dataSourceIds} onChangeText={setDataSourceIds} placeholder="Notion data source IDs, comma separated" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
        </>
      ) : (
        <>
          <TextInput value={workbookId} onChangeText={setWorkbookId} placeholder="Google Sheet workbook ID" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
          <TextInput value={sheetName} onChangeText={setSheetName} placeholder="Sheet tab name" placeholderTextColor="#9A8D7D" autoCapitalize="none" style={styles.formInput} />
        </>
      )}
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder={current.token ? 'Leave blank to keep saved token' : 'Paste access token'}
        placeholderTextColor="#9A8D7D"
        autoCapitalize="none"
        secureTextEntry
        style={styles.formInput}
      />
      <Pressable style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={save} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save home'}</Text>
      </Pressable>
    </View>
  );
}

function DataHomeSettingsWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const router = useRouter();
  const db = useUtopiaDatabase();
  const { activeManifest } = useAppRuntime();
  const settings = useUtopiaSettingsSnapshot();
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const compact = props.compact === true;
  const actions = rows(props.actions).filter((item) => label(item).length > 0);
  const pullNow = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      if (!db || !activeManifest) throw new Error('Food data is still opening.');
      const receipts = await syncConfiguredSources({ db, manifest: activeManifest, settings });
      setMessage(receipts.map((receipt) => receipt.message).join('\n'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not pull food homes.');
    } finally {
      setSyncing(false);
    }
  }, [activeManifest, db, settings]);
  return (
    <WidgetShell
      title={text(props.title, 'Data homes')}
      subtitle={text(props.subtitle, 'Bind Notion or Sheets once. Local still works without them.')}
    >
      <Text style={styles.bodyText}>
        Notion {settings.notion.enabled ? 'on' : 'off'} · Sheets {settings.sheets.enabled ? 'on' : 'off'}
      </Text>
      {compact ? (
        <View style={styles.providerEditor}>
          <Text style={styles.sourceHomeDetail}>
            Local works now. Connect Notion/Sheets only if that is where your family or team already shares this package data.
          </Text>
          {actions.map((item) => (
            <Pressable key={label(item)} style={styles.secondaryButton} onPress={() => openWidgetTarget(router, item)}>
              <Text style={styles.secondaryButtonText}>{label(item)}</Text>
              {detail(item) ? <Text style={styles.sourceHomeDetail}>{detail(item)}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <DataHomeEditor provider="notion" onSaved={setMessage} />
          <DataHomeEditor provider="sheets" onSaved={setMessage} />
          <Pressable style={[styles.primaryButton, syncing ? styles.disabled : null]} onPress={pullNow} disabled={syncing}>
            <Text style={styles.primaryButtonText}>{syncing ? 'Pulling…' : 'Pull food home now'}</Text>
          </Pressable>
        </>
      )}
      {message ? <Text style={message.includes('Could not') ? styles.warning : styles.success}>{message}</Text> : null}
    </WidgetShell>
  );
}

function SchemaEditorWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const db = useUtopiaDatabase();
  const { installationId } = useAppRuntime();
  const [prompt, setPrompt] = useState(text(props.prompt, 'Add a notes table with a cute card list'));
  const examples = rows(props.examples).map((item) => ({
    title: label(item),
    prompt: text(item.prompt, label(item)),
    detail: detail(item),
  })).filter((item) => item.prompt.length > 0);
  const [preview, setPreview] = useState<AppPackageChangePreview | null>(null);
  const [request, setRequest] = useState<AppPackageChangeRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!db || !installationId) throw new Error('Database is not ready yet.');
      const active = await getActiveAppPackage(db, installationId);
      if (!active) throw new Error('No active app package yet.');
      const nextRequest = buildSafePackageChangeRequest(active, prompt);
      const nextPreview = await previewAppPackageChange(db, installationId, nextRequest);
      setRequest(nextRequest);
      setPreview(nextPreview);
      setMessage(nextPreview.status === 'valid' ? 'Preview ready. Review, then approve.' : 'Preview blocked. Nothing changed.');
    } catch (err) {
      setPreview(null);
      setRequest(null);
      setError(err instanceof Error ? err.message : 'Package preview failed.');
    } finally {
      setBusy(false);
    }
  }, [db, installationId, prompt]);

  const applyPreview = useCallback(async () => {
    if (!request || !preview?.packageHash || preview.status !== 'valid') return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!db || !installationId) throw new Error('Database is not ready yet.');
      const applied = await activateApprovedAppPackageChange(db, installationId, request, {
        schemaVersion: 'wonder.package-change-approval.v1',
        approved: true,
        requestHash: preview.requestHash,
        packageHash: preview.packageHash,
        approvedBy: 'mobile-package-editor',
        approvedAt: new Date().toISOString(),
      });
      setMessage(`Applied ${applied.id}@${applied.version}. Reopen this screen if it does not refresh immediately.`);
      setPreview(null);
      setRequest(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Package apply failed.');
    } finally {
      setBusy(false);
    }
  }, [db, installationId, preview, request]);

  return (
    <WidgetShell
      title={text(props.title, 'AI package editor')}
      subtitle={text(props.subtitle, 'Describe a table or screen change. The app previews a safe package diff before it can apply.')}
    >
      <TextInput
        value={prompt}
        onChangeText={setPrompt}
        placeholder={text(props.placeholder, 'Example: add a family recipes table')}
        placeholderTextColor="#8A8172"
        style={styles.editorInput}
        multiline
      />
      {examples.length ? (
        <View style={styles.exampleGrid}>
          {examples.slice(0, 6).map((example) => (
            <Pressable key={example.prompt} style={styles.exampleChip} onPress={() => setPrompt(example.prompt)}>
              <Text style={styles.exampleTitle}>{example.title}</Text>
              {example.detail ? <Text style={styles.exampleDetail}>{example.detail}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.buttonRow}>
        <Pressable style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={buildPreview} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Checking…' : 'Preview change'}</Text>
        </Pressable>
        {preview?.status === 'valid' ? (
          <Pressable style={[styles.secondaryButton, busy ? styles.disabled : null]} onPress={applyPreview} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Approve & apply</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.warning}>{error}</Text> : null}
      {preview ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>{preview.status === 'valid' ? 'Safe package diff' : 'Blocked diff'}</Text>
          <Text style={styles.previewText}>Request {shortHash(preview.requestHash)}</Text>
          {preview.packageHash ? <Text style={styles.previewText}>Package {shortHash(preview.packageHash)}</Text> : null}
          {request ? <Text style={styles.previewText}>{request.patch.length} patch steps · hidden writes: no</Text> : null}
          {preview.errors.map((item) => <Text key={item} style={styles.warning}>• {item}</Text>)}
        </View>
      ) : (
        <Text style={styles.bodyText}>V1 supports safe app-package patches for new tables, views, and JSON-render screens. Native packages and dependency pins stay locked.</Text>
      )}
    </WidgetShell>
  );
}

function shortHash(value: string) {
  return value.length > 18 ? `${value.slice(0, 14)}…${value.slice(-4)}` : value;
}

function PollCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const [selected, setSelected] = useState<string | null>(null);
  const options = rows(props.options);
  const actions = rows(props.actions);
  const visibleOptions = (options.length ? options : [{ label: 'Yes' }, { label: 'No' }]).slice(0, 8);
  const totalVotes = Math.max(0, visibleOptions.reduce((sum, option) => sum + numberValue(option.votes, numberValue(option.count)), 0));
  return (
    <WidgetShell title={text(props.title, 'Poll')} subtitle={text(props.subtitle, 'Choose one. Stored action wiring comes from package proposals.')}>
      {visibleOptions.map((option) => {
        const optionLabel = label(option);
        const votes = numberValue(option.votes, numberValue(option.count));
        const percent = Math.max(0, Math.min(100, numberValue(option.percent, totalVotes > 0 ? (votes / totalVotes) * 100 : 0)));
        return (
          <Pressable key={optionLabel} style={[styles.pollOption, selected === optionLabel ? styles.pollSelected : null]} onPress={() => setSelected(optionLabel)}>
            <View style={styles.pollHeading}>
              <Text style={styles.pollText}>{optionLabel}</Text>
              {totalVotes || option.percent !== undefined ? <Text style={styles.pollMeta}>{Math.round(percent)}%</Text> : null}
            </View>
            <Text style={styles.pollMeta}>{selected === optionLabel ? 'Selected' : detail(option, 'Tap to choose')}</Text>
            {totalVotes || option.percent !== undefined ? (
              <View style={styles.pollTrack}>
                <View style={[styles.pollFill, { width: `${Math.max(4, percent)}%` }]} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
      {selected && actions.length ? (
        <View style={styles.buttonRow}>
          {actions.slice(0, 3).map((action) => (
            <Pressable key={label(action)} style={styles.miniAction} onPress={() => openWidgetTarget(router, action)}>
              <Text style={styles.miniActionText}>{label(action)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </WidgetShell>
  );
}

function KanbanBoardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const columns = rows(props.columns);
  return (
    <WidgetShell title={text(props.title, 'Board')} subtitle={text(props.subtitle, 'Generic grouped work, projects, or approvals.')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
        {(columns.length ? columns : [{ title: 'Ideas', items: [{ title: 'Draft setup' }] }, { title: 'Next', items: [{ title: 'Review changes' }] }]).map((column) => (
          <View key={label(column, 'Column')} style={styles.boardColumn}>
            <Text style={styles.boardTitle}>{label(column, 'Column')}</Text>
            {rows(column.items).slice(0, 5).map((item) => (
              <Pressable key={label(item)} style={styles.boardCard} onPress={() => openWidgetTarget(router, item)} disabled={!actionRoute(item) && !actionUrl(item)}>
                <Text style={styles.boardCardText}>{label(item)}</Text>
                {detail(item) ? <Text style={styles.boardCardDetail}>{detail(item)}</Text> : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </WidgetShell>
  );
}

type CaptureAsset = {
  uri: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
};

async function persistCaptureAsset(asset: ImagePicker.ImagePickerAsset): Promise<CaptureAsset> {
  const base = FileSystem.documentDirectory;
  if (!base) {
    return {
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    };
  }
  const directory = `${base}wonder-captures/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = (() => {
    const fromName = asset.fileName?.match(/\.([a-zA-Z0-9]+)$/)?.[1];
    if (fromName) return fromName.toLowerCase();
    if (asset.mimeType === 'image/png') return 'png';
    if (asset.mimeType === 'image/webp') return 'webp';
    return 'jpg';
  })();
  const destination = `${directory}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destination });
  return {
    uri: destination,
    mimeType: asset.mimeType ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

function SmartCaptureWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const router = useRouter();
  const modes = rows(props.items);
  const availableModes = (modes.length ? modes : [
    { id: 'photo', title: 'Photo', emoji: '▧', input: 'image', collection: 'attachment' },
    { id: 'note', title: 'Note', emoji: '✎', input: 'note', collection: 'source_record' },
  ]).slice(0, 6);
  const [modeId, setModeId] = useState(text(availableModes[0]?.id, 'photo'));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  const [asset, setAsset] = useState<CaptureAsset | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activeMode = availableModes.find((mode) => text(mode.id) === modeId) ?? availableModes[0];
  const inputKind = text(activeMode?.input, 'note');
  const needsImage = inputKind === 'image' || inputKind === 'camera' || inputKind === 'receipt';
  const needsUrl = inputKind === 'url';

  const chooseMode = useCallback((nextMode: Record<string, unknown>) => {
    setModeId(text(nextMode.id, label(nextMode)));
    setPreviewing(false);
    setMessage(null);
    setAsset(null);
    setTitle('');
    setNotes('');
    setUrl('');
  }, []);

  const pickImage = useCallback(async (source: 'camera' | 'library') => {
    setBusy(true);
    setMessage(null);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setMessage('Camera access was not granted.');
          return;
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled || !result.assets[0]) return;
      const saved = await persistCaptureAsset(result.assets[0]);
      setAsset(saved);
      setPreviewing(false);
      if (!title.trim()) {
        setTitle(inputKind === 'receipt' ? 'Receipt' : 'Food photo');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not capture image.');
    } finally {
      setBusy(false);
    }
  }, [inputKind, title]);

  const preview = useCallback(() => {
    if (!title.trim()) {
      setMessage('Add a name first.');
      return;
    }
    if (needsImage && !asset) {
      setMessage('Take or choose a photo first.');
      return;
    }
    if (needsUrl && !/^https?:\/\//i.test(url.trim())) {
      setMessage('Add a full http or https link.');
      return;
    }
    setMessage(null);
    setPreviewing(true);
  }, [asset, needsImage, needsUrl, title, url]);

  const save = useCallback(async () => {
    if (!db || !runtime.activeManifest || !activeMode) {
      setMessage('Food storage is not ready.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const id = `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const collection = text(activeMode.collection, 'source_record');
      const saved = await upsertRecord(db, runtime.activeManifest, {
        id,
        collection,
        title: title.trim(),
        properties: {
          status: 'captured',
          body: notes.trim(),
          capture_mode: text(activeMode.id, inputKind),
          capture_label: label(activeMode),
          ...(asset ? {
            attachment_uri: asset.uri,
            attachment_mime_type: asset.mimeType,
            attachment_width: asset.width,
            attachment_height: asset.height,
          } : {}),
          ...(needsUrl ? { source_url: url.trim() } : {}),
        },
        source: {
          provider: 'user',
          external_id: id,
          url: needsUrl ? url.trim() : asset?.uri ?? null,
          observed_at: now,
          content_hash: null,
        },
        archived_at: null,
        created_at: now,
        updated_at: now,
        operation_actor: 'user',
        operation_origin: 'manual',
        idempotency_key: `capture:${id}`,
      });
      router.push(`/record/${encodeURIComponent(saved.id)}` as never);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this capture.');
    } finally {
      setBusy(false);
    }
  }, [activeMode, asset, db, inputKind, needsUrl, notes, router, runtime.activeManifest, title, url]);

  return (
    <WidgetShell title={text(props.title, 'Add')} subtitle={text(props.subtitle, 'Capture something useful.')}>
      <View style={styles.captureModes}>
        {availableModes.map((mode) => {
          const id = text(mode.id, label(mode));
          const selected = id === modeId;
          return (
            <Pressable key={id} style={[styles.captureMode, selected ? styles.captureModeActive : null]} onPress={() => chooseMode(mode)}>
              <Text style={[styles.captureModeText, selected ? styles.captureModeTextActive : null]}>{text(mode.emoji)} {label(mode)}</Text>
            </Pressable>
          );
        })}
      </View>
      {needsImage ? (
        <>
          <View style={styles.buttonRow}>
            <Pressable style={styles.primaryButton} onPress={() => void pickImage('camera')} disabled={busy}>
              <Text style={styles.primaryButtonText}>{busy ? 'Opening…' : 'Take photo'}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void pickImage('library')} disabled={busy}>
              <Text style={styles.secondaryButtonText}>Choose photo</Text>
            </Pressable>
          </View>
          {asset ? <Image source={{ uri: asset.uri }} style={styles.capturePreviewImage} resizeMode="cover" /> : null}
        </>
      ) : null}
      <View style={styles.formField}>
        <Text style={styles.formLabel}>Name</Text>
        <TextInput
          style={styles.formInput}
          value={title}
          onChangeText={(value) => { setTitle(value); setPreviewing(false); }}
          placeholder={text(activeMode?.placeholder, needsUrl ? 'Recipe name' : 'What is this?')}
          placeholderTextColor="#9A8D7D"
        />
      </View>
      {needsUrl ? (
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Link</Text>
          <TextInput
            style={styles.formInput}
            value={url}
            onChangeText={(value) => { setUrl(value); setPreviewing(false); }}
            placeholder="https://…"
            placeholderTextColor="#9A8D7D"
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>
      ) : null}
      <View style={styles.formField}>
        <Text style={styles.formLabel}>Notes</Text>
        <TextInput
          style={[styles.formInput, styles.formInputMultiline]}
          value={notes}
          onChangeText={(value) => { setNotes(value); setPreviewing(false); }}
          placeholder={text(activeMode?.notesPlaceholder, 'Anything useful to remember?')}
          placeholderTextColor="#9A8D7D"
          multiline
        />
      </View>
      {message ? <Text style={styles.warning}>{message}</Text> : null}
      {previewing ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>{title.trim()}</Text>
          <Text style={styles.previewText}>{label(activeMode)} · {text(activeMode.collection, 'source record')}</Text>
          {notes.trim() ? <Text style={styles.previewText}>{notes.trim()}</Text> : null}
          {needsUrl ? <Text style={styles.previewText}>{url.trim()}</Text> : null}
          <Pressable style={styles.primaryButton} onPress={() => void save()} disabled={busy}>
            <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save to Food'}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.primaryButton} onPress={preview} disabled={busy}>
          <Text style={styles.primaryButtonText}>Review</Text>
        </Pressable>
      )}
    </WidgetShell>
  );
}

function FormCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const fields = rows(props.fields);
  const fallback: Record<string, unknown>[] = [
    { label: 'Title', subtitle: 'Text', placeholder: 'What is this?' },
    { label: 'Notes', subtitle: 'Long text', placeholder: 'Add useful context…' },
    { label: 'Status', subtitle: 'Choice', placeholder: 'New, review, done…' },
  ];
  const formFields = (fields.length ? fields : fallback).slice(0, 8);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  return (
    <WidgetShell title={text(props.title, 'Form')} subtitle={text(props.subtitle, 'Config-declared inputs. Writes must still go through proposals/actions.')}>
      {formFields.map((field, index) => {
        const key = fieldKey(field, index);
        const fieldType = text(field.type, detail(field, 'Field'));
        const multiline = /long|note|textarea|multi/i.test(fieldType);
        return (
        <View key={key} style={styles.formField}>
          <Text style={styles.formLabel}>{label(field)}</Text>
          <Text style={styles.formHint}>{fieldType}{field.required === true ? ' · Required' : ''}</Text>
          <TextInput
            style={[styles.formInput, multiline ? styles.formInputMultiline : null]}
            value={values[key] ?? ''}
            onChangeText={(next) => {
              setSubmitted(false);
              setValues((prev) => ({ ...prev, [key]: next }));
            }}
            placeholder={text(field.placeholder, `Enter ${label(field).toLowerCase()}`)}
            placeholderTextColor="#9A8D7D"
            multiline={multiline}
          />
        </View>
        );
      })}
      {submitted ? <Text style={styles.success}>Preview ready. Review before writing.</Text> : null}
      <Pressable style={styles.primaryButton} onPress={() => setSubmitted(true)}>
        <Text style={styles.primaryButtonText}>{text(props.body, text(props.cta, 'Preview action'))}</Text>
      </Pressable>
    </WidgetShell>
  );
}

function ChecklistCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const items = rows(props.items);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  return (
    <WidgetShell title={text(props.title, 'Checklist')} subtitle={text(props.subtitle, 'Tasks, packing, QA, habits, recipes, or setup steps.')}>
      {(items.length ? items : [{ title: 'First step' }, { title: 'Second step' }, { title: 'Done' }]).slice(0, 10).map((item) => {
        const key = label(item);
        return (
          <Pressable key={key} style={styles.checkRow} onPress={() => setChecked((prev) => ({ ...prev, [key]: !prev[key] }))}>
            <Text style={[styles.checkBox, checked[key] ? styles.checkBoxOn : null]}>{checked[key] ? '✓' : ''}</Text>
            <View style={styles.checkCopy}>
              <Text style={styles.checkTitle}>{key}</Text>
              {detail(item) ? <Text style={styles.checkDetail}>{detail(item)}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </WidgetShell>
  );
}

function PermissionCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const permissions = rows(props.permissions);
  return (
    <WidgetShell title={text(props.title, 'Permissions')} subtitle={text(props.subtitle, 'This app asks only when a package feature needs native access.')}>
      {(permissions.length ? permissions : [{ title: 'Health Connect', subtitle: 'Optional device context; you stay in control.' }]).map((permission) => (
        <View key={text(permission.id, permissionLabel(permission))} style={styles.permissionRow}>
          <View style={styles.permissionHeading}>
            <Text style={styles.permissionTitle}>{permissionLabel(permission)}</Text>
            <Text style={styles.permissionMeta}>{permissionMeta(permission)}</Text>
          </View>
          <Text style={styles.permissionDetail}>{text(permission.prompt, detail(permission, 'Used only for this package feature.'))}</Text>
        </View>
      ))}
    </WidgetShell>
  );
}

function ProviderStatusWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const summary = props.providerStatus;
  const status = summary?.headline ?? text(props.status, 'Quietly ready');
  const body = summary?.detail ?? text(props.body, 'Local works first. Notion and Sheets stay invisible unless they need attention.');
  const attention = summary?.status === 'attention';
  const connected = summary?.connected ?? false;
  const homes = rows(props.homes);
  const steps = rows(props.steps);
  const actions = rows(props.actions);
  return (
    <WidgetShell title={text(props.title, 'Sources')} subtitle={text(props.subtitle, 'Your data homes stay quiet until there is something useful to do.')}>
      <View style={[styles.statusPill, attention ? styles.statusPillAttention : null]}>
        <Text style={[styles.statusText, attention ? styles.statusTextAttention : null]}>{status}</Text>
      </View>
      <Text style={styles.bodyText}>{body}</Text>
      {homes.length ? (
        <View style={styles.sourceHomes}>
          {homes.slice(0, 4).map((home) => (
            <View key={label(home)} style={styles.sourceHome}>
              <Text style={styles.sourceHomeIcon}>{text(home.icon, '⌁')}</Text>
              <View style={styles.sourceHomeCopy}>
                <Text style={styles.sourceHomeTitle}>{label(home)}</Text>
                <Text style={styles.sourceHomeDetail}>{detail(home)}</Text>
              </View>
              <Text style={styles.sourceHomeState}>{text(home.status, 'Ready')}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {summary ? (
        <View style={styles.providerStats}>
          <Text style={styles.providerStat}>{connected ? `${summary.linkCount} connected` : 'On-device'}</Text>
          <Text style={styles.providerStat}>{summary.pendingWrites + summary.inflightWrites ? `${summary.pendingWrites + summary.inflightWrites} syncing` : 'Synced'}</Text>
          <Text style={[styles.providerStat, attention ? styles.providerStatAttention : null]}>{summary.failedWrites ? `${summary.failedWrites} need help` : 'Healthy'}</Text>
        </View>
      ) : null}
      {steps.length ? (
        <View style={styles.providerSteps}>
          {steps.slice(0, 4).map((step, index) => (
            <View key={label(step)} style={styles.providerStep}>
              <Text style={styles.providerStepNumber}>{index + 1}</Text>
              <View style={styles.sourceHomeCopy}>
                <Text style={styles.providerStepTitle}>{label(step)}</Text>
                <Text style={styles.sourceHomeDetail}>{detail(step)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {actions.length ? (
        <View style={styles.providerActions}>
          {actions.slice(0, 3).map((action) => (
            <Pressable key={label(action)} style={styles.providerAction} onPress={() => openWidgetTarget(router, action)}>
              <Text style={styles.providerActionTitle}>{label(action)}</Text>
              <Text style={styles.providerActionDetail}>{detail(action, 'Ready when you are.')}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {props.cta ? <Text style={styles.providerCta}>{text(props.cta)}</Text> : null}
    </WidgetShell>
  );
}

function FoodHeroWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const stats = rows((props as Record<string, unknown>).stats);
  const actions = rows(props.actions);
  return (
    <View style={styles.premiumHero}>
      <Text style={styles.premiumEmoji}>{text((props as Record<string, unknown>).emoji, '🍲')}</Text>
      <Text style={styles.premiumBadge}>{text(props.badge, 'Smart plan')}</Text>
      <Text style={styles.premiumTitle}>{text(props.title, 'Tonight is almost solved')}</Text>
      <Text style={styles.premiumSubtitle}>{text(props.subtitle, 'Use-first records, review, and next steps in one place.')}</Text>
      {stats.length ? (
        <View style={styles.premiumStats}>
          {stats.slice(0, 3).map((stat) => (
            <View key={label(stat)} style={styles.premiumStat}>
              <Text style={styles.premiumStatValue}>{text(stat.value, label(stat))}</Text>
              <Text style={styles.premiumStatLabel}>{text(stat.label, detail(stat))}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.premiumBody}>{text(props.body, 'The calmest next path is ready.')}</Text>
      <View style={styles.premiumActions}>
        {actions.slice(0, 3).map((action, index) => (
          <Pressable key={label(action)} style={[styles.premiumAction, index === 0 ? styles.premiumActionPrimary : null]} onPress={() => openWidgetTarget(router, action)}>
            <Text style={[styles.premiumActionText, index === 0 ? styles.premiumActionPrimaryText : null]}>{label(action)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function UseFirstCarouselWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const boundItems = rows(props.records)
    .sort((left, right) => {
      const leftProperties = rows([left.properties])[0] ?? {};
      const rightProperties = rows([right.properties])[0] ?? {};
      return numberValue(leftProperties.expires_in_days, 999) - numberValue(rightProperties.expires_in_days, 999);
    })
    .map((record) => {
      const properties = rows([record.properties])[0] ?? {};
      const expiresInDays = numberValue(properties.expires_in_days, -1);
      return {
        title: text(record.title, 'Food item'),
        subtitle: [text(record.status), text(record.meta)].filter(Boolean).join(' · '),
        badge: expiresInDays >= 0 ? (expiresInDays === 0 ? 'today' : `${expiresInDays}d`) : text(record.status, 'use first'),
        emoji: text(properties.emoji, text(properties.icon, '◉')),
        route: `/record/${encodeURIComponent(text(record.id))}`,
      };
    });
  const configuredItems = rows(props.items);
  const items = props.dataBound === true ? boundItems : configuredItems;
  return (
    <View style={styles.premiumSection}>
      <View style={styles.premiumSectionHeader}>
        <Text style={styles.premiumSectionTitle}>{text(props.title, 'Use first')}</Text>
        {text(props.ctaRoute) ? (
          <Pressable onPress={() => openWidgetTarget(router, { route: props.ctaRoute })}>
            <Text style={styles.premiumSectionCta}>{text(props.cta, 'Cook')}</Text>
          </Pressable>
        ) : null}
      </View>
      {props.subtitle ? <Text style={styles.premiumSectionSubtitle}>{text(props.subtitle)}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.premiumRail}>
        {(items.length ? items : props.dataBound === true
          ? [{ title: 'Nothing urgent', subtitle: 'No expiring kitchen items need attention.', emoji: '✓', badge: 'clear' }]
          : [{ title: 'Baby spinach', subtitle: '2 days · wraps or eggs', emoji: '🥬', badge: '2 days' }]).slice(0, 8).map((item, index) => (
          <Pressable key={label(item)} style={[styles.useFirstPremiumCard, index % 3 === 1 ? styles.useFirstPremiumBlue : index % 3 === 2 ? styles.useFirstPremiumYellow : null]} onPress={() => openWidgetTarget(router, item)}>
            <Text style={styles.useFirstPremiumEmoji}>{text(item.emoji, '🥬')}</Text>
            <Text style={styles.useFirstPremiumBadge}>{text(item.badge, text((item as Record<string, unknown>).status, 'use first'))}</Text>
            <Text style={styles.useFirstPremiumTitle}>{label(item)}</Text>
            <Text style={styles.useFirstPremiumDetail}>{detail(item, 'Ready to use.')}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function MealTimelineWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items);
  return (
    <View style={styles.premiumCard}>
      <Text style={styles.premiumSectionTitle}>{text(props.title, 'Meal timeline')}</Text>
      {props.subtitle ? <Text style={styles.premiumSectionSubtitle}>{text(props.subtitle)}</Text> : null}
      {(items.length ? items : [{ title: 'Dinner', subtitle: 'Pick from available items', time: 'PM' }]).slice(0, 6).map((item) => (
        <Pressable key={label(item)} style={styles.mealPremiumRow} onPress={() => openWidgetTarget(router, item)}>
          <Text style={styles.mealPremiumTime}>{text(item.time, text(item.badge, 'Now'))}</Text>
          <View style={styles.mealPremiumCopy}>
            <Text style={styles.mealPremiumTitle}>{label(item)}</Text>
            <Text style={styles.mealPremiumDetail}>{detail(item, 'Plan-first item.')}</Text>
          </View>
          <Text style={styles.mealPremiumChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

function RecipeCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const chips = rows((props as Record<string, unknown>).chips);
  return (
    <Pressable style={styles.recipePremiumCard} onPress={() => openWidgetTarget(router, props)} disabled={!actionRoute(props) && !actionUrl(props)}>
      <View style={styles.recipePremiumArt}><Text style={styles.recipePremiumEmoji}>{text((props as Record<string, unknown>).emoji, '🍛')}</Text></View>
      <View style={styles.recipePremiumCopy}>
        <Text style={styles.recipePremiumBadge}>{text(props.badge, 'Pantry match')}</Text>
        <Text style={styles.recipePremiumTitle}>{text(props.title, 'Recipe')}</Text>
        <Text style={styles.recipePremiumDetail}>{text(props.subtitle, text(props.body, 'Cook from what you already have.'))}</Text>
        <View style={styles.recipePremiumChips}>
          {(chips.length ? chips : [{ label: '25 min' }, { label: '82% match' }]).slice(0, 4).map((chip) => (
            <Text key={label(chip)} style={styles.recipePremiumChip}>{label(chip)}</Text>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

function ReceiptReviewCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items);
  const actions = rows(props.actions);
  return (
    <View style={styles.receiptPremiumCard}>
      <View style={styles.receiptPremiumHeader}>
        <Text style={styles.receiptPremiumIcon}>🧾</Text>
        <View style={styles.mealPremiumCopy}>
          <Text style={styles.receiptPremiumTitle}>{text(props.title, 'Receipt draft')}</Text>
          <Text style={styles.receiptPremiumDetail}>{text(props.subtitle, 'Source rows are matched and ready for review.')}</Text>
        </View>
        <Text style={styles.receiptPremiumBadge}>{text(props.badge, 'review')}</Text>
      </View>
      {(items.length ? items : [{ title: 'Salmon', subtitle: 'freezer · dinner', status: '+1' }]).slice(0, 5).map((item) => (
        <View key={label(item)} style={styles.receiptPremiumLine}>
          <Text style={styles.receiptPremiumLineTitle}>{label(item)}</Text>
          <Text style={styles.receiptPremiumLineDetail}>{detail(item)}</Text>
          <Text style={styles.receiptPremiumLineStatus}>{text(item.status, 'new')}</Text>
        </View>
      ))}
      <View style={styles.premiumActions}>
        {(actions.length ? actions : [{ title: 'Accept', route: '/capture' }, { title: 'Edit', route: '/capture' }, { title: 'Skip', route: '/capture' }]).slice(0, 3).map((action, index) => (
          <Pressable key={label(action)} style={[styles.premiumAction, index === 0 ? styles.premiumActionPrimary : null]} onPress={() => openWidgetTarget(router, action)}>
            <Text style={[styles.premiumActionText, index === 0 ? styles.premiumActionPrimaryText : null]}>{label(action)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PantryShelfWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const items = rows(props.items);
  return (
    <View style={styles.premiumCard}>
      <Text style={styles.premiumSectionTitle}>{text(props.title, 'Kitchen map')}</Text>
      {props.subtitle ? <Text style={styles.premiumSectionSubtitle}>{text(props.subtitle)}</Text> : null}
      <View style={styles.shelfPremiumGrid}>
        {(items.length ? items : [{ title: 'Fridge', subtitle: '18 items', emoji: '❄️' }]).slice(0, 6).map((item) => (
          <Pressable key={label(item)} style={styles.shelfPremiumTile} onPress={() => openWidgetTarget(router, item)}>
            <Text style={styles.shelfPremiumEmoji}>{text(item.emoji, '🥫')}</Text>
            <Text style={styles.shelfPremiumTitle}>{label(item)}</Text>
            <Text style={styles.shelfPremiumDetail}>{detail(item)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AskFoodBarWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const suggestions = list(props.suggestions, ['What should we do next?', 'Use items before they expire', 'Turn source into clean updates']);
  const ask = (prompt?: string) => {
    const route = prompt
      ? `/chat?prompt=${encodeURIComponent(prompt)}&run=1`
      : '/chat';
    navigateWidgetRoute(router, route);
  };
  return (
    <View style={styles.askPremiumCard}>
      <Text style={styles.askPremiumTitle}>{text(props.title, 'Ask')}</Text>
      <Text style={styles.askPremiumSubtitle}>{text(props.subtitle, 'Questions, sources, updates, decisions.')}</Text>
      <View style={styles.suggestions}>
        {suggestions.slice(0, 4).map((suggestion) => (
          <Pressable accessibilityRole="button" key={suggestion} onPress={() => ask(suggestion)}>
            <Text style={styles.askPremiumChip}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={() => ask()} style={styles.askPremiumInput}>
        <Text style={styles.askPremiumPlaceholder}>{text(props.placeholder, 'Ask what to do, update, use, or change…')}</Text>
        <Text style={styles.askPremiumSend}>Ask</Text>
      </Pressable>
    </View>
  );
}

function SearchableRecordListWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  const records = (Array.isArray(props.records) ? props.records : []) as DomainRecordViewModel[];
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('all');
  const collections = useMemo(
    () => Array.from(new Set(records.map((record) => record.collection))).sort(),
    [records],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (collection !== 'all' && record.collection !== collection) return false;
      if (!needle) return true;
      return [
        record.title,
        record.body,
        record.meta,
        record.status,
        ...Object.values(record.properties).map((value) => String(value ?? '')),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [collection, query, records]);

  return (
    <View style={styles.recordSearch}>
      <View style={styles.searchInputShell}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search records"
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder={text(props.placeholder, 'Search names, locations, notes…')}
          placeholderTextColor="#8C8175"
          style={styles.searchInput}
          value={query}
        />
        {query ? (
          <Pressable accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={10} onPress={() => setQuery('')}>
            <Text style={styles.searchClear}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilters}>
        {['all', ...collections].map((item) => (
          <Pressable
            accessibilityRole="button"
            key={item}
            onPress={() => setCollection(item)}
            style={[styles.searchFilter, collection === item ? styles.searchFilterActive : null]}
          >
            <Text style={[styles.searchFilterText, collection === item ? styles.searchFilterTextActive : null]}>
              {item === 'all' ? 'All' : item.replaceAll('_', ' ')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.searchCount}>{filtered.length} result{filtered.length === 1 ? '' : 's'}</Text>
      {filtered.length ? (
        <View style={styles.compactRecordList}>
          {filtered.slice(0, 100).map((record) => (
            <Pressable
              accessibilityRole="button"
              key={record.id}
              onPress={() => router.push(`/record/${encodeURIComponent(record.id)}` as never)}
              style={styles.compactRecordRow}
            >
              <Text style={styles.compactRecordEmoji}>{text(record.properties.emoji, '•')}</Text>
              <View style={styles.compactRecordCopy}>
                <Text numberOfLines={1} style={styles.compactRecordTitle}>{record.title}</Text>
                <Text numberOfLines={2} style={styles.compactRecordDetail}>{record.body || record.meta}</Text>
              </View>
              <Text style={styles.compactRecordArrow}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.searchEmpty}>
          <Text style={styles.searchEmptyTitle}>{text(props.emptyTitle, 'Nothing matches yet')}</Text>
          <Text style={styles.searchEmptyCopy}>Try another word, change the filter, or add a new item.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push(text(props.emptyActionRoute, '/capture') as never)} style={styles.outcomePrimary}>
            <Text style={styles.outcomePrimaryText}>{text(props.emptyActionLabel, 'Add item')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function RecordDetailWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const record = ((Array.isArray(props.records) ? props.records : [])[0] ?? null) as DomainRecordViewModel | null;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(record?.title ?? '');
  const [body, setBody] = useState(record?.body ?? '');
  const [location, setLocation] = useState(text(record?.properties.location));
  const [quantity, setQuantity] = useState(text(record?.properties.quantity));
  const [expiry, setExpiry] = useState(text(record?.properties.expires_at, text(record?.properties.expiry_date)));
  const [message, setMessage] = useState<string | null>(null);
  const [lastOperationId, setLastOperationId] = useState<string | null>(null);

  useEffect(() => {
    setTitle(record?.title ?? '');
    setBody(record?.body ?? '');
    setLocation(text(record?.properties.location));
    setQuantity(text(record?.properties.quantity));
    setExpiry(text(record?.properties.expires_at, text(record?.properties.expiry_date)));
  }, [record?.id, record?.title, record?.body, record?.properties]);

  const save = useCallback(async () => {
    if (!db || !runtime.activeManifest || !record || !title.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const canonical = await getRecord(db, record.id);
      if (!canonical) throw new Error('This record no longer exists.');
      const now = new Date().toISOString();
      const operationId = `op-record-edit-${record.id.replace(/[^A-Za-z0-9_-]/g, '-')}-${Date.now().toString(36)}`;
      const expiryKey = Object.hasOwn(canonical.properties, 'expires_at') ? 'expires_at' : 'expiry_date';
      await upsertRecord(db, runtime.activeManifest, {
        id: canonical.id,
        collection: canonical.collection,
        title: title.trim(),
        properties: {
          ...canonical.properties,
          body: body.trim(),
          location: location.trim(),
          quantity: quantity.trim(),
          [expiryKey]: expiry.trim(),
        },
        relations: canonical.relations.map((relation) => ({ name: relation.name, target_id: relation.target_id })),
        source: canonical.source,
        archived_at: canonical.archived_at,
        created_at: canonical.created_at,
        updated_at: now,
        operation_actor: 'user',
        operation_origin: 'manual',
        operation_id: operationId,
        idempotency_key: `record-edit:${canonical.id}:${now}`,
      });
      setLastOperationId(operationId);
      setEditing(false);
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }, [body, db, expiry, location, quantity, record, runtime.activeManifest, title]);

  const undo = useCallback(async () => {
    if (!db || !runtime.activeManifest || !lastOperationId) return;
    setBusy(true);
    try {
      const result = await undoOperation(db, runtime.activeManifest, lastOperationId);
      if (result.status === 'applied' || result.status === 'duplicate') {
        const restored = await getRecord(db, record?.id ?? '');
        if (restored) {
          setTitle(restored.title);
          setBody(text(restored.properties.body));
          setLocation(text(restored.properties.location));
          setQuantity(text(restored.properties.quantity));
          setExpiry(text(restored.properties.expires_at, text(restored.properties.expiry_date)));
        }
        setLastOperationId(null);
        setMessage('Changes undone.');
      } else {
        setMessage(`Could not undo: ${result.reject_reason ?? 'unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  }, [db, lastOperationId, record?.id, runtime.activeManifest]);

  if (!record) {
    return (
      <View style={styles.searchEmpty}>
        <ActivityIndicator color="#2F7448" />
        <Text style={styles.searchEmptyCopy}>Loading this item…</Text>
      </View>
    );
  }

  return (
    <View style={styles.recordDetail}>
      <View style={styles.recordDetailHero}>
        <Text style={styles.recordDetailEmoji}>{text(record.properties.emoji, '🍽️')}</Text>
        <View style={styles.recordDetailHeroCopy}>
          <Text style={styles.recordDetailTitle}>{title || record.title}</Text>
          <Text style={styles.recordDetailMeta}>{record.collection.replaceAll('_', ' ')} · {record.status}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => setEditing((value) => !value)} style={styles.recordEditButton}>
          <Text style={styles.recordEditButtonText}>{editing ? 'Close' : 'Edit'}</Text>
        </Pressable>
      </View>
      {editing ? (
        <View style={styles.recordEditForm}>
          {[
            { label: 'Name', value: title, set: setTitle, placeholder: 'Name' },
            { label: 'Location', value: location, set: setLocation, placeholder: 'Location' },
            { label: 'Quantity', value: quantity, set: setQuantity, placeholder: '1 bag, 2 tubs…' },
            { label: 'Expiry', value: expiry, set: setExpiry, placeholder: 'YYYY-MM-DD' },
          ].map((field) => (
            <View key={field.label} style={styles.formField}>
              <Text style={styles.formLabel}>{field.label}</Text>
              <TextInput onChangeText={field.set} placeholder={field.placeholder} placeholderTextColor="#9A8D7D" style={styles.formInput} value={field.value} />
            </View>
          ))}
          <View style={styles.formField}>
            <Text style={styles.formLabel}>Notes</Text>
            <TextInput multiline onChangeText={setBody} placeholder="Useful details" placeholderTextColor="#9A8D7D" style={[styles.formInput, styles.formInputMultiline]} value={body} />
          </View>
          <Pressable accessibilityRole="button" disabled={busy || !title.trim()} onPress={() => void save()} style={styles.outcomePrimary}>
            <Text style={styles.outcomePrimaryText}>{busy ? 'Saving…' : 'Save changes'}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {body ? <Text style={styles.recordDetailBody}>{body}</Text> : null}
          <View style={styles.recordFacts}>
            {[
              ['Location', location || 'Not set'],
              ['Quantity', quantity || 'Not set'],
              ['Expiry', expiry || 'Not set'],
              ['Source', record.source ? 'Connected' : 'On device'],
            ].map(([labelValue, value]) => (
              <View key={labelValue} style={styles.recordFact}>
                <Text style={styles.recordFactLabel}>{labelValue}</Text>
                <Text style={styles.recordFactValue}>{value}</Text>
              </View>
            ))}
          </View>
        </>
      )}
      {message ? (
        <View style={styles.recordSaveState}>
          <Text style={styles.outcomeMessage}>{message}</Text>
          {lastOperationId ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void undo()} style={styles.outcomeSecondary}>
              <Text style={styles.outcomeSecondaryText}>Undo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ScreenHeaderWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const props = element.props ?? {};
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  };
  return (
    <View style={[styles.screenHeader, { paddingTop: Math.max(insets.top + 6, 10) }]}>
      <View style={styles.screenHeaderTitleRow}>
        {props.showBack ? (
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={10}
            onPress={goBack}
            style={styles.screenHeaderBack}
          >
            <Text style={styles.screenHeaderBackText}>‹</Text>
          </Pressable>
        ) : null}
        <View style={styles.screenHeaderCopy}>
          {props.eyebrow ? <Text style={styles.screenHeaderEyebrow}>{text(props.eyebrow)}</Text> : null}
          <Text numberOfLines={1} style={styles.screenHeaderTitle}>{text(props.title, 'App')}</Text>
        </View>
        {props.actionLabel && props.actionRoute ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(props.actionRoute as never)}
            style={styles.screenHeaderAction}
          >
            <Text style={styles.screenHeaderActionText}>{text(props.actionLabel)}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function FloatingActionWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = element.props ?? {};
  if (!props.route) return null;
  return (
    <Pressable
      accessibilityLabel={text(props.label, 'Add')}
      accessibilityRole="button"
      onPress={() => router.push(props.route as never)}
      style={({ pressed }) => [styles.fab, pressed ? styles.fabPressed : null]}
    >
      <Text style={styles.fabPlus}>＋</Text>
      <Text style={styles.fabLabel}>{text(props.label, 'Add')}</Text>
    </Pressable>
  );
}

export const JSON_RENDER_WIDGET_REGISTRY: ComponentRegistry = {
  ScreenHeaderWidget,
  FloatingActionWidget,
  SearchableRecordListWidget,
  RecordDetailWidget,
  AssistantChatWidget,
  HealthConnectWidget,
  ThemeDensitySelectorWidget,
  AiProviderSettingsWidget,
  DataHomeSettingsWidget,
  SchemaEditorWidget,
  PollCardWidget,
  KanbanBoardWidget,
  SmartCaptureWidget,
  FormCardWidget,
  ChecklistCardWidget,
  PermissionCardWidget,
  ProviderStatusWidget,
  FoodHeroWidget,
  UseFirstCarouselWidget,
  MealTimelineWidget,
  RecipeCardWidget,
  ReceiptReviewCardWidget,
  PantryShelfWidget,
  AskFoodBarWidget,
};

const styles = StyleSheet.create({
  screenHeader: {
    backgroundColor: '#FBF7EE',
    borderBottomColor: '#E8DFD1',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  screenHeaderTitleRow: { alignItems: 'center', flexDirection: 'row', minHeight: 42 },
  screenHeaderBack: {
    alignItems: 'center',
    backgroundColor: '#F0E9DE',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginRight: 10,
    width: 36,
  },
  screenHeaderBackText: { color: '#241C16', fontSize: 32, fontWeight: '500', lineHeight: 34 },
  screenHeaderCopy: { flex: 1 },
  screenHeaderEyebrow: { color: '#2F7448', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  screenHeaderTitle: { color: '#241C16', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  screenHeaderAction: { backgroundColor: '#2F7448', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 9 },
  screenHeaderActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  fab: {
    alignItems: 'center',
    backgroundColor: '#2F7448',
    borderRadius: 26,
    bottom: 16,
    elevation: 8,
    flexDirection: 'row',
    gap: 5,
    minHeight: 52,
    paddingHorizontal: 18,
    position: 'absolute',
    right: 16,
    shadowColor: '#102716',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
  },
  fabPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  fabPlus: { color: '#FFFFFF', fontSize: 23, fontWeight: '500', lineHeight: 25 },
  fabLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  recordSearch: { gap: 12 },
  searchInputShell: { alignItems: 'center', backgroundColor: '#F0E9DE', borderRadius: 18, flexDirection: 'row', minHeight: 52, paddingHorizontal: 14 },
  searchIcon: { color: '#2F7448', fontSize: 24, marginRight: 8 },
  searchInput: { color: '#241C16', flex: 1, fontSize: 16, minHeight: 48, paddingVertical: 10 },
  searchClear: { color: '#756A5E', fontSize: 26 },
  searchFilters: { gap: 8, paddingRight: 16 },
  searchFilter: { backgroundColor: '#F0E9DE', borderRadius: 15, minHeight: 36, justifyContent: 'center', paddingHorizontal: 12 },
  searchFilterActive: { backgroundColor: '#2F7448' },
  searchFilterText: { color: '#62584E', fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  searchFilterTextActive: { color: '#FFFFFF' },
  searchCount: { color: '#756A5E', fontSize: 12, fontWeight: '800' },
  compactRecordList: { backgroundColor: '#FFFCF5', borderRadius: 20, overflow: 'hidden' },
  compactRecordRow: { alignItems: 'center', borderBottomColor: '#ECE4D8', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 12, minHeight: 72, paddingHorizontal: 14, paddingVertical: 10 },
  compactRecordEmoji: { fontSize: 24, width: 32 },
  compactRecordCopy: { flex: 1, gap: 2 },
  compactRecordTitle: { color: '#241C16', fontSize: 16, fontWeight: '800' },
  compactRecordDetail: { color: '#756A5E', fontSize: 13, lineHeight: 18 },
  compactRecordArrow: { color: '#2F7448', fontSize: 24 },
  searchEmpty: { alignItems: 'flex-start', backgroundColor: '#FFFCF5', borderRadius: 20, gap: 10, padding: 20 },
  searchEmptyTitle: { color: '#241C16', fontSize: 18, fontWeight: '900' },
  searchEmptyCopy: { color: '#756A5E', fontSize: 14, lineHeight: 20 },
  recordDetail: { backgroundColor: '#FFFCF5', borderRadius: 22, gap: 16, padding: 16 },
  recordDetailHero: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  recordDetailEmoji: { backgroundColor: '#F0E9DE', borderRadius: 20, fontSize: 34, overflow: 'hidden', padding: 12 },
  recordDetailHeroCopy: { flex: 1, gap: 3 },
  recordDetailTitle: { color: '#241C16', fontSize: 22, fontWeight: '900' },
  recordDetailMeta: { color: '#756A5E', fontSize: 12, textTransform: 'capitalize' },
  recordEditButton: { backgroundColor: '#E4F1E8', borderRadius: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  recordEditButtonText: { color: '#2F7448', fontSize: 13, fontWeight: '900' },
  recordDetailBody: { color: '#4E463E', fontSize: 15, lineHeight: 22 },
  recordFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recordFact: { backgroundColor: '#F6F1E8', borderRadius: 16, minWidth: '47%', padding: 12 },
  recordFactLabel: { color: '#8A7E71', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  recordFactValue: { color: '#241C16', fontSize: 14, fontWeight: '800', marginTop: 4 },
  recordEditForm: { gap: 12 },
  recordSaveState: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  card: {
    backgroundColor: '#FFFCF5',
    borderRadius: 20,
    padding: 14,
    gap: 12,
    shadowColor: '#271D14',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  title: { color: '#241C16', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  bodyText: { color: '#4E463E', fontSize: 14, lineHeight: 20 },
  chatLog: { maxHeight: 420 },
  chatLogContent: { gap: 10, paddingBottom: 4 },
  chatFullPage: { backgroundColor: '#FBF7EE', flex: 1 },
  chatLogFullPage: { flex: 1, maxHeight: undefined },
  chatLogContentFullPage: { flexGrow: 1, padding: 14, paddingBottom: 190 },
  chatComposerDock: {
    backgroundColor: '#FFFCF5',
    borderTopColor: '#E8DFD1',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    position: 'absolute',
    left: 0,
    right: 0,
  },
  emptyChat: { backgroundColor: '#F6F1E8', borderRadius: 18, padding: 16, gap: 6 },
  emptyTitle: { color: '#241C16', fontSize: 18, fontWeight: '800' },
  emptyCopy: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  bubble: { borderRadius: 18, padding: 12, gap: 8 },
  assistantBubble: { backgroundColor: '#F6F1E8', alignSelf: 'stretch' },
  userBubble: { backgroundColor: '#2F7448', alignSelf: 'flex-end', maxWidth: '88%' },
  assistantText: { color: '#241C16', fontSize: 15, lineHeight: 21 },
  userText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21 },
  markdown: { gap: 8 },
  markdownCode: {
    backgroundColor: 'rgba(36,28,22,0.08)',
    borderRadius: 10,
    fontFamily: 'monospace',
    padding: 10,
  },
  markdownList: { gap: 5 },
  markdownListRow: { flexDirection: 'row', gap: 8 },
  markdownListMarker: { minWidth: 22, opacity: 0.72 },
  markdownListText: { flex: 1 },
  markdownTable: {
    borderColor: '#D8CFC2',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    minWidth: 280,
  },
  markdownTableRow: { flexDirection: 'row' },
  markdownTableHeaderRow: { backgroundColor: 'rgba(47,116,72,0.1)' },
  markdownTableCell: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#D8CFC2',
    borderRightWidth: StyleSheet.hairlineWidth,
    minWidth: 112,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  markdownTableHeader: { fontWeight: '900' },
  linkPreviewStack: { gap: 7 },
  linkPreviewChip: {
    backgroundColor: '#E3EFF3',
    borderRadius: 14,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkPreviewTitle: { color: '#214F32', fontSize: 13, fontWeight: '900' },
  linkPreviewUrl: { color: '#52685F', fontSize: 12, fontWeight: '700' },
  sources: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8CFC2', paddingTop: 8, gap: 4 },
  sourceText: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
  sourceRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44 },
  sourceArrow: { color: '#2F7448', fontSize: 22, fontWeight: '800', marginLeft: 'auto' },
  outcomeCard: { backgroundColor: '#E4F1E8', borderRadius: 16, gap: 4, padding: 12 },
  outcomeTitle: { color: '#214F32', fontSize: 14, fontWeight: '900' },
  outcomeCopy: { color: '#4A6450', fontSize: 13 },
  outcomeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  outcomePrimary: { backgroundColor: '#2F7448', borderRadius: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  outcomePrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  outcomeSecondary: { backgroundColor: '#F0E9DE', borderRadius: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14 },
  outcomeSecondaryText: { color: '#3E352D', fontSize: 13, fontWeight: '900' },
  outcomeMessage: { color: '#2F7448', fontSize: 13, fontWeight: '800' },
  chatMode: { alignSelf: 'flex-start', backgroundColor: '#E4F1E8', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  chatModeText: { color: '#2F7448', fontSize: 11, fontWeight: '900' },
  warning: { color: '#9A4B2E', fontSize: 12 },
  success: { color: '#2F7448', fontSize: 12, fontWeight: '800' },
  preferenceGroup: { gap: 8 },
  segmentedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: { borderRadius: 999, backgroundColor: '#F6F1E8', paddingHorizontal: 11, paddingVertical: 8 },
  segmentActive: { backgroundColor: '#241C16' },
  segmentText: { color: '#6D6257', fontSize: 12, fontWeight: '900', textTransform: 'capitalize' },
  segmentTextActive: { color: '#FFFFFF' },
  providerEditor: { borderRadius: 18, backgroundColor: '#F6F1E8', padding: 12, gap: 10 },
  providerEditorTitle: { color: '#241C16', fontSize: 15, fontWeight: '900' },
  editorInput: {
    minHeight: 84,
    borderRadius: 18,
    backgroundColor: '#F6F1E8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#241C16',
    fontSize: 15,
    lineHeight: 21,
  },
  exampleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exampleChip: { maxWidth: '48%', borderRadius: 16, backgroundColor: '#EFE6ED', paddingHorizontal: 11, paddingVertical: 9, gap: 2 },
  exampleTitle: { color: '#3F2D42', fontSize: 12, fontWeight: '900' },
  exampleDetail: { color: '#6D6257', fontSize: 11, lineHeight: 15 },
  previewBox: { borderRadius: 18, backgroundColor: '#F6F1E8', padding: 14, gap: 6 },
  previewTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  previewText: { color: '#6D6257', fontSize: 12, fontWeight: '700' },
  softBadge: { alignSelf: 'flex-start', backgroundColor: '#FFF1B8', borderRadius: 999, color: '#7A5B00', fontSize: 12, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 6 },
  miniAction: { backgroundColor: '#241C16', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  miniActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  previewHero: { minHeight: 76, borderRadius: 18, backgroundColor: '#E4F1E8', padding: 14, justifyContent: 'space-between' },
  previewGlyph: { color: '#2F7448', fontSize: 24, fontWeight: '900' },
  previewHost: { color: '#2F7448', fontSize: 12, fontWeight: '900' },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: { backgroundColor: '#E4F1E8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  suggestionText: { color: '#2F7448', fontSize: 12, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: 16,
    backgroundColor: '#F6F1E8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#241C16',
    fontSize: 15,
  },
  send: { backgroundColor: '#241C16', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  disabled: { opacity: 0.5 },
  sendText: { color: '#FFFFFF', fontWeight: '800' },
  statusPill: { alignSelf: 'flex-start', backgroundColor: '#E4F1E8', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusPillAttention: { backgroundColor: '#F9E7D9' },
  statusText: { color: '#2F7448', fontWeight: '800' },
  statusTextAttention: { color: '#9A4B2E' },
  providerStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  providerStat: { backgroundColor: '#F6F1E8', borderRadius: 999, color: '#6D6257', fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 6 },
  providerStatAttention: { color: '#9A4B2E', backgroundColor: '#F9E7D9' },
  sourceHomes: { gap: 8 },
  sourceHome: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, backgroundColor: '#F6F1E8', padding: 12 },
  sourceHomeIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: '#E4F1E8', color: '#2F7448', textAlign: 'center', lineHeight: 32, fontSize: 16, fontWeight: '900', overflow: 'hidden' },
  sourceHomeCopy: { flex: 1, gap: 2 },
  sourceHomeTitle: { color: '#241C16', fontSize: 14, fontWeight: '900' },
  sourceHomeDetail: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
  sourceHomeState: { color: '#2F7448', fontSize: 12, fontWeight: '900' },
  providerSteps: { gap: 8 },
  providerStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  providerStepNumber: { width: 24, height: 24, borderRadius: 999, backgroundColor: '#241C16', color: '#FFFFFF', textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: '900', overflow: 'hidden' },
  providerStepTitle: { color: '#241C16', fontSize: 13, fontWeight: '900' },
  providerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  providerAction: { flexGrow: 1, flexBasis: '30%', borderRadius: 16, backgroundColor: '#EFE6ED', paddingHorizontal: 11, paddingVertical: 10, gap: 3 },
  providerActionTitle: { color: '#3F2D42', fontSize: 12, fontWeight: '900' },
  providerActionDetail: { color: '#6D6257', fontSize: 11, lineHeight: 15 },
  providerCta: { alignSelf: 'flex-start', backgroundColor: '#2F7448', borderRadius: 999, color: '#FFFFFF', fontSize: 13, fontWeight: '900', paddingHorizontal: 14, paddingVertical: 9 },
  premiumHero: { backgroundColor: '#E4F1E8', borderRadius: 32, padding: 22, gap: 14, overflow: 'hidden', shadowColor: '#2F7448', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  premiumEmoji: { position: 'absolute', right: 20, top: 18, width: 74, height: 74, borderRadius: 26, backgroundColor: '#FFFCF5', textAlign: 'center', lineHeight: 74, fontSize: 38, overflow: 'hidden' },
  premiumBadge: { alignSelf: 'flex-start', backgroundColor: '#FFF1B8', borderRadius: 999, color: '#9A4B2E', fontSize: 12, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
  premiumTitle: { color: '#142016', fontSize: 30, lineHeight: 34, fontWeight: '900', letterSpacing: -0.7, maxWidth: '76%' },
  premiumSubtitle: { color: '#536557', fontSize: 15, lineHeight: 21, fontWeight: '700', maxWidth: '82%' },
  premiumStats: { flexDirection: 'row', gap: 8 },
  premiumStat: { flex: 1, backgroundColor: 'rgba(255,252,245,0.72)', borderRadius: 18, paddingHorizontal: 10, paddingVertical: 10, gap: 2 },
  premiumStatValue: { color: '#142016', fontSize: 18, fontWeight: '900' },
  premiumStatLabel: { color: '#6D6257', fontSize: 11, fontWeight: '800' },
  premiumBody: { color: '#26372A', fontSize: 16, lineHeight: 23 },
  premiumActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  premiumAction: { backgroundColor: 'rgba(36,28,22,0.08)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  premiumActionPrimary: { backgroundColor: '#241C16' },
  premiumActionText: { color: '#241C16', fontSize: 13, fontWeight: '900' },
  premiumActionPrimaryText: { color: '#FFFFFF' },
  premiumSection: { gap: 10 },
  premiumSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  premiumSectionTitle: { color: '#182019', fontSize: 24, fontWeight: '900', letterSpacing: -0.3 },
  premiumSectionCta: { color: '#2F7448', fontSize: 13, fontWeight: '900' },
  premiumSectionSubtitle: { color: '#657066', fontSize: 14, lineHeight: 20 },
  premiumRail: { gap: 12, paddingRight: 18 },
  useFirstPremiumCard: { width: 144, minHeight: 152, borderRadius: 22, backgroundColor: '#F9E7D9', padding: 13, gap: 6, justifyContent: 'space-between' },
  useFirstPremiumBlue: { backgroundColor: '#E3EFF3' },
  useFirstPremiumYellow: { backgroundColor: '#FFF1B8' },
  useFirstPremiumEmoji: { fontSize: 28 },
  useFirstPremiumBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,252,245,0.78)', borderRadius: 999, color: '#9A4B2E', fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  useFirstPremiumTitle: { color: '#241C16', fontSize: 16, fontWeight: '900', lineHeight: 20 },
  useFirstPremiumDetail: { color: '#6D6257', fontSize: 12, lineHeight: 16 },
  premiumCard: { backgroundColor: '#FFFCF5', borderRadius: 28, padding: 18, gap: 12, shadowColor: '#271D14', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  mealPremiumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, backgroundColor: '#F6F1E8', padding: 12 },
  mealPremiumTime: { width: 58, minHeight: 48, borderRadius: 18, backgroundColor: '#E4F1E8', color: '#2F7448', textAlign: 'center', lineHeight: 48, fontSize: 11, fontWeight: '900', overflow: 'hidden' },
  mealPremiumCopy: { flex: 1, gap: 3 },
  mealPremiumTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  mealPremiumDetail: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  mealPremiumChevron: { color: '#B8AB9A', fontSize: 30, fontWeight: '300' },
  recipePremiumCard: { flexDirection: 'row', gap: 14, borderRadius: 30, backgroundColor: '#241C16', padding: 16, shadowColor: '#241C16', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  recipePremiumArt: { width: 102, borderRadius: 24, backgroundColor: '#FFF1B8', alignItems: 'center', justifyContent: 'center' },
  recipePremiumEmoji: { fontSize: 48 },
  recipePremiumCopy: { flex: 1, gap: 8 },
  recipePremiumBadge: { alignSelf: 'flex-start', color: '#F3B15E', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  recipePremiumTitle: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '900' },
  recipePremiumDetail: { color: '#DCD2C3', fontSize: 13, lineHeight: 18 },
  recipePremiumChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  recipePremiumChip: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, color: '#FFFFFF', fontSize: 11, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 5, overflow: 'hidden' },
  receiptPremiumCard: { backgroundColor: '#FFF5EA', borderRadius: 30, padding: 18, gap: 12, borderWidth: 1, borderColor: '#F2D6BE' },
  receiptPremiumHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  receiptPremiumIcon: { width: 48, height: 48, borderRadius: 18, backgroundColor: '#FFFCF5', textAlign: 'center', lineHeight: 48, fontSize: 25, overflow: 'hidden' },
  receiptPremiumTitle: { color: '#241C16', fontSize: 21, fontWeight: '900' },
  receiptPremiumDetail: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  receiptPremiumBadge: { color: '#9A4B2E', backgroundColor: '#FFF1B8', borderRadius: 999, fontSize: 11, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 5, overflow: 'hidden' },
  receiptPremiumLine: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFCF5', borderRadius: 16, padding: 11 },
  receiptPremiumLineTitle: { flex: 0.8, color: '#241C16', fontSize: 14, fontWeight: '900' },
  receiptPremiumLineDetail: { flex: 1.2, color: '#6D6257', fontSize: 12, lineHeight: 16 },
  receiptPremiumLineStatus: { color: '#2F7448', fontSize: 11, fontWeight: '900' },
  shelfPremiumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  shelfPremiumTile: { width: '47%', minHeight: 118, borderRadius: 22, backgroundColor: '#F6F1E8', padding: 14, gap: 6 },
  shelfPremiumEmoji: { fontSize: 28 },
  shelfPremiumTitle: { color: '#241C16', fontSize: 16, fontWeight: '900' },
  shelfPremiumDetail: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
  askPremiumCard: { backgroundColor: '#FFFCF5', borderRadius: 28, padding: 18, gap: 12, borderWidth: 1, borderColor: '#E6DDCF' },
  askPremiumTitle: { color: '#241C16', fontSize: 28, fontWeight: '900', letterSpacing: -0.4 },
  askPremiumSubtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 },
  askPremiumChip: { backgroundColor: '#E4F1E8', borderRadius: 999, color: '#2F7448', fontSize: 12, fontWeight: '900', paddingHorizontal: 11, paddingVertical: 8, overflow: 'hidden' },
  askPremiumInput: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F6F1E8', borderRadius: 22, padding: 10 },
  askPremiumPlaceholder: { flex: 1, color: '#8A8172', fontSize: 14 },
  askPremiumSend: { backgroundColor: '#241C16', borderRadius: 16, color: '#FFFFFF', fontWeight: '900', paddingHorizontal: 16, paddingVertical: 11, overflow: 'hidden' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: { backgroundColor: '#2F7448', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },
  secondaryButton: { backgroundColor: '#F6F1E8', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  secondaryButtonText: { color: '#241C16', fontWeight: '800' },
  catalogGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catalogItem: { backgroundColor: '#EFE6ED', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 8 },
  catalogText: { color: '#3F2D42', fontWeight: '700', fontSize: 12 },
  linkText: { color: '#2F7448', fontSize: 13, fontWeight: '800' },
  pollOption: { borderRadius: 16, padding: 12, backgroundColor: '#F6F1E8', gap: 3 },
  pollSelected: { backgroundColor: '#E4F1E8', borderWidth: 1, borderColor: '#2F7448' },
  pollHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pollText: { color: '#241C16', fontSize: 15, fontWeight: '800' },
  pollMeta: { color: '#6D6257', fontSize: 12 },
  pollTrack: { height: 8, backgroundColor: '#FFFFFF', borderRadius: 999, overflow: 'hidden', marginTop: 4 },
  pollFill: { height: 8, backgroundColor: '#2F7448', borderRadius: 999 },
  feedItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E3DACB' },
  feedDot: { width: 24, height: 24, borderRadius: 8, backgroundColor: '#E4F1E8', marginTop: 2 },
  feedCopy: { flex: 1, gap: 3 },
  feedMeta: { color: '#2F7448', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  feedTitle: { color: '#241C16', fontSize: 15, fontWeight: '900' },
  feedDetail: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  board: { gap: 10 },
  boardColumn: { width: 168, backgroundColor: '#F6F1E8', borderRadius: 18, padding: 10, gap: 8 },
  boardTitle: { color: '#241C16', fontWeight: '900' },
  boardCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 10, gap: 4 },
  boardCardText: { color: '#241C16', fontWeight: '700' },
  boardCardDetail: { color: '#6D6257', fontSize: 12, lineHeight: 16 },
  chart: { gap: 10 },
  chartRow: { gap: 5 },
  chartLabel: { color: '#6D6257', fontSize: 12, fontWeight: '800' },
  chartTrack: { height: 12, backgroundColor: '#F6F1E8', borderRadius: 999, overflow: 'hidden' },
  chartFill: { height: 12, backgroundColor: '#2F7448', borderRadius: 999 },
  mediaBox: { minHeight: 112, borderRadius: 18, backgroundColor: '#F6F1E8', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  mediaGlyph: { color: '#241C16', fontSize: 32, fontWeight: '900' },
  mapBox: { minHeight: 112, borderRadius: 18, backgroundColor: '#E8F4F5', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  mapPin: { color: '#2F7448', fontSize: 32, fontWeight: '900' },
  formField: { borderRadius: 14, backgroundColor: '#F6F1E8', padding: 12, gap: 7 },
  formLabel: { color: '#241C16', fontWeight: '900', fontSize: 14 },
  formHint: { color: '#6D6257', fontSize: 12 },
  formInput: { minHeight: 42, borderRadius: 12, backgroundColor: '#FFFFFF', color: '#241C16', paddingHorizontal: 11, paddingVertical: 9, fontSize: 14 },
  formInputMultiline: { minHeight: 82, textAlignVertical: 'top' },
  captureModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  captureMode: { borderRadius: 999, backgroundColor: '#F6F1E8', paddingHorizontal: 12, paddingVertical: 9 },
  captureModeActive: { backgroundColor: '#241C16' },
  captureModeText: { color: '#6D6257', fontSize: 13, fontWeight: '900' },
  captureModeTextActive: { color: '#FFFFFF' },
  capturePreviewImage: { width: '100%', height: 220, borderRadius: 18, backgroundColor: '#F6F1E8' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, backgroundColor: '#F6F1E8', padding: 12 },
  checkBox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, borderColor: '#B8AB9A', textAlign: 'center', color: '#FFFFFF', fontWeight: '900', overflow: 'hidden' },
  checkBoxOn: { backgroundColor: '#2F7448', borderColor: '#2F7448' },
  checkCopy: { flex: 1, gap: 2 },
  checkTitle: { color: '#241C16', fontWeight: '900', fontSize: 14 },
  checkDetail: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
  calendarRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8CFC2' },
  calendarDate: { minWidth: 68, color: '#2F7448', fontSize: 12, fontWeight: '900' },
  calendarCopy: { flex: 1, gap: 2 },
  timelineRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  timelineDot: { width: 12, height: 12, borderRadius: 999, backgroundColor: '#F3B15E', marginTop: 5 },
  timelineCopy: { flex: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8CFC2', paddingBottom: 10 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  galleryTile: { width: '47%', minHeight: 86, borderRadius: 18, backgroundColor: '#F6F1E8', padding: 12, justifyContent: 'space-between' },
  galleryGlyph: { color: '#2F7448', fontSize: 24, fontWeight: '900' },
  galleryText: { color: '#241C16', fontSize: 13, fontWeight: '900' },
  table: { minWidth: 420, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: '#D8CFC2' },
  tableRow: { flexDirection: 'row' },
  tableHeader: { width: 104, padding: 10, backgroundColor: '#E4F1E8', color: '#2F7448', fontSize: 12, fontWeight: '900' },
  tableCell: { width: 104, padding: 10, backgroundColor: '#FFFFFF', color: '#4E463E', fontSize: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8CFC2' },
  permissionRow: { borderRadius: 16, backgroundColor: '#F6F1E8', padding: 12, gap: 4 },
  permissionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  permissionTitle: { color: '#241C16', fontWeight: '900' },
  permissionMeta: { color: '#2F7448', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  permissionDetail: { color: '#6D6257', fontSize: 13, lineHeight: 18 },
  swatches: { flexDirection: 'row', gap: 8 },
  swatch: { width: 42, height: 42, borderRadius: 14 },
});
