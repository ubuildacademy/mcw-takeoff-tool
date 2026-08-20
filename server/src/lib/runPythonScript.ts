/**
 * Run one of the Python passes as a child process, streaming its stderr.
 *
 * bubbleOcrExtractor and vectorCalloutExtractor each carried an identical ~125-line
 * copy of this — the vector one was even commented "Same spawn/stream contract as
 * bubbleOcrExtractor.runScript". Only the timeout, the stdout cap, the log emoji and
 * four error-message labels ever differed, so those are the parameters.
 *
 * `spawn` rather than `exec`, for two reasons:
 *   1) The scripts emit per-page progress to stderr (`... page N/M: ...`). Buffering
 *      it for the whole run defeats the purpose — we want it streamed live.
 *   2) `exec` swallows the SIGTERM cause with `code: null` + empty stderr, making
 *      timeouts indistinguishable from missing-binary errors. With `spawn` we can
 *      react to `close` with `signal` set.
 */
import { spawn } from 'child_process';
import { devLog } from './devLog';

/** Recent stderr lines, kept as a small ring so error messages can include them
 *  without blowing memory on chatty failure modes. */
const STDERR_TAIL_LINES = 40;

export interface RunPythonScriptOptions {
  command: string;
  args: string[];
  /** PATH for the child, already extended with the interpreter's location. */
  enhancedPath: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  /** Prefix on each forwarded stderr line in the server log, e.g. '🫧'. */
  logPrefix: string;
  /** Lower-case pass name used in error messages, e.g. 'bubble OCR'. */
  label: string;
  /** Called for each `page N/M` progress line the script emits. */
  onPage?: (page: number, totalPages: number) => void;
}

export function runPythonScript(
  options: RunPythonScriptOptions
): Promise<{ stdout: string; stderrTail: string }> {
  const { command, args, enhancedPath, timeoutMs, maxStdoutBytes, logPrefix, label, onPage } =
    options;
  const Label = label.charAt(0).toUpperCase() + label.slice(1);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, PATH: enhancedPath, PYTHONUNBUFFERED: '1' },
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutOverflow = false;
    const stderrTail: string[] = [];
    let stderrLineBuf = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // best effort -- the promise still rejects below via 'close'
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutOverflow) return;
      if (stdoutBytes + chunk.length > maxStdoutBytes) {
        stdoutOverflow = true;
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrLineBuf += chunk.toString('utf8');
      let nlIdx: number;
      while ((nlIdx = stderrLineBuf.indexOf('\n')) !== -1) {
        const line = stderrLineBuf.slice(0, nlIdx).trimEnd();
        stderrLineBuf = stderrLineBuf.slice(nlIdx + 1);
        if (!line) continue;
        // Forward script progress straight to the server log; the user can tail this
        // terminal during an Auto-hyperlink run and see live N/M.
        devLog(`${logPrefix} ${line}`);
        // Surface per-page progress to the caller (e.g. the run-status map the client
        // polls).
        if (onPage) {
          const m = line.match(/\bpage (\d+)\/(\d+)\b/);
          if (m) onPage(parseInt(m[1], 10), parseInt(m[2], 10));
        }
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to start ${label} script: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // Flush any trailing stderr line that didn't end in newline.
      const trailing = stderrLineBuf.trim();
      if (trailing) {
        devLog(`${logPrefix} ${trailing}`);
        stderrTail.push(trailing);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }

      if (stdoutOverflow) {
        return reject(new Error(`${Label} stdout exceeded ${maxStdoutBytes} bytes`));
      }

      if (timedOut) {
        return reject(new Error(`${Label} pass timed out after ${timeoutMs / 1000}s`));
      }

      if (code !== 0) {
        const sigSuffix = signal ? ` (signal: ${signal})` : '';
        const tail = stderrTail.slice(-5).join('\n  ');
        return reject(
          new Error(
            `${Label} script exited with code ${code}${sigSuffix}` + (tail ? `\n  ${tail}` : '')
          )
        );
      }

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderrTail: stderrTail.slice(-10).join('\n  '),
      });
    });
  });
}
