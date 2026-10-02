"""Hatch build hook: bundle a trimmed copy of frontend/ into the desktop wheel as slideforge/frontend.

The repository keeps one frontend, shared by the web app and the desktop app. The wheel leaves out what the app
never loads: font files no stylesheet references, source maps, and the animation test/example scripts.
Editable installs skip this; slideforge.desktop.paths then serves <repo>/frontend directly.
"""

import os
import re
import shutil
import tempfile
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

DEV_ONLY_SCRIPTS = {"animation-advanced-tests.js", "animation-examples.js", "animation-properties-tests.js"}


def _referenced_fonts(vendor: Path) -> set[Path]:
    """fontsource files reachable from vendor/fonts/fonts.css (the only stylesheet that imports them)."""
    keep: set[Path] = set()
    fonts_css = (vendor / "fonts" / "fonts.css").read_text(encoding="utf-8")
    for rel in re.findall(r'@import url\("\.\./fontsource/([^"]+)"\)', fonts_css):
        css = vendor / "fontsource" / rel
        keep.add(css)
        for url in re.findall(r"url\(\./files/([^)]+)\)", css.read_text(encoding="utf-8")):
            keep.add(css.parent / "files" / url)
    keep.update(vendor.glob("fontsource/*/LICENSE"))
    return keep


def stage_frontend(source: Path, target: Path) -> None:
    fontsource = source / "vendor" / "fontsource"
    fonts = _referenced_fonts(source / "vendor")
    for root, _dirs, files in os.walk(source):
        root_path = Path(root)
        for name in files:
            path = root_path / name
            if name.endswith(".map") or name in DEV_ONLY_SCRIPTS:
                continue
            if fontsource in path.parents and path not in fonts:
                continue
            destination = target / path.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        if self.target_name != "wheel" or version == "editable":
            return
        self._staging = tempfile.mkdtemp(prefix="slideforge-frontend-")
        stage_frontend(Path(self.root) / "frontend", Path(self._staging))
        build_data["force_include"][self._staging] = "slideforge/frontend"

    def finalize(self, version, build_data, artifact_path):
        staging = getattr(self, "_staging", None)
        if staging:
            shutil.rmtree(staging, ignore_errors=True)
