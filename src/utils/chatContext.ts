/**
 * Pure, testable helpers for building the AI chat's system-prompt context.
 *
 * Two pieces of context are built per message:
 *  1. A compact, static summary of the project (details, conditions, takeoff
 *     totals, document list) — cheap to build, no raw OCR text, always included.
 *  2. A question-aware retrieval over OCR page text — instead of stuffing every
 *     page of every document into the prompt (which silently gets truncated by
 *     Ollama's context window), we score pages against the user's question and
 *     only include the most relevant ones.
 */

// ---------------------------------------------------------------------------
// Static project context
// ---------------------------------------------------------------------------

/** Character budget for the static project context section (project/conditions/totals/docs). */
export const STATIC_CONTEXT_CHAR_BUDGET = 8000;

export interface StaticContextProject {
  name: string;
  client?: string;
  location?: string;
  projectType?: string;
  status?: string;
  description?: string;
  contactPerson?: string;
  contactEmail?: string;
  startDate?: string;
}

export interface StaticContextCondition {
  id: string;
  name: string;
  type: string;
  unit: string;
  wasteFactor: number;
  multiplier?: number;
  laborCost?: number;
  materialCost?: number;
  description?: string;
}

export interface StaticContextTotals {
  totalMeasurements: number;
  totalValue: number;
  byCondition: Record<string, { count: number; value: number; unit: string }>;
}

export interface StaticContextDocument {
  name: string;
  pageCount: number;
}

export interface BuildStaticProjectContextParams {
  projectId: string;
  project: StaticContextProject | null | undefined;
  conditions: StaticContextCondition[];
  totals: StaticContextTotals | null | undefined;
  documents: StaticContextDocument[];
}

/**
 * Builds a compact, complete summary of the project: details, every condition
 * (one line each), takeoff totals by condition (complete, not truncated), and
 * the document list (names + page counts). Contains NO raw OCR text.
 * Truncated (at a whitespace boundary) to STATIC_CONTEXT_CHAR_BUDGET chars.
 */
export function buildStaticProjectContext(params: BuildStaticProjectContextParams): string {
  const { projectId, project, conditions, totals, documents } = params;
  let context = `=== PROJECT OVERVIEW ===\n`;

  if (project) {
    context += `Project: ${project.name}\n`;
    context += `Client: ${project.client || 'Not specified'}\n`;
    context += `Location: ${project.location || 'Not specified'}\n`;
    context += `Project Type: ${project.projectType || 'Not specified'}\n`;
    context += `Status: ${project.status || 'active'}\n`;
    context += `Description: ${project.description || 'No description'}\n`;
    if (project.contactPerson) context += `Contact: ${project.contactPerson} (${project.contactEmail || 'No email'})\n`;
    if (project.startDate) context += `Start Date: ${project.startDate}\n`;
  } else {
    context += `Project ID: ${projectId}\n`;
  }

  if (conditions.length > 0) {
    context += `\n=== TAKEOFF CONDITIONS (${conditions.length}) ===\n`;
    for (const condition of conditions) {
      context += `- ${condition.name} (${condition.type}): ${condition.unit}`;
      if (condition.type !== 'count' && condition.type !== 'auto-count' && condition.wasteFactor > 0) {
        context += `, ${condition.wasteFactor}% waste`;
      }
      if ((condition.multiplier ?? 1) > 1) {
        context += `, ×${condition.multiplier} multiplier`;
      }
      if (condition.laborCost) context += `, $${condition.laborCost} labor cost`;
      if (condition.materialCost) context += `, $${condition.materialCost} material cost`;
      if (condition.description) context += ` - ${condition.description}`;
      context += `\n`;
    }
  }

  if (totals) {
    context += `\n=== TAKEOFF TOTALS ===\n`;
    context += `Total Measurements: ${totals.totalMeasurements}\n`;
    context += `Total Value: ${totals.totalValue}\n`;
    const byConditionEntries = Object.entries(totals.byCondition);
    if (byConditionEntries.length > 0) {
      context += `By Condition (complete list):\n`;
      for (const [conditionId, data] of byConditionEntries) {
        const condition = conditions.find((c) => c.id === conditionId);
        const conditionName = condition?.name || `Condition ${conditionId}`;
        context += `- ${conditionName}: ${data.count} measurements, ${data.value} ${data.unit}\n`;
      }
    }
  }

  context += `\n=== DOCUMENTS (${documents.length}) ===\n`;
  if (documents.length > 0) {
    for (const doc of documents) {
      context += `- ${doc.name} (${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'})\n`;
    }
  } else {
    context += `No documents uploaded to this project yet.\n`;
  }

  return truncateAtWhitespace(context, STATIC_CONTEXT_CHAR_BUDGET);
}

// ---------------------------------------------------------------------------
// Question-aware page retrieval
// ---------------------------------------------------------------------------

/** Total character budget across all retrieved pages. */
export const RETRIEVAL_TOTAL_CHAR_BUDGET = 24000;
/** Character budget for a single page's text before it gets cut. */
export const RETRIEVAL_PER_PAGE_CHAR_BUDGET = 6000;
/** Occurrence count of a question token within a page is capped at this before weighting. */
const MAX_TOKEN_OCCURRENCE_WEIGHT = 5;
/** Flat score boost applied to a page that contains a sheet-number reference also present in the question. */
const SHEET_REF_BOOST = 100000;

export interface ChatSourcePage {
  pageNumber: number;
  text: string;
}

export interface ChatSourceDoc {
  docId: string;
  docName: string;
  pages: ChatSourcePage[];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'with', 'that', 'this', 'from', 'have', 'has',
  'had', 'will', 'would', 'could', 'should', 'what', 'which', 'where', 'when',
  'how', 'why', 'who', 'whom', 'can', 'does', 'did', 'not', 'you', 'your',
  'yours', 'all', 'any', 'but', 'was', 'were', 'been', 'being', 'into', 'out',
  'about', 'over', 'under', 'than', 'then', 'them', 'they', 'their', 'its',
  'about', 'there', 'here', 'these', 'those', 'such', 'some', 'each', 'every',
  'much', 'many', 'more', 'most', 'need', 'want', 'like', 'just', 'also',
  'tell', 'show', 'give', 'let', 'per', 'via', 'our', 'ours', 'me', 'my',
  'please', 'thanks', 'okay', 'yes', 'sheet', 'page', 'document',
]);

/** Sheet-number-ish patterns, e.g. A-101, S1.2, M-100, E101. */
const SHEET_REF_REGEX = /\b[A-Z]{1,3}[-.]?\d{1,4}(?:\.\d+)?\b/gi;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeSheetRef(ref: string): string {
  return ref.toUpperCase().replace(/[-.]/g, '');
}

function extractSheetRefs(text: string): Set<string> {
  const matches = text.match(SHEET_REF_REGEX) ?? [];
  return new Set(matches.map(normalizeSheetRef));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(token: string, text: string): number {
  const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

/** Cuts text to at most maxLen chars, breaking on a whitespace boundary rather than mid-word. */
function truncateAtWhitespace(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  const cut = lastBreak > maxLen * 0.5 ? slice.slice(0, lastBreak) : slice;
  return `${cut.trimEnd()}…`;
}

interface ScoredPage {
  docId: string;
  docName: string;
  pageNumber: number;
  text: string;
  score: number;
}

function formatPage(page: ScoredPage): string {
  const text = truncateAtWhitespace(page.text, RETRIEVAL_PER_PAGE_CHAR_BUDGET);
  return `── ${page.docName} — page ${page.pageNumber} ──\n${text}`;
}

/**
 * Scores and selects the most relevant OCR pages for the user's question, formatted
 * for injection into the system prompt. Question tokens are weighted by inverse
 * document frequency across all pages (rare terms count more than common ones), and
 * pages containing a sheet-number reference (e.g. "A-101") that also appears in the
 * question get a large score boost. Falls back to the first page of each document
 * (titleblock/index sheets) when every page scores 0 — e.g. for generic questions.
 */
export function retrieveRelevantPages(question: string, docs: ChatSourceDoc[]): string {
  const allPages: Array<{ docId: string; docName: string; page: ChatSourcePage }> = [];
  for (const doc of docs) {
    for (const page of doc.pages) {
      if (page && page.text) {
        allPages.push({ docId: doc.docId, docName: doc.docName, page });
      }
    }
  }
  if (allPages.length === 0) return '';

  const questionTokens = Array.from(new Set(tokenize(question)));
  const questionSheetRefs = extractSheetRefs(question);

  // Document frequency per question token, for IDF weighting (rare terms score higher).
  const docFrequency = new Map<string, number>();
  if (questionTokens.length > 0) {
    for (const token of questionTokens) {
      let df = 0;
      for (const { page } of allPages) {
        if (countOccurrences(token, page.text) > 0) df++;
      }
      docFrequency.set(token, df);
    }
  }
  const totalPages = allPages.length;
  const idf = (token: string): number => {
    const df = docFrequency.get(token) ?? 0;
    return Math.log((totalPages + 1) / (df + 1)) + 1;
  };

  const scored: ScoredPage[] = allPages.map(({ docId, docName, page }) => {
    let score = 0;
    for (const token of questionTokens) {
      const occurrences = Math.min(countOccurrences(token, page.text), MAX_TOKEN_OCCURRENCE_WEIGHT);
      if (occurrences > 0) score += occurrences * idf(token);
    }
    if (questionSheetRefs.size > 0) {
      const pageRefs = extractSheetRefs(page.text);
      for (const ref of pageRefs) {
        if (questionSheetRefs.has(ref)) {
          score += SHEET_REF_BOOST;
          break;
        }
      }
    }
    return { docId, docName, pageNumber: page.pageNumber, text: page.text, score };
  });

  let candidates = scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    // Generic question / no term overlap: fall back to each document's first page
    // (titleblock/index sheets), in document order.
    const firstPageByDoc = new Map<string, ScoredPage>();
    for (const p of scored) {
      const existing = firstPageByDoc.get(p.docId);
      if (!existing || p.pageNumber < existing.pageNumber) {
        firstPageByDoc.set(p.docId, p);
      }
    }
    candidates = Array.from(firstPageByDoc.values());
  }

  const selected: string[] = [];
  let usedChars = 0;
  for (const page of candidates) {
    const formatted = formatPage(page);
    const addedLength = formatted.length + (selected.length > 0 ? 2 : 0); // "\n\n" join
    if (usedChars + addedLength > RETRIEVAL_TOTAL_CHAR_BUDGET) break;
    selected.push(formatted);
    usedChars += addedLength;
  }

  return selected.join('\n\n');
}
