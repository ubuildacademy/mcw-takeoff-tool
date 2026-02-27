/**
 * Shared config for report email delivery (attachments vs Supabase link).
 */
export const REPORT_DELIVERY = {
  BUCKET: 'project-files',
  STORAGE_PREFIX: 'report-deliveries',
  LINK_EXPIRY_SECONDS: 7 * 24 * 60 * 60, // 7 days
  LINK_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
  /** Email attachment size limit - above this use link delivery */
  ATTACHMENT_LIMIT_BYTES: 25 * 1024 * 1024,
} as const;

/**
 * Config for project share via email (same bucket, same limits as reports).
 */
export const PROJECT_SHARE = {
  BUCKET: 'project-files',
  STORAGE_PREFIX: 'project-share-deliveries',
  LINK_EXPIRY_SECONDS: 7 * 24 * 60 * 60, // 7 days
  LINK_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
  /** Above this size use Supabase link instead of attachment */
  ATTACHMENT_LIMIT_BYTES: 25 * 1024 * 1024,
} as const;
