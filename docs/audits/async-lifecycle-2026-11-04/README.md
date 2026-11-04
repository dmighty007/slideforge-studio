# Critical asynchronous and lifecycle audit — 2026-11-04

This pass follows the trajectory-viewer race fixes into project loading/saving,
media uploads, Mermaid rendering, video controls, and the exported HTML viewer.
It is a targeted correctness audit, not a claim that every app workflow passed.
All browser work used a disposable database and media directory under /tmp, on
port 8089. The user's project database and simulation files were not changed.

## Reproduced and fixed

| Defect | Trigger and consequence | Correction |
| --- | --- | --- |
| Late project open | Open A then B; A's slower response replaces B and its undo state. | Navigation generations guard adoption, post-load work and hydration cleanup. Both response orders are tested. |
| Late project creation | A project-creation response arrives after a different project is adopted; it replaces the current ID/version/title. | Check navigation generation and original project ID before and after asynchronous creation work; superseded callers do not claim success. |
| Inline-media upload retargeting | Reorder objects or switch projects while optimization uploads audio/video; the result overwrites whichever object now occupies an old array index. | Capture project context and source; resolve slide/object IDs at completion; ignore deleted/replaced sources and stale projects. Migration jobs are scoped to their project context. |
| Poisoned Mermaid render queue | Render an invalid sequence diagram, then correct its syntax; all subsequent renders inherit the old rejection. | Recover the queue before its next task while preserving each caller's failure. |
| Closed Mermaid dialog callbacks | Close a dialog while its preview or final render is pending; completion dereferences cleared dialog state. | Capture dialog-session identity, reject stale completions and stale validation results. |
| Overwritten manual diagram edits | Apply manual SVG or a synchronous semantic graph while an older Mermaid render is pending; the older result overwrites the newer view. | Each render decision invalidates prior work, including synchronous/manual paths; detached objects cannot commit async results. |
| Old video dashboard loops | Rebuild a video properties panel; old animation loops continue because a new panel reuses the same DOM ID. | Each loop verifies its own dashboard node and video remain connected. |
| Manual video pause undone | Pause an autoplay video, then synchronize media after a focus/resize event; playback restarts. | Autoplay runs on activation or when enabled, not every synchronization. Applied to editor and generated HTML viewer. |

## Validation

`npm run test:async-lifecycle` runs the dedicated browser regressions against
`SLIDEFORGE_TEST_URL` (default http://127.0.0.1:8089/). Use a disposable app instance.
The tests control completion ordering and real Mermaid rendering, inspect actual
project/state results, and count animation-loop rescheduling. The exported-viewer
case executes generated viewer JavaScript in a separate page. Optional
`ASYNC_TEST_FILTER` selects cases by name.

Additional checks for this pass:

- Dedicated asynchronous/lifecycle regressions: 10 passed.

- UI smoke suite: 22 passed.
- Focused existing regressions: 18 passed, covering diagram editing/reveal/export,
  molecule rendering/trajectory/settings, hidden-slide captures, HTML embed export,
  slide-size undo, animation behavior, presenter view, and audio presentation.
- Backend suites: 195 passed.
- Generated-fixture trajectory playback/slow-load suite: passed.
- Landscape usability and presentation lifecycle suite: passed.
- Frontend JavaScript syntax and diff whitespace checks: passed.

The initial unfiltered regression run sampled intermediate edits. It caught a
misplaced local-save guard introduced during this audit; that edit was corrected,
and the affected cases passed in a fresh browser. That run was stopped and is not
counted as a full-suite pass. A sharing/tunnel check also failed to reach its Create
button in the signed-out test setup; sharing/tunneling remains unvalidated by this
pass. No claim is made for the remainder of the 341-case full regression suite.
