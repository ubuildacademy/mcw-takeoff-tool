/**
 * Report branding (white-label) for exports: company name, accent color, and an
 * optional logo, stored as admin-managed settings. Every user's export applies
 * them; any fetch failure (missing key, no access, offline) falls back to the
 * stock Meridian branding so the export itself never breaks.
 */
import { settingsService } from '../../../services/apiService';

export const REPORT_COMPANY_NAME_KEY = 'report-company-name';
export const REPORT_ACCENT_COLOR_KEY = 'report-accent-color';
export const REPORT_LOGO_KEY = 'report-logo';

/** Client-side cap for the uploaded logo PNG (the setting stores its base64). */
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

/**
 * Reads one branding setting; null means "unset, use the default". The server
 * JSON-parses stored values, so an all-digit string comes back as a number —
 * coerce it rather than dropping it.
 */
async function fetchSettingValue(key: string): Promise<string | null> {
  try {
    const response = await settingsService.getSetting(key);
    const value = response?.value;
    const asString = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
    return asString.trim() !== '' ? asString : null;
  } catch {
    return null;
  }
}

export async function getReportBranding(): Promise<ReportBranding> {
  const [name, accent, logo] = await Promise.all([
    fetchSettingValue(REPORT_COMPANY_NAME_KEY),
    fetchSettingValue(REPORT_ACCENT_COLOR_KEY),
    fetchSettingValue(REPORT_LOGO_KEY),
  ]);
  return {
    name: name ?? DEFAULT_REPORT_BRANDING.name,
    accentARGB: (accent && hexToARGB(accent)) || DEFAULT_REPORT_BRANDING.accentARGB,
    logoBase64: logo,
  };
}
