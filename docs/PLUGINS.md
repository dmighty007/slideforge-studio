# Plugins: new kinds of slide objects

A plugin adds a new kind of object to slides without touching the editor's code. It draws a picture (SVG) from a few settings, and SlideForge handles the rest: inserting the object, moving and resizing it, undo, saving, the Properties panel, themes, and every export (PowerPoint, PDF, PNG, the HTML viewer and share links).

The first plugin, `smiles`, draws the 2D structure of a molecule from a SMILES string (`frontend/plugins/smiles/`).

## Managing plugins

Open **Plugins** from the puzzle-piece button at the end of the insert toolbar, or "Manage Plugins" in the command palette (Ctrl+K). The dialog lists every plugin with its version, whether it is built in or yours, and how many objects in the open presentation use it.

- **On/off switch**: takes effect at once, without a reload, and is remembered. A plugin switched off loses its toolbar button and commands. Objects already on slides keep their last picture and can be moved, resized and exported; they are editable again when the plugin is switched back on.
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
3. Press **Look again** in the dialog, or reload. The plugin gets a toolbar button, a command palette entry ("Add …") and a `/` command.

Libraries the plugin needs go in its own folder (for example `vendor/`), and are loaded when the plugin first draws, with `context.loadScript("vendor/lib.js")`. They are not loaded at startup. Put their licences next to them (and, for built-in plugins, list them in `THIRD_PARTY_NOTICES.md`).

## plugin.js

```js
SlideForgePlugins.register({
    id: "smiles",                      // must match the folder name
    version: "1",                      // change it when the drawing changes, so old pictures are redrawn
    name: "Chemical Structure",        // the Properties panel section, the layer name
    description: "Draw a 2D structure from a SMILES string",
    icon: "fa-solid fa-flask",         // a Font Awesome 6.5 icon
    insert: { group: "Science", label: "Chemical structure (SMILES)", keywords: "molecule chemistry" },
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

- **`insert.group`**: the toolbar group the button goes in (`Basics`, `Charts`, `Science`, `Graphics`, `Connect`, `Media`). Another name makes a new group.
- **`defaultData`**: the settings a new object starts with. They are stored in the element as `pluginData` and saved with the deck, so keep them to plain JSON (under 100 KB).
- **`fields`**: the Properties panel is built from these. Types: `text`, `textarea`, `number` (`min`, `max`, `step`), `color` (`allowAuto: true` adds a "Theme colour" box that stores `""`), `checkbox` (`checkboxLabel`), `select` (`options: [{ value, label }]`). The `primary` field (or the first text field) is asked for when the object is inserted and when it is double-clicked.
- **`normalize(data)`** (optional): returns cleaned settings. It runs on every draw and every panel change, with `defaultData` already filled in for missing keys.
- **`render(data, context)`**: returns SVG markup (a string or an `<svg>` element), or throws an `Error` whose message is shown on the slide and in the panel. Give the SVG a `viewBox` fitted tightly around the drawing; the object's box shows it at its own proportions. `context` holds:
  - `textColor`: the theme's text colour. Use it when a colour setting is empty, so the drawing suits light and dark themes.
  - `theme`: the full theme object.
  - `loadScript(path)`: loads a script relative to the plugin folder, once.
  - `baseUrl`: the plugin folder's URL.
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
