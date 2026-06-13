/**
 * FileUploadList component.
 *
 * Presents the list of files the user has selected along with each file's
 * current lifecycle status, upload/processing progress, and any error
 * message. Files that are still pending can be removed via a per-row remove
 * button. The component is intentionally presentation focused: it renders
 * the `FileUpload` items it is given and surfaces remove intent through the
 * `onRemove` callback, but performs no upload, validation, or state
 * mutation itself.
 *
 * Task 5.3 - Create FileUploadList component.
 * Requirements:
 *   1.5 - Display the list of files to be uploaded.
 *   3.1 - Display a progress indicator for a file once its upload begins.
 *   3.4 - Display individual progress for each file in a multi-file upload.
 *   7.5 - Display the status of each file in a batch independently.
 *
 * Task 8.1 - Enhance FileUploadList for batch operations.
 * Requirements:
 *   7.3 - Results are presented in the same order as the uploaded files.
 *   7.4 - The batch continues to surface remaining files even when individual
 *         conversions fail (mixed success/failure is rendered together).
 *   7.5 - Display the status of each file in a batch independently.
 *   7.6 - When all batch operations complete, provide an option to download
 *         all successful conversions.
 */

import { memo, useCallback, useMemo } from 'react';
import { type FileUpload, type FileUploadStatus } from '@/types/index';
import styles from './FileUploadList.module.css';

export interface FileUploadListProps {
  /** The files to display, each with its own status and progress. */
  uploads: FileUpload[];
  /**
   * Called with the id of a file the user chose to remove. Only invoked for
   * files that are in the 'pending' state.
   */
  onRemove?: (id: string) => void;
  /**
   * Called when the user requests to download all successful conversions.
   * When provided, a "Download All" button is rendered in the batch summary
   * header. The button is only enabled when at least one upload has completed
   * successfully. The actual packaging/ZIP logic is supplied by the consumer
   * (see Task 8.2).
   */
  onDownloadAll?: () => void;
}

/** Human-readable label for each lifecycle status. */
const STATUS_LABELS: Record<FileUploadStatus, string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

/** Aggregate counts describing the state of a batch of uploads. */
interface BatchSummary {
  total: number;
  completed: number;
  failed: number;
  /** Files still pending, uploading, or processing. */
  inProgress: number;
  /** True once every file has reached a terminal state (completed/failed). */
  allFinished: boolean;
}

/** Compute aggregate counts for the batch summary header. */
function summarizeUploads(uploads: FileUpload[]): BatchSummary {
  let completed = 0;
  let failed = 0;
  for (const upload of uploads) {
    if (upload.status === 'completed') {
      completed += 1;
    } else if (upload.status === 'failed') {
      failed += 1;
    }
  }
  const total = uploads.length;
  const finishedCount = completed + failed;
  return {
    total,
    completed,
    failed,
    inProgress: total - finishedCount,
    allFinished: total > 0 && finishedCount === total,
  };
}

/** Format a byte count into a compact, human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  const rounded =
    value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[exponent]}`;
}

/** Clamp a progress value into the valid 0-100 range. */
function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

/** Whether the status represents active work that should show a progress bar. */
function isInProgress(status: FileUploadStatus): boolean {
  return status === 'uploading' || status === 'processing';
}

interface FileUploadRowProps {
  upload: FileUpload;
  onRemove?: (id: string) => void;
}

/**
 * A single file row. Memoized so that, in a multi-file batch, only the rows
 * whose `upload` actually changed (e.g. a progress tick or status change)
 * re-render — the rest are skipped. (Task 16.1, Requirements 12.1.)
 */
const FileUploadRow = memo(function FileUploadRow({
  upload,
  onRemove,
}: FileUploadRowProps) {
  const { id, file, status, progress, error } = upload;
  const handleRemove = useCallback(() => {
    onRemove?.(id);
  }, [id, onRemove]);

  const progressValue = clampProgress(progress);
  const showProgress = isInProgress(status);
  const showRemove = status === 'pending' && Boolean(onRemove);

  return (
    <li className={styles.item} data-status={status}>
      <div className={styles.itemHeader}>
        <div className={styles.fileInfo}>
          <span className={styles.fileName} title={file.name}>
            {file.name}
          </span>
          <span className={styles.fileSize}>{formatBytes(file.size)}</span>
        </div>
        <div className={styles.statusArea}>
          <span
            className={`${styles.statusBadge} ${styles[`status_${status}`]}`}
          >
            {STATUS_LABELS[status]}
          </span>
          {showRemove && (
            <button
              type="button"
              className={styles.removeButton}
              onClick={handleRemove}
              aria-label={`Remove ${file.name}`}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {showProgress && (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-valuenow={progressValue}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${STATUS_LABELS[status]} ${file.name}: ${progressValue}%`}
        >
          <div
            className={styles.progressBar}
            style={{ width: `${progressValue}%` }}
          />
        </div>
      )}

      {status === 'failed' && error && (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      )}
    </li>
  );
});

interface BatchSummaryHeaderProps {
  summary: BatchSummary;
  onDownloadAll?: () => void;
}

/**
 * Header rendered above the file list when there is more than one file. It
 * surfaces an at-a-glance overview of batch progress (e.g. "3 of 5 completed")
 * plus a failure count when conversions did not all succeed, and exposes the
 * "Download All" action for successful conversions.
 */
function BatchSummaryHeader({ summary, onDownloadAll }: BatchSummaryHeaderProps) {
  const { total, completed, failed, allFinished } = summary;
  const canDownloadAll = completed > 0;

  return (
    <div className={styles.batchSummary}>
      <div className={styles.batchStatus}>
        <span className={styles.batchCount} aria-live="polite">
          {completed} of {total} completed
        </span>
        {failed > 0 && (
          <span className={styles.batchFailed}>
            {failed} failed
          </span>
        )}
        {allFinished && (
          <span className={styles.batchDone}>All files processed</span>
        )}
      </div>
      {onDownloadAll && (
        <button
          type="button"
          className={styles.downloadAllButton}
          onClick={onDownloadAll}
          disabled={!canDownloadAll}
          aria-label={
            canDownloadAll
              ? `Download all ${completed} successful conversions`
              : 'Download All (no completed conversions yet)'
          }
          title={
            canDownloadAll
              ? 'Download all successful conversions as a ZIP archive'
              : 'Available once at least one conversion completes'
          }
        >
          Download All
        </button>
      )}
    </div>
  );
}

/**
 * Performance note (Task 16.1 — virtual scrolling): virtual scrolling was
 * evaluated and intentionally deferred. File batches are bounded by the
 * backend's concurrent-conversion limit (5 simultaneous, Requirement 4.5/7.2)
 * and realistic uploads are tens of files at most, so the DOM cost of
 * rendering every row is negligible. Each row is `React.memo`'d so progress
 * ticks only re-render the affected row. Introducing windowing (e.g.
 * react-window) would add a dependency and complicate the accessible
 * list/`progressbar` semantics for no measurable benefit at these sizes. It
 * can be revisited if the batch cap is ever raised substantially.
 */
export function FileUploadList({
  uploads,
  onRemove,
  onDownloadAll,
}: FileUploadListProps) {
  const summary = useMemo(() => summarizeUploads(uploads), [uploads]);

  if (uploads.length === 0) {
    return null;
  }

  // The batch summary header is only meaningful for multi-file batches.
  const showBatchSummary = uploads.length > 1;

  return (
    <div className={styles.container}>
      {showBatchSummary && (
        <BatchSummaryHeader summary={summary} onDownloadAll={onDownloadAll} />
      )}
      <ul
        className={styles.list}
        aria-label={`Selected files (${uploads.length})`}
      >
        {uploads.map((upload) => (
          <FileUploadRow key={upload.id} upload={upload} onRemove={onRemove} />
        ))}
      </ul>
    </div>
  );
}

export default FileUploadList;
