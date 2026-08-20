/**
 * Custom error classes for better error handling and debugging
 */

/**
 * Base application error with context
 */
class AppError extends Error {
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: string;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Database operation errors (Supabase/PostgreSQL)
 */
export class DatabaseError extends AppError {
  public readonly code?: string;
  public readonly originalError?: unknown;

  constructor(message: string, originalError?: unknown, context?: Record<string, unknown>) {
    super(message, context);
    this.name = 'DatabaseError';
    this.originalError = originalError;
    
    // Extract error code if available (Supabase/PostgreSQL error codes)
    if (originalError && typeof originalError === 'object' && 'code' in originalError) {
      this.code = String((originalError as { code: unknown }).code);
    }
  }
}

/**
 * Helper to check if an error is a "not found" error from Supabase
 * PGRST116 = Row not found
 * PGRST205 = Multiple rows found (also treated as not found for single queries)
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === 'PGRST116' || code === 'PGRST205';
}

/**
 * Wraps a Supabase error into a DatabaseError with context
 */
export function wrapDatabaseError(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): DatabaseError {
  const message = error instanceof Error ? error.message : String(error);
  return new DatabaseError(
    `${operation} failed: ${message}`,
    error,
    context
  );
}
