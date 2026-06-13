"""POST /api/convert endpoint.

Accepts a multipart/form-data file upload together with optional conversion
parameters, validates the file, converts it to markdown via the
:class:`FileProcessor`, stores the result for later download, and returns a
:class:`ConversionResponse`.

Flow (Requirements 14.1, 14.2, 4.6, 4.7, 11.1):

1. Read the uploaded file bytes.
2. Validate the content with the file validation service. Invalid files yield
   a ``400 Bad Request`` with a descriptive message.
3. Persist the bytes to temporary storage.
4. Convert the file using :meth:`FileProcessor.process_file` with the requested
   options (cloud service, image extraction, timeout). A conversion failure
   yields a ``500 Internal Server Error``.
5. Generate a UUID result ID, build the response, and store it in the shared
   result store so ``GET /api/download/{result_id}`` can serve it.
6. Always clean up the uploaded temporary file, even on failure.

Validates: Requirements 14.1, 14.2, 4.6, 4.7, 11.1
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.constants import ApiEndpoints
from app.models.conversion import (
    ConversionMetadata,
    ConversionRequest,
    ConversionResponse,
)
from app.services.file_processor import (
    FileProcessor,
    ProcessingOptions,
    get_file_processor,
)
from app.services.file_validation import validate_file
from app.services.metrics import MetricsCollector, get_metrics_collector
from app.services.result_store import ResultStore, get_result_store

logger = logging.getLogger("markitdown.api.convert")

router = APIRouter(tags=["conversion"])


@router.post(
    ApiEndpoints.CONVERT,
    response_model=ConversionResponse,
    status_code=status.HTTP_200_OK,
    summary="Convert an uploaded file to markdown",
)
async def convert_file_endpoint(
    file: UploadFile = File(..., description="The file to convert to markdown."),
    cloud_service: Optional[str] = Form(
        default=None,
        description="Optional cloud service: 'azure_di' or 'azure_cu'.",
    ),
    extract_images: bool = Form(
        default=True,
        description="Whether to extract images from the source document.",
    ),
    timeout: int = Form(
        default=30,
        description="Maximum conversion time in seconds (1-300).",
    ),
) -> ConversionResponse:
    """Convert an uploaded file to markdown and return the result.

    Args:
        file: The uploaded multipart file.
        cloud_service: Optional cloud service identifier.
        extract_images: Whether to extract images during conversion.
        timeout: Maximum conversion time in seconds.

    Returns:
        A :class:`ConversionResponse` containing the markdown, metadata, and a
        unique result ID.

    Raises:
        HTTPException: ``400`` for invalid uploads, ``500`` for conversion
            failures.
    """
    processor: FileProcessor = get_file_processor()
    store: ResultStore = get_result_store()
    metrics: MetricsCollector = get_metrics_collector()

    # Validate accompanying options via the Pydantic request model so invalid
    # parameters (e.g. unknown cloud service, out-of-range timeout) are
    # rejected with a 422 by FastAPI's model validation (Requirement 14.5).
    options_model = ConversionRequest(
        cloud_service=cloud_service,
        extract_images=extract_images,
        timeout=timeout,
    )

    # 1. Read the uploaded bytes.
    content = await file.read()
    original_filename = file.filename or "unnamed"

    # 2. Validate the file content (magic bytes, size, safety).
    validation = validate_file(content=content, filename=original_filename)
    if not validation.valid:
        logger.info(
            "Rejected upload '%s': %s", original_filename, validation.error
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=validation.error or "Invalid file.",
        )

    safe_filename = validation.sanitized_filename or original_filename

    # 3. Persist the upload to temporary storage (async, non-blocking I/O).
    temp_path = await processor.save_temp_file_async(content, safe_filename)

    try:
        # 4. Convert the file with the requested options.
        options = ProcessingOptions(
            cloud_service=options_model.cloud_service,
            extract_images=options_model.extract_images,
            timeout=options_model.timeout,
        )
        result = await processor.process_file(temp_path, options)

        # Compute the real size reduction achieved by the conversion. The
        # source size is the uploaded byte count; the output size is the
        # UTF-8 encoded length of the produced markdown. A positive
        # reduction means the markdown is smaller than the original.
        source_size = result.metadata.file_size or len(content)
        output_size = len((result.markdown or "").encode("utf-8"))
        if source_size > 0:
            size_reduction_percent = round(
                (1 - output_size / source_size) * 100, 2
            )
        else:
            size_reduction_percent = 0.0

        metadata = ConversionMetadata(
            file_type=validation.detected_type or result.metadata.file_type,
            file_size=source_size,
            processing_time=result.metadata.processing_time,
            converter_used=result.metadata.converter_used,
            output_size=output_size,
            size_reduction_percent=size_reduction_percent,
            image_count=result.metadata.image_count,
            page_count=result.metadata.page_count,
        )

        # Record the conversion outcome for monitoring (Requirements 15.1, 15.4).
        metrics.record_conversion(
            success=result.success,
            processing_time=result.metadata.processing_time,
        )

        if not result.success:
            # 4a. Conversion failure -> 500 with descriptive message.
            logger.warning(
                "Conversion failed for '%s': %s",
                safe_filename,
                result.error,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=result.error or "Conversion failed.",
            )

        # 5. Build a successful response and store it for later download.
        result_id = str(uuid.uuid4())
        response = ConversionResponse(
            id=result_id,
            markdown=result.markdown,
            metadata=metadata,
            success=True,
            error=None,
            timestamp=datetime.now(timezone.utc),
        )
        store.save(result_id, response, safe_filename)

        logger.info(
            "Converted '%s' -> result %s (%d chars)",
            safe_filename,
            result_id,
            len(result.markdown),
        )
        return response

    finally:
        # 6. Always clean up the uploaded temporary file (Requirement 11.1).
        processor.cleanup_file(temp_path)
