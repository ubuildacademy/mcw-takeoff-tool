export type AiGuardrailDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const allowKeywords = [
  // takeoff / estimating
  'takeoff', 'quantity', 'quantities', 'estimate', 'estimating', 'bid', 'pricing', 'unit price',
  'material', 'materials', 'labor', 'equipment', 'waste factor', 'overage', 'alternates',
  'scope', 'inclusions', 'exclusions', 'allowance',
  // documents / plans / specs
  'sheet', 'drawing', 'detail', 'section', 'spec', 'specification', 'submittal', 'rfi', 'addendum',
  'architect', 'engineer', 'gc', 'general contractor',
  // construction topics (broad, user-approved)
  'waterproofing', 'membrane', 'flashing', 'sealant', 'epoxy', 'primer', 'adhesive',
  'concrete', 'rebar', 'masonry', 'steel', 'framing', 'drywall', 'insulation',
  'asphalt', 'roof', 'roofing', 'deck', 'foundation', 'slab', 'wall',
  // math is allowed
  'calculate', 'calculation', 'math', 'geometry', 'area', 'perimeter', 'volume', 'slope', 'pitch',
];

const denyKeywords = [
  // explicit programming / software dev
  'write code', 'generate code', 'code for me', 'typescript', 'javascript', 'react', 'node', 'express',
  'python', 'java', 'c++', 'c#', 'golang', 'rust', 'sql query', 'database schema', 'api endpoint',
  'debug my code', 'stack trace', 'npm', 'pip install', 'dockerfile', 'kubernetes',
  // obvious general chatbot abuse
  'tell me a joke', 'write a poem', 'horoscope', 'trivia', 'celebrity',
];

const denyRegexes: RegExp[] = [
  /\b(leetcode|hackerrank|codewars)\b/i,
  /\b(build me|make me)\s+(a|an)\s+(website|app)\b/i,
  /\bcreate\s+(a|an)\s+(react|next\.?js|node)\b/i,
];

/**
 * Lightweight rule-based guardrails.
 * Goal: allow construction/estimating/math, block obvious non-construction coding/general-chat usage.
 */
export function evaluateAiChatGuardrails(text: string): AiGuardrailDecision {
  const t = normalize(text);
  if (!t) return { allowed: false, reason: 'Empty message' };

  const hasAllow =
    allowKeywords.some((k) => t.includes(k)) ||
    /\b(page|sheet|detail|section)\s*\d+/i.test(t) ||
    /\b\d+(\.\d+)?\s*(sf|sq\s*ft|sqft|lf|ft|in|yd|cy|m2|m²|m3|m³)\b/i.test(t);

  const hasDeny =
    denyKeywords.some((k) => t.includes(k)) ||
    denyRegexes.some((r) => r.test(t));

  // If it contains explicit dev signals and lacks any construction/takeoff signal, block.
  if (hasDeny && !hasAllow) {
    return {
      allowed: false,
      reason:
        'AI Assistant is limited to construction, estimating, takeoff, and related math questions (not general coding/software help).',
    };
  }

  // Default allow; server-side quota still applies.
  return { allowed: true };
}

