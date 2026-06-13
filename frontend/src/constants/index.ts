/**
 * Shared application constants for the MarkItDown Website frontend.
 *
 * Centralises supported MIME types, file size limits, timeout defaults,
 * and API endpoint paths so they can be reused across components and
 * services. Values that may differ per environment (e.g. the API base
 * URL and max file size) are sourced from Vite environment variables
 * with sensible fallbacks.
 *
 * Task 1.3 - Shared constants.
 * Requirements: 2.3, 2.4, 4.2, 14.5
 */

/**
 * Maximum allowed upload size in bytes.
 *
 * Sourced from `VITE_MAX_FILE_SIZE` when provided, otherwise defaults to 5GB
 * to match the backend's default cap. Set `VITE_MAX_FILE_SIZE=0` to disable
 * the client-side limit entirely (accept any size).
 */
export const MAX_FILE_SIZE: number = (() => {
  const raw = import.meta.env.VITE_MAX_FILE_SIZE;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  // A positive value enforces a cap; otherwise default to 5GB. Set to 0 via
  // VITE_MAX_FILE_SIZE to disable the client-side limit entirely.
  if (raw !== undefined && parsed === 0) {
    return 0;
  }
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024 * 1024;
})();

/**
 * Default conversion timeout in seconds (Requirement 4.2).
 */
export const DEFAULT_CONVERSION_TIMEOUT_SECONDS = 30;

/**
 * Allowed bounds for the conversion timeout, matching the backend
 * Pydantic validation (1-300 seconds).
 */
export const MIN_CONVERSION_TIMEOUT_SECONDS = 1;
export const MAX_CONVERSION_TIMEOUT_SECONDS = 300;

/**
 * Maximum number of files processed concurrently by the backend.
 * Used by the UI to communicate batch processing behaviour.
 */
export const MAX_CONCURRENT_CONVERSIONS = 5;

/**
 * Supported MIME types grouped by document category. Used for building
 * the file picker `accept` attribute and validation messaging.
 */
export const SUPPORTED_MIME_TYPE_GROUPS = {
  pdf: ['application/pdf'],
  word: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
  ],
  powerpoint: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.ms-powerpoint', // .ppt
  ],
  excel: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ],
  image: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/webp',
  ],
  audio: [
    'audio/mpeg', // .mp3
    'audio/wav',
    'audio/x-wav',
    'audio/mp4', // .m4a
    'audio/ogg',
    'audio/flac',
  ],
  html: ['text/html'],
} as const;

/**
 * Flat list of all supported MIME types, derived from the grouped map.
 * This is the canonical list used by the validation utility
 * (Requirements 2.3, 2.4).
 */
export const SUPPORTED_MIME_TYPES: string[] = Object.values(
  SUPPORTED_MIME_TYPE_GROUPS,
).flat();

/**
 * Human-readable labels for the supported formats, used in error
 * messages that list accepted formats (Requirement 2.4).
 */
export const SUPPORTED_FORMAT_LABELS: string[] = [
  'PDF',
  'Word (DOC, DOCX)',
  'PowerPoint (PPT, PPTX)',
  'Excel (XLS, XLSX)',
  'Images (JPEG, PNG, GIF, BMP, TIFF, WebP)',
  'Audio (MP3, WAV, M4A, OGG, FLAC)',
  'HTML',
];

/**
 * Executable file extensions that must always be rejected for security
 * (Requirement 13.3). Mirrored on the backend.
 */
export const BLOCKED_FILE_EXTENSIONS: string[] = [
  '.exe',
  '.dll',
  '.sh',
  '.bat',
  '.cmd',
];

/**
 * Base URL of the FastAPI backend, sourced from `VITE_API_BASE_URL`.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/**
 * API endpoint paths exposed by the backend (Requirement 14.x).
 * `download` is a factory because the path is parameterised by result ID.
 */
export const API_ENDPOINTS = {
  convert: '/api/convert',
  download: (resultId: string): string => `/api/download/${resultId}`,
  health: '/api/health',
} as const;

/**
 * Number of upload retry attempts on network failure (Requirement 3.5).
 */
export const UPLOAD_MAX_RETRIES = 3;

/**
 * Interval (ms) between periodic frontend health checks.
 *
 * The status indicator polls the backend health endpoint on this cadence
 * so the displayed system status stays current and can recover from a
 * transient degraded/unavailable state (Requirements 15.5, 15.6).
 */
export const HEALTH_CHECK_POLL_INTERVAL_MS = 30_000;
