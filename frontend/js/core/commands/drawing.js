// Drawings made with Excalidraw. On the slide a drawing is an ordinary image element (so it moves, resizes,
// animates and exports like any picture) that also keeps its Excalidraw scene; double-clicking it reopens the
// drawing in Excalidraw. React and Excalidraw load the first time a drawing is opened.

const EXCALIDRAW_SCRIPTS = [
    "vendor/react/react.production.min.js",
    "vendor/react/react-dom.production.min.js",
    "vendor/excalidraw/excalidraw.production.min.js",
];
const DRAWING_EXPORT_SCALE = 2; // PNG pixels per slide pixel, so drawings stay sharp when presented
let _excalidrawLoading = null;
let _drawingEditor = null; // { root, overlay, api, elementId, initialVersion, resolve }

function loadExcalidraw() {
    if (window.ExcalidrawLib) return Promise.resolve(window.ExcalidrawLib);
    if (_excalidrawLoading) return _excalidrawLoading;
    // Fonts and the lazily loaded chunk live in vendor/excalidraw/excalidraw-assets/ (no CDN).
    window.EXCALIDRAW_ASSET_PATH = new URL("vendor/excalidraw/", document.baseURI).href;
    _excalidrawLoading = EXCALIDRAW_SCRIPTS.reduce(
        (chain, src) =>
            chain.then(
                () =>
                    new Promise((resolve, reject) => {
                        const script = document.createElement("script");
                        script.src = src;
                        script.onload = resolve;
                        script.onerror = () => reject(new Error(`Could not load ${src}`));
                        document.head.appendChild(script);
                    }),
            ),
        Promise.resolve(),
    )
        .then(() => window.ExcalidrawLib)
        .catch(error => {
            _excalidrawLoading = null;
            throw error;
        });
    return _excalidrawLoading;
}

function isDrawingEditorOpen() {
    return Boolean(_drawingEditor);
}

function _drawingElementData(id) {
    return (state.slides?.[currentSlideIndex]?.elements || []).find(el => el.id === id) || null;
}

function _buildDrawingEditorOverlay(isNew) {
    const overlay = document.createElement("div");
    overlay.id = "drawing-editor";
    overlay.className = "drawing-editor";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Drawing");
    overlay.innerHTML = `
        <div class="drawing-editor__panel">
            <header class="drawing-editor__bar">
                <div class="drawing-editor__title">
                    <span class="drawing-editor__icon"><i class="fa-solid fa-pen-ruler"></i></span>
                    <div>
                        <p class="drawing-editor__name">${isNew ? "New drawing" : "Edit drawing"}</p>
                        <p class="drawing-editor__hint">Draw with Excalidraw. Done places it on the slide; double-click it there to edit again.</p>
                    </div>
                </div>
                <div class="drawing-editor__actions">
                    <button type="button" class="drawing-editor__btn" data-drawing-action="cancel">Cancel</button>
                    <button type="button" class="drawing-editor__btn drawing-editor__btn--primary" data-drawing-action="done">
                        <i class="fa-solid fa-check"></i> Done
                    </button>
                </div>
            </header>
            <div class="drawing-editor__canvas">
                <div class="drawing-editor__loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading Excalidraw…</div>
            </div>
        </div>`;
    return overlay;
}

// A new drawing is drawn on the slide's own colour with the theme's text colour as ink, so it looks in the editor as
// it will on the slide (black ink on a white canvas was nearly invisible once placed on a dark slide). The saved
// picture has a transparent background either way.
// The picture a drawing shows on the slide: its strokes on a see-through background, at export scale.
async function _exportDrawingPicture(lib, elements, files, viewBackgroundColor) {
    const blob = await lib.exportToBlob({
        elements,
        files,
        appState: { exportBackground: false, viewBackgroundColor },
        mimeType: "image/png",
        exportPadding: 12,
        getDimensions: (width, height) => ({
            width: width * DRAWING_EXPORT_SCALE,
            height: height * DRAWING_EXPORT_SCALE,
            scale: DRAWING_EXPORT_SCALE,
        }),
    });
    return _blobToDataUrl(blob);
}

function _drawingColorLuminance(hex) {
    const match = String(hex || "").trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// After a theme change, strokes and words drawn in the old theme's text colour (or in Excalidraw's default black
// where it no longer reads) take the new theme's text colour, and the picture is drawn again. Drawings kept their
// black strokes on a dark theme, so they nearly disappeared. Other colours the user chose are left alone.
async function retintDrawingsForTheme(previousTheme, nextTheme) {
    const nextText = String(nextTheme?.defaultTextColor || "").toLowerCase();
    const previousText = String(previousTheme?.defaultTextColor || "").toLowerCase();
    if (!nextText) return 0;
    const backgroundColors = String(nextTheme.cssVars?.["--slide-bg"] || "").match(/#[0-9a-f]{6}\b/gi) || [];
    const background = backgroundColors[Math.floor(backgroundColors.length / 2)] || "#ffffff";
    const bgLum = _drawingColorLuminance(background) ?? 1;
    const unreadable = color => {
        const lum = _drawingColorLuminance(color);
        return lum !== null && (Math.max(lum, bgLum) + 0.05) / (Math.min(lum, bgLum) + 0.05) < 3;
    };
    const drawings = (state.slides || []).flatMap(slide => slide.elements || []).filter(el => el.type === "image" && el.excalidraw?.elements?.length);
    const changed = drawings.filter(el => {
        let touched = false;
        el.excalidraw.elements.forEach(item => {
            const stroke = String(item.strokeColor || "").toLowerCase();
            const isDefaultInk = stroke === "#1e1e1e" || stroke === "#000000";
            if ((stroke && stroke === previousText) || (isDefaultInk && unreadable(stroke))) {
                if (stroke !== nextText) {
                    item.strokeColor = nextTheme.defaultTextColor;
                    touched = true;
                }
            }
        });
        if (touched) el.excalidraw.appState = { ...(el.excalidraw.appState || {}), viewBackgroundColor: background };
        return touched;
    });
    if (!changed.length) return 0;
    let lib;
    try {
        lib = await loadExcalidraw();
    } catch (error) {
        console.warn("Drawings were not redrawn for the new theme:", error);
        return 0;
    }
    for (const el of changed) {
        try {
            el.content = await _exportDrawingPicture(lib, el.excalidraw.elements, el.excalidraw.files || {}, background);
        } catch (error) {
            console.warn("A drawing could not be redrawn for the new theme:", error);
        }
    }
    renderSlidesFromState?.();
    schedulePresentationAutosave?.(150);
    return changed.length;
}

window.retintDrawingsForTheme = retintDrawingsForTheme;

function _newDrawingColors() {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : {};
    const colors = String(theme.cssVars?.["--slide-bg"] || "").match(/#[0-9a-f]{6}\b/gi) || [];
    return {
        viewBackgroundColor: colors[Math.floor(colors.length / 2)] || "#ffffff",
        ...(theme.defaultTextColor ? { currentItemStrokeColor: theme.defaultTextColor } : {}),
    };
}

// Opens Excalidraw for a new drawing (no id) or for an existing drawing element.
async function openDrawingEditor(elementId = null) {
    if (_drawingEditor) return;
    const existing = elementId ? _drawingElementData(elementId) : null;
    const scene = existing?.excalidraw || null;
    const overlay = _buildDrawingEditorOverlay(!existing);
    document.body.appendChild(overlay);
    document.body.classList.add("drawing-editor-open");
    _drawingEditor = { overlay, root: null, api: null, elementId: existing?.id || null, initialVersion: 0 };
    const editor = _drawingEditor;

    overlay.querySelector('[data-drawing-action="cancel"]').addEventListener("click", event => _cancelDrawingEditor(event.currentTarget));
    overlay.querySelector('[data-drawing-action="done"]').addEventListener("click", () => _finishDrawingEditor());

    let lib;
    try {
        lib = await loadExcalidraw();
    } catch (error) {
        console.error(error);
        overlay.querySelector(".drawing-editor__loading").textContent = "Excalidraw could not be loaded.";
        return;
    }
    if (_drawingEditor !== editor) return; // closed while loading
    const host = overlay.querySelector(".drawing-editor__canvas");
    host.innerHTML = "";
    editor.initialVersion = lib.getSceneVersion(scene?.elements || []);
    editor.root = ReactDOM.createRoot(host);
    editor.root.render(
        React.createElement(lib.Excalidraw, {
            initialData: {
                elements: scene?.elements || [],
                files: scene?.files || {},
                appState: { ..._newDrawingColors(), currentItemFontFamily: 1, ...(scene?.appState || {}) },
                scrollToContent: true,
            },
            excalidrawAPI: api => {
                editor.api = api;
            },
            // The editor is modal and the app's shortcuts stand down while it is open, so tool keys (R, O, T…)
            // work straight away, without first clicking the canvas.
            handleKeyboardGlobally: true,
            langCode: "en",
            // Always Excalidraw's light theme: its dark theme inverts the canvas, so a drawing would look different
            // here than on the slide. The canvas already takes the slide's colour (see _newDrawingColors).
            theme: "light",
            name: "SlideForge drawing",
            UIOptions: {
                canvasActions: {
                    export: false,
                    loadScene: false,
                    saveAsImage: false,
                    saveToActiveFile: false,
                    toggleTheme: false,
                },
            },
        }),
    );
}

function _hasUnsavedDrawingChanges() {
    const editor = _drawingEditor;
    if (!editor?.api || !window.ExcalidrawLib) return false;
    return window.ExcalidrawLib.getSceneVersion(editor.api.getSceneElements()) !== editor.initialVersion;
}

function _closeDrawingEditor() {
    const editor = _drawingEditor;
    if (!editor) return;
    _drawingEditor = null;
    try {
        editor.root?.unmount();
    } catch (_err) {}
    editor.overlay.remove();
    document.body.classList.remove("drawing-editor-open");
}

// Cancel discards the drawing's changes; with changes, the first click asks again on the button itself.
function _cancelDrawingEditor(button) {
    if (_hasUnsavedDrawingChanges() && button && button.dataset.confirming !== "true") {
        button.dataset.confirming = "true";
        button.textContent = "Discard changes?";
        button.classList.add("drawing-editor__btn--danger");
        setTimeout(() => {
            if (!button.isConnected) return;
            delete button.dataset.confirming;
            button.textContent = "Cancel";
            button.classList.remove("drawing-editor__btn--danger");
        }, 3000);
        return;
    }
    _closeDrawingEditor();
}

function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Could not read the drawing"));
        reader.readAsDataURL(blob);
    });
}

// Only the image files the drawing still uses are kept with it.
function _usedDrawingFiles(elements, files) {
    const used = new Set(elements.filter(el => el.type === "image" && el.fileId).map(el => el.fileId));
    return Object.fromEntries(Object.entries(files || {}).filter(([id]) => used.has(id)));
}

async function _finishDrawingEditor() {
    const editor = _drawingEditor;
    if (!editor) return;
    if (!editor.api) {
        _closeDrawingEditor();
        return;
    }
    const lib = window.ExcalidrawLib;
    const elements = editor.api.getSceneElements();
    const existing = editor.elementId ? _drawingElementData(editor.elementId) : null;
    if (!elements.length) {
        // An emptied drawing is removed from the slide; an untouched new one adds nothing.
        _closeDrawingEditor();
        if (existing) {
            saveStateToUndo();
            state.slides[currentSlideIndex].elements = state.slides[currentSlideIndex].elements.filter(el => el.id !== existing.id);
            renderSlidesFromState();
            schedulePresentationAutosave?.();
        }
        return;
    }
    if (existing && !_hasUnsavedDrawingChanges()) {
        _closeDrawingEditor();
        return;
    }
    const doneButton = editor.overlay.querySelector('[data-drawing-action="done"]');
    doneButton.disabled = true;
    const files = _usedDrawingFiles(elements, editor.api.getFiles());
    const viewBackgroundColor = editor.api.getAppState().viewBackgroundColor;
    let dataUrl;
    try {
        dataUrl = await _exportDrawingPicture(lib, elements, files, viewBackgroundColor);
    } catch (error) {
        console.error(error);
        doneButton.disabled = false;
        setProjectSaveHint?.("The drawing could not be saved", "danger");
        return;
    }
    const size = await new Promise(resolve => {
        const probe = new Image();
        probe.onload = () => resolve({ width: probe.naturalWidth / DRAWING_EXPORT_SCALE, height: probe.naturalHeight / DRAWING_EXPORT_SCALE });
        probe.onerror = () => resolve({ width: 400, height: 300 });
        probe.src = dataUrl;
    });
    const sceneData = {
        version: 1,
        elements: JSON.parse(JSON.stringify(elements)),
        files,
        appState: { viewBackgroundColor },
        naturalWidth: size.width,
        naturalHeight: size.height,
    };
    _closeDrawingEditor();
    saveStateToUndo();
    const slide = state.slides[ensureActiveSlideSync()];
    if (existing) {
        // Keep the drawing's position and scale: added content makes the box grow, not the strokes shrink.
        const previousNatural = Number(existing.excalidraw?.naturalWidth) || size.width;
        const scale = (parseFloat(existing.width) || size.width) / previousNatural;
        const width = Math.max(24, Math.round(size.width * scale));
        const height = Math.max(24, Math.round(size.height * scale));
        Object.assign(existing, {
            content: dataUrl,
            excalidraw: sceneData,
            width: `${width}px`,
            height: `${height}px`,
            imageAspectRatio: size.width / Math.max(1, size.height),
            cropTransform: null,
        });
        renderSlidesFromState();
        selectElement(existing.id);
    } else {
        const placement = _getImageInsertPlacement(size.width, size.height, { center: true });
        const id = generateId("el");
        slide.elements.push(
            placeInContentPlaceholder(slide, {
                id,
                type: "image",
                content: dataUrl,
                excalidraw: sceneData,
                x: placement.x,
                y: placement.y,
                width: `${placement.width}px`,
                height: `${placement.height}px`,
                lockAspectRatio: true,
                imageAspectRatio: size.width / Math.max(1, size.height),
                heightSetManually: true,
                styles: { zIndex: getNextZIndex(), borderRadius: "0px", backgroundColor: "transparent" },
                animation: null,
            }),
        );
        renderSlidesFromState();
        selectElement(id);
    }
    schedulePresentationAutosave?.();
}

function addDrawing() {
    openDrawingEditor(null);
}

function editDrawing(elementId) {
    const el = _drawingElementData(elementId);
    if (el?.excalidraw) openDrawingEditor(elementId);
}

// The open drawing's current Excalidraw elements (null when no drawing is open or it is still loading).
window.getOpenDrawingElements = () => _drawingEditor?.api?.getSceneElements?.() || null;
window.loadExcalidraw = loadExcalidraw;
window.isDrawingEditorOpen = isDrawingEditorOpen;
window.openDrawingEditor = openDrawingEditor;
window.addDrawing = addDrawing;
window.editDrawing = editDrawing;
