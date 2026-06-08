import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from './SimpleMarkdown';

describe('parseMarkdownBlocks', () => {
  it('parses embed and image blocks', () => {
    const md = '{{workspace-layout}}\n\n![Workspace screenshot](/help/workspace.png)';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks[0]).toEqual({ type: 'embed', id: 'workspace-layout' });
    expect(blocks[1]).toEqual({ type: 'img', alt: 'Workspace screenshot', src: '/help/workspace.png' });
  });

  it('parses h4 headings without stalling', () => {
    const md = '### Section\n\n#### Titleblock extraction\n\nBody text.';
    const blocks = parseMarkdownBlocks(md);
    expect(blocks.some((block) => block.type === 'h4' && block.text === 'Titleblock extraction')).toBe(true);
  });

  it('parses the full workspace guide', () => {
    const md = readFileSync(join(process.cwd(), 'docs/WORKSPACE_GUIDE.md'), 'utf8');
    const blocks = parseMarkdownBlocks(md);
    expect(blocks.length).toBeGreaterThan(20);
    expect(blocks.some((block) => block.type === 'h4' && block.text === 'Titleblock extraction')).toBe(true);
  });

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
