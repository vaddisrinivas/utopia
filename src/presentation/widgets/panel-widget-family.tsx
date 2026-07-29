import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import type { ComponentRenderProps } from '@json-render/react-native';

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
  { label: 'Title', subtitle: 'Text', placeholder: 'What is this?' },
  { label: 'Notes', subtitle: 'Long text', placeholder: 'Add useful context…' },
  { label: 'Status', subtitle: 'Choice', placeholder: 'New, review, done…' },
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  return (
    <WidgetShell title={props.title} subtitle={props.subtitle}>
      {fields.slice(0, 8).map((field, index) => {
        const key = fieldKey(field, index);
        const rawType = text(field.type, detail(field, 'Field'));
        const multiline = /long|note|textarea|multi/i.test(rawType);
        const fieldLabel = label(field);
        return (
          <View key={key} style={styles.formField}>
            <Text style={styles.formLabel}>{fieldLabel}</Text>
            <Text style={styles.formHint}>{rawType}{field.required === true ? ' · Required' : ''}</Text>
            <TextInput
              accessibilityLabel={fieldLabel}
              style={[styles.formInput, multiline ? styles.formInputMultiline : null]}
              value={values[key] ?? ''}
              onChangeText={(next) => {
                setSubmitted(false);
                setValues((prev) => ({ ...prev, [key]: next }));
              }}
              placeholder={text(field.placeholder, `Enter ${fieldLabel.toLowerCase()}`)}
              placeholderTextColor="#9A8D7D"
              multiline={multiline}
            />
          </View>
        );
      })}
      {submitted ? <Text style={styles.success}>Preview ready. Review before writing.</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Submit form ${props.title}`}
        style={styles.primaryButton}
        onPress={() => setSubmitted(true)}
      >
        <Text style={styles.primaryButtonText}>{text(props.body, text(props.cta, 'Preview action'))}</Text>
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
    subtitle: text(value.subtitle, 'Config-declared inputs. Writes must still go through proposals/actions.'),
    fields: value.fields ?? [],
    body: value.body,
    cta: value.cta,
  };
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
    borderRadius: 20,
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
  primaryButton: { backgroundColor: '#2F7448', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
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

  formField: { borderRadius: 14, backgroundColor: '#F6F1E8', padding: 12, gap: 7 },
  formLabel: { color: '#241C16', fontWeight: '900', fontSize: 14 },
  formHint: { color: '#6D6257', fontSize: 12 },
  formInput: {
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    color: '#241C16',
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 14,
  } as TextStyle,
  formInputMultiline: { minHeight: 82, textAlignVertical: 'top' },
  success: { color: '#2F7448', fontSize: 12, fontWeight: '800' },
});
