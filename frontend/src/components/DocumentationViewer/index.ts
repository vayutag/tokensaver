/**
 * Barrel file for the DocumentationViewer component.
 *
 * Task 11.1 - Create DocumentationViewer component.
 */

export {
  DocumentationViewer,
  default,
  type DocumentationViewerProps,
} from './DocumentationViewer';
export { parseToc, slugify } from './toc';
export {
  searchDocumentation,
  buildSnippet,
  highlightSegments,
  normalizeQuery,
  type SearchMatch,
  type HighlightSegment,
} from './search';
