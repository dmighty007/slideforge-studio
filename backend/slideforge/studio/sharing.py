"""Public, read-only viewing links ("Share").

The editor builds the same standalone viewer as the HTML export and uploads it; it is stored per link in the
share directory and served at /s/<token>/. Only that viewer is reachable through a link: its page, styles,
scripts and pictures, plus a short list of the app's own font and molecule-viewer files. Nothing of the editor,
its API or other presentations is. Stopping sharing deletes the link and its files.
"""

import io
import mimetypes
import posixpath
import secrets
import shutil
import zipfile
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone

from .models import ShareLink

MAX_BUNDLE_BYTES = 300 * 1024 * 1024  # uncompressed
MAX_BUNDLE_FILES = 2000
BUNDLE_DIRECTORIES = ("css/", "js/", "assets/")
# App files the viewer page loads from vendor/ (fonts, icons, the 3D molecule viewer), served from the app itself.
SHARED_VENDOR_PREFIXES = ("fonts/", "fontsource/", "fontawesome/", "ngl/")

SHARE_HEADERS = {
    # Each request gets the latest published version.
    "Cache-Control": "no-cache",
    # Links are private: not indexed, and the address is not passed on when a viewer follows a link.
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
SHARE_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "frame-src 'self' data: blob: https:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ]
)


class BundleError(ValueError):
    """The uploaded viewer bundle is not acceptable."""


def share_root() -> Path:
    root = getattr(settings, "SLIDEFORGE_SHARE_DIR", None) or Path(settings.MEDIA_ROOT).parent / "shares"
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def share_directory(token: str) -> Path:
    return share_root() / token


def new_token() -> str:
    return secrets.token_urlsafe(18)


def _bundle_member_path(name: str) -> str:
    """The safe relative path of a zip member, or raise BundleError."""
    if "\\" in name or name.startswith("/") or "\x00" in name:
        raise BundleError(f"Unexpected file in bundle: {name!r}")
    clean = posixpath.normpath(name)
    if clean.startswith("../") or clean == ".." or clean.startswith("/"):
        raise BundleError(f"Unexpected file in bundle: {name!r}")
    if clean != "index.html" and not clean.startswith(BUNDLE_DIRECTORIES):
        raise BundleError(f"Unexpected file in bundle: {name!r}")
    return clean


def store_bundle(token: str, data: bytes) -> None:
    """Unpack a viewer bundle (zip) for a link, replacing the previous one in a single step."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise BundleError("The upload is not a zip file") from exc
    members = [info for info in archive.infolist() if not info.is_dir()]
    if not any(info.filename == "index.html" for info in members):
        raise BundleError("The bundle has no index.html")
    if len(members) > MAX_BUNDLE_FILES:
        raise BundleError("The bundle has too many files")
    if sum(info.file_size for info in members) > MAX_BUNDLE_BYTES:
        raise BundleError("The bundle is too large")
    paths = [(info, _bundle_member_path(info.filename)) for info in members]
    for info, _ in paths:
        if (info.external_attr >> 16) & 0o170000 == 0o120000:  # a symlink
            raise BundleError(f"Unexpected link in bundle: {info.filename!r}")

    target = share_directory(token)
    staging = target.with_name(f".{token}.new")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    try:
        for info, relative in paths:
            destination = staging / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, open(destination, "wb") as out:
                shutil.copyfileobj(source, out)
        old = target.with_name(f".{token}.old")
        shutil.rmtree(old, ignore_errors=True)
        if target.exists():
            target.rename(old)
        staging.rename(target)
        shutil.rmtree(old, ignore_errors=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def delete_bundle(token: str) -> None:
    shutil.rmtree(share_directory(token), ignore_errors=True)


def publish(share: ShareLink, data: bytes) -> ShareLink:
    store_bundle(share.token, data)
    share.published_at = timezone.now()
    share.save(update_fields=["published_at"])
    return share


def stop_sharing(share: ShareLink) -> None:
    delete_bundle(share.token)
    share.delete()


def _resolve(token: str, path: str) -> Path:
    """The file for /s/<token>/<path>, or raise Http404."""
    if not token or not ShareLink.objects.filter(token=token).exists():
        raise Http404("This link does not exist or sharing was stopped.")
    relative = posixpath.normpath(path or "index.html")
    if relative in (".", "") or path.endswith("/"):
        relative = posixpath.join(relative if relative != "." else "", "index.html").lstrip("/")
    if relative.startswith(("../", "/")) or relative == "..":
        raise Http404()
    if relative.startswith("vendor/"):
        vendor_path = relative[len("vendor/") :]
        if not vendor_path.startswith(SHARED_VENDOR_PREFIXES):
            raise Http404()
        base = Path(settings.FRONTEND_DIR) / "vendor"
        candidate = (base / vendor_path).resolve()
    else:
        base = share_directory(token)
        candidate = (base / relative).resolve()
    if not candidate.is_file() or not candidate.is_relative_to(base.resolve()):
        raise Http404()
    return candidate


def _with_share_headers(response):
    for name, value in SHARE_HEADERS.items():
        response[name] = value
    if response.get("Content-Type", "").startswith("text/html"):
        response["Content-Security-Policy"] = SHARE_CSP
    return response


def share_response(token: str, path: str = ""):
    """The HTTP response for a shared file (used by the web app and the desktop share server)."""
    try:
        file_path = _resolve(token, path)
    except Http404:
        page = (
            "<!doctype html><meta charset='utf-8'><title>Link not available</title>"
            "<body style='font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;"
            "color:#334155;background:#f8fafc'><div style='text-align:center'><h1 style='font-size:20px'>"
            "This presentation is not available</h1><p>The link may be wrong, or the owner stopped sharing it."
            "</p></div></body>"
        )
        return _with_share_headers(HttpResponse(page, status=404, content_type="text/html; charset=utf-8"))
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
        content_type += "; charset=utf-8"
    return _with_share_headers(FileResponse(open(file_path, "rb"), content_type=content_type))
