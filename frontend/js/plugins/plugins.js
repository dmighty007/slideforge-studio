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
const SF_PLUGIN_FIELD_TYPES = new Set(["text", "textarea", "number", "color", "checkbox", "select"]);
const SF_PLUGIN_MAX_PREVIEW_LENGTH = 2000000;
const SF_PLUGIN_MAX_DATA_LENGTH = 100000;

const _sfPlugins = new Map();
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
        options: Array.isArray(field.options)
            ? field.options.map(option =>
                  typeof option === "object" ? { value: String(option.value), label: String(option.label ?? option.value) } : { value: String(option), label: String(option) },
              )
            : [],
    };
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
    _sfPlugins.set(id, plugin);
    _installPluginInsertControls(plugin);
    // Objects of this plugin that were drawn from their saved picture can now be drawn by the plugin itself.
    const used = (typeof state !== "undefined" && state?.slides ? state.slides : []).some(slide =>
        (slide.elements || []).some(el => el?.type === "plugin" && el.pluginId === id),
    );
    if (used && typeof renderSlidesFromState === "function") renderSlidesFromState();
    return plugin;
}

function getSlidePlugin(id) {
    return _sfPlugins.get(id) || null;
}

function listSlidePlugins() {
    return [..._sfPlugins.values()];
}

// Reads plugins/plugins.json and loads each listed plugin. One broken plugin does not stop the others.
async function loadSlidePlugins(manifestUrl = "plugins/plugins.json") {
    try {
        const response = await fetch(manifestUrl, { cache: "no-cache" });
        if (!response.ok) return [];
        const manifest = await response.json();
        const ids = (Array.isArray(manifest?.plugins) ? manifest.plugins : []).filter(id => SF_PLUGIN_ID_PATTERN.test(String(id)));
        const base = new URL(manifestUrl, document.baseURI);
        await Promise.all(
            ids.map(id =>
                loadPluginScript(new URL(`${id}/plugin.js`, base).href).catch(error => console.warn(`Plugin "${id}" not loaded:`, error)),
            ),
        );
        return ids;
    } catch (error) {
        console.warn("Plugins not loaded:", error);
        return [];
    } finally {
        _sfPluginsReadyResolve?.(listSlidePlugins());
    }
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function _pluginThemeColor() {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    return theme?.defaultTextColor || "#1f2937";
}

function _pluginRenderContext(plugin) {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    return {
        textColor: _pluginThemeColor(),
        theme,
        baseUrl: plugin.baseUrl,
        loadScript: url => loadPluginScript(new URL(url, plugin.baseUrl).href),
    };
}

function normalizePluginData(plugin, data) {
    const merged = { ...(plugin?.defaultData || {}), ...(data && typeof data === "object" ? data : {}) };
    return typeof plugin?.normalize === "function" ? plugin.normalize(merged) || merged : merged;
}

function _pluginPreviewKey(plugin, data) {
    return JSON.stringify([plugin.id, plugin.version, _pluginThemeColor(), data]);
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
    const key = _pluginPreviewKey(plugin, data);
    if (!_sfPluginDrawings.has(key)) {
        const drawing = (async () => {
            const result = await plugin.render(data, _pluginRenderContext(plugin));
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
                showNote(img.getAttribute("src") ? "" : `The “${elData.pluginId}” plugin is not installed`);
            }
        });
        return box;
    }

    drawPluginElement(elData)
        .then(drawing => {
            _sfPluginErrors.delete(elData.id);
            showNote("");
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

    if (interactive) {
        host.addEventListener("dblclick", () => {
            if (document.body.classList.contains("play-mode-active")) return;
            editPluginElement(elData.id);
        });
    }
    return box;
}

// ─── Inserting and editing ───────────────────────────────────────────────────

function _primaryPluginField(plugin) {
    return plugin.fields.find(field => field.primary) || plugin.fields.find(field => field.type === "text" || field.type === "textarea");
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
    if (ask) {
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
    const size = _pluginInsertSize(plugin, drawing);
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
        const next = await plugin.edit(normalizePluginData(plugin, el.pluginData), _pluginRenderContext(plugin));
        if (next) updatePluginElementData(id, next);
        return;
    }
    const next = await _askPluginPrimaryValue(plugin, normalizePluginData(plugin, el.pluginData));
    if (next) updatePluginElementData(id, next);
}

// A toolbar button in the plugin's group (a new "Plugins" group when it names none that exists), a command palette
// entry and a slash command.
function _installPluginInsertControls(plugin) {
    const insert = plugin.insert || {};
    const label = String(insert.label || plugin.name);
    const toolbar = document.querySelector("#insert-toolbar-row .insert-toolbar");
    if (toolbar && !toolbar.querySelector(`[data-plugin-insert="${plugin.id}"]`)) {
        const groupName = String(insert.group || "Plugins");
        let group = [...toolbar.querySelectorAll(".insert-group")].find(node => node.dataset.caption === groupName);
        if (!group) {
            group = document.createElement("div");
            group.className = "toolbar-cluster insert-group";
            group.setAttribute("role", "group");
            group.setAttribute("aria-label", groupName);
            group.dataset.caption = groupName;
            toolbar.appendChild(group);
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "toolbar-btn insert-tool-btn";
        button.dataset.pluginInsert = plugin.id;
        button.title = label;
        button.setAttribute("aria-label", label);
        const icon = document.createElement("i");
        icon.className = plugin.icon;
        button.appendChild(icon);
        button.onclick = () => insertPluginElement(plugin.id);
        group.appendChild(button);
    }
    const run = () => insertPluginElement(plugin.id);
    if (typeof COMMANDS !== "undefined" && Array.isArray(COMMANDS) && !COMMANDS.some(cmd => cmd.id === `add-plugin-${plugin.id}`)) {
        COMMANDS.push({
            id: `add-plugin-${plugin.id}`,
            title: `Add ${label}`,
            icon: plugin.icon.split(/\s+/).find(cls => cls.startsWith("fa-") && !["fa-solid", "fa-regular"].includes(cls)) || "fa-puzzle-piece",
            keywords: `plugin ${insert.keywords || ""}`,
            action: run,
        });
    }
    if (typeof SLASH_COMMANDS !== "undefined" && Array.isArray(SLASH_COMMANDS) && !SLASH_COMMANDS.some(cmd => cmd.id === `plugin-${plugin.id}`)) {
        SLASH_COMMANDS.push({
            id: `plugin-${plugin.id}`,
            label,
            detail: plugin.description || "Plugin object",
            icon: plugin.icon.split(/\s+/).find(cls => cls.startsWith("fa-") && !["fa-solid", "fa-regular"].includes(cls)) || "fa-puzzle-piece",
            run,
        });
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
    loadScript: loadPluginScript,
    insert: insertPluginElement,
    update: updatePluginElementData,
    edit: editPluginElement,
    draw: drawPluginElement,
};
window.insertPluginElement = insertPluginElement;

// Plugins load once the page's own scripts have run (their insert buttons go into the toolbar and command lists).
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => loadSlidePlugins());
} else {
    loadSlidePlugins();
}
