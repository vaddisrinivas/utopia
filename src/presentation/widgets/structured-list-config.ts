export type StructuredListFieldType = "text" | "number" | "select" | "url";

export type StructuredListMetadataField = Readonly<{
  field: string;
  label: string;
  type: StructuredListFieldType;
  options: readonly string[];
  required: boolean;
  filterable: boolean;
  sortable: boolean;
  readOnly: boolean;
}>;

export type StructuredListSort = Readonly<{
  id: string;
  label: string;
  kind: "manual" | "alphabetic" | "field";
  field?: string;
  direction: "asc" | "desc";
}>;

export type StructuredListSuggestion = Readonly<{
  title: string;
  values: Readonly<Record<string, unknown>>;
}>;

type UnknownRecord = Record<string, unknown>;

const FIELD_TYPES = new Set<StructuredListFieldType>([
  "text",
  "number",
  "select",
  "url",
]);

export function structuredListMetadataFields(value: unknown): readonly StructuredListMetadataField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const field = stringValue(candidate.field);
    if (!field || seen.has(field)) return [];
    seen.add(field);
    const type = stringValue(candidate.type) as StructuredListFieldType;
    return [{
      field,
      label: stringValue(candidate.label, labelForField(field)),
      type: FIELD_TYPES.has(type) ? type : "text",
      options: stringList(candidate.options),
      required: candidate.required === true,
      filterable: candidate.filterable === true,
      sortable: candidate.sortable === true,
      readOnly: candidate.readOnly === true,
    }];
  });
}

export function structuredListSorts(
  value: unknown,
  fields: readonly StructuredListMetadataField[],
  positionField: string,
): readonly StructuredListSort[] {
  const fieldNames = new Set(fields.map((field) => field.field));
  const seen = new Set<string>();
  const parsed = Array.isArray(value)
    ? value.flatMap((candidate) => normalizeSort(candidate, fieldNames, positionField))
    : [];
  const defaults: StructuredListSort[] = [
    ...(positionField
      ? [{ id: "manual", label: "Manual", kind: "manual" as const, direction: "asc" as const }]
      : []),
    { id: "alphabetic", label: "A-Z", kind: "alphabetic", direction: "asc" },
    ...fields
      .filter((field) => field.sortable)
      .map((field) => ({
        id: `field:${field.field}`,
        label: field.label,
        kind: "field" as const,
        field: field.field,
        direction: "asc" as const,
      })),
  ];
  return [...parsed, ...defaults].filter((sort) => {
    if (seen.has(sort.id)) return false;
    seen.add(sort.id);
    return true;
  });
}

export function structuredListFilterFields(
  value: unknown,
  fields: readonly StructuredListMetadataField[],
): readonly StructuredListMetadataField[] {
  const byName = new Map(fields.map((field) => [field.field, field]));
  const requested = stringList(value);
  if (!requested.length) return fields.filter((field) => field.filterable);
  return requested.flatMap((field) => (byName.has(field) ? [byName.get(field)!] : []));
}

export function structuredListSuggestions(value: unknown): readonly StructuredListSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate === "string") {
      const title = candidate.trim();
      return title ? [{ title, values: {} }] : [];
    }
    if (!isRecord(candidate)) return [];
    const title = stringValue(candidate.title, stringValue(candidate.label));
    if (!title) return [];
    const values = isRecord(candidate.values) ? candidate.values : {};
    return [{ title, values }];
  });
}

export function structuredListInitialValues(
  fields: readonly StructuredListMetadataField[],
): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field.field, field.type === "select" ? (field.options[0] ?? "") : ""]),
  );
}

export function structuredListCoerceValues(
  values: Readonly<Record<string, unknown>>,
  fields: readonly StructuredListMetadataField[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  fields.filter((field) => !field.readOnly).forEach((field) => {
    const raw = values[field.field];
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!text) return;
    if (field.type === "number") {
      const numeric = Number(text);
      if (Number.isFinite(numeric)) result[field.field] = numeric;
      return;
    }
    result[field.field] = text;
  });
  return result;
}

export function structuredListReplaceMetadata(
  current: Readonly<Record<string, unknown>>,
  values: Readonly<Record<string, unknown>>,
  fields: readonly StructuredListMetadataField[],
): Record<string, unknown> {
  const metadataFields = new Set(fields.filter((field) => !field.readOnly).map((field) => field.field));
  return {
    ...Object.fromEntries(Object.entries(current).filter(([field]) => !metadataFields.has(field))),
    ...structuredListCoerceValues(values, fields),
  };
}

export function structuredListMissingRequiredFields(
  values: Readonly<Record<string, unknown>>,
  fields: readonly StructuredListMetadataField[],
): readonly StructuredListMetadataField[] {
  return fields.filter((field) => !field.readOnly && field.required && !String(values[field.field] ?? "").trim());
}

export function structuredListBulkTitles(value: string): readonly string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

export function structuredListSortRecords<T extends { title: string; properties: Record<string, unknown> }>(
  records: readonly T[],
  sort: StructuredListSort,
  positionField: string,
): T[] {
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...records].sort((left, right) => {
    if (sort.kind === "manual") {
      return direction * (numeric(left.properties[positionField]) - numeric(right.properties[positionField]));
    }
    const leftValue = sort.kind === "alphabetic" ? left.title : String(left.properties[sort.field ?? ""] ?? "");
    const rightValue = sort.kind === "alphabetic" ? right.title : String(right.properties[sort.field ?? ""] ?? "");
    return direction * leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function structuredListMatchesFilters(
  record: { title: string; properties: Record<string, unknown> },
  search: string,
  filters: Readonly<Record<string, string>>,
): boolean {
  const query = search.trim().toLowerCase();
  const fields = Object.values(record.properties).map((value) => String(value ?? "").toLowerCase());
  if (query && ![record.title.toLowerCase(), ...fields].some((value) => value.includes(query))) return false;
  return Object.entries(filters).every(([field, value]) => !value || String(record.properties[field] ?? "") === value);
}

export function structuredListFieldValues(
  records: readonly { properties: Record<string, unknown> }[],
  field: StructuredListMetadataField,
): readonly string[] {
  const values = new Set(field.options);
  records.forEach((record) => {
    const value = String(record.properties[field.field] ?? "").trim();
    if (value) values.add(value);
  });
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function normalizeSort(value: unknown, fields: ReadonlySet<string>, positionField: string): StructuredListSort[] {
  if (typeof value === "string") {
    if (value === "manual" && positionField) return [{ id: "manual", label: "Manual", kind: "manual", direction: "asc" }];
    if (value === "alphabetic") return [{ id: "alphabetic", label: "A-Z", kind: "alphabetic", direction: "asc" }];
    if (fields.has(value)) return [{ id: `field:${value}`, label: labelForField(value), kind: "field", field: value, direction: "asc" }];
    return [];
  }
  if (!isRecord(value)) return [];
  const kind = stringValue(value.kind);
  const field = stringValue(value.field);
  const direction = value.direction === "desc" ? "desc" : "asc";
  if (kind === "manual" && positionField) return [{ id: "manual", label: stringValue(value.label, "Manual"), kind: "manual", direction }];
  if (kind === "alphabetic") return [{ id: "alphabetic", label: stringValue(value.label, "A-Z"), kind: "alphabetic", direction }];
  if ((kind === "field" || field) && fields.has(field)) {
    return [{ id: `field:${field}:${direction}`, label: stringValue(value.label, labelForField(field)), kind: "field", field, direction }];
  }
  return [];
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? [...new Set(value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])))]
    : [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function labelForField(field: string): string {
  return field.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
