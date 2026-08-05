import { createContext, useContext, type ReactNode } from 'react';
import { TamaguiProvider } from 'tamagui';

import config from '../../tamagui.config';

type Identity = Record<string, unknown> | undefined;
type AppTheme = { accent: string; canvas: string; surface: string; ink: string; muted: string };
const fallback: AppTheme = { accent: '#2F7448', canvas: '#F7FAF4', surface: '#FFFFFF', ink: '#182019', muted: '#657066' };
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

export function deriveTheme(identity?: Identity): AppTheme {
  const accent = hex(identity?.accent) ?? fallback.accent;
  const canvas = hex(identity?.canvas) ?? mix(accent, '#FFFFFF', .94);
  const surface = hex(identity?.surface) ?? mix(canvas, '#FFFFFF', .55);
  const requestedInk = hex(identity?.ink);
  const ink = requestedInk && contrast(requestedInk, canvas) >= 4.5 ? requestedInk : luminance(canvas) > .42 ? '#182019' : '#FFFFFF';
  const muted = hex(identity?.muted) ?? mix(ink, canvas, .42);
  return { accent, canvas, surface, ink, muted };
}

export function PackageTheme({ identity, children }: { identity?: Identity; children: ReactNode }) {
  return <Context.Provider value={deriveTheme(identity)}>{children}</Context.Provider>;
}

export const usePackageTheme = () => useContext(Context);
export function Theme({ children }: { children: ReactNode }) {
  return <TamaguiProvider config={config} defaultTheme="light">{children}</TamaguiProvider>;
}
