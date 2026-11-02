# Repeat audit comparison — 2 November 2026

Rechecked 201 decks and 3,184 slides. No deck or slide import exceptions.

Results are identical to the existing `pptx-import-2026-11-02/results.json`: **True**.

| Finding (affected slides) | 1 November | Latest rerun |
|---|---:|---:|
| background-picture-dropped | 2 | 1 |
| dropped-pictures | 45 | 42 |
| embedded-object-not-imported | 3 | 3 |
| inherited-artwork-not-imported | 445 | 0 |
| linked-video-outside-file | 0 | 1 |
| smartart-not-imported | 11 | 11 |
| text-not-found-in-import | 761 | 4 |
| transition-lost | 193 | 0 |
| video-playback-lost | 6 | 0 |

Counts are not all directly comparable: the current audit excludes timing-only transitions, checks embedded video separately from linked video, respects inherited-artwork visibility, and checks individual paragraphs instead of concatenated textboxes. The decrease in text findings therefore cannot all be attributed to importer fixes.

Remaining findings: 42 slides contain rejected picture references (including zero-byte source images), 22 decks use custom proportions mapped to presets, 11 slides contain SmartArt, 3 contain embedded objects, 1 loses its background image, and 1 references external video. Four slides have text review candidates; see the CSV for exact text and locations.

No transition-loss, embedded-video-loss, or wholly missing inherited-artwork layer findings were reported by the current checks. This does not establish pixel-level fidelity or detect partial artwork omissions.

Importer SHA-256: `4520818cf424362423aaf0fadba2907b331e67e5d8cb8e8480fb37ac81aec654`.
