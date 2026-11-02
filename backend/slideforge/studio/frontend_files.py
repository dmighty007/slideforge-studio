"""Serving the frontend's own files (scripts, styles, assets)."""

import posixpath
from pathlib import Path

from django.http import HttpResponseNotModified
from django.utils._os import safe_join
from django.views.static import serve


def _file_tag(document_root, path):
    """A validator for the file as it is now: its modification time to the nanosecond and its size."""
    try:
        full = Path(safe_join(document_root, posixpath.normpath(path).lstrip("/")))
        stat = full.stat()
    except Exception:  # outside the root, missing: serve() answers that
        return None
    if not full.is_file():
        return None
    return f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'


def serve_frontend_file(request, path, document_root=None):
    """django's static serve, plus "Cache-Control: no-cache" and an ETag.

    Without no-cache browsers may reuse a cached copy without asking (heuristic freshness from Last-Modified). After
    an update that mixes old and new files: ES modules import each other by plain relative paths, so a stale module
    next to a new one fails to load ("does not provide an export named ...").

    The ETag: Django answers "not modified" when the browser's copy is dated at or after the file's modification time,
    to the second. A file replaced by one with an older or same-second timestamp (restored from git, copied keeping
    its date) was never sent again: the desktop app kept running an animation engine from before a fix, and the
    examples' animations did not play. The tag changes with any change of time or size, and the date is not asked.
    """
    tag = _file_tag(document_root, path)
    if tag and request.headers.get("If-None-Match") == tag:
        response = HttpResponseNotModified()
        response["ETag"] = tag
        response["Cache-Control"] = "no-cache"
        return response
    request.META.pop("HTTP_IF_MODIFIED_SINCE", None)
    response = serve(request, path, document_root=document_root)
    if tag:
        response["ETag"] = tag
    response["Cache-Control"] = "no-cache"
    return response
