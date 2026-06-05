import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from './SimpleMarkdown';

describe('parseMarkdownBlocks', () => {
  it('parses markdown tables', () => {
    const md = `| Action | Shortcut |
|--------|----------|
| **Undo** | Cmd+Z |
| **Redo** | Cmd+Y |`;

    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'table',
      header: ['Action', 'Shortcut'],
    });
    if (blocks[0].type === 'table') {
      expect(blocks[0].rows).toHaveLength(2);
    }
  });
});
