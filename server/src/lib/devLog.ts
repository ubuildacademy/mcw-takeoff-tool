const isDev = process.env.NODE_ENV !== 'production';

/** Verbose server tracing; silent in production. */
export function devLog(...args: unknown[]): void {
  if (isDev) console.log(...args);
}

export function devWarn(...args: unknown[]): void {
  if (isDev) console.warn(...args);
}
