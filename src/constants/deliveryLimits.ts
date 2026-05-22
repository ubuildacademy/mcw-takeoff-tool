/**
 * Client-side delivery/upload limits. Values must stay aligned with server config:
 * - `server/src/config/deliveryLimits.ts`
 * - `server/src/routes/files.ts` (`SUPABASE_MAX_FILE_SIZE`)
 * - `server/src/config/reportDelivery.ts`
 */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GB default
export const MAX_UPLOAD_LABEL_MB = 1024;

/** Email attachment size threshold — above this the server uses link delivery. */
export const EMAIL_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
