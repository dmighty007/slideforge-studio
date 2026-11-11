# Stability and performance audit — 11 November 2026

Baseline: `50e6b5d` on `perf/incremental-render`, with the working-tree fixes described below. Tests used disposable databases and generated fixtures; user projects and `experiments/` were not changed. Nothing was committed, merged, or pushed.

## Result

All 344 main regression cases were exercised across four isolated databases. The initial run had 339 passes and five failures. The failing cases pass targeted reruns after fixing text editing/redraw behavior, accounting for the project-tab strip in the responsive-header test, and testing sharing with the launch-token protection used by the desktop launcher. The 33 affected text/selection regressions also pass on the final renderer.

The application did not crash during the deck-size or repeated-redraw/tab-switch soak. No detached Chart.js instances or growing renderer counts were found. Performance still has a significant first-edit stall on large mixed decks, documented below; this audit is not a claim of uniformly smooth interaction.

## Stability checks

| Area | Result |
| --- | --- |
| Web backend / API / bridge | 197 tests passed |
| Desktop launcher and desktop API | 65 tests and 3 subtests passed |
| Main browser regressions | 344 cases exercised; all have passing latest results after targeted reruns |
| Text, selection, lists, formatting | 33 focused regression cases passed |
| Async lifecycle | 12 cases passed, including immediate typing and command-replaced text |
| UI smoke | 25 checks passed |
| Launch screen | 12 checks passed on its required empty database |
| Incremental/deferred rendering | Passed: unchanged-node retention, undo object ownership, equivalence to full redraw, thumbnail bounds, chart cleanup, presenter previews, molecular thumbnails, unfocused audience window |
| Project tabs and project library | Passed: independent state/history, persistence, save failures and tab closing |
| Animation engine and completion | Both suites passed |
| Functional churn | Passed, including creation/deletion of 100 animated-background slides |
| Landscape / Wigner / touch usability | All three suites passed, including image/PDF/PPTX exports and cleanup |
| Molecular trajectories | Passed actual-coordinate, seek, playback, failure and lifecycle checks |
| PowerPoint import fixture | Passed: 6 slides, 11 formatted text boxes, no reported errors |
| Shared viewer with desktop launch token | Passed: phone sizing, saved updates, revocation, and editor API denied to viewer |
| Recorder / presenter / slide audio | 11 cases passed, including delayed-fullscreen startup and actual recorded audio |
| Frontend syntax and Django system checks | Passed |

The recorder originally timed out intermittently before the startup fix; the [before-fix diagnostics](evidence/show-recorder-before-fix.log) and [final 11-case pass](evidence/show-recorder-fixed-final.log) are retained.

The [latest regression map](evidence/regression-latest.json) identifies the passing log for each case. Initial shard logs retain the failures instead of concealing them.

## Bugs fixed

1. **An immediate first character could be dropped.** Text editing deferred focus/caret placement to an animation frame. A deterministic test holds that frame and checks that typing is accepted immediately, then continues after callbacks are released. Focus/caret placement now happens synchronously; deferred word selection cannot overwrite newly typed content.
2. **A redraw could preserve an editor whose text had been replaced in the model.** The stale DOM could then be committed over replacement text. The renderer now preserves the editor when its content agrees with state and discards stale editor content without committing it. Grouped text and attached connectors survive the tested layout changes.
3. **Skipping the recorder countdown could race presentation startup.** In failing runs, the sound was loaded and the window focused, but the slide index remained 0 after Next: asynchronous startup could reset navigation. Recording now awaits presentation startup and the three scheduled frames that place the slide and initialize animation state. A new test deliberately holds the fullscreen promise while skipping the countdown.

The test harness also now restores the real Projects handler after suppressing the automatic launch screen, waits for persistence hydration before seeding the smoke fixture, dismisses optional update notices through their UI, and resets cached project state before testing two network opens. Regression sharding is optional and validates its index/count; each shard requires a separate server/database.

## Performance measurements

Linux; Chromium 148.0.7778.96, headless, viewport 1440 × 1000; Intel Core i7-12700F, 20 logical CPUs; Node 26.13.0 and Python 3.14.9. Browser suites were finished before the benchmark ran. Timings are local measurements, not portable speed guarantees.

Eight configurations: 10/50/100/200 slides, each with five text boxes per slide. Mixed decks additionally contain one chart, one scripted HTML embed and one animated background on every slide. Each configuration measured one initial synchronous render, 20 edits and 20 navigation jumps. No network autosaves occur inside those rendering samples. Raw timing arrays are retained in [performance-final.json](evidence/performance-final.json). Percentiles use nearest rank; the median averages the middle pair.

All times below are milliseconds. Heap is JavaScript heap after forced garbage collection, in MiB.

| Deck | Slides | Initial render | Edit median | Edit p95 | Edit maximum | Heap MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| text | 10 | 8.4 | 4.4 | 6.3 | 9.2 | 9.3 |
| text | 50 | 23.1 | 8.7 | 10.5 | 17.6 | 10.1 |
| text | 100 | 50.9 | 13.6 | 17.8 | 31.8 | 10.8 |
| text | 200 | 93.3 | 24.1 | 25.9 | 56.9 | 12.2 |
| mixed | 10 | 46.0 | 9.2 | 15.2 | 38.5 | 17.4 |
| mixed | 50 | 155.5 | 14.8 | 22.9 | 136.7 | 34.8 |
| mixed | 100 | 317.2 | 19.0 | 27.4 | 273.9 | 54.2 |
| mixed | 200 | 649.4 | 37.5 | 44.4 | 576.8 | 93.3 |

**Remaining bottleneck:** the first measured edit rebuilt every slide (200/200 in the largest decks), while the median subsequent edit rebuilt one. The 200-slide mixed deck took about 649 ms for its initial synchronous render and 577 ms for its slowest edit. Its median edit-to-two-animation-frames time was about 101 ms, with a maximum of 787 ms. This includes scheduling, layout and painting opportunities and is not equivalent to the synchronous render time. Further work should address delayed sizing/cache invalidation and the initial cost of offscreen charts/backgrounds. Timings show deck-size growth, not exponential degradation during the tested repeated workload.

In the 200-slide mixed deck, 214 chart instances remained: 200 full-slide charts plus 14 nearby thumbnail charts. Thus chart initialization/memory still scales with the entire deck, despite thumbnail virtualization. Exactly one HTML document was loaded for the main deck and one background animated. The rendering tests did not load large remote molecular datasets or real remote video streams.

## Soak results

- 200 redraws in five batches of 40 on the 200-slide mixed deck; each batch retained 214 charts, 14 thumbnails, one live HTML embed and one animated background. Detached charts: zero throughout.
- Retained JavaScript heap changed by **−0.19 MiB** after forced GC. DOM documents decreased from 254 to 218; nodes from 25,844 to 25,308; event listeners from 20,440 to 20,242. These are bounded-workload observations, not a proof of leak freedom.
- 60 switches across six saved 10-slide projects, with notes changed between switches. All project contents and final notes were verified through the persistence API. Median switch-to-frame time: **59.5 ms**; p95: **61.7 ms**; maximum: **62.9 ms**.
- Seven cached sessions, including the original benchmark project, reduced to one after closing inactive tabs. No detached charts remained and no page errors were captured.

Heap figures exclude GPU surfaces, native allocations and whole-process RSS. Desktop Qt WebEngine and Windows/macOS native shells were not exercised. WebKit was installed but could not launch because `libicu74` and `libflite1` are missing; cross-engine stability remains unverified.

## Reproducing

Use a disposable desktop-configured backend; these tests create, save, delete and change projects/plugins. `tools/run-audit-server.py` creates a temporary data directory. The launch-screen suite requires its own empty database. Set `SLIDEFORGE_NO_UPDATE_CHECK=1` for general suites, and set a temporary `SLIDEFORGE_LAUNCH_TOKEN` plus the corresponding `?token=...` launch URL when verifying shared-viewer API isolation.

```sh
SLIDEFORGE_TEST_URL=http://127.0.0.1:8076/ npm run test:render-performance
SLIDEFORGE_TEST_URL=http://127.0.0.1:8076/ SLIDEFORGE_PERF_OUTPUT=/tmp/performance.json npm run test:performance-soak
SLIDEFORGE_TEST_URL=http://127.0.0.1:8076/ npm run test:async-lifecycle
SLIDEFORGE_TEST_URL=http://127.0.0.1:8076/ npm run test:ui
SLIDEFORGE_TEST_URL=http://127.0.0.1:8076/ npm run test:recorder
```

For parallel regressions, set `SLIDEFORGE_TEST_SHARD_COUNT=4` and a distinct zero-based `SLIDEFORGE_TEST_SHARD_INDEX` from 0 to 3, each pointed at its own disposable server.
