/**
 * Table-of-contents helpers for the DocumentationViewer.
 *
 * These pure functions parse markdown headings into structured
 * {@link TocEntry} values and derive URL-safe slugs. They are kept separate
 * from the React component so they can be unit tested in isolation
 * (task 11.4) and reused for both TOC rendering and deep-link resolution.
 *
 * Task 11.1 - Create DocumentationViewer component.
 * Requirements: 9.3, 9.4
 */

import type { TocEntry } from '@/types/index';

/**
 * Convert arbitrary heading text into a URL-safe slug.
 *
 * Lowercases, strips characters that are not alphanumeric/space/hyphen,
 * collapses whitespace to single hyphens, and trims leading/trailing
 * hyphens. Returns `'section'` as a fallback when the input reduces to an
 * empty string (e.g. a heading made only of punctuation/emoji).
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * Parse markdown text into a list of table-of-contents entries.
 *
 * Recognizes ATX headings (`#` through `######`). Fenced code blocks are
 * skipped so that `#` characters inside code are not mistaken for headings.
 * Duplicate slugs are disambiguated by appending an incrementing suffix
 * (`-1`, `-2`, ...) so every entry's `slug` is unique within the document.
 */
export function parseToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n');
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  let fenceMarker = '';

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      continue;
    }
    if (inFence) {
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!headingMatch) {
      continue;
    }

    const level = headingMatch[1].length;
    const text = headingMatch[2].trim();
    const base = slugify(text);

    const priorCount = seen.get(base) ?? 0;
    seen.set(base, priorCount + 1);
    const slug = priorCount === 0 ? base : `${base}-${priorCount}`;

    entries.push({ level, text, slug });
  }

  return entries;
}
