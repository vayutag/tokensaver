/**
 * File upload orchestration hook for the MarkItDown Website frontend.
 *
 * `useFileUploads` manages the full client-side lifecycle of one or more
 * file uploads:
 *
 * 1. Files added via {@link UseFileUploadsResult.addFiles} are validated
 *    locally before any network activity (Requirements 2.x via
 *    {@link validateFile}). Invalid files are recorded immediately with a
 *    `failed` status and a descriptive error so the UI can surface them.
 * 2. Valid files are queued (`pending`) and uploaded respecting a
 *    concurrency limit so no more than `maxConcurrent` uploads/conversions
 *    run at once (mirrors the backend's 5-file limit, Requirements 7.1, 7.2).
 * 3. Each upload reports progress 0-100 (Requirements 3.1, 3.2). When the
 *    upload completes the item transitions to `processing` to indicate the
 *    backend conversion has begun (Requirement 3.3), and finally to
 *    `completed` (with the {@link ConversionResult}) or `failed`.
 * 4. Every file tracks its own independent state so batch uploads show
 *    per-file progress and status (Requirements 3.4, 7.5).
 *
 * The hook is UI-agnostic: it exposes the `uploads` array plus imperative
 * actions and leaves rendering to consumers (e.g. FileUploadList,
 * ConversionResults).
 *
 * Task 6.2 - Implement file upload orchestration.
 * Requirements: 3.1, 3.2, 3.3, 7.1, 7.5
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  uploadToServer,
  type UploadOptions,
} from '@/services/api';
import { validateFile } from '@/utils/fileValidation';
import { MAX_CONCURRENT_CONVERSIONS } from '@/constants/index';
import type {
  ConversionResult,
  FileUpload,
  ValidationConfig,
} from '@/types/index';

/**
 * Upload options the consumer may configure per hook instance. The
 * progress callback and abort signal are managed internally by the hook,
 * so they are excluded here.
 */
export type FileUploadRequestOptions = Omit<
  UploadOptions,
  'onProgress' | 'signal'
>;

/** Configuration accepted by {@link useFileUploads}. */
export interface UseFileUploadsOptions {
  /**
   * Validation configuration used before upload. Defaults to the standard
   * 50MB / supported-MIME-type configuration in {@link validateFile}.
   */
  validationConfig?: ValidationConfig;
  /** Conversion request options forwarded to {@link uploadToServer}. */
  uploadOptions?: FileUploadRequestOptions;
  /**
   * Maximum number of uploads/conversions allowed in flight at once.
   * Defaults to {@link MAX_CONCURRENT_CONVERSIONS} (5) to match the backend.
   */
  maxConcurrent?: number;
}

/** Public surface returned by {@link useFileUploads}. */
export interface UseFileUploadsResult {
  /** The current list of tracked uploads, in the order they were added. */
  uploads: FileUpload[];
  /** True while any upload is pending, uploading, or processing. */
  isUploading: boolean;
  /**
   * Validate and enqueue files for upload. Accepts both an array of
   * `File`s and a raw `FileList` (e.g. from an `<input type="file">`).
   */
  addFiles: (files: File[] | FileList) => void;
  /** Remove a single upload, aborting it if currently in flight. */
  removeUpload: (id: string) => void;
  /** Re-queue a previously failed upload for another attempt. */
  retryUpload: (id: string) => void;
  /** Remove all completed uploads from the list. */
  clearCompleted: () => void;
  /** Abort and remove every upload. */
  clearAll: () => void;
}

/** Build a user-facing message from an unknown thrown value. */
function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Upload failed due to an unexpected error.';
}

/**
 * Orchestrate validation, upload, progress tracking, and conversion-result
 * storage for a batch of files.
 */
export function useFileUploads(
  options: UseFileUploadsOptions = {},
): UseFileUploadsResult {
  const [uploads, setUploads] = useState<FileUpload[]>([]);

  // Keep the latest options in a ref so async work and the scheduling
  // effect always read current values without forcing re-subscription.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // AbortControllers for in-flight uploads, keyed by upload id.
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // Ids whose upload has already been started, preventing the scheduling
  // effect from launching the same upload twice across re-renders.
  const startedRef = useRef<Set<string>>(new Set());

  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_CONVERSIONS;

  /** Apply a partial patch (or updater) to a single upload by id. */
  const updateUpload = useCallback(
    (
      id: string,
      patch: Partial<FileUpload> | ((prev: FileUpload) => FileUpload),
    ) => {
      setUploads((prev) =>
        prev.map((upload) => {
          if (upload.id !== id) {
            return upload;
          }
          return typeof patch === 'function'
            ? patch(upload)
            : { ...upload, ...patch };
        }),
      );
    },
    [],
  );

  /** Perform the upload + conversion for a single queued file. */
  const startUpload = useCallback(
    async (upload: FileUpload): Promise<void> => {
      const { id, file } = upload;

      const controller = new AbortController();
      controllersRef.current.set(id, controller);

      // Mark the start of the upload (Requirement 3.1).
      updateUpload(id, { status: 'uploading', progress: 0, error: undefined });

      try {
        const result = await uploadToServer(file, {
          ...optionsRef.current.uploadOptions,
          signal: controller.signal,
          onProgress: (progress) => {
            // Monotonic 0-100 progress (Requirement 3.2). On reaching 100%
            // the upload is complete and backend conversion begins, so the
            // item moves to `processing` (Requirement 3.3).
            updateUpload(id, (prev) => {
              if (prev.status !== 'uploading' && prev.status !== 'pending') {
                return prev;
              }
              return {
                ...prev,
                progress,
                status: progress >= 100 ? 'processing' : 'uploading',
              };
            });
          },
        });

        // Store the conversion result on success.
        updateUpload(id, {
          status: 'completed',
          progress: 100,
          result,
          error: undefined,
        });
      } catch (error) {
        // A canceled request means the upload was intentionally removed;
        // there is no item left to update in that case.
        if (error instanceof ApiError && error.kind === 'canceled') {
          return;
        }
        updateUpload(id, {
          status: 'failed',
          error: toErrorMessage(error),
        });
      } finally {
        controllersRef.current.delete(id);
      }
    },
    [updateUpload],
  );

  // Scheduler: whenever the upload list changes, start as many pending
  // uploads as the concurrency budget allows (Requirements 7.1, 7.2).
  useEffect(() => {
    const activeCount = uploads.filter(
      (upload) =>
        upload.status === 'uploading' || upload.status === 'processing',
    ).length;

    let availableSlots = maxConcurrent - activeCount;
    if (availableSlots <= 0) {
      return;
    }

    for (const upload of uploads) {
      if (availableSlots <= 0) {
        break;
      }
      if (upload.status === 'pending' && !startedRef.current.has(upload.id)) {
        startedRef.current.add(upload.id);
        availableSlots -= 1;
        void startUpload(upload);
      }
    }
  }, [uploads, maxConcurrent, startUpload]);

  // Abort any in-flight uploads when the consumer unmounts.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, []);

  const addFiles = useCallback((input: File[] | FileList) => {
    const files = Array.from(input);
    if (files.length === 0) {
      return;
    }

    // Validate every file up-front so invalid selections surface immediately
    // without a network round-trip. Valid files are queued as `pending`.
    const newUploads = files.map((file): FileUpload => {
      const id = crypto.randomUUID();
      const validation = validateFile(file, optionsRef.current.validationConfig);

      if (!validation.valid) {
        return {
          id,
          file,
          status: 'failed',
          progress: 0,
          error: validation.error,
        };
      }

      return { id, file, status: 'pending', progress: 0 };
    });

    setUploads((prev) => [...prev, ...newUploads]);
  }, []);

  const removeUpload = useCallback((id: string) => {
    const controller = controllersRef.current.get(id);
    if (controller) {
      controller.abort();
      controllersRef.current.delete(id);
    }
    startedRef.current.delete(id);
    setUploads((prev) => prev.filter((upload) => upload.id !== id));
  }, []);

  const retryUpload = useCallback(
    (id: string) => {
      // Allow the scheduler to pick the upload up again.
      startedRef.current.delete(id);
      updateUpload(id, (prev) =>
        prev.status === 'failed'
          ? { ...prev, status: 'pending', progress: 0, error: undefined }
          : prev,
      );
    },
    [updateUpload],
  );

  const clearCompleted = useCallback(() => {
    setUploads((prev) => {
      const removedIds = prev
        .filter((upload) => upload.status === 'completed')
        .map((upload) => upload.id);
      removedIds.forEach((id) => startedRef.current.delete(id));
      return prev.filter((upload) => upload.status !== 'completed');
    });
  }, []);

  const clearAll = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    startedRef.current.clear();
    setUploads([]);
  }, []);

  const isUploading = uploads.some(
    (upload) =>
      upload.status === 'pending' ||
      upload.status === 'uploading' ||
      upload.status === 'processing',
  );

  return {
    uploads,
    isUploading,
    addFiles,
    removeUpload,
    retryUpload,
    clearCompleted,
    clearAll,
  };
}

export default useFileUploads;
