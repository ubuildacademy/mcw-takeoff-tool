/**
 * Section-aware packing for knowledge-base content injected into the chat system
 * prompt. A KB over the char budget used to be tail-truncated — whatever fell past
 * the cutoff (e.g. an ASTM standards section at the end of a long trade KB) never
 * reached the model. This splits the KB on its section-header conventions, scores
 * each section against the user's question (same rare-term/IDF scoring as OCR page
 * retrieval — see textScoring.ts), and packs whole sections into the budget, highest
 * score first. A section is never cut mid-body. Works per-KB / per-trade: nothing
 * here is specific to any one knowledge base's content.
 */

import { tokenize, computeDocFrequency, scoreTextForTokens } from './textScoring';

interface KbSection {
  /** Section title (from its header), or null for a leading headerless chunk. */
  title: string | null;
  /** Raw original text of the section, including its header lines verbatim. */
  text: string;
  /** Index of the section in original document order (for re-sorting after packing). */
  order: number;
}

const EQUALS_INLINE_HEADER = /^\s*={3,}\s*(.+?)\s*={3,}\s*$/;
const DASH_INLINE_HEADER = /^\s*-{3,}\s*(.+?)\s*-{3,}\s*$/;
const PURE_DIVIDER = /^\s*(=|-)\1{2,}\s*$/;

function dividerChar(line: string): '=' | '-' | null {
  const trimmed = line.trim();
  if (/^=+$/.test(trimmed)) return '=';
  if (/^-+$/.test(trimmed)) return '-';
  return null;
}

/** True if `line` opens a new section: an inline `=== TITLE ===` / `---TITLE---` header. */
function matchInlineHeader(line: string): string | null {
  const eq = line.match(EQUALS_INLINE_HEADER);
  if (eq) return eq[1].trim();
  const dash = line.match(DASH_INLINE_HEADER);
  if (dash) return dash[1].trim();
  return null;
}

/**
 * Splits KB content into whole sections on its existing header conventions:
 * a single-line `=== TITLE ===` / `---TITLE---` header, or a three-line block
 * (divider line, title line, matching divider line) as used by the built-in
 * trade KB content. Content with no headers at all comes back as one section.
 */
export function splitIntoSections(content: string): KbSection[] {
  const lines = content.split('\n');
  const sections: KbSection[] = [];
  let order = 0;

  let currentTitle: string | null = null;
  let bodyStart = 0;

  const flush = (endExclusive: number) => {
    if (endExclusive <= bodyStart) return;
    const text = lines.slice(bodyStart, endExclusive).join('\n');
    if (text.trim().length === 0) return;
    sections.push({ title: currentTitle, text, order: order++ });
  };

  let i = 0;
  while (i < lines.length) {
    const divChar = dividerChar(lines[i]);

    // A pure divider line (just "===" or "---") is only a header when it opens a
    // divider/title/divider block. On its own it's never an inline header match —
    // check that first so a lone divider line doesn't get misread as `=== - ===`.
    if (divChar) {
      if (
        i + 2 < lines.length &&
        lines[i + 1].trim().length > 0 &&
        !PURE_DIVIDER.test(lines[i + 1]) &&
        dividerChar(lines[i + 2]) === divChar
      ) {
        flush(i);
        currentTitle = lines[i + 1].trim();
        bodyStart = i;
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    const inlineTitle = matchInlineHeader(lines[i]);
    if (inlineTitle !== null) {
      flush(i);
      currentTitle = inlineTitle;
      bodyStart = i;
      i += 1;
      continue;
    }

    i += 1;
  }
  flush(lines.length);

  return sections;
}

function titleMatchesQuestion(title: string | null, questionTokens: string[]): boolean {
  if (!title || questionTokens.length === 0) return false;
  const titleTokens = new Set(tokenize(title));
  return questionTokens.some((token) => titleTokens.has(token));
}

/**
 * Packs KB content into charBudget for injection into the chat system prompt.
 * If the content already fits, it is returned unchanged (byte-identical). Otherwise
 * the content is split into sections, each scored against the question (rare-term
 * IDF scoring), and whole sections are packed highest-score-first until the budget
 * is used. A section whose header directly matches a question term is always
 * included first. Sections are never cut mid-body — a section that doesn't fit is
 * dropped entirely, not truncated.
 */
export function packKnowledgeBase(content: string, question: string, charBudget: number): string {
  if (content.length <= charBudget) return content;

  const sections = splitIntoSections(content);
  if (sections.length === 0) return '';

  const questionTokens = Array.from(new Set(tokenize(question)));
  const docFrequency = computeDocFrequency(questionTokens, sections.map((s) => s.text));
  const corpusSize = sections.length;

  const withScores = sections.map((section) => ({
    section,
    score: scoreTextForTokens(section.text, questionTokens, docFrequency, corpusSize),
    directMatch: titleMatchesQuestion(section.title, questionTokens),
  }));

  const priorityOrder = [...withScores].sort((a, b) => {
    if (a.directMatch !== b.directMatch) return a.directMatch ? -1 : 1;
    return b.score - a.score;
  });

  const selected: KbSection[] = [];
  let usedChars = 0;
  for (const candidate of priorityOrder) {
    const addedLength = candidate.section.text.length + (selected.length > 0 ? 2 : 0); // "\n\n" join
    if (usedChars + addedLength > charBudget) continue;
    selected.push(candidate.section);
    usedChars += addedLength;
  }

  selected.sort((a, b) => a.order - b.order);
  return selected.map((s) => s.text).join('\n\n');
}
