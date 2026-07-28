import { DomainManifest, DomainVisualIdentity, VisualToken } from '@/src/domain/catalog';

export type VisualAccent = 'moss' | 'amber' | 'blue' | 'plum' | 'neutral';

const EMPTY_IDENTITY: DomainVisualIdentity = {};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanToken(value: unknown): VisualToken | undefined {
  if (!isObject(value)) return undefined;
  const accent = value.accent;
  return {
    icon: typeof value.icon === 'string' ? value.icon : undefined,
    emoji: typeof value.emoji === 'string' ? value.emoji : undefined,
    image_url: typeof value.image_url === 'string' ? value.image_url : undefined,
    accent: accent === 'moss' || accent === 'amber' || accent === 'blue' || accent === 'plum' || accent === 'neutral' ? accent : undefined,
  };
}

function cleanMap(value: unknown): Record<string, VisualToken> | undefined {
  if (!isObject(value)) return undefined;
  const next: Record<string, VisualToken> = {};
  for (const [key, token] of Object.entries(value)) {
    const parsed = cleanToken(token);
    if (parsed) next[key] = parsed;
  }
  return next;
}

export function parseVisualIdentityOverrides(input: string): DomainVisualIdentity {
  try {
    const raw = JSON.parse(input || '{}');
    if (!isObject(raw)) return EMPTY_IDENTITY;
    return {
      domain: cleanToken(raw.domain),
      surfaces: cleanMap(raw.surfaces),
      collections: cleanMap(raw.collections),
      statuses: cleanMap(raw.statuses),
      actions: cleanMap(raw.actions),
      sources: cleanMap(raw.sources),
      skills: cleanMap(raw.skills),
      agents: cleanMap(raw.agents),
    };
  } catch {
    return EMPTY_IDENTITY;
  }
}

function mergeToken(base?: VisualToken, override?: VisualToken): VisualToken | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}

function mergeMap(base?: Record<string, VisualToken>, override?: Record<string, VisualToken>) {
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(override ?? {})]);
  return Object.fromEntries(Array.from(keys).map((key) => [key, mergeToken(base?.[key], override?.[key]) ?? {}]));
}

export function mergeVisualIdentity(manifest: DomainManifest, overrideText: string): DomainVisualIdentity {
  const base = manifest.visual_identity ?? EMPTY_IDENTITY;
  const overrides = parseVisualIdentityOverrides(overrideText);
  return {
    domain: mergeToken(base.domain, overrides.domain),
    surfaces: mergeMap(base.surfaces, overrides.surfaces),
    collections: mergeMap(base.collections, overrides.collections),
    statuses: mergeMap(base.statuses, overrides.statuses),
    actions: mergeMap(base.actions, overrides.actions),
    sources: mergeMap(base.sources, overrides.sources),
    skills: mergeMap(base.skills, overrides.skills),
    agents: mergeMap(base.agents, overrides.agents),
  };
}

export function visualGlyph(token: VisualToken | undefined, fallback: string) {
  return token?.emoji || token?.icon || fallback;
}

export function visualAccent(token: VisualToken | undefined): VisualAccent {
  return token?.accent ?? 'neutral';
}
