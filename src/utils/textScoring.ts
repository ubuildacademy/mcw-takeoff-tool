/**
 * Shared rare-term (IDF) scoring primitives for question-aware content selection.
 * Used by chatContext.ts (OCR page retrieval) and kbPacking.ts (KB section packing) —
 * both score chunks of text against a user's question the same way: tokenize, weight
 * rare terms higher than common ones (inverse document frequency across the chunk
 * corpus), sum per-chunk.
 */

export const STOPWORDS = new Set([
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

/** Occurrence count of a question token within a chunk is capped at this before weighting. */
export const MAX_TOKEN_OCCURRENCE_WEIGHT = 5;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countOccurrences(token: string, text: string): number {
  const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

/** Document frequency per token across a corpus of chunk texts (for IDF weighting). */
export function computeDocFrequency(tokens: string[], corpusTexts: string[]): Map<string, number> {
  const docFrequency = new Map<string, number>();
  for (const token of tokens) {
    let df = 0;
    for (const text of corpusTexts) {
      if (countOccurrences(token, text) > 0) df++;
    }
    docFrequency.set(token, df);
  }
  return docFrequency;
}

/** Inverse document frequency: rarer tokens (lower df) score higher. */
export function idf(token: string, docFrequency: Map<string, number>, corpusSize: number): number {
  const df = docFrequency.get(token) ?? 0;
  return Math.log((corpusSize + 1) / (df + 1)) + 1;
}

/**
 * Sums IDF-weighted occurrence counts of questionTokens within text. Each token's
 * occurrence count is capped at MAX_TOKEN_OCCURRENCE_WEIGHT before weighting so a
 * single repeated term can't dominate the score.
 */
export function scoreTextForTokens(
  text: string,
  questionTokens: string[],
  docFrequency: Map<string, number>,
  corpusSize: number
): number {
  let score = 0;
  for (const token of questionTokens) {
    const occurrences = Math.min(countOccurrences(token, text), MAX_TOKEN_OCCURRENCE_WEIGHT);
    if (occurrences > 0) score += occurrences * idf(token, docFrequency, corpusSize);
  }
  return score;
}
