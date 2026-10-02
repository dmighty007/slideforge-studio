# SlideForge Studio

A presentation editor that runs on your own computer. Build slides on a free canvas with text, shapes, pictures, tables, charts, LaTeX equations, Mermaid diagrams, 3D molecules, PDFs and videos. Then present them with animations, or export to PowerPoint (.pptx), PDF or a web page.

It runs for a single local user, so there is no account and no sign-in. Your presentations stay in a folder on your machine.

- **Editing:** themes and slide layouts, bullet lists, grouping, alignment guides, undo, and an animation timeline.
- **Science-friendly elements:** KaTeX equations, Mermaid flowcharts and other diagrams, molecules from PDB and trajectory files, and charts with an editable data table.
- **Presenting:** full-screen show, presenter view with notes, bullet-by-bullet and step-by-step reveals, a laser pointer, a spotlight and a chalkboard.
- **Exporting:**
  - PowerPoint, with animations and bullet builds;
  - PDF and PNG;
  - a stand-alone HTML viewer;
  - view-only share links.
- **Importing:** PowerPoint files and SlideForge files. Slides can also be drafted from a PDF paper with a language model (your own API key, or a local Ollama).

## Install

```bash
pip install slideforge-studio
```

The command is `slideforge`. On Linux, the native window needs a GUI backend; the easiest one to install is Qt:

```bash
pip install "slideforge-studio[qt]"
```

macOS and Windows use the system web view and need nothing extra. Without a GUI backend, SlideForge opens in your default browser instead.

When Qt is installed, SlideForge always uses it: it has a built-in PDF viewer for PDF elements, which the GTK (WebKitGTK) backend lacks. With Qt, presentation mode is full screen, and the presenter view opens as a second app window.

Optional: a heavier figure and layout extraction stack for drafting slides from papers (MinerU, torch, vLLM; several GB):

```bash
pip install "slideforge-studio[pdf]"
```

## Run

```bash
slideforge              # opens the editor in a native window
slideforge --browser    # opens it in your default browser
slideforge --no-open    # only starts the server and prints its URL
```

SlideForge opens on a start screen. It lists your recent presentations and offers:
- a new blank deck;
- a deck in one of six themes;
- an import from PowerPoint (.pptx) or a SlideForge .json file.

Reopen the start screen any time with the house button in the toolbar. Nothing is created until you choose (or start editing).

Other options: `--port N`, `--data-dir PATH`, `--version`. By default SlideForge reuses the port from its last launch, so the editor reopens your project; if that port is taken, it picks a free one.

Only one SlideForge runs per data directory. Starting it again opens the running instance in your browser instead.

- **Windows:** `slideforge-gui` starts it without a console window and reports problems in a dialog.
- **Linux:** `slideforge --install-shortcut` adds SlideForge to your application menu. To remove it, delete `~/.local/share/applications/slideforge.desktop`.

## Your data

Presentations, uploaded media, logs and settings are kept in a per-user data directory, which the app prints at startup:

| OS | Default location |
|---|---|
| Linux | `~/.local/share/SlideForge` |
| macOS | `~/Library/Application Support/SlideForge` |
| Windows | `%LOCALAPPDATA%\SlideForge` |

Set `SLIDEFORGE_DATA_DIR` or pass `--data-dir` to use another folder. Deleting the folder resets the app.

Before an upgrade changes the database, SlideForge copies it to `backups/` in the data directory (the last five copies are kept). Uploaded files that no saved presentation uses are deleted automatically after 24 hours.

Optional settings go in `config.env` in that folder, one `KEY=value` per line; real environment variables take precedence.
- **LLM providers:** `GOOGLE_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `OLLAMA_BASE_URL`, `PPTMAKER_TEXT_MODEL` and `OLLAMA_VISION_MODEL`, used by the AI features.
- **Limits:** the `PPTMAKER_*` keys, for example upload limits.
  - `PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS` (default 90) bounds long AI slide clean-ups. When it runs out, the built-in layout clean-up is used instead.
  - `PPTMAKER_FFMPEG_TIMEOUT_SECONDS` (default 900) bounds video conversion.

## Sharing a presentation

**Share** (next to Present) makes a view-only link to the open presentation. People with the link can watch the slides in any browser, phones included (swipe or tap to move on). They cannot edit them or see anything else in SlideForge. The shared copy is updated each time your changes are saved. **Stop sharing** deletes it, and the link stops working.

The link first works on your computer only. To open it on other devices, press **Make it reachable from anywhere** in the Share dialog. SlideForge then starts a free [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), which gives the link a public `https://<random words>.trycloudflare.com` address; no account is needed.

The tunnel needs the `cloudflared` program. Install it with your package manager (`sudo pacman -S cloudflared`, `brew install cloudflared`, `winget install Cloudflare.cloudflared`), or let the Share dialog download the official release into the data directory's `bin/` folder.

- The public link only works while SlideForge is running, and gets a new address each time SlideForge starts. Open Share again to get the current link.
- The tunnel is connected to a separate local server that answers only shared-presentation addresses (`/s/<link key>/...`). The editor, its API and your files are not reachable through it.
- Shared copies are kept in `shares/` in the data directory.

## Security model

The server listens on `127.0.0.1` only. Each launch generates a random token, which only the window or browser tab opened by `slideforge` receives, as a cookie. Other programs and web pages on the machine cannot use the local server without it. A Content-Security-Policy is enforced on every page.

## External tools

These features use programs that pip cannot install. When a program is missing, only that feature is unavailable:

- `ffmpeg` transcodes uploaded videos to MP4.
- `cloudflared` makes shared links reachable from other devices (see Sharing a presentation).
- `marker_single` (Marker) extracts figures from PDFs when `PPTMAKER_USE_MARKER_VISUALS=1`.
- The Cairo library is a fallback for SVG pictures in PowerPoint export (via CairoSVG). Normally the editor converts them itself, so it is not needed.

## Licenses

SlideForge Studio is released under the MIT license.

It depends on PyMuPDF for reading PDFs, which is licensed under the GNU AGPL v3 (or a commercial license from Artifex). Installing SlideForge with pip downloads PyMuPDF separately under its own license. If you redistribute SlideForge bundled with PyMuPDF, for example in an installer, the AGPL's terms apply to that bundle.

Third-party libraries and fonts bundled with SlideForge, and their licenses, are listed in `THIRD_PARTY_NOTICES.md`, which is included in the package.

## Development

The source, issue tracker and development notes are at <https://github.com/dmighty007/slideforge-studio>. From a clone of the repository:

```bash
pip install -e ".[dev]"         # editable install: the app serves ./frontend directly
pytest                          # desktop tests (tests/desktop)
python backend/manage.py test slideforge.studio slideforge.bridge   # shared backend tests
python -m build                 # dist/slideforge_studio-*.whl and the sdist
```

The desktop app and the web app are built from the same code. `hatch_build.py` bundles a trimmed copy of `frontend/` into the wheel, leaving out unreferenced fonts, source maps and the animation test scripts.

What differs from the web app is configuration, not code. `slideforge/desktop/settings.py` sets `SLIDEFORGE_ACCOUNTS_ENABLED = False`. As a result:
- the sign-in endpoints are not registered;
- the page is served with `<body class="accounts-disabled">`, which hides the sign-in UI;
- `LocalUserMiddleware` runs every request as one local user.

Browser tests (Playwright) run against a running instance:

```bash
npm install && npx playwright install chromium
slideforge --no-open --port 8076 --data-dir /tmp/sf-test   # prints http://127.0.0.1:8076/?token=...
SLIDEFORGE_TEST_URL="<printed URL>" node tests/browser/test-ui-smoke.js
SLIDEFORGE_TEST_URL="<printed URL>" node tests/browser/test-regressions.js
SLIDEFORGE_TEST_URL="<printed URL>" node tests/browser/test-dark-mode.js     # the dark-mode switch; no surface left light
SLIDEFORGE_TEST_URL="<printed URL>" node tests/browser/test-start-screen.js  # needs a fresh --data-dir
```
