"""GET /api/download/{result_id} endpoint.

Serves a previously converted markdown document as a downloadable file. The
result is looked up in the shared result store populated by the convert
endpoint.

Flow (Requirements 14.3, 6.3, 6.4, 6.5, 6.6):

1. Validate that ``result_id`` is a well-formed UUID. Malformed IDs yield a
   ``404 Not Found`` (the ID cannot correspond to any stored result).
2. Retrieve the result from the store. Missing or expired results yield
   ``404 Not Found`` (Requirement 6.4).
3. Return the markdown content with ``Content-Type: text/markdown`` and a
   ``Content-Disposition`` header suggesting ``{result_id}.md`` as the filename
   (Requirements 6.5, 6.6).

Validates: Requirements 14.3, 6.3, 6.4, 6.5, 6.6
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from app.constants import ApiEndpoints
from app.services.result_store import ResultStore, get_result_store

logger = logging.getLogger("markitdown.api.download")

router = APIRouter(tags=["download"])


def _is_valid_uuid(value: str) -> bool:
    """Return ``True`` when ``value`` is a well-formed UUID string."""
    try:
        uuid.UUID(value)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


@router.get(
    ApiEndpoints.DOWNLOAD,
    summary="Download a converted markdown result",
    responses={
        200: {
            "content": {"text/markdown": {}},
            "description": "The converted markdown file.",
        },
        404: {"description": "Result not found or expired."},
    },
)
async def download_result_endpoint(result_id: str) -> Response:
    """Return the stored markdown for ``result_id`` as a downloadable file.

    Args:
        result_id: The UUID of a previously converted result.

    Returns:
        A :class:`Response` carrying the markdown content with download headers.

    Raises:
        HTTPException: ``404`` when the ID is malformed, unknown, or expired.
    """
    store: ResultStore = get_result_store()

    # 1. Validate the result_id format. A non-UUID can never match a result.
    if not _is_valid_uuid(result_id):
        logger.info("Rejected download for malformed result_id '%s'", result_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Result not found.",
        )

    # 2. Retrieve the result; missing or expired -> 404.
    entry = store.get(result_id)
    if entry is None:
        logger.info("Download miss for result_id '%s'", result_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Result not found or has expired.",
        )

    # 3. Serve the markdown with download headers (Requirements 6.5, 6.6).
    filename = f"{result_id}.md"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    logger.info("Serving download for result_id '%s'", result_id)
    return Response(
        content=entry.markdown,
        media_type="text/markdown",
        headers=headers,
    )
