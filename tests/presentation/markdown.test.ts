import { describe, expect, it } from 'vitest';

import { cleanMarkdownInline, parseMarkdownBlocks } from '@/src/presentation/markdown';

describe('chat markdown parsing', () => {
  it('keeps assistant tables renderable instead of collapsing them into plain text', () => {
    const blocks = parseMarkdownBlocks([
      'Here is dinner:',
      '',
      '| Item | Use first | Why |',
      '| --- | --- | --- |',
      '| Salmon | yes | thawed |',
      '| Rice | no | pantry base |',
      '',
      '- Cook salmon',
      '- Make bowl',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Here is dinner:' },
      {
        kind: 'table',
        headers: ['Item', 'Use first', 'Why'],
        rows: [
          ['Salmon', 'yes', 'thawed'],
          ['Rice', 'no', 'pantry base'],
        ],
      },
      { kind: 'list', ordered: false, items: ['Cook salmon', 'Make bowl'] },
    ]);
  });

  it('cleans common inline markdown noise for mobile bubbles', () => {
    expect(cleanMarkdownInline('**Use** [salmon](https://example.com) with `rice`')).toBe('Use salmon with rice');
  });
});
