import { createContext, useContext, type ReactNode } from 'react';
import { TamaguiProvider } from 'tamagui';

import config from '../../tamagui.config';

type Identity = Record<string, unknown> | undefined;
type AppTheme = { accent: string; canvas: string; surface: string; ink: string; muted: string };
const fallback: AppTheme = { accent: '#2F7448', canvas: '#F7FAF4', surface: '#FFFFFF', ink: '#182019', muted: '#657066' };
const tones: Record<string, Partial<AppTheme>> = {
  dark: { canvas: '#111315', surface: '#1C2023', ink: '#F7F9F7', muted: '#AAB2AC' },
  vivid: { accent: '#E63B2E', canvas: '#FFF8E7', surface: '#FFFFFF', ink: '#211B18', muted: '#665B54' },
  calm: { accent: '#167D8D', canvas: '#F1FAF8', surface: '#FFFFFF', ink: '#122321', muted: '#617370' },
  mono: { accent: '#30343B', canvas: '#F5F5F3', surface: '#FFFFFF', ink: '#17191C', muted: '#696D72' },
};
const Context = createContext(fallback);
const hex = (value: unknown) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : undefined;
const rgb = (value: string) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
const mix = (left: string, right: string, weight: number) => `#${rgb(left).map((value, index) =>
  Math.round(value * (1 - weight) + rgb(right)[index] * weight).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const luminance = (value: string) => rgb(value).map((channel) => {
  const normalized = channel / 255;
  return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
}).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (left: string, right: string) => (Math.max(luminance(left), luminance(right)) + .05) / (Math.min(luminance(left), luminance(right)) + .05);
const statusPill = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  positive: 'success',
  danger: 'error',
  caution: 'warning',
  info: 'info',
  pending: 'warning',
  neutral: 'neutral',
};
const statusColorForTone: Record<'success' | 'warning' | 'error' | 'info' | 'neutral', string> = {
  success: '#1F8A70',
  warning: '#B98200',
  error: '#B42318',
  info: '#1769AA',
  neutral: '#697279',
};

export type StatusTone = keyof typeof statusColorForTone;

export function normalizeStatusTone(raw = ''): StatusTone {
  const key = String(raw).trim().toLowerCase();
  if (key in statusPill) return statusPill[key as keyof typeof statusPill] as StatusTone;
  return 'neutral';
}

export function themeStatusColor(raw: string, theme: AppTheme): string {
  const tone = normalizeStatusTone(raw);
  return tone === 'success' ? theme.accent : statusColorForTone[tone];
}

export function deriveTheme(identity?: Identity): AppTheme {
  const preset = tones[String(identity?.tone ?? '')] ?? {};
  const accent = hex(identity?.accent) ?? preset.accent ?? fallback.accent;
  const canvas = hex(identity?.canvas) ?? preset.canvas ?? mix(accent, '#FFFFFF', .94);
  const surface = hex(identity?.surface) ?? preset.surface ?? mix(canvas, '#FFFFFF', .55);
  const requestedInk = hex(identity?.ink) ?? preset.ink;
  const ink = requestedInk && contrast(requestedInk, canvas) >= 4.5 ? requestedInk : luminance(canvas) > .42 ? '#182019' : '#FFFFFF';
  const muted = hex(identity?.muted) ?? preset.muted ?? mix(ink, canvas, .42);
  return { accent, canvas, surface, ink, muted };
}

export function PackageTheme({ identity, children }: { identity?: Identity; children: ReactNode }) {
  return <Context.Provider value={deriveTheme(identity)}>{children}</Context.Provider>;
}

export const usePackageTheme = () => useContext(Context);
export function Theme({ children }: { children: ReactNode }) {
  return <TamaguiProvider config={config} defaultTheme="light">{children}</TamaguiProvider>;
}
