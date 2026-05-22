/** Max recipients for share-project and send-report email endpoints. */
export const MAX_EMAIL_RECIPIENTS = 10;

/** Default upload cap when `SUPABASE_MAX_FILE_SIZE` is unset (1 GB). */
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Email attachment size threshold — above this use Supabase signed-link delivery. */
export const EMAIL_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;
