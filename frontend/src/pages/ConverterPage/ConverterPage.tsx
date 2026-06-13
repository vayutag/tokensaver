/**
 * ConverterPage.
 *
 * The interactive conversion experience. Wires together the building-block
 * components into a single flow:
 *
 *   FileUploadZone  -> select/drop files
 *   useFileUploads  -> validate, upload, track progress, store results
 *   FileUploadList  -> per-file status/progress + "Download All"
 *   ConversionResults -> rendered markdown, metadata, download, copy
 *
 * Upload and conversion failures are surfaced through the global Toast
 * notification system with a one-click retry, connecting error handling
 * across the components (Requirements 10.1, 10.2, 10.6).
 *
 * Task 19.1 - Integrate all components into main application.
 * Requirements: 1.1-1.5, 2.1-2.4, 3.1-3.4, 5.1-5.6, 6.1, 6.7, 7.1-7.6,
 *               8.3, 8.6, 10.1, 10.2, 10.6
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { ConversionResults } from '@/components/ConversionResults';
import { FileUploadList } from '@/components/FileUploadList';
import { FileUploadZone } from '@/components/FileUploadZone';
import { useToast } from '@/components/Toast';
import { useFileUploads } from '@/hooks/useFileUploads';
import {
  MAX_FILE_SIZE,
  SUPPORTED_FORMAT_LABELS,
  SUPPORTED_MIME_TYPES,
} from '@/constants/index';
import type { ConversionResult } from '@/types/index';
import { downloadAllAsZip } from '@/utils/batchDownload';

import styles from './ConverterPage.module.css';

export function ConverterPage(): JSX.Element {
  const { showError, showSuccess } = useToast();

  const {
    uploads,
    addFiles,
    removeUpload,
    retryUpload,
    clearCompleted,
    clearAll,
  } = useFileUploads();

  // Track which failed uploads we've already notified about so re-renders
  // don't spam duplicate toasts for the same failure.
  const notifiedFailuresRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const activeIds = new Set(uploads.map((upload) => upload.id));

    // Surface newly failed uploads as error toasts with a retry action
    // (Requirements 10.1, 10.2, 10.6).
    for (const upload of uploads) {
      if (
        upload.status === 'failed' &&
        !notifiedFailuresRef.current.has(upload.id)
      ) {
        notifiedFailuresRef.current.add(upload.id);
        showError(
          upload.error ?? `Could not process “${upload.file.name}”.`,
          {
            title: `Conversion failed: ${upload.file.name}`,
            action: {
              label: 'Retry',
              onClick: () => retryUpload(upload.id),
            },
          },
        );
      }

      // Allow a future failure of the same id (after a retry) to notify again.
      if (upload.status !== 'failed') {
        notifiedFailuresRef.current.delete(upload.id);
      }
    }

    // Drop bookkeeping for uploads that no longer exist.
    notifiedFailuresRef.current.forEach((id) => {
      if (!activeIds.has(id)) {
        notifiedFailuresRef.current.delete(id);
      }
    });
  }, [uploads, showError, retryUpload]);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      addFiles(files);
    },
    [addFiles],
  );

  // Completed conversions, in upload order, used for results + batch download.
  const completedResults = useMemo<ConversionResult[]>(
    () =>
      uploads
        .filter((upload) => upload.status === 'completed' && upload.result)
        .map((upload) => upload.result as ConversionResult),
    [uploads],
  );

  const handleDownloadAll = useCallback(async () => {
    if (completedResults.length === 0) {
      return;
    }
    try {
      await downloadAllAsZip(completedResults);
    } catch {
      showError('Could not package the downloads. Please try again.', {
        title: 'Download failed',
      });
    }
  }, [completedResults, showError]);

  const handleClearCompleted = useCallback(() => {
    clearCompleted();
    showSuccess('Cleared completed conversions.');
  }, [clearCompleted, showSuccess]);

  const hasUploads = uploads.length > 0;
  const hasCompleted = completedResults.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Convert files to Markdown</h1>
        <p className={styles.subtitle}>
          Drag and drop your documents, or browse to choose them. Files are
          validated before upload and converted to clean Markdown you can
          preview, copy, or download.
        </p>
      </header>

      <section aria-label="File upload">
        <FileUploadZone
          onFilesSelected={handleFilesSelected}
          maxFileSize={MAX_FILE_SIZE}
          acceptedTypes={SUPPORTED_MIME_TYPES}
          multiple
        />
      </section>

      {!hasUploads && (
        <section
          className={styles.emptyState}
          aria-label="Getting started"
        >
          <span className={styles.emptyIcon} aria-hidden="true">
            ✨
          </span>
          <h2 className={styles.emptyTitle}>No files yet</h2>
          <p className={styles.emptyHint}>
            Drag and drop files onto the area above, or browse to choose them.
            You can convert several files at once and download them all
            together.
          </p>
          <div className={styles.formatHint}>
            <span className={styles.formatHintLabel}>Supported formats</span>
            <ul className={styles.formatList}>
              {SUPPORTED_FORMAT_LABELS.map((label) => (
                <li key={label} className={styles.formatTag}>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {hasUploads && (
        <section className={styles.listSection} aria-label="Selected files">
          <div className={styles.listHeader}>
            <h2 className={styles.sectionTitle}>Files</h2>
            <div className={styles.listActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleClearCompleted}
                disabled={!hasCompleted}
                title="Remove completed conversions from the list"
              >
                Clear completed
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={clearAll}
                title="Remove all files and results from the list"
              >
                Clear all
              </button>
            </div>
          </div>
          <FileUploadList
            uploads={uploads}
            onRemove={removeUpload}
            onDownloadAll={handleDownloadAll}
          />
        </section>
      )}

      {hasCompleted && (
        <section className={styles.resultsSection} aria-label="Conversion results">
          <h2 className={styles.sectionTitle}>Results</h2>
          <div className={styles.resultsList}>
            {completedResults.map((result) => (
              <ConversionResults key={result.id} result={result} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default ConverterPage;
