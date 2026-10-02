"""Where the desktop app finds its bundled files and keeps its data."""

import os
from pathlib import Path

from platformdirs import user_data_dir

PACKAGE_DIR = Path(__file__).resolve().parent.parent  # the slideforge package


def _frontend_dir() -> Path:
    bundled = PACKAGE_DIR / "frontend"  # installed wheel: the frontend is packaged inside slideforge/
    if bundled.is_dir():
        return bundled
    return PACKAGE_DIR.parent.parent / "frontend"  # source checkout: <repo>/frontend, shared with the web app


FRONTEND_DIR = _frontend_dir()
ICON_PATH = FRONTEND_DIR / "assets" / "favicon_icon.png"


def data_dir() -> Path:
    """Per-user data directory (database, uploaded media, config). Override with SLIDEFORGE_DATA_DIR."""
    override = os.environ.get("SLIDEFORGE_DATA_DIR")
    path = Path(override).expanduser() if override else Path(user_data_dir("SlideForge", appauthor=False))
    path.mkdir(parents=True, exist_ok=True)
    return path
