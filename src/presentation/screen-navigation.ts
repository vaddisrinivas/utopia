import type { A2UiSurface } from '@/packages/shared/contracts/package';

export type DeclaredScreenId = string;

/** Resolve only screens declared by the package. Unknown deep links never render arbitrary data. */
export function resolveDeclaredScreenId(ui: A2UiSurface | undefined, requested?: string): DeclaredScreenId | undefined {
  const screens = ui?.screens;
  if (!screens) return undefined;
  const ids = Object.keys(screens);
  if (!ids.length) return undefined;
  if (requested && Object.hasOwn(screens, requested)) return requested;
  if (ui.defaultScreen && Object.hasOwn(screens, ui.defaultScreen)) return ui.defaultScreen;
  return ids[0];
}

export function declaredScreenIds(ui: A2UiSurface | undefined): readonly string[] {
  return Object.keys(ui?.screens ?? {});
}
