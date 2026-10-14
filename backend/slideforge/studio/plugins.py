"""Slide object plugins: the built-in ones in frontend/plugins/ and the user's own in a plugins folder.

A plugin is a folder <id>/ with a plugin.js (and optionally a plugin.json describing it). Built-in plugins are listed
in frontend/plugins/plugins.json, which also says which are on by default. User plugins live in
settings.SLIDEFORGE_USER_PLUGINS_DIR (the desktop app: <data dir>/plugins/) and survive upgrades. Which plugins are
switched on is kept in settings.SLIDEFORGE_PLUGIN_STATE_FILE.

Plugins are scripts that run inside the editor with its full rights. Only the person running the desktop app, or a
staff user of the web app, may switch them on and off, install or remove them.
"""

import io
import json
import logging
import posixpath
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

PLUGIN_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
MAX_ZIP_BYTES = 25 * 1024 * 1024  # the upload
MAX_UNPACKED_BYTES = 60 * 1024 * 1024
MAX_ZIP_FILES = 500
MANIFEST_FIELDS = {"name": 80, "version": 40, "description": 300, "icon": 60, "author": 120, "homepage": 300}


class PluginError(ValueError):
    """A plugin request that cannot be carried out (shown to the user as is)."""


def bundled_dir() -> Path:
    return Path(settings.FRONTEND_DIR) / "plugins"


def user_dir() -> Path | None:
    configured = getattr(settings, "SLIDEFORGE_USER_PLUGINS_DIR", None)
    if not configured:
        return None
    path = Path(configured).expanduser().resolve()  # absolute: the dialog shows it as the folder to open
    path.mkdir(parents=True, exist_ok=True)
    return path


def _state_file() -> Path | None:
    configured = getattr(settings, "SLIDEFORGE_PLUGIN_STATE_FILE", None)
    return Path(configured) if configured else None


def can_manage(request) -> bool:
    if not getattr(settings, "SLIDEFORGE_ACCOUNTS_ENABLED", True):
        return True  # the desktop app: one local user, who owns the machine
    return bool(getattr(request.user, "is_authenticated", False) and request.user.is_staff)


def _read_json(path: Path, limit: int = 64 * 1024):
    try:
        if not path.is_file() or path.stat().st_size > limit:
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _bundled_defaults() -> list[str]:
    data = _read_json(bundled_dir() / "plugins.json") or {}
    ids = data.get("plugins") if isinstance(data, dict) else None
    return [str(i) for i in ids if PLUGIN_ID_PATTERN.match(str(i))] if isinstance(ids, list) else []


def _switches() -> dict[str, bool]:
    path = _state_file()
    data = _read_json(path) if path else None
    enabled = data.get("enabled") if isinstance(data, dict) else None
    if not isinstance(enabled, dict):
        return {}
    return {str(k): bool(v) for k, v in enabled.items() if PLUGIN_ID_PATTERN.match(str(k))}


def _save_switches(switches: dict[str, bool]) -> None:
    path = _state_file()
    if not path:
        raise PluginError("Plugin settings cannot be saved on this server.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp")
    temp.write_text(json.dumps({"enabled": switches}, indent=2, sort_keys=True), encoding="utf-8")
    temp.replace(path)


def _manifest(folder: Path) -> dict:
    data = _read_json(folder / "plugin.json")
    data = data if isinstance(data, dict) else {}
    info = {}
    for key, limit in MANIFEST_FIELDS.items():
        value = data.get(key)
        if isinstance(value, (str, int, float)) and str(value).strip():
            info[key] = str(value).strip()[:limit]
    icon = info.get("icon", "")
    # Only Font Awesome class names: the icon goes into the page as a class attribute.
    if icon and not re.fullmatch(r"(fa-[a-z0-9-]+\s*){1,3}", icon):
        info.pop("icon")
    if "homepage" in info and not re.match(r"^https?://", info["homepage"]):
        info.pop("homepage")
    return info


def _scan(folder: Path | None, source: str) -> list[dict]:
    if not folder or not folder.is_dir():
        return []
    found = []
    for entry in sorted(folder.iterdir()):
        if not entry.is_dir() or entry.is_symlink() or not PLUGIN_ID_PATTERN.match(entry.name):
            continue
        if not (entry / "plugin.js").is_file():
            continue
        prefix = "/plugins" if source == "bundled" else "/user-plugins"
        found.append(
            {
                "id": entry.name,
                "source": source,
                "script": f"{prefix}/{entry.name}/plugin.js",
                "name": entry.name,
                **_manifest(entry),
            }
        )
    return found


def catalogue() -> list[dict]:
    """Every plugin found, built-in first, with whether it is switched on."""
    defaults = set(_bundled_defaults())
    switches = _switches()
    bundled = _scan(bundled_dir(), "bundled")
    bundled_ids = {p["id"] for p in bundled}
    plugins = []
    for plugin in bundled:
        plugin["enabled"] = switches.get(plugin["id"], plugin["id"] in defaults)
        plugins.append(plugin)
    for plugin in _scan(user_dir(), "user"):
        if plugin["id"] in bundled_ids:
            # A user plugin cannot replace a built-in one of the same name (the built-in one would be shadowed).
            plugin.update(enabled=False, error=f"A built-in plugin is already called “{plugin['id']}”. Rename this folder.")
        else:
            plugin["enabled"] = switches.get(plugin["id"], True)
        plugins.append(plugin)
    return plugins


def set_enabled(plugin_id: str, enabled: bool) -> None:
    plugin = next((p for p in catalogue() if p["id"] == plugin_id), None)
    if not plugin:
        raise PluginError(f"There is no plugin called “{plugin_id}”.")
    if plugin.get("error") and enabled:
        raise PluginError(plugin["error"])
    switches = _switches()
    switches[plugin_id] = bool(enabled)
    _save_switches(switches)


def _zip_layout(names: list[str]) -> str:
    """The folder inside the zip that holds plugin.js: "" (the zip root) or one top folder."""
    if "plugin.js" in names:
        return ""
    tops = {name.split("/", 1)[0] for name in names}
    if len(tops) == 1:
        top = tops.pop()
        if f"{top}/plugin.js" in names:
            return f"{top}/"
    raise PluginError("The zip has no plugin.js (at its top, or inside one folder).")


def install_zip(data: bytes) -> dict:
    """Unpack a plugin zip into the user plugins folder, replacing an earlier version of the same user plugin."""
    target_root = user_dir()
    if not target_root:
        raise PluginError("This server has no folder for your own plugins.")
    if len(data) > MAX_ZIP_BYTES:
        raise PluginError("The zip is larger than 25 MB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PluginError("That file is not a zip.") from exc
    members = [info for info in archive.infolist() if not info.is_dir()]
    if len(members) > MAX_ZIP_FILES:
        raise PluginError("The zip has too many files.")
    if sum(info.file_size for info in members) > MAX_UNPACKED_BYTES:
        raise PluginError("The zip unpacks to more than 60 MB.")
    names = []
    for info in members:
        name = info.filename
        clean = posixpath.normpath(name)
        if "\\" in name or "\x00" in name or name.startswith("/") or clean.startswith("../") or clean == "..":
            raise PluginError(f"The zip holds an unsafe path: {name}")
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            raise PluginError(f"The zip holds a link: {name}")
        names.append(clean)
    layout = _zip_layout(names)

    manifest = {}
    if f"{layout}plugin.json" in names:
        try:
            manifest = json.loads(archive.read(members[names.index(f"{layout}plugin.json")]).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise PluginError("plugin.json in the zip is not valid JSON.") from exc
    plugin_id = str((manifest if isinstance(manifest, dict) else {}).get("id") or layout.rstrip("/"))
    if not PLUGIN_ID_PATTERN.match(plugin_id):
        raise PluginError(
            "The plugin needs an id (lower-case letters, digits and dashes): put it in plugin.json as \"id\", "
            "or zip the plugin inside a folder named after it."
        )
    if plugin_id in {p["id"] for p in _scan(bundled_dir(), "bundled")}:
        raise PluginError(f"A built-in plugin is already called “{plugin_id}”.")

    staging = Path(tempfile.mkdtemp(prefix=f".{plugin_id}.", dir=target_root))
    try:
        for info, name in zip(members, names, strict=True):
            if not name.startswith(layout):
                continue
            destination = staging / name[len(layout) :]
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, open(destination, "wb") as out:
                shutil.copyfileobj(source, out)
        target = target_root / plugin_id
        old = target_root / f".{plugin_id}.old"
        shutil.rmtree(old, ignore_errors=True)
        if target.exists():
            target.rename(old)
        staging.rename(target)
        shutil.rmtree(old, ignore_errors=True)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    logger.info("Installed plugin %s into %s", plugin_id, target_root)
    return next(p for p in catalogue() if p["id"] == plugin_id)


def remove(plugin_id: str) -> None:
    root = user_dir()
    if not PLUGIN_ID_PATTERN.match(plugin_id) or not root or not (root / plugin_id).is_dir():
        raise PluginError("Only plugins in your own plugins folder can be removed.")
    shutil.rmtree(root / plugin_id)
    switches = _switches()
    if switches.pop(plugin_id, None) is not None:
        _save_switches(switches)
