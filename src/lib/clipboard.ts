/**
 * Copy `text` to the system clipboard. `navigator.clipboard.writeText` is the
 * modern API but is restricted to secure contexts (https / localhost) — on a
 * self-hosted plain-HTTP deploy it's `undefined` and throws. Fall back to the
 * legacy `document.execCommand('copy')` path which works on insecure pages.
 *
 * Returns void on success, throws on failure.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Secure-context path.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy path
    }
  }

  // Legacy path. Some browsers gate execCommand on the element being
  // selectable + visible, so we briefly mount an off-screen textarea.
  if (typeof document === 'undefined') {
    throw new Error('Clipboard not available in this environment.');
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  // Avoid scrolling-to-bottom on iOS and a flash of layout.
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.padding = '0';
  ta.style.border = 'none';
  ta.style.outline = 'none';
  ta.style.boxShadow = 'none';
  ta.style.background = 'transparent';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand("copy") returned false');
  } finally {
    document.body.removeChild(ta);
  }
}
