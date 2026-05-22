import { describe, expect, it } from 'vitest';
import {
  isValidEmail,
  isValidUUID,
  isValidUUIDAnyVersion,
  sanitizeString,
} from './validation';

describe('isValidUUID', () => {
  it('accepts UUID v4', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects non-v4 UUID', () => {
    expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
  });
});

describe('isValidUUIDAnyVersion', () => {
  it('accepts v1 and v4', () => {
    expect(isValidUUIDAnyVersion('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    expect(isValidUUIDAnyVersion('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
});

describe('isValidEmail', () => {
  it('accepts simple addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  it('rejects missing domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });
});

describe('sanitizeString', () => {
  it('strips angle brackets and trims', () => {
    expect(sanitizeString('  hello <script>  ')).toBe('hello script');
  });

  it('limits length', () => {
    expect(sanitizeString('a'.repeat(10001)).length).toBe(10000);
  });

  it('returns non-strings unchanged', () => {
    expect(sanitizeString(42 as unknown as string)).toBe(42);
  });
});
