/** Hide Auto-hyperlink in Tools when `VITE_BATCH_HYPERLINK === 'false'`. */
export function isAutoHyperlinkUiEnabled(): boolean {
  return import.meta.env.VITE_BATCH_HYPERLINK !== 'false';
}
