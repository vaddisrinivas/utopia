export type HorizontalRecordCarouselItem = Record<string, unknown>;

type CarouselProps = {
  records?: unknown;
  items?: unknown;
  sortBy?: unknown;
  sortDirection?: unknown;
};

export function horizontalRecordCarouselItems(props: CarouselProps): HorizontalRecordCarouselItem[] {
  const source = rows(props.records).length ? rows(props.records) : rows(props.items);
  const sortBy = text(props.sortBy);
  const direction = text(props.sortDirection, 'asc').toLowerCase() === 'desc' ? -1 : 1;

  if (!sortBy) return source;

  return [...source].sort((left, right) => compare(left[sortBy], right[sortBy]) * direction);
}

function rows(value: unknown): HorizontalRecordCarouselItem[] {
  return Array.isArray(value)
    ? value.filter((item): item is HorizontalRecordCarouselItem => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function compare(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}
