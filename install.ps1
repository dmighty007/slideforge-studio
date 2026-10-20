# SlideForge installer for Windows.
#
#   irm https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.ps1 | iex
#
# Installs SlideForge for the current user only (no administrator rights): uv (a small Python installer, if it is
# missing), then SlideForge in its own environment, then a Start menu entry and a desktop icon. Running it again
# updates SlideForge to the latest version on GitHub (the main branch, downloaded as a zip: no git needed). Set
# $env:SLIDEFORGE_SOURCE = "pypi" for the latest release on PyPI instead, or to another URL or folder.
# To remove it: set $env:SLIDEFORGE_UNINSTALL = "1" before running the same line.
$ErrorActionPreference = "Stop"
$Package = "slideforge-studio"
$Latest = "https://github.com/dmighty007/slideforge-studio/archive/refs/heads/main.zip"

function Say($text) { Write-Host "==> $text" -ForegroundColor Magenta }

$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"

if ($env:SLIDEFORGE_UNINSTALL -eq "1") {
    Say "Removing SlideForge"
    if (Get-Command slideforge -ErrorAction SilentlyContinue) { slideforge --remove-shortcut }
    if (Get-Command uv -ErrorAction SilentlyContinue) { uv tool uninstall $Package }
    Say "Done. Your presentations are still in your SlideForge data folder."
    return
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Say "Installing uv (it fetches Python and SlideForge's libraries)"
    powershell -ExecutionPolicy ByPass -NoProfile -Command "irm https://astral.sh/uv/install.ps1 | iex"
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

Say "Installing SlideForge (a few minutes the first time)"
$Source = if ($env:SLIDEFORGE_SOURCE) { $env:SLIDEFORGE_SOURCE } else { $Latest }
$Spec = if ($Source -eq "pypi") { $Package } else { "$Package @ $Source" }
# --refresh-package: download it again (the zip's address stays the same from one version to the next).
uv tool install --upgrade --reinstall-package $Package --refresh-package $Package --python 3.12 $Spec
if ($LASTEXITCODE -ne 0) { throw "SlideForge could not be installed." }

Say "Adding SlideForge to the Start menu and the desktop"
if ($env:SLIDEFORGE_NO_DESKTOP_ICON -eq "1") { slideforge --install-shortcut --no-desktop-icon } else { slideforge --install-shortcut }

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Host "Note: videos need ffmpeg to be converted for the app: winget install ffmpeg" -ForegroundColor Yellow
}
Say "SlideForge is installed. Open it from the Start menu or the desktop icon."
