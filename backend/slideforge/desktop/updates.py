"""Updating the desktop app to a new version: finding the latest one, installing it as this copy was installed,
and starting it again.

How this copy was installed decides both where the latest version is read and how it is installed:

- the one-line installers (install.sh / install.ps1): `uv tool install`, from GitHub's main branch (its zip) or
  from PyPI. uv's receipt in the environment records the source, the extras and the Python version, and the same
  command is run again, as the installer does when it is run again.
- `pip install slideforge-studio` (PyPI): pip installs the newer release into this environment.
- an install from a folder (a clone, through the installer's SLIDEFORGE_SOURCE): the folder's version is the
  latest, and it is installed from the folder again.
- an editable install (a clone of the repository): not updated here; `git pull` updates it.

The latest version is the one in main's slideforge/__init__.py for a GitHub install, the latest release for a
PyPI one. Checking only reads that number; nothing is sent but the request itself.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from slideforge import __version__

log = logging.getLogger(__name__)

PACKAGE = "slideforge-studio"
GITHUB_REPO = "dmighty007/slideforge-studio"
GITHUB_VERSION_URL = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main/backend/slideforge/__init__.py"
PYPI_URL = f"https://pypi.org/pypi/{PACKAGE}/json"
CHECK_INTERVAL = 24 * 3600  # automatic checks: at most once a day
REQUEST_TIMEOUT = 8
UPDATE_TIMEOUT = 30 * 60
LOG_LINES = 40


# ---- versions --------------------------------------------------------------------------------------------------


def version_key(version: str) -> tuple:
    """A sortable form of "0.4.0", "0.10.1", "1.0.0rc1": numbers compare as numbers; a pre-release (letters after
    the numbers) sorts before its release."""
    match = re.match(r"\s*v?(\d+(?:\.\d+)*)(.*)$", str(version or ""))
    if not match:
        return ((0,), 0, "")
    numbers = tuple(int(part) for part in match.group(1).split("."))
    while len(numbers) > 1 and numbers[-1] == 0:
        numbers = numbers[:-1]
    rest = match.group(2).strip().lstrip(".-")
    return (numbers, 0 if rest else 1, rest)


def is_newer(candidate: str, current: str = __version__) -> bool:
    return bool(candidate) and version_key(candidate) > version_key(current)


# ---- how this copy was installed -------------------------------------------------------------------------------


@dataclass
class Origin:
    kind: str  # "github" | "pypi" | "local" | "editable" | "unknown"
    method: str  # "uv-tool" | "pip" | "none"
    source: str = ""  # the GitHub zip (or other URL) a GitHub install came from
    extras: list[str] = field(default_factory=list)
    python: str = ""  # the Python version a uv tool install uses

    def as_json(self) -> dict:
        return {"kind": self.kind, "method": self.method, "source": self.source, "extras": self.extras}


def _read_receipt(prefix: Path) -> Optional[dict]:
    """uv's record of a `uv tool install`: {"url", "extras", "python"} for SlideForge, or None."""
    receipt = prefix / "uv-receipt.toml"
    try:
        text = receipt.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        import tomllib  # Python 3.11+

        data = tomllib.loads(text).get("tool", {})
        requirement = next((r for r in data.get("requirements", []) if r.get("name") == PACKAGE), None)
        if requirement is None:
            return None
        # A folder is recorded as "directory" (the installer's SLIDEFORGE_SOURCE=<folder>), a download as "url".
        url = requirement.get("url", "") or (Path(requirement["directory"]).as_uri() if requirement.get("directory") else "")
        return {"url": url, "extras": list(requirement.get("extras", [])), "python": str(data.get("python", ""))}
    except ImportError:  # Python 3.10: the few fields needed, read directly
        line = next((line for line in text.splitlines() if f'name = "{PACKAGE}"' in line), "")
        if not line:
            return None
        url = re.search(r'url = "([^"]+)"', line)
        directory = re.search(r'directory = "([^"]+)"', line)
        extras = re.search(r"extras = \[([^\]]*)\]", line)
        python = re.search(r'^python = "([^"]+)"', text, re.M)
        return {
            "url": url.group(1) if url else Path(directory.group(1)).as_uri() if directory else "",
            "extras": re.findall(r'"([^"]+)"', extras.group(1)) if extras else [],
            "python": python.group(1) if python else "",
        }
    except Exception:
        return None


def _direct_url() -> Optional[dict]:
    """pip's record of where this package came from (absent for an index install, e.g. from PyPI)."""
    try:
        from importlib.metadata import distribution

        text = distribution(PACKAGE).read_text("direct_url.json")
    except Exception:
        return None
    try:
        return json.loads(text) if text else None
    except ValueError:
        return None


def _installed_extras() -> list[str]:
    """The extras worth keeping: Qt, when its window backend is installed."""
    try:
        from importlib.util import find_spec

        return ["qt"] if find_spec("qtpy") and (find_spec("PyQt6") or find_spec("PySide6")) else []
    except Exception:
        return []


def detect_origin(prefix: Optional[Path] = None) -> Origin:
    prefix = Path(prefix or sys.prefix)
    direct = _direct_url() or {}
    if (direct.get("dir_info") or {}).get("editable"):
        return Origin("editable", "none", direct.get("url", ""))
    receipt = _read_receipt(prefix)
    if receipt is not None:
        url = receipt["url"]
        kind = "local" if url.startswith("file://") else "github" if url else "pypi"
        return Origin(kind, "uv-tool", url, receipt["extras"], receipt["python"])
    url = direct.get("url", "")
    if url.startswith(f"https://github.com/{GITHUB_REPO}/"):
        return Origin("github", "pip", url, _installed_extras())
    if not direct:
        try:
            from importlib.metadata import distribution

            distribution(PACKAGE)
        except Exception:
            return Origin("unknown", "none")
        return Origin("pypi", "pip", "", _installed_extras())
    return Origin("unknown", "none", url)


# ---- the latest version ----------------------------------------------------------------------------------------


def _fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": f"SlideForge/{__version__} (update check)"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:  # noqa: S310 - fixed https URLs
        return response.read(256 * 1024).decode("utf-8", "replace")


def _local_folder(origin: Origin) -> Path:
    from urllib.parse import unquote, urlparse

    return Path(unquote(urlparse(origin.source).path))


def latest_version(origin: Origin) -> str:
    """The newest version for this copy's source. Raises on network errors."""
    if origin.kind == "local":
        text = (_local_folder(origin) / "backend" / "slideforge" / "__init__.py").read_text(encoding="utf-8")
        match = re.search(r'__version__\s*=\s*"([^"]+)"', text)
        if not match:
            raise ValueError("No version found in the folder SlideForge was installed from")
        return match.group(1)
    if origin.kind == "pypi":
        return str(json.loads(_fetch(PYPI_URL))["info"]["version"])
    match = re.search(r'__version__\s*=\s*"([^"]+)"', _fetch(GITHUB_VERSION_URL))
    if not match:
        raise ValueError("No version found on GitHub")
    return match.group(1)


# ---- installing it ---------------------------------------------------------------------------------------------


def _uv() -> Optional[str]:
    found = shutil.which("uv")
    if found:
        return found
    for candidate in (Path.home() / ".local" / "bin" / "uv", Path.home() / ".cargo" / "bin" / "uv"):
        if candidate.is_file():
            return str(candidate)
    return None


def update_command(origin: Origin) -> Optional[list[str]]:
    """The command that installs the latest version the way this copy was installed; None when it cannot."""
    spec = PACKAGE + (f"[{','.join(origin.extras)}]" if origin.extras else "")
    if origin.kind in ("github", "local") and origin.source:
        spec = f"{spec} @ {origin.source}"
    elif origin.kind != "pypi":
        return None
    if origin.method == "uv-tool":
        uv = _uv()
        if not uv:
            return None
        python = origin.python or f"{sys.version_info.major}.{sys.version_info.minor}"
        # As the installer does: the same address serves a newer zip, so the package is downloaded again.
        return [uv, "tool", "install", "--upgrade", "--reinstall-package", PACKAGE, "--refresh-package", PACKAGE, "--python", python, spec]
    if origin.method == "pip":
        return [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", spec]
    return None


def restart_command() -> list[str]:
    """How to start SlideForge again: the launcher it was started with (slideforge or slideforge-gui), else the
    one on PATH, else this Python with the app module."""
    launcher = Path(sys.argv[0]) if sys.argv and sys.argv[0] else None
    if launcher and launcher.name.startswith("slideforge") and launcher.exists():
        return [str(launcher), *sys.argv[1:]]
    found = shutil.which("slideforge-gui") or shutil.which("slideforge")
    if found:
        return [found]
    return [sys.executable, "-c", "import sys; from slideforge.desktop.app import main; sys.exit(main())"]


# The restart helper: waits until this instance has let go of its lock (its window closed, its data saved), then
# starts the new version. A separate process, so it outlives this one.
_RESTART_HELPER = r"""
import subprocess, sys, time
from filelock import FileLock, Timeout
lock, command = sys.argv[1], sys.argv[2:]
deadline = time.monotonic() + 120
while time.monotonic() < deadline:
    held = FileLock(lock)
    try:
        held.acquire(timeout=1)
    except Timeout:
        continue
    held.release()
    break
time.sleep(0.5)
subprocess.Popen(command, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
"""


def spawn_restart(data_dir: Path) -> None:
    kwargs = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([sys.executable, "-c", _RESTART_HELPER, str(Path(data_dir) / "instance.lock"), *restart_command()], **kwargs)


# ---- the updater: state shared with the page -------------------------------------------------------------------


class Updater:
    """Checks for and installs updates in the background; the page polls status()."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.lock = threading.Lock()
        self.origin = detect_origin()
        self.latest = ""
        self.checked_at = 0.0
        self.check_error = ""
        self.state = "idle"  # idle | checking | updating | updated | failed
        self.installed_version = ""
        self.output: list[str] = []
        self._load()

    # Remembered between runs: the last check (so automatic checks happen once a day), the version the user chose
    # to skip, and whether automatic checks are on.
    @property
    def _file(self) -> Path:
        return self.data_dir / "updates.json"

    def _load(self) -> None:
        try:
            data = json.loads(self._file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        self.latest = str(data.get("latest", "")) if data.get("origin") == self.origin.kind else ""
        self.checked_at = float(data.get("checkedAt", 0)) if self.latest else 0.0
        self.skipped = str(data.get("skipped", ""))
        self.auto_check = data.get("autoCheck", True) is not False

    def _save(self) -> None:
        data = {"latest": self.latest, "checkedAt": self.checked_at, "origin": self.origin.kind, "skipped": self.skipped, "autoCheck": self.auto_check}
        try:
            self._file.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            log.warning("Could not remember the update check in %s", self._file)

    @property
    def automatic_checks_allowed(self) -> bool:
        return self.auto_check and os.environ.get("SLIDEFORGE_NO_UPDATE_CHECK", "") in ("", "0")

    def check(self, *, automatic: bool = False) -> None:
        """Reads the latest version (an automatic check: at most once a day, and only when allowed)."""
        if automatic and (not self.automatic_checks_allowed or time.time() - self.checked_at < CHECK_INTERVAL):
            return
        if self.origin.kind == "unknown":
            return
        with self.lock:
            if self.state in ("checking", "updating"):
                return
            previous, self.state = self.state, "checking"
        try:
            self.latest = latest_version(self.origin if self.origin.kind != "editable" else Origin("github", "none"))
            self.check_error = ""
            self.checked_at = time.time()
            self._save()
        except Exception as exc:
            log.info("Update check failed: %s", exc)
            self.check_error = "Could not reach the update server. Check the internet connection and try again."
        finally:
            with self.lock:
                self.state = previous if previous != "checking" else "idle"

    def skip(self, version: str) -> None:
        self.skipped = str(version or self.latest)
        self._save()

    def set_auto_check(self, enabled: bool) -> None:
        self.auto_check = bool(enabled)
        self._save()

    def start_update(self) -> bool:
        command = update_command(self.origin)
        if not command:
            return False
        with self.lock:
            if self.state == "updating":
                return True
            self.state = "updating"
            self.output = []
        threading.Thread(target=self._run_update, args=(command,), name="slideforge-update", daemon=True).start()
        return True

    def _run_update(self, command: list[str]) -> None:
        log.info("Updating SlideForge: %s", " ".join(command))
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            started = time.monotonic()
            assert process.stdout is not None
            for line in process.stdout:
                self.output = (self.output + [line.rstrip()])[-LOG_LINES:]
                if time.monotonic() - started > UPDATE_TIMEOUT:
                    process.kill()
                    raise TimeoutError("The update took too long")
            code = process.wait()
            if code != 0:
                raise RuntimeError(f"The installer stopped with code {code}")
            self.installed_version = self._new_version() or self.latest
            with self.lock:
                self.state = "updated"
            log.info("SlideForge updated to %s", self.installed_version)
        except Exception as exc:
            log.warning("Update failed: %s", exc)
            self.output = (self.output + [str(exc)])[-LOG_LINES:]
            with self.lock:
                self.state = "failed"

    def _new_version(self) -> str:
        """The version now installed (asked of the new copy; this process still runs the old one)."""
        try:
            command = restart_command()
            if Path(command[0]).name.startswith("slideforge"):
                result = subprocess.run([command[0], "--version"], capture_output=True, text=True, timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                match = re.search(r"(\d+(?:\.\d+)+\S*)", result.stdout)
                return match.group(1) if match else ""
        except Exception:
            pass
        return ""

    def status(self) -> dict:
        available = is_newer(self.latest)
        return {
            "current": __version__,
            "latest": self.latest,
            "available": available,
            "skipped": bool(available and self.skipped == self.latest),
            "checkedAt": self.checked_at,
            "checkError": self.check_error,
            "origin": self.origin.as_json(),
            "canUpdate": available and update_command(self.origin) is not None,
            "manualHint": _manual_hint(self.origin),
            "autoCheck": self.auto_check,
            "state": self.state,
            "installedVersion": self.installed_version,
            "output": self.output[-12:],
        }


def _manual_hint(origin: Origin) -> str:
    if origin.kind == "editable":
        return "This is a development copy of SlideForge: update it with git pull in its folder."
    if origin.method == "uv-tool" and not _uv():
        return "Run the SlideForge installer again to update (uv, which it uses, was not found)."
    if origin.kind == "unknown":
        return "Update SlideForge the way it was installed."
    return ""


_updater: Optional[Updater] = None
_updater_lock = threading.Lock()


def get_updater() -> Updater:
    global _updater
    with _updater_lock:
        if _updater is None:
            from slideforge.desktop import paths

            _updater = Updater(paths.data_dir())
        return _updater
