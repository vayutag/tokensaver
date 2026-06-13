/**
 * MarkdownPreview component for the MarkItDown Website frontend.
 *
 * Renders markdown text as sanitized HTML using react-markdown, with:
 * - GitHub Flavored Markdown support via `remark-gfm` (tables, task lists,
 *   strikethrough, autolinks) — Requirement 5.2.
 * - Syntax highlighting for fenced code blocks via
 *   `react-syntax-highlighter` — Requirement 5.3.
 * - HTML sanitization via `rehype-sanitize` to prevent XSS attacks —
 *   Requirements 5.4 / 13.5.
 *
 * Performance: the component is wrapped in `React.memo` and the
 * react-markdown `components` map is created once (module scope) so that
 * large documents (up to ~10,000 lines) re-render only when the markdown
 * string actually changes — Requirement 12.6. The syntax highlighter uses
 * the async ("PrismAsync") build, which dynamically imports each language
 * grammar on demand. This keeps the markdown vendor bundle small (the full
 * set of Prism grammars is code-split out of the initial chunk) — Task 16.1,
 * Requirements 12.1 / 12.6.
 *
 * Task 7.2 - Integrate markdown rendering library.
 * Requirements: 5.2, 5.3, 5.4, 12.6
 */

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { PrismAsync as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import styles from './MarkdownPreview.module.css';

export interface MarkdownPreviewProps {
  /** The markdown text to render. May be empty. */
  markdown: string;
}

/**
 * Custom renderer map for react-markdown.
 *
 * Only the `code` renderer is customized: fenced code blocks that declare a
 * language (e.g. ```ts) are rendered with syntax highlighting, while inline
 * code and language-less blocks fall back to a plain `<code>` element.
 *
 * Defined at module scope (not per render) so the object identity is stable
 * across renders, which keeps react-markdown from rebuilding its renderer
 * pipeline unnecessarily for large documents.
 */
const markdownComponents: Components = {
  code({ className, children, ...rest }) {
    const match = /language-(\w+)/.exec(className ?? '');
    const codeText = String(children).replace(/\n$/, '');

    if (match) {
      return (
        <SyntaxHighlighter
          // eslint-disable-next-line react/no-children-prop
          style={oneDark}
          language={match[1]}
          PreTag="div"
          className={styles.codeBlock}
        >
          {codeText}
        </SyntaxHighlighter>
      );
    }

    return (
      <code className={`${styles.inlineCode} ${className ?? ''}`} {...rest}>
        {children}
      </code>
    );
  },
};

/**
 * Render sanitized, GitHub-flavored markdown with syntax-highlighted code
 * blocks. Memoized so that the (potentially expensive) render only runs when
 * the `markdown` prop changes.
 */
function MarkdownPreviewComponent({
  markdown,
}: MarkdownPreviewProps): JSX.Element {
  return (
    <div className={styles.preview} data-testid="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownPreview = memo(MarkdownPreviewComponent);

export default MarkdownPreview;
