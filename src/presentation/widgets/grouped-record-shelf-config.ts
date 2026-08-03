export type GroupedRecordShelfItem = Record<string, unknown>;

export type GroupedRecordShelfGroup = {
  title: string;
  subtitle: string;
  action: GroupedRecordShelfItem | null;
  items: GroupedRecordShelfItem[];
};

export function groupedRecordShelfGroups(props: {
  groups?: unknown[];
  items?: unknown[];
  records?: unknown[];
  groupBy?: unknown;
  subtitleFields?: unknown[];
}): GroupedRecordShelfGroup[] {
  const groups = rows(props.groups)
    .map((group) => ({
      title: text(group.title, text(group.label, 'Records')),
      subtitle: text(group.subtitle, text(group.detail)),
      action: hasTarget(group) ? group : null,
      items: rows(group.items),
    }))
    .filter((group) => group.items.length > 0);

  if (groups.length) return groups;

  const items = rows(props.items);
  if (items.length) return [{ title: '', subtitle: '', action: null, items }];

  const records = rows(props.records);
  const groupBy = text(props.groupBy);
  const subtitleFields = Array.isArray(props.subtitleFields)
    ? props.subtitleFields.map((field) => text(field)).filter(Boolean)
    : [];
  const recordGroups = new Map<string, GroupedRecordShelfItem[]>();
  for (const record of records) {
    const properties = row(record.properties);
    const group = groupBy ? text(properties[groupBy], 'Other') : '';
    const detail = subtitleFields.map((field) => text(properties[field])).filter(Boolean).join(' · ');
    const item = {
      ...properties,
      id: record.id,
      title: text(record.title, text(properties.title, 'Untitled')),
      subtitle: detail,
    };
    recordGroups.set(group, [...(recordGroups.get(group) ?? []), item]);
  }
  return [...recordGroups.entries()].map(([title, groupItems]) => ({
    title,
    subtitle: '',
    action: null,
    items: groupItems,
  }));
}

function rows(value: unknown): GroupedRecordShelfItem[] {
  return Array.isArray(value)
    ? value.filter((item): item is GroupedRecordShelfItem => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function row(value: unknown): GroupedRecordShelfItem {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as GroupedRecordShelfItem
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function hasTarget(value: GroupedRecordShelfItem): boolean {
  return Boolean(text(value.route) || text(value.path) || text(value.url) || text(value.href) || text(value.deeplink));
}
