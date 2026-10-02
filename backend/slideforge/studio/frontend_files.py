"""Serving the frontend's own files (scripts, styles, assets)."""

from django.views.static import serve


def serve_frontend_file(request, path, document_root=None):
    """django's static serve, plus "Cache-Control: no-cache".

    Without it browsers may reuse a cached copy without asking (heuristic freshness from Last-Modified). After an
    update that mixes old and new files: ES modules import each other by plain relative paths, so a stale
    module next to a new one fails to load ("does not provide an export named ..."). With no-cache the browser
    revalidates each file, which costs only a 304 when nothing changed.
    """
    response = serve(request, path, document_root=document_root)
    response["Cache-Control"] = "no-cache"
    return response
