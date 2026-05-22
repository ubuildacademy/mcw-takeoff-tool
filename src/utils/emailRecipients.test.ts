import { describe, it, expect } from 'vitest';
import { parseRecipients, validateEmails, MAX_EMAIL_RECIPIENTS } from './emailRecipients';

describe('emailRecipients', () => {
  it('parseRecipients dedupes case-insensitively', () => {
    expect(parseRecipients('A@x.com, A@X.COM b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('validateEmails splits valid and invalid', () => {
    const { valid, invalid } = validateEmails(['good@x.com', 'bad', 'also@y.co']);
    expect(valid).toEqual(['good@x.com', 'also@y.co']);
    expect(invalid).toEqual(['bad']);
  });

  it('MAX_EMAIL_RECIPIENTS is 10', () => {
    expect(MAX_EMAIL_RECIPIENTS).toBe(10);
  });
});
