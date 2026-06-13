/**
 * Batch download utilities for the MarkItDown Website frontend.
 *
 * Packages multiple successful conversion results into a single ZIP
 * archive of markdown files and triggers a browser download. Used by the
 * "Download All" batch operation.
 *
 * Task 8.2 - Implement batch download functionality.
 * Requirements: 7.6
 */

import JSZip from 'jszip';

import type { ConversionResult } from '@/types';

/**
 * Default filename used for the generated ZIP archive.
 */
export const DEFAULT_ZIP_FILENAME = 'tokensaver-conversions.zip';

/**
 * Fallback base name used when a result has no usable original filename.
 */
const FALLBACK_FILE_BASENAME = 'converted';

/**
 * Strips any directory components and a trailing `.md` extension from a
 * filename, returning a safe base name suitable for use inside the ZIP.
 *
 * Path separators are removed to avoid creating nested folders or path
 * traversal entries inside the archive.
 */
function toMarkdownBaseName(originalFileName: string): string {
  // Take only the final path segment (guards against "../" and "dir/file").
  const lastSegment = originalFileName
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();

  const trimmed = (lastSegment ?? '').trim();
  if (trimmed === '') {
    return FALLBACK_FILE_BASENAME;
  }

  // Drop a single trailing markdown extension if present so we don't end
  // up with names like "report.pdf.md" -> keep the source name but ensure
  // exactly one ".md" is appended later.
  return trimmed.replace(/\.md$/i, '');
}

/**
 * Generates a unique `.md` filename for use inside the ZIP, disambiguating
 * duplicate base names by appending an incrementing numeric suffix.
 *
 * @param baseName - The desired base name (without extension).
 * @param usedNames - Set of filenames already assigned within the archive.
 *                    Mutated to record the returned name.
 */
function uniqueMarkdownFileName(
  baseName: string,
  usedNames: Set<string>,
): string {
  let candidate = `${baseName}.md`;
  let counter = 1;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName} (${counter}).md`;
    counter += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Builds a ZIP archive containing one markdown file per conversion result.
 *
 * Duplicate filenames are disambiguated automatically. Each file is named
 * after its `originalFileName` with a `.md` extension.
 *
 * @param results - The conversion results to include in the archive.
 * @returns A Promise resolving to the ZIP archive as a Blob.
 */
export async function createMarkdownZip(
  results: ConversionResult[],
): Promise<Blob> {
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const result of results) {
    const baseName = toMarkdownBaseName(result.originalFileName);
    const fileName = uniqueMarkdownFileName(baseName, usedNames);
    zip.file(fileName, result.markdown ?? '');
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

/**
 * Triggers a browser download of the provided Blob using a temporary
 * object URL and anchor element. The object URL is revoked afterwards to
 * release memory.
 *
 * @param blob - The data to download.
 * @param fileName - The suggested filename for the download.
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    // Append to the DOM so the click is dispatched reliably across browsers.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Packages all provided conversion results into a ZIP of markdown files
 * and triggers a browser download.
 *
 * Callers are expected to pass only successful conversions. If the list is
 * empty, the function is a no-op (no download is triggered).
 *
 * @param results - The successful conversion results to download.
 * @param fileName - Optional name for the downloaded ZIP archive.
 */
export async function downloadAllAsZip(
  results: ConversionResult[],
  fileName: string = DEFAULT_ZIP_FILENAME,
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  const blob = await createMarkdownZip(results);
  triggerBlobDownload(blob, fileName);
}
