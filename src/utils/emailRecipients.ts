/** Basic email shape check for recipient lists in share/report modals. */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Must match server `MAX_EMAIL_RECIPIENTS` in `server/src/config/deliveryLimits.ts`. */
export const MAX_EMAIL_RECIPIENTS = 10;

/** Parse comma/space/semicolon-separated recipient input; dedupe case-insensitively. */
export function parseRecipients(input: string): string[] {
  const parsed = input
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(parsed)];
}

export function validateEmails(emails: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const e of emails) {
    if (EMAIL_REGEX.test(e)) valid.push(e);
    else invalid.push(e);
  }
  return { valid, invalid };
}
