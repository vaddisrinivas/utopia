import type { ComponentRenderProps } from "@json-render/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  archiveRecordForInstallation,
  getRecordForInstallation,
  upsertRecord,
} from "@/src/db/records";
import { useUtopiaDatabase } from "@/src/db/provider";
import { externalUrlResultMessage, validateExternalUrl } from "@/src/domain/external-url-broker";
import { useAppRuntime } from "@/src/domain/runtime-context";
import type { DomainRecordViewModel } from "@/src/domain/renderer";
import {
  normalizeInteractionCommandPolicy,
  saveOutcomeProjection,
  type InteractionCommandPolicyInput,
} from "@/src/presentation/interaction-command-policy";
import {
  moveRecordPosition,
  nextRecordPosition,
} from "@/src/presentation/widgets/ordered-record-engine";
import {
  structuredListBulkTitles,
  structuredListCoerceValues,
  structuredListFieldValues,
  structuredListFilterFields,
  structuredListInitialValues,
  structuredListMatchesFilters,
  structuredListMetadataFields,
  structuredListMissingRequiredFields,
  structuredListReplaceMetadata,
  structuredListSortRecords,
  structuredListSorts,
  structuredListSuggestions,
  type StructuredListMetadataField,
} from "@/src/presentation/widgets/structured-list-config";
import { openExternalUrl } from "@/src/platform/external-url-platform";
import { text, type WidgetProps } from "@/src/presentation/widgets/widget-sdk";
import { recallInteractionStatus, rememberInteractionStatus } from "@/src/presentation/widgets/interaction-status-memory";

function runtimeOnline(): boolean {
  return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" || navigator.onLine;
}

export function StructuredListWidget({ element }: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const records = Array.isArray(props.records) ? (props.records as DomainRecordViewModel[]) : [];
  const collection = text(props.collection);
  const positionField = text(props.positionField, "position");
  const pickedField = text(props.pickedField, text(props.checkedField));
  const plain = text(props.appearance) === "plain";
  const progressiveDisclosure = props.progressiveDisclosure === true;
  const editable = props.editable !== false;
  const deletable = props.deletable !== false;
  const commandPolicy = useMemo(
    () => normalizeInteractionCommandPolicy(
      props.commandPolicy && typeof props.commandPolicy === "object"
        ? props.commandPolicy as InteractionCommandPolicyInput
        : { autosave: props.autoSaveEdits === true ? "change" : "manual" },
    ),
    [props.autoSaveEdits, props.commandPolicy],
  );
  const autoSaveEdits = commandPolicy.autosave !== "manual";
  const primaryActionLabel = text(props.primaryActionLabel, "Add");
  const offlineSaveLabel = stateVariantLabel(props.stateVariants, "offline");
  const fields = useMemo(() => structuredListMetadataFields(props.metadataFields), [props.metadataFields]);
  const recordTitleField = fields.find((field) => field.field === "title");
  const secondaryFields = useMemo(() => fields.filter((field) => field.field !== "title"), [fields]);
  const sorts = useMemo(() => structuredListSorts(props.sorts, fields, positionField), [fields, positionField, props.sorts]);
  const filterFields = useMemo(() => structuredListFilterFields(props.filterFields, fields), [fields, props.filterFields]);
  const suggestions = useMemo(() => structuredListSuggestions(props.suggestions), [props.suggestions]);
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const statusKey = `structured-list:${runtime.installationId ?? "uninstalled"}:${collection || "unknown"}`;
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() => structuredListInitialValues(fields));
  const [bulkText, setBulkText] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortId, setSortId] = useState(sorts[0]?.id ?? "alphabetic");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const editTitleRef = useRef("");
  const editValuesRef = useRef<Record<string, string>>({});
  const [editDirty, setEditDirty] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pickedOverrides, setPickedOverrides] = useState<Record<string, boolean>>({});
  const [positionOverrides, setPositionOverrides] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setLocalMessage] = useState(() => recallInteractionStatus(statusKey));
  const setMessage = useCallback((next: string) => {
    rememberInteractionStatus(statusKey, next);
    setLocalMessage(next);
  }, [statusKey]);
  const activeSort = sorts.find((sort) => sort.id === sortId) ?? sorts[0] ?? { id: "alphabetic", label: "A-Z", kind: "alphabetic" as const, direction: "asc" as const };
  const canManuallyReorder = activeSort.kind === "manual" && !search.trim() && !Object.values(filters).some(Boolean);
  const displayRecords = useMemo(
    () => records.map((record) => positionOverrides[record.id] === undefined ? record : {
      ...record,
      properties: { ...record.properties, [positionField]: positionOverrides[record.id] },
    }),
    [positionField, positionOverrides, records],
  );
  const visibleRecords = useMemo(
    () => structuredListSortRecords(
      displayRecords.filter((record) => structuredListMatchesFilters(record, search, filters)),
      activeSort,
      positionField,
    ),
    [activeSort, displayRecords, filters, positionField, search],
  );
  const allManualRecords = useMemo(
    () => structuredListSortRecords(displayRecords, { id: "manual", label: "Manual", kind: "manual", direction: "asc" }, positionField),
    [displayRecords, positionField],
  );

  useEffect(() => {
    setPositionOverrides((current) => {
      const pending = Object.fromEntries(Object.entries(current).filter(([id, position]) => {
        const canonical = records.find((record) => record.id === id);
        return !canonical || Number(canonical.properties[positionField]) !== position;
      }));
      return Object.keys(pending).length === Object.keys(current).length ? current : pending;
    });
  }, [positionField, records]);

  const store = useCallback(async (recordTitle: string, rawValues: Readonly<Record<string, unknown>>) => {
    if (!db || !runtime.activeManifest || !runtime.installationId || !collection) throw new Error("List storage is not ready.");
    const outcome = saveOutcomeProjection(commandPolicy, { online: runtimeOnline() });
    if (!outcome.canExecute) throw new Error(outcome.message);
    const cleanTitle = recordTitle.trim();
    if (!cleanTitle) throw new Error("Enter an item name.");
    const canonicalValues = fields.some((field) => field.field === "title")
      ? { ...rawValues, title: cleanTitle }
      : rawValues;
    const missing = structuredListMissingRequiredFields(canonicalValues, fields);
    if (missing.length) throw new Error(`Enter ${missing.map((field) => field.label).join(", ")}.`);
    const now = new Date().toISOString();
    const idBase = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
    const id = `${collection}-${idBase}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await upsertRecord(db, runtime.activeManifest, {
      id,
      collection,
      title: cleanTitle,
      properties: {
        [positionField]: nextRecordPosition(allManualRecords.map((record) => record.properties[positionField])),
        ...(pickedField ? { [pickedField]: false } : {}),
        ...structuredListCoerceValues(canonicalValues, fields),
      },
      relations: [],
      source: { provider: "user", external_id: id, url: null, observed_at: now, content_hash: null },
      archived_at: null,
      created_at: now,
      updated_at: now,
      operation_actor: "user",
      operation_origin: "manual",
      operation_id: `op-structured-add-${id}`,
      idempotency_key: `structured-add:${runtime.installationId}:${id}`,
      app_installation_id: runtime.installationId,
    });
    return outcome;
  }, [allManualRecords, collection, commandPolicy, db, fields, pickedField, positionField, runtime.activeManifest, runtime.installationId]);

  const add = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      const outcome = await store(title, values);
      setTitle("");
      setValues(structuredListInitialValues(fields));
      setMessage(outcome.status === "queued" ? text(offlineSaveLabel, outcome.message) : outcome.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add this item.");
    } finally {
      setBusy(false);
    }
  }, [fields, offlineSaveLabel, store, title, values]);

  const addBulk = useCallback(async () => {
    const titles = structuredListBulkTitles(bulkText);
    if (!titles.length) {
      setMessage("Enter one item per line.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      for (const item of titles) await store(item, values);
      setBulkText("");
      setMessage(`Added ${titles.length} item${titles.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add these items.");
    } finally {
      setBusy(false);
    }
  }, [bulkText, store, values]);

  const addSuggestion = useCallback(async (suggestion: { title: string; values: Readonly<Record<string, unknown>> }) => {
    setBusy(true);
    setMessage("");
    try {
      await store(suggestion.title, suggestion.values);
      setMessage(`Added ${suggestion.title}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add this suggestion.");
    } finally {
      setBusy(false);
    }
  }, [store]);

  const update = useCallback(async (record: DomainRecordViewModel, recordTitle: string, rawValues: Readonly<Record<string, unknown>>) => {
    if (!db || !runtime.activeManifest || !runtime.installationId) throw new Error("List storage is not ready.");
    const outcome = saveOutcomeProjection(commandPolicy, { online: runtimeOnline() });
    if (!outcome.canExecute) throw new Error(outcome.message);
    const cleanTitle = recordTitle.trim();
    if (!cleanTitle) throw new Error("Enter an item name.");
    const canonicalValues = fields.some((field) => field.field === "title")
      ? { ...rawValues, title: cleanTitle }
      : rawValues;
    const missing = structuredListMissingRequiredFields(canonicalValues, fields);
    if (missing.length) throw new Error(`Enter ${missing.map((field) => field.label).join(", ")}.`);
    const canonical = await getRecordForInstallation(db, runtime.installationId, record.id);
    if (!canonical) throw new Error("This item no longer exists.");
    const now = new Date().toISOString();
    await upsertRecord(db, runtime.activeManifest, {
      id: canonical.id,
      collection: canonical.collection,
      title: cleanTitle,
      properties: structuredListReplaceMetadata(canonical.properties, canonicalValues, fields),
      relations: canonical.relations.map(({ name, target_id }) => ({ name, target_id })),
      source: canonical.source,
      archived_at: canonical.archived_at,
      created_at: canonical.created_at,
      updated_at: now,
      operation_actor: "user",
      operation_origin: "manual",
      operation_id: `op-structured-edit-${canonical.id}-${Date.now().toString(36)}`,
      idempotency_key: `structured-edit:${runtime.installationId}:${canonical.id}:${now}`,
      app_installation_id: runtime.installationId,
    });
    return outcome;
  }, [commandPolicy, db, fields, runtime.activeManifest, runtime.installationId]);

  const saveEdit = useCallback(async (record: DomainRecordViewModel, closeEditor = true) => {
    setBusy(true);
    setMessage("");
    try {
      const outcome = await update(record, editTitleRef.current, editValuesRef.current);
      if (closeEditor) setEditingId(null);
      setEditDirty(false);
      setMessage(outcome.status === "queued" ? text(offlineSaveLabel, outcome.message) : outcome.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this item.");
    } finally {
      setBusy(false);
    }
  }, [offlineSaveLabel, update]);

  useEffect(() => {
    if (!autoSaveEdits || !editDirty || !editingId) return;
    const record = records.find((candidate) => candidate.id === editingId);
    if (!record) return;
    const timeout = setTimeout(() => {
      void saveEdit(record, false);
    }, 350);
    return () => clearTimeout(timeout);
  }, [autoSaveEdits, editDirty, editingId, records, saveEdit]);

  const togglePicked = useCallback(async (record: DomainRecordViewModel) => {
    if (!pickedField || !db || !runtime.activeManifest || !runtime.installationId) return;
    setBusy(true);
    setMessage("");
    try {
      const canonical = await getRecordForInstallation(db, runtime.installationId, record.id);
      if (!canonical) throw new Error("This item no longer exists.");
      const now = new Date().toISOString();
      await upsertRecord(db, runtime.activeManifest, {
        id: canonical.id,
        collection: canonical.collection,
        title: canonical.title,
        properties: { ...canonical.properties, [pickedField]: !isPicked(canonical.properties[pickedField]) },
        relations: canonical.relations.map(({ name, target_id }) => ({ name, target_id })),
        source: canonical.source,
        archived_at: canonical.archived_at,
        created_at: canonical.created_at,
        updated_at: now,
        operation_actor: "user",
        operation_origin: "manual",
        operation_id: `op-structured-picked-${canonical.id}-${Date.now().toString(36)}`,
        idempotency_key: `structured-picked:${runtime.installationId}:${canonical.id}:${now}`,
        app_installation_id: runtime.installationId,
      });
      setPickedOverrides((current) => ({
        ...current,
        [canonical.id]: !isPicked(canonical.properties[pickedField]),
      }));
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this item.");
    } finally {
      setBusy(false);
    }
  }, [db, pickedField, runtime.activeManifest, runtime.installationId]);

  const move = useCallback(async (recordId: string, direction: "up" | "down") => {
    if (!db || !runtime.activeManifest || !runtime.installationId || !canManuallyReorder) return;
    const positions = moveRecordPosition(allManualRecords.map((record) => record.id), recordId, direction);
    const changed = positions.filter(({ id, position }) => allManualRecords[position]?.id !== id);
    if (!changed.length) return;
    setBusy(true);
    setMessage("");
    try {
      for (const item of changed) {
        const canonical = await getRecordForInstallation(db, runtime.installationId, item.id);
        if (!canonical) throw new Error("This item no longer exists.");
        const now = new Date().toISOString();
        await upsertRecord(db, runtime.activeManifest, {
          id: canonical.id,
          collection: canonical.collection,
          title: canonical.title,
          properties: { ...canonical.properties, [positionField]: item.position },
          relations: canonical.relations.map(({ name, target_id }) => ({ name, target_id })),
          source: canonical.source,
          archived_at: canonical.archived_at,
          created_at: canonical.created_at,
          updated_at: now,
          operation_actor: "user",
          operation_origin: "manual",
          operation_id: `op-structured-order-${canonical.id}-${Date.now().toString(36)}`,
          idempotency_key: `structured-order:${runtime.installationId}:${canonical.id}:${item.position}:${now}`,
          app_installation_id: runtime.installationId,
        });
      }
      setPositionOverrides(Object.fromEntries(positions.map(({ id, position }) => [id, position])));
      setMessage("Order saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reorder this list.");
    } finally {
      setBusy(false);
    }
  }, [allManualRecords, canManuallyReorder, db, positionField, runtime.activeManifest, runtime.installationId]);

  const remove = useCallback(async (record: DomainRecordViewModel) => {
    if (!db || !runtime.installationId) return;
    setBusy(true);
    setMessage("");
    try {
      await archiveRecordForInstallation(db, runtime.installationId, record.id);
      setConfirmingDeleteId(null);
      setEditingId(null);
      setMessage("Deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete this item.");
    } finally {
      setBusy(false);
    }
  }, [db, runtime.installationId]);

  return (
    <View style={[styles.card, plain ? styles.cardPlain : null]}>
      <Text style={styles.heading}>{text(props.title, "Structured list")}</Text>
      {props.subtitle ? <Text style={styles.subtitle}>{text(props.subtitle)}</Text> : null}
      <TextInput accessibilityLabel={text(props.inputLabel, recordTitleField?.label ?? "New item")} editable={!busy} placeholder={text(props.placeholder, "Add an item")} placeholderTextColor="#746A5E" returnKeyType="done" style={styles.input} value={title} onChangeText={setTitle} onSubmitEditing={() => void add()} />
      {!progressiveDisclosure || showAdvanced ? <MetadataFields fields={secondaryFields} values={values} disabled={busy} onChange={setValues} /> : null}
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={primaryActionLabel} disabled={busy} style={styles.primaryButton} onPress={() => void add()}><Text style={styles.primaryText}>{primaryActionLabel}</Text></Pressable>
        {progressiveDisclosure ? <Pressable accessibilityRole="button" accessibilityLabel="Toggle list options" accessibilityState={{ expanded: showAdvanced }} disabled={busy} style={styles.secondaryButton} onPress={() => setShowAdvanced((current) => !current)}><Text style={styles.secondaryText}>{showAdvanced ? "Hide options" : "Options"}</Text></Pressable> : null}
        {!progressiveDisclosure || showAdvanced ? <Pressable accessibilityRole="button" accessibilityLabel="Toggle bulk add" disabled={busy} style={styles.secondaryButton} onPress={() => setShowBulk((current) => !current)}><Text style={styles.secondaryText}>Bulk add</Text></Pressable> : null}
      </View>
      {(!progressiveDisclosure || showAdvanced) && showBulk ? <View style={styles.bulkPanel}><TextInput accessibilityLabel="Bulk add items" editable={!busy} multiline placeholder="One item per line" placeholderTextColor="#746A5E" style={[styles.input, styles.bulkInput]} value={bulkText} onChangeText={setBulkText} /><Pressable accessibilityRole="button" accessibilityLabel="Add bulk items" disabled={busy} style={styles.primaryButton} onPress={() => void addBulk()}><Text style={styles.primaryText}>Add lines</Text></Pressable></View> : null}
      {suggestions.length ? <View style={styles.suggestions}><Text style={styles.sectionLabel}>Saved suggestions</Text><View style={styles.chipRow}>{suggestions.map((suggestion) => <Pressable key={suggestion.title} accessibilityRole="button" accessibilityLabel={`Add ${suggestion.title}`} disabled={busy} style={styles.chip} onPress={() => void addSuggestion(suggestion)}><Text style={styles.chipText}>{suggestion.title}</Text></Pressable>)}</View></View> : null}
      {!progressiveDisclosure || showAdvanced ? <TextInput accessibilityLabel="Filter list" editable={!busy} placeholder="Filter items" placeholderTextColor="#746A5E" style={styles.input} value={search} onChangeText={setSearch} /> : null}
      {(!progressiveDisclosure || showAdvanced) && sorts.length > 1 ? <View style={styles.controls}><Text style={styles.sectionLabel}>Sort</Text><View style={styles.chipRow}>{sorts.map((sort) => <Pressable key={sort.id} accessibilityRole="button" accessibilityState={{ selected: activeSort.id === sort.id }} disabled={busy} style={[styles.chip, activeSort.id === sort.id ? styles.chipSelected : null]} onPress={() => setSortId(sort.id)}><Text style={[styles.chipText, activeSort.id === sort.id ? styles.chipTextSelected : null]}>{sort.label}</Text></Pressable>)}</View></View> : null}
      {!progressiveDisclosure || showAdvanced ? filterFields.map((field) => <FilterControl key={field.field} field={field} records={records} value={filters[field.field] ?? ""} disabled={busy} onChange={(value) => setFilters((current) => ({ ...current, [field.field]: value }))} />) : null}
      {visibleRecords.map((record, index) => {
        const isEditing = editingId === record.id;
        const picked = pickedField
          ? pickedOverrides[record.id] ?? isPicked(record.properties[pickedField])
          : false;
        return <View key={record.id} style={styles.item}>
          {isEditing ? <View style={styles.editPanel}><TextInput accessibilityLabel={`Edit ${record.title} name`} editable={!busy} style={styles.input} value={editTitle} onChangeText={(value) => { editTitleRef.current = value; setEditTitle(value); setEditDirty(true); }} /><MetadataFields fields={secondaryFields} values={editValues} disabled={busy} prefix={`Edit ${record.title}`} onChange={(value) => { editValuesRef.current = value; setEditValues(value); setEditDirty(true); }} /><View style={styles.actionRow}><Pressable accessibilityRole="button" accessibilityLabel={autoSaveEdits ? `Done editing ${record.title}` : `Save ${record.title}`} disabled={busy} style={styles.primaryButton} onPress={() => void saveEdit(record)}><Text style={styles.primaryText}>{autoSaveEdits ? "Done" : "Save"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Cancel editing ${record.title}`} disabled={busy} style={styles.secondaryButton} onPress={() => setEditingId(null)}><Text style={styles.secondaryText}>Cancel</Text></Pressable></View></View> : <><View style={styles.itemHeader}>{pickedField ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`Mark ${record.title} ${text(props.pickedLabel, "picked")}`} accessibilityState={{ checked: picked, disabled: busy }} aria-checked={picked} disabled={busy} style={[styles.checkbox, picked ? styles.checkboxPicked : null]} onPress={() => void togglePicked(record)}><Text style={styles.checkboxMark}>{picked ? "✓" : ""}</Text></Pressable> : null}<View style={styles.itemCopy}><Text style={[styles.itemTitle, picked ? styles.itemTitlePicked : null]}>{record.title}</Text><MetadataSummary record={record} fields={fields} /></View></View><View style={styles.actionRow}>{canManuallyReorder ? <><Pressable accessibilityRole="button" accessibilityLabel={`Move ${record.title} up`} disabled={busy || index === 0} style={styles.secondaryButton} onPress={() => void move(record.id, "up")}><Text style={styles.secondaryText}>Up</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Move ${record.title} down`} disabled={busy || index === visibleRecords.length - 1} style={styles.secondaryButton} onPress={() => void move(record.id, "down")}><Text style={styles.secondaryText}>Down</Text></Pressable></> : null}{editable ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${record.title}`} disabled={busy} style={styles.secondaryButton} onPress={() => { const nextValues = Object.fromEntries(fields.map((field) => [field.field, String(record.properties[field.field] ?? "")])); editTitleRef.current = record.title; editValuesRef.current = nextValues; setEditingId(record.id); setEditTitle(record.title); setEditDirty(false); setEditValues(nextValues); }}><Text style={styles.secondaryText}>Edit</Text></Pressable> : null}{deletable ? confirmingDeleteId === record.id ? <View accessibilityRole="alert" style={styles.confirm}><Text style={styles.confirmText}>Delete?</Text><Pressable accessibilityRole="button" accessibilityLabel={`Confirm delete ${record.title}`} disabled={busy} style={styles.deleteButton} onPress={() => void remove(record)}><Text style={styles.deleteText}>Delete</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Cancel deleting ${record.title}`} disabled={busy} style={styles.secondaryButton} onPress={() => setConfirmingDeleteId(null)}><Text style={styles.secondaryText}>Cancel</Text></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${record.title}`} disabled={busy} style={styles.deleteButton} onPress={() => setConfirmingDeleteId(record.id)}><Text style={styles.deleteText}>Delete</Text></Pressable> : null}</View></>}</View>;
      })}
      {!visibleRecords.length ? <Text style={styles.empty}>{text(props.emptyText, "No items match this list.")}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

function stateVariantLabel(value: unknown, state: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = (value as Record<string, unknown>)[state];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return "";
  return text((candidate as Record<string, unknown>).label);
}

function MetadataFields({ fields, values, disabled, prefix = "", onChange }: { fields: readonly StructuredListMetadataField[]; values: Readonly<Record<string, string>>; disabled: boolean; prefix?: string; onChange: (next: Record<string, string>) => void }) {
  return <>{fields.filter((field) => !field.readOnly).map((field) => field.type === "select" ? <View key={field.field} style={styles.metadataGroup}><Text style={styles.metadataLabel}>{field.label}{field.required ? " *" : ""}</Text><View style={styles.chipRow}>{field.options.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`${prefix ? `${prefix} ` : ""}${field.label}: ${option}`} accessibilityState={{ selected: values[field.field] === option }} disabled={disabled} style={[styles.chip, values[field.field] === option ? styles.chipSelected : null]} onPress={() => onChange({ ...values, [field.field]: option })}><Text style={[styles.chipText, values[field.field] === option ? styles.chipTextSelected : null]}>{option}</Text></Pressable>)}</View></View> : <TextInput key={field.field} accessibilityLabel={`${prefix ? `${prefix} ` : ""}${field.label}`} editable={!disabled} keyboardType={field.type === "number" ? "decimal-pad" : field.type === "url" ? "url" : "default"} placeholder={field.required ? `${field.label} *` : field.label} placeholderTextColor="#746A5E" style={styles.input} value={values[field.field] ?? ""} onChangeText={(value) => onChange({ ...values, [field.field]: value })} />)}</>;
}

function FilterControl({ field, records, value, disabled, onChange }: { field: StructuredListMetadataField; records: readonly DomainRecordViewModel[]; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const values = structuredListFieldValues(records, field);
  if (!values.length) return null;
  return <View style={styles.controls}><Text style={styles.sectionLabel}>{field.label}</Text><View style={styles.chipRow}><Pressable accessibilityRole="button" accessibilityState={{ selected: !value }} disabled={disabled} style={[styles.chip, !value ? styles.chipSelected : null]} onPress={() => onChange("")}><Text style={[styles.chipText, !value ? styles.chipTextSelected : null]}>All</Text></Pressable>{values.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: value === option }} disabled={disabled} style={[styles.chip, value === option ? styles.chipSelected : null]} onPress={() => onChange(option)}><Text style={[styles.chipText, value === option ? styles.chipTextSelected : null]}>{option}</Text></Pressable>)}</View></View>;
}

function MetadataSummary({ record, fields }: { record: DomainRecordViewModel; fields: readonly StructuredListMetadataField[] }) {
  const [message, setMessage] = useState("");
  const openUrl = useCallback(async (value: string) => {
    const result = await openExternalUrl(value);
    setMessage(externalUrlResultMessage(result));
  }, []);
  const items = fields.flatMap((field) => {
    const value = record.properties[field.field];
    const formatted = structuredListDisplayValue(value);
    return formatted ? [{ field, value: formatted }] : [];
  });
  return items.length ? <View style={styles.metadataRows}>{items.map(({ field, value }) => field.type === "url" && validateExternalUrl(value) ? <Pressable key={field.field} accessibilityRole="link" accessibilityLabel={`Open ${field.label}`} onPress={() => void openUrl(value)}><Text style={styles.url}>{field.label}: {value}</Text></Pressable> : <Text key={field.field} style={styles.metadata}>{field.label}: {value}</Text>)}{message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}</View> : null;
}

function structuredListDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const instant = (value as Record<string, unknown>).instant;
    if (typeof instant === "string" && instant.trim()) return instant.trim();
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return Array.isArray(value) ? value.map(structuredListDisplayValue).filter(Boolean).join(", ") : "";
}

function isPicked(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#F8FAFC", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, gap: 12, padding: 16 },
  cardPlain: { backgroundColor: "transparent", borderRadius: 0, paddingHorizontal: 0 },
  heading: { color: "#0F172A", fontSize: 20, fontWeight: "800", lineHeight: 26 },
  subtitle: { color: "#475569", fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: "#FFFFFF", borderColor: "#CBD5E1", borderRadius: 8, borderWidth: 1, color: "#0F172A", minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  bulkInput: { minHeight: 96, textAlignVertical: "top" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryButton: { alignItems: "center", backgroundColor: "#166534", borderRadius: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  secondaryButton: { alignItems: "center", borderColor: "#CBD5E1", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  secondaryText: { color: "#334155", fontSize: 12, fontWeight: "800" },
  deleteButton: { alignItems: "center", backgroundColor: "#B42318", borderRadius: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
  deleteText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  bulkPanel: { gap: 8 },
  suggestions: { gap: 6 },
  controls: { gap: 6 },
  sectionLabel: { color: "#475569", fontSize: 12, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderColor: "#CBD5E1", borderRadius: 8, borderWidth: 1, minHeight: 40, justifyContent: "center", paddingHorizontal: 11 },
  chipSelected: { backgroundColor: "#166534", borderColor: "#166534" },
  chipText: { color: "#334155", fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: "#FFFFFF" },
  metadataGroup: { gap: 6 },
  metadataLabel: { color: "#475569", fontSize: 12, fontWeight: "800" },
  item: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  itemHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  itemCopy: { flex: 1, gap: 2 },
  itemTitle: { color: "#0F172A", fontSize: 16, fontWeight: "800", lineHeight: 22 },
  itemTitlePicked: { color: "#64748B", textDecorationLine: "line-through" },
  metadata: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  metadataRows: { gap: 3 },
  url: { color: "#1F5F8B", fontSize: 12, textDecorationLine: "underline" },
  checkbox: { alignItems: "center", borderColor: "#64748B", borderRadius: 4, borderWidth: 2, height: 28, justifyContent: "center", width: 28 },
  checkboxPicked: { backgroundColor: "#166534", borderColor: "#166534" },
  checkboxMark: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  editPanel: { gap: 8 },
  confirm: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  confirmText: { color: "#B42318", fontSize: 12, fontWeight: "800" },
  empty: { color: "#64748B", fontSize: 13, paddingVertical: 20, textAlign: "center" },
  message: { color: "#166534", fontSize: 12, fontWeight: "800" },
});
