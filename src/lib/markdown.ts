/**
 * Render Markdown -> safe HTML.
 *
 * Owners enter Markdown for event-type descriptions, bios, and confirmation
 * pages. The booker page renders the output as raw HTML, so the sanitizer is
 * the security boundary, not the renderer.
 *
 * Allowlist: structural tags + a tightly limited set of inline formatting.
 * No script, iframe, style, on* handlers, javascript: URLs, data: URLs.
 */

import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'em', 'b', 'i', 'u', 's',
  'code', 'pre',
  'blockquote',
  'ul', 'ol', 'li',
  'a',
  'img',
];

const ALLOWED_ATTRS = ['href', 'src', 'alt', 'title', 'target', 'rel'];

/**
 * Hook to enforce safe attributes on anchor tags after parsing.
 *
 * - href is verified against an allowlist of URL schemes (http, https, mailto, tel).
 * - target=_blank is forced on every link, with rel="noopener nofollow ugc".
 *   This prevents tabnabbing and signals search engines that booker-page
 *   links should not pass authority.
 */
function configureSanitizer(): void {
  // DOMPurify hooks are global. Tag with a sentinel so we don't double-register.
  const purify = DOMPurify as unknown as {
    addHook: (event: string, fn: (node: Element) => void) => void;
    removeAllHooks?: () => void;
    __slottyHookInstalled?: boolean;
  };

  if (purify.__slottyHookInstalled) return;
  purify.__slottyHookInstalled = true;

  purify.addHook('afterSanitizeAttributes', (node) => {
    // jsdom in some test environments doesn't expose `Element` on globalThis;
    // duck-type instead so this works in both Next runtime and bun test.
    const n = node as { tagName?: string; getAttribute?: (k: string) => string | null; setAttribute?: (k: string, v: string) => void; removeAttribute?: (k: string) => void };
    if (!n.tagName || !n.getAttribute || !n.setAttribute || !n.removeAttribute) return;
    if (n.tagName === 'A') {
      const href = n.getAttribute('href');
      if (href) {
        const lower = href.trim().toLowerCase();
        const safe =
          lower.startsWith('http://') ||
          lower.startsWith('https://') ||
          lower.startsWith('mailto:') ||
          lower.startsWith('tel:') ||
          lower.startsWith('/') ||
          lower.startsWith('#');
        if (!safe) {
          n.removeAttribute('href');
          return;
        }
      }
      n.setAttribute('target', '_blank');
      n.setAttribute('rel', 'noopener noreferrer nofollow ugc');
    }
    if (n.tagName === 'IMG') {
      const src = n.getAttribute('src');
      if (src) {
        const lower = src.trim().toLowerCase();
        const safe = lower.startsWith('http://') || lower.startsWith('https://');
        if (!safe) n.removeAttribute('src');
      }
    }
  });
}

configureSanitizer();

/**
 * Render trusted-input Markdown to sanitized HTML. Empty/whitespace input
 * returns the empty string.
 */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md || !md.trim()) return '';

  // marked v15 returns a string in sync mode.
  const rendered = marked.parse(md, { async: false }) as string;

  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    FORBID_TAGS: ['script', 'iframe', 'style', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'xlink:href'],
    ALLOW_DATA_ATTR: false,
  });
}
