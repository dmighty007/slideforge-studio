"""Fonts from Google Fonts for imported presentations whose fonts are not on this computer.

A deck made elsewhere names its fonts ("Instrument Serif", "DM Sans"); when one is missing here the browser draws a
substitute, and lines break differently from the author's. Google Fonts serves many of them under an open licence.
When the user asks, each missing family is looked up there, its font files (regular, bold and the italics, when the
family has them) are stored under MEDIA_ROOT/fonts/<family>/, and a stylesheet of @font-face rules points at them.
The page loads every stored family's stylesheet when it starts, so the fonts stay available.

Only Google's own addresses are fetched: fonts.googleapis.com for the stylesheet, fonts.gstatic.com for the files.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from django.conf import settings

log = logging.getLogger(__name__)

CSS_URL = "https://fonts.googleapis.com/css2"
FILE_HOST = "fonts.gstatic.com"
# A current browser's user agent: Google answers with WOFF2 files (an old or unknown one gets TTF or nothing).
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
TIMEOUT = 20
MAX_FILES_PER_FAMILY = 120  # CJK families are split into many small pieces
MAX_BYTES_PER_FAMILY = 40 * 1024 * 1024
FAMILY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 \-]{0,62}$")
_lock = threading.Lock()


def fonts_dir() -> Path:
    return Path(settings.MEDIA_ROOT) / "fonts"


def _slug(family: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def _index_path() -> Path:
    return fonts_dir() / "fonts.json"


def installed() -> dict:
    """{family: {"css": <URL of its stylesheet>, "faces": n}} for the families stored here."""
    try:
        data = json.loads(_index_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_index(index: dict) -> None:
    fonts_dir().mkdir(parents=True, exist_ok=True)
    _index_path().write_text(json.dumps(index, indent=1, sort_keys=True), encoding="utf-8")


def valid_family(family: str) -> bool:
    return bool(FAMILY_RE.match(str(family or "").strip()))


def _get(url: str, *, limit: int = 2 * 1024 * 1024) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 - Google's fixed hosts only
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Too large")
    return data


def _stylesheet(family: str) -> Optional[str]:
    """Google's @font-face rules for the family: regular and bold, upright and italic, as far as it has them.
    None when Google Fonts does not have the family."""
    name = urllib.parse.quote_plus(family)
    for axes in (":ital,wght@0,400;0,700;1,400;1,700", ":ital@0;1", ":wght@400;700", ""):
        try:
            return _get(f"{CSS_URL}?family={name}{axes}&display=swap").decode("utf-8")
        except urllib.error.HTTPError as exc:
            if exc.code == 400:  # those styles do not exist for this family (or the family does not)
                continue
            raise
    return None


def install(family: str) -> dict:
    """Downloads one family. Returns {"family", "status": "installed" | "already" | "not-found" | "failed", ...}."""
    family = str(family or "").strip()
    if not valid_family(family):
        return {"family": family, "status": "failed", "error": "Not a font name"}
    with _lock:
        index = installed()
        if family in index:
            return {"family": family, "status": "already", **index[family]}
    try:
        css = _stylesheet(family)
    except Exception as exc:
        log.info("Google Fonts lookup failed for %s: %s", family, exc)
        return {"family": family, "status": "failed", "error": "Could not reach Google Fonts"}
    if not css or "@font-face" not in css:
        return {"family": family, "status": "not-found"}

    slug = _slug(family)
    folder = fonts_dir() / slug
    folder.mkdir(parents=True, exist_ok=True)
    total = 0
    faces = 0
    urls = list(dict.fromkeys(re.findall(r"url\((https://[^)]+)\)", css)))[:MAX_FILES_PER_FAMILY]
    local_css = css
    try:
        for number, url in enumerate(urls):
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme != "https" or parsed.hostname != FILE_HOST:
                raise ValueError(f"Unexpected font address: {url}")
            data = _get(url, limit=MAX_BYTES_PER_FAMILY)
            total += len(data)
            if total > MAX_BYTES_PER_FAMILY:
                raise ValueError("The family is too large to store")
            suffix = Path(parsed.path).suffix.lower() or ".woff2"
            if suffix not in (".woff2", ".woff", ".ttf", ".otf"):
                raise ValueError(f"Unexpected font file: {url}")
            name = f"{slug}-{number}{suffix}"
            (folder / name).write_bytes(data)
            local_css = local_css.replace(url, name)
            faces += 1
    except Exception as exc:
        log.warning("Could not download %s from Google Fonts: %s", family, exc)
        return {"family": family, "status": "failed", "error": str(exc)[:200]}
    (folder / "font.css").write_text(f"/* {family}, from Google Fonts (see its licence at fonts.google.com) */\n{local_css}", encoding="utf-8")
    entry = {"css": f"{settings.MEDIA_URL.rstrip('/')}/fonts/{slug}/font.css", "faces": faces, "bytes": total}
    with _lock:
        index = installed()
        index[family] = entry
        _save_index(index)
    log.info("Installed %s from Google Fonts (%d files, %d bytes)", family, faces, total)
    return {"family": family, "status": "installed", **entry}
