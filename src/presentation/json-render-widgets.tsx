import type { ComponentRegistry, ComponentRenderProps } from '@json-render/react-native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Image, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

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
import { syncConfiguredSources } from '@/src/providers/direct-source-sync';
import {
  getUtopiaHealthStatus,
  openUtopiaHealthSettings,
  requestUtopiaHealthPermissions,
  type HealthConnectStatus,
} from '@/src/health/connect';
import { useAppRuntime } from '@/src/domain/runtime-context';
import {
  type WidgetCapabilityRequest,
  requestWidgetCapability,
  type WidgetCapabilityRuntime,
} from '@/src/presentation/widgets/package-capability-broker';
import {
  Calendar,
  Contacts,
  DocumentPicker,
  FileSystem,
  ImagePicker,
  LocalAuthentication,
  Location,
  Notifications,
  Speech,
  createAudioLoopRecorderDriver,
  createAudioPlayer,
  type AudioLoopRecorderDriver as NativeAudioLoopRecorderDriver,
  loadExpoCamera,
  loadExpoFileSystem,
  loadExpoImagePicker,
  loadExpoSensors,
  loadExpoVideo,
  setAudioModeAsync,
  type NativeAudioPlayer,
  type NativeCameraModule,
  type NativeNotificationTriggerInput,
  type NativeVideoModule,
  type NativeVideoPlayer,
} from '@/src/presentation/widget-native-bridges';
import {
  loadAudioLoopStateFromStorage,
} from '@/src/presentation/widgets/audio-loop-persistence';
import {
  actionRoute,
  actionUrl,
  detail,
  label,
  list,
  numberValue,
  openWidgetTarget,
  rows,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';
import { evaluateScientificExpression, formatCalcValue } from '@/src/presentation/widgets/scientific-calculator-engine';
import {
  FormCardWidget,
  KanbanBoardWidget,
  PollCardWidget,
} from '@/src/presentation/widgets/panel-widget-family';
import {
  FloatingActionWidget,
  SearchableRecordListWidget,
  ScreenHeaderWidget,
} from '@/src/presentation/widgets/navigation-widget-family';
import {
  audioLoopStatusLabel,
  clampInteger,
  formatAudioLoopTime,
  formatDelayOption,
  numericOptions,
  type AudioLoopStatus,
} from '@/src/presentation/widgets/audio-loop-engine';
import {
  addCurrentAssetToActivePlaylist,
  appendAudioLoopHistoryEntry,
  createAudioLoopAssetReference,
  createAudioLoopRecentPlaylist,
  createAudioLoopState,
  renameAudioLoopImportedAsset,
  renameAudioLoopRecordedAsset,
  serializeAudioLoopState,
  getAudioLoopPlaylistNavigation,
  importAudioLoopAsset,
  moveAudioLoopAssetInActivePlaylist,
  moveCurrentAssetInActivePlaylist,
  removeAudioLoopImportedAssetFromActivePlaylistAndHistory,
  removeAudioLoopRecordedAssetFromActivePlaylistAndHistory,
  setAudioLoopActivePlaylist,
  type AudioLoopAssetReference,
  type AudioLoopHistoryEntry,
  type AudioLoopStateV2,
} from '@/src/presentation/widgets/audio-loop-state';
import {
  createAudioLoopStorageMaterializer,
  type AudioLoopMaterializer,
} from '@/src/presentation/widgets/audio-loop-storage-bridge';
import { loadAudioLoopStateValue, saveAudioLoopStateValue } from '@/src/settings/audio-loop-state-storage';
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
import {
  DomainAskBarWidget as AskFoodBarWidget,
  DomainHeroWidget as FoodHeroWidget,
  DomainRecipeCardWidget as RecipeCardWidget,
  DomainReceiptReviewCardWidget as ReceiptReviewCardWidget,
  DomainShelfWidget as PantryShelfWidget,
  DomainTimelineWidget as MealTimelineWidget,
  UseFirstCarouselWidget,
} from '@/src/presentation/json-render-domain-widgets';
import {
  DurationTimerWidget,
  StepFlowWidget,
} from '@/src/presentation/widgets/timed-flow-widgets';
import {
  FileExportWidget,
  FilePickerWidget,
} from '@/src/presentation/widgets/file-widgets';
import { undoOperation } from '@/src/ops/undo';

export {
  actionRoute,
  actionUrl,
  detail,
  label,
  list,
  navigateWidgetRoute,
  numberValue,
  openWidgetTarget,
  rows,
  text,
} from '@/src/presentation/widgets/widget-sdk';
export type { WidgetProps } from '@/src/presentation/widgets/widget-sdk';

const DEFAULT_PROMPTS = [
  'Summarize what needs attention today.',
  'Draft a new task and assign it.',
  'Create a simpler records table.',
  'Make this app calmer and less dense.',
];

function requireWidgetCapability(
  runtime: WidgetCapabilityRuntime,
  request: WidgetCapabilityRequest,
  onDenied: (message: string) => void,
): boolean {
  const result = requestWidgetCapability(runtime, request);
  if (!result.ok) {
    onDenied(result.error.message);
    return false;
  }
  return true;
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
      if (!db || !activeManifest) throw new Error('Package data is still opening.');
      const receipts = await syncConfiguredSources({ db, manifest: activeManifest, settings });
      setMessage(receipts.map((receipt) => receipt.message).join('\n'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not pull data homes.');
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
            <Text style={styles.primaryButtonText}>{syncing ? 'Pulling…' : 'Pull data home now'}</Text>
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

type CaptureAsset = {
  uri: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
};

async function persistCaptureAsset(asset: {
  uri: string;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  fileName?: string | null;
}, fileSystem: any): Promise<CaptureAsset> {
  const base = fileSystem.documentDirectory;
  if (!base) {
    return {
      uri: asset.uri,
      mimeType: asset.mimeType ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
    };
  }
  const directory = `${base}wonder-captures/`;
  await fileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = (() => {
    const fromName = asset.fileName?.match(/\.([a-zA-Z0-9]+)$/)?.[1];
    if (fromName) return fromName.toLowerCase();
    if (asset.mimeType === 'image/png') return 'png';
    if (asset.mimeType === 'image/webp') return 'webp';
    return 'jpg';
  })();
  const destination = `${directory}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  await fileSystem.copyAsync({ from: asset.uri, to: destination });
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
      if (!requireWidgetCapability(
        runtime,
        { kind: 'media-picker', action: source, media: 'image' },
        setMessage,
      )) {
        return;
      }
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
      const fileSystem = await loadExpoFileSystem();
      const saved = await persistCaptureAsset(result.assets[0], fileSystem);
      setAsset(saved);
      setPreviewing(false);
      if (!title.trim()) {
        setTitle(inputKind === 'receipt' ? 'Receipt' : 'Photo');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not capture image.');
    } finally {
      setBusy(false);
    }
  }, [inputKind, runtime.activePackage, runtime.installationId, title]);

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
      setMessage('Package storage is not ready.');
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
            <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Save'}</Text>
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

function ScientificCalculatorWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const [expression, setExpression] = useState(text(props.initialExpression, ''));
  const [result, setResult] = useState(text(props.initialResult, '0'));
  const [angleMode, setAngleMode] = useState<'deg' | 'rad'>(text(props.angleMode, 'deg') === 'rad' ? 'rad' : 'deg');
  const [memory, setMemory] = useState(0);
  const [error, setError] = useState('');

  const commitExpression = useCallback((next: string) => {
    setExpression(next);
    setError('');
  }, []);

  const append = useCallback((value: string) => {
    commitExpression(`${expression}${value}`);
  }, [commitExpression, expression]);

  const evaluate = useCallback(() => {
    try {
      const value = evaluateScientificExpression(expression || result, { angleMode, memory });
      const formatted = formatCalcValue(value);
      setResult(formatted);
      setExpression(formatted);
      setError('');
    } catch (calcError) {
      setError(calcError instanceof Error ? calcError.message : 'Invalid expression');
    }
  }, [angleMode, expression, memory, result]);

  const rows: string[][] = [
    ['MC', 'MR', 'M+', 'M-'],
    ['sin(', 'cos(', 'tan(', 'sqrt('],
    ['ln(', 'log(', '^', '!'],
    ['7', '8', '9', '/'],
    ['4', '5', '6', '*'],
    ['1', '2', '3', '-'],
    ['0', '.', 'pi', '+'],
    ['(', ')', 'DEL', '='],
  ];

  function press(key: string) {
    if (key === '=') {
      evaluate();
      return;
    }
    if (key === 'DEL') {
      commitExpression(expression.slice(0, -1));
      return;
    }
    if (key === 'MC') {
      setMemory(0);
      return;
    }
    if (key === 'MR') {
      append('M');
      return;
    }
    if (key === 'M+') {
      try {
        setMemory((prev) => prev + evaluateScientificExpression(expression || result, { angleMode, memory }));
        setError('');
      } catch {
        setError('Memory needs a valid number');
      }
      return;
    }
    if (key === 'M-') {
      try {
        setMemory((prev) => prev - evaluateScientificExpression(expression || result, { angleMode, memory }));
        setError('');
      } catch {
        setError('Memory needs a valid number');
      }
      return;
    }
    append(key === 'pi' ? 'pi' : key);
  }

  return (
    <WidgetShell title={text(props.title, 'Scientific Calculator')} subtitle={text(props.subtitle, 'Tap an expression and evaluate locally.')}>
      <View style={styles.calculatorDisplay}>
        <TextInput
          value={expression}
          onChangeText={commitExpression}
          placeholder="0"
          placeholderTextColor="#8A8172"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          style={styles.calculatorInput}
        />
        <Text style={styles.calculatorResult}>{result}</Text>
        {error ? <Text style={styles.warning}>{error}</Text> : null}
      </View>
      <View style={styles.segmentedRow}>
        {(['deg', 'rad'] as const).map((mode) => (
          <Pressable key={mode} style={[styles.segment, angleMode === mode ? styles.segmentActive : null]} onPress={() => setAngleMode(mode)}>
            <Text style={[styles.segmentText, angleMode === mode ? styles.segmentTextActive : null]}>{mode}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.segment} onPress={() => { setExpression(''); setResult('0'); setError(''); }}>
          <Text style={styles.segmentText}>AC</Text>
        </Pressable>
      </View>
      <View style={styles.calculatorPad}>
        {rows.map((row) => (
          <View key={row.join('|')} style={styles.calculatorRow}>
            {row.map((key) => (
              <Pressable
                key={key}
                style={[styles.calculatorKey, key === '=' ? styles.calculatorKeyEquals : null, /[+*/^!-]/.test(key) ? styles.calculatorKeyOperator : null]}
                onPress={() => press(key)}
              >
                <Text style={[styles.calculatorKeyText, key === '=' ? styles.calculatorKeyEqualsText : null]}>{key}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      <Text style={styles.formHint}>Memory: {formatCalcValue(memory)} · Constants: pi, e, M</Text>
    </WidgetShell>
  );
}

function AudioLoopPlayerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const playerRef = useRef<NativeAudioPlayer | null>(null);
  const delayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetPlaysRef = useRef(1);
  const delaySecondsRef = useRef(0);
  const remainingDelayRef = useRef(0);
  const finishedRef = useRef(false);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState<AudioLoopStatus>('empty');
  const [error, setError] = useState('');
  const [targetPlays, setTargetPlays] = useState(() => clampInteger(props.defaultPlays, 1, 1, Number.MAX_SAFE_INTEGER));
  const [isInfiniteMode, setIsInfiniteMode] = useState(() => text((props as Record<string, unknown>).loopMode) === 'infinite');
  const [completedPlays, setCompletedPlays] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [delaySeconds, setDelaySeconds] = useState(() => clampInteger(props.defaultDelaySeconds, 0, 0, 3600));
  const [startDelaySeconds, setStartDelaySeconds] = useState(() => clampInteger(props.defaultStartDelaySeconds, 0, 0, 3600));
  const [remainingDelay, setRemainingDelay] = useState(0);
  const [volume, setVolume] = useState(1);
  const [audioLoopState, setAudioLoopState] = useState<AudioLoopStateV2>(() => createAudioLoopState());
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingBusy, setIsRecordingBusy] = useState(false);
  const [recorderMessage, setRecorderMessage] = useState('');
  const [activeAssetRenameInput, setActiveAssetRenameInput] = useState('');
  const isInitializingFromStorage = useRef(true);
  const audioLoopRecorderRef = useRef<NativeAudioLoopRecorderDriver | null>(null);
  const audioLoopMaterializerRef = useRef<AudioLoopMaterializer | null>(null);
  const presets = rows(props.presets);
  const delayOptions = numericOptions(props.delayOptions, [0, 5, 15, 30, 60, 120, 300]);
  const startDelayOptions = numericOptions(props.startDelayOptions, [0, 10, 30, 60, 180]);
  const sessionActive = status === 'playing' || status === 'paused' || status === 'between' || status === 'starting';
  const recorderCapability = useMemo(() => requestWidgetCapability(
    runtime,
    { kind: 'audio-recorder', action: 'record' },
  ), [runtime]);
  const recorderDisabledMessage = recorderCapability.ok ? null : recorderCapability.error.message;
  const canRecordAudio = recorderCapability.ok && !recorderMessage;
  const audioFileCapability = useMemo(() => requestWidgetCapability(
    runtime,
    { kind: 'audio-file', action: 'choose' },
  ), [runtime]);
  const activeAsset = audioLoopState.assets.find((item) => item.id === audioLoopState.activeAssetId) ?? null;
  const activePlaylist = audioLoopState.playlists.find((item) => item.id === audioLoopState.activePlaylistId) ?? null;
  const playlistNavigation = useMemo(() => getAudioLoopPlaylistNavigation(audioLoopState), [audioLoopState]);
  const recentAssets = useMemo(() => (
    [...audioLoopState.assets].sort((a, b) => Date.parse(b.lastOpenedAt ?? b.createdAt) - Date.parse(a.lastOpenedAt ?? a.createdAt))
  ), [audioLoopState.assets]);
  const recentHistory = useMemo(() => (
    [...audioLoopState.history].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  ), [audioLoopState.history]);
  const canMovePreviousInQueue = playlistNavigation.hasPrevious || (playlistNavigation.activeIndex < 0 && playlistNavigation.assetIds.length > 0);
  const canMoveNextInQueue = playlistNavigation.hasNext || (playlistNavigation.activeIndex < 0 && playlistNavigation.assetIds.length > 0);
  const canRenameCurrentAsset = Boolean(activeAsset && text(activeAssetRenameInput).trim().length > 0 && text(activeAssetRenameInput).trim() !== activeAsset.displayName);

  useEffect(() => {
    targetPlaysRef.current = targetPlays;
  }, [targetPlays]);

  useEffect(() => {
    delaySecondsRef.current = delaySeconds;
  }, [delaySeconds]);

  useEffect(() => () => {
    clearAudioLoopDelay(delayTimerRef);
    playerRef.current?.pause();
    playerRef.current?.remove();
    playerRef.current = null;
  }, []);

  const playAudio = useCallback(async (restartTrack = true) => {
    const player = playerRef.current;
    if (!player) {
      setError('Choose an audio file first.');
      setStatus('error');
      return;
    }
    clearAudioLoopDelay(delayTimerRef);
    try {
      setStatus('playing');
      setError('');
      player.volume = volume;
      if (restartTrack) {
        finishedRef.current = false;
        await player.seekTo(0);
      }
      player.play();
    } catch {
      setStatus('ready');
      setError('Playback was blocked. Tap Start again.');
    }
  }, [runtime, volume]);

  const scheduleDelay = useCallback((seconds: number) => {
    clearAudioLoopDelay(delayTimerRef);
    const normalized = Math.max(0, Math.floor(seconds));
    if (!normalized) {
      void playAudio(true);
      return;
    }
    const startedAt = Date.now();
    setStatus('between');
    setRemainingDelay(normalized);
    remainingDelayRef.current = normalized;
    delayTimerRef.current = setInterval(() => {
      const left = Math.max(0, normalized - Math.floor((Date.now() - startedAt) / 1000));
      remainingDelayRef.current = left;
      setRemainingDelay(left);
      if (left <= 0) {
        clearAudioLoopDelay(delayTimerRef);
        void playAudio(true);
      }
    }, 250);
  }, [playAudio]);

  const finishPlay = useCallback(() => {
    setCurrentTime(duration);
    setCompletedPlays((previous) => {
      if (isInfiniteMode) {
        const nextInfinite = previous + 1;
        scheduleDelay(delaySecondsRef.current);
        return nextInfinite;
      }
      const next = Math.min(targetPlaysRef.current, previous + 1);
      if (next >= targetPlaysRef.current) {
        clearAudioLoopDelay(delayTimerRef);
        setStatus('completed');
        return next;
      }
      scheduleDelay(delaySecondsRef.current);
      return next;
    });
  }, [duration, isInfiniteMode, scheduleDelay]);

  useEffect(() => {
    if (status !== 'playing') return undefined;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const playerStatus = player.currentStatus;
      setCurrentTime(Number(playerStatus.currentTime) || 0);
      setDuration(Number(playerStatus.duration) || duration);
      if (playerStatus.didJustFinish || (playerStatus.duration > 0 && playerStatus.currentTime >= playerStatus.duration - 0.08 && !playerStatus.playing)) {
        if (!finishedRef.current) {
          finishedRef.current = true;
          finishPlay();
        }
      } else if (playerStatus.playing) {
        finishedRef.current = false;
      }
    }, 350);
    return () => clearInterval(interval);
  }, [duration, finishPlay, status]);

  const nowISOString = () => new Date().toISOString();

  const initializePlayer = useCallback(async (input: {
    uri: string;
    name: string;
    volume?: number;
  }) => {
    const playbackCapability = requestWidgetCapability(runtime, { kind: 'audio-file', action: 'choose' });
    if (!playbackCapability.ok) throw new Error(playbackCapability.error.message);
    clearAudioLoopDelay(delayTimerRef);
    playerRef.current?.pause();
    playerRef.current?.remove();
    await setAudioModeAsync({
      playsInSilentMode: true,
    });
    const player = await createAudioPlayer({ uri: input.uri, name: input.name }, {
      updateInterval: 250,
      downloadFirst: Platform.OS !== 'web',
    });
    player.volume = input.volume ?? volume;
    player.loop = false;
    playerRef.current = player;
    finishedRef.current = false;
    setDuration(Number(player.currentStatus.duration) || 0);
    setCurrentTime(0);
    setCompletedPlays(0);
    setFileName(input.name);
    setStatus('ready');
    return player;
  }, [volume]);

  const upsertImportedAsset = useCallback((asset: {
    uri: string;
    name: string;
    mimeType: string | null;
  }) => {
    setAudioLoopState((current) => {
      const now = new Date().toISOString();
      const normalized = createAudioLoopState(current);
      const existing = normalized.assets.find((item) => item.durableUri === asset.uri || item.sourceUri === asset.uri);
      const nextAsset = createAudioLoopAssetReference({
        id: existing?.id,
        durableUri: asset.uri,
        source: 'imported',
        displayName: asset.name,
        sourceUri: asset.uri,
        mimeType: asset.mimeType,
        originalName: asset.name,
        bytes: null,
        checksum: null,
        createdAt: existing?.createdAt ?? now,
        recordedAt: null,
        lastOpenedAt: now,
        lastPositionSeconds: 0,
        existingNames: existing ? undefined : normalized.assets.map((item) => item.displayName),
      });
      return createAudioLoopState({
        ...normalized,
        assets: [nextAsset, ...normalized.assets.filter((item) => item.id !== nextAsset.id && item.durableUri !== asset.uri && item.sourceUri !== asset.uri)],
        activeAssetId: nextAsset.id,
        updatedAt: now,
      });
    });
  }, []);

  const loadFile = useCallback(async (asset: { uri: string; mimeType?: string | null; name?: string | null }) => {
    const fileType = String(asset.mimeType ?? '');
    const name = String(asset.name ?? 'Audio file');
    if (fileType && !fileType.startsWith('audio/')) {
      setError('Choose an audio file.');
      setStatus('error');
      return;
    }
    try {
      await initializePlayer({
        uri: asset.uri,
        name,
        volume,
      });
      upsertImportedAsset({
        uri: asset.uri,
        name: text(name, 'Audio file'),
        mimeType: asset.mimeType ? String(asset.mimeType) : null,
      });
      setAudioLoopState((current) => appendAudioLoopHistoryEntry(current, {
        assetId: current.activeAssetId,
        playlistId: current.activePlaylistId,
        status: 'paused',
        startedAt: nowISOString(),
        finishedAt: null,
        completedLoops: 0,
        loopCount: isInfiniteMode ? { kind: 'infinite' } : { kind: 'count', value: targetPlays },
        settings: {
          schemaVersion: 'wonder.audio-loop-playback-settings.v1',
          loopCount: isInfiniteMode ? { kind: 'infinite' } : { kind: 'count', value: targetPlays },
          startDelaySeconds,
          betweenPlayDelaySeconds: delaySeconds,
          resumePositionSeconds: 0,
          volume,
        },
        note: `Loaded ${text(name, 'audio')}`,
      }));
      setError('');
    } catch {
      playerRef.current = null;
      setStatus('error');
      setError('This file could not be played.');
    }
  }, [delaySeconds, initializePlayer, isInfiniteMode, startDelaySeconds, targetPlays, upsertImportedAsset, volume]);

  useEffect(() => {
    if (isInitializingFromStorage.current) return;
    void saveAudioLoopStateValue(serializeAudioLoopState(audioLoopState));
  }, [audioLoopState]);

  useEffect(() => {
    if (!isInitializingFromStorage.current) return;
    if (!audioFileCapability.ok) {
      isInitializingFromStorage.current = false;
      setError(audioFileCapability.error.message);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const fileSystem = await loadExpoFileSystem();
        const materializer = createAudioLoopStorageMaterializer({ fileSystem });
        const persisted = await loadAudioLoopStateFromStorage({
          loadAudioLoopStateValue,
          hasDurableUri: materializer.hasDurableUri,
        });
        if (cancelled || !persisted) return;

        setAudioLoopState(persisted.state);
        setDelaySeconds(persisted.state.lastPlaybackSettings.betweenPlayDelaySeconds);
        setStartDelaySeconds(persisted.state.lastPlaybackSettings.startDelaySeconds);
        setVolume(persisted.state.lastPlaybackSettings.volume);
        setCurrentTime(persisted.state.lastPositionSeconds);
        setCompletedPlays(0);

        if (persisted.state.lastPlaybackSettings.loopCount.kind === 'count') {
          setIsInfiniteMode(false);
          setTargetPlays(persisted.state.lastPlaybackSettings.loopCount.value);
        } else {
          setIsInfiniteMode(true);
          setTargetPlays(1);
        }

        if (!persisted.ready || persisted.needsReselect || !persisted.state.activeAssetId) {
          setError('');
          setStatus('empty');
          setFileName('');
          return;
        }

        const restoredAsset = persisted.state.assets.find((item) => item.id === persisted.state.activeAssetId) ?? null;
        const activeUri = restoredAsset?.durableUri ?? restoredAsset?.sourceUri;
        if (!restoredAsset || !activeUri) {
          setError('');
          setStatus('empty');
          setFileName('');
          return;
        }

        try {
          const player = await initializePlayer({
            uri: activeUri,
            name: restoredAsset.displayName,
            volume: persisted.state.lastPlaybackSettings.volume,
          });
          if (persisted.state.lastPositionSeconds > 0) {
            await player.seekTo(persisted.state.lastPositionSeconds);
            setCurrentTime(persisted.state.lastPositionSeconds);
          }
          setError('');
        } catch {
          setStatus('error');
          setFileName(restoredAsset.displayName);
          setError('Saved audio could not be loaded. Please choose a file.');
        }
      } catch {
        setStatus('error');
        setError('Could not load persisted audio state.');
      } finally {
        isInitializingFromStorage.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audioFileCapability, initializePlayer]);

  useEffect(() => {
    setActiveAssetRenameInput(activeAsset?.displayName ?? '');
  }, [activeAsset]);

  const chooseFile = useCallback(async () => {
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'audio-file', action: 'choose' },
        setError,
      )) {
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: Platform.OS !== 'web',
        multiple: false,
        base64: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      await loadFile(result.assets[0]);
    } catch {
      setStatus('error');
      setError('File picker failed.');
    }
  }, [loadFile, runtime.activePackage, runtime.installationId]);

  const selectAsset = useCallback(async (asset: AudioLoopAssetReference) => {
    const uri = asset.durableUri || asset.sourceUri;
    if (!uri) {
      setError('Audio file is not available.');
      return;
    }
    await loadFile({
      uri,
      mimeType: asset.mimeType,
      name: asset.displayName,
    });
  }, [loadFile]);

  const ensureRecentPlaylist = useCallback(() => {
    setAudioLoopState((current) => {
      const existing = current.playlists.find((playlist) => playlist.id === 'recent-queue');
      if (existing) return setAudioLoopActivePlaylist(current, existing.id);
      return createAudioLoopRecentPlaylist(current, {
        id: 'recent-queue',
        name: 'Recent queue',
        createdAt: nowISOString(),
        maxAssets: 12,
      });
    });
  }, []);

  const changeActivePlaylist = useCallback((playlistId: string) => {
    setAudioLoopState((current) => setAudioLoopActivePlaylist(current, playlistId));
  }, []);

  const addCurrent = useCallback(() => {
    if (!activeAsset || !activePlaylist) {
      setError('Select a playlist and current asset first.');
      return;
    }
    setAudioLoopState((current) => addCurrentAssetToActivePlaylist(current));
  }, [activeAsset, activePlaylist]);

  const removeCurrent = useCallback(() => {
    if (!activeAsset || !activePlaylist) {
      setError('Select a playlist and current asset first.');
      return;
    }
    const nextState = activeAsset.source === 'imported'
      ? removeAudioLoopImportedAssetFromActivePlaylistAndHistory(audioLoopState, activeAsset.id)
      : removeAudioLoopRecordedAssetFromActivePlaylistAndHistory(audioLoopState, activeAsset.id);
    const nextActive = nextState.assets.find((item) => item.id === nextState.activeAssetId) ?? null;
    setAudioLoopState(nextState);
    if (!nextActive) {
      clearAudioLoopDelay(delayTimerRef);
      playerRef.current?.pause();
      void playerRef.current?.seekTo(0);
      setCurrentTime(0);
      setCompletedPlays(0);
      setRemainingDelay(0);
      setStatus('empty');
      setFileName('');
      setError('');
      return;
    }
    if (nextActive.id !== activeAsset.id) {
      void selectAsset(nextActive);
    }
    setError('');
  }, [activeAsset, activePlaylist, audioLoopState, selectAsset]);

  const renameCurrentAsset = useCallback(() => {
    if (!activeAsset || !activePlaylist) {
      setError('Select a playlist and current asset first.');
      return;
    }
    const nextName = text(activeAssetRenameInput).trim();
    if (!nextName) {
      setError('Asset name cannot be empty.');
      return;
    }
    if (nextName === activeAsset.displayName) return;
    const nextState = activeAsset.source === 'imported'
      ? renameAudioLoopImportedAsset(audioLoopState, activeAsset.id, nextName)
      : renameAudioLoopRecordedAsset(audioLoopState, activeAsset.id, nextName);
    setAudioLoopState(nextState);
    setFileName(nextName);
    setError('');
  }, [activeAsset, activePlaylist, activeAssetRenameInput, audioLoopState]);

  const moveCurrentUp = useCallback(() => {
    if (!activeAsset || !activePlaylist) {
      setError('Select a playlist and current asset first.');
      return;
    }
    setAudioLoopState((current) => moveCurrentAssetInActivePlaylist(current, 'up'));
  }, [activeAsset, activePlaylist]);

  const moveCurrentDown = useCallback(() => {
    if (!activeAsset || !activePlaylist) {
      setError('Select a playlist and current asset first.');
      return;
    }
    setAudioLoopState((current) => moveCurrentAssetInActivePlaylist(current, 'down'));
  }, [activeAsset, activePlaylist]);

  const moveInQueue = useCallback(async (direction: 'previous' | 'next') => {
    if (!activePlaylist || !playlistNavigation.assetIds.length) {
      setError('Select a playlist with assets first.');
      return;
    }
    const nextState = moveAudioLoopAssetInActivePlaylist(audioLoopState, direction);
    if (nextState.activeAssetId === audioLoopState.activeAssetId) {
      setError(direction === 'previous' ? 'No previous asset in queue.' : 'No next asset in queue.');
      return;
    }
    const nextAsset = nextState.assets.find((asset) => asset.id === nextState.activeAssetId) ?? null;
    if (!nextAsset) {
      setError('Queued asset is missing.');
      return;
    }
    setAudioLoopState(nextState);
    await selectAsset(nextAsset);
    setError('');
  }, [activePlaylist, audioLoopState, playlistNavigation.assetIds.length, selectAsset]);

  const startRecording = useCallback(() => {
    if (!canRecordAudio || isRecording || isRecordingBusy) return;
    setIsRecordingBusy(true);
    setRecorderMessage('');
    void (async () => {
      try {
        if (!requireWidgetCapability(
          runtime,
          { kind: 'audio-recorder', action: 'record' },
          setRecorderMessage,
        )) {
          return;
        }
        const fileSystem = await loadExpoFileSystem();
        const base = fileSystem.documentDirectory ?? fileSystem.cacheDirectory;
        if (!base) throw new Error('Missing recording directory.');
        const normalizedBase = base.endsWith('/') ? base : `${base}/`;
        const outputDirectory = `${normalizedBase}audio-loop-108/assets/`;
        await fileSystem.makeDirectoryAsync(outputDirectory, { intermediates: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFile = `${outputDirectory}recording-${timestamp}-${Math.random().toString(16).slice(2, 10)}.m4a`;
        const driver = audioLoopRecorderRef.current ?? await createAudioLoopRecorderDriver();
        audioLoopRecorderRef.current = driver;
        audioLoopMaterializerRef.current = createAudioLoopStorageMaterializer({ fileSystem });
        const started = await driver.startRecording({ outputFile, isMuted: false });
        if (!text(started.sourceUri)) {
          throw new Error('Recorder did not return a source file path.');
        }
        setIsRecording(true);
        setError('');
      } catch (error) {
        setIsRecording(false);
        setRecorderMessage(error instanceof Error ? error.message : 'Recording failed to start.');
        audioLoopRecorderRef.current = null;
        audioLoopMaterializerRef.current = null;
      } finally {
        setIsRecordingBusy(false);
      }
    })();
  }, [canRecordAudio, isRecording, isRecordingBusy, runtime.activePackage, runtime.installationId]);

  const stopRecording = useCallback(() => {
    if (!isRecording || isRecordingBusy) return;
    setIsRecordingBusy(true);
    setRecorderMessage('');
    void (async () => {
      try {
        const driver = audioLoopRecorderRef.current;
        const materializer = audioLoopMaterializerRef.current;
        if (!driver || !materializer) {
          setRecorderMessage('No active recording session was found.');
          return;
        }
        const stopped = await driver.stopRecording();
        setIsRecording(false);
        const sourceUri = text(stopped.sourceUri);
        if (!sourceUri) {
          setRecorderMessage('Recorder did not return a file path. Recording was not saved.');
          return;
        }
        const nextState = await importAudioLoopAsset(audioLoopState, {
          sourceUri,
          source: 'recorded',
          recordedAt: nowISOString(),
        }, materializer);
        setAudioLoopState(nextState);
        const nextAsset = nextState.assets.find((asset) => asset.id === nextState.activeAssetId) ?? null;
        const playableUri = nextAsset?.durableUri ?? nextAsset?.sourceUri;
        if (nextAsset && playableUri) {
          await loadFile({
            uri: playableUri,
            mimeType: nextAsset.mimeType,
            name: nextAsset.displayName,
          });
        }
        setRecorderMessage('Recording saved.');
      } catch (error) {
        setIsRecording(false);
        setRecorderMessage(error instanceof Error ? error.message : 'Recording save failed.');
      } finally {
        setIsRecordingBusy(false);
      }
    })();
  }, [audioLoopState, isRecording, isRecordingBusy, loadFile]);

  const startSession = useCallback(() => {
    if (!playerRef.current) {
      setError('Choose an audio file first.');
      return;
    }
    clearAudioLoopDelay(delayTimerRef);
    setCompletedPlays(0);
    setCurrentTime(0);
    setStatus('starting');
    if (startDelaySeconds > 0) {
      scheduleDelay(startDelaySeconds);
    } else {
      void playAudio(true);
    }
  }, [playAudio, scheduleDelay, startDelaySeconds]);

  const pauseSession = useCallback(() => {
    if (status === 'between') {
      clearAudioLoopDelay(delayTimerRef);
      setStatus('paused');
      return;
    }
    playerRef.current?.pause();
    setStatus('paused');
  }, [status]);

  const resumeSession = useCallback(() => {
    if (status !== 'paused') return;
    if (remainingDelayRef.current > 0) {
      scheduleDelay(remainingDelayRef.current);
    } else {
      void playAudio(false);
    }
  }, [playAudio, scheduleDelay, status]);

  const stopSession = useCallback(() => {
    clearAudioLoopDelay(delayTimerRef);
    const player = playerRef.current;
    player?.pause();
    void player?.seekTo(0);
    finishedRef.current = false;
    remainingDelayRef.current = 0;
    setRemainingDelay(0);
    setCurrentTime(0);
    setStatus(player ? 'stopped' : 'empty');
  }, []);

  const skipCurrent = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    void player.seekTo(duration || 0);
    if (props.countSkippedAsCompleted === false) {
      scheduleDelay(delaySecondsRef.current);
    } else {
      finishPlay();
    }
  }, [duration, finishPlay, props.countSkippedAsCompleted, scheduleDelay]);

  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const statusLabel = audioLoopStatusLabel(status, remainingDelay);
  const maxLoopCountText = isInfiniteMode ? '∞' : String(targetPlays);

  return (
    <WidgetShell title={text(props.title, 'Audio Loop')} subtitle={text(props.subtitle)}>
      <>
          <View style={styles.audioLoopDeck}>
            <View style={styles.audioLoopHeader}>
              <View style={styles.audioLoopFileCopy}>
                <Text numberOfLines={1} style={styles.audioLoopFileName}>{fileName || 'No audio selected'}</Text>
                <Text style={styles.audioLoopText}>{statusLabel} · {completedPlays}/{maxLoopCountText} plays</Text>
              </View>
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={chooseFile}>
                <Text style={styles.secondaryButtonText}>{fileName ? 'Change' : 'Choose'}</Text>
              </Pressable>
            </View>
            <View style={styles.audioLoopProgressTrack}>
              <View style={[styles.audioLoopProgressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <View style={styles.audioLoopTimeRow}>
              <Text style={styles.audioLoopMeta}>{formatAudioLoopTime(currentTime)}</Text>
              <Text style={styles.audioLoopMeta}>{formatAudioLoopTime(duration)}</Text>
            </View>
            {error ? <Text style={styles.warning}>{error}</Text> : null}
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Current asset</Text>
            <TextInput
              accessibilityLabel="Current asset name"
              style={styles.formInput}
              value={activeAssetRenameInput}
              onChangeText={setActiveAssetRenameInput}
              onSubmitEditing={() => void renameCurrentAsset()}
              placeholder="Rename current asset"
              editable={Boolean(activeAsset)}
            />
            <View style={styles.audioLoopControls}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rename current asset"
                style={[styles.secondaryButton, !canRenameCurrentAsset ? styles.disabled : null]}
                onPress={renameCurrentAsset}
                disabled={!canRenameCurrentAsset}
              >
                <Text style={styles.secondaryButtonText}>Rename</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.audioLoopControls}>
            <Pressable
              accessibilityRole="button"
              style={[styles.secondaryButton, canRecordAudio ? null : styles.disabled]}
              onPress={startRecording}
              disabled={!canRecordAudio || isRecording || isRecordingBusy}
            >
              <Text style={styles.secondaryButtonText}>{isRecording ? 'Recording' : 'Record'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.secondaryButton, !isRecording || isRecordingBusy ? styles.disabled : null]}
              onPress={stopRecording}
              disabled={!isRecording || isRecordingBusy}
            >
              <Text style={styles.secondaryButtonText}>Stop recording</Text>
            </Pressable>
            {(recorderDisabledMessage || recorderMessage) ? <Text style={styles.formHint}>{recorderDisabledMessage || recorderMessage}</Text> : null}
            <Pressable accessibilityRole="button" style={[styles.primaryButton, sessionActive && status !== 'paused' ? styles.disabled : null]} onPress={startSession} disabled={sessionActive && status !== 'paused'}>
              <Text style={styles.primaryButtonText}>{status === 'completed' || status === 'stopped' ? 'Restart' : 'Start'}</Text>
            </Pressable>
            {status === 'paused' ? (
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={resumeSession}>
                <Text style={styles.secondaryButtonText}>Resume</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" style={[styles.secondaryButton, !sessionActive ? styles.disabled : null]} onPress={pauseSession} disabled={!sessionActive}>
                <Text style={styles.secondaryButtonText}>Pause</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" style={[styles.secondaryButton, !sessionActive && status !== 'completed' ? styles.disabled : null]} onPress={stopSession} disabled={!sessionActive && status !== 'completed'}>
              <Text style={styles.secondaryButtonText}>Stop</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.secondaryButton, status !== 'playing' ? styles.disabled : null]} onPress={skipCurrent} disabled={status !== 'playing'}>
              <Text style={styles.secondaryButtonText}>Skip</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous in queue"
              style={[styles.secondaryButton, !canMovePreviousInQueue ? styles.disabled : null]}
              onPress={() => void moveInQueue('previous')}
              disabled={!canMovePreviousInQueue}
            >
              <Text style={styles.secondaryButtonText}>Previous</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next in queue"
              style={[styles.secondaryButton, !canMoveNextInQueue ? styles.disabled : null]}
              onPress={() => void moveInQueue('next')}
              disabled={!canMoveNextInQueue}
            >
              <Text style={styles.secondaryButtonText}>Next</Text>
            </Pressable>
          </View>

          <View style={styles.audioLoopSettings}>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Loop mode</Text>
              <View style={styles.captureModes}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Finite loop"
                  style={[styles.captureMode, !isInfiniteMode ? styles.captureModeActive : null]}
                  onPress={() => setIsInfiniteMode(false)}
                >
                  <Text style={[styles.captureModeText, !isInfiniteMode ? styles.captureModeTextActive : null]}>Finite</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Infinite loop"
                  style={[styles.captureMode, isInfiniteMode ? styles.captureModeActive : null]}
                  onPress={() => setIsInfiniteMode(true)}
                >
                  <Text style={[styles.captureModeText, isInfiniteMode ? styles.captureModeTextActive : null]}>Infinite</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Play count</Text>
              <View style={styles.audioLoopStepper}>
                <Pressable
                  style={[styles.segment, isInfiniteMode ? styles.disabled : null]}
                  onPress={() => setTargetPlays((value) => Math.max(1, value - 1))}
                  disabled={isInfiniteMode}
                >
                  <Text style={styles.segmentText}>-</Text>
                </Pressable>
                <TextInput
                  accessibilityLabel="Play count"
                  keyboardType="number-pad"
                  editable={!isInfiniteMode}
                  value={String(targetPlays)}
                  onChangeText={(value) => setTargetPlays((current) => {
                    const trimmed = value.trim();
                    if (!trimmed) return current;
                    const parsed = Number.parseInt(trimmed, 10);
                    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : current;
                  })}
                  style={styles.audioLoopNumberInput}
                />
                <Pressable
                  style={[styles.segment, isInfiniteMode ? styles.disabled : null]}
                  onPress={() => setTargetPlays((value) => value + 1)}
                  disabled={isInfiniteMode}
                >
                  <Text style={styles.segmentText}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Volume</Text>
              <View style={styles.audioLoopStepper}>
                <Pressable style={styles.segment} onPress={() => setVolume((value) => Math.max(0, Number((value - 0.1).toFixed(1))))}>
                  <Text style={styles.segmentText}>-</Text>
                </Pressable>
                <Text style={styles.audioLoopVolumeText}>{Math.round(volume * 100)}%</Text>
                <Pressable style={styles.segment} onPress={() => setVolume((value) => Math.min(1, Number((value + 0.1).toFixed(1))))}>
                  <Text style={styles.segmentText}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Playlist</Text>
            <View style={styles.captureModes}>
              {audioLoopState.playlists.length ? audioLoopState.playlists.map((playlist) => (
                <Pressable
                  key={playlist.id}
                  accessibilityRole="button"
                  style={[styles.captureMode, playlist.id === audioLoopState.activePlaylistId ? styles.captureModeActive : null]}
                  onPress={() => changeActivePlaylist(playlist.id)}
                >
                  <Text style={[styles.captureModeText, playlist.id === audioLoopState.activePlaylistId ? styles.captureModeTextActive : null]}>
                    {playlist.name}
                  </Text>
                </Pressable>
              )) : (
                <Text style={styles.formHint}>No playlists yet</Text>
              )}
            </View>
            <View style={styles.audioLoopControls}>
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={ensureRecentPlaylist}>
                <Text style={styles.secondaryButtonText}>Create Recent queue</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={[styles.secondaryButton, (!activeAsset || !activePlaylist) ? styles.disabled : null]} onPress={addCurrent} disabled={!activeAsset || !activePlaylist}>
                <Text style={styles.secondaryButtonText}>Add current</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={[styles.secondaryButton, (!activeAsset || !activePlaylist) ? styles.disabled : null]} onPress={removeCurrent} disabled={!activeAsset || !activePlaylist}>
                <Text style={styles.secondaryButtonText}>Remove current</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={[styles.secondaryButton, (!activeAsset || !activePlaylist) ? styles.disabled : null]} onPress={moveCurrentUp} disabled={!activeAsset || !activePlaylist}>
                <Text style={styles.secondaryButtonText}>Move up</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={[styles.secondaryButton, (!activeAsset || !activePlaylist) ? styles.disabled : null]} onPress={moveCurrentDown} disabled={!activeAsset || !activePlaylist}>
                <Text style={styles.secondaryButtonText}>Move down</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Delay between plays</Text>
            <View style={styles.captureModes}>
              {delayOptions.map((option) => (
                <Pressable key={option} style={[styles.captureMode, delaySeconds === option ? styles.captureModeActive : null]} onPress={() => setDelaySeconds(option)}>
                  <Text style={[styles.captureModeText, delaySeconds === option ? styles.captureModeTextActive : null]}>{formatDelayOption(option)}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Start delay</Text>
            <View style={styles.captureModes}>
              {startDelayOptions.map((option) => (
                <Pressable key={option} style={[styles.captureMode, startDelaySeconds === option ? styles.captureModeActive : null]} onPress={() => setStartDelaySeconds(option)}>
                  <Text style={[styles.captureModeText, startDelaySeconds === option ? styles.captureModeTextActive : null]}>{formatDelayOption(option)}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {presets.length ? (
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Presets</Text>
              <View style={styles.captureModes}>
                {presets.slice(0, 8).map((preset) => (
                  <Pressable
                    key={label(preset)}
                    style={styles.captureMode}
                    onPress={() => {
                      setIsInfiniteMode(false);
                      setTargetPlays(clampInteger(preset.plays, targetPlays, 1, Number.MAX_SAFE_INTEGER));
                      setDelaySeconds(clampInteger(preset.delaySeconds, delaySeconds, 0, 3600));
                      setStartDelaySeconds(clampInteger(preset.startDelaySeconds, startDelaySeconds, 0, 3600));
                    }}
                  >
                    <Text style={styles.captureModeText}>{label(preset)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Recent</Text>
            {recentAssets.length ? recentAssets.slice(0, 5).map((asset) => (
              <Pressable key={asset.id} accessibilityRole="button" onPress={() => void selectAsset(asset)} style={styles.formField}>
                <Text style={styles.formHint}>{asset.displayName}</Text>
              </Pressable>
            )) : <Text style={styles.formHint}>No recent assets.</Text>}
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>History</Text>
            {recentHistory.length ? recentHistory.slice(0, 6).map((entry: AudioLoopHistoryEntry) => {
              const source = audioLoopState.assets.find((asset) => asset.id === entry.assetId);
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  onPress={() => {
                    if (!source) {
                      setError('History item source was removed.');
                      return;
                    }
                    void selectAsset(source);
                  }}
                  style={styles.formField}
                >
                  <Text style={styles.formHint}>{source?.displayName ?? 'Unknown'}: {entry.status}</Text>
                </Pressable>
              );
            }) : <Text style={styles.formHint}>No history yet.</Text>}
          </View>
        </>
    </WidgetShell>
  );
}

function VideoPlayerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const initialUri = text(props.sourceUri, text(props.source, text(props.url)));
  const [videoUri, setVideoUri] = useState(initialUri);
  const [videoName, setVideoName] = useState(initialUri ? text(props.title, 'Video') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [videoModule, setVideoModule] = useState<NativeVideoModule | null>(null);
  const contentFit = props.contentFit === 'cover' || props.contentFit === 'fill' ? props.contentFit : 'contain';
  const videoCapability = requestWidgetCapability(
    runtime,
    { kind: 'video-player', action: 'render' },
  );

  useEffect(() => {
    let cancelled = false;
    if (!videoCapability.ok) {
      setVideoModule(null);
      return () => {
        cancelled = true;
      };
    }
    void loadExpoVideo().then((module) => {
      if (!cancelled) setVideoModule(module);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime.activePackage?.id, runtime.activePackage?.version, runtime.installationId, videoCapability.ok]);

  function LoadedVideoSurface() {
    if (!videoModule) return null;
    const player = videoModule.useVideoPlayer(videoUri ? { uri: videoUri } : null, (nextPlayer: NativeVideoPlayer) => {
      nextPlayer.loop = props.loop === true;
      if (props.autoplay === true) nextPlayer.play();
    });

    useEffect(() => {
      player.loop = props.loop === true;
    }, [player, props.loop]);

    return (
      <View style={styles.videoFrame}>
        <videoModule.VideoView
          player={player}
          nativeControls={props.nativeControls !== false}
          contentFit={contentFit}
          fullscreenOptions={{ enable: true }}
          style={styles.videoView}
        />
      </View>
    );
  }

  const chooseVideo = useCallback(async (mode: 'camera' | 'library') => {
    setBusy(true);
    setError('');
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'media-picker', action: mode, media: 'video' },
        setError,
      )) {
        return;
      }
      const picker = await loadExpoImagePicker();
      if (mode === 'camera') {
        const permission = await picker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Camera permission is required.');
          return;
        }
      }
      const result = mode === 'camera'
        ? await picker.launchCameraAsync({ mediaTypes: ['videos'], quality: 1 })
        : await picker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setVideoUri(asset.uri);
      setVideoName(String(asset.fileName ?? asset.uri.split('/').pop() ?? 'Picked video'));
    } catch {
      setError('Video selection failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime.activePackage, runtime.installationId]);

  return (
    <WidgetShell title={text(props.title, 'Video player')} subtitle={text(props.subtitle, 'Play a package video or choose one locally.')}>
      {videoUri && videoModule && videoCapability.ok ? (
        <LoadedVideoSurface />
      ) : (
        <View style={styles.mediaBox}>
          <Text style={styles.mediaGlyph}>VID</Text>
          <Text style={styles.bodyText}>
            {text(
              props.emptyCopy,
              !videoCapability.ok
                ? videoCapability.error.message
                : videoModule
                  ? 'No video selected.'
                  : 'Loading video tools…',
            )}
          </Text>
        </View>
      )}
      <View style={styles.providerActions}>
        {props.allowPick !== false ? (
          <Pressable accessibilityRole="button" style={[styles.secondaryButton, busy ? styles.disabled : null]} onPress={() => void chooseVideo('library')} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Choose video</Text>
          </Pressable>
        ) : null}
        {props.allowCapture === true ? (
          <Pressable accessibilityRole="button" style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={() => void chooseVideo('camera')} disabled={busy}>
            <Text style={styles.primaryButtonText}>{busy ? 'Opening…' : 'Record'}</Text>
          </Pressable>
        ) : null}
      </View>
      {videoName ? <Text style={styles.formHint}>{videoName}</Text> : null}
      {error ? <Text style={styles.warning}>{error}</Text> : null}
    </WidgetShell>
  );
}

function CameraScannerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [cameraModule, setCameraModule] = useState<NativeCameraModule | null>(null);
  const [scan, setScan] = useState<any>(null);
  const [error, setError] = useState('');
  const barcodeTypes = stringList(props.barcodeTypes, ['qr', 'code128', 'ean13']);
  const cameraCapability = requestWidgetCapability(runtime, {
    kind: 'camera-scanner',
    action: 'scan',
    barcodeTypes,
  });
  useEffect(() => {
    let cancelled = false;
    if (!cameraCapability.ok) {
      setCameraModule(null);
      setError(cameraCapability.error.message);
      return () => {
        cancelled = true;
      };
    }
    void loadExpoCamera().then((module) => {
      if (!cancelled) setCameraModule(module);
    });
    return () => {
      cancelled = true;
    };
  }, [cameraCapability.ok, cameraCapability.ok ? '' : cameraCapability.error.message]);

  function LoadedCameraScanner() {
    if (!cameraModule) return null;
    const [permission, requestPermission] = cameraModule.useCameraPermissions();
    const currentCapability = requestWidgetCapability(runtime, {
      kind: 'camera-scanner',
      action: 'scan',
      barcodeTypes,
    });
    if (!currentCapability.ok) {
      return (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>Camera access</Text>
          <Text style={styles.previewText}>{currentCapability.error.message}</Text>
        </View>
      );
    }

    if (!permission?.granted) {
      return (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>Camera access</Text>
          <Text style={styles.previewText}>Required to scan codes.</Text>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => void requestPermission()}>
            <Text style={styles.primaryButtonText}>Choose access</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.cameraFrame}>
          <cameraModule.CameraView
            style={styles.cameraView}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes }}
            onBarcodeScanned={scan ? undefined : (result: any) => setScan(result)}
          />
      </View>
    );
  }

  return (
    <WidgetShell title={text(props.title, 'Camera scanner')} subtitle={text(props.subtitle, 'Scan QR and barcode values locally.')}>
      {cameraModule && cameraCapability.ok ? <LoadedCameraScanner /> : (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>Camera access</Text>
          <Text style={styles.previewText}>{error || 'Loading camera tools…'}</Text>
        </View>
      )}
      {scan ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>{scan.type}</Text>
          <Text style={styles.bodyText}>{scan.data}</Text>
          <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setScan(null)}>
            <Text style={styles.secondaryButtonText}>Scan again</Text>
          </Pressable>
        </View>
      ) : null}
    </WidgetShell>
  );
}

function LocationMapWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<{latitude: number; longitude: number} | null>(() => {
    const latitude = numberValue(props.latitude, Number.NaN);
    const longitude = numberValue(props.longitude, Number.NaN);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  });
  const [error, setError] = useState('');

  const requestCurrent = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'location', action: 'current' },
        setError,
      )) {
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location permission is required.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({});
      setLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
    } catch {
      setError('Location failed.');
    } finally {
      setBusy(false);
    }
  }, [runtime.activePackage, runtime.installationId]);

  const openMap = useCallback(() => {
    if (location) {
      const query = `${location.latitude},${location.longitude}`;
      void Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?ll=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`);
      return;
    }
    const address = text(props.address);
    if (address) void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
  }, [location, props.address]);

  return (
    <WidgetShell title={text(props.title, 'Location map')} subtitle={text(props.subtitle, 'Show or request a local location, then open the system map.')}>
      <View style={styles.mapBox}>
        <Text style={styles.mapPin}>PIN</Text>
        <Text style={styles.bodyText}>{location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : text(props.address, 'No location selected')}</Text>
      </View>
      <View style={styles.providerActions}>
        <Pressable accessibilityRole="button" style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={requestCurrent} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Locating…' : 'Use current'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={openMap} disabled={!location && !props.address}>
          <Text style={styles.secondaryButtonText}>Open map</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.warning}>{error}</Text> : null}
    </WidgetShell>
  );
}

function SensorReadoutWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const sensorName = text(props.sensor, 'accelerometer');
  const [sensorModule, setSensorModule] = useState<any>(null);
  const [reading, setReading] = useState<Record<string, number> | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const sensorCapability = requestWidgetCapability(
    runtime,
    { kind: 'sensor', action: 'watch', sensor: sensorName as 'accelerometer' | 'gyroscope' | 'magnetometer' },
  );

  useEffect(() => {
    let cancelled = false;
    if (!sensorCapability.ok) {
      setSensorModule(null);
      setActive(false);
      setError(sensorCapability.error.message);
      return () => {
        cancelled = true;
      };
    }
    void loadExpoSensors().then((module) => {
      if (!cancelled) setSensorModule(module);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, sensorCapability.ok, sensorName]);

  useEffect(() => {
    if (!active || !sensorModule) return undefined;
    if (!requireWidgetCapability(
      runtime,
        { kind: 'sensor', action: 'watch', sensor: sensorName as 'accelerometer' | 'gyroscope' | 'magnetometer' },
      setError,
    )) {
      setActive(false);
      return undefined;
    }
    let mounted = true;
    let subscription: { remove(): void } | null = null;
    const sensor = sensorName === 'gyroscope' ? sensorModule.Gyroscope : sensorName === 'magnetometer' ? sensorModule.Magnetometer : sensorModule.Accelerometer;
    void sensor.isAvailableAsync().then((available: boolean) => {
      if (!mounted) return;
      if (!available) {
        setError('Sensor unavailable on this device.');
        setActive(false);
        return;
      }
      sensor.setUpdateInterval(500);
      subscription = sensor.addListener((next: Record<string, number>) => setReading(next));
    }).catch(() => {
      setError('Sensor failed.');
      setActive(false);
    });
    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [active, runtime.activePackage, runtime.installationId, sensorModule, sensorName]);

  return (
    <WidgetShell title={text(props.title, 'Sensor readout')} subtitle={text(props.subtitle, 'Sample local device motion sensors.')}>
      <View style={styles.previewBox}>
        <Text style={styles.previewTitle}>{titleize(sensorName)}</Text>
        <Text style={styles.previewText}>{reading ? Object.entries(reading).slice(0, 4).map(([key, value]) => `${key}: ${value.toFixed(3)}`).join(' · ') : 'No sample yet'}</Text>
        <Pressable accessibilityRole="button" style={active ? styles.secondaryButton : styles.primaryButton} onPress={() => setActive((value) => !value)}>
          <Text style={active ? styles.secondaryButtonText : styles.primaryButtonText}>{active ? 'Stop' : 'Start'}</Text>
        </Pressable>
        {error ? <Text style={styles.warning}>{error}</Text> : null}
      </View>
    </WidgetShell>
  );
}

function NotificationSchedulerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [notificationId, setNotificationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const seconds = clampInteger(props.seconds, 10, 1, 86400);

  const schedule = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'notification', action: 'schedule' },
        setMessage,
      )) {
        return;
      }
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        setMessage('Notification permission is required.');
        return;
      }
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: text(props.title, 'Utopia reminder'),
          body: text(props.body, 'Reminder from this app.'),
        },
        trigger: { seconds } as NativeNotificationTriggerInput,
      });
      setNotificationId(id);
      setMessage(`Scheduled in ${seconds}s.`);
    } catch {
      setMessage('Notification scheduling failed.');
    } finally {
      setBusy(false);
    }
  }, [props.body, props.title, runtime.activePackage, runtime.installationId, seconds]);

  const cancel = useCallback(async () => {
    if (!notificationId) return;
    if (!requireWidgetCapability(
      runtime,
      { kind: 'notification', action: 'cancel' },
      setMessage,
    )) {
      return;
    }
    await Notifications.cancelScheduledNotificationAsync(notificationId);
    setNotificationId('');
    setMessage('Canceled.');
  }, [notificationId, runtime.activePackage, runtime.installationId]);

  return (
    <WidgetShell title={text(props.title, 'Notification')} subtitle={text(props.subtitle, 'Schedule a local notification.')}>
      <View style={styles.providerActions}>
        <Pressable accessibilityRole="button" style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={schedule} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Scheduling…' : 'Schedule'}</Text>
        </Pressable>
        {notificationId ? (
          <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => void cancel()}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text style={styles.formHint}>{message}</Text> : null}
    </WidgetShell>
  );
}

function ContactPickerWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [contact, setContact] = useState<{name?: string; phone?: string; email?: string} | null>(null);
  const [message, setMessage] = useState('');
  const pick = useCallback(async () => {
    setMessage('');
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'contacts', action: 'pick' },
        setMessage,
      )) {
        return;
      }
      const available = await Contacts.isAvailableAsync();
      if (!available || Platform.OS === 'web') {
        setMessage('Contact picker unavailable on this runtime.');
        return;
      }
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setMessage('Contacts permission is required.');
        return;
      }
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;
      setContact({
        name: picked.name,
        phone: picked.phoneNumbers?.[0]?.number,
        email: picked.emails?.[0]?.email,
      });
    } catch {
      setMessage('Contact picker failed.');
    }
  }, [runtime.activePackage, runtime.installationId]);
  return (
    <WidgetShell title={text(props.title, 'Contact picker')} subtitle={text(props.subtitle, 'Pick one contact without bulk importing address book data.')}>
      <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => void pick()}>
        <Text style={styles.primaryButtonText}>Pick contact</Text>
      </Pressable>
      {contact ? (
        <View style={styles.previewBox}>
          <Text style={styles.previewTitle}>{contact.name ?? 'Contact'}</Text>
          <Text style={styles.previewText}>{[contact.phone, contact.email].filter(Boolean).join(' · ') || 'No contact detail shared'}</Text>
        </View>
      ) : null}
      {message ? <Text style={styles.warning}>{message}</Text> : null}
    </WidgetShell>
  );
}

function CalendarEventWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const create = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'calendar', action: 'create' },
        setMessage,
      )) {
        return;
      }
      const available = await Calendar.isAvailableAsync();
      if (!available || Platform.OS === 'web') {
        setMessage('Calendar unavailable on this runtime.');
        return;
      }
      const permission = await Calendar.requestPermissionsAsync();
      if (!permission.granted) {
        setMessage('Calendar permission is required.');
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const target = calendars.find((item: { allowsModifications?: boolean }) => item.allowsModifications) ?? calendars[0];
      if (!target) {
        setMessage('No writable calendar found.');
        return;
      }
      const start = new Date(Date.now() + clampInteger(props.startOffsetMinutes, 10, 0, 525600) * 60_000);
      const end = new Date(start.getTime() + clampInteger(props.durationMinutes, 30, 1, 1440) * 60_000);
      await Calendar.createEventAsync(target.id, {
        title: text(props.eventTitle, text(props.title, 'Utopia event')),
        notes: text(props.body, 'Created from a Utopia JSON app.'),
        startDate: start,
        endDate: end,
      });
      setMessage('Calendar event created.');
    } catch {
      setMessage('Calendar event failed.');
    } finally {
      setBusy(false);
    }
  }, [props.body, props.durationMinutes, props.eventTitle, props.startOffsetMinutes, props.title, runtime.activePackage, runtime.installationId]);
  return (
    <WidgetShell title={text(props.title, 'Calendar event')} subtitle={text(props.subtitle, 'Create one reviewed local calendar event.')}>
      <Pressable accessibilityRole="button" style={[styles.primaryButton, busy ? styles.disabled : null]} onPress={() => void create()} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Creating…' : 'Create event'}</Text>
      </Pressable>
      {message ? <Text style={styles.formHint}>{message}</Text> : null}
    </WidgetShell>
  );
}

function BiometricGateWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const [message, setMessage] = useState('');
  const authenticate = useCallback(async () => {
    try {
      if (!requireWidgetCapability(
        runtime,
        { kind: 'biometric', action: 'authenticate' },
        setMessage,
      )) {
        return;
      }
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setMessage('Biometric auth unavailable or not enrolled.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: text(props.authPrompt, text(props.title, 'Unlock')),
      });
      setMessage(result.success ? 'Unlocked.' : 'Not unlocked.');
    } catch {
      setMessage('Authentication failed.');
    }
  }, [props.authPrompt, props.title, runtime.activePackage, runtime.installationId]);
  return (
    <WidgetShell title={text(props.title, 'Biometric gate')} subtitle={text(props.subtitle, 'Require local device authentication before sensitive actions.')}>
      <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => void authenticate()}>
        <Text style={styles.primaryButtonText}>Unlock</Text>
      </Pressable>
      {message ? <Text style={styles.formHint}>{message}</Text> : null}
    </WidgetShell>
  );
}

function HealthKitStatusWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  return (
    <WidgetShell title={text(props.title, 'Apple Health')} subtitle={text(props.subtitle, 'HealthKit is declared in package capabilities; native iOS bridge is still required for live reads.')}>
      <View style={styles.previewBox}>
        <Text style={styles.previewTitle}>Planned iOS bridge</Text>
        <Text style={styles.previewText}>Android Health Connect exists separately. Apple Health needs a signed native entitlement path before release proof.</Text>
      </View>
    </WidgetShell>
  );
}

function SpeechToolWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const runtime = useAppRuntime();
  const phrase = text(props.speechText, text(props.body, 'Hello from Utopia.'));
  const [message, setMessage] = useState('');
  const speak = useCallback(() => {
    if (!requireWidgetCapability(
      runtime,
      { kind: 'speech', action: 'speak', textLength: phrase.length },
      setMessage,
    )) {
      return;
    }
    Speech.speak(phrase);
    setMessage('Speaking.');
  }, [phrase, runtime.activePackage, runtime.installationId]);
  const stop = useCallback(() => {
    if (!requireWidgetCapability(
      runtime,
      { kind: 'speech', action: 'stop', textLength: phrase.length },
      setMessage,
    )) {
      return;
    }
    void Speech.stop();
    setMessage('Stopped.');
  }, [phrase.length, runtime.activePackage, runtime.installationId]);
  return (
    <WidgetShell title={text(props.title, 'Speech')} subtitle={text(props.subtitle, 'Text-to-speech works locally; speech-to-text remains a planned native permission path.')}>
      <View style={styles.providerActions}>
        <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={speak}>
          <Text style={styles.primaryButtonText}>Speak</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={stop}>
          <Text style={styles.secondaryButtonText}>Stop</Text>
        </Pressable>
      </View>
      <Text style={styles.previewText}>{phrase}</Text>
      {message ? <Text style={styles.formHint}>{message}</Text> : null}
    </WidgetShell>
  );
}

function clearAudioLoopDelay(ref: { current: ReturnType<typeof setInterval> | null }) {
  if (ref.current) {
    clearInterval(ref.current);
    ref.current = null;
  }
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length ? items : fallback;
  }
  if (typeof value === 'string' && value.trim()) return [value];
  return fallback;
}

function titleize(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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
  ScientificCalculatorWidget,
  AudioLoopPlayerWidget,
  StepFlowWidget,
  DurationTimerWidget,
  FilePickerWidget,
  FileExportWidget,
  VideoPlayerWidget,
  CameraScannerWidget,
  LocationMapWidget,
  SensorReadoutWidget,
  NotificationSchedulerWidget,
  ContactPickerWidget,
  CalendarEventWidget,
  BiometricGateWidget,
  HealthKitStatusWidget,
  SpeechToolWidget,
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

export const styles = StyleSheet.create({
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
  videoFrame: { backgroundColor: '#111111', borderRadius: 18, minHeight: 220, overflow: 'hidden' },
  videoView: { height: 220, width: '100%' },
  cameraFrame: { backgroundColor: '#111111', borderRadius: 18, height: 260, overflow: 'hidden' },
  cameraView: { flex: 1 },
  mapBox: { minHeight: 112, borderRadius: 18, backgroundColor: '#E8F4F5', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  mapPin: { color: '#2F7448', fontSize: 32, fontWeight: '900' },
  formField: { borderRadius: 14, backgroundColor: '#F6F1E8', padding: 12, gap: 7 },
  formLabel: { color: '#241C16', fontWeight: '900', fontSize: 14 },
  formHint: { color: '#6D6257', fontSize: 12 },
  formInput: { minHeight: 42, borderRadius: 12, backgroundColor: '#FFFFFF', color: '#241C16', paddingHorizontal: 11, paddingVertical: 9, fontSize: 14 },
  formInputMultiline: { minHeight: 82, textAlignVertical: 'top' },
  calculatorDisplay: { backgroundColor: '#F6F1E8', borderRadius: 18, gap: 8, padding: 14 },
  calculatorInput: { color: '#241C16', fontSize: 26, fontWeight: '800', minHeight: 48 },
  calculatorResult: { color: '#2F7448', fontSize: 30, fontWeight: '900', textAlign: 'right' },
  calculatorPad: { gap: 8 },
  calculatorRow: { flexDirection: 'row', gap: 8 },
  calculatorKey: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, flex: 1, minHeight: 50, justifyContent: 'center', paddingHorizontal: 4 },
  calculatorKeyOperator: { backgroundColor: '#E3EFF3' },
  calculatorKeyEquals: { backgroundColor: '#241C16' },
  calculatorKeyText: { color: '#241C16', fontSize: 15, fontWeight: '900' },
  calculatorKeyEqualsText: { color: '#FFFFFF' },
  audioLoopUnsupported: { backgroundColor: '#F6F1E8', borderRadius: 18, gap: 8, padding: 16 },
  audioLoopIcon: { alignSelf: 'flex-start', backgroundColor: '#E3EFF3', borderRadius: 999, color: '#1F3138', fontSize: 11, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 6, overflow: 'hidden' },
  audioLoopTitle: { color: '#241C16', fontSize: 18, fontWeight: '900' },
  audioLoopText: { color: '#6D6257', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  audioLoopDeck: { backgroundColor: '#F6F1E8', borderRadius: 18, gap: 10, padding: 14 },
  audioLoopHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  audioLoopFileCopy: { flex: 1, gap: 3 },
  audioLoopFileName: { color: '#241C16', fontSize: 17, fontWeight: '900' },
  audioLoopProgressTrack: { height: 10, backgroundColor: '#FFFFFF', borderRadius: 999, overflow: 'hidden' },
  audioLoopProgressFill: { height: 10, backgroundColor: '#2F7448', borderRadius: 999 },
  audioLoopTimeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  audioLoopMeta: { color: '#6D6257', fontSize: 12, fontWeight: '900' },
  audioLoopControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  audioLoopSettings: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  audioLoopStepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioLoopNumberInput: { minWidth: 76, borderRadius: 14, backgroundColor: '#FFFFFF', color: '#241C16', fontSize: 18, fontWeight: '900', paddingHorizontal: 12, paddingVertical: 9, textAlign: 'center' },
  audioLoopVolumeText: { minWidth: 64, color: '#241C16', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  fileRow: { alignItems: 'center', backgroundColor: '#F6F1E8', borderRadius: 16, flexDirection: 'row', gap: 10, padding: 12 },
  fileIcon: { alignItems: 'center', backgroundColor: '#E4F1E8', borderRadius: 14, height: 42, justifyContent: 'center', width: 42 },
  fileIconText: { color: '#2F7448', fontSize: 18, fontWeight: '900' },
  fileCopy: { flex: 1, gap: 3 },
  fileName: { color: '#241C16', fontSize: 15, fontWeight: '900' },
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
