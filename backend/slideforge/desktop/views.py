"""Desktop-only API: the public tunnel that makes shared presentations reachable from anywhere (share_tunnel.py)."""

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
