# Release readiness and product presentation audit — 2026-11-02

**Assessment: suitable for a scoped research-user pilot; broader release claims need additional validation.**
The tested creation, scientific authoring, local persistence, import, and export paths work. Existing suites
passed 281 cases. A focus-related presentation issue was observed after molecular interaction. macOS/Windows
installation, native PowerPoint/Keynote playback, and broad import fidelity remain untested here.

This is an engineering audit and editorial assessment, not a study with first-time researchers. No application
code was changed. Existing README/assets and studio views/tests changes were preserved. The tested working tree
was based on `5b01d2d06d0d0a298592fdc8df4a5d8112de2a9c`; it included pre-existing modifications.

## Environment and scope

Linux x86_64, Python 3.14.8, Django 5.2.18, Node 26.12.1, headless Chromium 148.0.7778.96, 1600 × 1000.
The desktop Django configuration ran on localhost with a fresh database/media directory at
`/tmp/sf-audit-ys3i4fa_`; existing suites used a second isolated server at port 8095. Playwright, Chromium,
LibreOffice, Python-PPTX and PyMuPDF were already installed. No dependencies were installed.

[Commands and reproduction](COMMANDS.md) records commands, configurations, setup mistakes and tool limitations.
The [synthetic fixture generator](make-fixtures.py) creates redistributable examples; no private decks were copied.
The [demonstration deck](demonstration-deck.json) labels results as illustrative. It is a raw state snapshot;
the molecule content is embedded, but portable import of this JSON was not separately verified.

## Workflow matrix

Pass means only the stated assertions were observed. An untested subcase does not inherit a pass from its row.

| Workflow | Status | Observation and evidence |
|---|---|---|
| First launch, themed creation | Pass | No account required. Editorial deck created using the start screen. [Start](evidence/01-start.png), [themed deck](evidence/02-themed-deck.png), [12-case suite](start-screen-clean-tests.log). |
| Save, reload, reopen | Pass | Six-slide deck retained its project ID and slide count after reload and reopening. [Reopen](evidence/13-reopened.png), browser-results.json, “save deck” step. |
| Spreadsheet paste → chart | Pass | TSV paste through a ClipboardEvent populated three categories and values 12, 24, 38. This exercises the paste handler; OS clipboard integration was not tested. [Pasted chart](evidence/03-chart-pasted.png). |
| Chart value editing | Pass | Changed 24 → 31; both persisted chartData and Chart.js rendered data matched. Later local-only edit changed the first value to 15. [Edited chart](evidence/04-chart-edited.png), browser-results.json. |
| LaTeX add/edit | Pass | Inserted Michaelis–Menten expression, reopened and changed subscript; equation rendered and exported as a picture. [Equation](evidence/06-equation.png). |
| Local molecular view | Pass, scoped | Synthetic water XYZ rendered; drag changed the view in editor and presentation. This does not validate protein ligands, trajectories, or every supported file format. [Before](evidence/40-molecule-present-before.png), [after](evidence/41-molecule-present-after.png). Representation-style editing on an existing interactive iframe was not successfully verified. |
| Scientific plot add/edit | Pass, scoped | Curve-fit plugin inserted; data changed and model switched to Michaelis–Menten. Fit displayed Vmax ≈ 0.999, Km ≈ 10.1. Numerical accuracy across models was not independently validated. [Plot](evidence/34-finished-fit.png), verification-results.json. |
| Mechanism add/edit and builds | Pass, scoped | Mermaid source edited; branch-reveal presentation produced distinct before/after DOM and screenshots. [Before](evidence/24-build-before.png), [after](evidence/25-build-after.png). Every animation effect was not individually exercised. |
| Position and size | Pass | Explicitly committed X=100, Y=160, W=850, H=430 persisted. Initial immediate changes preceded deferred binding; settled recheck passed. [Geometry](evidence/18-geometry-recheck.png), verification-results.json. |
| Duplicate, undo, redo | Pass | Ctrl+D increased count by one; undo/redo restored expected counts; final undo removed duplicate. browser-results.json, “duplicate chart” step. |
| Presenter notes | Pass | Without request interception, presenter displayed slide 2/6, current/next previews and the exact notes. [Presenter](evidence/39-presenter-no-routing.png), [results](presenter-recheck-results.json). |
| Escape after molecular interaction | Fail | Slideshow remained active after Escape while focus was in the molecular viewer. [Evidence](evidence/45-escape-after-molecule.png), [reproduction results](final-demo-results.json). See F1 below. |
| Synthetic PowerPoint import | Pass, scoped | Two slides imported through the file chooser. Text, native chart, table, cropped image, notes and fade transition appeared in imported state. [Import](evidence/35-import-pptx.png), focused-results.json. |
| Synthetic Keynote import | Pass, scoped | Three-slide synthetic IWA file imported via chooser; styled text, image, speaker notes and backup-slide text were present. [Import](evidence/35-import-key.png), focused-results.json. Source is generated using the reader's test schemas, so this is not independent proof of real Keynote fidelity. |
| Complex imported media/builds | Untested | No independent corpus of real application-authored templates, SmartArt, videos, audio and builds was exercised in this session. Previous audits are separate evidence. |
| Editable PowerPoint export | Pass, scoped | Six-slide output contained 1 native chart, 12 text boxes, 18 auto shapes and 4 pictures. Native chart categories/values matched 15,31,38. Equation/diagram/plot/molecule exported as pictures. [Inspection](export-inspection.json), [PPTX](evidence/demonstration.pptx). Export of an authored editable table was not separately checked. |
| Open exported PPTX in another viewer | Pass, scoped | LibreOffice opened and rendered six pages. [Log](libreoffice.log), [plot render](evidence/libreoffice-slide-5.png), [molecule render](evidence/libreoffice-slide-6.png). Actual edits in Microsoft PowerPoint remain untested. |
| Searchable PDF | Pass, scoped | Six pages opened/rendered; authored slide text was searchable. Chart/plot labels rendered into pictures were absent from extracted text. [PDF](evidence/demonstration.pdf), [inspection](export-inspection.json). |
| Offline web export | Pass, scoped | Extracted ZIP opened as a local file in Chromium with offline=true. Six slides present; ArrowRight changed counter 1/6 → 2/6; no JS errors or HTTP requests. [Viewer](evidence/36-offline-web.png), [results](offline-readme-results.json), [ZIP](evidence/demonstration.zip). Exhaustive animation/media playback remains untested. |
| Local-only editor operation | Pass, scoped | Main audit blocked non-local browser HTTP traffic. Chart/equation/diagram authoring and local saving worked without external browser dependencies. This retains the local server; it does not simulate server loss. |
| Install/update/uninstall across OSes | Untested | Existing installation was not replaced. Fresh Linux/macOS/Windows installation, desktop shortcuts, updates and uninstall were not executed. |

## Existing verification

| Check | Result | Evidence |
|---|---|---|
| Django system checks | Pass, no issues | [Log](backend-check.log) |
| Frontend syntax checks | Pass | [Log](frontend-check.log) |
| Studio/bridge web tests | 184 passed | [Log](backend-web-tests.log) |
| Desktop tests through Django runner | 56 passed | [Log](desktop-django-tests.log) |
| First-launch suite on pristine database | 12 passed | [Log](start-screen-clean-tests.log) |
| UI smoke suite | 22 passed | [Log](ui-smoke-tests.log) |
| Animation suite | 7 passed | [Log](animation-tests.log) |

The animation suite mostly checks initialization, handlers and visibility restoration; its seven passes are
not seven complete user animation scenarios. The desktop unit tests do not prove a native Qt window works.

Initial configuration and selector errors remain in the raw logs for transparency. Desktop settings were
incorrect for web-auth tests; the first launch suite initially used a nonempty list; early probes used wrong
control names, unsynchronized focus, or a nonexistent command-palette entry. A routed popup stayed in the
loading state with its script unavailable; the no-routing recheck passed. These are not counted as confirmed
product defects. See [COMMANDS.md](COMMANDS.md).

## Findings ranked by severity

### F1 — Medium: Escape does not leave the presentation after molecular drag

1. Open the molecular slide in the synthetic six-slide deck.
2. Start presentation, drag the molecule, release the mouse.
3. Press Escape.

Expected: Escape leaves presentation as it does when the main document has focus.
Observed: `play-mode-active` remained true; the slide rail stayed hidden. Reproduced on two no-routing browser
runs. The molecule iframe had received pointer focus. [Screenshot](evidence/45-escape-after-molecule.png),
[script](final-demo.cjs), [results](final-demo-results.json).

This can interrupt a live talk. Investigate keyboard forwarding from the molecular iframe to the presentation
controller. Workaround verified: click outside the molecule, then press Escape; presentation exits normally.
The presentation-menu click also encountered an overlay hit-testing failure in the headless run; treat that
secondary symptom as a follow-up investigation, not an independently confirmed general menu failure.

### F2 — Medium, product communication: compatibility claims exceed demonstrated coverage

The “Bring your decks” paragraph reads as comprehensive preservation of templates, transitions, builds and
media. This session verifies two synthetic files, not that breadth. Keep the existing caveat prominent and
publish tested combinations/known losses beside the claim. The Keynote test shares schemas with the importer,
which further limits its independence.

### F3 — Low, product communication: absolute reliability and performance wording

“Saving never drops slides” is an absolute guarantee. “Several times faster” has no baseline in this session.
Replace the guarantee with the concrete reliability improvement and link reproducible benchmark results for
speed claims. This audit found no saving loss; it cannot establish that saving never loses data.

### F4 — Low, visual presentation: screenshot freshness and density

The hero uses the older editor screenshot, whose insert toolbar displays tools individually. The current
1600px editor collapses categories into menus and exposes more explicit chart actions. The hero remains a real
screenshot, but should not be presented as the current release UI. At an 830px README image width the toolbar
and plot annotations are small. The side-by-side molecule and diagram images are only 407px wide. A single
full-width feature image communicates more clearly than asking those small panels to explain controls.

No high/critical defect was confirmed in the tested scope. This is not an assertion that none exists.

## README claim assessment

| Claim | Evidence/disposition |
|---|---|
| Free desktop app, no account | No-account local workflow verified. Pricing/license wording not independently reviewed. |
| Build figures directly on slides | Verified for chart, equation, curve fit and Mermaid; local molecular rendering/rotation verified. |
| Editable PowerPoint | Native chart/text/shapes verified structurally and opened in LibreOffice. Specialized visuals are pictures, consistent with the export caveat. Do not imply scientific plugins become editable PowerPoint plots. |
| Searchable PDF | Authored text searchable. Rendered chart and scientific-figure labels are images; qualify this when describing figure searchability. |
| Offline web presentation | Local-file playback/navigation verified with networking disabled. Do not infer full interactivity/media parity. |
| All listed molecule formats/ligands/trajectory behavior | Only a synthetic XYZ molecule was exercised. Remaining formats and ligand/ion behavior untested. |
| Fonts downloaded from Google Fonts | Untested; external dependencies were blocked in the main browser probe. |
| Import templates, SmartArt, charts, media and builds | Only a synthetic subset verified. Requires independent real-file and source-viewer comparisons. |
| Sharing links | Not exercised in this session. |
| Platform installers and self-updating | Not exercised. |
| 200-slide performance improvement | Not benchmarked in this session. |

The README clearly identifies its audience, differentiator and install action. Its primary action is easy to
find, but execution still requires a terminal. A new user's confidence in the shell installation and the
install success rate need observation with actual first-time users. The in-app start-screen copy and HTML
metadata still emphasize a generic polished/AI-powered presentation builder, which weakens continuity with
the science-specific README pitch.

## Visual evidence and promotional assets

These are unaltered captures, not mockups. Prefer the final clean chart/fit images when present:

- [Finished chart editor](evidence/42-chart-clean.png): real editable values and a readable illustrative title.
- [Finished curve-fit editor](evidence/44-fit-clean.png): scientific workflow and fit parameters.
- [Molecular presentation](evidence/40-molecule-present-before.png): simple geometry, not a protein demonstration.
- [Presenter view](evidence/39-presenter-no-routing.png): synchronized notes and next slide.
- [README desktop](evidence/37-readme-desktop.png) and [mobile](evidence/38-readme-mobile.png): MarkdownIt layout
  approximation, not screenshots of GitHub. At 390px the local render had no horizontal overflow.

The 17.4-second [workflow recording](evidence/workflow-demo.webm) captures molecular interaction followed by chart editing,
presentation and PowerPoint export. The run completed without JavaScript errors; see final-demo-results.json. Earlier recordings (archived under `/tmp/sf-release-raw-recordings`) contain audit waits and
failed probes and should not be promoted as polished product demos. The finished run completed all recording steps.
The audit exports precede final title cleanup; the newer JSON and finished-demonstration.pptx are separate
snapshots, not byte-identical source/output comparisons.

Still missing before a marketing launch:

1. A current, full-width hero with a finished scientific slide and deliberate pointer placement.
2. A protein/ligand demonstration with redistributable source data, not just a three-atom molecule.
3. A captioned 30-second edit-to-export video suitable for silent playback; the raw audit recording needs editing.
4. A native Microsoft PowerPoint side-by-side check showing what remains editable.
5. Fresh-install screenshots and verified instructions for Linux, macOS and Windows.
6. A downloadable, curated research example deck with source data and explanatory notes.

## Five highest-impact improvements before promotion

1. Resolve and regression-test keyboard focus after molecular interaction during a talk.
2. Validate installation and export in the actual target OSes/viewers; publish a concise compatibility matrix.
3. Refresh the hero and create a captioned workflow demo using the current interface and clearly illustrative data.
4. Qualify import, reliability and PDF searchability claims; connect speed claims to measured baselines.
5. Observe a small group of first-time researchers completing install → first figure → export. Align start-screen
   and page metadata with the science-specific pitch, then measure where those users get stuck.

## Practical limits

No native Microsoft PowerPoint, Apple Keynote or Qt desktop window was exercised. No real-user usability study,
accessibility audit, exhaustive statistical validation, performance benchmark, multi-hour session, security
review, or every built-in plugin/format test was performed. The native app's system webview may differ from
Chromium. Font availability and rendering can vary across target machines. All conclusions apply to the
specific working tree and fixtures above.
