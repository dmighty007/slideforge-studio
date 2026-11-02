# Usability and performance audit — 2 November 2026

**The app passes broad workflow checks, but has two high-priority persistence problems and substantial editing lag on larger decks.** No application source was changed during this audit. All interactive tests used temporary databases and test projects.

## Findings in priority order

### High: persistence silently truncates content

The real `getPersistableState()` path mutates the open model: a synthetic 301-object slide becomes 300 objects, and a 251-slide deck becomes 250 slides. The removed sentinel objects/slides are absent from the persisted result. No alert or limit-specific save hint appears. The backend accepts up to 2,000 slides and 5,000 objects per slide, so frontend/backend limits disagree.

Reproduce with `tools/audit-state-limits.cjs`; inspect [state-limits.json](state-limits.json). Source: `frontend/js/core/state.js`, constants near line 1022, slicing in `normalizeStateIds()` near line 1343, called by `getPersistableState()` near line 1879. This reproduction injects synthetic content into the app model; it does not simulate 301 successive mouse insertions.

Recommendation: reject excess content with an explicit, recoverable message, or support matching limits throughout. Persistence should not delete content from the live editor model.

### High: reload during pending autosave forgets the open project

A 200-slide, 2,000-text-object deck saved successfully. Reloading immediately after the explicit save reproduced a canceled autosave fetch, after which the app cleared its stored project ID and created a blank one-slide project. The original server record still contained all 200 slides. A control run with a seven-second settling delay had zero pending saves and reopened all 200 slides / 2,000 objects correctly.

Evidence: [immediate reload](save-recheck/save-performance.json), [settled control](save-settled/save-performance.json). The failure is a navigation/recovery problem; these tests do **not** show deletion of the original server record. The immediate-reload failure occurred repeatedly, including on a separate temporary server. Source: `_presentationRequest()` calls `markBackendUnavailable()` on a fetch rejection; that function removes `PRESENTATION_STORAGE_KEY`. A navigation cancellation can therefore change persistence mode and erase the project selection.

Recommendation: preserve the last project identity on transient/network/navigation failures, distinguish an aborted request from unavailable backend support, and recover pending edits within that project.

### Medium: editing work grows with deck size

The table uses wall time around real app commands followed by two animation frames. Values are milliseconds; switch samples: 5, insertion/undo samples: 3. Each row has one initial-render sample. Interaction columns show medians, not statistical percentiles.

| Slides | Objects per slide | Initial render | Switch | Insert text | Undo | DOM nodes |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 10 | 29 | 33 | 103 | 38 | 1,879 |
| 10 | 10 | 67 | 35 | 122 | 53 | 3,013 |
| 50 | 10 | 411 | 58 | 266 | 135 | 8,053 |
| 100 | 10 | 1188 | 95 | 488 | 278 | 14,353 |
| 200 | 10 | 4069 | 177 | 1017 | 655 | 26,953 |
| 1 | 500 | 733 | 41 | 951 | 706 | 10,863 |

The 500-object row is a synthetic stress case beyond the frontend persistence limit and is not evidence that such a slide safely saves. The final benchmark retained 500 objects after undo, but the separate persistence check confirms that saving exceeds the supported frontend limit. Small-sample timings are indicative, not a service-level guarantee. The earlier concurrent runs also show the same deck-size trend; raw data are retained.

Likely investigation targets, not proven CPU attribution: `renderSlidesFromState()` iterates every slide and element on redraw; slide previews also iterate the deck; undo serializes the entire editor snapshot. Plain JSON serialization was small compared with end-to-end editing latency. Profile rendering and thumbnail work before redesigning undo. Consider updating only the affected slide and lazily rendering previews.

## Automated test results

- Backend: **172 passed** (`manage.py test slideforge.studio slideforge.bridge`).
- Desktop: **47 passed**, using Django test discovery because pytest was unavailable. These exercise the launcher/settings helpers; they do not drive a native Qt window.
- Start screen: **12 passed**.
- Editor UI smoke: **22 passed**.
- Functional/3D suite: **PASS**, including creating and deleting 100 3D-background slides, background lifecycle, listener cleanup, rejection handling and basic UI checks.
- Regression suite: **321 passed / 1 failed / 0 unexecuted**, out of 322 named checks.

The first regression runner reached its 300-second harness limit after 59 passing cases. Remaining cases were resumed in three shards, each with a separate temporary app/database. Outcomes are deduplicated by test name in [regression-summary.json](regression-summary.json); reruns override prior outcomes. This is not a single uninterrupted full-suite run.

- Remaining failing test: **style: round 3: readable chart text, clear equation preview, true fill swatch, theme in the palette, chart toolbar, thumbnail menu** — menu: ["New slide after","Duplicate","Move up","Move down","Move to slide…","Hide slide when presenting","Delete"]. The assertion expects a six-entry thumbnail menu; the current seven-entry menu includes the valid “Hide slide when presenting” action. This is an outdated expected list, not a demonstrated UI defect.

The sharing test initially failed against a tokenless test server, where desktop middleware intentionally treats requests as the local user. It was rerun with a launch-token-protected server, matching normal desktop access control; consult the share recheck log for its result. This is a test-configuration difference, not proof of a production access-control defect. The HTML-export viewer case initially failed because the Node `jszip` module was unavailable; a temporary adapter to the repository’s bundled JSZip supplied the dependency, and the focused rerun passed. No test expectation or application behavior was changed to make the tests pass.

Covered workflow areas include new/open/delete projects, text and lists, shortcuts, drag/resize, undo/redo, charts/tables, diagrams, presentation restoration, export captures/HTML/PPTX payloads, project save/reopen, scientific plugins and recovery. See the logs for individual checks.

## Startup and responsive layout

Five fresh browser contexts: median navigation-to-network-idle/app-ready time **2722 ms**, range 2659–2741 ms. This deliberately includes Playwright’s network-idle wait and is not first-contentful-paint or input readiness.
Each startup fetched about **250 resources / 7.58 MiB** of encoded resource bodies from localhost. Fresh contexts reset browser cache/storage, but the OS and server cache are warm. No CPU or network throttling was applied.

Viewports checked: 1920×1080, 1440×900, 1280×720, 1024×768, 768×1024 and 390×844. No document-width overflow, unnamed visible buttons (using text/aria-label/title heuristic), or offscreen visible controls were detected on the initial editor screen. Screenshots at 1280, 768 and 390 pixels were visually inspected. This is not a complete accessibility or touch-gesture audit.


Initial measurements without an opacity check flagged collapsed zoom/AI controls. Those are screening artifacts and should not be reported as visible-control usability defects.

## Save/reload measurements

Real server round trips: 1 slide saved in about 51 ms and reloaded in 2.7 s; 50 slides saved in about 507 ms and reloaded in 3.2 s. The separate 200-slide settled control took about 5.2 s to save and 8.3 s to reload. Each slide contained 10 synthetic text objects; these are individual samples, not percentiles. Immediate 200-slide reload instead triggered the project-selection failure described above.

## Method, evidence and limits

Browser/host details: `{"url": "http://127.0.0.1:8085/", "chromium": "148.0.7778.96", "node": "v26.12.1", "platform": "linux", "arch": "x64", "cpu": "12th Gen Intel(R) Core(TM) i7-12700F", "logicalCpus": 20}`.

Primary performance data: [idle/performance.json](idle/performance.json). [First run](performance.json), [repeat](repeat/performance.json), and save/reload JSON files retain individual timings. Benchmarks use simple text/shape objects, not realistic image-heavy decks. There is no baseline from a prior release and no formal responsiveness budget supplied by the project.

Headless Chromium on Linux exercised the shared frontend against Django development servers with real local persistence. Native Qt rendering, physical touch input, screen readers, Safari/Firefox, GPU/video playback, slow disks, mobile hardware, long-duration memory leaks, and pixel-level PowerPoint/Keynote fidelity were not certified. Heap figures are sampled JavaScript heap only and do not establish total memory use or absence of leaks. Browser command timing includes JavaScript, rendering and frame scheduling; it is not an Event Timing/INP measurement.

Application-source SHA-256 fingerprints at report generation:

- `frontend/js/core/state.js`: `7f5da9d1909bebf871e1a0f9ad4c797b5704f15f1a02da9e677e61285ae31296`
- `frontend/js/editor/render/slides.js`: `e04892a5c47daa3f19bcdf5754e16cbc2940fc116a0eaf1d3cf52e26c5e421e7`
- `frontend/js/core/commands/elements.js`: `0a17004b71a310bb2613eaa54526619bf86e11dbccf51507e81afcd52fb99750`

Reproduce: run `.venv/bin/python tools/run-audit-server.py` (optional `AUDIT_PORT` and `SLIDEFORGE_LAUNCH_TOKEN` environment variables). This creates an isolated desktop-configured Django server with a temporary `SLIDEFORGE_DATA_DIR`; run the browser suites with `SLIDEFORGE_TEST_URL`, `tools/audit-usability-performance.cjs`, `tools/audit-save-performance.cjs` and `tools/audit-state-limits.cjs`. The audit scripts support `PLAYWRIGHT_MODULE`; the save benchmark also supports `AUDIT_SLIDES` and `AUDIT_SETTLE_MS`. Regenerate this report with `python3 tools/summarize-usability-audit.py`.
