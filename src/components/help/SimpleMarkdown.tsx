import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { slugifyHeading } from './slugify';
import { HELP_STICKY_TOP_CLASS } from './helpConstants';

export type MarkdownBlock =
  | { type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'pre'; text: string }
  | { type: 'hr' }
  | { type: 'table'; header: string[]; rows: string[][] };

type Block = MarkdownBlock;

export type GuideTocEntry = { id: string; label: string };

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && /^[\s|:-]+$/.test(t) && t.includes('-');
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.includes('|') && !isTableSeparator(t) && splitTableCells(line).length >= 2;
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '---') {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'pre', text: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const types = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
      blocks.push({ type: types[level - 1], text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    if (line.match(/^[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, '').trim());
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (isTableRow(line)) {
      const tableRows: string[][] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        if (!isTableSeparator(lines[i])) {
          tableRows.push(splitTableCells(lines[i]));
        }
        i += 1;
      }
      if (tableRows.length > 0) {
        const [header, ...rows] = tableRows;
        blocks.push({ type: 'table', header, rows });
      }
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].match(/^[-*]\s+/) &&
      !lines[i].match(/^\d+\.\s+/) &&
      !lines[i].startsWith('```') &&
      lines[i].trim() !== '---' &&
      !isTableRow(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'p', text: paraLines.join(' ').trim() });
    } else {
      // Unrecognized line (e.g. malformed heading) — skip to avoid stalling the parser.
      i += 1;
    }
  }

  return blocks;
}

export function extractGuideToc(content: string): GuideTocEntry[] {
  const entries: GuideTocEntry[] = [];
  for (const block of parseMarkdownBlocks(content)) {
    if (block.type === 'h2') {
      entries.push({
        id: slugifyHeading(block.text),
        label: block.text.replace(/\*\*/g, ''),
      });
    }
  }
  return entries;
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        if (href.startsWith('#')) {
          parts.push(
            <a key={key++} href={href} className="text-primary underline-offset-2 hover:underline">
              {label}
            </a>
          );
        } else if (href.startsWith('/')) {
          parts.push(
            <Link key={key++} to={href} className="text-primary underline-offset-2 hover:underline">
              {label}
            </Link>
          );
        } else {
          parts.push(
            <a key={key++} href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          );
        }
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length ? parts : [text];
}

export function SimpleMarkdown({
  content,
  className,
  /** Hide the document # title when the page header already shows it (guide pages). */
  omitFirstH1 = false,
}: {
  content: string;
  className?: string;
  omitFirstH1?: boolean;
}) {
  const blocks = parseMarkdownBlocks(content);
  const firstH1Index = omitFirstH1 ? blocks.findIndex((block) => block.type === 'h1') : -1;

  return (
    <article className={cn('space-y-4 text-sm text-foreground leading-relaxed', className)}>
      {blocks.map((block, index) => {
        if (index === firstH1Index) return null;
        switch (block.type) {
          case 'h1':
            return (
              <h1 key={index} className="text-2xl font-bold tracking-tight mt-2 first:mt-0">
                {renderInline(block.text)}
              </h1>
            );
          case 'h2': {
            const id = slugifyHeading(block.text);
            return (
              <h2
                key={index}
                id={id}
                className={cn(
                  'text-xl font-semibold mt-6 border-b border-border pb-2',
                  HELP_STICKY_TOP_CLASS
                )}
              >
                {renderInline(block.text)}
              </h2>
            );
          }
          case 'h3': {
            const id = slugifyHeading(block.text);
            return (
              <h3
                key={index}
                id={id}
                className={cn('text-base font-semibold mt-4', HELP_STICKY_TOP_CLASS)}
              >
                {renderInline(block.text)}
              </h3>
            );
          }
          case 'h4': {
            const id = slugifyHeading(block.text);
            return (
              <h4
                key={index}
                id={id}
                className={cn('text-sm font-semibold mt-3', HELP_STICKY_TOP_CLASS)}
              >
                {renderInline(block.text)}
              </h4>
            );
          }
          case 'h5': {
            const id = slugifyHeading(block.text);
            return (
              <h5 key={index} id={id} className="text-sm font-medium mt-2">
                {renderInline(block.text)}
              </h5>
            );
          }
          case 'h6': {
            const id = slugifyHeading(block.text);
            return (
              <h6 key={index} id={id} className="text-xs font-medium mt-2 uppercase tracking-wide text-muted-foreground">
                {renderInline(block.text)}
              </h6>
            );
          }
          case 'p':
            return (
              <p key={index} className="text-muted-foreground">
                {renderInline(block.text)}
              </p>
            );
          case 'ul':
            return (
              <ul key={index} className="list-disc pl-5 space-y-1 text-muted-foreground">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={index} className="list-decimal pl-5 space-y-1 text-muted-foreground">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          case 'pre':
            return (
              <pre key={index} className="overflow-x-auto rounded-md bg-muted p-3 text-xs font-mono text-foreground">
                {block.text}
              </pre>
            );
          case 'hr':
            return <hr key={index} className="border-border" />;
          case 'table':
            return (
              <div key={index} className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      {block.header.map((cell, j) => (
                        <th key={j} className="px-3 py-2 text-left font-semibold text-foreground">
                          {renderInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-muted-foreground align-top">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </article>
  );
}
