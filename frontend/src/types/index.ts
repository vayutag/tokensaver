/**
 * Shared TypeScript type definitions for the MarkItDown Website frontend.
 *
 * These types model the client-side representation of file uploads,
 * conversion results, and validation outcomes. They mirror the backend
 * Pydantic models (see `backend/app/models`) where the two communicate
 * over the REST API.
 *
 * Task 1.3 - Shared type definitions.
 * Requirements: 2.3, 2.4, 4.2, 14.5
 */

/**
 * Lifecycle status of a single file as it moves through the
 * upload → conversion pipeline.
 */
export type FileUploadStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Represents a single file selected by the user along with its
 * upload/conversion state.
 *
 * Validation rules (enforced by application logic, not the type system):
 * - `id` must be a unique UUID v4
 * - `file.size` must not exceed the configured maximum (50MB)
 * - `progress` must be between 0 and 100
 * - `error` is expected when `status === 'failed'`
 * - `result` is expected when `status === 'completed'`
 */
export interface FileUpload {
  /** Unique client-generated identifier (UUID v4). */
  id: string;
  /** The underlying browser File object. */
  file: File;
  /** Current lifecycle status. */
  status: FileUploadStatus;
  /** Upload/processing progress as a percentage from 0 to 100. */
  progress: number;
  /** Human-readable error message, present when status is 'failed'. */
  error?: string;
  /** Conversion result, present when status is 'completed'. */
  result?: ConversionResult;
}

/**
 * Metadata describing a completed conversion.
 *
 * Mirrors the backend `ConversionMetadata` Pydantic model. Note the
 * frontend expresses `processingTime` in milliseconds for UI display,
 * while the backend reports seconds.
 */
export interface ConversionMetadata {
  /** Detected MIME type of the source file. */
  fileType: string;
  /** Size of the source file in bytes. */
  fileSize: number;
  /** Time taken to perform the conversion, in milliseconds. */
  processingTime: number;
  /** Identifier of the converter used by the MarkItDown library. */
  converterUsed: string;
  /** Size of the converted markdown output in bytes (UTF-8). */
  outputSize?: number;
  /**
   * Percentage reduction from source size to markdown output size.
   * Positive means the output is smaller; negative means it grew.
   */
  sizeReductionPercent?: number;
  /** Number of images extracted, when applicable. */
  imageCount?: number;
  /** Number of pages processed, when applicable. */
  pageCount?: number;
}

/**
 * The result of converting a single file to markdown.
 *
 * Mirrors the backend `ConversionResponse` Pydantic model.
 */
export interface ConversionResult {
  /** Unique server-generated result identifier (UUID v4). */
  id: string;
  /** Original name of the uploaded file. */
  originalFileName: string;
  /** Converted markdown content (may be empty for failed conversions). */
  markdown: string;
  /** Structured metadata about the conversion. */
  metadata: ConversionMetadata;
  /** When the conversion completed. */
  timestamp: Date;
  /** URL from which the markdown file can be downloaded. */
  downloadUrl: string;
}

/**
 * The outcome of validating a file against size and type constraints.
 *
 * Returned by the client-side validation utility before upload. When
 * `valid` is false, `error` contains a user-facing explanation. When
 * `valid` is true, `detectedType` contains the detected MIME type.
 */
export interface ValidationResult {
  /** Whether the file passed all validation checks. */
  valid: boolean;
  /** Descriptive error message when validation fails. */
  error?: string;
  /** Detected MIME type when validation succeeds. */
  detectedType?: string;
}

/**
 * Configuration used by the file validation utility.
 */
export interface ValidationConfig {
  /** Maximum allowed file size in bytes. */
  maxFileSize: number;
  /** List of accepted MIME types. */
  supportedTypes: string[];
}

/**
 * A single code example shown within a documentation section.
 *
 * Mirrors the `CodeExample` shape from the design document. The
 * documentation content itself is authored as markdown (see
 * {@link DocumentationSection.content}); this structured shape is available
 * for cases where examples are supplied separately from prose.
 */
export interface CodeExample {
  /** Language identifier used for syntax highlighting (e.g. "python"). */
  language: string;
  /** The example source code. */
  code: string;
  /** Human-readable description of what the example demonstrates. */
  description: string;
}

/**
 * A navigable section of the documentation.
 *
 * Sections form a tree: a section may contain nested {@link subsections}.
 * The DocumentationViewer renders {@link content} as markdown, builds a
 * table of contents from its headings, and supports deep linking to a
 * section via the URL hash (e.g. `#section-id`).
 *
 * Mirrors the `DocumentationSection` shape from the design document.
 */
export interface DocumentationSection {
  /** Stable, URL-safe identifier used for navigation and deep links. */
  id: string;
  /** Display title shown in the navigation sidebar. */
  title: string;
  /** Section body authored as GitHub Flavored Markdown. */
  content: string;
  /** Optional structured code examples associated with the section. */
  codeExamples?: CodeExample[];
  /** Optional nested subsections. */
  subsections?: DocumentationSection[];
}

/**
 * A single entry in a section's generated table of contents.
 */
export interface TocEntry {
  /** Heading depth (1-6) derived from the markdown heading level. */
  level: number;
  /** The heading text. */
  text: string;
  /** URL-safe slug used as the heading element id and hash target. */
  slug: string;
}

/**
 * System health information returned by the backend health endpoint.
 *
 * Mirrors the backend `HealthResponse` Pydantic model.
 */
export interface HealthResponse {
  /** Overall system status. */
  status: 'healthy' | 'degraded' | 'unavailable';
  /** Backend application version. */
  version: string;
  /** List of supported file format labels. */
  supportedFormats: string[];
  /** Whether the MarkItDown library is available. */
  markitdownAvailable?: boolean;
}
