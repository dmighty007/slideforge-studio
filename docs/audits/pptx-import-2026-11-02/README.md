# PowerPoint import audit — 1 November 2026

Source: `~/Documents/PPTx` (recursive). Audited **201 decks / 3,184 slides** using the working-tree version of `frontend/js/export/importPptx.js`.

Deck-level failures: **0**. Slide-level failures: **0**.

## Findings

Counts below are affected slide records, except aspect-ratio adjustments, which count decks. A slide can have multiple findings.

| Finding | Affected records | Decks |
|---|---:|---:|
| dropped-pictures | 42 | 11 |
| aspect-ratio-adjusted | 22 | 22 |
| smartart-not-imported | 11 | 11 |
| text-not-found-in-import | 4 | 4 |
| embedded-object-not-imported | 3 | 2 |
| background-picture-dropped | 1 | 1 |
| linked-video-outside-file | 1 | 1 |

Dropped picture instances by cause: empty source media (not new import loss): **60**, unresolved or missing media part: **3**, unsupported format: **7**, nonempty media rejected by browser decoder: **4**. Empty source assets are source-file problems, not demonstrated importer regressions.

## Interpretation

- `dropped-pictures`: the actual picture importer returned no element. Evidence names the shape and media part. Unsupported EMF/WMF, unresolved relationships, empty files, and browser decoding failures can cause this.
- `background-picture-dropped`: the background importer returned no image.
- `smartart-not-imported` / `embedded-object-not-imported`: source structures are present and the importer has no matching import branch. Any separate fallback picture may still be visible.
- `video-playback-lost` / `audio-playback-lost`: media references exist; the importer does not create playable media. A poster picture may remain. Some files contain multiple video markers for the same object; do not add these records to estimate distinct videos.
- `transition-lost`: the source has a transition element; the top-level importer assigns `presentationTransition: "none"`. Even a source transition containing only timing metadata is flagged.
- `motion-path-not-imported`: source motion animation exists; motion paths are unsupported.
- `aspect-ratio-adjusted`: the importer chooses the closest of 4:3, 16:9, or 16:10. Content scales uniformly into that preset; custom source dimensions are not retained.
- **Review candidates**, not confirmed visual defects: `text-not-found-in-import` compares normalized concatenated source textbox text against imported text/shape/table content. Bullet prefixes, fields and paragraph boundaries can cause false positives. `inherited-artwork-not-imported` counts non-placeholder objects on the referenced layout/master; these are not copied by the importer, but source visibility settings can suppress them too.

## Examples

- **smartart-not-imported** — `01_Evaluations_and_Thesis/Anual_Evaluation-2k25.pptx`, slide 2: {"count": 1}
- **smartart-not-imported** — `01_Evaluations_and_Thesis/DM_AE-2k25.pptx`, slide 2: {"count": 1}
- **smartart-not-imported** — `01_Evaluations_and_Thesis/DM_Rare.pptx`, slide 2: {"count": 1}
- **background-picture-dropped** — `01_Evaluations_and_Thesis/DM_AE-2k25.pptx`, slide 12: {}
- **dropped-pictures** — `01_Evaluations_and_Thesis/PreSynopsis_Final.pptx`, slide 19: {"items": [{"shape": "Google Shape;521;p44", "part": "ppt/media/image43.jpeg", "sourceBytes": 0, "reason": "empty source media (not new import loss)"}, {"shape": "Google Shape;523;p44", "part": "ppt/media/image43.jpeg", "sourceBytes": 0, "reason": "empty source media (not new import loss)"}]}
- **dropped-pictures** — `01_Evaluations_and_Thesis/PreSynopsis_Final.pptx`, slide 20: {"items": [{"shape": "Picture 3", "part": "ppt/media/image43.jpeg", "sourceBytes": 0, "reason": "empty source media (not new import loss)"}, {"shape": "Picture 9", "part": "ppt/media/image43.jpeg", "sourceBytes": 0, "reason": "empty source media (not new import loss)"}, {"shape": "Picture 12", "part": "ppt/media/image43.jpeg", "sourceBytes": 0, "reason": "empty source media (not new import loss)"}]}
- **dropped-pictures** — `01_Evaluations_and_Thesis/PreSynopsis_Final.pptx`, slide 21: {"items": [{"shape": "Picture 6", "part": "ppt/media/image43.jpeg", "sourceBytes": 0, "reason": "empty source media (not new import loss)"}]}
- **aspect-ratio-adjusted** — `02_Conference_and_Invited_Talks/Water Models in Molecular Simulations (1).pptx`, slide all: Source 1280 x 317.28608923884514 pixels; nearest preset selected
- **aspect-ratio-adjusted** — `06_Ice_and_Nucleation/TOC2.pptx`, slide all: Source 2160 x 720 pixels; nearest preset selected
- **aspect-ratio-adjusted** — `08_ML_Drug_Discovery/Copy of TRC_Component [2025-12-08].pptx`, slide all: Source 3456 x 4608 pixels; nearest preset selected
- **embedded-object-not-imported** — `08_ML_Drug_Discovery/KS_Bose_Fest (1).pptx`, slide 7: {"count": 2}
- **embedded-object-not-imported** — `08_ML_Drug_Discovery/KS_Bose_Fest (1).pptx`, slide 16: {"count": 2}
- **embedded-object-not-imported** — `11_Collab_LLPS_Droplets_and_Others/Experimental Condition C3ester coacervate_Sumit Pal.pptx`, slide 1: {"count": 2}
- **linked-video-outside-file** — `13_Journal_Club_and_Literature/MBC_MSM_baseline_talk [2026-03-24].pptx`, slide 12: {"count": 1}

## Evidence and scope

- [discrepancies.csv](discrepancies.csv): every finding, relative filename, 1-based slide number, and evidence.
- [results.json](results.json): per-deck dimensions, slide counts, imported element counts/types, errors and findings.
- Imports ran in headless Chromium through the real package/design/slide/picture/background import functions, with XML and media read from the original ZIPs. Picture decoding was exercised. Assets used a stub upload URL; no projects or assets were written to the application database. Imported slide models were inspected in memory, then discarded.
- This is a structural import audit, **not a pixel-by-pixel visual comparison**. No PowerPoint/LibreOffice reference renderer was available. Fonts, line wrapping, exact positioning, fills, chart styling, animation fidelity, and editor save/reload behavior are not certified. A deck without recorded findings is not guaranteed visually identical.
- Existing working-tree changes were retained; the importer itself was not modified by this audit.

## Reproduce

From the repository root, run `python3 tools/pptx-audit-server.py ~/Documents/PPTx`, then in another terminal run `node tools/audit-pptx-import.cjs docs/audits/pptx-import-2026-11-01`. The server binds only to `127.0.0.1:8767`. Playwright and its Chromium browser must be installed; `PLAYWRIGHT_MODULE` can point to an existing Playwright module. Run `python3 tools/summarize-pptx-audit.py` to regenerate the report and CSV. Stop the server after the audit.
