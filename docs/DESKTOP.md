# SlideForge Studio

A presentation editor that runs on your own computer. Build slides on a free canvas with text, shapes, pictures, tables, charts, LaTeX equations, Mermaid diagrams, 3D molecules, PDFs and videos. Then present them with animations, or export to PowerPoint (.pptx), PDF or a web page.

It runs for a single local user, so there is no account and no sign-in. Your presentations stay in a folder on your machine.

- **Editing:** themes and slide layouts, bullet lists, grouping, alignment guides, undo, and an animation timeline.
- **Science-friendly elements:** KaTeX equations, Mermaid flowcharts and other diagrams, molecules from PDB and trajectory files, and charts with an editable data table.
- **Presenting:** full-screen show, presenter view with notes, bullet-by-bullet and step-by-step reveals, a laser pointer, a spotlight and a chalkboard; a timer (count up or down to a talk length) and recording the show as a video with your voice ([how](getting-started.md#time-and-record-a-talk)).
- **Exporting:**
  - PowerPoint, with animations and bullet builds;
  - PDF and PNG;
  - a stand-alone HTML viewer;
  - view-only share links.
- **Importing:** PowerPoint files, Keynote files (text, pictures, movies and notes for now) and SlideForge files. Slides can also be drafted from a PDF paper with a language model (your own API key, or a local Ollama).

## Install

The easiest way, with a menu entry and a desktop icon, no administrator rights and no Python to set up first:

```bash
# Linux and macOS
curl -fsSL https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/dmighty007/slideforge-studio/main/install.ps1 | iex
```

They install the latest version from GitHub (the `main` branch, downloaded as a zip; no git needed). Run the same
line again to update. For the latest release on PyPI instead, set `SLIDEFORGE_SOURCE=pypi`
(`curl ... | SLIDEFORGE_SOURCE=pypi sh`, or `$env:SLIDEFORGE_SOURCE = "pypi"` on Windows); any other URL or folder
there installs from it. To remove SlideForge: `curl -fsSL .../install.sh | sh -s -- --uninstall` (on Windows, set
`$env:SLIDEFORGE_UNINSTALL = "1"` first). Your presentations are kept.

### Updates

SlideForge looks for a newer version a few seconds after it opens, at most once a day. When there is one, a card
offers to **Update**: the new version installs in the background while you keep working, the way this copy was
installed (the installers' `uv tool install` again, or `pip install --upgrade` for a pip install; Qt and other extras
are kept). **Restart now** saves your work, closes the window and opens the new version. **Skip this version** stops
offering that one. **Check for Updates…** in the command palette (Ctrl+K) asks at any time.

A copy installed from GitHub compares itself with the version on the `main` branch; one from PyPI with the latest
release there. The check only downloads that version number. Turn automatic checks off with the box in the update
card, or set `SLIDEFORGE_NO_UPDATE_CHECK=1`. A development copy (an editable install of a clone) is not updated
from the app: `git pull` updates it.

### What comes across from PowerPoint

- **Charts** stay editable: bar (upright or horizontal, side by side, stacked or 100% stacked), line, pie,
  doughnut and scatter, with their axis titles, axis ranges, logarithmic axes and numbers on the bars.
- **Pictures in Windows formats** are converted: EMF, EMF+ and WMF drawings (MathType equations, ChemDraw
  structures, graphs pasted from Origin or Excel) become sharp vector pictures, and TIFF pictures become PNG.
- **Shapes** keep their outlines: all of PowerPoint's preset shapes (hearts, clouds, lightning bolts, brackets,
  flowchart symbols) are drawn from PowerPoint's own definitions, with their adjustments and mirroring.
- **Text** keeps vertical writing, numbering such as "(a)" or "ii.", and links to other slides, which work while
  presenting.
- **Embedded objects** (ChemDraw, MathType, Origin, Excel) come in as the picture PowerPoint shows of them. To edit
  one, open it in its own program.
- **Posters and handouts** in portrait keep a portrait page.

Not yet converted: a metafile whose drawing is only in an embedded PDF copy, and some rare EMF+ features (custom
arrowheads, texture brushes). Wipe transitions play as a slide transition.

### Fonts in imported presentations

A PowerPoint or Keynote file names its fonts. When one is not on this computer, a similar font is drawn instead, and
lines can break differently. SlideForge fills the gap in four ways:

- **Fonts the file carries.** A PowerPoint file saved with *Embed fonts* holds its fonts. They are added to your fonts
  at import (including PowerPoint's compressed form), for the families this computer lacks.
- **Bundled fonts.** Computer Modern Unicode (CMU Serif, CMU Sans Serif, CMU Typewriter Text) comes with the app, and
  free fonts are drawn in place of common commercial ones, which SlideForge may not ship. Arimo, Tinos, Carlito and
  Caladea have the same letter widths as Arial (and Helvetica), Times New Roman (and Times), Calibri and Cambria, so
  lines break as in PowerPoint; STIX Two Math stands in for Cambria Math. Look-alikes, whose widths differ, stand in
  for Garamond (EB Garamond), Century (TeX Gyre Schola), Arial Black (Archivo Black), Impact (Anton), Castellar and
  Algerian (Cinzel), Edwardian Script ITC and Fairwater Script (Great Vibes), Comic Sans MS (Comic Neue), Arial
  Rounded MT Bold (Nunito) and Adobe Devanagari (Noto Serif Devanagari). An installed copy of the real font, or one
  you add, is always used first. A web export carries only the ones its slides use.
- **Google Fonts.** After an import, SlideForge lists the fonts it could not find and offers **Download from Google
  Fonts**: each one Google Fonts has is downloaded (regular, bold and italic) and kept for every later session. Fonts
  are only requested from Google when you click; **Download Fonts for This Presentation…** in the command palette
  (Ctrl+K) checks the open presentation at any time.
- **Your own font files.** For a font Google does not have (Cambria Math, Segoe UI, a company's font), **Add Font
  Files…** (in the same card, or the command palette) takes TrueType, OpenType, collection (.ttc), WOFF or EOT files
  you have, for example copied from a computer with Office, or .zip files of them as downloaded (every font file in
  a zip is added; anything else in it is skipped). They are kept for you only: in the web app, other users
  cannot see or download them.

A font that is still missing keeps its closest installed match.

Or with pip, the latest release from PyPI:

```bash
pip install slideforge-studio
```

The command is `slideforge`. On Linux and macOS, install it with Qt, which provides the native window:

```bash
pip install "slideforge-studio[qt]"
```

On Linux, the window needs a GUI backend, and Qt is the easiest to install. macOS can fall back on its system web view,
but without Qt the presenter view, links and full-screen presentations do not work there. Windows uses its system web
view and needs nothing extra. Without a GUI backend, SlideForge opens in your default browser instead.

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
slideforge talk.pptx    # opens a presentation (.pptx, .key or a SlideForge .json export)
```

Each file given opens as a new project, as Import on the start screen would; several can be given at once. If
SlideForge is already running, they open in its window instead of starting a second copy (a file given during a
slide show opens when the show ends). A missing or unsupported file is reported before anything starts.

SlideForge opens on a start screen. It lists your recent presentations and offers:
- a new blank deck;
- a deck in one of six themes;
- an import from PowerPoint (.pptx), Keynote (.key) or a SlideForge .json file.

Reopen the start screen any time with the house button in the toolbar. Nothing is created until you choose (or start editing).

Other options: `--port N`, `--data-dir PATH`, `--version`. By default SlideForge reuses the port from its last launch, so the editor reopens your project; if that port is taken, it picks a free one.

Only one SlideForge runs per data directory. Starting it again opens the running instance in your browser instead.

- **Windows:** `slideforge-gui` starts it without a console window and reports problems in a dialog.
- **Icons:** `slideforge --install-shortcut` adds SlideForge to your applications menu (Linux, macOS's ~/Applications, the Windows Start menu) and puts its icon on your desktop; add `--no-desktop-icon` for the menu only. `slideforge --remove-shortcut` takes them away again. The one-line installers do this for you.

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

SlideForge Studio is free software under the GNU Affero General Public License v3.0 or later (it builds on PyMuPDF, which is offered under the same licence). Bundled libraries and fonts are listed in THIRD_PARTY_NOTICES.md.

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
