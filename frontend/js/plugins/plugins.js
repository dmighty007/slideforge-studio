// Plugins: new kinds of slide objects that live in their own folder under frontend/plugins/<id>/ and are listed in
// frontend/plugins/plugins.json. A plugin's plugin.js calls SlideForgePlugins.register({...}) (see docs/PLUGINS.md).
//
// Every plugin object on a slide is one element of type "plugin":
//   { type: "plugin", pluginId: "smiles", pluginData: { ...the plugin's own settings... },
//     pluginPreview: "data:image/svg+xml,...", pluginPreviewKey: "<what the preview was drawn from>" }
// The plugin draws an SVG from pluginData. The last drawing is kept in the element, so a deck still shows the object
// (and exports it) on a machine where the plugin is missing, and slide thumbnails need not wait for the plugin.
// Exports turn plugin objects into pictures, so PowerPoint, PDF and the HTML viewer need nothing from the plugin.

const SF_PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const SF_PLUGIN_FIELD_TYPES = new Set(["text", "textarea", "number", "color", "checkbox", "select", "table"]);
const SF_PLUGIN_MAX_TABLE_LENGTH = 60000;
const SF_PLUGIN_MAX_PREVIEW_LENGTH = 2000000;
const SF_PLUGIN_MAX_DATA_LENGTH = 100000;

// Plugins switched on; every plugin whose script has run (kept, so switching one back on needs no reload); plugins
// switched off; and what the server said is installed (GET /api/plugins/).
const _sfPlugins = new Map();
const _sfPluginDefinitions = new Map();
const _sfSwitchedOff = new Set();
let _sfPluginCatalogue = [];
// Drawings by what they were drawn from, so redraws (thumbnails, re-renders, undo) do not run the plugin again.
const _sfPluginDrawings = new Map();
// The last drawing error per element id, for the Properties panel.
const _sfPluginErrors = new Map();
let _sfPluginsReadyResolve = null;
const sfPluginsReady = new Promise(resolve => {
    _sfPluginsReadyResolve = resolve;
});

function _pluginScriptBase() {
    const src = document.currentScript?.src;
    return src ? new URL(".", src).href : new URL("plugins/", document.baseURI).href;
}

// Loads a script once (a plugin's own library, fetched only when the plugin first draws).
const _sfPluginScripts = new Map();
function loadPluginScript(url) {
    const href = new URL(url, document.baseURI).href;
    if (!_sfPluginScripts.has(href)) {
        _sfPluginScripts.set(
            href,
            new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = href;
                script.onload = () => resolve();
                script.onerror = () => {
                    _sfPluginScripts.delete(href);
                    reject(new Error(`Could not load ${href}`));
                };
                document.head.appendChild(script);
            }),
        );
    }
    return _sfPluginScripts.get(href);
}

function _normalizePluginField(field) {
    if (!field || typeof field !== "object") return null;
    const key = String(field.key || "");
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) return null;
    const type = SF_PLUGIN_FIELD_TYPES.has(field.type) ? field.type : "text";
    return {
        ...field,
        key,
        type,
        label: String(field.label || key),
        // A table field's column names, shown above it (the text itself is CSV, TSV or pasted spreadsheet cells).
        columns: Array.isArray(field.columns) ? field.columns.map(String).slice(0, 50) : [],
        options: Array.isArray(field.options)
            ? field.options.map(option =>
                  typeof option === "object" ? { value: String(option.value), label: String(option.label ?? option.value) } : { value: String(option), label: String(option) },
              )
            : [],
    };
}

// Table text as rows of cells. The separator is guessed from the first line: tabs (cells pasted from a
// spreadsheet), semicolons (CSV from locales with a decimal comma) or commas. Quoted cells may hold separators,
// line breaks and "" for a quote. Blank lines are skipped.
function parsePluginTable(text, { maxRows = 2000, maxColumns = 50 } = {}) {
    const source = String(text ?? "").replace(/\r\n?/g, "\n");
    const firstLine = source.split("\n").find(line => line.trim()) || "";
    const count = char => firstLine.split(char).length - 1;
    const separator = count("\t") ? "\t" : count(";") > count(",") ? ";" : ",";
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const endCell = () => {
        if (row.length < maxColumns) row.push(cell.trim());
        cell = "";
    };
    const endRow = () => {
        endCell();
        if (row.some(value => value !== "") && rows.length < maxRows) rows.push(row);
        row = [];
    };
    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (quoted) {
            if (char === '"' && source[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"' && !cell.trim()) {
            quoted = true;
            cell = "";
        } else if (char === separator) {
            endCell();
        } else if (char === "\n") {
            endRow();
        } else {
            cell += char;
        }
    }
    endRow();
    return rows;
}

function registerSlidePlugin(definition) {
    const id = String(definition?.id || "");
    if (!SF_PLUGIN_ID_PATTERN.test(id)) throw new Error(`Plugin id "${id}" must be lower-case letters, digits and dashes`);
    if (typeof definition.render !== "function") throw new Error(`Plugin "${id}" has no render(data, context) function`);
    const plugin = {
        version: "1",
        name: id,
        description: "",
        icon: "fa-solid fa-puzzle-piece",
        defaultSize: { width: 320, height: 240 },
        defaultData: {},
        ...definition,
        id,
        baseUrl: definition.baseUrl || _pluginScriptBase(),
        fields: (definition.fields || []).map(_normalizePluginField).filter(Boolean),
    };
    _sfPluginDefinitions.set(id, plugin);
    // A plugin switched off while its script was loading stays off (its definition is kept for switching back on).
    if (!_sfSwitchedOff.has(id)) _activatePlugin(plugin);
    return plugin;
}

// How many objects in the open deck use a plugin.
function countPluginObjects(id) {
    return (typeof state !== "undefined" && state?.slides ? state.slides : []).reduce(
        (count, slide) => count + (slide.elements || []).filter(el => el?.type === "plugin" && el.pluginId === id).length,
        0,
    );
}

function _activatePlugin(plugin) {
    _sfPlugins.set(plugin.id, plugin);
    _installPluginInsertControls(plugin);
    // Objects of this plugin that were drawn from their saved picture can now be drawn by the plugin itself.
    if (countPluginObjects(plugin.id) && typeof renderSlidesFromState === "function") renderSlidesFromState();
}

// Switches a plugin on: at once if its script ran before, otherwise by loading it.
async function enableSlidePlugin(id, scriptUrl = "") {
    _sfSwitchedOff.delete(id);
    const known = _sfPluginDefinitions.get(id);
    if (known) {
        if (!_sfPlugins.has(id)) _activatePlugin(known);
        return known;
    }
    const url = scriptUrl || _sfPluginCatalogue.find(entry => entry.id === id)?.script;
    if (!url) throw new Error(`No script for the "${id}" plugin`);
    await loadPluginScript(url);
    const plugin = _sfPluginDefinitions.get(id);
    if (!plugin) throw new Error(`${url} did not register a plugin called "${id}"`);
    return plugin;
}

// Switches a plugin off: its insert controls go, and its objects show their saved pictures again.
function disableSlidePlugin(id) {
    _sfSwitchedOff.add(id);
    if (!_sfPlugins.delete(id)) return;
    _removePluginInsertControls(id);
    if (countPluginObjects(id) && typeof renderSlidesFromState === "function") renderSlidesFromState();
    if (state?.selectedIds?.length && typeof buildPropertiesPanel === "function") buildPropertiesPanel();
}

function getSlidePlugin(id) {
    return _sfPlugins.get(id) || null;
}

function listSlidePlugins() {
    return [..._sfPlugins.values()];
}

// The plugins the server offers (built-in and the user's own) and which are switched on. Without the API (the
// frontend served on its own) the built-in list in plugins/plugins.json is used.
async function fetchPluginCatalogue() {
    try {
        const response = await fetch("/api/plugins/", { credentials: "same-origin", cache: "no-cache" });
        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data?.plugins)) {
                _sfPluginCatalogue = data.plugins.filter(entry => SF_PLUGIN_ID_PATTERN.test(String(entry?.id)));
                return data;
            }
        }
    } catch (_error) {}
    const response = await fetch("plugins/plugins.json", { cache: "no-cache" });
    const manifest = response.ok ? await response.json() : {};
    const ids = (Array.isArray(manifest?.plugins) ? manifest.plugins : []).filter(id => SF_PLUGIN_ID_PATTERN.test(String(id)));
    _sfPluginCatalogue = ids.map(id => ({ id, name: id, source: "bundled", enabled: true, script: `plugins/${id}/plugin.js` }));
    return { plugins: _sfPluginCatalogue, canManage: false, canInstall: false, userDir: "" };
}

function getPluginCatalogue() {
    return _sfPluginCatalogue;
}

// Loads every plugin that is switched on. One broken plugin does not stop the others.
async function loadSlidePlugins() {
    try {
        await fetchPluginCatalogue();
        _sfPluginCatalogue.filter(entry => !entry.enabled).forEach(entry => _sfSwitchedOff.add(entry.id));
        await Promise.all(
            _sfPluginCatalogue
                .filter(entry => entry.enabled && !entry.error)
                .map(entry => enableSlidePlugin(entry.id, entry.script).catch(error => console.warn(`Plugin "${entry.id}" not loaded:`, error))),
        );
    } catch (error) {
        console.warn("Plugins not loaded:", error);
    } finally {
        _sfPluginsReadyResolve?.(listSlidePlugins());
    }
    return listSlidePlugins();
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function _pluginThemeColor() {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    return theme?.defaultTextColor || "#1f2937";
}

// An object's box in slide pixels (for plugins that draw to fit it).
function _pluginBoxSize(plugin, elData) {
    const width = parseFloat(elData?.width);
    const height = parseFloat(elData?.height);
    return {
        width: Math.max(8, Math.round(Number.isFinite(width) ? width : Number(plugin.defaultSize?.width) || 320)),
        height: Math.max(8, Math.round(Number.isFinite(height) ? height : Number(plugin.defaultSize?.height) || 240)),
    };
}

function _pluginRenderContext(plugin, elData = null) {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    return {
        textColor: _pluginThemeColor(),
        theme,
        baseUrl: plugin.baseUrl,
        loadScript: url => loadPluginScript(new URL(url, plugin.baseUrl).href),
        parseTable: parsePluginTable,
        // Size-aware plugins draw for the box (a scale bar spans it; its label keeps its size).
        ...(plugin.sizeAware ? _pluginBoxSize(plugin, elData) : {}),
    };
}

function normalizePluginData(plugin, data) {
    const merged = { ...(plugin?.defaultData || {}), ...(data && typeof data === "object" ? data : {}) };
    // Table fields hold their text as typed or pasted, within a size that keeps decks small.
    (plugin?.fields || [])
        .filter(field => field.type === "table")
        .forEach(field => {
            merged[field.key] = String(merged[field.key] ?? "").slice(0, SF_PLUGIN_MAX_TABLE_LENGTH);
        });
    return typeof plugin?.normalize === "function" ? plugin.normalize(merged) || merged : merged;
}

function _pluginPreviewKey(plugin, data, elData = null) {
    const box = plugin.sizeAware ? _pluginBoxSize(plugin, elData) : null;
    return JSON.stringify([plugin.id, plugin.version, _pluginThemeColor(), data, ...(box ? [box.width, box.height] : [])]);
}

// A plugin's SVG made safe to keep and show: no scripts, handlers or outside references, and a viewBox so it scales.
function cleanPluginSvg(svgText) {
    const doc = new DOMParser().parseFromString(String(svgText || ""), "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
        throw new Error("The plugin did not return an SVG drawing");
    }
    // Animation elements go too: <set>/<animate> can rewrite a link into a script URL. Drawings are still pictures.
    svg.querySelectorAll("script, foreignObject, iframe, object, embed, set, animate, animateMotion, animateTransform, handler, listener")
        .forEach(node => node.remove());
    [svg, ...svg.querySelectorAll("*")].forEach(node => {
        [...node.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith("on")) node.removeAttribute(attr.name);
            else if ((name === "href" || name === "xlink:href") && !value.startsWith("#") && !value.startsWith("data:image/")) {
                node.removeAttribute(attr.name);
            }
        });
    });
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!svg.getAttribute("viewBox")) {
        const width = parseFloat(svg.getAttribute("width")) || 300;
        const height = parseFloat(svg.getAttribute("height")) || 150;
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
    // The drawing's own size is its viewBox; the slide box decides how big it is shown.
    const [, , vbWidth, vbHeight] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
    if (vbWidth > 0 && vbHeight > 0) {
        svg.setAttribute("width", String(vbWidth));
        svg.setAttribute("height", String(vbHeight));
    }
    svg.style.removeProperty("width");
    svg.style.removeProperty("height");
    return new XMLSerializer().serializeToString(svg);
}

function _svgDataUrl(svgText) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

// Draws an element's plugin object. Resolves to { dataUrl, key, width, height } (the drawing's own size).
async function drawPluginElement(elData) {
    const plugin = getSlidePlugin(elData?.pluginId);
    if (!plugin) throw new Error(`The "${elData?.pluginId}" plugin is not installed`);
    const data = normalizePluginData(plugin, elData.pluginData);
    const key = _pluginPreviewKey(plugin, data, elData);
    if (!_sfPluginDrawings.has(key)) {
        const drawing = (async () => {
            const result = await plugin.render(data, _pluginRenderContext(plugin, elData));
            const svgText = cleanPluginSvg(typeof result === "string" ? result : new XMLSerializer().serializeToString(result));
            const svg = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
            const dataUrl = _svgDataUrl(svgText);
            _sfCleanPreviews.add(dataUrl);
            return {
                dataUrl,
                key,
                width: parseFloat(svg.getAttribute("width")) || 300,
                height: parseFloat(svg.getAttribute("height")) || 150,
            };
        })();
        _sfPluginDrawings.set(key, drawing);
        drawing.catch(() => _sfPluginDrawings.delete(key));
        if (_sfPluginDrawings.size > 200) _sfPluginDrawings.delete(_sfPluginDrawings.keys().next().value);
    }
    return _sfPluginDrawings.get(key);
}

function _findPluginElementInState(id) {
    for (const slide of (typeof state !== "undefined" && state?.slides) || []) {
        const el = (slide.elements || []).find(item => item?.id === id);
        if (el) return el;
    }
    return null;
}

// Why a plugin object cannot be drawn or edited: its plugin is switched off, or not installed here at all.
function pluginUnavailableReason(id) {
    const known = _sfPluginCatalogue.find(entry => entry.id === id) || _sfPluginDefinitions.get(id);
    return known
        ? `The “${known.name || id}” plugin is switched off. Turn it on in Plugins to edit this object.`
        : `The “${id}” plugin is not installed.`;
}

function getPluginElementError(id) {
    return _sfPluginErrors.get(id) || "";
}

// The object on the slide: its last picture at once, then the plugin's fresh drawing when that differs.
function renderPluginElementContent(host, elData, { interactive = false } = {}) {
    const plugin = getSlidePlugin(elData.pluginId);
    const box = document.createElement("div");
    box.className = "plugin-element-content";
    box.dataset.pluginId = String(elData.pluginId || "");
    const img = document.createElement("img");
    img.alt = plugin?.name || "Plugin object";
    img.draggable = false;
    if (elData.pluginPreview) img.src = elData.pluginPreview;
    box.appendChild(img);
    const note = document.createElement("div");
    note.className = "plugin-element-note";
    note.hidden = true;
    box.appendChild(note);
    host.appendChild(box);

    const showNote = text => {
        note.textContent = text;
        note.hidden = !text;
        box.classList.toggle("plugin-element-content--empty", Boolean(text) && !img.getAttribute("src"));
    };
    if (!plugin) {
        // Plugins load after the deck: wait for them before saying this one is missing.
        sfPluginsReady.then(() => {
            if (!getSlidePlugin(elData.pluginId) && box.isConnected) {
                showNote(img.getAttribute("src") ? "" : pluginUnavailableReason(elData.pluginId));
            }
        });
        return box;
    }

    const redraw = source =>
        drawPluginElement(source)
            .then(drawing => {
                _sfPluginErrors.delete(elData.id);
                showNote("");
                box.classList.remove("plugin-element-content--error");
                if (img.getAttribute("src") !== drawing.dataUrl) img.src = drawing.dataUrl;
                const stored = _findPluginElementInState(elData.id);
                if (stored && stored.pluginPreviewKey !== drawing.key) {
                    // Kept outside undo: it is a cache of what the plugin draws, not an edit.
                    stored.pluginPreview = drawing.dataUrl;
                    stored.pluginPreviewKey = drawing.key;
                    elData.pluginPreview = drawing.dataUrl;
                    elData.pluginPreviewKey = drawing.key;
                    if (interactive && typeof refreshActiveSlidePreview === "function") refreshActiveSlidePreview();
                }
            })
            .catch(error => {
                const message = String(error?.message || error || "Could not draw");
                const known = _sfPluginErrors.get(elData.id);
                _sfPluginErrors.set(elData.id, message);
                showNote(message);
                box.classList.add("plugin-element-content--error");
                // The panel shows the error too; rebuild it once when the error is new.
                if (interactive && known !== message && state.selectedIds?.includes(elData.id) && typeof buildPropertiesPanel === "function") {
                    buildPropertiesPanel();
                }
            });
    redraw(elData);

    // A size-aware drawing is redrawn for the new box once a resize settles (resizing does not rebuild the slide).
    if (interactive && plugin.sizeAware && typeof ResizeObserver === "function") {
        let timer = null;
        const observer = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (!box.isConnected) {
                    observer.disconnect();
                    return;
                }
                const current = _findPluginElementInState(elData.id);
                const plugin = getSlidePlugin(elData.pluginId);
                if (!current || !plugin) return;
                const key = _pluginPreviewKey(plugin, normalizePluginData(plugin, current.pluginData), current);
                if (key !== current.pluginPreviewKey) redraw(current);
            }, 150);
        });
        observer.observe(host);
    }

    if (interactive) {
        host.addEventListener("dblclick", () => {
            if (document.body.classList.contains("play-mode-active")) return;
            editPluginElement(elData.id);
        });
    }
    return box;
}

// ─── Inserting and editing ───────────────────────────────────────────────────

// The setting asked for on insert and double-click: the field marked primary, else the first text field, unless the
// plugin says not to ask (askOnInsert: false), as for a scale bar that is set up in the panel.
function _primaryPluginField(plugin) {
    const marked = plugin.fields.find(field => field.primary);
    if (marked || plugin.askOnInsert === false) return marked || null;
    return plugin.fields.find(field => field.type === "text" || field.type === "textarea") || null;
}

async function _askPluginPrimaryValue(plugin, data, { inserting = false } = {}) {
    const field = _primaryPluginField(plugin);
    if (!field || typeof sfPrompt !== "function") return data;
    const value = await sfPrompt({
        title: inserting ? `Insert ${plugin.name}` : plugin.name,
        label: field.label,
        value: data[field.key] ?? "",
        placeholder: field.placeholder || "",
        hint: field.hint || "",
        multiline: field.type === "textarea",
        okLabel: inserting ? "Insert" : "Apply",
    });
    if (value === null) return null;
    return { ...data, [field.key]: value.trim() };
}

// Fits the drawing's shape inside the plugin's default box.
function _pluginInsertSize(plugin, drawing) {
    const maxWidth = Number(plugin.defaultSize?.width) || 320;
    const maxHeight = Number(plugin.defaultSize?.height) || 240;
    if (!drawing?.width || !drawing?.height) return { width: maxWidth, height: maxHeight };
    const scale = Math.min(maxWidth / drawing.width, maxHeight / drawing.height);
    return { width: Math.round(drawing.width * scale), height: Math.round(drawing.height * scale) };
}

async function insertPluginElement(pluginId, data = null, { ask = true } = {}) {
    const plugin = getSlidePlugin(pluginId);
    if (!plugin) return null;
    let pluginData = normalizePluginData(plugin, data || plugin.defaultData);
    if (ask && plugin.askOnInsert !== false) {
        pluginData = await _askPluginPrimaryValue(plugin, pluginData, { inserting: true });
        if (!pluginData) return null;
        pluginData = normalizePluginData(plugin, pluginData);
    }
    let drawing = null;
    try {
        drawing = await drawPluginElement({ pluginId, pluginData });
    } catch (error) {
        console.warn(`${plugin.name}: inserted, but not drawn:`, error);
    }
    // A size-aware plugin starts at its default box; others take the shape of their drawing.
    const size = plugin.sizeAware ? _pluginBoxSize(plugin, null) : _pluginInsertSize(plugin, drawing);
    const activeIndex = typeof currentSlideIndex !== "undefined" ? currentSlideIndex : 0;
    const slide = state.slides[activeIndex];
    if (!slide) return null;
    saveStateToUndo();
    const id = generateId("el");
    const element = {
        id,
        type: "plugin",
        pluginId,
        pluginData,
        pluginPreview: drawing?.dataUrl || "",
        pluginPreviewKey: drawing?.key || "",
        x: 200,
        y: 160,
        width: `${size.width}px`,
        height: `${size.height}px`,
        styles: { zIndex: getNextZIndex(), backgroundColor: "transparent" },
    };
    slide.elements.push(typeof placeWhereFree === "function" ? placeWhereFree(slide, element) : element);
    renderSlidesFromState();
    selectElement(id);
    return id;
}

// Changes some of an element's plugin settings, as one undo step.
function updatePluginElementData(id, updates) {
    const el = _findPluginElementInState(id);
    const plugin = getSlidePlugin(el?.pluginId);
    if (!el || !plugin) return;
    saveStateToUndo();
    el.pluginData = normalizePluginData(plugin, { ...(el.pluginData || {}), ...updates });
    _sfPluginErrors.delete(id);
    renderSlidesFromState();
    if (state.selectedIds?.includes(id) && typeof buildPropertiesPanel === "function") buildPropertiesPanel();
    if (typeof refreshPreviews === "function") refreshPreviews();
}

async function editPluginElement(id) {
    const el = _findPluginElementInState(id);
    const plugin = getSlidePlugin(el?.pluginId);
    if (!el || !plugin) return;
    if (typeof plugin.edit === "function") {
        const next = await plugin.edit(normalizePluginData(plugin, el.pluginData), _pluginRenderContext(plugin, el));
        if (next) updatePluginElementData(id, next);
        return;
    }
    if (!_primaryPluginField(plugin)) {
        // Nothing to ask for: its settings are in the Properties panel.
        if (typeof setPropertiesPanelVisible === "function") setPropertiesPanelVisible(true);
        if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
        return;
    }
    const next = await _askPluginPrimaryValue(plugin, normalizePluginData(plugin, el.pluginData));
    if (next) updatePluginElementData(id, next);
}

// A command palette entry and a slash command. The toolbar has one Plugins menu for all of them (built when it
// opens), so the insert bar keeps its width however many plugins are switched on.
function _installPluginInsertControls(plugin) {
    const insert = plugin.insert || {};
    const label = String(insert.label || plugin.name);
    const icon = plugin.icon.split(/\s+/).find(cls => cls.startsWith("fa-") && !["fa-solid", "fa-regular"].includes(cls)) || "fa-puzzle-piece";
    const run = () => insertPluginElement(plugin.id);
    if (typeof COMMANDS !== "undefined" && Array.isArray(COMMANDS) && !COMMANDS.some(cmd => cmd.id === `add-plugin-${plugin.id}`)) {
        COMMANDS.push({ id: `add-plugin-${plugin.id}`, title: `Add ${label}`, icon, keywords: `plugin ${insert.keywords || ""}`, action: run });
    }
    if (typeof SLASH_COMMANDS !== "undefined" && Array.isArray(SLASH_COMMANDS) && !SLASH_COMMANDS.some(cmd => cmd.id === `plugin-${plugin.id}`)) {
        SLASH_COMMANDS.push({ id: `plugin-${plugin.id}`, label, detail: plugin.description || "Plugin object", icon, run });
    }
}

// ─── The toolbar's Plugins menu ──────────────────────────────────────────────

let _sfPluginMenu = null;

function closePluginInsertMenu({ refocus = false } = {}) {
    const open = _sfPluginMenu;
    if (!open) return;
    _sfPluginMenu = null;
    open.menu.remove();
    document.removeEventListener("mousedown", open.onOutside, true);
    document.removeEventListener("keydown", open.onKey, true);
    window.removeEventListener("resize", open.onResize);
    open.anchor.setAttribute("aria-expanded", "false");
    if (refocus) open.anchor.focus({ preventScroll: true });
}

function togglePluginInsertMenu(anchor) {
    if (_sfPluginMenu) {
        closePluginInsertMenu();
        return;
    }
    const menu = document.createElement("div");
    menu.id = "plugin-insert-menu";
    menu.className = "sf-select-menu plugin-insert-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Plugins");
    const plugins = listSlidePlugins().sort((a, b) => String(a.insert?.label || a.name).localeCompare(String(b.insert?.label || b.name)));
    const heading = document.createElement("div");
    heading.className = "sf-select-menu__group";
    heading.textContent = plugins.length ? "Insert" : "No plugins are switched on";
    menu.appendChild(heading);
    const item = (iconClass, title, detail) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "plugin-insert-item";
        button.setAttribute("role", "menuitem");
        const icon = document.createElement("i");
        icon.className = iconClass;
        icon.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = title;
        text.appendChild(strong);
        if (detail) {
            const small = document.createElement("small");
            small.textContent = detail;
            text.appendChild(small);
        }
        button.append(icon, text);
        menu.appendChild(button);
        return button;
    };
    plugins.forEach(plugin => {
        const button = item(plugin.icon, String(plugin.insert?.label || plugin.name), plugin.description);
        button.dataset.pluginInsert = plugin.id;
        button.onclick = () => {
            closePluginInsertMenu();
            insertPluginElement(plugin.id);
        };
    });
    const separator = document.createElement("div");
    separator.className = "plugin-insert-separator";
    menu.appendChild(separator);
    const manage = item("fa-solid fa-sliders", "Manage plugins…", "Switch on or off, install, remove");
    manage.dataset.pluginManager = "";
    manage.onclick = () => {
        closePluginInsertMenu();
        window.openPluginManager?.();
    };
    document.body.appendChild(menu);

    const place = () => {
        const rect = anchor.getBoundingClientRect();
        const width = menu.offsetWidth;
        menu.style.left = `${Math.max(6, Math.min(rect.right - width, window.innerWidth - width - 6))}px`;
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.maxHeight = `${Math.max(160, window.innerHeight - rect.bottom - 18)}px`;
    };
    place();
    const items = () => [...menu.querySelectorAll(".plugin-insert-item")];
    const onOutside = event => {
        if (!menu.contains(event.target) && !anchor.contains(event.target)) closePluginInsertMenu();
    };
    const onKey = event => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closePluginInsertMenu({ refocus: true });
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const list = items();
            const index = list.indexOf(document.activeElement);
            const next = event.key === "ArrowDown" ? index + 1 : index - 1;
            list[(next + list.length) % list.length]?.focus();
        }
    };
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    anchor.setAttribute("aria-expanded", "true");
    _sfPluginMenu = { menu, anchor, onOutside, onKey, onResize: place };
    items()[0]?.focus({ preventScroll: true });
}

function _removePluginInsertControls(id) {
    closePluginInsertMenu();
    if (typeof COMMANDS !== "undefined" && Array.isArray(COMMANDS)) {
        const index = COMMANDS.findIndex(cmd => cmd.id === `add-plugin-${id}`);
        if (index >= 0) COMMANDS.splice(index, 1);
    }
    if (typeof SLASH_COMMANDS !== "undefined" && Array.isArray(SLASH_COMMANDS)) {
        const index = SLASH_COMMANDS.findIndex(cmd => cmd.id === `plugin-${id}`);
        if (index >= 0) SLASH_COMMANDS.splice(index, 1);
    }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

// A picture of the drawing the size of the object's box, the drawing centred in it at its own proportions.
async function _pluginPictureForBox(el) {
    let dataUrl = el.pluginPreview || "";
    if (getSlidePlugin(el.pluginId)) {
        try {
            dataUrl = (await drawPluginElement(el)).dataUrl;
        } catch (error) {
            console.warn("Plugin object exported from its last picture:", error);
        }
    }
    if (!dataUrl.startsWith("data:image/svg+xml")) return dataUrl;
    const svgText = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    svg.setAttribute("width", String(Math.round(parseFloat(el.width) || 320)));
    svg.setAttribute("height", String(Math.round(parseFloat(el.height) || 240)));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return _svgDataUrl(new XMLSerializer().serializeToString(svg));
}

// Plugin objects in an export copy of the state become pictures (PowerPoint and the standalone viewer).
async function replacePluginElementsWithPictures(exportState) {
    for (const slide of exportState?.slides || []) {
        for (const [index, el] of (slide.elements || []).entries()) {
            if (el?.type !== "plugin") continue;
            const content = await _pluginPictureForBox(el);
            if (!content) continue;
            slide.elements[index] = {
                id: el.id,
                type: "image",
                content,
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                rotation: el.rotation,
                lockAspectRatio: false,
                styles: { ...(el.styles || {}), backgroundColor: el.styles?.backgroundColor || "transparent" },
                animation: el.animation || null,
                ...(el.fragment ? { fragment: el.fragment } : {}),
                ...(el.fragmentIndex !== undefined ? { fragmentIndex: el.fragmentIndex } : {}),
                exportedFrom: `plugin:${el.pluginId}`,
            };
        }
    }
}

// A saved picture may come from a deck file made elsewhere: an SVG is cleaned like a plugin's own drawing before it is
// kept (the HTML export and share links serve it as a file). Pictures already cleaned are remembered.
const _sfCleanPreviews = new Set();
function _cleanPluginPreview(preview) {
    if (!preview || preview.length > SF_PLUGIN_MAX_PREVIEW_LENGTH) return "";
    if (_sfCleanPreviews.has(preview)) return preview;
    let clean = "";
    if (/^data:image\/png;base64,[A-Za-z0-9+/=]*$/.test(preview)) {
        clean = preview;
    } else if (preview.startsWith("data:image/svg+xml")) {
        try {
            const comma = preview.indexOf(",");
            const head = preview.slice(0, comma);
            const body = preview.slice(comma + 1);
            const svgText = /;base64$/i.test(head)
                ? new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0)))
                : decodeURIComponent(body);
            clean = _svgDataUrl(cleanPluginSvg(svgText));
        } catch (_error) {
            clean = "";
        }
    }
    if (clean) {
        if (_sfCleanPreviews.size > 500) _sfCleanPreviews.clear();
        _sfCleanPreviews.add(clean);
    }
    return clean;
}

// What a saved plugin element may hold (used by the state sanitizer).
function sanitizePluginElementFields(el) {
    const pluginId = SF_PLUGIN_ID_PATTERN.test(String(el?.pluginId || "")) ? String(el.pluginId) : "unknown";
    let pluginData = {};
    try {
        const json = JSON.stringify(el?.pluginData && typeof el.pluginData === "object" && !Array.isArray(el.pluginData) ? el.pluginData : {});
        if (json.length <= SF_PLUGIN_MAX_DATA_LENGTH) pluginData = JSON.parse(json);
    } catch (_error) {}
    const safePreview = _cleanPluginPreview(String(el?.pluginPreview || ""));
    return {
        pluginId,
        pluginData,
        pluginPreview: safePreview,
        pluginPreviewKey: safePreview && typeof el?.pluginPreviewKey === "string" ? el.pluginPreviewKey.slice(0, SF_PLUGIN_MAX_DATA_LENGTH) : "",
    };
}

window.SlideForgePlugins = {
    register: registerSlidePlugin,
    get: getSlidePlugin,
    list: listSlidePlugins,
    ready: sfPluginsReady,
    load: loadSlidePlugins,
    catalogue: getPluginCatalogue,
    fetchCatalogue: fetchPluginCatalogue,
    enable: enableSlidePlugin,
    disable: disableSlidePlugin,
    count: countPluginObjects,
    loadScript: loadPluginScript,
    parseTable: parsePluginTable,
    insert: insertPluginElement,
    update: updatePluginElementData,
    edit: editPluginElement,
    draw: drawPluginElement,
};
window.insertPluginElement = insertPluginElement;
window.togglePluginInsertMenu = togglePluginInsertMenu;

// Plugins load once the page's own scripts have run (their insert buttons go into the toolbar and command lists).
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadSlidePlugins());
} else {
    loadSlidePlugins();
}
