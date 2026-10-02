import json

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.http import HttpResponseBadRequest, JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods


User = get_user_model()


def _request_json(request):
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(str(exc)) from exc


def _session_payload(request):
    accounts_enabled = getattr(settings, "SLIDEFORGE_ACCOUNTS_ENABLED", True)
    if not request.user.is_authenticated:
        return {
            "authenticated": False,
            "user": None,
            "accountsEnabled": accounts_enabled,
        }
    return {
        "authenticated": True,
        "user": {
            "id": request.user.id,
            "username": request.user.get_username(),
        },
        "accountsEnabled": accounts_enabled,
    }


@require_GET
@ensure_csrf_cookie
def auth_session(request):
    return JsonResponse(_session_payload(request))


@require_http_methods(["POST"])
def auth_register(request):
    try:
        payload = _request_json(request)
    except ValueError as exc:
        return HttpResponseBadRequest(str(exc))

    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")

    if len(username) < 3:
        return JsonResponse({"error": "Username must be at least 3 characters"}, status=400)
    if len(password) < 8:
        return JsonResponse({"error": "Password must be at least 8 characters"}, status=400)
    if User.objects.filter(username=username).exists():
        return JsonResponse({"error": "Username already exists"}, status=409)

    user = User.objects.create_user(username=username, password=password)
    login(request, user)
    return JsonResponse(_session_payload(request), status=201)


@require_http_methods(["POST"])
def auth_login(request):
    try:
        payload = _request_json(request)
    except ValueError as exc:
        return HttpResponseBadRequest(str(exc))

    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({"error": "Invalid username or password"}, status=401)

    login(request, user)
    return JsonResponse(_session_payload(request))


@require_http_methods(["POST"])
def auth_logout(request):
    logout(request)
    return JsonResponse({"authenticated": False, "user": None})
