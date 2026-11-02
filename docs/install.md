---
title: Install
---

# Install SlideForge

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

If the app opens in a browser instead of a native window, check the
[GUI backend instructions](DESKTOP.md#install). For storage locations and logs, see
[the desktop guide](DESKTOP.md). To run from source, use the
[development guide](DEVELOPMENT.md).
