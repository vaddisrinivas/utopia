import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const source = readFileSync(
  path.join(repoRoot, "src/presentation/widgets/quick-add-list-widget.tsx"),
  "utf8",
);

describe("QuickAddListWidget source contract", () => {
  it("exposes the reusable add and check surface", () => {
    expect(source).toContain("export function QuickAddListWidget");
    expect(source).toContain("const collection = text(props.collection);");
    expect(source).toContain("const checkedField = text(props.checkedField);");
    expect(source).toContain("const add = useCallback(async () => {");
    expect(source).toContain("const cleanTitle = recordTitle.trim();");
    expect(source).toContain(
      "await upsertRecord(db, runtime.activeManifest, {",
    );
    expect(source).toContain('setTitle("");');
    expect(source).toContain('accessibilityLabel={copyText(copy, "addItem", "Add item")}');
    expect(source).toContain("const toggle = useCallback(");
    expect(source).toContain("[checkedField]: toggleChecklistChecked(");
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain("accessibilityState={{");
    expect(source).toContain(
      "checked: checklistChecked(record.properties[checkedField]),",
    );
    expect(source).toContain("aria-checked={checklistChecked(");
  });

  it("persists package-defined quick-add presets with dynamic defaults", () => {
    expect(source).toContain("...presetValues(props.quickAdds),");
    expect(source).toContain("const defaultProperties = propertyValues(props.defaultProperties);");
    expect(source).toContain("...resolveDynamicProperties(defaultProperties, now),");
    expect(source).toContain("...(valueField ? { [valueField]: preset.value } : {}),");
    expect(source).toContain('value === "$now" ? now : value === "$today" ? now.slice(0, 10) : value');
    expect(source).toContain('accessibilityLabel={`Add ${preset.label}`}');
  });

  it("turns queried records into reusable package-defined presets", () => {
    expect(source).toContain("...recordPresetValues(");
    expect(source).toContain("const presetLabelField = text(props.presetLabelField);");
    expect(source).toContain("const presetValueField = text(props.presetValueField);");
    expect(source).toContain("const showRecords = props.showRecords !== false;");
    expect(source).toContain("const value = record.properties[valueField];");
    expect(source).toContain("{showRecords ? ordered.map((record, index) => (");
  });

  it("exposes optional edit and note semantics through the same record update path", () => {
    expect(source).toContain("const editable = props.editable === true;");
    expect(source).toContain("const noteField = text(props.noteField);");
    expect(source).toContain("const beginEdit = useCallback(");
    expect(source).toContain("setEditTitle(record.title);");
    expect(source).toContain(
      'setEditNote(noteField ? String(record.properties[noteField] ?? "") : "");',
    );
    expect(source).toContain(
      "const saveEdit = useCallback(async (closeEditor = true) => {",
    );
    expect(source).toContain("void saveEdit(false);");
    expect(source).toContain("title: cleanTitle,");
    expect(source).toContain(
      "...(noteField ? { [noteField]: editNote.trim() } : {}),",
    );
    expect(source).toContain('copyText(copy, "editItem", "Edit {item}"');
    expect(source).toContain('copyText(copy, "saveItem", "Save {item}"');
    expect(source).toContain('copyText(copy, "cancelEditing", "Cancel editing {item}"');
    expect(source).toContain('copyText(copy, "editNote", "Edit {item} note"');
  });

  it("requires explicit confirmation before archive-delete and exposes accessible outcomes", () => {
    expect(source).toContain("const deletable = props.deletable === true;");
    expect(source).toContain(
      "const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(",
    );
    expect(source).toContain("const remove = useCallback(");
    expect(source).toContain("await archiveRecordForInstallation(");
    expect(source).toContain('copyText(copy, "deleteItem", "Delete {item}"');
    expect(source).toContain(
      "onPress={() => setConfirmingDeleteId(record.id)}",
    );
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain('copyText(copy, "confirmDelete", "Confirm delete {item}"');
    expect(source).toContain("onPress={() => void remove(record)}");
    expect(source).toContain('copyText(copy, "cancelDeleting", "Cancel deleting {item}"');
    expect(source).toContain("onPress={() => setConfirmingDeleteId(null)}");
    expect(source).toContain('setMessage(copyText(copy, "deleted", "Deleted."));');
  });

  it("keeps controls disabled while a persistence operation is busy", () => {
    expect(source).toContain("editable={!busy}");
    expect(source).toContain("disabled={busy}");
    expect(source).toContain("disabled: busy,");
    expect(source).toContain('accessibilityLiveRegion="polite"');
  });

  it("keeps row actions usable on narrow product surfaces", () => {
    expect(source).toContain("<View style={styles.itemActions}>");
    expect(source).toContain('flexWrap: "wrap"');
    expect(source).toContain("minWidth: 140");
    expect(source).toContain("minHeight: 44");
  });

  it("takes user-facing copy from generic package props", () => {
    expect(source).toContain('import { formatLocalizedText }');
    expect(source).toContain('const copy = copyValues(props.copy);');
    expect(source).toContain("function copyText(");
    expect(source).toContain("return formatLocalizedText(copy[key], fallback, values);");
  });

  it("debounces opt-in autosave and safely finalizes dirty drafts", () => {
    expect(source).toContain(
      'const autoSaveEdits = commandPolicy.autosave !== "manual";',
    );
    expect(source).toContain("normalizeInteractionCommandPolicy(");
    expect(source).toContain("if (!autoSaveEdits || !editDirty || !editingId) return;");
    expect(source).toContain("void saveEdit(false);");
    expect(source).toContain("}, 350);");
    expect(source).toContain("if (autoSaveEdits && editDirty) void saveEdit();");
    expect(source).toContain('copyText(copy, "doneEditing", "Done editing {item}"');
  });
});
