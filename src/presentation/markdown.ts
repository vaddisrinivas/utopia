export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function isBlank(line: string) {
  return line.trim().length === 0;
}

function cleanCell(value: string) {
  return value.trim().replace(/^:+|:+$/g, '').trim();
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cleanCell);
}

function isTableSeparator(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number) {
  return lines[index]?.includes('|') && Boolean(lines[index + 1]) && isTableSeparator(lines[index + 1]);
}

function listMatch(line: string) {
  return line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
}

export function cleanMarkdownInline(value: string) {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

export function extractMarkdownLinks(markdown: string): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  for (const match of markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    links.push({ label: cleanMarkdownInline(match[1] ?? ''), url: match[2] ?? '' });
  }
  for (const match of markdown.matchAll(/(^|\s)(https?:\/\/[^\s)]+)/g)) {
    const url = (match[2] ?? '').replace(/[.,;:!?]+$/, '');
    if (url && !links.some((link) => link.url === url)) links.push({ label: hostLabel(url), url });
  }
  return links.slice(0, 4);
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Open link';
  }
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (isBlank(lines[index] ?? '')) {
      index += 1;
      continue;
    }

    if ((lines[index] ?? '').trim().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', text: code.join('\n').trimEnd() });
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index] ?? '');
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|') && !isBlank(lines[index] ?? '')) {
        const row = splitTableRow(lines[index] ?? '');
        rows.push(headers.map((_, cellIndex) => cleanMarkdownInline(row[cellIndex] ?? '')));
        index += 1;
      }
      blocks.push({ kind: 'table', headers: headers.map(cleanMarkdownInline), rows });
      continue;
    }

    const match = listMatch(lines[index] ?? '');
    if (match) {
      const ordered = /^\d+\.$/.test(match[2] ?? '');
      const items: string[] = [];
      while (index < lines.length) {
        const current = listMatch(lines[index] ?? '');
        if (!current) break;
        const currentOrdered = /^\d+\.$/.test(current[2] ?? '');
        if (currentOrdered !== ordered) break;
        items.push(cleanMarkdownInline(current[3] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length
      && !isBlank(lines[index] ?? '')
      && !isTableStart(lines, index)
      && !listMatch(lines[index] ?? '')
      && !(lines[index] ?? '').trim().startsWith('```')
    ) {
      paragraph.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: cleanMarkdownInline(paragraph.join(' ')) });
  }

  return blocks.filter((block) => block.kind !== 'paragraph' || block.text.length > 0);
}
