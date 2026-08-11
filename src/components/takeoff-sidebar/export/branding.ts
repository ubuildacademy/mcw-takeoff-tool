/**
 * Report branding (white-label) for exports: company name, accent color, and an
 * optional logo, per company (task: branding org-scoping, 2026-08-10 — this used to be
 * one global setting shared by every company on the platform). Every export in the
 * caller's org applies them; any fetch failure (no org yet, offline) falls back to the
 * stock Meridian branding so the export itself never breaks.
 */
import { reportBrandingService } from '../../../services/apiService';

/** Client-side cap for the uploaded logo PNG (stored as its base64). */
export const REPORT_LOGO_MAX_BYTES = 200 * 1024;

export interface ReportBranding {
  name: string;
  accentARGB: string;
  logoBase64: string | null;
}

export const DEFAULT_REPORT_BRANDING: ReportBranding = {
  name: 'MERIDIAN TAKEOFF',
  accentARGB: 'FF3B82F6',
  logoBase64: null,
};

/** '#3B82F6' | '3B82F6' | 'FF3B82F6' → 'FF3B82F6'; anything else → null. */
export function hexToARGB(hex: string): string | null {
  const cleaned = hex.trim().replace(/^#/, '').toUpperCase();
  if (/^[0-9A-F]{6}$/.test(cleaned)) return `FF${cleaned}`;
  if (/^[0-9A-F]{8}$/.test(cleaned)) return cleaned;
  return null;
}

export async function getReportBranding(): Promise<ReportBranding> {
  try {
    const branding = await reportBrandingService.get();
    return {
      name: branding.companyName?.trim() || DEFAULT_REPORT_BRANDING.name,
      accentARGB: (branding.accentColor && hexToARGB(branding.accentColor)) || DEFAULT_REPORT_BRANDING.accentARGB,
      logoBase64: branding.logoBase64,
    };
  } catch {
    return DEFAULT_REPORT_BRANDING;
  }
}
