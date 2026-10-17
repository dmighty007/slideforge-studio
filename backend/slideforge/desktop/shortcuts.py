"""Launcher icons for the desktop app: the application menu and the desktop, on Linux, macOS and Windows.

`slideforge --install-shortcut` (run by the one-line installers in the repository) calls install(); `slideforge
--remove-shortcut` calls remove(). Everything goes into the user's own folders; nothing needs administrator rights.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

from slideforge.desktop import paths

APP_NAME = "SlideForge"


def _launcher() -> Path:
    """The program that opens SlideForge without a terminal window."""
    scripts = Path(sys.executable).parent  # the environment SlideForge is installed in (a uv tool, a venv…)
    for name in ("slideforge-gui.exe", "slideforge-gui", "slideforge.exe", "slideforge"):
        candidate = scripts / name
        if candidate.is_file():
            return candidate
    found = shutil.which("slideforge-gui") or shutil.which("slideforge")
    if found:
        return Path(found)
    raise RuntimeError("could not find the slideforge program to start")


def _desktop_dir() -> Path | None:
    """The user's desktop folder (it has another name in some languages on Linux), or None if there is none."""
    if sys.platform.startswith("linux") and shutil.which("xdg-user-dir"):
        try:
            found = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, timeout=5).stdout.strip()
            if found and Path(found) != Path.home() and Path(found).is_dir():
                return Path(found)
        except (OSError, subprocess.SubprocessError):
            pass
    if sys.platform == "win32":
        base = Path(os.environ.get("USERPROFILE", Path.home()))
        for candidate in (base / "Desktop", base / "OneDrive" / "Desktop"):
            if candidate.is_dir():
                return candidate
        return None
    candidate = Path.home() / "Desktop"
    return candidate if candidate.is_dir() else None


def _xdg_data_home() -> Path:
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")


def _linux_entry_text(launcher: Path, icon: str) -> str:
    return (
        "[Desktop Entry]\n"
        "Type=Application\n"
        f"Name={APP_NAME}\n"
        "GenericName=Presentation editor\n"
        "Comment=Slides with charts, equations, molecules and science plots\n"
        f'Exec="{launcher}"\n'
        f"Icon={icon}\n"
        "Terminal=false\n"
        "Categories=Office;Presentation;Education;Science;\n"
        "StartupWMClass=SlideForge\n"
    )


def _install_linux(desktop: bool) -> list[Path]:
    data = _xdg_data_home()
    icon_dir = data / "icons" / "hicolor" / "256x256" / "apps"
    icon_dir.mkdir(parents=True, exist_ok=True)
    icon = icon_dir / "slideforge.png"
    _write_png(icon, 256)
    applications = data / "applications"
    applications.mkdir(parents=True, exist_ok=True)
    entry = applications / "slideforge.desktop"
    # The icon by full path: a theme name ("slideforge") shows a blank icon until the icon cache is refreshed.
    text = _linux_entry_text(_launcher(), str(icon))
    entry.write_text(text, encoding="utf-8")
    entry.chmod(0o755)
    written = [entry]
    target = _desktop_dir() if desktop else None
    if target:
        on_desktop = target / "slideforge.desktop"
        on_desktop.write_text(text, encoding="utf-8")
        on_desktop.chmod(0o755)  # GNOME and others run only executable launchers
        if shutil.which("gio"):
            # GNOME asks before running a launcher it has not been told to trust ("Allow Launching").
            subprocess.run(["gio", "set", str(on_desktop), "metadata::trusted", "true"], capture_output=True, timeout=5, check=False)
        written.append(on_desktop)
    for tool in (["update-desktop-database", str(applications)], ["gtk-update-icon-cache", "-q", str(data / "icons" / "hicolor")]):
        if shutil.which(tool[0]):
            subprocess.run(tool, capture_output=True, timeout=20, check=False)
    return written


def _install_macos(desktop: bool) -> list[Path]:
    bundle = Path.home() / "Applications" / f"{APP_NAME}.app"
    macos = bundle / "Contents" / "MacOS"
    resources = bundle / "Contents" / "Resources"
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)
    script = macos / APP_NAME
    script.write_text(f'#!/bin/sh\nexec "{_launcher()}" "$@"\n', encoding="utf-8")
    script.chmod(0o755)
    has_icon = _write_icns(resources / f"{APP_NAME}.icns")
    from slideforge import __version__

    (bundle / "Contents" / "Info.plist").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>\n'
        f"<key>CFBundleName</key><string>{APP_NAME}</string>\n"
        f"<key>CFBundleDisplayName</key><string>{APP_NAME}</string>\n"
        "<key>CFBundleIdentifier</key><string>io.github.dmighty007.slideforge</string>\n"
        f"<key>CFBundleExecutable</key><string>{APP_NAME}</string>\n"
        "<key>CFBundlePackageType</key><string>APPL</string>\n"
        f"<key>CFBundleShortVersionString</key><string>{__version__}</string>\n"
        + (f"<key>CFBundleIconFile</key><string>{APP_NAME}</string>\n" if has_icon else "")
        + "<key>NSHighResolutionCapable</key><true/>\n"
        "</dict></plist>\n",
        encoding="utf-8",
    )
    written = [bundle]
    target = _desktop_dir() if desktop else None
    if target:
        alias = target / f"{APP_NAME}.app"
        if alias.is_symlink() or alias.exists():
            alias.unlink()
        alias.symlink_to(bundle)
        written.append(alias)
    return written


def _install_windows(desktop: bool) -> list[Path]:
    launcher = _launcher()
    icon = paths_data_icon("slideforge.ico")
    _write_ico(icon)
    start_menu = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    targets = [start_menu / f"{APP_NAME}.lnk"]
    place = _desktop_dir() if desktop else None
    if place:
        targets.append(place / f"{APP_NAME}.lnk")
    for link in targets:
        link.parent.mkdir(parents=True, exist_ok=True)
        # A .lnk is a binary format: Windows' own shell object writes it.
        script = (
            "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SF_LINK); "
            "$s.TargetPath = $env:SF_TARGET; $s.IconLocation = $env:SF_ICON; "
            "$s.Description = 'SlideForge presentation editor'; $s.Save()"
        )
        env = {**os.environ, "SF_LINK": str(link), "SF_TARGET": str(launcher), "SF_ICON": str(icon)}
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], env=env, check=True, capture_output=True, timeout=30)
    return targets


def paths_data_icon(name: str) -> Path:
    folder = paths.default_data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    return folder / name


def _source_icon():
    from PIL import Image

    return Image.open(paths.ICON_PATH).convert("RGBA")


def _write_png(target: Path, size: int) -> None:
    from PIL import Image

    _source_icon().resize((size, size), Image.LANCZOS).save(target, format="PNG")


def _write_ico(target: Path) -> None:
    _source_icon().save(target, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


def _write_icns(target: Path) -> bool:
    try:
        _source_icon().save(target, format="ICNS")
        return True
    except (OSError, ValueError, KeyError):
        return False  # the app still opens, with the generic icon


def install(*, desktop: bool = True) -> list[Path]:
    """Add SlideForge to the application menu and, with desktop=True, put its icon on the desktop."""
    if sys.platform.startswith("linux"):
        return _install_linux(desktop)
    if sys.platform == "darwin":
        return _install_macos(desktop)
    if sys.platform == "win32":
        return _install_windows(desktop)
    raise RuntimeError(f"shortcuts are not supported on {sys.platform}")


def remove() -> list[Path]:
    """Remove every launcher install() can make. Returns what was removed."""
    candidates: list[Path] = []
    desktop = _desktop_dir()
    if sys.platform.startswith("linux"):
        data = _xdg_data_home()
        candidates += [data / "applications" / "slideforge.desktop", data / "icons" / "hicolor" / "256x256" / "apps" / "slideforge.png"]
        if desktop:
            candidates.append(desktop / "slideforge.desktop")
    elif sys.platform == "darwin":
        candidates.append(Path.home() / "Applications" / f"{APP_NAME}.app")
        if desktop:
            candidates.append(desktop / f"{APP_NAME}.app")
    elif sys.platform == "win32":
        start_menu = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
        candidates.append(start_menu / f"{APP_NAME}.lnk")
        if desktop:
            candidates.append(desktop / f"{APP_NAME}.lnk")
    removed = []
    for path in candidates:
        if path.is_symlink() or path.is_file():
            path.unlink()
            removed.append(path)
        elif path.is_dir():
            shutil.rmtree(path)
            removed.append(path)
    return removed
