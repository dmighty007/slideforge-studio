"""Test settings for the desktop app: the real desktop settings with a throwaway data directory."""

import os
import tempfile

os.environ.setdefault("SLIDEFORGE_DATA_DIR", tempfile.mkdtemp(prefix="slideforge-test-"))

from slideforge.desktop.settings import *  # noqa: E402,F403
