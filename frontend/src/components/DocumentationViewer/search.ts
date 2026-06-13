/**
 * Client-side search helpers for the DocumentationViewer.
 *
 * These pure functions implement case-insensitive, client-side search across
 * every documentation section's title and markdown content. They are kept
 * separate from the React component so they can be unit tested in isolation
 * (task 11.4) and reused for both result listing and in-content highlighting.
 *
 * Search is intentionally simple and dependency-free: it performs substring
 * matching (no fuzzy/stemming) over a normalized, lowercased copy of the
 * source text, which keeps it fast enough to run synchronously on every
 * keystroke for the modest amount of documentation the site ships with.
 *
 * Task 11.3 - Implement documentation search.
 * Requirements: 9.6
 */

import type { DocumentationSection } from '@/types/index';

/** Number of characters of context to include on each side of a snippet hit. */
const SNIPPET_CONTEXT = 40;

/** A single search hit for one documentation section. */
export interface SearchMatch {
  /** Id of the section that matched (used for navigation). */
  sectionId: string;
  /** Display title of the matching section. */
  title: string;
  /** True when the search term appears in the section title. */
  matchedInTitle: boolean;
  /** True when the search term appears in the section content. */
  matchedInContent: boolean;
  /**
   * A short excerpt of the content surrounding the first content match,
   * with ellipses added when the excerpt is clipped. Empty when the match
   * was title-only.
   */
  snippet: string;
  /** Total number of (non-overlapping) occurrences across title + content. */
  matchCount: number;
}

/** A contiguous run of text, flagged as a highlight hit or plain text. */
export interface HighlightSegment {
  /** The text content of this segment. */
  text: string;
  /** Whether this segment matches the active search term. */
  highlighted: boolean;
}

/** A section paired with itself flattened from the section tree. */
function flatten(
  sections: DocumentationSection[],
): DocumentationSection[] {
  const result: DocumentationSection[] = [];
  for (const section of sections) {
    result.push(section);
    if (section.subsections && section.subsections.length > 0) {
      result.push(...flatten(section.subsections));
    }
  }
  return result;
}

/** Normalize a search term: trim surrounding whitespace and lowercase it. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Count non-overlapping occurrences of `needle` within `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Build a single-line excerpt of `content` centered on the first occurrence
 * of `needle` (which must already be lowercased). Returns an empty string
 * when there is no match.
 */
export function buildSnippet(content: string, needle: string): string {
  if (!needle) {
    return '';
  }
  // Collapse whitespace (incl. newlines) so the snippet renders on one line.
  const normalized = content.replace(/\s+/g, ' ').trim();
  const matchIndex = normalized.toLowerCase().indexOf(needle);
  if (matchIndex === -1) {
    return '';
  }

  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT);
  const end = Math.min(
    normalized.length,
    matchIndex + needle.length + SNIPPET_CONTEXT,
  );

  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}

/**
 * Search every section (and subsection) for `query`, returning one
 * {@link SearchMatch} per section that matches its title or content.
 *
 * The result is ordered with title matches first (they are the strongest
 * signal), then by descending match count, preserving document order as a
 * final tie-breaker. An empty or whitespace-only query yields no matches.
 */
export function searchDocumentation(
  sections: DocumentationSection[],
  query: string,
): SearchMatch[] {
  const needle = normalizeQuery(query);
  if (!needle) {
    return [];
  }

  // Pair each match with its document order so we can use it as a stable
  // tie-breaker after sorting by relevance.
  const ranked: Array<{ match: SearchMatch; order: number }> = [];
  flatten(sections).forEach((section, order) => {
    const titleCount = countOccurrences(section.title.toLowerCase(), needle);
    const contentCount = countOccurrences(
      section.content.toLowerCase(),
      needle,
    );
    if (titleCount === 0 && contentCount === 0) {
      return;
    }

    ranked.push({
      order,
      match: {
        sectionId: section.id,
        title: section.title,
        matchedInTitle: titleCount > 0,
        matchedInContent: contentCount > 0,
        snippet:
          contentCount > 0 ? buildSnippet(section.content, needle) : '',
        matchCount: titleCount + contentCount,
      },
    });
  });

  return ranked
    .sort((a, b) => {
      if (a.match.matchedInTitle !== b.match.matchedInTitle) {
        return a.match.matchedInTitle ? -1 : 1;
      }
      if (a.match.matchCount !== b.match.matchCount) {
        return b.match.matchCount - a.match.matchCount;
      }
      return a.order - b.order;
    })
    .map(({ match }) => match);
}

/**
 * Split `text` into highlight/plain segments around every (case-insensitive)
 * occurrence of `query`. Useful for rendering search-term highlights without
 * dangerously setting inner HTML.
 *
 * Returns a single non-highlighted segment when the query is empty or no
 * match is present, so callers can render the result uniformly.
 */
export function highlightSegments(
  text: string,
  query: string,
): HighlightSegment[] {
  const needle = normalizeQuery(query);
  if (!needle) {
    return text ? [{ text, highlighted: false }] : [];
  }

  const segments: HighlightSegment[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;
  let index = haystack.indexOf(needle, cursor);

  while (index !== -1) {
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), highlighted: false });
    }
    segments.push({
      text: text.slice(index, index + needle.length),
      highlighted: true,
    });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

  return segments;
}
