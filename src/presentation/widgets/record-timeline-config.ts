export type RecordTimelineItem = Record<string, unknown>;

export function recordTimelineItems(props: { items?: unknown[]; records?: unknown[]; dateField?: unknown }): RecordTimelineItem[] {
  const explicit = Array.isArray(props.items)
    ? props.items.filter((item): item is RecordTimelineItem => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
  if (explicit.length) return explicit;
  const dateField = text(props.dateField);
  return Array.isArray(props.records)
    ? props.records.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
          ? record.properties as Record<string, unknown>
          : {};
        const title = text(record.title);
        if (!title) return [];
        const date = dateField ? text(properties[dateField]) : '';
        const status = text(properties.status);
        return [{
          id: record.id,
          title,
          subtitle: [status, date].filter(Boolean).join(' · '),
          date,
          status,
        }];
      })
    : [];
}

export function recordTimelineMarker(item: RecordTimelineItem): string {
  return text(item.time, text(item.date, text(item.timestamp, text(item.badge, text(item.status, 'Now')))));
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
