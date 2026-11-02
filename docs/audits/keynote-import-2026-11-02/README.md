# Keynote import audit — 2 November 2026

Checked all **6 `.key` files / 99 slides** under `~/Downloads` recursively. All passed the actual backend converter and frontend `importKeynote` function without exceptions.

## Confirmed import losses

- **61 shapes omitted**, across five files. The converter reports these in `skipped`.
- **1 table omitted**, in `Your_Big_Idea…`, slide 19.
- **1 audio/media object omitted**, in `Image_JPG_PNG_Audio…`, slide 12. The converter labels it “sounds and movies in other formats.”
- **7 transitions silently discarded**, slides 1–7 of `Slide_Animations_Speaker_comments…`: dissolve, push, revolve, cube, reflection, fade through color, push. Frontend sets every slide transition to `none`; the backend does not include these losses in `skipped`.
- **3 build animations silently discarded** in `Image_JPG_PNG_Audio…`, on slides 11, 12.
- **67 text boxes lose middle/bottom vertical alignment** and start at the top. This is visible from the backend output versus frontend style mapping and is not reported in `skipped`.

## Per-file results

| File prefix | Slides in source tree / imported | Text | Pictures | Video | Reported skipped content |
|---|---:|---:|---:|---:|---|
| 36_Slides_Extra_Large | 36 | 32 | 75 | 0 | 9 shapes |
| Image_JPG_PNG_Audio… | 12 | 9 | 21 | 1 | 3 shapes, 1 sounds and movies in other formats |
| Mathematical_Equations | 10 | 11 | 9 | 0 | None |
| Science_Project | 11 | 19 | 5 | 0 | 10 shapes |
| Slide_Animations_Speaker_comments | 8 | 17 | 6 | 0 | 9 shapes |
| Your_Big_Idea | 22 | 58 | 44 | 0 | 30 shapes, 1 tables |

## Checks that passed

- No paragraph text changes detected between the converter’s output and browser import. This does not prove that every original Keynote object was converted.
- Notes preserved without change. `Slide_Animations_Speaker_comments…` has notes on slides 1–3.
- The media example imports one video. All 78 emitted media assets passed Pillow image verification or FFprobe stream inspection; validation errors: 0. Codec playback in the desktop app was not exercised.
- Filename slide counts are misleading: `Mathematical_Equations_11_Slides…` has 10 slides in the source slide tree; `Science_Project…10_Slides…` has 11; `Your_Big_Idea…21_Slides…` has 22. Their source-tree and imported counts agree.
- Existing Keynote test suite: **35 tests passed** (`.venv/bin/python backend/manage.py test slideforge.bridge.keynote --noinput`).

## Evidence and limits

[discrepancies.csv](discrepancies.csv) lists exact files, 1-based slide numbers and finding counts. [results.json](results.json) includes backend slide models, source hashes, skipped-content evidence and media validation. [browser-results.json](browser-results.json) records frontend exceptions, element counts, notes and text/alignment checks.

The frontend used the real `importKeynote` function with a stub upload response and UI callbacks. Media URLs were placeholders; no projects/assets were saved. HTTP upload, authentication, quotas, actual asset storage, editor rendering and desktop playback were not exercised against these six files. Existing unit tests cover parts of the endpoint separately. No Keynote reference renderer was available, so pixel-level fidelity and full original-text coverage remain unverified. The importer was not modified.

To reproduce, run `.venv/bin/python tools/audit-keynote-import.py`, followed by `node tools/audit-keynote-browser.cjs` (Playwright/Chromium required; `PLAYWRIGHT_MODULE` may point to an existing module).
