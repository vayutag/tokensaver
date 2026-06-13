/**
 * Client-side file validation utility for the MarkItDown Website frontend.
 *
 * Provides a pure `validateFile` function that checks a browser `File`
 * against size and MIME-type constraints before the file is uploaded to
 * the backend. Validating early gives the user immediate feedback and
 * avoids unnecessary network round-trips for files that cannot be
 * converted.
 *
 * Task 5.2 - Create file validation utility.
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import type { ValidationConfig, ValidationResult } from '@/types';
import {
  MAX_FILE_SIZE,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_FORMAT_LABELS,
} from '@/constants';

/**
 * Default validation configuration derived from the shared application
 * constants. Used when a caller does not supply its own configuration.
 *
 * - `maxFileSize` defaults to the 50MB limit (Requirements 2.1, 2.2).
 * - `supportedTypes` defaults to the canonical supported MIME type list
 *   (Requirements 2.3, 2.4).
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  maxFileSize: MAX_FILE_SIZE,
  supportedTypes: SUPPORTED_MIME_TYPES,
};

/**
 * Convert a byte count into a human-readable megabyte string for use in
 * error messages (e.g. 52428800 -> "50MB").
 */
function formatBytesAsMb(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  // Drop a trailing ".0" so whole numbers read cleanly (e.g. "50MB").
  const rounded = Math.round(megabytes * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}MB`;
}

/**
 * Validate a single file against size and MIME-type constraints.
 *
 * This is a pure function with no side effects: given the same inputs it
 * always returns the same result and does not mutate its arguments.
 *
 * Validation order:
 * 1. File size is checked against `config.maxFileSize` (Requirements 2.1, 2.2).
 * 2. MIME type is checked against `config.supportedTypes` (Requirements 2.3, 2.4).
 *
 * @param file   The browser File object to validate.
 * @param config Optional validation configuration. Defaults to
 *               {@link DEFAULT_VALIDATION_CONFIG} (50MB limit, supported
 *               MIME types) when omitted.
 * @returns A {@link ValidationResult}. When `valid` is `false`, `error`
 *          contains a user-facing message. When `valid` is `true`,
 *          `detectedType` contains the file's MIME type.
 */
export function validateFile(
  file: File,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG,
): ValidationResult {
  // Requirements 2.1 & 2.2: reject files that exceed the size limit and
  // report the limit in the error message. A limit of 0 (or negative) means
  // "no limit" - files of any size are accepted.
  if (config.maxFileSize > 0 && file.size > config.maxFileSize) {
    return {
      valid: false,
      error: `File "${file.name}" exceeds the maximum size of ${formatBytesAsMb(
        config.maxFileSize,
      )}.`,
    };
  }

  // Requirements 2.3 & 2.4: reject files whose MIME type is not supported
  // and list the accepted formats in the error message.
  if (!config.supportedTypes.includes(file.type)) {
    const detected = file.type ? `"${file.type}"` : 'unknown';
    return {
      valid: false,
      error: `Unsupported file type ${detected} for "${file.name}". Supported formats: ${SUPPORTED_FORMAT_LABELS.join(
        ', ',
      )}.`,
    };
  }

  // The file passed all checks; report the detected MIME type.
  return {
    valid: true,
    detectedType: file.type,
  };
}

/**
 * Validate a list of files, returning a {@link ValidationResult} per file
 * in the same order as the input. Convenience helper for batch selection
 * flows where multiple files are chosen at once (Requirement 7.1).
 *
 * @param files  The files to validate.
 * @param config Optional validation configuration. Defaults to
 *               {@link DEFAULT_VALIDATION_CONFIG}.
 */
export function validateFiles(
  files: File[],
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG,
): ValidationResult[] {
  return files.map((file) => validateFile(file, config));
}
