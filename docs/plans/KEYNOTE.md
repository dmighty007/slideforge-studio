# Plan: Keynote (.key) support

Branch: `feature/keynote-support`. Status: plan only, nothing built yet.

Goal: someone with a Keynote deck can open it in SlideForge, and a SlideForge deck can get back into Keynote, with
as much of the content kept as is practical.

## What we are dealing with

- **Modern .key (Keynote 6, 2013, to today):** a zip file (or, when saved as a package, a macOS folder) holding
  - `Index/*.iwa`: the document itself. Each file is Snappy-compressed in Apple's own chunk framing (a `0x00` byte, a
    3-byte length, no checksums), and inside are Protocol Buffers messages (`KN.*` for Keynote, `TSWP.*` text,
    `TSD.*` drawables, `TST.*` tables, `TSCH.*` charts, `TSP.*` the object store). Objects refer to each other by id.
  - `Data/`: images, movies and fonts, stored as the original files.
  - `preview.jpg` and `Metadata/` (`Properties.plist`, document id).
- **Keynote '09 and older:** a zip or folder with `index.apxl` (XML, sometimes gzipped). Rare today.
- **No public specification.** The message schemas come from reverse engineering. The reference is
  [keynote-parser](https://github.com/psobot/keynote-parser) (MIT), which ships schemas taken from Keynote 14.4
  and 14.5. Apple changes the schemas with Keynote releases; protobuf ignores fields it does not know, so reading
  mostly survives a new version, but object type numbers can move.
- **Writing .key** means producing a document Keynote accepts with schemas we do not own. Not realistic. Keynote
  opens .pptx, and SlideForge already exports it.
- **Where import runs today:** PowerPoint import is client-side (`frontend/js/export/importPptx.js`, JSZip). It
  produces editor state, then `startNewProjectForImport()` and `uniqueImportTitle()` in
  `frontend/js/core/commands/export-import.js` make a project of it. Keynote import should produce the same state.

## Approach

Two routes, built in this order. Each is useful alone.

### Phase 1: through Keynote itself (macOS with Keynote installed)

Highest fidelity for the least code, because Keynote does the conversion.

- Desktop app only. A local endpoint takes the uploaded .key, runs Keynote by JavaScript for Automation
  (`osascript -l JavaScript`: open the file, export it as Microsoft PowerPoint to a temp folder, close it), and
  returns the .pptx. The browser then runs the existing PowerPoint importer on it.
- The reverse for export: SlideForge's .pptx is opened in Keynote and saved as .key ("Export → Keynote" appears
  only when Keynote is present).
- Details to handle: macOS asks once for permission to control Keynote (explain it in the UI before the first
  call); time limit and clean-up of temp files; Keynote may already be open with unsaved work, so open and close
  only our own document; password-protected decks fail with a clear message.
- Detection: `mdfind "kMDItemCFBundleIdentifier == 'com.apple.iWork.Keynote'"` or `/Applications/Keynote.app`.

### Phase 2: native reader (every platform)

Server-side Python, in a new `backend/slideforge/bridge/keynote_import.py`. The server is always there (desktop
and web), it can store the `Data/` media directly, and the schemas exist as Python protobuf code.

1. **Open safely:** zip size and file-count limits, no paths outside the archive, accept a zipped package folder.
   Detect Keynote '09 (`index.apxl`) and say it is not supported (or add it later, see open questions).
2. **Decode IWA:** our own chunk reader (about 40 lines) plus Snappy decompression, then protobuf parsing into an
   object table by id.
3. **Walk the document:** `KN.DocumentArchive` → show → slide tree → slides, in order; slide size; hidden slides
   kept and marked hidden.
4. **Map to SlideForge elements**, most common first:
   - text boxes and placeholders (title, body): text with runs (font, size, colour, bold, italic, underline),
     paragraph alignment, bullets;
   - pictures and movies from `Data/` (stored as media like uploads; cropping/masks where simple);
   - shapes (preset geometry, fill, line), lines and arrows, groups, rotation, opacity, z-order;
   - presenter notes; slide background (colour, gradient, picture);
   - tables (cell text, merged cells, basic fills);
   - charts: data into a SlideForge chart where the type matches, otherwise the chart's picture if one is stored;
   - builds and transitions: map the common ones (appear, dissolve, move in) to SlideForge animations, drop the rest.
5. **Report:** anything not understood becomes a placeholder or is skipped, and the import ends with a short summary
   ("2 charts came in as pictures, 5 builds were left out").
6. **Fail softly:** one unreadable object never stops the import; an unknown Keynote version still tries, and warns.

New dependencies (pure wheels on all platforms): `protobuf`, and `cramjam` for Snappy (has wheels everywhere;
`python-snappy` sometimes builds from source). The generated schema modules we need (KN, TSP, TSD, TSWP, TSS, TSK,
TST, TSCH) are vendored from keynote-parser and credited in `THIRD_PARTY_NOTICES.md`, rather than depending on
keynote-parser itself (it pulls in PyYAML, tqdm, colorama, future, and refuses unknown versions).

### Phase 3: in the app

- File pickers accept `.key` (`application/vnd.apple.keynote`, `application/x-iwork-keynote-sffkey`).
- Start screen: "Keynote" next to "PowerPoint"; command palette entry; drag and drop of a .key file.
- Route: macOS with Keynote → Phase 1 (with an option to use the built-in reader instead); everything else →
  Phase 2. Progress while importing, then the summary.
- Export: "For Keynote" saves the .pptx (Phase 1 adds a real .key on Macs with Keynote). Check how Keynote shows
  our .pptx (fonts, equations as pictures, animations) and fix what comes out wrong.
- Docs: README and `docs/DESKTOP.md` list Keynote under importing, with what is kept.

## Testing

- **Fixtures:** 8 to 10 small decks made in Keynote 14 and 13 (text and bullets, pictures, shapes, a table, a
  chart, builds, notes, a custom theme, a package-folder deck, a password-protected deck, a Keynote '09 file).
  Made by us, so they can live in `tests/`.
- **Unit tests:** IWA chunk decoding, object table, each element mapping, the summary.
- **Safety tests:** zip bomb, path traversal, truncated and corrupt chunks, huge object counts.
- **Phase 1:** `osascript` mocked in CI (GitHub's macOS runners have no Keynote); a manual check list for a real Mac.
- **Round trip:** SlideForge → .pptx → Keynote → .key → SlideForge keeps text, pictures and slide order.

## Order of work and size

| Step | Work | Rough size |
| --- | --- | --- |
| 0 | Collect fixtures; confirm the object types in them | needs a Mac, 1 day |
| 1 | Phase 1 import and export through Keynote | 2 to 3 days |
| 2a | Phase 2 reader: open, decode, walk, text and pictures | 4 to 5 days |
| 2b | Shapes, groups, backgrounds, notes, tables | 3 to 4 days |
| 2c | Charts, builds, the summary | 3 days |
| 3 | App wiring, export "For Keynote", docs | 2 days |

Steps 1 and 2a can ship separately; 2a alone already beats having nothing on Linux and Windows.

## Risks

- **Schema drift:** a new Keynote may move object types. Mitigation: tolerant decoding, fixtures from each new
  major version, an update script for the vendored schemas.
- **Fidelity expectations:** Keynote's effects (Magic Move, many builds, some text effects) have no SlideForge
  equivalent. The summary says what was left out.
- **Reverse-engineered format:** reading a file format for interoperability is the norm (LibreOffice does it); we
  use MIT-licensed schemas and credit them.
- **Phase 1 depends on Keynote and on the automation permission:** if the user declines it, fall back to Phase 2.

## Open questions

1. Import only, or also a real .key export (only possible through Keynote on a Mac)?
2. Is Phase 1 worth it, or go straight to the native reader so every platform behaves the same?
3. Are `protobuf` and `cramjam` acceptable new dependencies?
4. Keynote '09 (`index.apxl`) files: support, or a clear "re-save in a newer Keynote" message?
5. Who can make the fixture decks (this needs a Mac with Keynote)?
