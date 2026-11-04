# Commands and reproduction

Working directory: `/home/dm/Dibyendu/Projects/slideforge-studio`.
Date: 2026-11-02, Asia/Kolkata. Git HEAD: `5b01d2d06d0d0a298592fdc8df4a5d8112de2a9c`.
The working tree already contained README changes, hero assets, and changes to studio views/tests. This audit
adds only files in its own directory. Tests exercised that working tree, not a clean release tag.

## Tooling

Python 3.14.8 (`.venv/bin/python`), Django 5.2.18, Node 26.12.1, Chromium 148.0.7778.96,
Linux x86_64 (kernel 7.3.0-4-cachyos). Browser viewport 1600 × 1000 unless a suite overrides it.
An existing Playwright installation was reused; no dependencies were installed:

```bash
export PLAYWRIGHT_MODULE=/tmp/claude-1000/-home-dm-Dibyendu-Projects-slideforge-studio/55f6bbe6-9605-41e0-a01e-a8d8454c5b32/scratchpad/pw/node_modules/playwright
export NODE_PATH=/tmp/claude-1000/-home-dm-Dibyendu-Projects-slideforge-studio/55f6bbe6-9605-41e0-a01e-a8d8454c5b32/scratchpad/pw/node_modules
export SLIDEFORGE_TEST_URL=http://127.0.0.1:8094/
```

The package path above is environment-specific. Set it to another installed Playwright if unavailable.
No applicable AGENTS.md was found in the repository or its ancestor directories.

## Servers

Started in separate terminal sessions, using the existing isolation wrapper:

```bash
AUDIT_PORT=8094 .venv/bin/python tools/run-audit-server.py
AUDIT_PORT=8095 .venv/bin/python tools/run-audit-server.py
```

The wrapper prints the fresh `/tmp/sf-audit-*` data directory, migrates its database, and starts the server.
The primary run used `/tmp/sf-audit-ys3i4fa_` (see server.log if the generated name differs); the second server
was reserved for the existing test suites. Do not point these checks at an everyday desktop database.
Original server logs were `/tmp/sf-release-audit-server.log` and `/tmp/sf-release-firstlaunch-server.log`.
Localhost sockets and Chromium needed sandbox escalation; both were approved. The initial sandboxed socket
and Chromium launch failures are environment restrictions, not SlideForge failures.

## Existing checks

```bash
SLIDEFORGE_DATA_DIR=/tmp/sf-release-checks DJANGO_SETTINGS_MODULE=slideforge.desktop.settings .venv/bin/python backend/manage.py check
npm run check:frontend
PYTHONPATH=/tmp:backend DJANGO_DEBUG=1 DJANGO_SETTINGS_MODULE=sf-release-websettings .venv/bin/python backend/manage.py test slideforge.studio slideforge.bridge --noinput
PYTHONPATH=backend:tests/desktop SLIDEFORGE_DATA_DIR=/tmp/sf-release-desktop-unittest DJANGO_SETTINGS_MODULE=settings .venv/bin/python -m django test tests/desktop --noinput
SLIDEFORGE_TEST_URL=http://127.0.0.1:8095/ node tests/browser/test-start-screen.js
SLIDEFORGE_TEST_URL=http://127.0.0.1:8095/ node tests/browser/test-ui-smoke.js
SLIDEFORGE_TEST_URL=http://127.0.0.1:8095/ node tests/browser/test-animations.js
```

The web test command used `/tmp/sf-release-websettings.py`, preserved as initial-web-test-settings.txt.
For a repeat, use the checked-in equivalent with:

```bash
PYTHONPATH=docs/audits/release-presentation-2026-11-02:backend DJANGO_DEBUG=1 DJANGO_SETTINGS_MODULE=web_test_settings .venv/bin/python backend/manage.py test slideforge.studio slideforge.bridge --noinput
```

The first backend attempt mistakenly used desktop settings for web-auth tests (22 failures, 3 errors). The
correct web configuration passed all 184. The first start-screen attempt reused a nonempty project list
(6 passed, 6 failed); its isolated repeat passed all 12. The pytest command failed because pytest is absent;
the same desktop unittest cases then passed through Django's installed runner. These setup failures remain
in the logs and are excluded from product defect counts.

## Dedicated interactions

```bash
.venv/bin/python docs/audits/release-presentation-2026-11-02/make-fixtures.py
node docs/audits/release-presentation-2026-11-02/browser-audit.cjs
node docs/audits/release-presentation-2026-11-02/verification.cjs
node docs/audits/release-presentation-2026-11-02/focused.cjs
node docs/audits/release-presentation-2026-11-02/presenter-recheck.cjs
node docs/audits/release-presentation-2026-11-02/final-demo.cjs
```

These are evidence-producing audit probes, not CI regression tests. Run sequentially: later probes reopen the
six-slide deck created by browser-audit.cjs. They intentionally retain unsuccessful probe results. Read the
report for final dispositions rather than counting every probe failure as a product failure. Fast actions
sometimes reached controls before deferred event binding/focus completed. Request interception stalled
scripts in dynamically written presenter windows; the no-interception repeat passed.

## Export inspection

```bash
mkdir -p /tmp/sf-release-lo-pdf
libreoffice -env:UserInstallation=file:///tmp/sf-release-lo-profile --headless --convert-to pdf --outdir /tmp/sf-release-lo-pdf docs/audits/release-presentation-2026-11-02/evidence/demonstration.pptx
```

Python `pptx.Presentation` inspected native shape/chart types and values. PyMuPDF inspected PDF page count,
searchable text, and rendered page images. See export-inspection.json. The original demonstration exports
precede the final title cleanup; finished-demonstration.pptx, if present, is the final demo export.

The ZIP was extracted with Python zipfile into `/tmp/sf-release-offline`. offline-readme.cjs opens its
index.html as a file with Playwright `offline: true`. The viewer uses its own `#viewer-status`, not Reveal.
The script also opens `/tmp/sf-release-readme.html`: README.md rendered with installed MarkdownIt, HTML and
tables enabled, an 830px article, and a base URL pointing at this repository. This is a layout approximation,
not an actual GitHub rendering. Repeat the README render with the same widths before running:

```bash
.venv/bin/python docs/audits/release-presentation-2026-11-02/prepare-offline-readme.py
node docs/audits/release-presentation-2026-11-02/offline-readme.cjs
```

The PNG screenshots are direct captures. No screenshot contents were composited or retouched.
