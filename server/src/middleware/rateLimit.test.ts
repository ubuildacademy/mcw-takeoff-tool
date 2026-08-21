import { describe, expect, it } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit } from './rateLimit';
import {
  FallbackRateLimitStore,
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../lib/rateLimitStore';

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

interface Outcome {
  passed: boolean;
  status: number;
  headers: Record<string, unknown>;
}

/**
 * Drives the middleware once and resolves when it has decided.
 *
 * The middleware counts asynchronously, so the decision lands a tick or more after
 * the call returns; resolving from `next` and from `json` is what makes that
 * observable without guessing at timers.
 */
function hit(limiter: ReturnType<typeof rateLimit>, req: Request): Promise<Outcome> {
  return new Promise((resolve) => {
    const headers: Record<string, unknown> = {};
    let status = 200;

    const res = {
      setHeader(name: string, value: unknown) {
        headers[name] = value;
      },
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        resolve({ passed: false, status, headers });
        return this;
      },
    } as unknown as Response;

    const next: NextFunction = () => resolve({ passed: true, status, headers });

    limiter(req, res, next);
  });
}

/** A fresh memory store per test, with no sweep timer to outlive the run. */
function memoryStore(): MemoryRateLimitStore {
  return new MemoryRateLimitStore(0);
}

describe('rateLimit key generation', () => {
  it('ignores a spoofed X-Forwarded-For and buckets on req.ip', async () => {
    // Regression test for the 2026-08-21 audit finding: the key was read from
    // the first entry of the client-supplied X-Forwarded-For header, so rotating
    // it minted a fresh bucket per request and the login limiter never fired.
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 3, store: memoryStore() });
    const attacker = '203.0.113.9';

    expect((await hit(limiter, makeReq(attacker, '1.1.1.1'))).passed).toBe(true);
    expect((await hit(limiter, makeReq(attacker, '2.2.2.2'))).passed).toBe(true);
    expect((await hit(limiter, makeReq(attacker, '3.3.3.3'))).passed).toBe(true);

    // Fourth attempt from the same real IP is blocked despite a fourth fake header.
    const blocked = await hit(limiter, makeReq(attacker, '4.4.4.4'));
    expect(blocked.passed).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['Retry-After']).toBeTypeOf('number');
  });

  it('keeps separate clients in separate buckets', async () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 1, store: memoryStore() });

    expect((await hit(limiter, makeReq('198.51.100.1'))).passed).toBe(true);
    expect((await hit(limiter, makeReq('198.51.100.1'))).passed).toBe(false);
    // A genuinely different client is unaffected by the first one's exhaustion.
    expect((await hit(limiter, makeReq('198.51.100.2'))).passed).toBe(true);
  });

  it('reports the remaining allowance in the headers', async () => {
    const limiter = rateLimit({ windowMs: 60_000, maxRequests: 2, store: memoryStore() });

    const first = await hit(limiter, makeReq('198.51.100.7'));
    expect(first.headers['X-RateLimit-Limit']).toBe(2);
    expect(first.headers['X-RateLimit-Remaining']).toBe(1);

    const second = await hit(limiter, makeReq('198.51.100.7'));
    expect(second.headers['X-RateLimit-Remaining']).toBe(0);
  });
});

describe('shared counters across instances', () => {
  it('counts two server instances against one budget', async () => {
    // Item 27: production runs two Railway instances, and a per-process Map gave each
    // its own counter, so the real allowance was double what was configured. Two
    // limiters sharing one store stand in for those two instances.
    const shared = memoryStore();
    const instanceA = rateLimit({ windowMs: 60_000, maxRequests: 2, store: shared });
    const instanceB = rateLimit({ windowMs: 60_000, maxRequests: 2, store: shared });
    const client = makeReq('203.0.113.50');

    expect((await hit(instanceA, client)).passed).toBe(true);
    expect((await hit(instanceB, client)).passed).toBe(true);

    // The third request is over budget whichever instance receives it.
    expect((await hit(instanceA, client)).passed).toBe(false);
    expect((await hit(instanceB, client)).passed).toBe(false);
  });

  it('would have let the same traffic through when each instance counted alone', async () => {
    // The old behaviour, kept as a contrast so the fix's point stays legible.
    const instanceA = rateLimit({ windowMs: 60_000, maxRequests: 2, store: memoryStore() });
    const instanceB = rateLimit({ windowMs: 60_000, maxRequests: 2, store: memoryStore() });
    const client = makeReq('203.0.113.51');

    expect((await hit(instanceA, client)).passed).toBe(true);
    expect((await hit(instanceB, client)).passed).toBe(true);
    expect((await hit(instanceA, client)).passed).toBe(true);
    expect((await hit(instanceB, client)).passed).toBe(true);
  });
});

describe('RedisRateLimitStore', () => {
  /** Stands in for ioredis, running the same contract the Lua script implements. */
  function fakeRedis() {
    const keys = new Map<string, { count: number; expiresAt: number }>();
    return {
      keys,
      async eval(_script: string, _numKeys: number, key: string, windowMs: string) {
        const now = Date.now();
        const existing = keys.get(key);
        if (!existing || existing.expiresAt <= now) {
          keys.set(key, { count: 1, expiresAt: now + Number(windowMs) });
          return [1, Number(windowMs)];
        }
        existing.count += 1;
        return [existing.count, existing.expiresAt - now];
      },
    };
  }

  it('namespaces keys so it cannot collide with the queue data in the same Redis', async () => {
    const client = fakeRedis();
    const store = new RedisRateLimitStore(client as never);

    await store.hit('203.0.113.1', 60_000);

    expect([...client.keys.keys()]).toEqual(['rl:203.0.113.1']);
  });

  it('counts up and reports a reset time inside the window', async () => {
    const store = new RedisRateLimitStore(fakeRedis() as never);

    const first = await store.hit('k', 60_000);
    const second = await store.hit('k', 60_000);

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.resetTime).toBeGreaterThan(Date.now());
    expect(second.resetTime).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});

describe('FallbackRateLimitStore', () => {
  it('degrades to the backup store when the primary throws', async () => {
    const broken: RateLimitStore = {
      hit: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const store = new FallbackRateLimitStore(broken, memoryStore());

    // Still counts, just per-process — a Redis outage must not become an API outage.
    expect((await store.hit('k', 60_000)).count).toBe(1);
    expect((await store.hit('k', 60_000)).count).toBe(2);
  });

  it('prefers the primary while it is healthy', async () => {
    const backup = memoryStore();
    const store = new FallbackRateLimitStore(new RedisRateLimitStore(
      { async eval() { return [42, 1000]; } } as never
    ), backup);

    expect((await store.hit('k', 60_000)).count).toBe(42);
  });
});
