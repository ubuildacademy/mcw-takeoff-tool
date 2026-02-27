import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limiting
// For production, consider using Redis for distributed rate limiting
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs?: number;      // Time window in milliseconds
  maxRequests?: number;   // Max requests per window
  message?: string;       // Error message
  keyGenerator?: (req: Request) => string;  // Custom key generator
}

/**
 * Creates a rate limiter middleware
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = 60 * 1000,  // Default: 1 minute
    maxRequests = 100,      // Default: 100 requests per minute
    message = 'Too many requests, please try again later',
    keyGenerator = defaultKeyGenerator
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    if (!entry || entry.resetTime < now) {
      // Create new entry or reset expired one
      entry = {
        count: 1,
        resetTime: now + windowMs
      };
      rateLimitStore.set(key, entry);
    } else {
      // Increment existing entry
      entry.count++;
    }
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));
    
    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetTime - now) / 1000));
      return res.status(429).json({ 
        error: message,
        retryAfter: Math.ceil((entry.resetTime - now) / 1000)
      });
    }
    
    next();
  };
}

/**
 * Default key generator - uses IP address and user ID if available
 */
function defaultKeyGenerator(req: Request): string {
  // Try to get real IP behind proxies
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0])
    : req.ip || req.socket.remoteAddress || 'unknown';
  
  // Include user ID if authenticated for per-user limits
  const userId = req.user?.id || 'anonymous';
  
  return `${ip}:${userId}`;
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
