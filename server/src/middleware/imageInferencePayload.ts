/**
 * Bounds for CPU/GPU-heavy routes that accept inline base64 (or data-URL) image payloads.
 * Keeps accidental huge bodies from pinning memory below express.json ceiling.
 */

import type { NextFunction, Request, Response } from 'express';

const EXPRESS_JSON_APPROX_CHARS = 52_428_800; // 50 MiB guideline per express.json()

function configuredMaxChars(): number {
  const raw = process.env.IMAGE_INFERENCE_MAX_PAYLOAD_CHARS;
  if (raw == null || raw === '') return 22_000_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 128_000) return 22_000_000;
  return Math.min(Math.floor(parsed), EXPRESS_JSON_APPROX_CHARS);
}

/**
 * Strip `data:image/...;base64,` prefix for length checks without decoding.
 */
export function stripDataUrlBase64(raw: string): string {
  if (typeof raw !== 'string') return '';
  const idx = raw.indexOf('base64,');
  if (raw.startsWith('data:') && idx !== -1) {
    return raw.slice(idx + 'base64,'.length);
  }
  return raw;
}

/**
 * Validates a single inline image string; returns 400-friendly error message or null.
 */
export function validateInlineImagePayload(
  imageData: unknown,
  maxChars = configuredMaxChars()
): string | null {
  if (typeof imageData !== 'string') {
    return 'Image data must be a string';
  }
  if (imageData.length === 0) {
    return 'Image data cannot be empty';
  }
  const payload = stripDataUrlBase64(imageData);
  if (payload.length > maxChars) {
    return `Image payload too large (max ${Math.round(maxChars / 1_000_000)}M characters)`;
  }
  return null;
}

/**
 * Express middleware: require `req.body[field]` passes {@link validateInlineImagePayload}.
 */
export function validateBodyImageField(field: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const err = validateInlineImagePayload((req.body as Record<string, unknown>)?.[field]);
    if (err) {
      return res.status(400).json({ error: err });
    }
    next();
  };
}
