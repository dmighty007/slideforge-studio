# SlideForge App and Codebase Description

## Overview

SlideForge is a local-first presentation authoring application. It runs as a browser-based single-page editor served by a Django backend, and it is designed to let a user create, edit, present, save, import, and export rich slide decks from one workspace.

At the product level, SlideForge behaves like a lightweight visual design tool for presentations. The user works on a slide canvas, inserts objects, adjusts properties, manages slide order, applies themes and transitions, uses animation tooling, and exports the result. The application supports ordinary presentation content such as text, images, shapes, tables, charts, and videos, but it also includes more specialized authoring tools for Mermaid diagrams, LaTeX equations, sketch/whiteboard content, embedded HTML, PDFs, molecular structures, 3D backgrounds, and advanced animation timelines.

The app is intentionally framework-light on the frontend. The editor is built mostly from static HTML, CSS, and JavaScript modules under `frontend/`, while the backend in `backend/` provides persistence, authentication, upload handling, slide cleanup, and PowerPoint export. Development runs with SQLite and Django's static development serving. The current offline build vendors third-party browser dependencies into `frontend/vendor/`, so the editor can boot without reaching public CDNs for fonts, icons, JavaScript libraries, or presentation styles.

## High-Level Architecture

```text
SlideForge/
|-- backend/
|   |-- manage.py
|   |-- pptmaker_backend/
|   |   |-- settings.py
|   |   `-- urls.py
|   `-- slideforge/          # shared package (web + desktop)
|       |-- studio/
|       |   |-- models.py
|       |   |-- views.py
|       |   |-- auth_views.py
|       |   |-- urls.py
|       |   `-- tests.py
|       |-- bridge/
|       |   |-- pptx_exporter.py
|       |   |-- llm_utils.py
|       |   |-- pdf_bridge.py
|       |   |-- processors.py
|       |   `-- vision.py
|       `-- desktop/        # desktop launcher, settings, middleware
|-- frontend/
|   |-- index.html
|   |-- css/
|   |-- js/
|   |-- assets/
|   |-- static/
|   `-- vendor/
|-- tests/
|   `-- browser/
|-- package.json
|-- requirements.txt
`-- README.md
```

The backend serves the SPA shell at `/`, exposes JSON APIs under `/api/`, and serves development assets from `/js/`, `/css/`, `/assets/`, `/static/`, `/vendor/`, and `/media/` while `DEBUG` is enabled. The frontend keeps most editor behavior in global browser modules and uses the backend mainly for project persistence, media upload, cleanup, and PPTX generation.

## Runtime Flow

1. A browser loads `frontend/index.html` through the Django `spa_index` view.
2. The page loads vendored browser libraries from `frontend/vendor/`, including Reveal.js, Chart.js, FontAwesome, Tailwind, Three.js, KaTeX, DOMPurify, JSZip, html2canvas, jsPDF, FileSaver, Interact.js, Mermaid, NGL, and font assets.
3. App CSS from `frontend/css/` builds the editor shell, toolbar, slide rail, canvas, panels, modals, timeline, presentation mode, and responsive layout.
4. JavaScript modules under `frontend/js/` initialize global editor state, render slides, bind commands, enable drag/resize interactions, manage properties, and expose insert/edit/export/presentation workflows.
5. The user either continues locally or signs in. Guest/local operation is supported, while authenticated users can save projects through the Django API.
6. The active deck lives as JSON state in the browser. It is rendered into editable DOM elements on the canvas and converted into persistence/export formats when needed.
7. Saving posts the presentation state to Django, where it is stored in the `Presentation` model as JSON and revisioned.
8. Export paths either run in the browser, such as ZIP/PNG/PDF/JSON workflows, or use the backend PPTX exporter for PowerPoint output.

## Frontend Application Shell

The main frontend entry point is `frontend/index.html`. It defines:

- The entry/sign-in screen and local guest entry path.
- The primary toolbar for project actions, workspace modes, undo/redo, copy/paste, properties, layers, transitions, timeline, AI cleanup, presentation, and export.
- The insert toolbar for text, table, images, charts, equations, symbols, icons, shapes, Mermaid diagrams, whiteboard, sketch board, connectors, videos, PDFs, HTML embeds, and molecule files.
- The slide rail and slide preview area.
- The central slide canvas and zoom engine.
- Presentation overlays, laser/chalk controls, and presenter menu controls.
- Modals and popovers for authentication, projects, commands, icons, symbols, equations, shape picking, Mermaid editing, exports, layers, and transitions.

The shell references vendored libraries with local paths such as `vendor/chart.js/chart.umd.min.js`, `vendor/reveal.js/reveal.js`, `vendor/tailwind/tailwind.cdn.js`, and `vendor/fonts/fonts.css`. This is what allows the editor to boot offline without CDN access.

## Frontend State Model

The editor state is centered around a presentation object that contains slide-level metadata and element arrays. Each slide typically includes:

- A unique slide id.
- Layout and master slide identifiers.
- Notes.
- Slide-specific transition settings.
- A list of positioned elements.

Elements share a common canvas model:

- `id`
- `type`
- `x` and `y`
- `width` and `height`
- `content` or type-specific payloads
- `styles`
- optional animation, crop, media, table, chart, diagram, molecule, or whiteboard data

Core state utilities live in `frontend/js/core/state.js`. The command layer in `frontend/js/core/commands/` performs mutating operations such as inserting objects, deleting selections, copying, pasting, undoing, redoing, updating slide content, and invoking higher-level workflows. Rendering converts the current state into DOM nodes through `frontend/js/editor/render/`.

## Rendering and Editing

The editor renders each slide into the canvas as a collection of absolutely positioned objects. Object-specific rendering is handled in and around `frontend/js/editor/render/` (`elements.js` dispatches to per-type files such as `element-text.js`, `element-media.js`, `tables.js` and `connectors.js`), with supporting modules for text, embeds, diagrams, crops, sketches, animations, and properties.

Important rendering concerns include:

- Keeping element state and DOM state synchronized.
- Preserving inline text formatting across edit, save, reload, and presentation paths.
- Supporting drag and resize through Interact.js.
- Handling z-index, selection outlines, multi-selection, and hit testing.
- Maintaining slide-specific and presentation-wide transitions.
- Rendering rich embedded objects without letting them interfere with selection or editing.
- Converting visual state into browser export or backend export formats.

Text rendering uses a semantic text document model when available. The text modules under `frontend/js/text/` handle legacy HTML content, structured text blocks, bullet and numbered lists, inline marks, selection behavior, and text layout. Text content may be stored as legacy HTML or as a normalized document containing blocks and runs. Rendering now prefers the semantic document renderer when present, which preserves inline styles and produces correct list markup.

## Main Frontend Modules

### Core

`frontend/js/core/` contains the editor's shared runtime logic.

- `main.js` initializes the app, auth/session state, entry gate behavior, project UI, and general bootstrapping.
- `state.js` owns state normalization, persistence shape, ids, migrations, and undo-friendly data structures.
- `commands/` contains high-level editing commands (one file per area: `slides.js`, `elements.js`, `clipboard.js`, `file-insert.js`, `bridge-*.js` for document import, `play-mode.js`, `presenter-view.js`, `command-palette.js`, and so on), insertion workflows, clipboard behavior, project actions, shortcuts, and many global command handlers.
- `keyboard.js` registers keyboard shortcuts and command palette behavior.
- `workspace.js` switches workspace modes such as slides, whiteboard, timeline, and review.
- `pageSetup.js` manages slide dimensions and presentation page setup.

### Editor

`frontend/js/editor/` contains the canvas renderer and editor-specific features.

- `render/` renders slide elements and binds element-level editing behavior.
- `interact.js` integrates drag, resize, crop, and object manipulation.
- `components.js` provides reusable object construction and editing helpers.
- `contextMenu.js` manages contextual actions.
- `crop.js` controls image crop mode.
- `zoom.js` manages canvas zoom and viewport sizing.
- `themes.js`, `theme-ecosystem.js`, and `theme-optimizer.js` define and apply presentation themes.
- `slide-presets/` (one file per preset family, plus `catalog.js`, `metadata.js` and `apply.js`) and `preset-optimizer.js` provide template/preset slide generation.
- `masterSlides.js` manages master slide behavior.
- `background-3d.js` and `background-3d-integration.js` support live 3D slide backgrounds.

### Properties

The properties system is split across `frontend/js/properties/`: `panel.js` builds the panel shell, `panels/<type>.js` holds the section for each element type (for example `panels/text.js`, `panels/table.js`, `panels/animations.js`), and the remaining files cover selection, formatting, floating toolbars and layers. They are classic scripts loaded in order by `index.html`, with `init.js` last.

The properties panel exposes object-specific controls for geometry, colors, typography, bullets, numbered lists, charts, tables, connectors, images, videos, PDFs, HTML embeds, Mermaid diagrams, molecules, equations, sketches, slide notes, transitions, and animation configuration. It reads the selected object from the global state, writes changes back into that state, and requests rerendering where necessary.

### Text

`frontend/js/text/` is responsible for text authoring.

- `textContent.js` converts state content into rendered HTML and applies list transformations.
- `textSelection.js` preserves inline selections across toolbar interactions.
- `textLayout.js` supports text measurement and layout behavior.
- `text/document/TextDocument.js` normalizes semantic text documents, converts legacy HTML to structured blocks/runs, and renders semantic content back to HTML.

This layer is important because text content has to survive several representations: live editable DOM, sanitized HTML, normalized text documents, browser presentation mode, saved JSON, and PowerPoint export.

### Animation

`frontend/js/animations/` implements advanced object animations.

- `animation-engine.js` provides timeline-based playback and element state application.
- `animation-state.js` manages animation data structures.
- `animation-utils.js` contains helpers for interpolation and timing.
- `animation-presets.js` defines reusable animation effects.
- `animation-interaction.js` connects animations to editing and playback behavior.
- `animation-export.js` prepares animation data for export paths.
- Test/demo files exercise advanced animation behavior and regression cases.

The UI timeline is defined in `frontend/js/ui/timeline-editor.js`. It creates a bottom timeline panel with playback controls, time display, zoom controls, tracks, keyframe editing, and animation properties.

### Mermaid Diagrams

The Mermaid subsystem is one of the richer editor subsystems.

- `mermaid-engine.js` loads Mermaid, validates source, renders diagrams, caches SVG, and sanitizes output.
- `mermaid-dialog.js` owns the editing modal, preview, templates, visual/code/split modes, diagnostics, and insert/update behavior.
- `mermaid-graph.js` parses supported flowchart source into a graph model, stores node positions, and regenerates Mermaid source.
- `mermaid-object.js` integrates diagrams as normal canvas elements.
- `mermaid-document.js` and `mermaid-templates.js` provide document helpers and starter templates.
- `mermaid-export.js` handles SVG export.

Flowcharts can be edited visually while keeping Mermaid source synchronized. Other Mermaid diagram types still use the code/preview render path.

### Embeds and Specialized Objects

`frontend/js/embeds/` supports rich embedded content.

- `htmlEmbed.js` handles embedded HTML objects.
- `moleculeEmbed.js` integrates molecular visualization, backed by vendored NGL assets.

The drawing and sketch modules under `frontend/js/drawing/` and `frontend/js/sketch/` power freehand and whiteboard-style workflows. They include path simplification, rough/stroke rendering, history management, and export helpers.

### Export and Import

`frontend/js/export/export.js` contains browser-side export workflows. It works with libraries such as JSZip, html2canvas, jsPDF, FileSaver, and pptxgenjs. Browser exports include local packages, images, PDFs, SVG scenes, JSON, and related assets.

`frontend/js/export/importPptx.js` handles presentation import-related behavior where supported by the app.

The backend provides a separate PowerPoint export endpoint backed by `backend/slideforge/bridge/pptx_exporter.py`.

## Backend Architecture

The backend is a Django project under `backend/`.

`backend/pptmaker_backend/urls.py` wires together:

- Django admin at `/admin/`.
- API routes under `/api/`.
- The SPA shell at `/`.
- Development static serving for frontend JavaScript, CSS, assets, static files, vendored dependencies, and media.

`backend/slideforge/studio/` contains the application-specific Django app.

- `models.py` defines persistent presentations, revisions, and uploaded assets.
- `views.py` handles SPA serving, asset upload, slide cleanup, presentation CRUD, and PPTX export.
- `auth_views.py` handles registration, login, logout, and session status.
- `urls.py` maps the API endpoints.
- `tests.py` contains backend and source-level regression tests.

`backend/slideforge/bridge/` contains conversion, extraction, LLM, and export utilities. The most important file for deck output is `pptx_exporter.py`, which converts SlideForge's JSON state into PowerPoint slides.

## Backend Data Model

### Presentation

The `Presentation` model stores saved decks.

Key fields:

- `id`: UUID primary key.
- `owner`: optional Django user.
- `title`: display title.
- `presentation_theme`: selected theme id.
- `state_json`: full presentation state.
- `bridge_result_json`: optional result data from bridge/import/cleanup workflows.
- `source_pdf`: optional uploaded source PDF.
- `autosave_version`: monotonically increasing autosave version.
- `created_at` and `updated_at`.

### PresentationRevision

`PresentationRevision` stores historical snapshots.

Key fields:

- `presentation`: parent presentation.
- `version`: version number.
- `state_json`: saved state snapshot.
- `created_at`.

Revisions are ordered newest first and unique per presentation/version.

### Asset

The `Asset` model stores uploaded media.

Supported asset types include:

- image
- video
- pdf
- molecule
- export
- other

Assets may belong to a user and optionally to a presentation. Metadata is stored as JSON.

## API Surface

The application exposes these primary API routes under `/api/`:

- `GET /api/auth/session/`
- `POST /api/auth/register/`
- `POST /api/auth/login/`
- `POST /api/auth/logout/`
- `POST /api/assets/upload/`
- `POST /api/slides/cleanup/`
- `POST /api/presentations/`
- `GET /api/presentations/<presentation_id>/`
- `PATCH /api/presentations/<presentation_id>/`
- `DELETE /api/presentations/<presentation_id>/`
- `POST /api/presentations/export/pptx/`

The API is JSON-oriented except for upload and file-response endpoints. Presentation state is stored as JSON rather than normalized relational rows, which keeps the backend flexible as the editor's client-side schema evolves.

## Asset Uploads and Media Processing

The upload endpoint accepts several media categories, including images, videos, PDFs, and molecule files. The backend validates file extensions and stores files through Django's media storage.

Video uploads include a normalization path through `ffmpeg`. When possible, uploaded videos are transcoded to MP4 with browser-friendly settings. If transcoding fails, the backend attempts a fallback copy and records metadata describing whether the video was transcoded.

Images are processed with Pillow where needed. Molecule files use a dedicated extension allowlist so they can be loaded later by the molecular embed tooling.

## Slide Cleanup

Slide cleanup is exposed through `POST /api/slides/cleanup/`. The cleanup flow can use deterministic geometry rules and, when configured, an LLM provider through the bridge utilities.

The deterministic cleanup pass:

- Snaps positions to a grid.
- Detects near-center and near-edge alignment.
- Clamps elements inside slide bounds.
- Reduces overlaps between nearby elements.
- Returns targeted element updates rather than rewriting the whole slide.

The sanitization layer restricts cleanup output so only known element ids, dimensions, positions, and allowed style fields are applied. This protects the editor from malformed or overly broad cleanup responses.

## PowerPoint Export

PowerPoint export is implemented in `backend/slideforge/bridge/pptx_exporter.py` with `python-pptx`.

The exporter:

- Creates a PowerPoint presentation.
- Maps SlideForge page setup to PPTX dimensions.
- Applies theme defaults.
- Converts canvas coordinates into PowerPoint units.
- Renders text, shapes, tables, charts, images, diagrams, and supported rich content.
- Parses HTML text runs so inline bold, italic, underline, color, font family, and font size can be preserved where possible.
- Handles Mermaid SVG export paths when supported.
- Falls back gracefully where a browser-only feature cannot be represented exactly in PowerPoint.

Because SlideForge's editor model is richer than the PowerPoint object model, export is necessarily a translation layer. The goal is to preserve layout, readable content, styling, and presentation structure as faithfully as practical.

## Offline Dependency Strategy

The app is built to run without public CDN access. Third-party frontend dependencies are vendored under `frontend/vendor/` and referenced by local paths.

Vendored assets include:

- Browser JavaScript libraries such as Chart.js, Reveal.js, Tailwind, Three.js, Interact.js, JSZip, pptxgenjs, html2canvas, jsPDF, FileSaver, KaTeX, DOMPurify, Mermaid, and NGL.
- FontAwesome CSS, JavaScript, and webfonts.
- Fontsource packages for presentation/editor fonts.
- Reveal.js CSS, themes, plugins, and theme fonts.
- Local app image assets and favicon files.

Django serves the vendor directory during local development through:

```python
re_path(r"^vendor/(?P<path>.*)$", serve, {"document_root": settings.FRONTEND_DIR / "vendor"})
```

This route is important because browser strict MIME checking requires the server to return actual JavaScript and CSS files with appropriate content types. If `/vendor/` is not served, missing assets can return the HTML SPA shell instead, causing errors such as stylesheet MIME rejections, script MIME rejections, and `Reveal is not defined`.

## Security and Sanitization

SlideForge handles many user-editable rich content formats, so sanitization is a recurring concern.

The frontend uses DOMPurify for browser-side HTML sanitization. This is especially important for text boxes, embedded content, Mermaid SVG output, imported content, and clipboard operations.

The backend validates upload extensions, scopes presentation access to the owning user, and sanitizes slide cleanup updates. Authentication endpoints use Django's auth system. API views return structured JSON errors where possible.

The app still contains development-oriented behavior, such as Django `DEBUG` static serving and local SQLite defaults, so production deployment would need hardened settings, a real static/media pipeline, configured secret keys, allowed hosts, and a production web server.

## Presentation Mode

Presentation mode is built on Reveal.js. The editor state is rendered into Reveal-compatible slides, and the user can present with transitions, slide navigation, annotations, laser pointer behavior, chalk tools, and a presentation menu.

Presentation mode must preserve editor-authored content while changing the interaction model. That means the same slide elements need to be readable and visually faithful without exposing editing controls. Text formatting, lists, rich diagrams, animations, and embedded objects all need to survive the transition from editor canvas to presentation DOM.

## Testing and Quality Checks

The project includes several layers of verification.

Backend checks:

```bash
npm run check:backend
npm run test:backend
```

Frontend syntax checks:

```bash
npm run check:frontend
```

Browser smoke and functional checks:

```bash
npm run test:ui
npm run test:phase2
npm run test:animations
```

The UI smoke suite exercises editor boot, project UI, slide rail behavior, inserts, text formatting, bullets, numbered lists, multi-selection, modals, equations, paste handling, properties/layers/timeline/export panels, copy/paste, undo/redo, whiteboard mode, presentation mode, keyboard shortcuts, and browser console errors.

The phase2 functional suite covers deeper runtime concerns such as 3D background lifecycle, canvas cleanup, XSS injection resistance, event listener stability, promise rejection handling, and broad UI visibility checks.

## Design Characteristics

SlideForge is a dense editing application rather than a marketing site. The UI is optimized around repeated authoring work:

- A persistent toolbar keeps common commands available.
- A slide rail keeps deck structure visible.
- A central canvas gives direct manipulation of objects.
- A properties panel exposes detailed controls for selected objects.
- Modals are used for complex authoring tasks such as equations, Mermaid diagrams, symbols, icons, and project management.
- Workspace modes let the same app support slide editing, whiteboard work, timeline animation, and review-style workflows.

The design system uses local fonts, restrained panels, compact controls, icon-heavy command buttons, and theme-aware slide content. The product surface is meant to feel like an editor first.

## Important Engineering Tradeoffs

### Framework-Light Frontend

The frontend avoids a large application framework. This keeps the app simple to serve as static assets and easy to run through Django, but it also means global state, global functions, and manual DOM coordination are common. Engineering discipline is needed around state normalization, rerendering, event cleanup, and cross-module dependencies.

### JSON-Centric Persistence

Presentations are persisted as JSON blobs. This makes the data model flexible and lets the editor evolve quickly, but it shifts validation and migration responsibility into frontend state normalization and backend source-level tests.

### Rich Browser Features With Export Translation

The browser can render richer content than PowerPoint supports directly. Features such as Mermaid diagrams, HTML embeds, 3D backgrounds, sketch layers, and advanced animations need translation or fallback behavior during export.

### Offline Vendoring

Vendoring dependencies improves reliability for offline/local use and avoids CDN failure modes, but it increases repository size and requires deliberate dependency updates. Asset paths, MIME serving, export packaging, and font references all need to remain aligned.

## Current Operational Profile

SlideForge is best understood as a local development/editor app with optional authenticated persistence. It runs well from Django's development server, uses SQLite by default, serves static frontend files directly from the repository, and can perform browser-based testing with Playwright.

For production use, the same architecture would need:

- Static asset collection and cache strategy.
- A production database.
- Hardened Django settings.
- Media storage configuration.
- Authentication and CSRF review.
- Background job handling for expensive conversion/import workflows.
- Observability for export, upload, and cleanup failures.

## Summary

SlideForge combines a static, browser-heavy presentation editor with a Django API and export backend. The frontend owns the direct manipulation experience, rich object rendering, presentation mode, and browser exports. The backend owns persistence, authentication, uploads, cleanup, and server-side PowerPoint generation. The codebase is organized around practical editor subsystems: core state and commands, rendering, properties, text, animation, diagrams, embeds, drawing, export, and backend bridge utilities.

The result is a local-first presentation workspace that can create conventional slide decks while also supporting advanced authoring features such as Mermaid diagrams, semantic rich text, whiteboard tools, 3D backgrounds, molecule embeds, and timeline-based animation.

## Frontend script layout

The editor's large modules are folders of classic (non-module) scripts that share the page's global scope: `core/commands/`, `editor/render/`, `editor/slide-presets/` and `properties/`. `index.html` loads each folder's files in a fixed order, and each folder ends with an `init.js` that holds the statements that run at load time (listeners, installers, exports). Inside a folder, files may call each other's functions freely at runtime. Only `init.js` should run code at load time, because it is the one file guaranteed to load after the rest of its folder.
