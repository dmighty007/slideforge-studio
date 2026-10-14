"""API for the plugin manager (see plugins.py): list, switch on/off, install from a zip, remove."""

import json

from django.http import Http404, JsonResponse
from django.views.decorators.http import require_http_methods

from . import plugins
from .frontend_files import serve_frontend_file


def _listing(request) -> dict:
    manage = plugins.can_manage(request)
    folder = plugins.user_dir()
    return {
        "plugins": plugins.catalogue(),
        "canManage": manage,
        "canInstall": manage and folder is not None,
        # Where to put plugins by hand; only shown to whoever may manage them.
        "userDir": str(folder) if manage and folder else "",
    }


def _forbidden():
    return JsonResponse({"error": "Only an administrator can change plugins."}, status=403)


@require_http_methods(["GET"])
def plugin_list(request):
    return JsonResponse(_listing(request))


@require_http_methods(["POST", "DELETE"])
def plugin_detail(request, plugin_id):
    if not plugins.can_manage(request):
        return _forbidden()
    try:
        if request.method == "DELETE":
            plugins.remove(plugin_id)
        else:
            try:
                body = json.loads(request.body or b"{}")
            except ValueError:
                return JsonResponse({"error": "Invalid JSON"}, status=400)
            if not isinstance(body, dict) or not isinstance(body.get("enabled"), bool):
                return JsonResponse({"error": "Send {\"enabled\": true|false}."}, status=400)
            plugins.set_enabled(plugin_id, body["enabled"])
    except plugins.PluginError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    return JsonResponse(_listing(request))


@require_http_methods(["POST"])
def plugin_install(request):
    if not plugins.can_manage(request):
        return _forbidden()
    upload = request.FILES.get("plugin")
    if not upload:
        return JsonResponse({"error": "No zip was sent."}, status=400)
    if upload.size > plugins.MAX_ZIP_BYTES:
        return JsonResponse({"error": "The zip is larger than 25 MB."}, status=400)
    try:
        installed = plugins.install_zip(upload.read())
    except plugins.PluginError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    return JsonResponse({**_listing(request), "installed": installed["id"]})


def serve_user_plugin_file(request, path):
    folder = plugins.user_dir()
    if not folder:
        raise Http404("No user plugins folder")
    return serve_frontend_file(request, path, document_root=folder)
