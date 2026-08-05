import { ArrowDown, ArrowUp, Plus, RotateCcw, Search, SortAsc, SortDesc, Trash2, Undo2 } from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { AppPackage, AppComponent } from './schema';
import { queryRecords, type JsonRecord } from './runtime';
import { computedRecords } from './engine';
import { useOptionalAppStore, type Store } from './store';
import { usePackageTheme } from './theme';
import { Button, H2, Input, Label, Paragraph, ScrollView, Separator, Switch, Text, TextArea, XStack, YStack } from 'tamagui';
import type { AppState } from './runtime';
import {
  asList,
  asNumber,
  asObject,
  filterSortRecords,
  normalizeValue,
  RESERVED_RECORD_FIELDS,
  resolveBoardConfig,
  resolveCollection,
  toText,
} from './record-views';

type Runtime = Pick<Store, 'state' | 'dispatch'>;
type Props = { component: AppComponent; pkg: AppPackage; runtime?: Runtime };
type Values = Record<string, unknown>;
type SortDirection = 'asc' | 'desc';
type RecordFieldType = 'text' | 'number' | 'boolean' | 'timestamp' | 'json';
type RecordField = {
  id: string;
  label: string;
  type: RecordFieldType;
  required: boolean;
  defaultValue?: unknown;
};
const textLike = (value: unknown) => normalizeValue(value);
export const bulkRows = (value: string, field: string, defaults: Values = {}) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 100).map((item) => ({ ...defaults, [field]: item }));
export const matchesPreset = (record: JsonRecord, preset?: Values) => !preset || !toText(preset.field) || textLike(record.values[toText(preset.field)]).toLowerCase() === textLike(preset.value).toLowerCase();
const asTextField = (value: unknown, fallback: string) => toText(value, fallback) || fallback;
const asRecordFieldType = (value: unknown): RecordFieldType => {
  if (value === 'text' || value === 'number' || value === 'boolean' || value === 'timestamp' || value === 'json') {
    return value;
  }
  return 'text';
};

const toDateValue = (value: unknown) => {
  if (value == null) return '';
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return String(value);
  return new Date(parsed).toISOString();
};

function toRowLabel(record: JsonRecord, component: AppComponent) {
  const custom = toText(component.props?.titleField) ? record.values[toText(component.props?.titleField)] : undefined;
  return toText(custom, toText(record.values.title, toText(record.values.name, toText(record.values.label, record.id))));
}

function toSubtitle(record: JsonRecord, component: AppComponent) {
  const candidates = asList(component.props?.subtitleFields).map((item) => toText(item));
  const fields = candidates.length ? candidates : ['status', 'category', 'owner', 'updatedAt'];
  return fields
    .map((field) => textLike(record.values[field]))
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

function collectRows(record: JsonRecord, component: AppComponent, cap = 8) {
  const requested = asList(component.props?.fields)
    .map((entry) => typeof entry === 'string' ? entry : toText((entry as Values).id))
    .filter(Boolean);
  const fields = requested.length
      ? requested
      : Object.entries(record.values)
        .map(([key]) => key)
        .filter((key) => !RESERVED_RECORD_FIELDS.has(key));
  return fields.slice(0, cap).map((field) => ({
    field,
    value: textLike(record.values[field]),
  }));
}

function fieldsFor(component: AppComponent, pkg: AppPackage, collection?: string) {
  const declared = asList(component.props?.fields)
    .map((entry) => {
      if (typeof entry === 'string') return { id: entry, label: entry, type: 'text' as const };
      const value = entry as Values;
      const id = toText(value.id);
      if (!id || RESERVED_RECORD_FIELDS.has(id)) return undefined;
      return {
        id,
        label: toText(value.label, id),
        type: asRecordFieldType(value.type),
        required: Boolean(value.required),
        defaultValue: value.default ?? value.value,
      };
    })
    .filter((field): field is RecordField => Boolean(field))
    .filter((field) => !RESERVED_RECORD_FIELDS.has(field.id));

  if (declared.length) return declared;

  if (!collection) return [];
  return Object.entries(pkg.collections[collection]?.fields ?? {})
    .filter(([id]) => !RESERVED_RECORD_FIELDS.has(id))
    .map(([id, spec]) => ({
      id,
      label: id,
      type: asRecordFieldType(spec.type),
      required: Boolean(spec.required),
      defaultValue: undefined,
    } satisfies RecordField));
}

function Panel({ title, children }: { title?: string; children: ReactNode }) {
  const theme = usePackageTheme();
  return <YStack
    gap="$3"
    style={{
      borderRadius: 10,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.muted,
      padding: 12,
    }}
  >
    {title ? <H2 size="$6">{title}</H2> : null}
    {children}
  </YStack>;
}

function RowValue({ label, value }: { label: string; value: string }) {
  return <XStack style={{ justifyContent: 'space-between', alignItems: 'center' }}>
    <Text color="$color10" width={110}>{label}</Text>
    <Text flex={1} style={{ textAlign: 'right' }}>{value}</Text>
  </XStack>;
}

function QuickForm({
  component,
  pkg,
  collection,
  record,
  dispatch,
  onDone,
}: Props & Runtime & { collection: string; dispatch: Runtime['dispatch']; record?: JsonRecord; onDone?: () => void }) {
  const fields = fieldsFor(component, pkg, collection);
  const base = asObject(component.props?.defaultProperties);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(fields.filter((field) => field.defaultValue != null).map((field) => [field.id, String(field.defaultValue)])),
    ...Object.fromEntries(Object.entries(base).map(([key, value]) => [key, String(value)])),
    ...(record ? Object.fromEntries(Object.entries(record.values).map(([k, v]) => [k, String(v)])) : {}),
  }));
  const [error, setError] = useState('');

  const save = async () => {
    const normalized = {
      ...values,
      ...Object.fromEntries(fields.map((field) => {
        if (field.type === 'number') return [field.id, asNumber(values[field.id], Number.NaN)];
        if (field.type === 'boolean') return [field.id, values[field.id] === 'true'];
        return [field.id, values[field.id]];
      })),
    };
    const missing = fields.find((field) => field.required && toText(values[field.id]) === '');
    if (missing) return setError(`${missing.label} required`);
    if (record) await dispatch({ kind: 'update', recordId: record.id, values: normalized });
    else await dispatch({ kind: 'create', collection, values: normalized });
    setValues({});
    setError('');
    onDone?.();
  };

  return <YStack gap="$2">
    {fields.map((field) => {
      const key = `${component.id ?? collection}-${field.id}`;
      if (field.type === 'boolean') {
      return <XStack key={field.id} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Label htmlFor={key}>{field.label}</Label>
          <Switch checked={values[field.id] === 'true'} onCheckedChange={(value) => setValues((current) => ({ ...current, [field.id]: value.toString() }))}><Switch.Thumb /></Switch>
        </XStack>;
      }
      return <Input
        key={field.id}
        placeholder={field.label}
        keyboardType={field.type === 'number' ? 'numeric' : 'default'}
        value={toText(values[field.id])}
        onChangeText={(next) => setValues((current) => ({ ...current, [field.id]: next }))}
      />;
    })}
    {error ? <Paragraph color="$red10">{error}</Paragraph> : null}
    <Button icon={record ? Undo2 : Plus} onPress={() => void save()}>{record ? 'Save' : 'Add'}</Button>
  </YStack>;
}

function HeroSurface({ component, records }: { component: AppComponent; records: JsonRecord[] }) {
  const latest = records[0];
  return <Panel title={component.title}>
    {latest ? <YStack gap="$2">
      <H2>{toRowLabel(latest, component)}</H2>
      <Paragraph color="$color10">{toText(latest.values.note, 'Latest record')}</Paragraph>
      <YStack gap="$1">{collectRows(latest, component, 6).map((row) => <RowValue key={row.field} label={row.field} value={row.value} />)}</YStack>
    </YStack> : <Paragraph color="$color10">No records</Paragraph>}
  </Panel>;
}

function DetailSurface({ component, records, review = false }: { component: AppComponent; records: JsonRecord[]; review?: boolean }) {
  const [index, setIndex] = useState(0);
  const record = records[Math.max(0, Math.min(index, records.length - 1))];
  if (!record) return <Panel title={component.title}><Paragraph color="$color10">No records</Paragraph></Panel>;

  return <Panel title={component.title}>
    <Text fontWeight="700" fontSize="$7">{toRowLabel(record, component)}</Text>
    {toSubtitle(record, component) ? <Text color="$color10">{toSubtitle(record, component)}</Text> : null}
    <YStack gap="$1" style={{ paddingTop: 8 }}>{collectRows(record, component, 20).map((row) => <RowValue key={row.field} label={row.field} value={row.value} />)}</YStack>
    {review ? <Paragraph color="$color10">{toText(component.props?.reviewHint, 'Review and act on record state')}</Paragraph> : null}
    {records.length > 1 ? <XStack gap="$2" style={{ marginTop: 8 }}>
      <Button disabled={index <= 0} onPress={() => setIndex((value) => Math.max(0, value - 1))}>Previous</Button>
      <Button disabled={index >= records.length - 1} onPress={() => setIndex((value) => Math.min(records.length - 1, value + 1))}>Next</Button>
    </XStack> : null}
  </Panel>;
}

function ListSurface({ component, collection, pkg, records, state, dispatch, query = '' }: Props & Runtime & { collection: string; records: JsonRecord[]; query?: string }) {
  const fields = fieldsFor(component, pkg, collection);
  const [search, setSearch] = useState(toText(query));
  const [sortField, setSortField] = useState(toText(component.props?.sortField, fields[0]?.id));
  const [sortDirection, setSortDirection] = useState<SortDirection>(toText(component.props?.sortDirection, 'asc') === 'desc' ? 'desc' : 'asc');
  const [form, setForm] = useState<JsonRecord | 'new' | null>(null);
  const [bulk, setBulk] = useState('');
  const [pendingDelete, setPendingDelete] = useState('');
  const [activePreset, setActivePreset] = useState(-1);
  const presets = asList(component.props?.filterPresets).map((item) => asObject(item)).filter((item) => toText(item.label));
  const manualField = toText(component.props?.manualOrderField);
  const selectedPreset = presets[activePreset];

  const rows = useMemo(() => filterSortRecords(records, {
    query: search || toText(selectedPreset?.query),
    sortField: manualField || sortField,
    sortDirection,
    limit: asNumber(component.props?.limit, 200),
  }).filter((record) => matchesPreset(record, selectedPreset)),
  [records, search, sortField, sortDirection, component.props?.limit, manualField, selectedPreset]);
  const addBulk = async () => {
    const field = toText(component.props?.titleField, fields[0]?.id ?? 'title');
    for (const values of bulkRows(bulk, field, asObject(component.props?.defaultProperties))) await dispatch({ kind: 'create', collection, values });
    setBulk('');
  };
  const move = async (record: JsonRecord, delta: number) => {
    const index = rows.findIndex((item) => item.id === record.id);
    const other = rows[index + delta];
    if (!manualField || !other) return;
    const currentValue = asNumber(record.values[manualField], index);
    const otherValue = asNumber(other.values[manualField], index + delta);
    await dispatch({ kind: 'update', recordId: record.id, values: { [manualField]: otherValue } });
    await dispatch({ kind: 'update', recordId: other.id, values: { [manualField]: currentValue } });
  };

  return <Panel title={component.title}>
    <XStack gap="$2" style={{ alignItems: 'center' }}>
      <Search size={18} />
      <Input flex={1} placeholder="Search" value={search} onChangeText={setSearch} />
      <Button size="$2" icon={Plus} onPress={() => setForm('new')}>New</Button>
      <Button size="$2" icon={sortDirection === 'asc' ? SortAsc : SortDesc} onPress={() => setSortDirection((value) => value === 'asc' ? 'desc' : 'asc')}>Sort</Button>
    </XStack>
    {presets.length ? <XStack gap="$2" flexWrap="wrap"><Button size="$2" theme={activePreset < 0 ? 'green' : undefined} onPress={() => setActivePreset(-1)}>All</Button>{presets.map((preset, index) => <Button key={toText(preset.label)} size="$2" theme={activePreset === index ? 'green' : undefined} onPress={() => setActivePreset(index)}>{toText(preset.label)}</Button>)}</XStack> : null}
    <XStack gap="$2" style={{ flexWrap: 'wrap', paddingTop: 8, paddingBottom: 8 }}>{fields.slice(0, 8).map((field) => <Button key={field.id} size="$2" theme={sortField === field.id ? 'green' : undefined} onPress={() => setSortField(field.id)}>{field.id}</Button>)}</XStack>
    {component.props?.bulkAdd ? <XStack gap="$2"><TextArea flex={1} value={bulk} onChangeText={setBulk} placeholder="One item per line" /><Button disabled={!bulk.trim()} onPress={() => void addBulk()}>Add all</Button></XStack> : null}
    {form ? <QuickForm component={component} pkg={pkg} collection={collection} dispatch={dispatch} state={state} onDone={() => setForm(null)} record={form === 'new' ? undefined : form} /> : null}
    <Separator />
    {rows.length ? rows.map((record, index) => <XStack key={record.id} style={{ alignItems: 'center' }}><Button
      flex={1} chromeless onPress={() => setForm(record)}
      style={{ marginVertical: 4, paddingVertical: 8, borderRadius: 8, backgroundColor: '$backgroundSoft' }}>
      <YStack flex={1}>
        <Text fontWeight="700">{toRowLabel(record, component)}</Text>
        <Text color="$color10">{toSubtitle(record, component)}</Text>
      </YStack>
    </Button>
      {manualField ? <><Button circular chromeless icon={ArrowUp} disabled={!index} onPress={() => void move(record, -1)} aria-label="Move up" /><Button circular chromeless icon={ArrowDown} disabled={index === rows.length - 1} onPress={() => void move(record, 1)} aria-label="Move down" /></> : null}
      {component.props?.confirmDelete ? pendingDelete === record.id
        ? <><Button size="$2" theme="red" onPress={() => { void dispatch({ kind: 'delete', recordId: record.id }); setPendingDelete(''); }}>Delete</Button><Button size="$2" onPress={() => setPendingDelete('')}>Cancel</Button></>
        : <Button circular chromeless icon={Trash2} onPress={() => setPendingDelete(record.id)} aria-label={`Delete ${toRowLabel(record, component)}`} /> : null}
    </XStack>) : <Paragraph color="$color10">No rows</Paragraph>}
  </Panel>;
}

function BoardSurface({ component, collection, records, dispatch, pkg }: { component: AppComponent; collection: string; records: JsonRecord[]; dispatch: Runtime['dispatch']; pkg: AppPackage }) {
  const config = resolveBoardConfig(component, pkg, collection);

  const base = asList(component.props?.boardColumns).map((item) => toText(item));
  const columns = (base.length ? base : config.columns).map((value) => ({ value, key: value }));
  const rows = useMemo(() => {
    const map = new Map<string, JsonRecord[]>();
    const columnNames = columns.map((column) => column.value);
    const fallback = asTextField(component.props?.groupOtherLabel, 'Other');
    const all = [...columnNames, fallback];
    for (const column of all) map.set(column, []);
    for (const record of records) {
      const value = toText(record.values[config.field], asTextField(undefined, fallback));
      const bucket = columnNames.includes(value) ? value : fallback;
      map.set(bucket, [...(map.get(bucket) ?? []), record]);
    }
    return [...map.entries()] as const;
  }, [columns, config.field, records]);

  const move = (recordId: string, next: string) => void dispatch({ kind: 'update', recordId, values: { [config.field]: next } });

  return <Panel title={component.title}>
    <XStack gap="$2" style={{ flexWrap: 'wrap' }}>
      {rows.map(([column, items]) => <YStack key={column} width={220} gap="$2" style={{ padding: 8, borderWidth: 1, borderColor: '#D4D9D4', borderRadius: 8 }}>
        <XStack style={{ justifyContent: 'space-between' }}><Text fontWeight="700">{column}</Text><Text color="$color10">{items.length}</Text></XStack>
        {items.map((record) => <YStack key={record.id} gap="$1" style={{ padding: 8, borderRadius: 8, backgroundColor: '#fff' }}>
          <Text fontWeight="700">{toRowLabel(record, component)}</Text>
          <Text color="$color10" numberOfLines={2}>{toSubtitle(record, component)}</Text>
          {rows.length > 1 ? <XStack gap="$2" style={{ flexWrap: 'wrap' }}>{rows.map(([target]) => target !== column
            ? <Button size="$2" key={target} onPress={() => move(record.id, target)}>{target}</Button>
            : null)}</XStack> : null}
        </YStack>)}
      </YStack>)}
    </XStack>
  </Panel>;
}

function TimelineSurface({ component, records, state, dispatch }: { component: AppComponent; records: JsonRecord[]; state: AppState; dispatch: Runtime['dispatch'] }) {
  const dateField = asTextField(component.props?.dateField, 'updatedAt');
  const sorted = useMemo(() => filterSortRecords(records, {
    sortField: dateField,
    sortDirection: asTextField(component.props?.sortDirection, 'desc') === 'desc' ? 'desc' : 'asc',
  }), [records, dateField, component.props?.sortDirection]);

  const [index, setIndex] = useState(0);
  const selected = sorted[index];

  return <Panel title={component.title}>
    {state.undo?.length ? <Button size="$2" icon={Undo2} onPress={() => void dispatch({ kind: 'undo' })}>Undo</Button> : null}
    {selected ? <YStack gap="$2">
      <Text fontWeight="700">{toRowLabel(selected, component)}</Text>
      <Text color="$color10">{toDateValue(selected.values[dateField] ?? selected.updatedAt)}</Text>
      <Text>{toSubtitle(selected, component)}</Text>
    </YStack> : <Paragraph color="$color10">No items</Paragraph>}
    <YStack gap="$1">{sorted.map((record, itemIndex) => <XStack key={record.id} style={{ alignItems: 'center' }} gap="$2"><Text color="$color10" width={28}>{itemIndex + 1}</Text><Text>{toRowLabel(record, component)}</Text></XStack>)}</YStack>
    {sorted.length ? <XStack gap="$2">
      <Button size="$2" onPress={() => setIndex((value) => Math.max(0, value - 1))}>Up</Button>
      <Text>{index + 1}/{sorted.length}</Text>
      <Button size="$2" onPress={() => setIndex((value) => Math.min(sorted.length - 1, value + 1))}>Down</Button>
    </XStack> : null}
  </Panel>;
}

function HistorySurface({ component, state }: { component: AppComponent; state: AppState }) {
  const trail = useMemo(() => (state.undo ?? []).flatMap((snapshot, idx) =>
    snapshot.map((record, offset) => ({
      key: `${idx}-${record.id}-${offset}`,
      label: toRowLabel(record, component),
      id: record.id,
    })),
  ), [state.undo]);
  return <Panel title={component.title}>
    <YStack gap="$1">{trail.slice(0, 40).map((entry, index) => <XStack key={entry.key} gap="$2"><Text color="$color10" width={30}>{index + 1}.</Text><Text>{entry.label}</Text><Text color="$color10">({entry.id})</Text></XStack>)}</YStack>
    {!trail.length ? <Paragraph color="$color10">No undo history</Paragraph> : null}
  </Panel>;
}

function QuickAddSurface({ component, collection, records, dispatch }: { component: AppComponent; collection: string; records: JsonRecord[]; dispatch: Runtime['dispatch'] }) {
  const fields = asList(component.props?.quickAddFields).map((entry) => toText(entry));
  const fallback = toText(component.props?.titleField, 'title');
  const draftFields = fields.length ? fields : [fallback];
  const defaults = asObject(component.props?.defaultProperties);
  const [draft, setDraft] = useState<Record<string, string>>(() => ({}));

  const add = async () => {
    const values = {
      ...Object.fromEntries(Object.entries(defaults)),
      ...Object.fromEntries(Object.entries(draft).filter(([, value]) => toText(value))),
    };
    if (!Object.keys(values).length) return;
    await dispatch({ kind: 'create', collection, values });
    setDraft({});
  };

  return <Panel title={component.title}>
    <YStack gap="$2">{draftFields.map((field) => <Input key={field} placeholder={field} value={toText(draft[field])}
      onChangeText={(value) => setDraft((current) => ({ ...current, [field]: value }))} onSubmitEditing={() => void add()} />)}</YStack>
    <Button icon={Plus} onPress={() => void add()}>Quick add</Button>
    {records.length ? <YStack gap="$1"><Text fontWeight="700">Latest</Text>{records.slice(0, 6).map((record) => <Text key={record.id} color="$color10">• {toRowLabel(record, component)}</Text>)}</YStack> : null}
  </Panel>;
}

function ValueSurface({ component, records, collection, dispatch }: { component: AppComponent; collection: string; records: JsonRecord[]; dispatch: Runtime['dispatch'] }) {
  const valueField = toText(component.props?.valueField, 'value');
  const min = asNumber(component.props?.min, -Infinity);
  const max = asNumber(component.props?.max, Infinity);
  const step = asNumber(component.props?.step, 1);
  const candidate = records[0] ?? { id: `_${collection}_primary`, collection, values: asObject(component.props?.defaultProperties) } as JsonRecord;
  const current = asNumber(candidate?.values[valueField], asNumber(component.props?.defaultValue, 0));
  const set = async (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    await dispatch(candidate.id === records[0]?.id
      ? { kind: 'update', recordId: candidate.id, values: { [valueField]: clamped } }
      : { kind: 'create', collection, values: { ...candidate.values, [valueField]: clamped, title: toText(component.title, 'Value') } }
    );
  };

  return <Panel title={component.title}>
    <YStack gap="$3" style={{ alignItems: 'center' }}>
      <H2>{current} {toText(component.props?.unit)}</H2>
      <XStack gap="$2"><Button size="$2" onPress={() => void set(current - step)}>-</Button><Button size="$2" onPress={() => void set(current + step)}>+</Button><Button size="$2" icon={RotateCcw} onPress={() => void set(asNumber(component.props?.resetValue, 0))}>Reset</Button></XStack>
    </YStack>
  </Panel>;
}

function GroupedShelfSurface({ component, records }: { component: AppComponent; records: JsonRecord[] }) {
  const field = asTextField(component.props?.groupBy, asTextField(component.props?.groupField, 'status'));
  const groups = useMemo(() => {
    const map = new Map<string, JsonRecord[]>();
    for (const record of records) {
      const value = toText(record.values[field], 'Other');
      map.set(value, [...(map.get(value) ?? []), record]);
    }
    return [...map.entries()];
  }, [records, field]);

  const isHorizontal = Boolean(component.props?.horizontal);
  const list = groups.map(([group, items]) => <YStack key={group} width={isHorizontal ? 250 : undefined} gap="$2" style={{ padding: 8, borderWidth: 1, borderRadius: 8 }}>
    <XStack style={{ justifyContent: 'space-between' }}><Text fontWeight="700">{group}</Text><Text color="$color10">{items.length}</Text></XStack>
    {items.map((record) => <YStack key={record.id} style={{ padding: 8, borderRadius: 8, backgroundColor: '#fff' }}><Text fontWeight="700">{toRowLabel(record, component)}</Text><Text color="$color10" numberOfLines={2}>{toSubtitle(record, component)}</Text></YStack>)}
  </YStack>);

  return <Panel title={component.title}>
    {isHorizontal ? <ScrollView horizontal contentContainerStyle={{ gap: 12 }} >{list}</ScrollView> : <YStack gap="$2">{list}</YStack>}
    {!records.length ? <Paragraph color="$color10">No records</Paragraph> : null}
  </Panel>;
}

function CarouselSurface({ component, records }: { component: AppComponent; records: JsonRecord[] }) {
  const [index, setIndex] = useState(0);
  const selected = records[index];
  return <Panel title={component.title}>
    <ScrollView horizontal contentContainerStyle={{ gap: 12 }}>
      {records.map((record) => <YStack key={record.id} width={220} gap="$2" style={{ padding: 8, borderWidth: 1, borderRadius: 8 }}>
        <Text fontWeight="700">{toRowLabel(record, component)}</Text>
        <Text color="$color10" numberOfLines={2}>{toSubtitle(record, component) || '—'}</Text>
      </YStack>)}
    </ScrollView>
    {selected ? <XStack style={{ justifyContent: 'center', marginTop: 8 }} gap="$2"><Button size="$2" onPress={() => setIndex((value) => Math.max(0, value - 1))}>Prev</Button><Text>{index + 1}/{records.length}</Text><Button size="$2" onPress={() => setIndex((value) => Math.min(records.length - 1, value + 1))}>Next</Button></XStack> : null}
    {!records.length ? <Paragraph color="$color10">No items</Paragraph> : null}
  </Panel>;
}

function CalendarSurface({ component, records, collection, pkg }: { component: AppComponent; records: JsonRecord[]; collection: string; pkg: AppPackage }) {
  const dateField = asTextField(component.props?.dateField, Object.entries(pkg.collections[collection]?.fields ?? {}).find(([, field]) => field.type === 'timestamp')?.[0] ?? 'updatedAt');
  const buckets = useMemo(() => {
    const map = new Map<string, JsonRecord[]>();
    for (const record of records) {
      const day = toDateValue(record.values[dateField] ?? record.updatedAt).slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), record]);
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [records, dateField]);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    if (!buckets.length) {
      setSelected('');
      return;
    }
    if (!selected || !buckets.some(([day]) => day === selected)) {
      setSelected(buckets[0]?.[0] ?? '');
    }
  }, [buckets, selected]);

  return <Panel title={component.title}>
    {buckets.length ? <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{buckets.map(([day]) => <Button size="$2" key={day} theme={selected === day ? 'green' : undefined} onPress={() => setSelected(day)}>{day}</Button>)}</ScrollView> : null}
    {selected ? <YStack style={{ marginTop: 8 }} gap="$1">{buckets.find(([day]) => day === selected)?.[1].map((record) => <Text key={record.id} color="$color10">{toRowLabel(record, component)}</Text>)}</YStack> : <Paragraph color="$color10">No events</Paragraph>}
  </Panel>;
}

function fallbackCollectionError(component: AppComponent) {
  return <Panel title={component.title}><Paragraph color="$red10">Collection unavailable</Paragraph></Panel>;
}

export function RecordWidget({ component, pkg, runtime }: Props) {
  const store = useOptionalAppStore();
  const active = runtime ?? store;
  if (!active) throw new Error('RecordWidget runtime missing');
  const { dispatch, state } = active;

  const view = component.view ? pkg.views[component.view] : undefined;
  const viewQuery = view ? pkg.queries[view.query] : undefined;
  const collection = resolveCollection(component, pkg, viewQuery);
  if (!collection) return fallbackCollectionError(component);

  const raw = useMemo(() => queryRecords(
    { ...state, records: computedRecords(pkg, state) },
    component.query?.collections?.length ? component.query.collections : [collection],
    component.query?.match ?? '',
    component.query?.limit ?? viewQuery?.limit ?? 200,
    {
      where: viewQuery?.where,
      orderBy: (viewQuery?.orderBy ?? []) as Array<{ field: string; direction: SortDirection }> | undefined,
    },
  ), [component.query?.collections, component.query?.match, component.query?.limit, collection, state, viewQuery, dispatch]);

  if (component.widget === 'formCard' || component.widget === 'smartCapture') {
    return <Panel title={component.title}><QuickForm component={component} pkg={pkg} collection={collection} dispatch={dispatch} state={state} /></Panel>;
  }

  if (component.widget === 'recordHeroSummary') return <HeroSurface component={component} records={raw} />;
  if (component.widget === 'recordContentCard') return <DetailSurface component={component} records={raw} />;
  if (component.widget === 'recordReviewCard') return <DetailSurface component={component} records={raw} review />;
  if (component.widget === 'recordTimeline' || component.widget === 'timelineBlock') return <TimelineSurface component={component} records={raw} state={state} dispatch={dispatch} />;
  if (component.widget === 'operationHistory') return <HistorySurface component={component} state={state} />;
  if (component.widget === 'kanbanBoard') return <BoardSurface component={component} collection={collection} records={raw} dispatch={dispatch} pkg={pkg} />;
  if (component.widget === 'groupedRecordShelf') return <GroupedShelfSurface component={component} records={raw} />;
  if (component.widget === 'horizontalRecordCarousel') return <CarouselSurface component={component} records={raw} />;
  if (component.widget === 'quickAddList') return <QuickAddSurface component={component} collection={collection} dispatch={dispatch} records={raw} />;
  if (component.widget === 'valueControl') return <ValueSurface component={component} collection={collection} dispatch={dispatch} records={raw} />;
  if (component.widget === 'dataTable') return <ListSurface component={component} pkg={pkg} collection={collection} records={raw} dispatch={dispatch} state={state} />;
  if (component.widget === 'calendarBlock') return <CalendarSurface component={component} collection={collection} pkg={pkg} records={raw} />;

  return <ListSurface component={component} pkg={pkg} collection={collection} records={raw} dispatch={dispatch} state={state} />;
}
