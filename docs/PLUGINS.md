# Plugins: new kinds of slide objects

A plugin adds a new kind of object to slides without touching the editor's code. It draws a picture (SVG) from a few settings, and SlideForge handles the rest: inserting the object, moving and resizing it, undo, saving, the Properties panel, themes, and every export (PowerPoint, PDF, PNG, the HTML viewer and share links).

## Built-in plugins

| Plugin | What it makes |
|---|---|
| Chemical structure (`smiles`) | The 2D structure of a molecule from SMILES, or from a compound name looked up on PubChem (once; the result is kept). Reactions from reaction SMILES (`reactants>agents>products`) with text above and below the arrow and names under the structures. Optional caption: name, formula, molar mass (SmilesDrawer). |
| QR code (`qr-code`) | A QR code for a link to a paper, dataset, code or poster, with an optional caption (qrcode-generator). Non-ASCII letters in web links are percent-encoded so every scanner reads them the same. |
| Scale bar (`scale-bar`) | A bar with its length (pm to km) for micrographs and maps. The bar spans the object's box: size the box to the length on the picture. The label keeps its size. Optional end ticks and a dark or light backing. |
| Citation (`citation`) | A reference from a DOI in short, Nature, APA or ACS style, optionally with the doi.org link. Details come from Crossref once and are kept with the deck. The text wraps to the box's width; the box takes its height. |
| Phylogenetic tree (`phylo-tree`) | A rectangular tree from Newick: phylogram (branch lengths, scale bar) or cladogram (tips aligned), support values, italic species names. |
| Sequence (`sequence`) | A DNA, RNA or protein sequence (plain or FASTA) in blocks of ten with position numbers, coloured letters or boxes (A/C/G/T, Clustal classes, or Kyte–Doolittle hydrophobicity), and highlighted regions from a table (start, end, colour, label). |
| Box / violin plot (`box-plot`) | Box (Tukey: whiskers to 1.5 × IQR, outliers beyond), violin (Gaussian kernel density, Silverman's bandwidth) or both, from columns of numbers; points, means, colour-blind-safe colours. Comparison brackets above the plot, by group name or number, with a typed label or a p-value computed by Welch's t-test or the Mann–Whitney U test (exact for small groups without ties, as SciPy), shown as stars or numbers; the panel lists the computed p-values. |
| Forest plot (`forest-plot`) | Estimates with confidence intervals per study or subgroup (label, estimate, lower, upper, weight): squares sized by weight, a pooled diamond, log scale for ratios, values column, "favours" notes. |
| Significance brackets (`significance`) | Brackets with stars, n.s. or p-values between groups of a chart, from a table of comparisons (from group, to group, label). Brackets stack without overlapping; p-values can be shown as stars (* < 0.05, ** < 0.01, *** < 0.001, **** < 0.0001). Place the box over the chart's plot area, as wide as its bars. |
| Structure, RDKit (`rdkit`) | Publication-quality 2D structures from SMILES drawn by RDKit (loaded on first use, about 7 MB): SMARTS substructure highlights, R/S and E/Z labels, colours that follow the theme, and an optional property card beside or below (formula, molar mass, cLogP, TPSA, H-bond donors/acceptors, rotatable bonds). RDKit runs in a web worker because the page's security policy does not allow WebAssembly. |
| Energy diagram (`energy-levels`) | A reaction profile (states and transition states in order, dashed connectors or a smooth curve, energies on the levels, several pathways compared by name) or Jablonski/MO levels side by side in columns with transitions: absorption and emission as solid coloured arrows, IC/ISC/relaxation dashed. |
| Gel electrophoresis (`gel`) | A gel with a 1 kb, 100 bp, protein (kDa) or custom ladder and sample lanes from a table (lane, size, intensity). Bands are placed by the log of their size; a lane with a blank size stays empty. Fluorescent (light on dark) or stained (dark on light) look. |
| Plasmid map (`plasmid-map`) | A circular map from a feature table (name, start, end, strand, colour, type) and restriction sites (name, position). Strands are arrowheads; a feature may cross the origin (start after end); type (gene, promoter, origin, terminator, resistance) picks a colour when none is given. Labels sit outside, pushed apart so they do not overlap, with leader lines; length ticks inside. |
| Sequence logo (`sequence-logo`) | A logo from aligned DNA, RNA or protein sequences (one per line or FASTA, same length): information content in bits (optional small-sample correction) or probabilities, letters stacked by frequency, classic colours, position numbers from a chosen start. |
| Domain architecture (`domain-architecture`) | A protein drawn to scale with domains from a table (name, start, end, colour, shape: box, rounded, oval), sites as lollipops (position, label; close labels go up to three rows) and a residue ruler. Names that do not fit inside a domain go below it. |
| Venn diagram (`venn`) | Two or three sets from region counts (`A`, `B`, `A&B`… each counting that region only) or from lists of items (one column per set). Two sets can be area-proportional (circle areas and overlap match the counts); three use the symmetric layout. Each count sits at the most open point of its region; set names show totals. |
| Curve fit (`curve-fit`) | Points from a table (x, then one column of y per series; repeated x for replicates) with a least-squares fit: four-parameter dose-response (EC50 and Hill slope, on a log x axis), straight line, Michaelis–Menten (Vmax, Km) or one-phase decay (k, half-life). Levenberg–Marquardt; 95% intervals from the covariance and Student's t, as SciPy's `curve_fit` gives them (EC50's interval from log EC50). The values show in the legend and the panel. |
| Function plot (`function-plot`) | Curves y = f(x), one per line as `expression ; colour ; label`, with axes through zero, grid and legend. Expressions are read by the plugin's own parser (no `eval`): `+ - * / ^`, unary minus, brackets, `x`, `pi`, `e`, `sin cos tan asin acos atan sinh cosh tanh exp ln log log10 sqrt abs floor ceil`, and implicit multiplication (`2x`, `2sin(x)`, `(x+1)(x-1)`, `sin x`). `-x^2` is −(x²); `^` is right-associative. Curves break where undefined or where they jump across the plot (tan, 1/x). Errors name the line and character position. The x and y limits may be expressions (`-2pi`). |
| Ray diagram (`ray-optics`) | A thin converging or diverging lens, or a concave or convex mirror, with the object, the three principal rays, focal points (and C for mirrors) and the image: real (solid) or virtual (dashed rays traced back). Computes dᵢ from 1/f = 1/dₒ + 1/dᵢ and m = −dᵢ/dₒ, and says real/virtual, upright/inverted, magnified/reduced. An object at the focal point gives "image at infinity". |
| Feynman diagram (`feynman`) | Diagrams from a short text description (below) or presets: e⁺e⁻ → μ⁺μ⁻, Compton scattering, gluon exchange, Higgs production by gluon fusion, β decay. Fermions with arrows, wavy photons and W/Z, curly gluons, dashed scalars, dotted ghosts, bent lines for loops. |
| Circuit (`circuit`) | A schematic from a short text description (below): nodes placed on a grid, parts between nodes with their symbols (US zigzag or IEC box resistors), names and values (`10k` → 10 kΩ), junction dots where three or more connections meet, ground symbols. |
| Kaplan–Meier curve (`kaplan-meier`) | Survival curves per group from a table (time, event 1/0, optional group): step curves, censoring ticks, 95% confidence bands (Greenwood variance on the log(−log S) scale, as R's `conf.type = "log-log"`), dashed median lines, a numbers-at-risk table under the time axis, and the log-rank test across groups (χ² with k − 1 degrees of freedom). |
| Volcano plot (`volcano`) | log2 fold change against −log10 p from a table (label, log2FC, p): dashed thresholds for \|log2FC\| and p, up/down/not-significant colours with counts in the legend, labels for the top hits placed where they do not overlap. p = 0 is drawn just above the most significant value. Up to 10,000 points. |
| Heatmap (`heatmap`) | A matrix (first row column names, first column row names) as coloured cells: viridis, magma, coolwarm, RdBu or greys, range from the data or even around a centre value, optional row/column z-scores, average-linkage clustering of rows and/or columns (Euclidean or 1 − correlation) with dendrograms, values in cells and a colour bar. Up to 200 × 200; empty or NA cells are grey. |
| Colour bar (`colorbar`) | A standalone colour scale legend (viridis, magma, plasma, inferno, cividis, coolwarm, RdBu, greys) with range, round ticks and label, horizontal or vertical, reversible. |
| Paper badge (`paper-badge`) | A corner badge for a paper or preprint: an arXiv id, DOI or link is shown as `arXiv:…`, `doi:…` or the address under a heading, with an optional QR code to the paper. Nothing is looked up. Uses the QR code plugin's library (`plugins/qr-code/vendor/qrcode.js`). |

Every plugin is inserted from the **Plugins** menu (the puzzle-piece button at the end of the insert toolbar: plugins grouped by field, with a search box; Enter inserts the first match), the command palette (Ctrl+K, "Add …") or a `/` command.

### Feynman diagram text

One item per line; `#` starts a comment.

- `point name x y` — an end of a line (no dot). `vertex name x y` — a vertex, drawn with a dot. y points up; the diagram is scaled to fit the box.
- `type from to label [bend=0.5] [side=right] [color=#hex]` — a line from one point to another. Types: `fermion` (arrow along from → to), `antifermion` (arrow against it), `photon` and `boson` (wavy), `gluon` (curly), `scalar` (dashed), `ghost` (dotted), `plain`.
- `bend` curves the line (the middle moves `bend` × its length to the left of from → to; negative: to the right), for loops and bubbles.
- `side=right` puts the label on the other side of the line.
- Labels are italic; `gamma` → γ, `mu` → μ, `nu` → ν, `tau` → τ (and other Greek names), a trailing `+`/`-`/`0` becomes ⁺/⁻/⁰, `bar` gives an overbar (`nubar_e` → ν̄ₑ), `_e` a subscript.
- Choosing a preset replaces the text; editing the text makes the diagram your own ("custom").

```
point a -2 1.2
point b -2 -1.2
vertex v1 -0.8 0
vertex v2 0.8 0
fermion b v1 e-
antifermion a v1 e+
photon v1 v2 gamma
```

### Circuit text

One item per line; `#` or `;` starts a comment. The layout is yours: a clear text beats automatic placement.

- `node name x y` — a point on the grid (y points down). Parts run in a straight line between two nodes, any direction; horizontal and vertical look best.
- `name node1 node2 value` — a part. Its kind comes from its name's first letters: `R` resistor, `C` capacitor, `L` inductor, `V` voltage source (+ towards node1), `B` battery, `I` current source, `D` diode (anode at node1), `LED`, `SW` (or `S`) switch, `M` voltmeter, `A` ammeter, `X` lamp, `W` wire (no symbol).
- Values get units: `10k` → 10 kΩ on a resistor, `100n` → 100 nF on a capacitor, `10m` → 10 mH on an inductor, `5` → 5 V on a source. Values with their own unit (`5V`, `2mA`) are kept.
- `gnd node` — a ground symbol under a node.
- A dot marks every node where three or more connections meet.

```
node in 0 0
node a 3 0
node g 3 3
node g0 0 3
V1 in g0 5V
R1 in a 10k
C1 a g 100n
W1 g0 g
gnd g
```

## Managing plugins

Open the puzzle-piece **Plugins** menu at the end of the insert toolbar and choose **Manage plugins…**, or run "Manage Plugins" from the command palette (Ctrl+K). The dialog lists every plugin with its version, whether it is built in or yours, and how many objects in the open presentation use it.

Use the **Search plugins** box to filter the list by plugin name, id, description, or author. This also searches plugins that are missing from the installation but still used by the open presentation.

- **On/off switch**: takes effect at once, without a reload, and is remembered. A plugin switched off leaves the Plugins menu and the commands. Objects already on slides keep their last picture and can be moved, resized and exported; they are editable again when the plugin is switched back on.
- **Install from .zip…**: adds a plugin to your plugins folder and switches it on. Installing a newer zip of the same plugin replaces it (reload SlideForge to run the new version).
- **Remove** (your plugins only): deletes the plugin's folder. Click it twice to confirm.
- **Look again**: rereads the plugins folder after you add or change files there by hand.
- Plugins a presentation uses but this installation lacks are listed as "Not installed".

### Where plugins live

| | Folder | Kept on upgrade |
|---|---|---|
| Built-in | `frontend/plugins/<id>/`, listed in `frontend/plugins/plugins.json` (the list also says they start switched on) | replaced by each version |
| Yours, desktop app | `<data dir>/plugins/<id>/` (the dialog shows the full path and can copy it) | yes |
| Yours, web app | the folder in `SLIDEFORGE_USER_PLUGINS_DIR`; unset means no user plugins | yes |

The on/off switches are saved in `<data dir>/plugin-settings.json` (desktop) or `SLIDEFORGE_PLUGIN_STATE_FILE` (web, default `backend/plugin-settings.json`). A user plugin cannot reuse a built-in plugin's id.

**Who may change plugins**: in the desktop app, the person running it. In the web app, only staff users; everyone else sees the list read-only. Plugins run in every user's editor with the editor's full rights, so on a shared server set `SLIDEFORGE_USER_PLUGINS_DIR` only if staff can be trusted with that, and only install plugins you trust.

### A plugin zip

Either a folder named after the plugin id:

```
my-plugin.zip
└── qr-code/
    ├── plugin.js
    ├── plugin.json
    └── vendor/…
```

or the files at the top of the zip, with the id in `plugin.json`. Limits: 25 MB zipped, 60 MB unpacked, 500 files; no links or paths outside the folder.

### plugin.json

Optional, but it is what the dialog shows before the plugin's code has run:

```json
{
    "id": "qr-code",
    "name": "QR Code",
    "version": "1.2.0",
    "description": "A QR code for a link.",
    "icon": "fa-solid fa-qrcode",
    "author": "Your name",
    "homepage": "https://example.org/qr-plugin"
}
```

## Writing a plugin

1. Make a folder `<id>/` with a `plugin.js` (and a `plugin.json`). The id uses lower-case letters, digits and dashes (`smiles`, `qr-code`) and must match the `id` that `plugin.js` registers.
2. Put the folder in your plugins folder (or zip it and use **Install from .zip…**). For a built-in plugin, put it in `frontend/plugins/` and add its id to `frontend/plugins/plugins.json`.
3. Press **Look again** in the dialog, or reload. The plugin appears in the toolbar's Plugins menu, in the command palette ("Add …") and as a `/` command.

Libraries that compile code at run time (WebAssembly, or `new Function` as Emscripten builds use) cannot run in the editor page, whose Content-Security-Policy forbids that: run them in a Web Worker loaded from the plugin folder, as the `rdkit` plugin does (`worker.js`). Libraries the plugin needs go in its own folder (for example `vendor/`), and are loaded when the plugin first draws, with `context.loadScript("vendor/lib.js")`. They are not loaded at startup. Put their licences next to them (and, for built-in plugins, list them in `THIRD_PARTY_NOTICES.md`).

## plugin.js

```js
SlideForgePlugins.register({
    id: "smiles",                      // must match the folder name
    version: "1",                      // change it when the drawing changes, so old pictures are redrawn
    name: "Chemical Structure",        // the Properties panel section, the layer name
    description: "Draw a 2D structure from a SMILES string",
    icon: "fa-solid fa-flask",         // a Font Awesome 6.5 icon
    insert: { label: "Chemical structure (SMILES)", keywords: "molecule chemistry" },
    defaultSize: { width: 300, height: 220 }, // a new object fits its drawing inside this box
    defaultData: { smiles: "CCO", color: "" },
    fields: [
        { key: "smiles", label: "SMILES", type: "text", primary: true, placeholder: "c1ccccc1", hint: "Press Enter to redraw." },
        { key: "color", label: "Bond colour", type: "color", allowAuto: true },
    ],
    normalize(data) { return { smiles: String(data.smiles || "").trim(), color: data.color || "" }; },
    async render(data, context) { return "<svg …>…</svg>"; },
});
```

- **`insert`**: the `label` shown in the Plugins menu and the command palette, search `keywords`, and the menu `category` the plugin is listed under (`Chemistry`, `Biology`, `Statistics`, `Physics & maths`, `Figures & references`; any other name makes its own group after those, and none puts it under "Other"). The menu also shows `description`; its search box matches the label, description, keywords and category. With `fill: true` (the plots), an object inserted on a slide that holds only its title (and an empty content placeholder) takes the content area, from under the title to the footer; elsewhere it comes in at `defaultSize`. An object inserted from the Plugins menu opens the Properties panel on its options.
- **`defaultData`**: the settings a new object starts with. They are stored in the element as `pluginData` and saved with the deck, so keep them to plain JSON (under 100 KB).
- **`fields`**: the Properties panel is built from these. Types: `text`, `textarea`, `number` (`min`, `max`, `step`), `color` (`allowAuto: true` adds a "Theme colour" box that stores `""`), `checkbox` (`checkboxLabel`), `select` (`options: [{ value, label }]` or plain strings), and `table` (see below). Any field can have a `hint`. The `primary` field (or the first text field) is asked for when the object is inserted and when it is double-clicked. Mark settings changed only now and then (text size, colours, display details) with `advanced: true`: they fold under **More options** at the end of the panel, so the data and main choices come first. `when: { kind: "levels" }` shows a setting only while another setting has that value (or one of a list of values: `when: { kind: ["a", "b"] }`); the panel is rebuilt when that setting changes.
- **`table` fields** take CSV, TSV, semicolon-separated text or cells pasted from a spreadsheet, typed in the box or read with **Load CSV…** (up to 60 KB). `columns: ["From", "To", "Label"]` names the columns above the box and `rows` sets its height. The setting holds the text as typed; read it with `context.parseTable(text)`, which returns rows of trimmed cells (quoted cells may hold separators and line breaks; blank lines are skipped). Skipping a header row is up to the plugin. Read blank cells as missing, not as 0 (`Number("")` is 0): a blank survival time became an event at time zero. `summarize(rows)` on the field gives the line under the box ("12 subjects in 2 groups, 4 censored"; the default counts rows and columns). While the box still holds the plugin's `defaultData` it is labelled **Example data**, with a **Clear** button.
- **`sizeAware: true`**: the plugin draws for the object's box (`context.width`, `context.height`, in slide pixels) instead of being scaled to it, and is redrawn when the box is resized. Use it when parts must keep their size, such as a scale bar's label. A new object starts at `defaultSize`.
- **`autoHeight: true`** (with `sizeAware`): the box takes the height of the drawing, as for text that wraps to the box's width.
- **`prepare(data, previous, context)`** (optional, async): a lookup for new settings, such as a name or DOI. The edit itself is saved and shown at once (a new object is placed at once on its slide, marked "Looking up…"); `prepare` then runs in the background and returns the settings with what it found. Only the fields it changed are merged into the object as it is by then, and only if the settings the lookup was for are still the same: an edit made meanwhile is kept, and a lookup for an object that was deleted or undone is dropped. Keep what the lookup finds in the settings, so drawing never needs the network (the citation plugin stores Crossref's answer, the SMILES plugin PubChem's). Throw an `Error` to report a failed lookup: the message is shown in the panel (and on the slide if the object cannot be drawn), with a **Look up again** button, which calls `prepare` with `context.refresh` set (look up again even though the settings have not changed). `previous` is `null` on insert and on Look up again.
- Every plugin object's panel also has **Fill content area** (the slide's width, from under the title to the footer).
- **`exportText(data)`** (optional): for an object that is only text (the citation), returns `{ runs: [{ text, italic, bold }], fontSize, color }`; the PowerPoint export then writes it as a text box a co-author can edit, instead of a picture. Return `null` to export the picture.
- **`onTableData(key, rows, data, previous)`** (optional): called when a table field gets new data (typed, pasted or loaded from a CSV), with its parsed rows; return settings to change with it, such as axis labels taken from the header row while they are still the example's. Return `null` to change nothing.
- **`footnote: true`**: the panel offers "Place as footnote" (across the slide, its last line just above the footer) instead of "Fill content area", for references and similar small text.
- **`askOnInsert: false`**: insert without asking for the first text field (for objects set up in the panel). Double-click then opens the Properties panel.
- **`normalize(data)`** (optional): returns cleaned settings. It runs on every draw and every panel change, with `defaultData` already filled in for missing keys.
- **`render(data, context)`**: returns SVG markup (a string or an `<svg>` element), or throws an `Error` whose message is shown on the slide and in the panel. Give the SVG a `viewBox` fitted tightly around the drawing; the object's box shows it at its own proportions. `context` holds:
  - `textColor`: the theme's text colour. Use it when a colour setting is empty, so the drawing suits light and dark themes.
  - `theme`: the full theme object.
  - `loadScript(path)`: loads a script relative to the plugin folder, once.
  - `baseUrl`: the plugin folder's URL.
  - `parseTable(text)`: rows of cells from a table field.
  - `width`, `height`: the box, for `sizeAware` plugins.
  - `measureText(text, { size, weight, italic, family })`: a line's width in px, to lay out labels. Text written and measured in `Arial, Helvetica, sans-serif` (the default) is drawn in the theme's body font: SlideForge measures with that font and puts its faces inside the picture where it is shown and exported (the saved drawing stays small). Name another font to keep it (the Feynman diagram's serif, the sequence's monospace).
  - `niceTicks(min, max, count)`: round axis ticks (`{ min, max, step, ticks }`).
  - `escapeXml(text)`: text made safe to put in SVG markup.
  - `fetchJson(url)`: JSON from a web service, with a readable error when it cannot be reached (`error.status` holds the HTTP status). Only hosts the page's Content-Security-Policy allows can be reached: `connect-src` in the desktop and web settings lists PubChem and Crossref. A plugin that needs another service needs that host added there.
- **`status(data)`** (optional): a short line shown in the Properties panel above the fields, for what the settings do not show themselves, such as what a lookup found ("Looked up on PubChem: “caffeine” is Caffeine · C₈H₁₀N₄O₂").
- **`edit(data, context)`** (optional): a custom editor for double-click. Resolve to the changed settings, or `null` to cancel.

The returned SVG is cleaned before it is kept: scripts, event handlers, `<foreignObject>`, animation elements and outside links are removed. Embedded pictures must be `data:image/…` URLs. Labels should use common fonts (Arial, Helvetica, sans-serif): the SVG is shown as a picture and cannot load web fonts.

## How plugin objects are stored

```json
{
  "type": "plugin",
  "pluginId": "smiles",
  "pluginData": { "smiles": "CCO", "color": "" },
  "pluginPreview": "data:image/svg+xml,…",
  "pluginPreviewKey": "…"
}
```

`pluginPreview` is the last drawing. The editor shows it at once and redraws when the settings, the plugin version or the theme colour change. A deck opened where the plugin is missing still shows, moves and exports that picture; the Properties panel says the plugin is not installed.

Exports turn each plugin object into a picture of its box: PowerPoint gets a PNG, the HTML viewer and share links an SVG file. PDF and PNG exports capture the slide as shown.

## Scripting

`window.SlideForgePlugins` has:

| Call | What it does |
|---|---|
| `register(definition)` | Adds a plugin (see above). |
| `get(id)`, `list()` | A registered plugin, or all of them. |
| `ready` | A promise that resolves once the switched-on plugins have loaded. |
| `enable(id)`, `disable(id)` | Loads or unloads a plugin in the open editor only (the dialog also saves the switch on the server). |
| `catalogue()`, `count(id)` | The installed plugins as the server listed them; how many objects in the deck use a plugin. |
| `insert(id, data?, { ask })` | Adds an object to the current slide. `ask: false` skips the prompt. Resolves to the new id. |
| `update(elementId, changes)` | Changes some settings of an object, as one undo step. |
| `edit(elementId)` | Opens the double-click editor. |
| `draw(element)` | Resolves to `{ dataUrl, width, height }` for an element's settings. |

The code is in `frontend/js/plugins/plugins.js` (registry, drawing, insert, exports), `frontend/js/properties/panels/plugin.js` (the panel), `frontend/js/ui/plugin-manager.js` (the dialog) and `backend/slideforge/studio/plugins.py` with `plugin_views.py` (`GET /api/plugins/`, `POST /api/plugins/<id>/ {"enabled": …}`, `POST /api/plugins/install/`, `DELETE /api/plugins/<id>/`; user plugin files at `/user-plugins/<id>/…`).
