/**
 * Documentation content for the MarkItDown Website.
 *
 * This module is the single source of truth for the prose, examples, and
 * reference material rendered by the DocumentationViewer. Each entry is a
 * {@link DocumentationSection} whose `content` is authored as GitHub
 * Flavored Markdown (GFM). Fenced code blocks carry a language hint so the
 * viewer can apply syntax highlighting (Requirement 9.5), and headings are
 * used by the viewer to generate a table of contents (Requirement 9.3).
 *
 * Sections form a navigable tree via `subsections`, and each section's `id`
 * is a stable, URL-safe slug used for deep linking (Requirement 9.4).
 *
 * Task 11.2 - Create documentation content.
 * Requirements: 9.2, 9.4, 9.5
 */

import type { DocumentationSection } from '@/types';

/**
 * The ordered list of documentation sections shown in the viewer.
 *
 * Order matters: it drives both the navigation sidebar and the document
 * flow. The introduction comes first, followed by supported formats, the
 * web interface guide, the Python library guide, the API reference, and an
 * FAQ.
 */
export const DOCUMENTATION_SECTIONS: DocumentationSection[] = [
  {
    id: 'introduction',
    title: 'Introduction & Overview',
    content: `# Introduction & Overview

**TokenSaver** is a fast online tool that converts a wide range of file formats
into clean, lightweight [Markdown](https://commonmark.org/). Convert your
documents straight from your browser — no installation required.

## Why convert to Markdown?

Markdown is plain text, which makes it ideal for feeding documents into Large
Language Models (LLMs) and text-analysis pipelines. Converting a rich document
such as a PDF or a PowerPoint deck to Markdown:

- **Reduces file size** dramatically by dropping binary formatting and embedded
  assets while preserving the meaningful text and structure.
- **Preserves structure** like headings, lists, tables, and links so downstream
  tools keep useful context.
- **Is token-efficient** for LLM prompts, lowering cost and latency compared to
  passing raw documents.
- **Is human-readable and diff-friendly**, so results play nicely with version
  control and code review.

## How it works

1. You upload one or more files through the web interface (or call the API
   directly).
2. The file type is detected automatically and the right converter is applied.
3. You get back rendered Markdown that you can preview, copy, or download.

\`\`\`text
PDF / DOCX / PPTX / XLSX / image / audio / HTML
        │
        ▼
   Conversion
        │
        ▼
   Clean Markdown
\`\`\`
`,
  },
  {
    id: 'supported-formats',
    title: 'Supported File Formats',
    content: `# Supported File Formats

TokenSaver handles the document, image, audio, and markup formats listed below.
Files are validated by **content (magic bytes)**, not just their extension, and
must be **5GB or smaller**.

| Category | Formats | Example extensions |
| --- | --- | --- |
| Documents | PDF | \`.pdf\` |
| Word | Word documents | \`.doc\`, \`.docx\` |
| PowerPoint | Presentations | \`.ppt\`, \`.pptx\` |
| Excel | Spreadsheets | \`.xls\`, \`.xlsx\` |
| Images | JPEG, PNG, GIF, BMP, TIFF, WebP | \`.jpg\`, \`.png\`, \`.gif\`, \`.bmp\`, \`.tiff\`, \`.webp\` |
| Audio | MP3, WAV, M4A, OGG, FLAC | \`.mp3\`, \`.wav\`, \`.m4a\`, \`.ogg\`, \`.flac\` |
| Markup | HTML | \`.html\` |

## What you get for each type

- **PDF** — Text content, headings, and tables are extracted into Markdown.
  Scanned/image-only PDFs benefit from cloud OCR services.
- **Word (DOCX)** — Headings, lists, tables, links, and inline formatting are
  preserved.
- **PowerPoint (PPTX)** — Slide text, titles, and speaker notes become Markdown
  sections.
- **Excel (XLSX)** — Each sheet is rendered as a Markdown table.
- **Images** — Metadata is extracted; with cloud services enabled, embedded text
  is recognised via OCR.
- **Audio** — Metadata is extracted; transcription is available through cloud
  services.
- **HTML** — Markup is converted to equivalent Markdown structure.

## Example: an Excel sheet becomes a Markdown table

A spreadsheet with columns \`Name\`, \`Role\`, and \`Start Date\` converts to:

\`\`\`markdown
| Name | Role | Start Date |
| --- | --- | --- |
| Ada Lovelace | Engineer | 2024-01-15 |
| Alan Turing | Researcher | 2024-02-01 |
\`\`\`

## Example: a Word heading and list

\`\`\`markdown
# Quarterly Report

## Highlights

- Revenue up 12% quarter over quarter
- Launched two new features
- Reduced support backlog by 40%
\`\`\`

> **Note:** Executable file types such as \`.exe\`, \`.dll\`, \`.sh\`, \`.bat\`, and
> \`.cmd\` are always rejected for security reasons.
`,
  },
  {
    id: 'web-interface',
    title: 'Using the Web Interface',
    content: `# Using the Web Interface

The web interface lets you convert files without writing any code.

## Step by step

1. **Add your files.** Drag and drop files onto the upload zone, or click it to
   open the file picker. You can select several files at once.
2. **Review the list.** Each selected file appears in a list. Files that are too
   large or of an unsupported type are flagged immediately with an explanation.
3. **Watch the progress.** Every file shows its own progress indicator as it
   uploads and converts. Batches are processed several files at a time.
4. **Preview the result.** When a conversion finishes, the rendered Markdown
   appears in a preview pane. Switch to the raw view to see the Markdown source.
5. **Save your Markdown.** Use **Copy** to put the Markdown on your clipboard, or
   **Download** to save a \`.md\` file.

## Tips for best results

- Keep individual files under **5GB**.
- If a conversion times out, try a smaller file or split large documents.
- Converting multiple files? Drop them all together to process the batch in one
  go and download each result independently.

## Accessibility

The interface supports full keyboard navigation, screen-reader labels, visible
focus indicators, and browser zoom, and it adapts to screen sizes from small
phones to large desktops.
`,
  },
  {
    id: 'api-reference',
    title: 'API Reference',
    content: `# API Reference

The backend exposes a small REST API. The base URL depends on your deployment;
the examples below assume \`http://localhost:8000\`.

All endpoints return JSON unless noted otherwise. Standard HTTP status codes are
used: \`200\` (success), \`400\` (invalid request), \`404\` (not found), \`500\`
(server error), and \`507\` (insufficient storage).
`,
    subsections: [
      {
        id: 'api-convert',
        title: 'POST /api/convert',
        content: `## POST /api/convert

Convert an uploaded file to Markdown.

**Request** — \`multipart/form-data\`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| \`file\` | file | yes | The file to convert. |
| \`extract_images\` | boolean | no | Whether to extract images. Defaults to \`true\`. |
| \`timeout\` | integer | no | Conversion timeout in seconds (1–300). Defaults to \`30\`. |

Example using \`curl\`:

\`\`\`bash
curl -X POST http://localhost:8000/api/convert \\
  -F "file=@report.pdf" \\
  -F "extract_images=true" \\
  -F "timeout=60"
\`\`\`

Example using JavaScript \`fetch\`:

\`\`\`javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('extract_images', 'true');

const response = await fetch('http://localhost:8000/api/convert', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
console.log(result.markdown);
\`\`\`

**Response** — \`200 OK\`

\`\`\`json
{
  "id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "markdown": "# Quarterly Report\\n\\n## Highlights\\n\\n- Revenue up 12%...",
  "metadata": {
    "file_type": "application/pdf",
    "file_size": 248183,
    "processing_time": 1.42,
    "converter_used": "PdfConverter",
    "page_count": 12
  },
  "success": true,
  "timestamp": "2024-05-01T12:34:56.000Z"
}
\`\`\`

**Error response** — \`400 Bad Request\`

\`\`\`json
{
  "detail": "Unsupported file type: application/x-msdownload"
}
\`\`\`
`,
      },
      {
        id: 'api-download',
        title: 'GET /api/download/{result_id}',
        content: `## GET /api/download/{result_id}

Download a previously converted result as a Markdown file. Results are kept in
temporary storage for up to one hour.

**Request**

\`\`\`bash
curl -L -o report.md \\
  http://localhost:8000/api/download/3f2504e0-4f89-41d3-9a0c-0305e82c3301
\`\`\`

**Response** — \`200 OK\`

- \`Content-Type: text/markdown\`
- \`Content-Disposition: attachment; filename="{result_id}.md"\`

The body is the raw Markdown text:

\`\`\`markdown
# Quarterly Report

## Highlights

- Revenue up 12% quarter over quarter
\`\`\`

**Error response** — \`404 Not Found\`

\`\`\`json
{
  "detail": "Result not found"
}
\`\`\`
`,
      },
      {
        id: 'api-health',
        title: 'GET /api/health',
        content: `## GET /api/health

Report system status and the list of supported formats. Useful for monitoring
and for the frontend status indicator.

**Request**

\`\`\`bash
curl http://localhost:8000/api/health
\`\`\`

**Response** — \`200 OK\`

\`\`\`json
{
  "status": "healthy",
  "version": "1.0.0",
  "supported_formats": [
    "PDF",
    "Word (DOC, DOCX)",
    "PowerPoint (PPT, PPTX)",
    "Excel (XLS, XLSX)",
    "Images (JPEG, PNG, GIF, BMP, TIFF, WebP)",
    "Audio (MP3, WAV, M4A, OGG, FLAC)",
    "HTML"
  ],
  "markitdown_available": true
}
\`\`\`

The \`status\` field is one of \`healthy\`, \`degraded\`, or \`unavailable\`. A
\`degraded\` status indicates resource constraints (for example, low disk space)
while the service remains operational.
`,
      },
    ],
  },
  {
    id: 'faq',
    title: 'FAQ',
    content: `# Frequently Asked Questions

## What is the maximum file size?

Each file must be **5GB or smaller**. Larger files are rejected before upload
with a clear message.

## Which file formats are supported?

PDF, Word, PowerPoint, Excel, common image formats, common audio formats, and
HTML. See [Supported File Formats](#supported-formats) for the full list.

## How long are my files and results kept?

Uploaded files are deleted immediately after conversion. Converted results are
stored temporarily for up to **one hour**, then removed automatically.

## Are my files private?

Yes. Content is served over HTTPS, uploaded files are deleted right after
conversion, results expire within an hour, and file contents are never logged.

## Why did my conversion time out?

The default conversion timeout is **30 seconds**. Very large or complex files may
exceed it. Try a smaller file, split the document, or increase the \`timeout\`
parameter when calling the API directly.

## Can I convert several files at once?

Yes. Select or drop multiple files together. Up to five conversions are
processed concurrently and results are returned in the same order you uploaded
them, even if some individual files fail.
`,
  },
];

export default DOCUMENTATION_SECTIONS;
