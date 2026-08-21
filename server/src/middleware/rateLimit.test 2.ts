import { describe, expect, it } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from './rateLimit';

/**
 * A request as the limiter sees it. `ip` is what Express derived from the
 * `trust proxy` hop count; the raw header is included precisely to prove the
 * limiter ignores it.
 */
function makeReq(ip: string, forwardedFor?: string): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    body: undefined as unknown,
    setHeader(name: string, value: unknown) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & typeof res;
}

/** Drives the middleware once, reporting whether it passed the request through. */
function hit(limiter: ReturnType<typeof rateLimit>, req: Request): boolean {
  let passed = false;
  const next: NextFunction = () => {
    passed = true;
  };
  limiter(req, makeRes(), next);
  return passed;
}

describe('rateLimit key generation', () => {
  it('ignores a spoofed X-Forwarded-For and buckets on req.ip', () => {
    // Regression test for the 2026-08-21 audit finding: the key was read from
    // the first entry of the client-supplied X-Forwarded-For header, so rotating
    // it minted a fresh bucket per request and the login limiter never fired.
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3 });
    const attacker = '203.0.113.9';

    expect(hit(limiter, makeReq(attacker, '1.1.1.1'))).toBe(true);
    expect(hit(limiter, makeReq(attacker, '2.2.2.2'))).toBe(true);
    expect(hit(limiter, makeReq(attacker, '3.3.3.3'))).toBe(true);
    // Fourth attempt from the same real IP is blocked despite a fourth fake header.
    expect(hit(limiter, makeReq(attacker, '4.4.4.4'))).toBe(false);
  });

  it('keeps separate clients in separate buckets', () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1 });

    expect(hit(limiter, makeReq('198.51.100.1'))).toBe(true);
    expect(hit(limiter, makeReq('198.51.100.1'))).toBe(false);
    // A genuinely different client is unaffected by the first one's exhaustion.
    expect(hit(limiter, makeReq('198.51.100.2'))).toBe(true);
  });
});
