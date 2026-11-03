"""Desktop-only API: the public tunnel that makes shared presentations reachable from anywhere (share_tunnel.py),
and updating the app to a new version (updates.py)."""

import json
import threading

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .share_tunnel import get_tunnel


@require_http_methods(["GET", "POST"])
def share_tunnel(request):
    """GET: the tunnel's status. POST {"action": "start" | "stop" | "install"}."""
    tunnel = get_tunnel()
    if request.method == "POST":
        try:
            action = json.loads(request.body or b"{}").get("action")
        except (ValueError, AttributeError):
            action = None
        if action == "start":
            tunnel.start()
        elif action == "stop":
            tunnel.stop()
        elif action == "install":
            if not tunnel.installing and not tunnel.binary():
                tunnel.installing = True
                threading.Thread(target=_install_and_start, args=(tunnel,), daemon=True).start()
        else:
            return JsonResponse({"error": "Unknown action"}, status=400)
    return JsonResponse(tunnel.status())


def _install_and_start(tunnel) -> None:
    try:
        tunnel.install()
    except Exception as exc:  # network or platform problems are reported in the dialog
        tunnel.installing = False
        tunnel.error = f"Could not download cloudflared: {exc}"
        return
    tunnel.start()


@require_http_methods(["GET", "POST"])
def app_update(request):
    """GET: the update status (?auto=1 first checks, at most once a day, when automatic checks are on).
    POST {"action": "check" | "install" | "restart" | "skip" | "autoCheck", "version", "enabled"}."""
    from .updates import get_updater, spawn_restart

    updater = get_updater()
    if request.method == "GET":
        if request.GET.get("auto") == "1":
            updater.check(automatic=True)
        return JsonResponse(updater.status())
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        payload = {}
    action = payload.get("action") if isinstance(payload, dict) else None
    if action == "check":
        updater.check()
    elif action == "install":
        if not updater.start_update():
            return JsonResponse({**updater.status(), "error": "This copy of SlideForge cannot update itself"}, status=409)
    elif action == "skip":
        updater.skip(str(payload.get("version") or ""))
    elif action == "autoCheck":
        updater.set_auto_check(bool(payload.get("enabled")))
    elif action == "restart":
        # The page has saved: start the new version once this one has quit, then close the window.
        if updater.state != "updated":
            return JsonResponse({"error": "Nothing to restart into"}, status=409)
        spawn_restart(updater.data_dir)
        threading.Thread(target=_close_window, name="slideforge-restart", daemon=True).start()
    else:
        return JsonResponse({"error": "Unknown action"}, status=400)
    return JsonResponse(updater.status())


def _close_window() -> None:
    """Closes the app's window (the app then quits, and the restart helper starts the new version)."""
    import time

    time.sleep(0.4)  # let the response reach the page first
    try:
        import webview

        for window in list(webview.windows):
            window.destroy()
    except Exception:
        import logging

        logging.getLogger(__name__).exception("Could not close the window to restart")


@require_http_methods(["GET"])
def open_requests(request):
    """Files given on the command line (`slideforge talk.pptx`) waiting for the editor to open them (open_files.py):
    {"files": [{"id", "name", "kind"}]}."""
    from . import open_files, paths

    return JsonResponse({"files": open_files.pending(paths.data_dir())})


@require_http_methods(["GET"])
def open_request_file(request, request_id):
    """One queued file's contents, once: fetching it takes it out of the queue."""
    from django.http import FileResponse

    from . import open_files, paths

    found = open_files.take(paths.data_dir(), request_id)
    if not found:
        return JsonResponse({"error": "Not found"}, status=404)
    path, _name = found
    response = FileResponse(path.open("rb"), content_type="application/octet-stream")
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
