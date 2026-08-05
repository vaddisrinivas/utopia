import { createContext, useContext, type ReactNode } from 'react';
import { TamaguiProvider } from 'tamagui';

import config from '../../tamagui.config';

type Identity = Record<string, unknown> | undefined;
type AppTheme = { accent: string; canvas: string; surface: string; ink: string; muted: string };
const fallback: AppTheme = { accent: '#2F7448', canvas: '#F7FAF4', surface: '#FFFFFF', ink: '#182019', muted: '#657066' };
const Context = createContext(fallback);
const color = (value: unknown, otherwise: string) => typeof value === 'string' && /^(#|rgb|hsl)/i.test(value) ? value : otherwise;

export function PackageTheme({ identity, children }: { identity?: Identity; children: ReactNode }) {
  const value = {
    accent: color(identity?.accent, fallback.accent),
    canvas: color(identity?.canvas, fallback.canvas),
    surface: color(identity?.surface, fallback.surface),
    ink: color(identity?.ink, fallback.ink),
    muted: color(identity?.muted, fallback.muted),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const usePackageTheme = () => useContext(Context);
export function Theme({ children }: { children: ReactNode }) {
  return <TamaguiProvider config={config} defaultTheme="light">{children}</TamaguiProvider>;
}
