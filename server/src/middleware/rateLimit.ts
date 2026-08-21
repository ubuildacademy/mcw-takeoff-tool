import { Request, Response, NextFunction } from 'express';
import { getRateLimitStore, type RateLimitStore } from '../lib/rateLimitStore';

interface RateLimitOptions {
  windowMs?: number;      // Time window in milliseconds
  maxRequests?: number;   // Max requests per window
  message?: string;       // Error message
  keyGenerator?: (req: Request) => string;  // Custom key generator
  /** Tests only — inject a store instead of the shared one. */
  store?: RateLimitStore;
}

/**
 * Creates a rate limiter middleware.
 *
 * Counting is asynchronous because the counters are shared through Redis (see
 * `lib/rateLimitStore.ts`). The middleware keeps Express's synchronous signature and
 * drives the work in a floating promise, the same shape `requireAuth` uses — the
 * response is only ever produced inside that promise, so nothing races.
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = 60 * 1000,  // Default: 1 minute
    maxRequests = 100,      // Default: 100 requests per minute
    message = 'Too many requests, please try again later',
    keyGenerator = defaultKeyGenerator,
    store,
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const key = keyGenerator(req);

      let entry;
      try {
        entry = await (store ?? getRateLimitStore()).hit(key, windowMs);
      } catch (error) {
        // The store already falls back to memory on a Redis fault, so reaching here
        // means both paths failed. Let the request through rather than 500 it: a
        // broken limiter should not be an outage.
        console.error('Rate limit check failed, allowing request:', error);
        return next();
      }

      const retryAfterSec = Math.max(0, Math.ceil((entry.resetTime - Date.now()) / 1000));

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
      res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

      if (entry.count > maxRequests) {
        res.setHeader('Retry-After', retryAfterSec);
        res.status(429).json({
          error: message,
          retryAfter: retryAfterSec,
        });
        return;
      }

      next();
    })();
  };
}

/**
 * Default key generator - buckets by client IP.
 *
 * The IP comes from `req.ip`, which Express derives by walking `X-Forwarded-For`
 * right-to-left past exactly the number of hops named by the app's `trust proxy`
 * setting (see `TRUST_PROXY_HOPS` in index.ts). It must NOT be read from the
 * header directly: `X-Forwarded-For` is client-supplied, so taking its first
 * entry — as this did until 2026-08-21 — let any caller mint a fresh bucket per
 * request by rotating the header, which disabled `strictRateLimit` on the login
 * and signup routes entirely.
 *
 * There is deliberately no user id in the key. Every limiter is mounted before
 * the routes that call `requireAuth`, so `req.user` is always undefined here;
 * including it only ever appended a constant. The endpoints that most need a
 * limit are the unauthenticated ones, where IP is all there is.
 */
function defaultKeyGenerator(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Strict rate limiter for sensitive endpoints (login, signup, etc.)
 */
export const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 10,            // 10 requests per 15 minutes
  message: 'Too many attempts, please try again in 15 minutes'
});

/**
 * Standard rate limiter for API endpoints
 */
export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 100,           // 100 requests per minute
  message: 'Too many requests, please slow down'
});

/**
 * Generous rate limiter for read-heavy endpoints
 */
export const generousRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 300,           // 300 requests per minute
  message: 'Too many requests, please slow down'
});

/**
 * Upload rate limiter - stricter for file uploads
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 20,            // 20 uploads per minute
  message: 'Too many uploads, please wait before uploading more files'
});

/**
 * Send report rate limiter - 10 emails per project per hour
 */
export const sendReportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,
  message: 'Too many report emails sent for this project. Please try again in an hour.',
  keyGenerator: (req) => `send-report:${req.params.id || 'unknown'}:${req.user?.id || 'anonymous'}`
});

/**
 * Share project rate limiter - 10 shares per project per hour
 */
export const shareProjectRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,
  message: 'Too many project shares sent for this project. Please try again in an hour.',
  keyGenerator: (req) => `share-project:${req.params.id || 'unknown'}:${req.user?.id || 'anonymous'}`
});

/**
 * AI chat burst limiter (per-user).
 * NOTE: Daily quota is enforced separately with persistence.
 */
export const aiChatBurstRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 6,
  message: 'Too many AI chat requests, please slow down.',
  keyGenerator: (req) => `ai-chat:${req.user?.id || 'anonymous'}`
});

const imageInferenceBurstPerMinute = (): number => {
  const raw = Number.parseInt(process.env.IMAGE_INFERENCE_BURST_PER_MINUTE ?? '40', 10);
  if (!Number.isFinite(raw) || raw < 5) return 40;
  return Math.min(raw, 200);
};

/**
 * Extra per-user throttle for OCR/vision-heavy POSTs (beyond global /api write limit).
 * Use after {@link requireAuth} so keys include `req.user.id`.
 */
export const imageInferenceBurstRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: imageInferenceBurstPerMinute(),
  message: 'Too many image analysis requests. Please wait a moment and try again.',
  keyGenerator: (req) => `image-infer:${req.user?.id || defaultKeyGenerator(req)}`,
});
