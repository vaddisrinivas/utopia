export function checklistChecked(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'done', 'checked'].includes(value.trim().toLowerCase());
  return false;
}

export function toggleChecklistChecked(value: unknown): boolean {
  return !checklistChecked(value);
}
