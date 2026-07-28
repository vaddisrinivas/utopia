import { ChatCitation } from '@/src/chat/types';

export const defaultCitations: ChatCitation[] = [
  {
    label: 'App snapshot',
    detail: 'kitchen graph and local records',
    href: 'utopia://app/snapshot',
    tone: 'moss',
  },
  {
    label: 'Utopia Notion',
    detail: '2026 template + relations',
    href: 'https://app.notion.com',
    tone: 'blue',
  },
  {
    label: 'Utopia Sheets',
    detail: 'meal and shopping projection',
    href: 'https://docs.google.com/spreadsheets',
    tone: 'amber',
  },
];

export function ensureCitations(items: ChatCitation[] | null | undefined): ChatCitation[] {
  if (!items || items.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.label || !item.detail || !item.href) {
      return false;
    }
    const key = `${item.label}\u0000${item.href}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function citationLabel(citation: ChatCitation): string {
  return `${citation.label}: ${citation.detail}`;
}

export type Citation = ChatCitation;

function normalizeTone(tone: unknown): ChatCitation['tone'] | null {
  return tone === 'moss' || tone === 'blue' || tone === 'amber' || tone === 'plum' || tone === 'neutral'
    ? tone
    : null;
}

export function toCitationsFromSnapshots(raw: unknown): ChatCitation[] {
  const values = Array.isArray(raw) ? raw : [];
  const normalized = values
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const candidate = item as { label?: unknown; detail?: unknown; href?: unknown; tone?: unknown };
      const label = typeof candidate.label === 'string' && candidate.label.length > 0 ? candidate.label : null;
      const detail = typeof candidate.detail === 'string' && candidate.detail.length > 0 ? candidate.detail : null;
      const href = typeof candidate.href === 'string' && candidate.href.length > 0 ? candidate.href : null;
      const tone = normalizeTone(candidate.tone);
      if (!label || !detail || !href || !tone) {
        return null;
      }
      return {
        label,
        detail,
        href,
        tone,
      };
    })
    .filter((row): row is ChatCitation => row !== null);
  return normalized;
}
