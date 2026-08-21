/**
 * Where rate-limit counters live.
 *
 * They used to live in a `Map` inside the middleware, which is correct only when
 * exactly one process serves the traffic. Production runs two Railway instances, so
 * every configured limit was silently multiplied by the instance count — the login
 * limiter advertised 10 attempts per 15 minutes and allowed about 20, and that number
 * would grow with every instance added. Item 27 in docs/OPEN_ITEMS.md has the
 * measurement that found it.
 *
 * The shared counter is Redis, which the same Railway project already runs for BullMQ.
 * `services/queueService.ts` cannot be reused for the connection: importing it
 * constructs a Queue and a Worker as a side effect, which is not something a piece of
 * request middleware should drag in. This module opens its own small client instead.
 *
 * Redis is not required. With no REDIS_URL the in-memory store is used, which is the
 * right behaviour for local development and for single-instance deployments, and is
 * also where we land if Redis stops answering.
 */

import { Redis } from 'ioredis';
import { devLog } from './devLog';

export interface RateLimitHit {
  /** Requests counted in the current window, including this one. */
  count: number;
  /** Epoch milliseconds when the window expires. */
  resetTime: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
}

/* ------------------------------------------------------------------ in memory */

interface MemoryEntry {
  count: number;
  resetTime: number;
}

/**
 * Per-process counters. Correct for one instance, an undercount for more than one.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, MemoryEntry>();
  private sweeper: NodeJS.Timeout | undefined;

  /**
   * @param sweepMs How often to drop expired entries. Pass 0 to skip the timer,
   *   which tests want so a pending interval cannot keep the process alive.
   */
  constructor(sweepMs = 5 * 60 * 1000) {
    if (sweepMs > 0) {
      this.sweeper = setInterval(() => this.sweep(), sweepMs);
      // Do not hold the event loop open just to tidy a cache.
      this.sweeper.unref?.();
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.resetTime < now) this.entries.delete(key);
    }
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (!existing || existing.resetTime < now) {
      const fresh = { count: 1, resetTime: now + windowMs };
      this.entries.set(key, fresh);
      return { ...fresh };
    }

    existing.count += 1;
    return { ...existing };
  }

  /** Tests only — drops the sweep timer. */
  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }
}

/* ---------------------------------------------------------------------- redis */

/**
 * Increment and read the remaining TTL in one atomic step.
 *
 * Two calls would race: between INCR and PEXPIRE another instance can observe the key
 * without a TTL, and a key with no expiry never resets — one burst would lock a client
 * out permanently. Reading PTTL back rather than assuming the window also keeps the
 * reset time honest for every request after the first.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private client: Redis) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const result = (await this.client.eval(
      HIT_SCRIPT,
      1,
      `rl:${key}`,
      String(windowMs)
    )) as [number, number];

    const [count, ttl] = result;
    return { count, resetTime: Date.now() + ttl };
  }
}

/* ------------------------------------------------------------------ selection */

/**
 * Falls back to memory whenever Redis errors, so a Redis outage degrades the limiter
 * to per-process counting instead of taking the API down with it. Rate limiting is a
 * control worth keeping approximate rather than losing entirely.
 */
export class FallbackRateLimitStore implements RateLimitStore {
  private warned = false;
  /** Epoch ms of the last warning, so a persistent outage keeps saying so. */
  private lastWarnedAt = 0;
  /** While set and in the future, skip the primary entirely. */
  private skipPrimaryUntil = 0;

  /**
   * @param cooldownMs How long to stop trying the primary after it fails. Without
   *   this, every request during a Redis outage waits out its own `commandTimeout`
   *   before falling back — turning a degraded counter into latency on the whole API.
   *   One request pays the timeout, the rest go straight to memory until the cooldown
   *   lapses and one probe re-tests the connection.
   */
  constructor(
    private primary: RateLimitStore,
    private backup: RateLimitStore,
    private cooldownMs = 5000
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    if (Date.now() < this.skipPrimaryUntil) {
      return this.backup.hit(key, windowMs);
    }

    try {
      const result = await this.primary.hit(key, windowMs);
      if (this.warned) {
        this.warned = false;
        console.log('🪣 Rate limiting: Redis is answering again, counters are shared once more.');
      }
      return result;
    } catch (error) {
      const now = Date.now();
      this.skipPrimaryUntil = now + this.cooldownMs;
      // console.error, not devLog: losing the shared counter is something an operator
      // needs to see, and devLog is a no-op in production. Repeat at most once a
      // minute rather than once per process — warning a single time meant a permanent
      // outage produced one line at boot and then looked exactly like health, which
      // is how this stayed invisible during the 2026-08-21 investigation.
      if (!this.warned || now - this.lastWarnedAt > 60_000) {
        this.warned = true;
        this.lastWarnedAt = now;
        console.error(
          '⚠️  Rate limiting is using per-process counters — Redis is not answering:',
          error instanceof Error ? error.message : error
        );
      }
      return this.backup.hit(key, windowMs);
    }
  }
}

let sharedStore: RateLimitStore | undefined;

/**
 * The store every limiter shares. Built once, on first use.
 *
 * Unlike `queueService`, this does NOT default to `redis://localhost:6379` when the
 * environment says nothing. A default would make every local run without Redis spend
 * its time reconnecting and reporting failures for a feature that is happy in memory;
 * opting in on REDIS_URL keeps development quiet and production shared.
 */
export function getRateLimitStore(): RateLimitStore {
  if (sharedStore) return sharedStore;

  const url = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
  const memory = new MemoryRateLimitStore();

  if (!url) {
    // In development this is the normal, quiet case. In production it means every
    // instance is counting alone, so the configured limits are silently multiplied by
    // the instance count — the exact defect item 27 set out to fix. Say so where an
    // operator can see it: devLog is a no-op in production, so using it here would
    // hide the degraded state and leave only the healthy path visible in the logs.
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️  Rate limiting: no REDIS_URL, falling back to per-process counters. ' +
          'With more than one instance every configured limit is multiplied by the ' +
          'instance count. Set REDIS_URL on this service to share them.'
      );
    } else {
      devLog('🪣 Rate limiting: in-memory (no REDIS_URL). Counters are per process.');
    }
    sharedStore = memory;
    return sharedStore;
  }

  const client = new Redis(url, {
    // The offline queue stays ON. Turning it off looks like the careful choice for a
    // limiter — never queue behind a dead Redis — but it also rejects every command
    // issued between connect() and 'ready', which is exactly the window the server
    // boots into. In production that surfaced as
    // "Stream isn't writeable and enableOfflineQueue options is false" against a
    // perfectly healthy Redis, dropping the first requests of every deploy onto the
    // per-process fallback.
    //
    // `commandTimeout` is the right control instead: a command waits out a normal
    // handshake but a genuinely unreachable Redis rejects quickly and we fall back,
    // so no request is ever held open waiting for a counter.
    enableOfflineQueue: true,
    commandTimeout: 500,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });

  // ioredis emits 'error' on every reconnect attempt. Without a listener those
  // become unhandled exceptions and take the process down. The first one is worth
  // seeing in production — a limiter that cannot reach Redis is counting alone —
  // while the rest are reconnect noise and stay at devLog.
  let reportedConnectionFailure = false;
  client.on('error', (err) => {
    if (!reportedConnectionFailure) {
      reportedConnectionFailure = true;
      console.warn('⚠️  Rate-limit Redis connection failed:', err.message);
      return;
    }
    devLog('🪣 Rate-limit Redis error:', err.message);
  });

  const safeUrl = url.replace(/:\/\/.*@/, '://***@');

  // Report the OUTCOME, not the intention. The line this replaced was printed here,
  // at construction, before a single byte had been sent — so it said "counters shared
  // across instances" whether or not Redis was reachable, and a production
  // investigation spent several rounds treating it as proof of a working connection.
  // A PING costs nothing and is the difference between announcing a plan and
  // reporting a fact.
  client
    .ping()
    .then(async () => {
      // PING only proves the socket works. Run the real counter path once, through
      // the same store the middleware uses, and print what came back. Every instance
      // increments the same key at boot, so on a healthy shared setup the replicas
      // report 1, 2, 3… — and a report of 1 from every instance is proof they are NOT
      // sharing, which is the exact question a PING cannot answer.
      try {
        const probe = await new RedisRateLimitStore(client).hit('__boot_probe__', 60_000);
        console.log(
          `🪣 Rate limiting: Redis OK at ${safeUrl} — shared-counter probe returned ` +
            `${probe.count} (each instance booting in the same minute should see a ` +
            'different number; every instance seeing 1 means they are not sharing)'
        );
      } catch (err) {
        console.error(
          `⚠️  Rate limiting: Redis at ${safeUrl} answered PING but the counter command ` +
            'failed, so counters are per process:',
          err instanceof Error ? err.message : err
        );
      }
    })
    .catch((err: unknown) => {
      console.error(
        `⚠️  Rate limiting: Redis at ${safeUrl} did NOT answer a startup PING, so counters ` +
          'are per process and every configured limit is multiplied by the instance count:',
        err instanceof Error ? err.message : err
      );
    });

  sharedStore = new FallbackRateLimitStore(new RedisRateLimitStore(client), memory);
  return sharedStore;
}

/** Tests only — forget the cached store so the next call rebuilds it. */
export function resetRateLimitStoreForTests(store?: RateLimitStore): void {
  sharedStore = store;
}
