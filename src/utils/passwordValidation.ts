/**
 * Password validation requirements:
 * - Minimum 8 characters
 * - At least one number
 * - At least one special character
 *
 * These requirements help protect against dictionary attacks and
 * credential stuffing. Brute-force protection also requires rate limiting
 * and account lockout on the server.
 */

const MIN_LENGTH = 8;
const HAS_NUMBER = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?`~]/;

export type PasswordValidationResult =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Validates a password against the required policy.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validatePassword(password: string): PasswordValidationResult {
  if (password.length < MIN_LENGTH) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  if (!HAS_NUMBER.test(password)) {
    return { valid: false, error: 'Password must include at least one number' };
  }
  if (!HAS_SPECIAL.test(password)) {
    return {
      valid: false,
      error: 'Password must include at least one special character (!@#$%^&* etc.)'
    };
  }
  return { valid: true };
}

/** Human-readable requirement string for placeholders and help text */
export const PASSWORD_REQUIREMENTS =
  'Min 8 characters, include a number and special character (!@#$%^&* etc.)';
