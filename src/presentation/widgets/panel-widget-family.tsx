import { useRouter } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';

import type { ComponentRenderProps } from '@json-render/react-native';

import { upsertRecord } from '@/src/db/records';
import { useUtopiaDatabase } from '@/src/db/provider';
import { useAppRuntime } from '@/src/domain/runtime-context';
import {
  actionRoute,
  actionUrl,
  detail,
  label,
  numberValue,
  openWidgetTarget,
  rows,
  text,
  type WidgetProps,
} from '@/src/presentation/widgets/widget-sdk';

type PollCardWidgetProps = {
  title: string;
  subtitle: string;
  options: unknown[];
  actions: unknown[];
};

type KanbanBoardWidgetProps = {
  title: string;
  subtitle: string;
  columns: unknown[];
};

type FormCardWidgetProps = {
  title: string;
  subtitle: string;
  fields: unknown[];
  body?: string;
  cta?: string;
  submitLabel?: string;
  collection: string;
  recordId: string;
  recordTitle: string;
  titleField: string;
  recordMode: 'append' | 'upsert';
  defaultProperties: Record<string, unknown>;
};

const DEFAULT_POLL_OPTIONS = [
  { label: 'Yes' },
  { label: 'No' },
];

const DEFAULT_BOARD_COLUMNS = [
  { title: 'Ideas', items: [{ title: 'Draft setup' }] },
  { title: 'Next', items: [{ title: 'Review changes' }] },
];

const DEFAULT_FORM_FIELDS = [
  { label: 'Title', placeholder: 'What is this?' },
  { label: 'Notes', placeholder: 'Add useful context…', type: 'long text' },
  { label: 'Status', placeholder: 'New, review, done…' },
];

export function PollCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = pollCardProps(element.props ?? {});
  const [selected, setSelected] = useState<string | null>(null);
  const options = rows(props.options.length ? props.options : DEFAULT_POLL_OPTIONS);
  const actions = rows(props.actions);
  const totalVotes = Math.max(0, options.reduce((sum, option) => sum + numberValue(option.votes, numberValue(option.count)), 0));

  return (
    <WidgetShell title={props.title} subtitle={props.subtitle}>
      {options.map((option) => {
        const optionLabel = label(option);
        const votes = numberValue(option.votes, numberValue(option.count));
        const percent = Math.max(0, Math.min(100, numberValue(option.percent, totalVotes > 0 ? (votes / totalVotes) * 100 : 0)));
        return (
          <Pressable
            key={optionLabel}
            accessibilityRole="button"
            accessibilityLabel={`Poll option ${optionLabel}`}
            style={[styles.pollOption, selected === optionLabel ? styles.pollSelected : null]}
            onPress={() => setSelected(optionLabel)}
          >
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
            <Pressable
              key={label(action)}
              accessibilityRole="button"
              accessibilityLabel={`Poll action ${label(action)}`}
              style={styles.miniAction}
              onPress={() => openWidgetTarget(router, action as Record<string, unknown>)}
            >
              <Text style={styles.miniActionText}>{label(action)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </WidgetShell>
  );
}

export function KanbanBoardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const router = useRouter();
  const props = kanbanBoardProps(element.props ?? {});
  const columns = rows(props.columns.length ? props.columns : DEFAULT_BOARD_COLUMNS);

  return (
    <WidgetShell title={props.title} subtitle={props.subtitle}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
        {columns.map((column) => (
          <View key={label(column, 'Column')} style={styles.boardColumn}>
            <Text style={styles.boardTitle}>{label(column, 'Column')}</Text>
            {rows(column.items).slice(0, 5).map((item) => {
              const title = label(item);
              return (
                <Pressable
                  key={title}
                  accessibilityRole="button"
                  accessibilityLabel={`Open card ${title}`}
                  style={styles.boardCard}
                  onPress={() => openWidgetTarget(router, item)}
                  disabled={!actionRoute(item) && !actionUrl(item)}
                >
                  <Text style={styles.boardCardText}>{title}</Text>
                  {detail(item) ? <Text style={styles.boardCardDetail}>{detail(item)}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </WidgetShell>
  );
}

export function FormCardWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = formCardProps(element.props ?? {});
  const fields = rows(props.fields.length ? props.fields : DEFAULT_FORM_FIELDS);
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const [values, setValues] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'ready' | 'saving' | 'saved' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const fieldRows = useMemo(
    () => fields.slice(0, 8).map((field, index) => ({
      field,
      key: fieldKey(field, index),
    })),
    [fields],
  );

  const submit = useCallback(async () => {
    const missingRequired = fieldRows.some(({ field, key }) =>
      field.required === true && !values[key]?.trim()
    );
    const invalidNumber = fieldRows.some(({ field, key }) =>
      /number|decimal|currency/i.test(text(field.type)) &&
      values[key]?.trim() &&
      !Number.isFinite(Number(values[key]))
    );
    if (missingRequired || invalidNumber) {
      setStatus('error');
      setStatusMessage(
        invalidNumber
          ? 'Enter a valid number before continuing.'
          : 'Add the required fields before continuing.',
      );
      return;
    }
    if (!props.collection) {
      setStatus('ready');
      setStatusMessage('Ready to continue.');
      return;
    }
    if (!db || !runtime.activeManifest || !runtime.installationId) {
      setStatus('error');
      setStatusMessage('Form storage is not ready.');
      return;
    }

    setStatus('saving');
    setStatusMessage('Saving.');
    try {
      const now = new Date().toISOString();
      const properties = {
        ...resolveDynamicProperties(props.defaultProperties, now),
        ...Object.fromEntries(fieldRows.map(({ field, key }) => [
          key,
          coerceFieldValue(field, values[key] ?? ''),
        ])),
      };
      const recordTitle = (
        values[props.titleField] ||
        props.recordTitle ||
        props.title
      ).trim();
      const safeTitle = recordTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'entry';
      const recordId = props.recordMode === 'append'
        ? `${props.collection}-${safeTitle}-${Date.now().toString(36)}`
        : props.recordId || `${props.collection}-settings`;

      await upsertRecord(db, runtime.activeManifest, {
        id: recordId,
        collection: props.collection,
        title: recordTitle,
        properties,
        relations: [],
        source: {
          provider: 'user',
          external_id: recordId,
          url: null,
          observed_at: now,
          content_hash: null,
        },
        archived_at: null,
        created_at: now,
        updated_at: now,
        operation_actor: 'user',
        operation_origin: 'manual',
        operation_id: `op-form-${recordId}-${Date.now().toString(36)}`,
        idempotency_key: `form-card:${runtime.installationId}:${recordId}:${now}`,
        app_installation_id: runtime.installationId,
      });
      setStatus('saved');
      setStatusMessage('Saved.');
      if (props.recordMode === 'append') setValues({});
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Could not save this form.');
    }
  }, [db, fieldRows, props, runtime.activeManifest, runtime.installationId, values]);

  return (
    <WidgetShell title={props.title} subtitle={props.subtitle}>
      <View style={[styles.formFields, isWide ? styles.formFieldsWide : null]}>
        {fieldRows.map(({ field, key }) => {
        const rawType = text(field.type);
        const multiline = /long|note|textarea|multi/i.test(rawType);
        const fieldLabel = label(field);
        return (
          <View key={key} style={[styles.formField, isWide && !multiline ? styles.formFieldWide : null]}>
            <View style={styles.formLabelRow}>
              <Text style={styles.formLabel}>{fieldLabel}</Text>
              {field.required === true ? <Text style={styles.requiredLabel}>Required</Text> : null}
            </View>
            {fieldDescription(field) ? <Text style={styles.formHint}>{fieldDescription(field)}</Text> : null}
            <TextInput
              accessibilityLabel={fieldLabel}
              accessibilityHint={field.required === true ? 'Required field' : undefined}
              style={[styles.formInput, multiline ? styles.formInputMultiline : null, focusedField === key ? styles.formInputFocused : null]}
              value={values[key] ?? ''}
              onChangeText={(next) => {
                setStatus('idle');
                setValues((prev) => ({ ...prev, [key]: next }));
              }}
              placeholder={text(field.placeholder, `Enter ${fieldLabel.toLowerCase()}`)}
              placeholderTextColor="#9A8D7D"
              multiline={multiline}
              onFocus={() => setFocusedField(key)}
              onBlur={() => setFocusedField(null)}
            />
          </View>
        );
        })}
      </View>
      {status === 'error' ? <Text accessibilityRole="alert" style={styles.error}>{statusMessage}</Text> : null}
      {status === 'ready' || status === 'saving' || status === 'saved' ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>{statusMessage}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formActionLabel(props)} ${props.title}`}
        accessibilityState={{ disabled: status === 'saving' }}
        disabled={status === 'saving'}
        style={[styles.primaryButton, status === 'saving' ? styles.primaryButtonDisabled : null]}
        onPress={() => void submit()}
      >
        <Text style={styles.primaryButtonText}>{formActionLabel(props)}</Text>
      </Pressable>
    </WidgetShell>
  );
}

function pollCardProps(value: WidgetProps): PollCardWidgetProps {
  return {
    title: text(value.title, 'Poll'),
    subtitle: text(value.subtitle, 'Choose one. Stored action wiring comes from package proposals.'),
    options: value.options ?? [],
    actions: value.actions ?? [],
  };
}

function kanbanBoardProps(value: WidgetProps): KanbanBoardWidgetProps {
  return {
    title: text(value.title, 'Board'),
    subtitle: text(value.subtitle, 'Generic grouped work, projects, or approvals.'),
    columns: value.columns ?? [],
  };
}

function formCardProps(value: WidgetProps): FormCardWidgetProps {
  return {
    title: text(value.title, 'Form'),
    subtitle: text(value.subtitle, 'Add the details you want to keep together.'),
    fields: value.fields ?? [],
    body: value.body,
    cta: value.cta,
    submitLabel: text(value.submitLabel),
    collection: text(value.collection),
    recordId: text(value.recordId),
    recordTitle: text(value.recordTitle),
    titleField: text(value.titleField, 'name'),
    recordMode: text(value.recordMode) === 'append' ? 'append' : 'upsert',
    defaultProperties: propertyValues(value.defaultProperties),
  };
}

function propertyValues(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveDynamicProperties(
  properties: Record<string, unknown>,
  now: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value === '$now' ? now : value === '$today' ? now.slice(0, 10) : value,
    ]),
  );
}

function coerceFieldValue(field: Record<string, unknown>, value: string): unknown {
  if (/number|decimal|currency/i.test(text(field.type))) return Number(value);
  if (/boolean|checkbox|toggle/i.test(text(field.type))) {
    return /^(true|1|yes|on)$/i.test(value.trim());
  }
  return value.trim();
}

function fieldDescription(value: Record<string, unknown>): string {
  return text(value.description, text(value.helpText));
}

function formActionLabel(props: FormCardWidgetProps): string {
  return text(props.submitLabel, text(props.body, text(props.cta, 'Review details')));
}

function fieldKey(value: Record<string, unknown>, index: number): string {
  return text(value.id, text(value.name, label(value, `field_${index}`))).toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function WidgetShell({
  title,
  subtitle,
  children,
  showHeader = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFCF5',
    borderRadius: 8,
    padding: 14,
    gap: 12,
    shadowColor: '#271D14',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  } as ViewStyle,
  title: { color: '#241C16', fontSize: 22, fontWeight: '800' } as TextStyle,
  subtitle: { color: '#6D6257', fontSize: 14, lineHeight: 20 } as TextStyle,
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: { backgroundColor: '#2F7448', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 11, alignItems: 'center' },
  primaryButtonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800' },

  pollOption: { borderRadius: 16, padding: 12, backgroundColor: '#F6F1E8', gap: 3 },
  pollSelected: { backgroundColor: '#E4F1E8', borderWidth: 1, borderColor: '#2F7448' },
  pollHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pollText: { color: '#241C16', fontSize: 15, fontWeight: '800' },
  pollMeta: { color: '#6D6257', fontSize: 12 },
  pollTrack: { height: 8, backgroundColor: '#FFFFFF', borderRadius: 999, overflow: 'hidden', marginTop: 4 },
  pollFill: { height: 8, backgroundColor: '#2F7448', borderRadius: 999 },

  miniAction: { backgroundColor: '#241C16', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  miniActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },

  board: { gap: 10 },
  boardColumn: { width: 168, backgroundColor: '#F6F1E8', borderRadius: 18, padding: 10, gap: 8 },
  boardTitle: { color: '#241C16', fontWeight: '900' },
  boardCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 10, gap: 4 },
  boardCardText: { color: '#241C16', fontWeight: '700' },
  boardCardDetail: { color: '#6D6257', fontSize: 12, lineHeight: 16 },

  formFields: { gap: 16 },
  formFieldsWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  formField: { gap: 7, minWidth: 0 },
  formFieldWide: { width: '48%' },
  formLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  formLabel: { color: '#241C16', fontWeight: '900', fontSize: 14 },
  requiredLabel: { color: '#8B3F2F', fontSize: 11, fontWeight: '800' },
  formHint: { color: '#6D6257', fontSize: 12, lineHeight: 17 },
  formInput: {
    minHeight: 48,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D8CBBB',
    backgroundColor: '#FFFFFF',
    color: '#241C16',
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
  } as TextStyle,
  formInputFocused: { borderColor: '#2F7448', borderWidth: 2 },
  formInputMultiline: { minHeight: 82, textAlignVertical: 'top' },
  error: { color: '#8B3F2F', fontSize: 12, fontWeight: '800', lineHeight: 17 },
  success: { color: '#2F7448', fontSize: 12, fontWeight: '800' },
});
