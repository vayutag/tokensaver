/**
 * ConversionResults component for the MarkItDown Website frontend.
 *
 * Displays the outcome of a single file conversion:
 * - A markdown preview (rendered) with a toggle to view the raw markdown
 * - Conversion metadata (file type, size, processing time, converter used)
 * - A download button that retrieves the markdown file from the backend
 * - A copy-to-clipboard button for the markdown text
 * - An error message when the conversion failed
 *
 * The rich markdown rendering (react-markdown + remark-gfm + rehype-sanitize
 * + syntax highlighting) lives in the dedicated {@link MarkdownPreview}
 * component (task 7.2), which the preview pane renders below.
 *
 * Task 7.1 - Create ConversionResults component.
 * Requirements: 5.1, 5.5, 5.6, 6.1, 6.7
 */

import { memo, useCallback, useState } from 'react';

import { MarkdownPreview } from '@/components/MarkdownPreview';
import { downloadResult as defaultDownloadResult } from '@/services/api';
import type { ConversionResult } from '@/types/index';

import styles from './ConversionResults.module.css';

/** The two ways the converted markdown can be displayed. */
type ViewMode = 'preview' | 'raw';

export interface ConversionResultsProps {
  /** The conversion result to display. */
  result: ConversionResult;
  /**
   * Optional error message for a failed conversion. When provided, the
   * component shows the error instead of the preview (Requirement 10.2).
   */
  error?: string;
  /**
   * Optional override for the download action. When omitted the component
   * calls the API service's {@link downloadResult} with the result ID and
   * original file name (Requirement 6.1/6.2).
   */
  onDownload?: (id: string) => void | Promise<void>;
  /** Optional callback to dismiss/clear this result. */
  onClear?: () => void;
}

/** Format a byte count into a human-readable string (e.g. "1.2 MB"). */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'Unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Format a processing time (milliseconds) into a readable string. */
function formatProcessingTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return 'Unknown';
  }
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

/**
 * Display a converted markdown result with preview/raw toggle, metadata,
 * download, and copy-to-clipboard controls.
 */
function ConversionResultsComponent({
  result,
  error,
  onDownload,
  onClear,
}: ConversionResultsProps): JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { metadata } = result;
  const hasError = Boolean(error);

  const handleCopy = useCallback(async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      // Reset the "Copied!" affordance after a short delay.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Unable to copy to clipboard.');
    }
  }, [result.markdown]);

  const handleDownload = useCallback(async () => {
    setDownloadError(null);
    setIsDownloading(true);
    try {
      if (onDownload) {
        await onDownload(result.id);
      } else {
        await defaultDownloadResult(result.id, result.originalFileName);
      }
    } catch {
      setDownloadError('Download failed. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [onDownload, result.id, result.originalFileName]);

  return (
    <section
      className={styles.container}
      aria-label={`Conversion result for ${result.originalFileName}`}
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.fileName} title={result.originalFileName}>
            {result.originalFileName}
          </h2>
          {hasError ? (
            <span className={`${styles.badge} ${styles.badgeError}`}>
              Failed
            </span>
          ) : (
            <span className={`${styles.badge} ${styles.badgeSuccess}`}>
              Converted
            </span>
          )}
        </div>
        {onClear && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={onClear}
            aria-label="Clear this result"
          >
            ×
          </button>
        )}
      </header>

      {/* Prominent size-reduction summary (the core value of converting). */}
      {!hasError && typeof metadata.sizeReductionPercent === 'number' && (
        <div
          className={`${styles.reduction} ${
            metadata.sizeReductionPercent >= 0
              ? styles.reductionPositive
              : styles.reductionNegative
          }`}
        >
          {metadata.sizeReductionPercent >= 0 ? (
            <>
              <span className={styles.reductionValue}>
                ↓ {metadata.sizeReductionPercent.toFixed(1)}% smaller
              </span>
              <span className={styles.reductionDetail}>
                {formatFileSize(metadata.fileSize)} →{' '}
                {formatFileSize(metadata.outputSize ?? 0)}
              </span>
            </>
          ) : (
            <>
              <span className={styles.reductionValue}>
                ↑ {Math.abs(metadata.sizeReductionPercent).toFixed(1)} % larger
              </span>
              <span className={styles.reductionDetail}>
                {formatFileSize(metadata.fileSize)} →{' '}
                {formatFileSize(metadata.outputSize ?? 0)} (already
                text-based)
              </span>
            </>
          )}
        </div>
      )}

      {/* Conversion metadata (Requirement 5.6) */}
      <dl className={styles.metadata} aria-label="Conversion metadata">
        <div className={styles.metadataItem}>
          <dt className={styles.metadataLabel}>File type</dt>
          <dd className={styles.metadataValue}>{metadata.fileType}</dd>
        </div>
        <div className={styles.metadataItem}>
          <dt className={styles.metadataLabel}>Original size</dt>
          <dd className={styles.metadataValue}>
            {formatFileSize(metadata.fileSize)}
          </dd>
        </div>
        {typeof metadata.outputSize === 'number' && (
          <div className={styles.metadataItem}>
            <dt className={styles.metadataLabel}>Markdown size</dt>
            <dd className={styles.metadataValue}>
              {formatFileSize(metadata.outputSize)}
            </dd>
          </div>
        )}
        <div className={styles.metadataItem}>
          <dt className={styles.metadataLabel}>Processing time</dt>
          <dd className={styles.metadataValue}>
            {formatProcessingTime(metadata.processingTime)}
          </dd>
        </div>
        <div className={styles.metadataItem}>
          <dt className={styles.metadataLabel}>Converter</dt>
          <dd className={styles.metadataValue}>{metadata.converterUsed}</dd>
        </div>
        {typeof metadata.pageCount === 'number' && (
          <div className={styles.metadataItem}>
            <dt className={styles.metadataLabel}>Pages</dt>
            <dd className={styles.metadataValue}>{metadata.pageCount}</dd>
          </div>
        )}
        {typeof metadata.imageCount === 'number' && (
          <div className={styles.metadataItem}>
            <dt className={styles.metadataLabel}>Images</dt>
            <dd className={styles.metadataValue}>{metadata.imageCount}</dd>
          </div>
        )}
      </dl>

      {hasError ? (
        // Failed conversion: show the error message (Requirement 10.2).
        <div className={styles.errorMessage} role="alert">
          <strong className={styles.errorTitle}>Conversion failed</strong>
          <p className={styles.errorText}>{error}</p>
        </div>
      ) : (
        <>
          {/* Preview / raw toggle (Requirement 5.5) */}
          <div className={styles.toolbar}>
            <div
              className={styles.viewToggle}
              role="tablist"
              aria-label="Markdown view mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'preview'}
                className={`${styles.toggleButton} ${
                  viewMode === 'preview' ? styles.toggleButtonActive : ''
                }`}
                onClick={() => setViewMode('preview')}
              >
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'raw'}
                className={`${styles.toggleButton} ${
                  viewMode === 'raw' ? styles.toggleButtonActive : ''
                }`}
                onClick={() => setViewMode('raw')}
              >
                Raw
              </button>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={handleCopy}
                aria-label="Copy markdown to clipboard"
                title="Copy the converted markdown to your clipboard"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
                onClick={handleDownload}
                disabled={isDownloading}
                aria-label="Download markdown file"
                title="Download the converted markdown as a .md file"
              >
                {isDownloading ? 'Downloading…' : 'Download'}
              </button>
            </div>
          </div>

          {(copyError || downloadError) && (
            <p className={styles.inlineError} role="alert">
              {copyError ?? downloadError}
            </p>
          )}

          {/* Result body: rendered preview or raw markdown (Requirement 5.1/5.5) */}
          <div className={styles.body}>
            {viewMode === 'preview' ? (
              <MarkdownPreview markdown={result.markdown} />
            ) : (
              <pre className={styles.rawMarkdown} data-testid="raw-markdown">
                {result.markdown}
              </pre>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Memoized so a result card only re-renders when its own props change. This
 * matters when several results are rendered together (batch conversions):
 * updating one card no longer forces the (markdown-rendering) preview of the
 * others to re-render. (Task 16.1, Requirement 12.6.)
 */
export const ConversionResults = memo(ConversionResultsComponent);

export default ConversionResults;
