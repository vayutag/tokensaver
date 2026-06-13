/**
 * API service module for the MarkItDown Website frontend.
 *
 * Wraps the FastAPI backend REST contract behind a small, typed client:
 *
 * - {@link uploadToServer}  POST /api/convert  (multipart upload + progress)
 * - {@link downloadResult}  GET  /api/download/{result_id}  (markdown file)
 * - {@link getHealth}       GET  /api/health  (system status)
 *
 * Network failures are retried with exponential backoff
 * (Requirements 3.5, 3.6). Backend responses use snake_case and report
 * processing time in seconds; this module maps them onto the camelCase
 * frontend types ({@link ConversionResult}, {@link HealthResponse}) and
 * normalises processing time to milliseconds.
 *
 * Task 6.1 - Create API service module.
 * Requirements: 3.5, 3.6, 12.2, 6.2
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosProgressEvent,
  type AxiosRequestConfig,
} from 'axios';

import {
  API_BASE_URL,
  API_ENDPOINTS,
  DEFAULT_CONVERSION_TIMEOUT_SECONDS,
  UPLOAD_MAX_RETRIES,
} from '@/constants/index';
import type {
  ConversionMetadata,
  ConversionResult,
  HealthResponse,
} from '@/types/index';

/**
 * Shape of the conversion response as returned by the backend
 * (snake_case Pydantic models). Internal to this module.
 */
interface RawConversionMetadata {
  file_type: string;
  file_size: number;
  processing_time: number; // seconds
  converter_used: string;
  output_size?: number | null;
  size_reduction_percent?: number | null;
  image_count?: number | null;
  page_count?: number | null;
}

interface RawConversionResponse {
  id: string;
  markdown: string;
  metadata: RawConversionMetadata;
  success: boolean;
  error?: string | null;
  timestamp: string;
}

interface RawHealthResponse {
  status: 'healthy' | 'degraded' | 'unavailable';
  version: string;
  supported_formats: string[];
  markitdown_available?: boolean;
}

/**
 * Categorises the kind of failure surfaced by the API client so callers
 * can render appropriate, user-friendly messages (Requirement 10.3).
 */
export type ApiErrorKind =
  | 'network' // request sent but no response (connection issue)
  | 'timeout' // request exceeded the configured timeout
  | 'canceled' // request was aborted by the caller
  | 'http' // server responded with a non-2xx status
  | 'unknown';

/**
 * Normalised error thrown by all API service functions.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status code, present when `kind === 'http'`. */
  readonly status?: number;
  /** The originating error, when available. */
  readonly cause?: unknown;

  constructor(
    message: string,
    kind: ApiErrorKind,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.cause = options.cause;
  }

  /** Whether retrying the request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

/**
 * Options accepted by {@link uploadToServer}, mirroring the optional
 * form fields supported by POST /api/convert.
 */
export interface UploadOptions {
  /** Optional cloud service to use for enhanced conversion. */
  cloudService?: 'azure_di' | 'azure_cu' | null;
  /** Whether to extract images from the source document (default true). */
  extractImages?: boolean;
  /** Maximum conversion time in seconds (1-300). */
  timeout?: number;
  /** Callback invoked with upload progress (0-100). */
  onProgress?: (progress: number) => void;
  /** Allows the caller to abort the upload. */
  signal?: AbortSignal;
  /** Override the number of retry attempts on network failure. */
  maxRetries?: number;
}

/** Base delay (ms) for exponential backoff between retries. */
const RETRY_BASE_DELAY_MS = 500;

/**
 * Shared axios instance configured with the backend base URL.
 *
 * The base URL is sourced from the `VITE_API_BASE_URL` constant so the
 * same build can target different environments. In development the Vite
 * dev-server proxy also forwards `/api` to the backend.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  // No global timeout: conversion can legitimately take up to ~30s. Per-call
  // timeouts are applied where appropriate (e.g. the health check).
  headers: {
    Accept: 'application/json',
  },
});

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate an unknown thrown value (typically an AxiosError) into a
 * normalised {@link ApiError}.
 */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (axios.isCancel(error)) {
    return new ApiError('The request was canceled.', 'canceled', {
      cause: error,
    });
  }

  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError(
        'The request timed out. Please try again.',
        'timeout',
        { cause: error },
      );
    }

    if (error.response) {
      const status = error.response.status;
      const detail = extractErrorDetail(error.response.data);
      return new ApiError(
        detail ?? `Request failed with status ${status}.`,
        'http',
        { status, cause: error },
      );
    }

    // A request was made but no response was received -> network issue.
    return new ApiError(
      'Unable to reach the server. Please check your connection and try again.',
      'network',
      { cause: error },
    );
  }

  return new ApiError(
    error instanceof Error ? error.message : 'An unexpected error occurred.',
    'unknown',
    { cause: error },
  );
}

/**
 * Pull a human-readable message out of a FastAPI error payload, which
 * commonly takes the shape `{ detail: string | [...] }`.
 */
function extractErrorDetail(data: unknown): string | undefined {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    // Pydantic validation errors: array of { msg, loc, ... }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first === 'object' && 'msg' in first) {
        const msg = (first as { msg: unknown }).msg;
        if (typeof msg === 'string') {
          return msg;
        }
      }
    }
  }
  return undefined;
}

/**
 * Run `operation` with retry-on-network-failure semantics and exponential
 * backoff (Requirements 3.5, 3.6).
 *
 * The operation is attempted once and then retried up to `maxRetries`
 * additional times. Only retryable failures (network/timeout) trigger a
 * retry; HTTP errors (e.g. 400/404/500) and cancellations fail fast since
 * retrying them cannot change the outcome.
 *
 * Backoff for retry `n` (1-indexed) is `RETRY_BASE_DELAY_MS * 2^(n-1)`,
 * yielding 500ms, 1000ms, 2000ms, ...
 *
 * @throws {ApiError} the last error encountered once retries are exhausted.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = UPLOAD_MAX_RETRIES,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: ApiError = new ApiError(
    'Operation failed.',
    'unknown',
  );

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = toApiError(error);

      // Do not retry non-retryable failures or when the caller aborted.
      if (!lastError.isRetryable || signal?.aborted) {
        throw lastError;
      }

      // No delay needed after the final attempt.
      if (attempt < maxRetries) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw lastError;
}

/** Map a raw backend metadata object onto the frontend shape. */
function mapMetadata(raw: RawConversionMetadata): ConversionMetadata {
  return {
    fileType: raw.file_type,
    fileSize: raw.file_size,
    // Backend reports seconds; the UI displays milliseconds.
    processingTime: Math.round(raw.processing_time * 1000),
    converterUsed: raw.converter_used,
    outputSize: raw.output_size ?? undefined,
    sizeReductionPercent: raw.size_reduction_percent ?? undefined,
    imageCount: raw.image_count ?? undefined,
    pageCount: raw.page_count ?? undefined,
  };
}

/**
 * Build the absolute download URL for a given result ID.
 */
export function getDownloadUrl(resultId: string): string {
  const base = API_BASE_URL.replace(/\/$/, '');
  return `${base}${API_ENDPOINTS.download(resultId)}`;
}

/**
 * Upload a file to the backend for conversion, reporting upload progress.
 *
 * Wraps POST /api/convert (multipart/form-data, field `file`). On success
 * the snake_case backend response is mapped onto a {@link ConversionResult}.
 * The original file name is preserved from the supplied {@link File} since
 * the backend response does not echo it back.
 *
 * Network failures are retried with exponential backoff (Requirement 3.5).
 * When all attempts fail an {@link ApiError} is thrown so callers can show
 * an error and offer manual retry (Requirement 3.6).
 *
 * @param file The file to convert.
 * @param options Upload options including the progress callback.
 * @returns The mapped conversion result.
 * @throws {ApiError} when the upload ultimately fails.
 */
export async function uploadToServer(
  file: File,
  options: UploadOptions = {},
): Promise<ConversionResult> {
  const {
    cloudService = null,
    extractImages = true,
    timeout = DEFAULT_CONVERSION_TIMEOUT_SECONDS,
    onProgress,
    signal,
    maxRetries = UPLOAD_MAX_RETRIES,
  } = options;

  const performUpload = async (): Promise<ConversionResult> => {
    // A fresh FormData per attempt: a stream/blob may only be consumed once.
    const formData = new FormData();
    formData.append('file', file, file.name);
    if (cloudService) {
      formData.append('cloud_service', cloudService);
    }
    formData.append('extract_images', String(extractImages));
    formData.append('timeout', String(timeout));

    const config: AxiosRequestConfig = {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (!onProgress) {
          return;
        }
        if (event.total && event.total > 0) {
          const percent = Math.round((event.loaded / event.total) * 100);
          // Clamp to [0, 100] to guard against rounding overshoot.
          onProgress(Math.min(100, Math.max(0, percent)));
        }
      },
    };

    const { data } = await apiClient.post<RawConversionResponse>(
      API_ENDPOINTS.convert,
      formData,
      config,
    );

    return {
      id: data.id,
      originalFileName: file.name,
      markdown: data.markdown,
      metadata: mapMetadata(data.metadata),
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
      downloadUrl: getDownloadUrl(data.id),
    };
  };

  return withRetry(performUpload, maxRetries, signal);
}

/**
 * Fetch the converted markdown for `resultId` from the backend.
 *
 * Wraps GET /api/download/{result_id}, which responds with
 * `Content-Type: text/markdown`. Returns the raw markdown text.
 *
 * @throws {ApiError} when the request fails (e.g. 404 for an expired result).
 */
export async function fetchMarkdown(resultId: string): Promise<string> {
  try {
    const { data } = await apiClient.get<string>(
      API_ENDPOINTS.download(resultId),
      { responseType: 'text', transformResponse: (value) => value },
    );
    return data;
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * Download the converted markdown result as a file in the browser.
 *
 * Fetches the markdown for `resultId` and triggers a client-side download
 * using a temporary object URL. The suggested filename defaults to
 * `{resultId}.md` to match the backend's Content-Disposition header
 * (Requirement 6.5/6.6) but can be overridden (e.g. with the original name).
 *
 * @param resultId The result identifier returned from conversion.
 * @param fileName Optional download filename (without needing the extension).
 * @throws {ApiError} when the markdown cannot be retrieved.
 */
export async function downloadResult(
  resultId: string,
  fileName?: string,
): Promise<void> {
  const markdown = await fetchMarkdown(resultId);

  const suggestedName = ensureMarkdownExtension(fileName ?? `${resultId}.md`);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = suggestedName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // Release the object URL to avoid leaking memory.
    URL.revokeObjectURL(objectUrl);
  }
}

/** Ensure a filename ends with `.md`. */
function ensureMarkdownExtension(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
}

/**
 * Query the backend health endpoint and map the response.
 *
 * Wraps GET /api/health. Retries on transient network failures so the UI
 * status indicator can recover from brief connectivity blips
 * (Requirements 12.2, 15.5). A short timeout keeps the status check snappy.
 *
 * @throws {ApiError} when the health endpoint cannot be reached.
 */
export async function getHealth(): Promise<HealthResponse> {
  const fetchHealth = async (): Promise<HealthResponse> => {
    const { data } = await apiClient.get<RawHealthResponse>(
      API_ENDPOINTS.health,
      { timeout: 5000 },
    );
    return {
      status: data.status,
      version: data.version,
      supportedFormats: data.supported_formats ?? [],
      markitdownAvailable: data.markitdown_available,
    };
  };

  return withRetry(fetchHealth, UPLOAD_MAX_RETRIES);
}
