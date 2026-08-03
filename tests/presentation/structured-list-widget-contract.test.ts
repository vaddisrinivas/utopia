import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(path.join(root, "src/presentation/widgets/structured-list-widget.tsx"), "utf8");

describe("StructuredListWidget source contract", () => {
  it("binds declared title metadata to the canonical record title", () => {
    expect(source).toContain('fields.some((field) => field.field === "title")');
    expect(source).toContain('const recordTitleField = fields.find((field) => field.field === "title");');
    expect(source).toContain('fields.filter((field) => field.field !== "title")');
    expect(source).toContain('recordTitleField?.label ?? "New item"');
    expect(source).toContain("fields={secondaryFields}");
    expect(source).toContain('{ ...rawValues, title: cleanTitle }');
    expect(source).toContain('structuredListMissingRequiredFields(canonicalValues, fields)');
    expect(source).toContain('structuredListCoerceValues(canonicalValues, fields)');
    expect(source).toContain('structuredListReplaceMetadata(canonical.properties, canonicalValues, fields)');
  });
  it("uses installation-scoped records for create, update, picked state, reorder, and confirmed deletion", () => {
    expect(source).toContain("export function StructuredListWidget");
    expect(source).toContain("getRecordForInstallation");
    expect(source).toContain("archiveRecordForInstallation");
    expect(source).toContain("app_installation_id: runtime.installationId");
    expect(source).toContain("const togglePicked = useCallback");
    expect(source).toContain("const [pickedOverrides, setPickedOverrides]");
    expect(source).toContain("setPickedOverrides((current)");
    expect(source).toContain("pickedOverrides[record.id] ?? isPicked");
    expect(source).toContain("const move = useCallback");
    expect(source).toContain("const [positionOverrides, setPositionOverrides]");
    expect(source).toContain("setPositionOverrides(Object.fromEntries(positions.map");
    expect(source).toContain("displayRecords.filter");
    expect(source).toContain("const remove = useCallback");
    expect(source).toContain("validateExternalUrl(value)");
    expect(source).toContain("openExternalUrl(value)");
    expect(source).not.toContain("Linking");
    expect(source).toContain("accessibilityLabel={`Confirm delete ${record.title}`}");
  });

  it("exposes package-driven metadata, sorting, filters, bulk add, and suggestions", () => {
    expect(source).toContain("structuredListMetadataFields(props.metadataFields)");
    expect(source).toContain("structuredListSorts(props.sorts");
    expect(source).toContain("structuredListFilterFields(props.filterFields");
    expect(source).toContain("structuredListSuggestions(props.suggestions)");
    expect(source).toContain("const addBulk = useCallback");
    expect(source).toContain("Saved suggestions");
    expect(source).toContain("function MetadataFields");
    expect(source).toContain("${field.label}: ${option}");
    expect(source).toContain("function FilterControl");
    expect(source).toContain('const primaryActionLabel = text(props.primaryActionLabel, "Add");');
    expect(source).toContain("accessibilityLabel={primaryActionLabel}");
    expect(source).toContain("{primaryActionLabel}</Text>");
  });

  it("uses product-grade responsive list styling and accessible target sizes", () => {
    expect(source).toContain('backgroundColor: "#F8FAFC"');
    expect(source).toContain('backgroundColor: "#FFFFFF"');
    expect(source).toContain('minHeight: 44');
    expect(source).toContain('borderColor: "#E2E8F0"');
  });

  it("enforces package edit/delete and autosave policy", () => {
    expect(source).toContain("normalizeInteractionCommandPolicy(");
    expect(source).toContain("saveOutcomeProjection(commandPolicy, { online: runtimeOnline() })");
    expect(source).toContain("if (!outcome.canExecute) throw new Error(outcome.message);");
    expect(source).toContain('outcome.status === "queued" ? text(offlineSaveLabel, outcome.message) : outcome.message');
    expect(source).toContain('stateVariantLabel(props.stateVariants, "offline")');
    expect(source).toContain('const autoSaveEdits = commandPolicy.autosave !== "manual";');
    expect(source).toContain('const editable = props.editable !== false;');
    expect(source).toContain('const deletable = props.deletable !== false;');
    expect(source).toContain("if (!autoSaveEdits || !editDirty || !editingId) return;");
    expect(source).toContain("void saveEdit(record, false);");
    expect(source).toContain("}, 350);");
    expect(source).toContain('autoSaveEdits ? `Done editing ${record.title}`');
    expect(source).toContain("onPress={() => void saveEdit(record)}");
    expect(source).not.toContain("autoSaveEdits && editDirty");
    expect(source).toContain("editTitleRef.current");
    expect(source).toContain("editValuesRef.current");
    expect(source).toContain("await update(record, editTitleRef.current, editValuesRef.current)");
    expect(source).toContain("const outcome = await store(title, values);");
    expect(source).toContain("rememberInteractionStatus(statusKey, next)");
    expect(source).toContain("recallInteractionStatus(statusKey)");
  });
});
