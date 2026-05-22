import { describe, it, expect } from 'vitest';
import { validatePassword, PASSWORD_REQUIREMENTS } from './passwordValidation';

describe('validatePassword', () => {
  it('accepts a password that meets all rules', () => {
    expect(validatePassword('Abcd123!')).toEqual({ valid: true });
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePassword('Ab1!')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters long',
    });
  });

  it('rejects passwords without a number', () => {
    expect(validatePassword('Abcdefg!')).toEqual({
      valid: false,
      error: 'Password must include at least one number',
    });
  });

  it('rejects passwords without a special character', () => {
    expect(validatePassword('Abcdefg1')).toEqual({
      valid: false,
      error: 'Password must include at least one special character (!@#$%^&* etc.)',
    });
  });

  it('exports human-readable requirements text', () => {
    expect(PASSWORD_REQUIREMENTS).toContain('8 characters');
  });
});
