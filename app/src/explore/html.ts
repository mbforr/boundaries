/** Escape text for innerHTML. Feature names come from public files, so never trust them. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** An outbound link, or nothing. */
export function extLink(url: string | null, text: string): string {
  if (!url) return '';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)} ↗</a>`;
}
