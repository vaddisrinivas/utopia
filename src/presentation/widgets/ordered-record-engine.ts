export function nextRecordPosition(values: unknown[]): number {
  const positions = values
    .map((value) => Number(value))
    .filter(Number.isFinite);
  return positions.length ? Math.max(...positions) + 1 : 0;
}

export function moveRecordPosition(
  ids: string[],
  activeId: string,
  direction: 'up' | 'down',
): Array<{ id: string; position: number }> {
  const current = ids.indexOf(activeId);
  if (current < 0) return ids.map((id, position) => ({ id, position }));
  const target = direction === 'up' ? current - 1 : current + 1;
  if (target < 0 || target >= ids.length) return ids.map((id, position) => ({ id, position }));
  const ordered = [...ids];
  [ordered[current], ordered[target]] = [ordered[target], ordered[current]];
  return ordered.map((id, position) => ({ id, position }));
}
