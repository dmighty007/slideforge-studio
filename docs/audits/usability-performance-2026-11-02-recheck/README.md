# Usability and performance recheck — 2 November 2026

**The two previously reported persistence defects did not reproduce in the focused rechecks. Editing performance improved substantially, with dense slides still slower.**

## Persistence results

- 301 objects on one slide: all 301 retained by `getPersistableState()`.
- 251 slides: all 251 retained.
- 5,001 objects / 2,001 slides: live and prepared-state counts remain intact, with an explicit “Not saved” limit warning. This verifies state preparation and the warning; these oversized payloads were not submitted to the server. The configured limits now match the backend: 5,000 objects per slide and 2,000 slides.
- Real API save/reload of 1, 50 and 200 slides preserved the project ID, slide counts, first/last note sentinels and expected object counts. No 200-slide blank-project reload was observed.
- **Three deliberate in-flight-save cancellation tests passed**: hold the first PATCH request, reload while it is pending, then verify the same project ID, recovered note and backend mode. This specifically exercises the previous race instead of relying on a fast save completing before reload.

Evidence: [state-limits.json](state-limits.json), [save-performance.json](save-performance.json), [reload-cancellation.json](reload-cancellation.json).

## Performance comparison

Same benchmark, host, headless Chromium and 1440×900 viewport. Initial render is one sample; insert/undo are medians of three samples, each followed by two animation frames. Times are milliseconds. These are observations, not a guaranteed responsiveness budget.

| Slides × objects | Render before | Render now | Insert before | Insert now | Undo before | Undo now |
|---|---:|---:|---:|---:|---:|---:|
| 1 × 10 | 29 | 30 | 103 | 94 | 38 | 33 |
| 10 × 10 | 67 | 34 | 122 | 97 | 53 | 50 |
| 50 × 10 | 411 | 138 | 266 | 100 | 135 | 59 |
| 100 × 10 | 1188 | 264 | 488 | 148 | 278 | 99 |
| 200 × 10 | 4069 | 520 | 1017 | 168 | 655 | 183 |
| 1 × 500 | 733 | 386 | 951 | 468 | 706 | 479 |

A 200-slide / 2,000-object deck now renders in about 0.52 s, and insertion takes about 0.17 s, compared with 4.07 s and 1.02 s previously. The dense 500-object slide remains a useful optimization target: insertion is about 0.47 s. This case is now within the raised persistence limit, although its save/reload was not tested here.

Five fresh-context startup samples: median **2678 ms**, versus 2722 ms previously. This includes network-idle waiting and is not an input-readiness/INP metric. No throttling was applied.

Real API save timing: 1 slides: 49 ms, 50 slides: 193 ms, 200 slides: 699 ms. Each slide contains ten synthetic text objects. These are individual samples.

Six viewport checks (1920, 1440, 1280, 1024, 768 and 390 px widths) detected no visible-control overflow, unnamed visible buttons by the text/title/aria-label heuristic, or visible controls below the audit’s 24px size screen. No browser page errors occurred during the benchmark.

## Tests rerun

- Backend: **172 passed**.
- UI smoke: **22 passed**.
- Targeted browser regressions: **16 passed / 0 failed**, covering the previously stale menu assertion, text/list editing, presentation restoration, diagram save/reopen, renaming, share access with launch-token protection, cross-project undo, slow autosave, and recovery after a blocked closing save.
- In-flight cancellation: **3 / 3 passed**.
- Persistence state-size cases: **4 / 4 retained their expected content**.

This was a focused recheck, **not a rerun of all 322 regression cases**, the 47 desktop tests, or every import fixture. Previous coverage remains documented in the [original audit](../usability-performance-2026-11-02/README.md). Native Qt interaction, physical touch, screen readers, other browsers, long-duration memory behavior, and real media-heavy deck performance remain unverified. No application source was edited during this recheck.

## Evidence and reproduction

The JSON files contain raw timings and outcomes; `backend.log`, `ui.log`, `regressions.log`, `limits.log`, `save.log` and `reload-cancellation.log` retain test output. Screenshots are saved beside this report. The app ran with a fresh temporary database and desktop launch-token protection.

Use `.venv/bin/python tools/run-audit-server.py` with a temporary `AUDIT_PORT` and `SLIDEFORGE_LAUNCH_TOKEN`, set `SLIDEFORGE_TEST_URL` to the launch URL, and run the audit scripts. `tools/audit-state-limits.cjs` accepts `AUDIT_LIMIT_CASES`; `tools/audit-reload-cancellation.cjs` repeats the deliberate pending-save reload three times. Browser scripts support `PLAYWRIGHT_MODULE`.

Source fingerprints at report generation:

- `frontend/js/core/state.js`: `c370ecce4c378b5c10d0537e06ce2dc8b70db21a39ceee11695390573a630619`
- `frontend/css/layout.css`: `ea598792901fd48928db0001811b3c41b13545345b692fa55e8dec8e44050f2f`
- `frontend/css/tailwind.css`: `9faca7fc0a3068ab028322e855963db6bff5c2397cba7a653e392b8b58df3b18`
- `frontend/js/core/pageSetup.js`: `87ba9c8cd936dab54ef839fa9ecd145a83ffce97288b015c7977f9f3ad13b47c`
- `tests/browser/test-regressions.js`: `470ffc0e2bbad0af290477bb08cc949c3492a3f423d7be8f9498be83a63ff3e9`
