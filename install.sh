#!/bin/sh
# SlideForge installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.sh | sh
#
# Installs SlideForge for the current user only (no sudo): uv (a small Python installer, if it is missing), then
# SlideForge in its own environment, then a menu entry and a desktop icon. Running it again updates SlideForge.
#
#   ... | sh -s -- --no-desktop-icon     menu entry only
#   ... | sh -s -- --uninstall           remove SlideForge and its icons (your presentations are kept)
#   SLIDEFORGE_SOURCE=git+https://github.com/dmighty007/slideforge-studio ... | sh
#                                         install from the repository (or a local folder) instead of PyPI
set -eu

PACKAGE="slideforge-studio"
PYTHON_VERSION="3.12"
DESKTOP_ICON=1
UNINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --no-desktop-icon) DESKTOP_ICON=0 ;;
        --uninstall) UNINSTALL=1 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

say() { printf '\033[1;35m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mNote:\033[0m %s\n' "$1"; }

OS="$(uname -s)"
case "$OS" in
    Linux) EXTRA="[qt]" ;;   # the native window on Linux comes from Qt (macOS uses its own web view)
    Darwin) EXTRA="" ;;
    *) echo "This installer is for Linux and macOS. On Windows, run in PowerShell:" >&2
       echo "  irm https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.ps1 | iex" >&2
       exit 1 ;;
esac

# uv installs into ~/.local/bin; make it findable in this script even before a new shell picks it up.
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

if [ "$UNINSTALL" = 1 ]; then
    say "Removing SlideForge"
    if command -v slideforge >/dev/null 2>&1; then slideforge --remove-shortcut || true; fi
    if command -v uv >/dev/null 2>&1; then uv tool uninstall "$PACKAGE" || true; fi
    say "Done. Your presentations are still in your SlideForge data folder."
    exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
    say "Installing uv (it fetches Python and SlideForge's libraries)"
    if command -v curl >/dev/null 2>&1; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    else
        wget -qO- https://astral.sh/uv/install.sh | sh
    fi
fi

say "Installing SlideForge (a few minutes the first time)"
SPEC="${PACKAGE}${EXTRA}"
if [ -n "${SLIDEFORGE_SOURCE:-}" ]; then SPEC="$SPEC @ $SLIDEFORGE_SOURCE"; fi
uv tool install --upgrade --reinstall-package "$PACKAGE" --python "$PYTHON_VERSION" "$SPEC"

say "Adding SlideForge to your applications"
if [ "$DESKTOP_ICON" = 1 ]; then
    slideforge --install-shortcut
else
    slideforge --install-shortcut --no-desktop-icon
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    case "$OS" in
        Linux) warn "videos need ffmpeg to be converted for the app: install it with your package manager (e.g. sudo apt install ffmpeg)." ;;
        Darwin) warn "videos need ffmpeg to be converted for the app: brew install ffmpeg" ;;
    esac
fi
if [ "$OS" = Linux ] && command -v ldconfig >/dev/null 2>&1 && ! ldconfig -p 2>/dev/null | grep -q libxcb-cursor; then
    warn "if the window does not open, install the Qt helper library: sudo apt install libxcb-cursor0 (Debian/Ubuntu)."
fi

say "SlideForge $(slideforge --version 2>/dev/null | awk '{print $2}') is installed."
echo "    Open it from your applications menu or the desktop icon, or run: slideforge"
case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "    (open a new terminal for the slideforge command to be found)" ;;
esac
