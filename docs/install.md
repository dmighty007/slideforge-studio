---
title: Install
---

# Install SlideForge

<p class="sf-page-lead">A local desktop workspace for scientific presentations, on Linux, macOS and Windows.</p>

Choose your operating system below. The installer sets up Python and the app for your
user, then adds an applications-menu entry and desktop shortcut. You need an internet
connection for installation; no administrator rights or existing Python setup are required.

## Recommended: use the installer

These commands download and run the installer from this project's GitHub repository.
You can inspect the [Linux/macOS script](https://github.com/dmighty007/slideforge-studio/blob/main/install.sh)
or [Windows script](https://github.com/dmighty007/slideforge-studio/blob/main/install.ps1) first.

=== "Linux and macOS"

    Open **Terminal**, paste this command, and press Enter:

    ```bash
    curl -fsSL https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.sh | sh
    ```

=== "Windows"

    Open **PowerShell**, paste this command, and press Enter:

    ```powershell
    irm https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.ps1 | iex
    ```

Wait for the installer to finish, then launch **SlideForge** from your applications menu.
The installer uses the latest source from GitHub's `main` branch. For a published PyPI
release instead, see the [desktop guide](DESKTOP.md#install).

[Make your first presentation →](getting-started.md){ .md-button .md-button--primary }

## Alternative: install with pip

Use this if you already have a working Python environment. It installs the latest
published release from PyPI.

=== "Linux and macOS"

    ```bash
    python -m pip install "slideforge-studio[qt]"
    ```

=== "Windows"

    ```powershell
    python -m pip install slideforge-studio
    ```

Then start the app, or add shortcuts:

```bash
slideforge
slideforge --install-shortcut
```

## Update or remove

The app offers an update when a newer version is available. You can also run the
installer again. See [update options](DESKTOP.md#updates) for details.

To uninstall an installer-managed copy:

=== "Linux and macOS"

    ```bash
    curl -fsSL https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.sh | sh -s -- --uninstall
    ```

=== "Windows"

    ```powershell
    $env:SLIDEFORGE_UNINSTALL = "1"
    irm https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.ps1 | iex
    Remove-Item Env:SLIDEFORGE_UNINSTALL
    ```

Your saved presentations are kept. For a pip installation, use
`python -m pip uninstall slideforge-studio`.

## Need help?

### Ubuntu: Wayland or Qt platform plugin error

`Failed to create wl_display` means Qt could not connect to a Wayland display.
Forcing `QT_QPA_PLATFORM=wayland` requires a running, accessible Wayland session.
First let Qt select the platform for your desktop:

```bash
env -u QT_QPA_PLATFORM slideforge
```

If you are using an X11 desktop (or XWayland), try:

```bash
QT_QPA_PLATFORM=xcb slideforge
```

If Qt reports a missing `libxcb-cursor.so.0`, install it with
`sudo apt install libxcb-cursor0`. Other missing library errors need the
corresponding system package; reinstalling SlideForge alone will not fix them.

To use the editor without the native Qt window:

```bash
slideforge --browser
```

This requires a local browser. For an SSH or headless session, use
`slideforge --no-open` to start only the local server.

If the app opens in a browser instead of a native window, check the
[GUI backend instructions](DESKTOP.md#install). For storage locations and logs, see
[the desktop guide](DESKTOP.md). To run from source, use the
[development guide](DEVELOPMENT.md).
