import type { ComponentRenderProps } from "@json-render/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  archiveRecordForInstallation,
  getRecordForInstallation,
  upsertRecord,
} from "@/src/db/records";
import { useUtopiaDatabase } from "@/src/db/provider";
import { useAppRuntime } from "@/src/domain/runtime-context";
import type { DomainRecordViewModel } from "@/src/domain/renderer";
import {
  checklistChecked,
  toggleChecklistChecked,
} from "@/src/presentation/widgets/checklist-state";
import {
  moveRecordPosition,
  nextRecordPosition,
} from "@/src/presentation/widgets/ordered-record-engine";
import { formatLocalizedText } from "@/src/presentation/package-localization";
import {
  normalizeInteractionCommandPolicy,
  type InteractionCommandPolicyInput,
} from "@/src/presentation/interaction-command-policy";
import { text, type WidgetProps } from "@/src/presentation/widgets/widget-sdk";

export function QuickAddListWidget({
  element,
}: ComponentRenderProps<WidgetProps>) {
  const props = element.props ?? {};
  const records = Array.isArray(props.records)
    ? (props.records as DomainRecordViewModel[])
    : [];
  const collection = text(props.collection);
  const positionField = text(props.positionField, "position");
  const checkedField = text(props.checkedField);
  const reorderable = props.reorderable !== false;
  const editable = props.editable === true;
  const deletable = props.deletable === true;
  const commandPolicy = useMemo(
    () => normalizeInteractionCommandPolicy(
      props.commandPolicy && typeof props.commandPolicy === "object"
        ? props.commandPolicy as InteractionCommandPolicyInput
        : { autosave: props.autoSaveEdits === true ? "change" : "manual" },
    ),
    [props.autoSaveEdits, props.commandPolicy],
  );
  const autoSaveEdits = commandPolicy.autosave !== "manual";
  const plain = text(props.appearance) === "plain";
  const noteField = text(props.noteField);
  const valueField = text(props.valueField);
  const titleField = text(props.titleField);
  const presetLabelField = text(props.presetLabelField);
  const presetValueField = text(props.presetValueField);
  const quickAdds = [
    ...presetValues(props.quickAdds),
    ...recordPresetValues(
      records,
      presetLabelField,
      presetValueField,
      propertyValues(props.presetProperties),
    ),
  ];
  const defaultProperties = propertyValues(props.defaultProperties);
  const showManualEntry = props.showManualEntry !== false;
  const showRecords = props.showRecords !== false;
  const copy = copyValues(props.copy);
  const db = useUtopiaDatabase();
  const runtime = useAppRuntime();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDirty, setEditDirty] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const ordered = useMemo(
    () =>
      [...records].sort(
        (left, right) =>
          numeric(left.properties[positionField]) -
          numeric(right.properties[positionField]),
      ),
    [positionField, records],
  );

  const store = useCallback(async (recordTitle: string, extraProperties: Record<string, unknown> = {}) => {
    const cleanTitle = recordTitle.trim();
    if (
      !cleanTitle ||
      !db ||
      !runtime.activeManifest ||
      !runtime.installationId ||
      !collection
    ) {
      setMessage(
        cleanTitle
          ? copyText(copy, "storageNotReady", "List storage is not ready.")
          : copyText(copy, "enterItem", "Enter an item name."),
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const now = new Date().toISOString();
      const safe =
        cleanTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || "item";
      const id = `${collection}-${safe}-${Date.now().toString(36)}`;
      await upsertRecord(db, runtime.activeManifest, {
        id,
        collection,
        title: cleanTitle,
        properties: {
          ...resolveDynamicProperties(defaultProperties, now),
          ...extraProperties,
          [positionField]: nextRecordPosition(
            ordered.map((record) => record.properties[positionField]),
          ),
          ...(checkedField ? { [checkedField]: false } : {}),
        },
        relations: [],
        source: {
          provider: "user",
          external_id: id,
          url: null,
          observed_at: now,
          content_hash: null,
        },
        archived_at: null,
        created_at: now,
        updated_at: now,
        operation_actor: "user",
        operation_origin: "manual",
        operation_id: `op-add-${id}`,
        idempotency_key: `quick-add:${runtime.installationId}:${id}`,
        app_installation_id: runtime.installationId,
      });
      setMessage(copyText(copy, "added", "Added."));
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : copyText(copy, "couldNotAdd", "Could not add this item."),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    checkedField,
    collection,
    db,
    defaultProperties,
    ordered,
    positionField,
    runtime.activeManifest,
    runtime.installationId,
    copy,
  ]);

  const add = useCallback(async () => {
    if (await store(title)) setTitle("");
  }, [store, title]);

  const addPreset = useCallback(async (preset: QuickAddPreset) => {
    await store(preset.label, {
      ...(titleField ? { [titleField]: preset.label } : {}),
      ...(valueField ? { [valueField]: preset.value } : {}),
      ...preset.properties,
    });
  }, [store, titleField, valueField]);

  const toggle = useCallback(
    async (record: DomainRecordViewModel) => {
      if (
        !checkedField ||
        !db ||
        !runtime.activeManifest ||
        !runtime.installationId
      )
        return;
      setBusy(true);
      setMessage("");
      try {
        const canonical = await getRecordForInstallation(
          db,
          runtime.installationId,
          record.id,
        );
        if (!canonical) {
          throw new Error(copyText(copy, "missingItem", "A list item no longer exists."));
        }
        const now = new Date().toISOString();
        await upsertRecord(db, runtime.activeManifest, {
          id: canonical.id,
          collection: canonical.collection,
          title: canonical.title,
          properties: {
            ...canonical.properties,
            [checkedField]: toggleChecklistChecked(
              canonical.properties[checkedField],
            ),
          },
          relations: canonical.relations.map(({ name, target_id }) => ({
            name,
            target_id,
          })),
          source: canonical.source,
          archived_at: canonical.archived_at,
          created_at: canonical.created_at,
          updated_at: now,
          operation_actor: "user",
          operation_origin: "manual",
          operation_id: `op-check-${canonical.id}-${Date.now().toString(36)}`,
          idempotency_key: `quick-check:${runtime.installationId}:${canonical.id}:${checkedField}:${now}`,
          app_installation_id: runtime.installationId,
        });
        setMessage(copyText(copy, "saved", "Saved."));
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : copyText(copy, "couldNotUpdate", "Could not update this item."),
        );
      } finally {
        setBusy(false);
      }
    },
    [checkedField, copy, db, runtime.activeManifest, runtime.installationId],
  );

  const move = useCallback(
    async (recordId: string, direction: "up" | "down") => {
      if (!db || !runtime.activeManifest || !runtime.installationId) return;
      const positions = moveRecordPosition(
        ordered.map((record) => record.id),
        recordId,
        direction,
      );
      const changed = positions.filter(
        ({ id, position }) => ordered[position]?.id !== id,
      );
      if (!changed.length) return;
      setBusy(true);
      setMessage("");
      try {
        for (const item of changed) {
          const canonical = await getRecordForInstallation(
            db,
            runtime.installationId,
            item.id,
          );
          if (!canonical) {
            throw new Error(copyText(copy, "missingItem", "A list item no longer exists."));
          }
          const now = new Date().toISOString();
          await upsertRecord(db, runtime.activeManifest, {
            id: canonical.id,
            collection: canonical.collection,
            title: canonical.title,
            properties: {
              ...canonical.properties,
              [positionField]: item.position,
            },
            relations: canonical.relations.map(({ name, target_id }) => ({
              name,
              target_id,
            })),
            source: canonical.source,
            archived_at: canonical.archived_at,
            created_at: canonical.created_at,
            updated_at: now,
            operation_actor: "user",
            operation_origin: "manual",
            operation_id: `op-order-${canonical.id}-${Date.now().toString(36)}`,
            idempotency_key: `quick-order:${runtime.installationId}:${canonical.id}:${item.position}:${now}`,
            app_installation_id: runtime.installationId,
          });
        }
        setMessage(copyText(copy, "orderSaved", "Order saved."));
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : copyText(copy, "couldNotReorder", "Could not reorder this list."),
        );
      } finally {
        setBusy(false);
      }
    },
    [
      db,
      copy,
      ordered,
      positionField,
      runtime.activeManifest,
      runtime.installationId,
    ],
  );

  const beginEdit = useCallback(
    (record: DomainRecordViewModel) => {
      setEditingId(record.id);
      setEditTitle(record.title);
      setEditNote(noteField ? String(record.properties[noteField] ?? "") : "");
      setEditDirty(false);
      setMessage("");
    },
    [noteField],
  );

  const saveEdit = useCallback(async (closeEditor = true) => {
    const cleanTitle = editTitle.trim();
    if (
      !editingId ||
      !cleanTitle ||
      !db ||
      !runtime.activeManifest ||
      !runtime.installationId
    ) {
      setMessage(
        cleanTitle
          ? copyText(copy, "storageNotReady", "List storage is not ready.")
          : copyText(copy, "enterItem", "Enter an item name."),
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const canonical = await getRecordForInstallation(
        db,
        runtime.installationId,
        editingId,
      );
      if (!canonical) {
        throw new Error(copyText(copy, "missingItem", "A list item no longer exists."));
      }
      const now = new Date().toISOString();
      await upsertRecord(db, runtime.activeManifest, {
        id: canonical.id,
        collection: canonical.collection,
        title: cleanTitle,
        properties: {
          ...canonical.properties,
          ...(noteField ? { [noteField]: editNote.trim() } : {}),
        },
        relations: canonical.relations.map(({ name, target_id }) => ({
          name,
          target_id,
        })),
        source: canonical.source,
        archived_at: canonical.archived_at,
        created_at: canonical.created_at,
        updated_at: now,
        operation_actor: "user",
        operation_origin: "manual",
        operation_id: `op-edit-${canonical.id}-${Date.now().toString(36)}`,
        idempotency_key: `quick-edit:${runtime.installationId}:${canonical.id}:${now}`,
        app_installation_id: runtime.installationId,
      });
      if (closeEditor) {
        setEditingId(null);
        setEditTitle("");
        setEditNote("");
      }
      setEditDirty(false);
      setMessage(copyText(copy, "saved", "Saved."));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : copyText(copy, "couldNotEdit", "Could not edit this item."),
      );
    } finally {
      setBusy(false);
    }
  }, [
    db,
    copy,
    editNote,
    editTitle,
    editingId,
    noteField,
    runtime.activeManifest,
    runtime.installationId,
  ]);

  useEffect(() => {
    if (!autoSaveEdits || !editDirty || !editingId) return;
    const timeout = setTimeout(() => {
      void saveEdit(false);
    }, 350);
    return () => clearTimeout(timeout);
  }, [autoSaveEdits, editDirty, editingId, saveEdit]);

  const remove = useCallback(
    async (record: DomainRecordViewModel) => {
      if (!db || !runtime.installationId) return;
      setBusy(true);
      setMessage("");
      try {
        await archiveRecordForInstallation(
          db,
          runtime.installationId,
          record.id,
        );
        if (editingId === record.id) setEditingId(null);
        setConfirmingDeleteId(null);
        setMessage(copyText(copy, "deleted", "Deleted."));
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : copyText(copy, "couldNotDelete", "Could not delete this item."),
        );
      } finally {
        setBusy(false);
      }
    },
    [copy, db, editingId, runtime.installationId],
  );

  return (
    <View style={[styles.card, plain ? styles.cardPlain : null]}>
      <Text style={styles.heading}>{text(props.title, "List")}</Text>
      {props.subtitle ? (
        <Text style={styles.subtitle}>{text(props.subtitle)}</Text>
      ) : null}
      {showManualEntry ? <View style={styles.addRow}>
        <TextInput
          accessibilityLabel={text(props.inputLabel, copyText(copy, "newItem", "New item"))}
          editable={!busy}
          placeholder={text(props.placeholder, copyText(copy, "addPlaceholder", "Add an item"))}
          placeholderTextColor="#86796A"
          returnKeyType="done"
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={() => void add()}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copyText(copy, "addItem", "Add item")}
          disabled={busy}
          style={styles.addButton}
          onPress={() => void add()}
        >
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View> : null}
      {quickAdds.length ? (
        <View style={styles.presetRow}>
          {quickAdds.map((preset, index) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Add ${preset.label}`}
              disabled={busy}
              key={`${preset.label}-${index}`}
              onPress={() => void addPreset(preset)}
              style={styles.presetButton}
            >
              <Text style={styles.presetText}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {showRecords ? ordered.map((record, index) => (
        <View key={record.id} style={styles.item}>
          {editingId === record.id ? (
            <View style={styles.editPanel}>
              <TextInput
                accessibilityLabel={copyText(copy, "editName", "Edit {item} name", { item: record.title })}
                editable={!busy}
                style={styles.editInput}
                value={editTitle}
                onChangeText={(value) => {
                  setEditTitle(value);
                  setEditDirty(true);
                }}
              />
              {noteField ? (
                <TextInput
                  accessibilityLabel={copyText(copy, "editNote", "Edit {item} note", { item: record.title })}
                  editable={!busy}
                  multiline
                  placeholder={text(props.notePlaceholder, copyText(copy, "addNote", "Add a note"))}
                  placeholderTextColor="#86796A"
                  style={[styles.editInput, styles.noteInput]}
                  value={editNote}
                  onChangeText={(value) => {
                    setEditNote(value);
                    setEditDirty(true);
                  }}
                />
              ) : null}
              <View style={styles.editActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={autoSaveEdits
                    ? copyText(copy, "doneEditing", "Done editing {item}", { item: record.title })
                    : copyText(copy, "saveItem", "Save {item}", { item: record.title })}
                  disabled={busy}
                  style={styles.saveButton}
                  onPress={() => {
                    if (autoSaveEdits && editDirty) void saveEdit();
                    else if (autoSaveEdits) setEditingId(null);
                    else void saveEdit();
                  }}
                >
                  <Text style={styles.saveText}>
                    {autoSaveEdits
                      ? copyText(copy, "done", "Done")
                      : copyText(copy, "save", "Save")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copyText(copy, "cancelEditing", "Cancel editing {item}", { item: record.title })}
                  disabled={busy}
                  style={styles.actionButton}
                  onPress={() => setEditingId(null)}
                >
                  <Text style={styles.actionText}>{copyText(copy, "cancel", "Cancel")}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              {checkedField ? (
                <Pressable
                  accessibilityLabel={record.title}
                  accessibilityRole="checkbox"
                  accessibilityState={{
                    checked: checklistChecked(record.properties[checkedField]),
                    disabled: busy,
                  }}
                  aria-checked={checklistChecked(
                    record.properties[checkedField],
                  )}
                  disabled={busy}
                  style={[
                    styles.checkBox,
                    checklistChecked(record.properties[checkedField])
                      ? styles.checkBoxChecked
                      : null,
                  ]}
                  onPress={() => void toggle(record)}
                >
                  <Text style={styles.checkMark}>
                    {checklistChecked(record.properties[checkedField])
                      ? "✓"
                      : ""}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.itemCopy}>
                <Text
                  style={[
                    styles.itemTitle,
                    checkedField &&
                    checklistChecked(record.properties[checkedField])
                      ? styles.itemTitleChecked
                      : null,
                  ]}
                >
                  {record.title}
                </Text>
                {recordDetail(record, positionField, checkedField) ? (
                  <Text style={styles.itemDetail}>
                    {recordDetail(record, positionField, checkedField)}
                  </Text>
                ) : null}
              </View>
              <View style={styles.itemActions}>
                {reorderable ? (
                  <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copyText(copy, "moveUp", "Move {item} up", { item: record.title })}
                    disabled={busy || index === 0}
                    style={styles.moveButton}
                    onPress={() => void move(record.id, "up")}
                  >
                    <Text style={styles.moveText}>↑</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copyText(copy, "moveDown", "Move {item} down", { item: record.title })}
                    disabled={busy || index === ordered.length - 1}
                    style={styles.moveButton}
                    onPress={() => void move(record.id, "down")}
                  >
                    <Text style={styles.moveText}>↓</Text>
                  </Pressable>
                  </>
                ) : null}
                {editable ? (
                  <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copyText(copy, "editItem", "Edit {item}", { item: record.title })}
                  disabled={busy}
                  style={styles.actionButton}
                  onPress={() => beginEdit(record)}
                >
                  <Text style={styles.actionText}>{copyText(copy, "edit", "Edit")}</Text>
                  </Pressable>
                ) : null}
                {deletable ? (
                  confirmingDeleteId === record.id ? (
                    <View accessibilityRole="alert" style={styles.deleteConfirm}>
                    <Text style={styles.confirmText}>{copyText(copy, "deletePrompt", "Delete?")}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copyText(copy, "confirmDelete", "Confirm delete {item}", { item: record.title })}
                      disabled={busy}
                      style={styles.deleteButton}
                      onPress={() => void remove(record)}
                    >
                      <Text style={styles.deleteText}>{copyText(copy, "confirm", "Yes")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copyText(copy, "cancelDeleting", "Cancel deleting {item}", { item: record.title })}
                      disabled={busy}
                      style={styles.actionButton}
                      onPress={() => setConfirmingDeleteId(null)}
                    >
                      <Text style={styles.actionText}>{copyText(copy, "decline", "No")}</Text>
                    </Pressable>
                    </View>
                  ) : (
                    <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copyText(copy, "deleteItem", "Delete {item}", { item: record.title })}
                    disabled={busy}
                    style={styles.deleteButton}
                    onPress={() => setConfirmingDeleteId(record.id)}
                  >
                    <Text style={styles.deleteText}>{copyText(copy, "delete", "Delete")}</Text>
                    </Pressable>
                  )
                ) : null}
              </View>
            </>
          )}
        </View>
      )) : null}
      {showRecords && !ordered.length ? (
        <Text style={styles.empty}>
          {text(props.emptyText, copyText(copy, "empty", "No items yet."))}
        </Text>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function copyValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type QuickAddPreset = Readonly<{
  label: string;
  value: unknown;
  properties: Record<string, unknown>;
}>;

function presetValues(value: unknown): QuickAddPreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const label = text(row.label, text(row.title));
    if (!label || row.value === undefined) return [];
    return [{ label, value: row.value, properties: propertyValues(row.properties) }];
  });
}

function recordPresetValues(
  records: DomainRecordViewModel[],
  labelField: string,
  valueField: string,
  properties: Record<string, unknown>,
): QuickAddPreset[] {
  if (!valueField) return [];
  return records.flatMap((record) => {
    const label = labelField
      ? text(record.properties[labelField], record.title)
      : record.title;
    const value = record.properties[valueField];
    return label && value !== undefined
      ? [{ label, value, properties }]
      : [];
  });
}

function propertyValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveDynamicProperties(properties: Record<string, unknown>, now: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key,
    value === "$now" ? now : value === "$today" ? now.slice(0, 10) : value,
  ]));
}

function copyText(
  copy: Record<string, unknown>,
  key: string,
  fallback: string,
  values: Record<string, string | number> = {},
): string {
  return formatLocalizedText(copy[key], fallback, values);
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function recordDetail(
  record: DomainRecordViewModel,
  positionField: string,
  checkedField: string,
): string {
  return Object.entries(record.properties)
    .filter(
      ([key, value]) =>
        key !== positionField &&
        key !== checkedField &&
        value !== null &&
        value !== undefined &&
        value !== "",
    )
    .slice(0, 2)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${String(value)}`)
    .join(" · ");
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  cardPlain: { backgroundColor: "transparent", borderRadius: 0, paddingHorizontal: 0 },
  heading: { color: "#0F172A", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#475569", fontSize: 14, lineHeight: 20 },
  addRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  addButton: {
    alignItems: "center",
    backgroundColor: "#166534",
    borderRadius: 8,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  addButtonText: { color: "#FFFFFF", fontSize: 26, fontWeight: "800" },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetButton: {
    alignItems: "center",
    backgroundColor: "#166534",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  presetText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  item: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    minHeight: 60,
    padding: 10,
  },
  itemCopy: { flex: 1, gap: 3, minWidth: 140 },
  itemTitle: { color: "#0F172A", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  itemTitleChecked: { color: "#64748B", textDecorationLine: "line-through" },
  itemDetail: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  itemActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
  },
  checkBox: {
    alignItems: "center",
    borderColor: "#64748B",
    borderRadius: 4,
    borderWidth: 2,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  checkBoxChecked: { backgroundColor: "#166534", borderColor: "#166534" },
  checkMark: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  editPanel: { flex: 1, gap: 8, paddingVertical: 4 },
  editInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0F172A",
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: { minHeight: 72, textAlignVertical: "top" },
  editActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionButton: {
    borderColor: "#CBD5E1",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  actionText: { color: "#334155", fontSize: 12, fontWeight: "800" },
  saveButton: {
    backgroundColor: "#166534",
    borderRadius: 8,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  saveText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  deleteButton: {
    borderColor: "#B4493B",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  deleteText: { color: "#B4493B", fontSize: 12, fontWeight: "800" },
  deleteConfirm: { alignItems: "center", flexDirection: "row", gap: 6 },
  confirmText: { color: "#6D6257", fontSize: 12, fontWeight: "700" },
  moveButton: {
    alignItems: "center",
    borderColor: "#CFC3B3",
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  moveText: { color: "#334155", fontSize: 18, fontWeight: "800" },
  empty: { color: "#64748B", paddingVertical: 20, textAlign: "center" },
  message: { color: "#166534", fontSize: 12, fontWeight: "700" },
});
