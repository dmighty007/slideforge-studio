"""Desktop-only request handling: launch-token access control and the single local user."""

import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import HttpResponseForbidden, HttpResponseRedirect
from django.utils.functional import SimpleLazyObject


def _matches(candidate: str, token: str) -> bool:
    # compare_digest on str raises TypeError for non-ASCII input; compare bytes instead.
    return secrets.compare_digest(candidate.encode(), token.encode())


# The bundled frontend code holds no user data. Sandboxed iframes (the molecule viewer) request it from an opaque
# origin that never carries the SameSite=Strict launch cookie, so it must load without one. Decks, uploads (/media/)
# and the API stay behind the token.
# /s/ is a shared presentation: viewers have no launch token, the share token is the key (studio/sharing.py).
PUBLIC_PREFIXES = ("/js/", "/css/", "/assets/", "/static/", "/vendor/", "/s/")


def launch_cookie_name(port) -> str:
    # Cookies are shared across ports on the same host, so each running instance gets its own name.
    return f"slideforge_launch_{port}"


class LaunchTokenMiddleware:
    """Only the window/browser opened by the launcher may use the app.

    The launcher opens ``/?token=<per-run token>``. That request trades the token for a cookie and is redirected
    to the same URL without the token. Requests without the cookie are refused, so other programs and pages
    cannot drive the local server through its localhost port.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = settings.SLIDEFORGE_LAUNCH_TOKEN
        if not token or request.path.startswith(PUBLIC_PREFIXES):  # no token: not started by the launcher (tests)
            return self.get_response(request)
        cookie_name = launch_cookie_name(request.get_port())
        if _matches(request.COOKIES.get(cookie_name, ""), token):
            return self.get_response(request)
        if _matches(request.GET.get("token", ""), token):
            params = request.GET.copy()
            params.pop("token")
            target = request.path + (f"?{urlencode(params, doseq=True)}" if params else "")
            response = HttpResponseRedirect(target)
            response.set_cookie(cookie_name, token, httponly=True, samesite="Strict")
            return response
        return HttpResponseForbidden("Open SlideForge from its launcher (run the `slideforge` command).")


def get_local_user():
    user, created = get_user_model().objects.get_or_create(username=settings.SLIDEFORGE_LOCAL_USERNAME)
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user


class LocalUserMiddleware:
    """There is no sign-in on the desktop: every request acts as the single local user."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.user = SimpleLazyObject(get_local_user)
        return self.get_response(request)
