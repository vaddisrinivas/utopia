import { toCitationsFromSnapshots } from '@/src/chat/citations';

type NotionCitationInput = {
  pageId?: string;
  title?: string;
  updatedAt?: string;
};

export function notionSnapshotToCitations(snapshots: unknown[]) {
  const mapped = snapshots
    .map((snapshot) => {
      if (!snapshot || typeof snapshot !== 'object') {
        return null;
      }
      const candidate = snapshot as NotionCitationInput;
      const pageId =
        typeof candidate.pageId === 'string'
          ? candidate.pageId
          : typeof (candidate as { page_id?: unknown }).page_id === 'string'
            ? (candidate as { page_id?: string }).page_id
            : '';
      const title = typeof candidate.title === 'string' ? candidate.title : 'Notion source';
      const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '';
      const href = pageId ? `https://app.notion.com/${pageId}` : '';
      return {
        label: 'Notion',
        detail: [title, updatedAt].filter(Boolean).join(' · '),
        href: href || 'notion://snapshot',
        tone: 'amber' as const,
      };
    })
    .filter((value): value is { label: string; detail: string; href: string; tone: 'amber' } => value !== null);

  const fallback = toCitationsFromSnapshots(snapshots as unknown[]);
  if (mapped.length > 0) {
    return mapped;
  }
  return fallback;
}
