/**
 * Singleton console-error capture for feedback submissions.
 * Intercepts console.error, window.onerror, and unhandledrejection.
 * Initialised once from main.tsx before the React tree mounts.
 */

export interface CapturedLog {
  level: 'error';
  message: string;
  timestamp: string;
}

const MAX_ENTRIES = 30;
const _logs: CapturedLog[] = [];
let _initialized = false;

function push(entry: CapturedLog): void {
  if (_logs.length >= MAX_ENTRIES) _logs.shift();
  _logs.push(entry);
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

export function initConsoleCapture(): void {
  if (_initialized || typeof window === 'undefined') return;
  _initialized = true;

  const _origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    _origError(...args);
    push({ level: 'error', message: formatArgs(args), timestamp: new Date().toISOString() });
  };

  window.addEventListener('error', (e) => {
    push({
      level: 'error',
      message: `Uncaught: ${e.message}${e.filename ? ` (${e.filename}:${e.lineno ?? ''})` : ''}`,
      timestamp: new Date().toISOString(),
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg =
      reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? 'Unknown rejection');
    push({ level: 'error', message: `Unhandled rejection: ${msg}`, timestamp: new Date().toISOString() });
  });
}

export function getCapturedLogs(): CapturedLog[] {
  return [..._logs];
}

export function clearCapturedLogs(): void {
  _logs.length = 0;
}
