/**
 * Escape a string for interpolation into an HTML email body.
 *
 * Was defined identically in both routes/contact.ts and routes/feedback.ts —
 * user-supplied text reaches an HTML email in both, so the two copies had to be
 * kept in step by hand. One definition means a fix to the escaping applies to
 * every caller.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
