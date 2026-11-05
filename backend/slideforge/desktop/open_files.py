"""Opening presentations from the command line: `slideforge talk.pptx` opens the file in the editor.

The command line puts each file in a queue (<data dir>/open-requests/, one small JSON per file); the editor page asks
for the queue when it starts and every few seconds after, fetches each file once and imports it into a new project,
as Import on the start screen would. A second `slideforge other.key` while SlideForge runs only adds to the queue,
and the window already open picks it up: no second copy starts.

The page sees only the file's name and contents, by a random id; nothing outside the queue can be read through this.
"""

from __future__ import annotations

import itertools
import json
import os
import secrets
import time
from pathlib import Path
from typing import Optional

# What can be opened, as the start screen imports it.
OPENABLE = {".pptx": "pptx", ".key": "keynote", ".pdf": "pdf", ".json": "json"}
# Requests nobody picked up (the window was closed before it loaded) are dropped after this long.
MAX_AGE_SECONDS = 15 * 60
MAX_BYTES = 1024 * 1024 * 1024


# Files given together are queued within the same millisecond: a running count keeps them in the order given.
_sequence = itertools.count()


class OpenFileError(ValueError):
    """A file the command line cannot open (the message is shown as-is)."""


def _queue(data_dir: Path) -> Path:
    return Path(data_dir) / "open-requests"


def check(path: str) -> Path:
    """The absolute path of a file that can be opened, or OpenFileError saying why not."""
    target = Path(path).expanduser()
    if not target.is_file():
        raise OpenFileError(f"No such file: {path}")
    if target.suffix.lower() not in OPENABLE:
        raise OpenFileError(f"Cannot open {target.name}: SlideForge opens PowerPoint (.pptx), Keynote (.key), PDF (.pdf) and SlideForge (.json) files")
    if target.stat().st_size > MAX_BYTES:
        raise OpenFileError(f"{target.name} is too large to open")
    return target.resolve()


def add(data_dir: Path, path: Path) -> str:
    """Puts one file in the queue; returns its id."""
    folder = _queue(data_dir)
    folder.mkdir(parents=True, exist_ok=True)
    request_id = f"{int(time.time() * 1000):013d}-{next(_sequence) % 100000:05d}-{secrets.token_hex(6)}"  # sorts in the order given
    entry = {"path": str(path), "name": path.name, "kind": OPENABLE[path.suffix.lower()], "created": time.time()}
    temporary = folder / f".{request_id}.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(entry, handle)
    temporary.replace(folder / f"{request_id}.json")  # whole or not at all for a page reading the queue
    return request_id


def _read(file: Path) -> Optional[dict]:
    try:
        entry = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return entry if isinstance(entry, dict) and isinstance(entry.get("path"), str) else None


def pending(data_dir: Path) -> list[dict]:
    """[{"id", "name", "kind"}] waiting to be opened, oldest first. Stale and vanished ones are dropped."""
    folder = _queue(data_dir)
    if not folder.is_dir():
        return []
    found = []
    for file in sorted(folder.glob("*.json")):
        entry = _read(file)
        if not entry or time.time() - float(entry.get("created") or 0) > MAX_AGE_SECONDS or not Path(entry["path"]).is_file():
            file.unlink(missing_ok=True)
            continue
        found.append({"id": file.stem, "name": entry.get("name") or Path(entry["path"]).name, "kind": entry.get("kind")})
    return found


def take(data_dir: Path, request_id: str) -> Optional[tuple[Path, str]]:
    """(path, name) of a queued file, which leaves the queue: each request is opened once. None if there is none."""
    if not request_id or not all(c.isalnum() or c == "-" for c in request_id) or len(request_id) > 40:
        return None
    file = _queue(data_dir) / f"{request_id}.json"
    entry = _read(file)
    file.unlink(missing_ok=True)
    if not entry:
        return None
    path = Path(entry["path"])
    return (path, entry.get("name") or path.name) if path.is_file() else None
