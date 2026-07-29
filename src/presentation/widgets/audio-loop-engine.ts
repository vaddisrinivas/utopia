export type AudioLoopStatus = 'empty' | 'ready' | 'starting' | 'playing' | 'paused' | 'between' | 'stopped' | 'completed' | 'error';

export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function numericOptions(value: unknown, fallback: number[]): number[] {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .map((item) => clampInteger(item, 0, 0, 3600))
    .filter((item, index, all) => all.indexOf(item) === index)
    .sort((a, b) => a - b);
  return normalized.length ? normalized : fallback;
}

export function formatAudioLoopTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  const minutes = Math.floor(value / 60) % 60;
  const hours = Math.floor(value / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatDelayOption(seconds: number): string {
  if (seconds <= 0) return 'None';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function audioLoopStatusLabel(status: AudioLoopStatus, remainingDelay: number): string {
  if (status === 'empty') return 'Choose file';
  if (status === 'ready') return 'Ready';
  if (status === 'starting') return 'Starting';
  if (status === 'playing') return 'Playing';
  if (status === 'paused') return 'Paused';
  if (status === 'between') return `Next play in ${formatDelayOption(remainingDelay)}`;
  if (status === 'completed') return 'Completed';
  if (status === 'error') return 'Needs attention';
  return 'Stopped';
}
