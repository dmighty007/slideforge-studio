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
// What a plugin's prepare step last said per element id ("Looking up…", or why a lookup failed), for the panel.
const _sfPluginNotices = new Map();
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

// Plot text in the theme's body font, as on the slide; it was always Arial. A plugin writes (and measures) Arial,
// Helvetica, sans-serif: that stack becomes the theme's font with Arial behind it. Fonts a plugin picks itself (the
// Feynman diagram's serif, the sequence's monospace) are left alone.
const SF_PLUGIN_DEFAULT_FONT = "Arial, Helvetica, sans-serif";
function pluginFontStack() {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    const body = String(theme?.bodyFont || "").replace(/"/g, "'").trim();
    if (!body) return SF_PLUGIN_DEFAULT_FONT;
    const generic = /,\s*serif\s*$/i.test(body) ? "serif" : "sans-serif";
    return `${body.replace(/,\s*(sans-serif|serif)\s*$/i, "")}, Arial, Helvetica, ${generic}`;
}

function _pluginFont(family) {
    return !family || String(family).trim() === SF_PLUGIN_DEFAULT_FONT ? pluginFontStack() : family;
}

// The faces of the theme's font, loaded before a plugin measures its text (measured with a fallback font, labels
// would not fit once the real font arrived).
async function _loadPluginFont(stack = pluginFontStack()) {
    if (stack === SF_PLUGIN_DEFAULT_FONT || !document.fonts?.load) return;
    await Promise.all(["400", "700", "italic 400"].map(face => document.fonts.load(`${face} 16px ${stack}`).catch(() => null)));
}

// ─── Helpers plugins get in their context ─────────────────────────────────────

function pluginEscapeXml(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let _sfMeasureCanvas = null;
// The width of a line of text in px, as an SVG <text> with these settings draws it.
function pluginMeasureText(text, { size = 16, weight = 400, italic = false, family = "Arial, Helvetica, sans-serif", resolvedFamily = "" } = {}) {
    _sfMeasureCanvas = _sfMeasureCanvas || document.createElement("canvas");
    const g = _sfMeasureCanvas.getContext("2d");
    g.font = `${italic ? "italic " : ""}${weight} ${size}px ${resolvedFamily || _pluginFont(family)}`;
    return g.measureText(String(text ?? "")).width;
}

// Round tick values covering min..max: about `count` of them, at steps of 1, 2 or 5 × 10^n.
function pluginNiceTicks(min, max, count = 5) {
    let lo = Number(min);
    let hi = Number(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] };
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi) {
        const pad = Math.abs(lo) * 0.1 || 1;
        lo -= pad;
        hi += pad;
    }
    const raw = (hi - lo) / Math.max(1, count);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(f => f * magnitude).find(candidate => candidate >= raw) || 10 * magnitude;
    const start = Math.floor(lo / step + 1e-9) * step;
    const end = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
    return { min: start, max: end, step, ticks };
}

// JSON from a web service, with a clear message when it cannot be reached. Only hosts the page's
// Content-Security-Policy allows can be fetched (see docs/PLUGINS.md).
async function pluginFetchJson(url, { timeout = 15000 } = {}) {
    const host = (() => {
        try {
            return new URL(url).host;
        } catch (_error) {
            return url;
        }
    })();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
        response = await fetch(url, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
    } catch (_error) {
        throw new Error(`Could not reach ${host}. Check the internet connection.`);
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        const error = new Error(`${host} answered ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
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
    const stack = pluginFontStack();
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    return {
        textColor: _pluginThemeColor(),
        theme,
        baseUrl: plugin.baseUrl,
        loadScript: url => loadPluginScript(new URL(url, plugin.baseUrl).href),
        parseTable: parsePluginTable,
        measureText: (text, options = {}) => pluginMeasureText(text, { ...options,
            resolvedFamily: !options.family || options.family === SF_PLUGIN_DEFAULT_FONT ? stack : options.family }),
        niceTicks: pluginNiceTicks,
        escapeXml: pluginEscapeXml,
        fetchJson: pluginFetchJson,
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
    return JSON.stringify([plugin.id, plugin.version, getPresentationTheme(), _pluginThemeColor(), pluginFontStack(), data, ...(box ? [box.width, box.height] : [])]);
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
    // A drawing with NaN or Infinity in its geometry would be kept as a valid picture with marks missing.
    const geometry = ["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points", "transform", "viewBox"];
    const broken = [svg, ...svg.querySelectorAll("*")].find(node =>
        geometry.some(name => /\b(NaN|Infinity)\b/.test(node.getAttribute(name) || "")),
    );
    if (broken) throw new Error("The plugin drew invalid coordinates (NaN); check the data for a range of zero width");
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

// ─── The theme's font inside the pictures ───────────────────────────────────────
// A drawing shown as a picture cannot use the page's web fonts: the faces it uses are put inside it (the latin
// woff2 files, fetched once) where it is shown or exported. The saved drawing stays small and font-free.
const _sfFontFiles = new Map();
const _sfPicturesWithFonts = new Map();
const _sfPicturesWithFontsReady = new Map();

function _pluginFontFaces() {
    const faces = [];
    const walk = sheet => {
        let rules = null;
        try {
            rules = sheet.cssRules;
        } catch (_error) {
            return;
        }
        for (const rule of rules || []) {
            if (rule.styleSheet) walk(rule.styleSheet);
            else if (rule instanceof CSSFontFaceRule) {
                const url = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+\.woff2)["']?\)/)?.[1];
                const range = rule.style.getPropertyValue("unicode-range");
                if (!url || (range && !/U\+0+-/i.test(range))) continue;
                faces.push({
                    family: rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim().toLowerCase(),
                    weight: Number(rule.style.getPropertyValue("font-weight")) || 400,
                    italic: /italic/i.test(rule.style.getPropertyValue("font-style")),
                    url: new URL(url, rule.parentStyleSheet?.href || document.baseURI).href,
                });
            }
        }
    };
    [...document.styleSheets].forEach(walk);
    return faces;
}

function _fontFileAsDataUrl(url) {
    if (!_sfFontFiles.has(url)) {
        _sfFontFiles.set(
            url,
            fetch(url)
                .then(response => (response.ok ? response.arrayBuffer() : null))
                .then(buffer => {
                    if (!buffer) return "";
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                    return `data:font/woff2;base64,${btoa(binary)}`;
                })
                .catch(() => ""),
        );
    }
    return _sfFontFiles.get(url);
}

async function pluginPictureWithFonts(picture) {
    if (!String(picture || "").startsWith("data:image/svg+xml")) return picture;
    if (_sfPicturesWithFonts.has(picture)) return _sfPicturesWithFonts.get(picture);
    const job = (async () => {
        const comma = picture.indexOf(",");
        const head = picture.slice(0, comma);
        const svgText = /;base64/i.test(head) ? decodeURIComponent(escape(atob(picture.slice(comma + 1)))) : decodeURIComponent(picture.slice(comma + 1));
        const family = pluginFontStack().split(",")[0].replace(/["']/g, "").trim().toLowerCase();
        if (pluginFontStack() === SF_PLUGIN_DEFAULT_FONT || !svgText.toLowerCase().includes(family) || svgText.includes("@font-face")) return picture;
        const available = _pluginFontFaces().filter(face => face.family === family);
        if (!available.length) return picture;
        const weights = new Set([400, ...[...svgText.matchAll(/font-weight="(\d+)"/g)].map(match => Number(match[1]))]);
        const styles = /font-style="italic"/.test(svgText) ? [false, true] : [false];
        const chosen = new Map();
        styles.forEach(italic => {
            const faces = available.filter(face => face.italic === italic);
            weights.forEach(weight => {
                const nearest = faces.sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
                if (nearest) chosen.set(nearest.url, nearest);
            });
        });
        const rules = await Promise.all(
            [...chosen.values()].map(async face => {
                const data = await _fontFileAsDataUrl(face.url);
                return data ? `@font-face{font-family:'${pluginFontStack().split(",")[0].replace(/["']/g, "").trim()}';font-weight:${face.weight};font-style:${face.italic ? "italic" : "normal"};src:url(${data}) format('woff2');}` : "";
            }),
        );
        const css = rules.join("");
        if (!css) return picture;
        const open = svgText.indexOf(">", svgText.indexOf("<svg"));
        if (open < 0) return picture;
        return _svgDataUrl(`${svgText.slice(0, open + 1)}<style>${css}</style>${svgText.slice(open + 1)}`);
    })().catch(() => picture);
    _sfPicturesWithFonts.set(picture, job);
    job.then(result => {
        _sfPicturesWithFontsReady.set(picture, result);
        if (_sfPicturesWithFontsReady.size > 150) {
            const oldest = _sfPicturesWithFontsReady.keys().next().value;
            _sfPicturesWithFontsReady.delete(oldest);
            _sfPicturesWithFonts.delete(oldest);
        }
    });
    return job;
}

// Shows a drawing in an <img>: with its fonts at once when they are ready, else plain until they are.
function _setPluginPicture(img, picture) {
    img.dataset.picture = picture;
    const ready = _sfPicturesWithFontsReady.get(picture);
    if (ready) {
        if (img.getAttribute("src") !== ready) img.src = ready;
        return;
    }
    if (img.getAttribute("src") !== picture) img.src = picture;
    pluginPictureWithFonts(picture).then(withFonts => {
        if (img.dataset.picture === picture && withFonts !== picture) img.src = withFonts;
    });
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
    const context = _pluginRenderContext(plugin, elData);
    const stack = pluginFontStack();
    if (!_sfPluginDrawings.has(key)) {
        const drawing = (async () => {
            await _loadPluginFont(stack);
            const result = await plugin.render(data, context);
            const raw = typeof result === "string" ? result : new XMLSerializer().serializeToString(result);
            const svgText = cleanPluginSvg(raw.split(`font-family="${SF_PLUGIN_DEFAULT_FONT}"`).join(`font-family="${stack}"`));
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

function getPluginElementNotice(id) {
    return _sfPluginNotices.get(id) || "";
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
    if (elData.pluginPreview) _setPluginPicture(img, elData.pluginPreview);
    box.appendChild(img);
    const note = document.createElement("div");
    note.className = "plugin-element-note";
    note.hidden = true;
    box.appendChild(note);
    host.appendChild(box);

    const showNote = text => {
        note.textContent = text;
        note.hidden = !text;
        // A lookup or first drawing in progress is not an error.
        note.classList.toggle("plugin-element-note--busy", text === "Looking up…" || text === "Drawing…");
        box.classList.toggle("plugin-element-content--empty", Boolean(text) && !img.getAttribute("src"));
    };
    if (!elData.pluginPreview) showNote(_sfPluginNotices.get(elData.id) === "Looking up…" ? "Looking up…" : "Drawing…");
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
                const stored = _findPluginElementInState(elData.id);
                if (!stored || _pluginPreviewKey(plugin, normalizePluginData(plugin, stored.pluginData), stored) !== drawing.key) return;
                _sfPluginErrors.delete(elData.id);
                showNote("");
                box.classList.remove("plugin-element-content--error");
                if (img.dataset.picture !== drawing.dataUrl) _setPluginPicture(img, drawing.dataUrl);
                // autoHeight plugins (wrapped text) set the box's height to what they drew, outside undo. Whichever copy
                // draws first: when the slide thumbnail redrew for a new width first, it stored the drawing, the editor's
                // copy then had nothing new to draw, and the box kept its old height.
                const drawnForThisWidth = stored && Math.abs(parseFloat(source.width) - parseFloat(stored.width)) <= 0.5;
                if (plugin.sizeAware && plugin.autoHeight && drawnForThisWidth && Math.abs(parseFloat(stored.height) - drawing.height) > 1) {
                    stored.height = `${Math.round(drawing.height)}px`;
                    host.style.height = stored.height;
                    const main = [...document.querySelectorAll(`[id="${stored.id}"]`)].find(node => !node.closest("#slide-previews"));
                    if (main) main.style.height = stored.height;
                    if (state.selectedIds?.includes(stored.id) && typeof updateGroupBound === "function") updateGroupBound();
                    if (typeof syncPanelGeometryFields === "function") syncPanelGeometryFields();
                }
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
                // A failed lookup explains a failed drawing better (a compound name is no SMILES string).
                const message = _sfPluginNotices.get(elData.id) || String(error?.message || error || "Could not draw");
                // While a lookup runs the drawing cannot be made yet: that is shown, but it is not an error.
                if (message === "Looking up…") {
                    showNote(message);
                    return;
                }
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
        // The panel's "Press Enter to redraw" does not apply here: Enter inserts (or applies).
        hint: String(field.hint || "").replace(/\s*Press Enter to [^.]*\.\s*/gi, " ").trim(),
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

// The newest lookup per element: an older one that finishes later must not undo what a newer one found.
const _sfPluginPrepareSeq = new Map();

function _rebuildPluginPanel(id) {
    if (!state.selectedIds?.includes(id) || typeof buildPropertiesPanel !== "function") return;
    // Rebuilding while the user types in the panel would throw away what they are typing: update the notice only.
    const focused = document.activeElement;
    if (focused?.closest?.("#properties-panel") && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) {
        const notice = document.getElementById("prop-plugin-notice");
        const text = getPluginElementNotice(id);
        if (notice) {
            notice.textContent = text;
            notice.hidden = !text;
            notice.className = text === "Looking up…" ? "plugin-panel-notice" : "plugin-panel-error";
        }
        return;
    }
    buildPropertiesPanel();
}

// Runs a plugin's lookup for settings already saved in the element, then merges what it found into the element as
// it is by then. The typed value stays in place meanwhile, and later edits are not overwritten: the result is
// dropped when the looked-up settings (inputKeys) changed since, or the object is gone (deleted, undone, another
// project opened).
async function _runPluginPrepare(id, plugin, next, previous, inputKeys, { refresh = false } = {}) {
    if (typeof plugin.prepare !== "function") return;
    const seq = (_sfPluginPrepareSeq.get(id) || 0) + 1;
    _sfPluginPrepareSeq.set(id, seq);
    _sfPluginDropped.delete(id); // a newer lookup replaces any answer kept for an undo/redo
    _sfPluginNotices.set(id, "Looking up…");
    _rebuildPluginPanel(id);
    let prepared = null;
    let notice = "";
    try {
        const result = await plugin.prepare({ ...next }, previous ? { ...previous } : null, { ..._pluginRenderContext(plugin), refresh });
        prepared = normalizePluginData(plugin, result || next);
    } catch (error) {
        console.warn(`${plugin.name}: lookup failed`, error);
        notice = String(error?.message || error);
    }
    const latest = _sfPluginPrepareSeq.get(id) === seq;
    if (!_findPluginElementInState(id)) {
        // Gone (undone, deleted, another project). Kept for a redo that brings it back with these settings.
        if (latest) {
            _sfPluginNotices.delete(id);
            if (_sfPluginDropped.size > 50) _sfPluginDropped.clear();
            _sfPluginDropped.set(id, { next, previous, inputKeys, prepared, notice, absent: true });
        }
        return;
    }
    _applyPreparedResult(id, plugin, { next, inputKeys, prepared, notice, latest });
}

const _samePluginValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Merges what a lookup found into the element as it is now, if the settings it was for are unchanged.
function _applyPreparedResult(id, plugin, { next, inputKeys, prepared, notice, latest = true }) {
    const el = _findPluginElementInState(id);
    if (!el) return;
    const current = normalizePluginData(plugin, el.pluginData);
    const stale = !latest || inputKeys.some(key => !_samePluginValue(current[key], next[key]));
    if (latest) {
        if (notice && !stale) _sfPluginNotices.set(id, notice);
        else _sfPluginNotices.delete(id);
        // Undo replaced the settings this answer is for: keep it, in case redo brings them back.
        if (stale && (prepared || notice)) {
            if (_sfPluginDropped.size > 50) _sfPluginDropped.clear();
            _sfPluginDropped.set(id, { next, inputKeys, prepared, notice, absent: false });
        }
    }
    if (!stale && prepared) {
        const found = Object.keys(prepared).filter(key => !_samePluginValue(prepared[key], next[key]));
        if (found.length) {
            el.pluginData = normalizePluginData(plugin, { ...current, ...Object.fromEntries(found.map(key => [key, prepared[key]])) });
            _sfPluginErrors.delete(id);
        }
    }
    renderSlidesFromState();
    _rebuildPluginPanel(id);
    if (typeof refreshPreviews === "function") refreshPreviews();
}

// Lookups that finished while their object was gone. When undo/redo brings the object back, its answer is applied
// if it still fits the restored settings; otherwise the lookup runs again (redo restored a citation without the
// details it was waiting for, and with no way to look them up).
const _sfPluginDropped = new Map();
window.addEventListener("slideforge:render-complete", () => {
    if (!_sfPluginDropped.size) return;
    [..._sfPluginDropped].forEach(([id, entry]) => {
        const el = _findPluginElementInState(id);
        if (!el) return;
        const plugin = getSlidePlugin(el.pluginId);
        if (!plugin) return;
        const current = normalizePluginData(plugin, el.pluginData);
        const fits = entry.inputKeys.every(key => _samePluginValue(current[key], entry.next[key]));
        // An answer kept after undo waits until redo restores the settings it is for.
        if (!fits && !entry.absent) return;
        _sfPluginDropped.delete(id);
        // After this render has finished: applying a result renders again.
        setTimeout(() => {
            if (fits) _applyPreparedResult(id, plugin, { ...entry, latest: true });
            else _runPluginPrepare(id, plugin, current, entry.previous, entry.inputKeys);
        }, 0);
    });
});

// Inserts a plugin object on the current slide: placed at once (with "Looking up…" while a lookup runs), then
// drawn and given its drawing's shape. Resolves to its id once it is drawn. The slide is fixed when insertion
// starts: switching slides during a slow lookup used to move the new object to the slide shown at the end.
async function insertPluginElement(pluginId, data = null, { ask = true } = {}) {
    const plugin = getSlidePlugin(pluginId);
    if (!plugin) return null;
    const defaults = { ...plugin.defaultData };
    if (Number.isFinite(Number(defaults.fontSize))) defaults.fontSize = Math.max(18, Number(defaults.fontSize));
    let pluginData = normalizePluginData(plugin, data ? { ...defaults, ...data } : defaults);
    if (ask && plugin.askOnInsert !== false) {
        pluginData = await _askPluginPrimaryValue(plugin, pluginData, { inserting: true });
        if (!pluginData) return null;
        pluginData = normalizePluginData(plugin, pluginData);
    }
    const slide = state.slides[typeof currentSlideIndex !== "undefined" ? currentSlideIndex : 0];
    if (!slide) return null;
    saveStateToUndo();
    const id = generateId("el");
    const box = _pluginBoxSize(plugin, null);
    const element = {
        id,
        type: "plugin",
        pluginId,
        pluginData,
        pluginPreview: "",
        pluginSurfaceMode: plugin.insert?.fill ? "theme" : "transparent",
        pluginPreviewKey: "",
        x: 200,
        y: 160,
        width: `${box.width}px`,
        height: `${box.height}px`,
        styles: { zIndex: getNextZIndex(), backgroundColor: "transparent" },
    };
    syncElementSurface(element, slide);
    const fill = plugin.insert?.fill && slide === state.slides[currentSlideIndex] && _pluginSlideHasOnlyTitle(slide) && _pluginContentArea(slide, id);
    if (fill) {
        // It takes the empty content placeholder's place.
        slide.elements = slide.elements.filter(item => !(item?.placeholderRole === "content" && _isEmptyTextElement(item)));
        Object.assign(element, fill);
        slide.elements.push(element);
    } else {
        slide.elements.push(typeof placeWhereFree === "function" ? placeWhereFree(slide, element) : element);
    }
    const placed = { width: element.width, height: element.height };
    renderSlidesFromState();
    selectElement(id);

    await _runPluginPrepare(id, plugin, pluginData, null, Object.keys(pluginData));
    const current = _findPluginElementInState(id);
    if (!current) return id;
    let drawing = null;
    try {
        drawing = await drawPluginElement(current);
    } catch (error) {
        console.warn(`${plugin.name}: inserted, but not drawn:`, error);
        return id;
    }
    const el = _findPluginElementInState(id);
    if (!el) return id;
    // The box takes the drawing's shape (within the placed box, centred there), unless it was resized meanwhile.
    if (el.width === placed.width && el.height === placed.height) {
        const w = parseFloat(placed.width);
        const h = parseFloat(placed.height);
        if (plugin.sizeAware) {
            if (plugin.autoHeight) el.height = `${Math.round(drawing.height)}px`;
        } else if (drawing.width && drawing.height) {
            let scale = Math.min(w / drawing.width, h / drawing.height);
            // A drawing much wider (or taller) than the default box, such as a reaction scheme, keeps about the box's
            // area instead of shrinking into it (a reaction came in 300 × 85), within the slide's content width.
            const lost = (drawing.width * scale * drawing.height * scale) / (w * h) < 0.7;
            const bounds = lost && typeof _getSlideInsertBounds === "function" ? _getSlideInsertBounds() : null;
            if (bounds) {
                const area = Math.sqrt((w * h * 0.85) / (drawing.width * drawing.height));
                scale = Math.min(area, (bounds.slideW - bounds.margin * 2) / drawing.width, (bounds.slideH * 0.6) / drawing.height);
            }
            const fitted = { width: Math.round(drawing.width * scale), height: Math.round(drawing.height * scale) };
            el.x = Math.round((parseFloat(el.x) || 0) + (w - fitted.width) / 2);
            el.y = Math.round((parseFloat(el.y) || 0) + (h - fitted.height) / 2);
            el.width = `${fitted.width}px`;
            el.height = `${fitted.height}px`;
            // Grown, it goes where it covers the least of the slide (it would hang over the edge or the footer).
            const slide = state.slides.find(item => (item.elements || []).includes(el));
            if (bounds && slide === state.slides[currentSlideIndex] && typeof placeWhereFree === "function") placeWhereFree(slide, el, { claim: false });
        }
    }
    // The picture kept in the element, for its final box (thumbnails and exports use it).
    try {
        const finalDrawing = await drawPluginElement(el);
        if (_pluginPreviewKey(plugin, normalizePluginData(plugin, el.pluginData), el) === finalDrawing.key) {
            el.pluginPreview = finalDrawing.dataUrl;
            el.pluginPreviewKey = finalDrawing.key;
        }
    } catch (_error) {}
    renderSlidesFromState();
    return id;
}

// Changes some of an element's plugin settings, as one undo step. The change shows at once; a lookup the plugin
// does for it (prepare) runs afterwards and fills in what it finds.
async function updatePluginElementData(id, updates) {
    const el = _findPluginElementInState(id);
    const plugin = getSlidePlugin(el?.pluginId);
    if (!el || !plugin) return;
    const previous = normalizePluginData(plugin, el.pluginData);
    let next = normalizePluginData(plugin, { ...(el.pluginData || {}), ...updates });
    // New table data (typed, pasted or loaded from a CSV): the plugin may take labels from its header row, so a loaded
    // "Dose (mg)" does not stay under the example's "Dose (µM)" (study 2026-10-16b).
    if (typeof plugin.onTableData === "function") {
        plugin.fields
            .filter(field => field.type === "table" && field.key in updates && updates[field.key] !== previous[field.key])
            .forEach(field => {
                try {
                    const extra = plugin.onTableData(field.key, parsePluginTable(next[field.key]), next, previous);
                    if (extra && typeof extra === "object") next = normalizePluginData(plugin, { ...next, ...extra });
                } catch (error) {
                    console.warn(`${plugin.name}: labels not taken from the table:`, error);
                }
            });
    }
    saveStateToUndo();
    el.pluginData = next;
    _sfPluginErrors.delete(id);
    renderSlidesFromState();
    _rebuildPluginPanel(id);
    if (typeof refreshPreviews === "function") refreshPreviews();
    await _runPluginPrepare(id, plugin, next, previous, Object.keys(updates));
}

// "Fill content area": the object takes the slide's width between the margins, from under the title band (text that
// starts in the top third of the slide) down to the footer. Plots inserted on a busy slide came out small.
function fitPluginElementToContentArea(id) {
    const slide = state.slides?.[currentSlideIndex];
    const el = slide?.elements?.find(item => item.id === id);
    const area = _pluginContentArea(slide, id);
    if (!el || !area) return;
    saveStateToUndo();
    Object.assign(el, area);
    renderSlidesFromState();
    selectElement(id);
    if (typeof refreshPreviews === "function") refreshPreviews();
}

// The content area of the current slide (see above), as x, y, width and height, leaving out the object `id`.
function _pluginContentArea(slide, id) {
    const excluded = id instanceof Set ? id : new Set([id]);
    if (!slide || typeof _getSlideInsertBounds !== "function") return null;
    const { slideW, slideH, margin } = _getSlideInsertBounds();
    const footerTop = typeof _currentSlideFooterTop === "function" ? _currentSlideFooterTop() : null;
    // A reference placed as a footnote (still in the lower half) is the floor instead of the footer.
    const footnoteTops = slide.elements
        .filter(item => !excluded.has(item.id) && item.placedAsFootnote && (parseFloat(item.y) || 0) > slideH / 2)
        .map(item => (parseFloat(item.y) || 0) - 12);
    const floor = Math.min(footerTop === null ? slideH - margin : footerTop - 12, ...footnoteTops);
    const titleBottoms = slide.elements
        .filter(item => !excluded.has(item.id) && item.type === "text" && !item.isMasterElement && !item.editableMasterFooterElement &&
            !(item.placeholderRole === "content" && typeof _isEmptyTextElement === "function" && _isEmptyTextElement(item)) &&
            ((parseFloat(item.y) || 0) < slideH / 3 || /title|subtitle/.test(item.placeholderRole || item.placeholder || "")))
        .map(item => {
            const node = [...document.querySelectorAll(`[id="${item.id}"]`)].find(n => !n.closest("#slide-previews"));
            const height = parseFloat(item.height) || node?.offsetHeight || 0;
            return (parseFloat(item.y) || 0) + height;
        });
    const top = Math.round(Math.max(margin, ...titleBottoms.map(bottom => bottom + 16)));
    return {
        x: Math.round(margin),
        y: top,
        width: `${Math.round(slideW - margin * 2)}px`,
        height: `${Math.round(Math.max(80, floor - top))}px`,
    };
}

// A plot (insert.fill) inserted on a slide with nothing on it but a title at the top, an empty content placeholder
// and the footer takes the content area, instead of coming in small above the footer to be sized by hand. A title
// slide (title in the middle) is left alone.
function _pluginSlideHasOnlyTitle(slide) {
    const { slideH } = typeof _getSlideInsertBounds === "function" ? _getSlideInsertBounds() : { slideH: 768 };
    return (slide?.elements || []).every(item =>
        !item ||
        item.isMasterElement ||
        item.editableMasterFooterElement ||
        (item.placeholderRole === "content" && typeof _isEmptyTextElement === "function" && _isEmptyTextElement(item)) ||
        (item.type === "text" && (parseFloat(item.y) || 0) < slideH / 5));
}

// "Place as footnote" (plugins with footnote: true, such as the citation): across the slide between the margins,
// its last line just above the footer, where a reference goes on a research slide. It used to be placed by typing
// X, Y and W.
async function placePluginElementAsFootnote(id) {
    const slide = state.slides?.[currentSlideIndex];
    const el = slide?.elements?.find(item => item.id === id);
    if (!el || typeof _getSlideInsertBounds !== "function") return;
    const { slideW, slideH, margin } = _getSlideInsertBounds();
    const footerTop = typeof _currentSlideFooterTop === "function" ? _currentSlideFooterTop() : null;
    const floor = footerTop === null ? slideH - margin : footerTop - 8;
    saveStateToUndo();
    el.x = Math.round(margin);
    el.width = `${Math.round(slideW - margin * 2)}px`;
    // The text's height at the new width, so its last line sits on the floor.
    let height = parseFloat(el.height) || 40;
    try {
        height = Math.round((await drawPluginElement(el)).height) || height;
    } catch (_error) {
        // Not drawable yet (a lookup still running): placed with its current height.
    }
    el.height = `${height}px`;
    el.y = Math.round(Math.max(margin, floor - height));
    el.placedAsFootnote = true;
    // Plots and charts reaching down into the footnote's band end just above it instead of under it.
    const limit = el.y - 12;
    slide.elements.forEach(item => {
        if (item === el || item.isMasterElement || item.editableMasterFooterElement) return;
        if (!(item.type === "chart" || (item.type === "plugin" && getSlidePlugin(item.pluginId)?.sizeAware && !getSlidePlugin(item.pluginId)?.footnote))) return;
        const top = parseFloat(item.y) || 0;
        const bottom = top + (parseFloat(item.height) || 0);
        if (bottom > limit && top < limit - 60) item.height = `${Math.round(limit - top)}px`;
    });
    renderSlidesFromState();
    selectElement(id);
    if (typeof refreshPreviews === "function") refreshPreviews();
}

// "Look up again": the plugin's lookup for the settings as they are (after a failed or old lookup).
async function refreshPluginElement(id) {
    const el = _findPluginElementInState(id);
    const plugin = getSlidePlugin(el?.pluginId);
    if (!el || !plugin || typeof plugin.prepare !== "function") return;
    const current = normalizePluginData(plugin, el.pluginData);
    await _runPluginPrepare(id, plugin, current, null, Object.keys(current), { refresh: true });
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

// Categories in the order the menu shows them; a plugin names its own (insert.category), others go under "Other".
const SF_PLUGIN_MENU_CATEGORIES = ["Chemistry", "Biology", "Statistics", "Physics & maths", "Figures & references"];

function _pluginMenuLabel(plugin) {
    return String(plugin.insert?.label || plugin.name);
}

function _pluginMenuCategory(plugin) {
    return String(plugin.insert?.category || "").trim() || "Other";
}

// What a plugin search looks through, for a registered plugin and/or a catalogue entry (the manager lists
// plugins whose script has not run): name and label, description, keywords, category, author and id.
function pluginSearchText(entry) {
    const plugin = getSlidePlugin(entry?.id) || _sfPluginDefinitions.get(entry?.id) || entry || {};
    return [
        entry?.id,
        entry?.name,
        plugin.name,
        plugin.insert?.label,
        entry?.description,
        plugin.description,
        plugin.insert?.keywords,
        plugin.insert?.category || entry?.category,
        entry?.author,
    ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
}

// Every word of the query appears somewhere in the text ("forest plot", "box violin").
function pluginSearchMatches(text, query) {
    const words = String(query || "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return words.every(word => text.includes(word));
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

    // A search box: with 25 plugins the list ran far below the window.
    const search = document.createElement("input");
    search.type = "search";
    search.className = "plugin-insert-search";
    search.placeholder = "Search plugins…";
    search.setAttribute("aria-label", "Search plugins");
    search.autocomplete = "off";
    menu.appendChild(search);
    const list = document.createElement("div");
    list.className = "plugin-insert-list";
    menu.appendChild(list);

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
        return button;
    };
    const categoryRank = name => {
        const index = SF_PLUGIN_MENU_CATEGORIES.indexOf(name);
        return index === -1 ? SF_PLUGIN_MENU_CATEGORIES.length : index;
    };
    const plugins = listSlidePlugins().sort(
        (a, b) =>
            categoryRank(_pluginMenuCategory(a)) - categoryRank(_pluginMenuCategory(b)) ||
            _pluginMenuCategory(a).localeCompare(_pluginMenuCategory(b)) ||
            _pluginMenuLabel(a).localeCompare(_pluginMenuLabel(b)),
    );

    // The list for a search: every word must appear in the label, description, keywords or category.
    const fill = () => {
        list.textContent = "";
        let lastCategory = null;
        let shown = 0;
        plugins.forEach(plugin => {
            if (!pluginSearchMatches(pluginSearchText(plugin), search.value)) return;
            const category = _pluginMenuCategory(plugin);
            if (category !== lastCategory) {
                const heading = document.createElement("div");
                heading.className = "sf-select-menu__group";
                heading.textContent = category;
                list.appendChild(heading);
                lastCategory = category;
            }
            const button = item(plugin.icon, _pluginMenuLabel(plugin), plugin.description);
            button.dataset.pluginInsert = plugin.id;
            button.onclick = () => {
                closePluginInsertMenu();
                // Inserted from the menu, the object's options are what you want next: show them.
                insertPluginElement(plugin.id).then(id => {
                    if (!id || typeof setPropertiesPanelVisible !== "function") return;
                    if (!document.getElementById("properties-panel")?.classList.contains("hidden")) return;
                    setPropertiesPanelVisible(true, { persist: false });
                    if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
                });
            };
            list.appendChild(button);
            shown++;
        });
        if (!shown) {
            const empty = document.createElement("div");
            empty.className = "plugin-insert-empty";
            empty.textContent = plugins.length ? `No plugin matches “${search.value.trim()}”` : "No plugins are switched on";
            list.appendChild(empty);
        }
    };
    fill();
    search.addEventListener("input", fill);

    const separator = document.createElement("div");
    separator.className = "plugin-insert-separator";
    menu.appendChild(separator);
    const manage = item("fa-solid fa-sliders", "Manage plugins…", "Switch on or off, install, remove");
    manage.dataset.pluginManager = "";
    manage.onclick = () => {
        closePluginInsertMenu();
        window.openPluginManager?.();
    };
    menu.appendChild(manage);
    document.body.appendChild(menu);

    const place = () => {
        const rect = anchor.getBoundingClientRect();
        const width = menu.offsetWidth;
        menu.style.left = `${Math.max(6, Math.min(rect.right - width, window.innerWidth - width - 6))}px`;
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.maxHeight = `${Math.max(200, window.innerHeight - rect.bottom - 18)}px`;
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
            const all = items();
            const index = all.indexOf(document.activeElement);
            const next = event.key === "ArrowDown" ? index + 1 : index === -1 ? all.length - 1 : index - 1;
            if (next < 0) search.focus();
            else all[next % all.length]?.focus();
        } else if (event.key === "Enter" && document.activeElement === search) {
            // Enter in the search box inserts the first match.
            event.preventDefault();
            menu.querySelector(".plugin-insert-list [data-plugin-insert]")?.click();
        }
    };
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    anchor.setAttribute("aria-expanded", "true");
    _sfPluginMenu = { menu, anchor, onOutside, onKey, onResize: place };
    search.focus({ preventScroll: true });
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
    dataUrl = await pluginPictureWithFonts(dataUrl);
    const svgText = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    svg.setAttribute("width", String(Math.round(parseFloat(el.width) || 320)));
    svg.setAttribute("height", String(Math.round(parseFloat(el.height) || 240)));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return _svgDataUrl(new XMLSerializer().serializeToString(svg));
}

// While a slide is captured for PDF/PNG, each plugin picture is shown as a drawing the shape of its box, with the
// drawing centred in it. html2canvas ignores object-fit: contain, so pictures came out stretched to their box.
async function showPluginPicturesForCapture(slideNode) {
    const restored = [];
    for (const img of slideNode?.querySelectorAll(".plugin-element-content img[src^='data:image/svg+xml']") || []) {
        const width = img.clientWidth;
        const height = img.clientHeight;
        if (!width || !height) continue;
        try {
            const source = img.getAttribute("src");
            const svgText = decodeURIComponent(source.slice(source.indexOf(",") + 1));
            const svg = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(height));
            svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
            img.src = _svgDataUrl(new XMLSerializer().serializeToString(svg));
            await img.decode().catch(() => {});
            restored.push(() => {
                img.src = source;
            });
        } catch (error) {
            console.warn("Plugin picture captured as is:", error);
        }
    }
    return () => restored.forEach(restore => restore());
}

// Plugin objects in an export copy of the state become pictures (PowerPoint and the standalone viewer).
// text: true (PowerPoint) writes plugins that are only text (a citation) as text boxes, which a co-author can edit;
// as pictures, even a typo needed SlideForge.
async function replacePluginElementsWithPictures(exportState, { text = false } = {}) {
    for (const slide of exportState?.slides || []) {
        for (const [index, el] of (slide.elements || []).entries()) {
            if (el?.type !== "plugin") continue;
            const asText = text ? _pluginTextForExport(el) : null;
            if (asText) {
                slide.elements[index] = asText;
                continue;
            }
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

// A plugin's exportText(data) → { runs: [{ text, italic, bold }], fontSize, color } as a plain text element.
function _pluginTextForExport(el) {
    const plugin = getSlidePlugin(el.pluginId);
    if (typeof plugin?.exportText !== "function") return null;
    let result = null;
    try {
        result = plugin.exportText(normalizePluginData(plugin, el.pluginData));
    } catch (error) {
        console.warn(`${plugin.name}: exported as a picture:`, error);
    }
    const runs = (result?.runs || []).filter(run => run && String(run.text || ""));
    if (!runs.length) return null;
    const escape = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const html = runs
        .map(run => {
            let part = escape(run.text);
            if (run.italic) part = `<em>${part}</em>`;
            if (run.bold) part = `<strong>${part}</strong>`;
            return part;
        })
        .join("");
    const color = /^#[0-9a-f]{6}$/i.test(String(result.color || "")) ? result.color : _pluginThemeColor();
    return {
        id: el.id,
        type: "text",
        content: `<p>${html}</p>`,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        rotation: el.rotation,
        autoHeight: false,
        textFitMode: "fixed",
        styles: {
            fontSize: `${Number(result.fontSize) || 16}px`,
            color,
            fontFamily: "Arial, Helvetica, sans-serif",
            lineHeight: "1.35",
            textAlign: "left",
            backgroundColor: "transparent",
            zIndex: el.styles?.zIndex,
        },
        animation: el.animation || null,
        ...(el.fragment ? { fragment: el.fragment } : {}),
        ...(el.fragmentIndex !== undefined ? { fragmentIndex: el.fragmentIndex } : {}),
        exportedFrom: `plugin:${el.pluginId}`,
    };
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
        pluginSurfaceMode: ["theme", "transparent", "custom"].includes(el.pluginSurfaceMode) ? el.pluginSurfaceMode : "custom",
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
    searchText: pluginSearchText,
    searchMatches: pluginSearchMatches,
    loadScript: loadPluginScript,
    parseTable: parsePluginTable,
    measureText: pluginMeasureText,
    niceTicks: pluginNiceTicks,
    insert: insertPluginElement,
    update: updatePluginElementData,
    refresh: refreshPluginElement,
    fitToContentArea: fitPluginElementToContentArea,
    placeAsFootnote: placePluginElementAsFootnote,
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
