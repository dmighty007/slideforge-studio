---
title: Install
---

# Install SlideForge

=== "Linux and macOS"

    Paste this into a terminal:

    ```bash
    curl -fsSL https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.sh | sh
    ```

=== "Windows"

    Paste this into PowerShell:

    ```powershell
    irm https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.ps1 | iex
    ```

=== "pip"

    ```bash
    pip install "slideforge-studio[qt]"   # drop [qt] on Windows
    slideforge                            # start it
    slideforge --install-shortcut         # add the menu and desktop icons
    ```

That's all: SlideForge appears in your applications menu and as an icon on your desktop. No administrator rights,
and no Python to set up first. When a newer version comes out, SlideForge says so and updates itself (or run the
same line again).

To remove it, add `--uninstall` (`... | sh -s -- --uninstall`). Your presentations stay on your computer either way.

More in the [desktop guide](DESKTOP.md). To run SlideForge from its repository, or to help build it, see
[Development](DEVELOPMENT.md).
