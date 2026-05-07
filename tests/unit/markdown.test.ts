import { describe, it, expect } from 'bun:test';
import { renderMarkdown } from '@/lib/markdown';

describe('renderMarkdown', () => {
  it('renders bold and italic', () => {
    const html = renderMarkdown('**bold** and _italic_');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toMatch(/<em>italic<\/em>/);
  });

  it('renders links with target=_blank and rel="noopener"', () => {
    const html = renderMarkdown('[example](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it('strips javascript: URLs', () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toContain('javascript:');
  });

  it('strips raw <script> tags', () => {
    const html = renderMarkdown('<script>alert(1)</script>hello');
    expect(html).not.toContain('<script');
    expect(html).toContain('hello');
  });

  it('strips on* event handlers', () => {
    const html = renderMarkdown('<a href="https://x" onclick="alert(1)">x</a>');
    expect(html).not.toContain('onclick');
  });

  it('strips iframes', () => {
    const html = renderMarkdown('<iframe src="https://evil"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('strips data: URLs in img', () => {
    const html = renderMarkdown('<img src="data:text/html,hello">');
    expect(html).not.toContain('data:');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });

  it('renders headings, lists, and code', () => {
    const html = renderMarkdown('# Title\n\n- one\n- two\n\n`x`');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<code>x</code>');
  });
});
