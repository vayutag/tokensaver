/**
 * DocumentationViewer component for the MarkItDown Website frontend.
 *
 * Presents the project documentation as a navigable, two-pane view:
 * - A navigation sidebar listing every documentation section (and its nested
 *   subsections) — Requirement 9.1.
 * - A content pane that renders the active section's markdown using the
 *   shared {@link MarkdownPreview} component, which provides GitHub Flavored
 *   Markdown rendering, HTML sanitization, and syntax highlighting for code
 *   examples — Requirements 9.2 / 9.5.
 * - A table of contents generated from the active section's headings, with
 *   in-page anchor links — Requirement 9.3.
 *
 * Deep linking is supported through the URL hash (Requirement 9.4):
 * - `#section-id` selects a section.
 * - `#section-id__heading-slug` selects a section and scrolls to a heading.
 *
 * The component works both as a controlled component (when `activeSection`
 * and `onSectionChange` are supplied) and as an uncontrolled component that
 * tracks the active section internally and keeps it in sync with the hash.
 *
 * A debounced search box in the sidebar performs client-side search across
 * every section's title and content; matching sections are listed with a
 * snippet, selecting a result navigates to that section, and the active
 * search term is highlighted within the rendered content (Requirement 9.6).
 *
 * The actual documentation content is supplied via the `sections` prop
 * (authored in task 11.2).
 *
 * Task 11.1 - Create DocumentationViewer component.
 * Task 11.3 - Implement documentation search.
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { MarkdownPreview } from '@/components/MarkdownPreview';
import type { DocumentationSection } from '@/types/index';

import styles from './DocumentationViewer.module.css';
import { searchDocumentation } from './search';
import { parseToc } from './toc';

/** Delay, in milliseconds, before a search term is applied after typing. */
const SEARCH_DEBOUNCE_MS = 200;

export interface DocumentationViewerProps {
  /** Top-level documentation sections to display. */
  sections: DocumentationSection[];
  /**
   * Controlled active section id. When provided together with
   * `onSectionChange`, the parent owns selection state.
   */
  activeSection?: string;
  /** Called when the user selects a different section. */
  onSectionChange?: (sectionId: string) => void;
}

/** Separator used in the hash to address a heading within a section. */
const HASH_HEADING_SEPARATOR = '__';

/** A section paired with its nesting depth, for flat sidebar rendering. */
interface FlatSection {
  section: DocumentationSection;
  depth: number;
}

/** Flatten the section tree into an ordered, depth-annotated list. */
function flattenSections(
  sections: DocumentationSection[],
  depth = 0,
): FlatSection[] {
  const result: FlatSection[] = [];
  for (const section of sections) {
    result.push({ section, depth });
    if (section.subsections && section.subsections.length > 0) {
      result.push(...flattenSections(section.subsections, depth + 1));
    }
  }
  return result;
}

/** Parse a raw `window.location.hash` into section + optional heading parts. */
function parseHash(hash: string): { sectionId: string; headingSlug?: string } {
  const cleaned = hash.replace(/^#/, '');
  if (!cleaned) {
    return { sectionId: '' };
  }
  const separatorIndex = cleaned.indexOf(HASH_HEADING_SEPARATOR);
  if (separatorIndex === -1) {
    return { sectionId: decodeURIComponent(cleaned) };
  }
  return {
    sectionId: decodeURIComponent(cleaned.slice(0, separatorIndex)),
    headingSlug: decodeURIComponent(
      cleaned.slice(separatorIndex + HASH_HEADING_SEPARATOR.length),
    ),
  };
}

/** Marker attribute used to identify (and later unwrap) highlight elements. */
const HIGHLIGHT_ATTR = 'data-doc-search-highlight';

/**
 * React state hook that returns `value` only after it has stopped changing
 * for `delayMs` milliseconds. Used to debounce the search input so the
 * (synchronous) search does not run on every keystroke.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Wrap every case-insensitive occurrence of `needle` (already lowercased)
 * inside `textNode` with a `<mark>` element tagged for later cleanup.
 */
function wrapMatches(textNode: Text, needle: string): void {
  const text = textNode.nodeValue ?? '';
  const lower = text.toLowerCase();
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let index = lower.indexOf(needle, cursor);

  while (index !== -1) {
    if (index > cursor) {
      fragment.appendChild(
        document.createTextNode(text.slice(cursor, index)),
      );
    }
    const mark = document.createElement('mark');
    mark.className = styles.highlight;
    mark.setAttribute(HIGHLIGHT_ATTR, 'true');
    mark.textContent = text.slice(index, index + needle.length);
    fragment.appendChild(mark);
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
  textNode.parentNode?.replaceChild(fragment, textNode);
}

/** Highlight all occurrences of `needle` within `root`'s text nodes. */
function applyHighlights(root: HTMLElement, needle: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.nodeValue || !parent) {
        return NodeFilter.FILTER_REJECT;
      }
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'MARK') {
        return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue.toLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  while (walker.nextNode()) {
    targets.push(walker.currentNode as Text);
  }
  for (const textNode of targets) {
    wrapMatches(textNode, needle);
  }
}

/** Unwrap any highlight `<mark>` elements previously inserted within `root`. */
function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll<HTMLElement>(
    `mark[${HIGHLIGHT_ATTR}="true"]`,
  );
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(
      document.createTextNode(mark.textContent ?? ''),
      mark,
    );
    parent.normalize();
  });
}

/**
 * Two-pane documentation viewer with sidebar navigation, markdown content,
 * a generated table of contents, and hash-based deep linking.
 */
export function DocumentationViewer({
  sections,
  activeSection,
  onSectionChange,
}: DocumentationViewerProps): JSX.Element {
  const flatSections = useMemo(() => flattenSections(sections), [sections]);

  const defaultSectionId = flatSections[0]?.section.id ?? '';

  // Internal selection state (used when uncontrolled). Initialized from the
  // URL hash if it points at a known section, otherwise the first section.
  const [internalSectionId, setInternalSectionId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const { sectionId } = parseHash(window.location.hash);
      if (sectionId && flatSections.some((f) => f.section.id === sectionId)) {
        return sectionId;
      }
    }
    return defaultSectionId;
  });

  const isControlled = activeSection !== undefined;
  const resolvedSectionId = isControlled ? activeSection : internalSectionId;

  // Search state. The raw input is debounced before being used to compute
  // results and content highlights so typing stays responsive.
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const trimmedSearch = debouncedSearch.trim();
  const hasQuery = trimmedSearch.length > 0;

  const searchResults = useMemo(
    () => searchDocumentation(sections, debouncedSearch),
    [sections, debouncedSearch],
  );

  // Track the heading slug requested via the hash so we can scroll to it once
  // the content (and its heading ids) are in the DOM.
  const pendingHeadingRef = useRef<string | undefined>(undefined);

  const contentRef = useRef<HTMLDivElement>(null);

  const selectSection = useCallback(
    (sectionId: string, headingSlug?: string) => {
      pendingHeadingRef.current = headingSlug;
      if (!isControlled) {
        setInternalSectionId(sectionId);
      }
      onSectionChange?.(sectionId);

      // Reflect the selection in the URL hash for shareable deep links.
      if (typeof window !== 'undefined') {
        const nextHash = headingSlug
          ? `${sectionId}${HASH_HEADING_SEPARATOR}${headingSlug}`
          : sectionId;
        if (parseHashKey(window.location.hash) !== nextHash) {
          window.history.replaceState(null, '', `#${nextHash}`);
        }
      }
    },
    [isControlled, onSectionChange],
  );

  // Respond to external hash changes (back/forward navigation, shared links).
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleHashChange = (): void => {
      const { sectionId, headingSlug } = parseHash(window.location.hash);
      if (!sectionId) {
        return;
      }
      if (!flatSections.some((f) => f.section.id === sectionId)) {
        return;
      }
      pendingHeadingRef.current = headingSlug;
      if (!isControlled) {
        setInternalSectionId(sectionId);
      }
      onSectionChange?.(sectionId);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [flatSections, isControlled, onSectionChange]);

  const activeFlatSection = useMemo(
    () =>
      flatSections.find((f) => f.section.id === resolvedSectionId) ??
      flatSections[0],
    [flatSections, resolvedSectionId],
  );

  const activeContent = activeFlatSection?.section.content ?? '';
  const activeId = activeFlatSection?.section.id ?? '';

  const tocEntries = useMemo(() => parseToc(activeContent), [activeContent]);

  // After the active section's markdown renders, assign deterministic ids to
  // its heading elements so the table-of-contents anchors resolve, then honor
  // any pending heading deep link by scrolling it into view.
  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }
    const headingNodes = container.querySelectorAll<HTMLHeadingElement>(
      'h1, h2, h3, h4, h5, h6',
    );
    // tocEntries is parsed in document order, matching the DOM heading order.
    headingNodes.forEach((node, index) => {
      const entry = tocEntries[index];
      if (entry) {
        node.id = `${activeId}${HASH_HEADING_SEPARATOR}${entry.slug}`;
      }
    });

    const headingSlug = pendingHeadingRef.current;
    if (headingSlug) {
      const target = container.querySelector<HTMLElement>(
        `[id="${CSS.escape(`${activeId}${HASH_HEADING_SEPARATOR}${headingSlug}`)}"]`,
      );
      target?.scrollIntoView({ behavior: 'auto', block: 'start' });
      pendingHeadingRef.current = undefined;
    }
  }, [activeContent, activeId, tocEntries]);

  // Highlight the active search term within the rendered content. Runs after
  // the markdown has been committed to the DOM; the cleanup unwraps the
  // inserted <mark> elements before the term (or content) changes.
  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container || !hasQuery) {
      return undefined;
    }
    applyHighlights(container, trimmedSearch.toLowerCase());
    return () => clearHighlights(container);
  }, [trimmedSearch, hasQuery, activeContent]);

  const handleSectionClick = useCallback(
    (sectionId: string) => {
      selectSection(sectionId);
    },
    [selectSection],
  );

  const handleResultClick = useCallback(
    (sectionId: string) => {
      selectSection(sectionId);
      // Bring the newly selected section into view from the top.
      contentRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    },
    [selectSection],
  );

  const handleTocClick = useCallback(
    (slug: string) => {
      selectSection(activeId, slug);
      const container = contentRef.current;
      const target = container?.querySelector<HTMLElement>(
        `[id="${CSS.escape(`${activeId}${HASH_HEADING_SEPARATOR}${slug}`)}"]`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [activeId, selectSection],
  );

  return (
    <div className={styles.container}>
      <nav className={styles.sidebar} aria-label="Documentation sections">
        <div className={styles.search} role="search">
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search documentation"
            aria-label="Search documentation"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="Clear search"
              onClick={() => setSearchInput('')}
            >
              ×
            </button>
          )}
        </div>

        {hasQuery ? (
          <div
            className={styles.searchResults}
            aria-label="Search results"
            aria-live="polite"
          >
            {searchResults.length === 0 ? (
              <p className={styles.searchEmpty}>
                No results for “{trimmedSearch}”
              </p>
            ) : (
              <>
                <p className={styles.searchCount}>
                  {searchResults.length}{' '}
                  {searchResults.length === 1 ? 'result' : 'results'}
                </p>
                <ul className={styles.resultList}>
                  {searchResults.map((result) => {
                    const isActive = result.sectionId === activeId;
                    return (
                      <li key={result.sectionId}>
                        <button
                          type="button"
                          className={`${styles.resultLink} ${
                            isActive ? styles.resultLinkActive : ''
                          }`}
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => handleResultClick(result.sectionId)}
                        >
                          <span className={styles.resultTitle}>
                            {result.title}
                          </span>
                          {result.snippet && (
                            <span className={styles.resultSnippet}>
                              {result.snippet}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        ) : (
          <ul className={styles.sectionList}>
            {flatSections.map(({ section, depth }) => {
              const isActive = section.id === activeId;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    className={`${styles.sectionLink} ${
                      isActive ? styles.sectionLinkActive : ''
                    }`}
                    style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => handleSectionClick(section.id)}
                  >
                    {section.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <main className={styles.content} aria-live="polite">
        {activeFlatSection ? (
          <article className={styles.article}>
            <div ref={contentRef} className={styles.markdown}>
              <MarkdownPreview markdown={activeContent} />
            </div>
          </article>
        ) : (
          <p className={styles.empty}>No documentation available.</p>
        )}
      </main>

      {tocEntries.length > 0 && (
        <aside className={styles.toc} aria-label="On this page">
          <p className={styles.tocTitle}>On this page</p>
          <ul className={styles.tocList}>
            {tocEntries.map((entry) => (
              <li
                key={entry.slug}
                className={styles.tocItem}
                style={{ paddingLeft: `${(entry.level - 1) * 0.75}rem` }}
              >
                <button
                  type="button"
                  className={styles.tocLink}
                  onClick={() => handleTocClick(entry.slug)}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

/**
 * Normalize a raw hash into the same `sectionId__headingSlug` key form used
 * when writing the hash, so we can avoid redundant history updates.
 */
function parseHashKey(hash: string): string {
  const { sectionId, headingSlug } = parseHash(hash);
  return headingSlug
    ? `${sectionId}${HASH_HEADING_SEPARATOR}${headingSlug}`
    : sectionId;
}

export default DocumentationViewer;
