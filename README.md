# SlideForge

SlideForge is a browser-based presentation editor with a Django backend. It combines a canvas-style slide builder, project persistence, PPTX export, animation tooling, and document-to-slide workflows in one local web app.

To use it as a desktop app on your own computer: `pip install slideforge-studio`, then run `slideforge`. See [docs/DESKTOP.md](docs/DESKTOP.md).

## What It Does

- Start from a screen of recent presentations (with theme-coloured covers, search and delete), a new blank or themed deck, or an import.
- Edit presentations in a Figma-like canvas with draggable, resizable, styleable slide elements.
- Build slides from text, images, shapes, tables, media, scientific figures, and generated presets.
- Insert editable Mermaid diagrams for flowcharts, sequence diagrams, state charts, Gantt timelines, ER diagrams, and mind maps.
- Apply and preview slide and object animations, including advanced text and shape effects.
- Import presentation JSON and clean up slide content.
- Save presentations through the Django API and export decks to PowerPoint.
- Share a view-only link to a presentation (`/s/<link key>/`), which follows each saved change and can be revoked.
- Work in a light or dark editor (moon button in the toolbar, or "Dark Mode" in the command palette).
- Run locally with SQLite for development.

## Project Layout

```text
SlideForge/
|-- backend/
|   |-- manage.py
|   |-- pptmaker_backend/   # Web app: Django settings and root URL routing
|   `-- slideforge/         # Shared Python package (web app and desktop app)
|       |-- studio/         # Django app: views, auth, assets, presentations, exports
|       |-- bridge/         # Document parsing, LLM helpers, PPTX exporter
|       `-- desktop/        # Desktop app: launcher, single-user settings, window integration
|-- frontend/
|   |-- index.html          # Single-page editor shell
|   |-- js/                 # Frontend editor modules (classic scripts; see docs/APP_DESCRIPTION.md#frontend-script-layout)
|   |-- css/                # Editor styles
|   |-- assets/             # Static images and icons
|   `-- static/             # Extra static source directory for Django
|-- docs/                  # App description and DESKTOP.md (the desktop app and its PyPI page)
|-- pyproject.toml          # Builds the desktop app wheel (`slideforge-studio` on PyPI) from this repository
|-- hatch_build.py          # Bundles a trimmed frontend/ into that wheel
|-- tests/
|   `-- browser/            # Optional Playwright/browser probes
|-- requirements.in         # Core Python dependencies (edit this)
|-- requirements.lock       # Pinned core dependencies (generated)
|-- requirements-pdf.in     # Optional heavy PDF/figure extraction stack
|-- requirements-pdf.lock   # Pinned PDF stack (generated)
|-- .env.example            # Template for local settings
`-- package.json            # Optional Playwright dependency for browser probes
```

## Requirements

- Python 3.10 or newer (the lock files are generated with 3.12)
- Django 5.2, installed from `requirements.lock`
- SQLite, used by default through `db.sqlite3`
- Node.js, optional, only needed for Playwright-based browser checks
- Optional local document extraction tools for PDF processing workflows.

## Quick Start

Create and activate a Python environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

Install the backend dependencies:

```bash
pip install -r requirements.lock
```

Optionally install the heavy PDF/figure extraction stack (MinerU, torch, vLLM; several GB):

```bash
pip install -r requirements.lock -r requirements-pdf.lock
```

After editing `requirements.in` or `requirements-pdf.in`, regenerate the locks with pip-tools:

```bash
pip install pip-tools
pip-compile --strip-extras --output-file=requirements.lock requirements.in
pip-compile --strip-extras --output-file=requirements-pdf.lock requirements-pdf.in
```

Create your local environment file:

```bash
cp .env.example .env
```

Settings are read from `.env` at startup; real environment variables take precedence. Set `DJANGO_DEBUG=0` and a real `DJANGO_SECRET_KEY` outside local development.

Run database migrations:

```bash
python backend/manage.py migrate
```

Start the development server:

```bash
python backend/manage.py runserver
```

Open the editor at:

```text
http://127.0.0.1:8000/
```

In development mode, Django serves the editor shell from `frontend/` plus the `/js/`, `/css/`, `/assets/`, `/static/`, and `/media/` paths.

## Configuration

Runtime settings are loaded from `.env`; real environment variables take precedence. `.env.example` lists every supported variable with its default.

Core Django settings:

```text
DJANGO_DEBUG=1
DJANGO_SECRET_KEY=change-me
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
```

With `DJANGO_DEBUG=0`, the app refuses to start unless `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS` are set, and it enables HTTPS redirects, secure cookies and HSTS.

A Content-Security-Policy header is sent on every response (see `CONTENT_SECURITY_POLICY` in `backend/pptmaker_backend/settings.py`). In debug mode it is report-only, so violations appear in the browser console without blocking anything; set `PPTMAKER_CSP_REPORT_ONLY=0` to enforce it locally.

## API Surface

The Django app exposes the editor at `/` and serves backend endpoints under `/api/`.

- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/logout/`
- `GET /api/auth/session/`
- `POST /api/assets/upload/`
- `GET /api/assets/pdf-page/?url=<asset url>&page=1&width=1400` (a page of an uploaded PDF as a picture, for exports and thumbnails)
- `POST /api/slides/cleanup/`
- `POST /api/presentations/`
- `GET/PATCH/DELETE /api/presentations/<presentation_id>/`
- `GET/POST/DELETE /api/presentations/<presentation_id>/share/` (POST uploads the viewer bundle built by the editor)
- `GET /s/<link key>/...` (the shared, view-only presentation; no sign-in)
- `POST /api/presentations/export/pptx/`

## Desktop app

The same code also ships as a single-user desktop app with a native window and no sign-in. See `docs/DESKTOP.md`. In short: `pip install slideforge-studio` (or `pip install .` from a clone; add `[qt]` on Linux), then run `slideforge`.

## Development

Lint Python (config in `ruff.toml`):

```bash
pip install ruff
npm run lint:python
```

Run Django checks:

```bash
npm run check:backend
```

Run Django tests:

```bash
npm run test:backend
```

Install optional browser tooling:

```bash
npm install
```

Run the browser tests against a dev server on port 8076 (override with `SLIDEFORGE_TEST_URL`):

```bash
npx playwright install chromium
python backend/manage.py runserver 127.0.0.1:8076
npm run test:ui
npm run test:phase2
npm run test:animations
```

`npm run test:regressions` covers undo, autosave, XSS and whiteboard regressions. The tests that save projects need a signed-in session: pass a Playwright storage state with `SLIDEFORGE_STORAGE_STATE=state.json`, or set `SLIDEFORGE_FRONTEND_ONLY=1` to skip them.

Syntax-check every frontend module:

```bash
npm run check:frontend
```

CI (`.github/workflows/ci.yml`) runs the Python lint, the Django checks, the frontend syntax check and the Django tests.

## Maintenance

- `python backend/manage.py cleanup_assets` deletes uploaded files that no saved presentation or revision uses and that are older than 24 hours (`--dry-run` to preview, `--grace-hours N` to change the age).
- AI slide clean-up is cut off after `PPTMAKER_AI_CLEANUP_TIMEOUT_SECONDS` (default 90) and falls back to the built-in layout clean-up; `PPTMAKER_FFMPEG_TIMEOUT_SECONDS` (default 900) bounds video conversion.
- Bundled third-party libraries and fonts are listed with their licenses in `THIRD_PARTY_NOTICES.md`.

## Mermaid Diagrams

Use the toolbar button labelled `Flowchart / Mermaid Diagram` or press `Ctrl+Shift+M` to open the diagram editor. Flowcharts open as a hybrid visual/code editor with draggable nodes, quick connections, inline label editing, a compact floating toolbar, markdown-lite labels, multi-select basics, layout controls, and Mermaid source kept in sync. Non-flowchart Mermaid types still use the sanitized Mermaid preview/render path.

Architecture notes:

- `frontend/js/mermaid/mermaid-engine.js` lazy-loads vendored Mermaid assets, validates source, queues async renders, caches SVG, and sanitizes output.
- `frontend/js/mermaid/mermaid-graph.js` parses flowchart Mermaid into SlideForge's graph model, lays out nodes, regenerates Mermaid with `sf:graph` position metadata, and exports custom SVG.
- `frontend/js/mermaid/mermaid-dialog.js` owns visual/code/split modes, templates, direct graph manipulation, theme controls, debounce, diagnostics, and insert/update flow.
- `frontend/js/mermaid/mermaid-object.js` creates and renders canvas objects so diagrams can be moved, resized, copied, duplicated, styled, and animated like other elements.
- `frontend/js/mermaid/mermaid-export.js` handles browser SVG download.
- `backend/slideforge/bridge/pptx_exporter.py` exports Mermaid diagrams as SVG when supported and falls back to high-resolution PNG through CairoSVG.

Migration notes:

- Existing projects load unchanged.
- New Mermaid elements preserve `mermaidSource`, `mermaidType`, `theme`, `svgContent`, `graphModel`, `nodePositions`, routing/layout flags, dimensions, style, and animation data.
- Visual node positions are stored both in `graphModel` and in Mermaid comments such as `%% sf:graph {...} %%`, so source remains portable while SlideForge can restore manual layout.
- Double-click a node to edit inline, drag from a connector to create a linked node, use `Enter` for child nodes, `Tab` for siblings, `Ctrl/Cmd+D` to duplicate, arrow keys to nudge, and `F` to focus the current selection.
- If an older saved project contains a Mermaid object without `svgContent`, the editor re-renders it on load.

## Notes

- Local development data lives in `backend/db.sqlite3` and `backend/media/`.
- Do not commit `.env`, uploaded media, generated caches, or local browser probe output.
- The frontend is intentionally framework-light: most editor behavior lives in ES modules under `frontend/js/`.
- PPTX export is implemented in `backend/slideforge/bridge/pptx_exporter.py` and exposed through the Django presentation export endpoint.

## License

SlideForge is released under the MIT License (see `LICENSE`).
