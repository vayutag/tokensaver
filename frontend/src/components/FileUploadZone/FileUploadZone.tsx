/**
 * FileUploadZone component.
 *
 * Provides a drag-and-drop area plus a file-picker fallback for selecting
 * one or more files to convert. The component is intentionally presentation
 * focused: it surfaces the raw `File` objects the user chose via the
 * `onFilesSelected` callback and does not perform validation itself
 * (validation is handled separately, see task 5.2).
 *
 * Task 5.1 - Create FileUploadZone component.
 * Requirements:
 *   1.1 - Provide a drag-and-drop interface for file selection.
 *   1.2 - Accept files selected through the file picker.
 *   1.3 - Provide visual feedback when files are dragged over the zone.
 *   1.4 - Support multiple file uploads in a single operation.
 */

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import styles from './FileUploadZone.module.css';

export interface FileUploadZoneProps {
  /** Called with the list of files the user selected or dropped. */
  onFilesSelected: (files: File[]) => void;
  /** Maximum allowed file size in bytes (used for messaging only). */
  maxFileSize: number;
  /** Accepted MIME types, used to build the file input `accept` attribute. */
  acceptedTypes: string[];
  /** Whether multiple files may be selected in a single operation. */
  multiple: boolean;
  /** Optional flag to disable interaction (e.g. while uploading). */
  disabled?: boolean;
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
  // Drop a trailing ".0" so whole numbers read cleanly (e.g. "5 GB").
  const rounded =
    value >= 10 || exponent === 0 || Number.isInteger(value)
      ? Math.round(value)
      : value.toFixed(1);
  return `${rounded} ${units[exponent]}`;
}

export function FileUploadZone({
  onFilesSelected,
  maxFileSize,
  acceptedTypes,
  multiple,
  disabled = false,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track nested drag enter/leave events so child elements don't flicker
  // the dragging indicator (Requirement 1.3).
  const dragDepth = useRef(0);

  const emitFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      // Honour single-select mode by trimming to the first file.
      onFilesSelected(multiple ? files : files.slice(0, 1));
    },
    [multiple, onFilesSelected],
  );

  const openFilePicker = useCallback(() => {
    if (disabled) return;
    inputRef.current?.click();
  }, [disabled]);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      emitFiles(event.target.files);
      // Reset so selecting the same file again re-triggers onChange.
      event.target.value = '';
    },
    [emitFiles],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (disabled) return;
      dragDepth.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      // Must prevent default to allow a drop to occur.
      event.preventDefault();
      if (disabled) return;
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (disabled) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        setIsDragging(false);
      }
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      if (disabled) return;
      emitFiles(event.dataTransfer?.files ?? null);
    },
    [disabled, emitFiles],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFilePicker();
      }
    },
    [openFilePicker],
  );

  const acceptAttr = acceptedTypes.length > 0 ? acceptedTypes.join(',') : undefined;
  const zoneClassName = `${styles.zone} ${isDragging ? styles.dragging : ''}`.trim();

  return (
    <div
      className={zoneClassName}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="File upload zone. Click to browse or drag and drop files here."
      aria-disabled={disabled}
      data-dragging={isDragging}
      onClick={openFilePicker}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className={styles.icon} aria-hidden="true">
        📁
      </span>
      <p className={styles.primaryText}>
        {isDragging
          ? 'Drop your files to upload'
          : 'Drag & drop files here'}
      </p>
      <p className={styles.secondaryText}>
        or <span className={styles.browseLink}>browse</span> to choose{' '}
        {multiple ? 'files' : 'a file'}
      </p>
      <p className={styles.secondaryText}>
        {maxFileSize > 0
          ? `Up to ${formatBytes(maxFileSize)} per file`
          : 'Any file size'}
      </p>
      <input
        ref={inputRef}
        type="file"
        className={styles.hiddenInput}
        multiple={multiple}
        accept={acceptAttr}
        disabled={disabled}
        onChange={handleInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

export default FileUploadZone;
