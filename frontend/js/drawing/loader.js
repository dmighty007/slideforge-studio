import { AnnotationEngine } from "../annotation/engine/AnnotationEngine.js";
import { AnnotationSerializer } from "../annotation/engine/AnnotationSerializer.js";
import { ExportRenderer } from "../annotation/renderers/ExportRenderer.js";
import { SvgStaticRenderer } from "../annotation/renderers/SvgStaticRenderer.js";
import { SCIENTIFIC_ANNOTATION_PRESETS } from "../annotation/objects/objectTypes.js";
import { RoughRenderer } from "./RoughRenderer.js";
import { StrokeRenderer } from "./StrokeRenderer.js";

let engine = null;
let escHandler = null;
let activeSlideKey = null;
let syncingFromSlide = false;
let resizeObserver = null;
let repositionTimer = null;
let livePersistTimer = null;
let whiteboardSessionUndoCaptured = false;
let exitingWhiteboard = false;
let radialMenuBound = false;
let whiteboardRenderedSize = null; // on-screen size of the slide the drawings are currently laid out for

const STROKE_SWATCHES = ["#1f2937", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#6741d9"];
const BG_SWATCHES = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#fff3bf", "#ffd43b"];
const WHITEBOARD_TOOLS = [
    { id: "select", icon: "fa-solid fa-arrow-pointer", label: "Select / Move", primary: true },
    { id: "pen", icon: "fa-solid fa-pen", label: "Pen", primary: true },
    { id: "highlighter", icon: "fa-solid fa-highlighter", label: "Highlighter", primary: true, mapsTo: "pen" },
    { id: "arrow", icon: "fa-solid fa-arrow-right", label: "Arrow", primary: true },
    { id: "callout", icon: "fa-regular fa-comment-dots", label: "Callout", primary: true, mapsTo: "rectangle" },
    { id: "lasso", icon: "fa-solid fa-object-group", label: "Lasso select", primary: true, mapsTo: "select" },
    { id: "eraser", icon: "fa-solid fa-eraser", label: "Eraser", primary: true },
    { id: "text", icon: "fa-solid fa-font", label: "Label" },
    { id: "rectangle", icon: "fa-regular fa-square", label: "Box emphasis" },
    { id: "ellipse", icon: "fa-regular fa-circle", label: "Molecule / ROI highlight" },
    { id: "line", icon: "fa-solid fa-minus", label: "Connector" },
    { id: "diamond", icon: "fa-solid fa-diamond", label: "Diamond" },
    { id: "triangle", icon: "fa-solid fa-play -rotate-90", label: "Triangle" },
    { id: "star", icon: "fa-regular fa-star", label: "Star" },
    { id: "curve", icon: "fa-solid fa-bezier-curve", label: "Curve" },
    { id: "curve_arrow", icon: "fa-solid fa-turn-up fa-rotate-90", label: "Curved Arrow" },
];

function getEngine() {
    if (!engine) engine = new AnnotationEngine("slideforge-whiteboard", { showGrid: false, allowPanZoom: false });
    return engine;
}

window.getWhiteboardEngine = getEngine;
window.isWhiteboardActive = () => isWhiteboardActive();
window.SlideForgeAnnotation = {
    ...(window.SlideForgeAnnotation || {}),
    AnnotationSerializer,
    ExportRenderer,
    SvgStaticRenderer,
    SCIENTIFIC_ANNOTATION_PRESETS,
};

function registerEscHandler() {
    if (escHandler) return;
    escHandler = e => {
        if (e.key !== "Escape" || !isWhiteboardActive()) return;
        if (e.target?.closest?.(".whiteboard-text-editor")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        exitWhiteboardMode({ preserveSelection: false });
    };
    document.addEventListener("keydown", escHandler, true);
}

function unregisterEscHandler() {
    if (!escHandler) return;
    document.removeEventListener("keydown", escHandler, true);
    escHandler = null;
}

function getStylePanel() {
    return document.getElementById("whiteboard-style-panel");
}

// Classic-script globals (including top-level let/const) resolve by bare name from this module.
// A static table avoids Function(), which the Content-Security-Policy blocks.
const GLOBAL_READERS = {
    currentSlideIndex: () => (typeof currentSlideIndex !== "undefined" ? currentSlideIndex : undefined),
    state: () => (typeof state !== "undefined" ? state : undefined),
    generateId: () => (typeof generateId !== "undefined" ? generateId : undefined),
    getNextZIndex: () => (typeof getNextZIndex !== "undefined" ? getNextZIndex : undefined),
    clearSelection: () => (typeof clearSelection !== "undefined" ? clearSelection : undefined),
};

function readGlobal(name, fallback = null) {
    try {
        const value = GLOBAL_READERS[name]?.();
        return value === undefined ? fallback : value;
    } catch (_err) {
        return fallback;
    }
}

function getActiveSlideIndex() {
    const index = readGlobal("currentSlideIndex", 0);
    return Number.isInteger(index) ? index : 0;
}

function getActiveSlideData() {
    const appState = readGlobal("state", null);
    return appState?.slides?.[getActiveSlideIndex()] || null;
}

function getActiveSlideElement() {
    const slide = getActiveSlideData();
    return (
        (slide?.id ? document.getElementById(slide.id) : null) ||
        document.querySelector(`.presentation-slide[data-slide-index="${getActiveSlideIndex()}"]`) ||
        document.querySelector(".reveal .slides section.present")
    );
}

function cloneElements(elements = []) {
    return JSON.parse(JSON.stringify(Array.isArray(elements) ? elements : []));
}

function getCallableGlobal(name) {
    const value = readGlobal(name, null);
    return typeof value === "function" ? value : null;
}

function closeWhiteboardBlockingOverlays() {
    window.closeExportMenu?.();
    window.closeUserMenu?.();
    window.closeLayersPopover?.();
    window.closeShapePicker?.();
    window.closeSymbolPicker?.();
    window.closeEquationModal?.();
    ["canvas-context-menu", "floating-text-toolbar", "floating-shape-toolbar", "floating-image-toolbar"].forEach(id => {
        document.getElementById(id)?.classList.add("hidden");
    });
    ["symbol-picker-modal", "shape-picker-modal"].forEach(id => {
        const modal = document.getElementById(id);
        if (modal) modal.style.display = "none";
    });
    document.getElementById("auth-menu")?.classList.add("hidden");
    document.getElementById("export-menu-dropdown")?.classList.remove("show");
}

function ensureWhiteboardRadialMenu() {
    let menu = document.getElementById("whiteboard-radial-menu");
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "whiteboard-radial-menu";
    menu.className = "whiteboard-radial-menu hidden";
    menu.innerHTML = `
        <button type="button" data-tool="select" title="Select"><i class="fa-solid fa-arrow-pointer"></i></button>
        <button type="button" data-tool="pen" title="Pen"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-tool="highlighter" title="Highlighter"><i class="fa-solid fa-highlighter"></i></button>
        <button type="button" data-tool="arrow" title="Arrow"><i class="fa-solid fa-arrow-right"></i></button>
        <button type="button" data-tool="callout" title="Callout"><i class="fa-regular fa-comment-dots"></i></button>
        <button type="button" data-tool="eraser" title="Eraser"><i class="fa-solid fa-eraser"></i></button>
    `;
    menu.addEventListener("click", event => {
        const button = event.target?.closest?.("button[data-tool]");
        if (!button) return;
        window.setWhiteboardTool?.(button.dataset.tool);
        menu.classList.add("hidden");
    });
    document.body.appendChild(menu);
    return menu;
}

function openWhiteboardRadialMenu(event) {
    if (!document.body.classList.contains("whiteboard-mode-active")) return;
    event.preventDefault();
    const menu = ensureWhiteboardRadialMenu();
    const margin = 12;
    const width = 244;
    const height = 48;
    menu.classList.remove("hidden");
    menu.style.left = `${Math.min(window.innerWidth - width - margin, Math.max(margin, event.clientX - width / 2))}px`;
    menu.style.top = `${Math.min(window.innerHeight - height - margin, Math.max(margin, event.clientY - height / 2))}px`;
}

function bindWhiteboardRadialMenu() {
    if (radialMenuBound) return;
    radialMenuBound = true;
    const canvas = document.getElementById("slideforge-whiteboard");
    canvas?.addEventListener("contextmenu", openWhiteboardRadialMenu);
    document.addEventListener("mousedown", event => {
        const menu = document.getElementById("whiteboard-radial-menu");
        if (!menu || menu.classList.contains("hidden") || menu.contains(event.target)) return;
        menu.classList.add("hidden");
    });
}

function makeElementId(prefix = "el") {
    const generator = getCallableGlobal("generateId");
    if (generator) return generator(prefix);
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function getNextSlideZIndex() {
    const getter = getCallableGlobal("getNextZIndex");
    if (getter) return getter();
    const slide = getActiveSlideData();
    const maxZ = Math.max(0, ...(slide?.elements || []).map(el => Number(el.styles?.zIndex) || 0));
    return maxZ + 1;
}

function normalizeBounds(bounds) {
    if (!bounds) return { x: 0, y: 0, width: 1, height: 1 };
    return {
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.max(1, Math.ceil(bounds.width)),
        height: Math.max(1, Math.ceil(bounds.height)),
    };
}

function localizeDrawingElement(el, bounds) {
    const copy = cloneElements([el])[0];
    if (copy.type === "freehand") {
        copy.points = (copy.points || []).map(point => ({ ...point, x: point.x - bounds.x, y: point.y - bounds.y }));
    } else {
        copy.x = (copy.x || 0) - bounds.x;
        copy.y = (copy.y || 0) - bounds.y;
    }
    return copy;
}

function globalizeDrawingElement(el, offsetX, offsetY, sourceElementId = "") {
    const copy = cloneElements([el])[0];
    copy.sourceElementId = sourceElementId || copy.sourceElementId || "";
    if (copy.type === "freehand") {
        copy.points = (copy.points || []).map(point => ({ ...point, x: point.x + offsetX, y: point.y + offsetY }));
    } else {
        copy.x = (copy.x || 0) + offsetX;
        copy.y = (copy.y || 0) + offsetY;
    }
    return copy;
}

function scaleDrawingElement(el, scaleX, scaleY) {
    const copy = cloneElements([el])[0];
    if (copy.type === "freehand") {
        copy.points = (copy.points || []).map(point => ({ ...point, x: point.x * scaleX, y: point.y * scaleY }));
    } else {
        copy.x = (copy.x || 0) * scaleX;
        copy.y = (copy.y || 0) * scaleY;
        if (copy.width !== undefined) copy.width *= scaleX;
        if (copy.height !== undefined) copy.height *= scaleY;
    }
    if (copy.fontSize !== undefined) copy.fontSize *= Math.max(scaleX, scaleY);
    return copy;
}

function pxNumber(value, fallback = 1) {
    const parsed = Number.parseFloat(String(value ?? "").replace("px", ""));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getSlideCoordinateTransform() {
    const slideEl = getActiveSlideElement();
    const rect = slideEl?.getBoundingClientRect?.();
    const config =
        typeof getPresentationPageSetupConfig === "function"
            ? getPresentationPageSetupConfig()
            : { width: rect?.width || 1024, height: rect?.height || 768 };
    const slideWidth = Math.max(1, Number(config.width) || 1024);
    const slideHeight = Math.max(1, Number(config.height) || 768);
    const renderedWidth = Math.max(1, rect?.width || slideWidth);
    const renderedHeight = Math.max(1, rect?.height || slideHeight);
    return {
        slideWidth,
        slideHeight,
        renderedWidth,
        renderedHeight,
        slideToCanvasX: renderedWidth / slideWidth,
        slideToCanvasY: renderedHeight / slideHeight,
        canvasToSlideX: slideWidth / renderedWidth,
        canvasToSlideY: slideHeight / renderedHeight,
    };
}

function scaleDrawingElements(elements = [], scaleX = 1, scaleY = 1) {
    return (Array.isArray(elements) ? elements : []).map(element => scaleDrawingElement(element, scaleX, scaleY));
}

function whiteboardSlideElementsToDrawingElements(slide) {
    const transform = getSlideCoordinateTransform();
    return scaleDrawingElements(
        AnnotationSerializer.annotationsToDrawingElements(AnnotationSerializer.slideToAnnotations(slide)),
        transform.slideToCanvasX,
        transform.slideToCanvasY,
    );
}

function drawingElementsToSlideElements(drawingElements, previousElements = []) {
    const previousById = new Map(previousElements.filter(el => el.type === "whiteboard").map(el => [el.id, el]));
    let nextZ = Math.max(getNextSlideZIndex(), Math.max(0, ...previousElements.map(el => Number(el.styles?.zIndex) || 0)) + 1);
    return drawingElements.map(drawingEl => {
        const bounds = normalizeBounds(getEngine().getElementBounds(drawingEl));
        const sourceId = drawingEl.sourceElementId || "";
        const previous = sourceId ? previousById.get(sourceId) : null;
        const id = previous?.id || sourceId || makeElementId("el");
        const localDrawing = localizeDrawingElement({ ...drawingEl, sourceElementId: id }, bounds);
        const zIndex = previous?.styles?.zIndex || nextZ++;
        return {
            id,
            type: "whiteboard",
            x: bounds.x,
            y: bounds.y,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            drawingElement: localDrawing,
            drawingViewBox: { width: bounds.width, height: bounds.height },
            styles: {
                ...(previous?.styles || {}),
                zIndex,
                backgroundColor: "transparent",
                borderRadius: "0px",
            },
            animation: previous?.animation || null,
            fragmentAnimation: previous?.fragmentAnimation || "none",
            fragmentIndex: previous?.fragmentIndex ?? null,
        };
    });
}

function migrateSlideAnnotationsIfNeeded(slide) {
    if (!slide) return [];
    const annotations = AnnotationSerializer.slideToAnnotations(slide);
    const migratedSketchIds = new Set(
        annotations
            .map(annotation => annotation.metadata?.sourceElementId)
            .filter(Boolean),
    );
    const sketchAnnotations = AnnotationSerializer.migrateLegacySketches(slide).filter(
        annotation => !migratedSketchIds.has(annotation.metadata?.sourceElementId),
    );
    const nextAnnotations = [...annotations, ...sketchAnnotations];
    AnnotationSerializer.commitAnnotationsToSlide(slide, nextAnnotations, { removeEmbeddedWhiteboards: true });
    return nextAnnotations;
}

function renderDrawingElementToCanvas(canvas, whiteboardObject) {
    const drawingElement = whiteboardObject?.drawingElement || whiteboardObject;
    if (!canvas || !drawingElement) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || Number.parseFloat(canvas.style.width) || canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, rect.height || Number.parseFloat(canvas.style.height) || canvas.parentElement?.clientHeight || 1);
    const viewBox = whiteboardObject?.drawingViewBox || { width, height };
    const scaleX = width / Math.max(1, Number(viewBox.width) || width);
    const scaleY = height / Math.max(1, Number(viewBox.height) || height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(scaleX, scaleY);
    ctx.globalAlpha *= drawingElement.opacity ?? 1;
    if (drawingElement.type === "freehand") {
        StrokeRenderer.drawInkStroke(ctx, drawingElement.points || [], drawingElement.strokeColor, drawingElement.strokeWidth);
    } else if (drawingElement.type === "text") {
        ctx.font = `${drawingElement.fontSize || 22}px ${drawingElement.fontFamily || '"Comic Sans MS", "Segoe Print", cursive'}`;
        ctx.fillStyle = drawingElement.strokeColor || "#1f2937";
        ctx.textBaseline = "alphabetic";
        String(drawingElement.text || "").split("\n").forEach((line, index) => {
            ctx.fillText(line, drawingElement.x || 0, (drawingElement.y || 0) + index * (drawingElement.fontSize || 22) * 1.25);
        });
    } else if (drawingElement.type === "draw_shape") {
        const style = {
            ...drawingElement,
            random: RoughRenderer.seededRandom(drawingElement.seed || 1),
            fillOpacity: drawingElement.fillStyle === "solid" ? 0.58 : 0.35,
        };
        if (drawingElement.shapeType === "rectangle") RoughRenderer.drawRoughRect(ctx, drawingElement.x, drawingElement.y, drawingElement.width, drawingElement.height, style);
        else if (drawingElement.shapeType === "diamond") RoughRenderer.drawRoughDiamond(ctx, drawingElement.x, drawingElement.y, drawingElement.width, drawingElement.height, style);
        else if (drawingElement.shapeType === "ellipse") RoughRenderer.drawRoughEllipse(ctx, drawingElement.x + drawingElement.width / 2, drawingElement.y + drawingElement.height / 2, Math.abs(drawingElement.width / 2), Math.abs(drawingElement.height / 2), style);
        else if (drawingElement.shapeType === "triangle") RoughRenderer.drawRoughTriangle(ctx, drawingElement.x, drawingElement.y, drawingElement.width, drawingElement.height, style);
        else if (drawingElement.shapeType === "star") RoughRenderer.drawRoughStar(ctx, drawingElement.x, drawingElement.y, drawingElement.width, drawingElement.height, style);
        else if (drawingElement.shapeType === "line") RoughRenderer.drawRoughLine(ctx, drawingElement.x, drawingElement.y, drawingElement.x + drawingElement.width, drawingElement.y + drawingElement.height, style);
        else if (drawingElement.shapeType === "arrow") RoughRenderer.drawRoughArrow(ctx, drawingElement.x, drawingElement.y, drawingElement.x + drawingElement.width, drawingElement.y + drawingElement.height, style);
        else if (drawingElement.shapeType === "curve") RoughRenderer.drawRoughCurve(ctx, drawingElement.x, drawingElement.y, drawingElement.x + drawingElement.width, drawingElement.y + drawingElement.height, style);
        else if (drawingElement.shapeType === "curve_arrow") RoughRenderer.drawRoughCurveArrow(ctx, drawingElement.x, drawingElement.y, drawingElement.x + drawingElement.width, drawingElement.y + drawingElement.height, style);
    }
    ctx.restore();
}

window.renderWhiteboardDrawingElement = renderDrawingElementToCanvas;

function persistWhiteboardToSlide({ renderSlide = false, finalizeActive = false, preserveSelection = true } = {}) {
    if (syncingFromSlide || !engine) return;
    if (finalizeActive) {
        engine.commitActiveTextEditor?.();
        engine.finalizeCurrentStroke?.();
    }
    const slide = getActiveSlideData();
    if (!slide) return;
    const previousElements = slide.elements || [];
    const drawingElements = engine.getElements();
    const selectedDrawingId = engine.selectedElementId;
    const transform = getSlideCoordinateTransform();
    const logicalDrawingElements = scaleDrawingElements(drawingElements, transform.canvasToSlideX, transform.canvasToSlideY);
    const annotations = AnnotationSerializer.drawingElementsToAnnotations(logicalDrawingElements);
    const whiteboardSlideElements = drawingElementsToSlideElements(logicalDrawingElements, previousElements);
    whiteboardSlideElements.forEach((slideElement, index) => {
        slideElement.annotationMirror = true;
        slideElement.annotationId = annotations[index]?.id || logicalDrawingElements[index]?.id || slideElement.id;
        if (annotations[index]) {
            annotations[index].metadata = {
                ...(annotations[index].metadata || {}),
                sourceElementId: slideElement.id,
                mirroredAsElement: true,
            };
        }
        if (engine.elements[index]) engine.elements[index].sourceElementId = slideElement.id;
    });
    AnnotationSerializer.commitAnnotationsToSlide(slide, annotations, { removeEmbeddedWhiteboards: false });
    slide.elements = [
        ...previousElements.filter(el => el.type !== "whiteboard"),
        ...whiteboardSlideElements,
    ];
    const selectedAnnotation = annotations.find(annotation => annotation.id === selectedDrawingId || annotation.id === logicalDrawingElements.find(el => el.id === selectedDrawingId)?.sourceAnnotationId);
    if (typeof window.schedulePresentationAutosave === "function") {
        window.schedulePresentationAutosave(250);
    }
    if (!renderSlide && isWhiteboardActive()) {
        return;
    }
    if (renderSlide && typeof window.renderSlidesFromState === "function") {
        window.renderSlidesFromState({ preserveState: true });
        if (preserveSelection && selectedAnnotation?.id) {
            requestAnimationFrame(() => {
                const mirror = whiteboardSlideElements.find(el => el.annotationId === selectedAnnotation.id || el.id === selectedAnnotation.metadata?.sourceElementId);
                if (mirror?.id && typeof window.selectElement === "function") window.selectElement(mirror.id);
            });
        }
        return;
    }
    if (typeof window.refreshActiveSlidePreview === "function") {
        window.refreshActiveSlidePreview();
    } else if (typeof window.renderSlidePreviews === "function") {
        window.renderSlidePreviews(getActiveSlideIndex());
    }
}

function scheduleLiveWhiteboardPersist() {
    if (!isWhiteboardActive()) return;
    if (livePersistTimer) clearTimeout(livePersistTimer);
    livePersistTimer = setTimeout(() => {
        livePersistTimer = null;
        persistWhiteboardToSlide({ renderSlide: false, finalizeActive: false });
    }, 180);
}

function syncWhiteboardFromSlide({ force = false } = {}) {
    const slide = getActiveSlideData();
    const key = slide?.id || `slide-${getActiveSlideIndex()}`;
    if (!force && activeSlideKey === key) return;
    activeSlideKey = key;
    syncingFromSlide = true;
    const annotations = migrateSlideAnnotationsIfNeeded(slide);
    // Saved drawings are in slide coordinates; the engine works in on-screen pixels (see persistWhiteboardToSlide).
    const transform = getSlideCoordinateTransform();
    getEngine().setElements(
        scaleDrawingElements(AnnotationSerializer.annotationsToDrawingElements(annotations), transform.slideToCanvasX, transform.slideToCanvasY),
    );
    whiteboardRenderedSize = { width: transform.renderedWidth, height: transform.renderedHeight };
    syncingFromSlide = false;
}

function isWhiteboardActive() {
    const container = document.getElementById("whiteboard-overlay-container");
    return !!container && container.style.display !== "none";
}

function positionWhiteboardOverSlide() {
    const container = document.getElementById("whiteboard-overlay-container");
    const canvas = document.getElementById("slideforge-whiteboard");
    const slideEl = getActiveSlideElement();
    if (!container || !canvas || !slideEl) return false;
    const rect = slideEl.getBoundingClientRect();
    const toolbar = document.getElementById("whiteboard-floating-toolbar");
    container.style.left = `${Math.round(rect.left)}px`;
    container.style.top = `${Math.round(rect.top)}px`;
    container.style.width = `${Math.round(rect.width)}px`;
    container.style.height = `${Math.round(rect.height)}px`;
    if (toolbar) {
        // In the insert bar's place (hidden while drawing), so it never covers the app header or the slide.
        const insertBar = document.querySelector("#insert-toolbar-row .toolbar-secondary-bar")?.getBoundingClientRect();
        const toolbarTop = insertBar?.height ? insertBar.top : Math.max(8, rect.top - 54);
        const wrapper = document.getElementById("canvas-wrapper")?.getBoundingClientRect();
        const centerX = wrapper?.width ? wrapper.left + wrapper.width / 2 : rect.left + rect.width / 2;
        toolbar.style.left = `${Math.round(centerX)}px`;
        toolbar.style.top = `${Math.round(toolbarTop)}px`;
    }
    // The engine sizes the canvas itself and redraws when it does (setting canvas.width here cleared the drawing
    // without a redraw). Drawings are kept in on-screen pixels, so a zoom or window resize rescales them, and
    // their undo history, to keep them in place on the slide.
    const previous = whiteboardRenderedSize;
    whiteboardRenderedSize = { width: rect.width, height: rect.height };
    if (engine && previous && (Math.abs(previous.width - rect.width) > 0.5 || Math.abs(previous.height - rect.height) > 0.5)) {
        const scaleX = rect.width / previous.width;
        const scaleY = rect.height / previous.height;
        const rescale = serialized => JSON.stringify(scaleDrawingElements(JSON.parse(serialized), scaleX, scaleY));
        engine.finalizeCurrentStroke?.();
        engine.elements = scaleDrawingElements(engine.elements, scaleX, scaleY);
        if (engine.history) {
            engine.history.undoStack = engine.history.undoStack.map(rescale);
            engine.history.redoStack = engine.history.redoStack.map(rescale);
        }
    }
    engine?.requestRender?.();
    return true;
}

function scheduleWhiteboardPosition() {
    if (repositionTimer) cancelAnimationFrame(repositionTimer);
    repositionTimer = requestAnimationFrame(() => {
        repositionTimer = null;
        if (!isWhiteboardActive()) return;
        syncWhiteboardFromSlide();
        positionWhiteboardOverSlide();
    });
}

function startPositionTracking() {
    stopPositionTracking();
    if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(scheduleWhiteboardPosition);
        const wrapper = document.getElementById("canvas-wrapper");
        const slide = getActiveSlideElement();
        if (wrapper) resizeObserver.observe(wrapper);
        if (slide) resizeObserver.observe(slide);
    }
    window.addEventListener("resize", scheduleWhiteboardPosition);
    window.addEventListener("scroll", scheduleWhiteboardPosition, true);
}

function stopPositionTracking() {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    window.removeEventListener("resize", scheduleWhiteboardPosition);
    window.removeEventListener("scroll", scheduleWhiteboardPosition, true);
    if (repositionTimer) {
        cancelAnimationFrame(repositionTimer);
        repositionTimer = null;
    }
}

function updateWhiteboardUi() {
    const activeEngine = getEngine();
    WHITEBOARD_TOOLS.forEach(({ id: tool }) => {
        const btn = document.getElementById(`wb-tool-${tool}`);
        if (!btn) return;
        const active = (activeEngine.annotationTool || activeEngine.activeTool) === tool;
        btn.classList.toggle("bg-indigo-50", active);
        btn.classList.toggle("text-indigo-600", active);
        btn.classList.toggle("font-bold", active);
        btn.classList.toggle("text-slate-600", !active);
        btn.classList.toggle("hover:bg-slate-100", !active);
    });
    const color = document.getElementById("wb-color-picker");
    if (color) color.value = activeEngine.strokeColor;
    renderStylePanel(activeEngine);
    const activeControl = document.activeElement;
    const isEditingPropertyControl =
        activeControl?.closest?.("#properties-panel") &&
        activeControl.matches?.("input[type='range'], input[type='color'], input[type='number'], input[type='text'], select, textarea");
    if (
        document.body.classList.contains("whiteboard-mode-active") &&
        typeof window.buildPropertiesPanel === "function" &&
        !isEditingPropertyControl
    ) {
        window.buildPropertiesPanel();
    }
}

function swatchButton(type, color, current) {
    const label = color === "transparent" ? "transparent" : color;
    const isActive = current === color;
    const transparent = color === "transparent";
    return `<button type="button" class="wb-swatch${isActive ? " is-active" : ""}${transparent ? " wb-swatch-transparent" : ""}" title="${label}" style="${transparent ? "" : `--swatch:${color}`}" onclick="setWhiteboard${type}('${color}')"></button>`;
}

function optionButton(label, active, onclick, icon = "") {
    return `<button type="button" class="wb-option${active ? " is-active" : ""}" onclick="${onclick}" title="${label}">${icon || label}</button>`;
}

function whiteboardToolButton(tool, extraClass = "") {
    return `<button type="button" onclick="setWhiteboardTool('${tool.id}')" id="wb-tool-${tool.id}" class="wb-tool-btn ${extraClass}" title="${tool.label}" aria-label="${tool.label}"><i class="${tool.icon} text-xs"></i></button>`;
}

function renderWhiteboardToolbarTools() {
    const primary = document.getElementById("whiteboard-tool-strip");
    const more = document.getElementById("whiteboard-more-tools");
    if (!primary || !more) return;
    primary.innerHTML = WHITEBOARD_TOOLS.filter(tool => tool.primary).map(tool => whiteboardToolButton(tool)).join("");
    more.innerHTML = WHITEBOARD_TOOLS.filter(tool => !tool.primary).map(tool => whiteboardToolButton(tool, "wb-more-tool")).join("");
}

window.toggleWhiteboardMoreTools = function () {
    document.getElementById("whiteboard-more-tools")?.classList.toggle("hidden");
};

function renderStylePanel(activeEngine) {
    const panel = getStylePanel();
    if (!panel) return;
    const selected = activeEngine.getSelectedElement?.();
    const strokeColor = selected?.strokeColor || activeEngine.strokeColor;
    const backgroundColor = selected?.backgroundColor || activeEngine.backgroundColor;
    const strokeWidth = selected?.strokeWidth || activeEngine.strokeWidth;
    const strokeStyle = selected?.strokeStyle || activeEngine.strokeStyle;
    const fillStyle = selected?.fillStyle || activeEngine.fillStyle;
    const roughness = selected?.roughness ?? activeEngine.roughness;
    const opacity = Math.round((selected?.opacity ?? activeEngine.opacity) * 100);
    panel.innerHTML = `
        <div class="wb-panel-section">
            <div class="wb-panel-label">Stroke</div>
            <div class="wb-swatch-row">${STROKE_SWATCHES.map(color => swatchButton("Color", color, strokeColor)).join("")}</div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Background</div>
            <div class="wb-swatch-row">${BG_SWATCHES.map(color => swatchButton("Background", color, backgroundColor)).join("")}</div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Fill</div>
            <div class="wb-option-row">
                ${optionButton("None", fillStyle === "none", "setWhiteboardFillStyle('none')", '<i class="fa-solid fa-ban"></i>')}
                ${optionButton("Hachure", fillStyle === "hachure", "setWhiteboardFillStyle('hachure')", '<i class="fa-solid fa-grip-lines"></i>')}
                ${optionButton("Solid", fillStyle === "solid", "setWhiteboardFillStyle('solid')", '<i class="fa-solid fa-square"></i>')}
                ${optionButton("Cross-hatch", fillStyle === "cross-hatch", "setWhiteboardFillStyle('cross-hatch')", '<i class="fa-solid fa-border-all"></i>')}
            </div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Stroke width</div>
            <div class="wb-option-row">
                ${[1, 2, 4].map(width => optionButton(String(width), Number(strokeWidth) === width, `setWhiteboardStrokeWidth(${width})`, `<span style="height:${Math.max(2, width)}px" class="wb-line-sample"></span>`)).join("")}
            </div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Stroke style</div>
            <div class="wb-option-row">
                ${optionButton("Solid", strokeStyle === "solid", "setWhiteboardStrokeStyle('solid')", '<span class="wb-line-sample"></span>')}
                ${optionButton("Dashed", strokeStyle === "dashed", "setWhiteboardStrokeStyle('dashed')", '<span class="wb-line-sample dashed"></span>')}
                ${optionButton("Dotted", strokeStyle === "dotted", "setWhiteboardStrokeStyle('dotted')", '<span class="wb-line-sample dotted"></span>')}
            </div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Sloppiness</div>
            <div class="wb-option-row">
                ${[0.3, 1.6, 3.2].map((value, index) => optionButton(["Clean", "Sketch", "Messy"][index], Math.abs(Number(roughness) - value) < 0.25, `setWhiteboardRoughness(${value})`, ["-", "~", "≈"][index])).join("")}
            </div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Opacity</div>
            <input class="wb-range" type="range" min="10" max="100" value="${opacity}" oninput="setWhiteboardOpacity(this.value / 100)">
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Layers</div>
            <div class="wb-option-row">
                ${optionButton("Send to back", false, "sendWhiteboardToBack()", '<i class="fa-solid fa-angles-down"></i>')}
                ${optionButton("Send backward", false, "sendWhiteboardBackward()", '<i class="fa-solid fa-arrow-down"></i>')}
                ${optionButton("Bring forward", false, "bringWhiteboardForward()", '<i class="fa-solid fa-arrow-up"></i>')}
                ${optionButton("Bring to front", false, "bringWhiteboardToFront()", '<i class="fa-solid fa-angles-up"></i>')}
            </div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Scientific presets</div>
            <div class="wb-science-preset-row">
                ${SCIENTIFIC_ANNOTATION_PRESETS.map(preset => `<button type="button" class="wb-science-preset" title="${preset.label}" onclick="setWhiteboardScientificPreset('${preset.id}')"><i class="fa-solid ${preset.icon}"></i><span>${preset.label}</span></button>`).join("")}
            </div>
        </div>
        <div class="wb-panel-section">
            <div class="wb-panel-label">Actions</div>
            <div class="wb-option-row">
                ${optionButton("Duplicate", false, "duplicateWhiteboardSelection()", '<i class="fa-regular fa-copy"></i>')}
                ${optionButton("Delete", false, "deleteWhiteboardSelection()", '<i class="fa-regular fa-trash-can"></i>')}
            </div>
        </div>
    `;
}

function renderWhiteboardPropertiesPanel(panel) {
    if (!panel) return;
    const activeEngine = getEngine();
    const selected = activeEngine.getSelectedElement?.();
    const strokeColor = selected?.strokeColor || activeEngine.strokeColor;
    const backgroundColor = selected?.backgroundColor || activeEngine.backgroundColor;
    const strokeWidth = selected?.strokeWidth || activeEngine.strokeWidth;
    const strokeStyle = selected?.strokeStyle || activeEngine.strokeStyle;
    const fillStyle = selected?.fillStyle || activeEngine.fillStyle;
    const roughness = selected?.roughness ?? activeEngine.roughness;
    const opacity = Math.round((selected?.opacity ?? activeEngine.opacity) * 100);
    const count = activeEngine.elements.length;

    panel.innerHTML = `
        <div class="p-3 space-y-3">
            <div class="prop-group">
                <div class="flex items-center justify-between py-2">
                    <h3 class="prop-group-title m-0">Whiteboard</h3>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">${count} item${count === 1 ? "" : "s"}</span>
                </div>
                <div class="space-y-3 pt-1 pb-2">
                    <div class="grid grid-cols-5 gap-1.5">
                        ${WHITEBOARD_TOOLS.map(tool => {
                                return `<button type="button" class="prop-icon-btn ${activeEngine.activeTool === tool.id ? "active" : ""}" onclick="setWhiteboardTool('${tool.id}')" title="${tool.label}"><i class="${tool.icon}"></i></button>`;
                            })
                            .join("")}
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <button type="button" onclick="undoWhiteboard()" class="prop-action-btn"><i class="fa-solid fa-rotate-left"></i> Undo</button>
                        <button type="button" onclick="redoWhiteboard()" class="prop-action-btn"><i class="fa-solid fa-rotate-right"></i> Redo</button>
                        <button type="button" onclick="exitWhiteboardMode()" class="prop-action-btn"><i class="fa-solid fa-check"></i> Done</button>
                    </div>
                </div>
            </div>

            <div class="prop-group">
                <div class="flex items-center justify-between py-2">
                    <h3 class="prop-group-title m-0">${selected ? "Selected Object" : "Drawing Style"}</h3>
                </div>
                <div class="space-y-4 pt-1 pb-2">
                    <div class="space-y-2">
                        <label class="prop-label">Stroke</label>
                        <div class="wb-swatch-row">${STROKE_SWATCHES.map(color => swatchButton("Color", color, strokeColor)).join("")}</div>
                    </div>
                    <div class="space-y-2">
                        <label class="prop-label">Background</label>
                        <div class="wb-swatch-row">${BG_SWATCHES.map(color => swatchButton("Background", color, backgroundColor)).join("")}</div>
                    </div>
                    <div class="space-y-2">
                        <label class="prop-label">Fill</label>
                        <div class="wb-option-row">
                            ${optionButton("None", fillStyle === "none", "setWhiteboardFillStyle('none')", '<i class="fa-solid fa-ban"></i>')}
                            ${optionButton("Hachure", fillStyle === "hachure", "setWhiteboardFillStyle('hachure')", '<i class="fa-solid fa-grip-lines"></i>')}
                            ${optionButton("Solid", fillStyle === "solid", "setWhiteboardFillStyle('solid')", '<i class="fa-solid fa-square"></i>')}
                            ${optionButton("Cross-hatch", fillStyle === "cross-hatch", "setWhiteboardFillStyle('cross-hatch')", '<i class="fa-solid fa-border-all"></i>')}
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="space-y-2">
                            <label class="prop-label">Width</label>
                            <div class="wb-option-row">
                                ${[1, 2, 4].map(width => optionButton(String(width), Number(strokeWidth) === width, `setWhiteboardStrokeWidth(${width})`, `<span style="height:${Math.max(2, width)}px" class="wb-line-sample"></span>`)).join("")}
                            </div>
                        </div>
                        <div class="space-y-2">
                            <label class="prop-label">Stroke</label>
                            <div class="wb-option-row">
                                ${optionButton("Solid", strokeStyle === "solid", "setWhiteboardStrokeStyle('solid')", '<span class="wb-line-sample"></span>')}
                                ${optionButton("Dashed", strokeStyle === "dashed", "setWhiteboardStrokeStyle('dashed')", '<span class="wb-line-sample dashed"></span>')}
                                ${optionButton("Dotted", strokeStyle === "dotted", "setWhiteboardStrokeStyle('dotted')", '<span class="wb-line-sample dotted"></span>')}
                            </div>
                        </div>
                    </div>
                    <div class="space-y-2">
                        <label class="prop-label">Sloppiness</label>
                        <div class="wb-option-row">
                            ${[0.3, 1.6, 3.2].map((value, index) => optionButton(["Clean", "Sketch", "Messy"][index], Math.abs(Number(roughness) - value) < 0.25, `setWhiteboardRoughness(${value})`, ["-", "~", "≈"][index])).join("")}
                        </div>
                    </div>
                    <div class="space-y-2">
                        <div class="flex items-center justify-between">
                            <label class="prop-label">Opacity</label>
                            <span class="text-[10px] font-mono text-slate-500">${opacity}%</span>
                        </div>
                        <input class="wb-range" type="range" min="10" max="100" value="${opacity}" oninput="this.previousElementSibling.querySelector('span').textContent = Math.round(this.value) + '%'; setWhiteboardOpacity(this.value / 100)">
                    </div>
                </div>
            </div>

            <div class="prop-group">
                <div class="flex items-center justify-between py-2">
                    <h3 class="prop-group-title m-0">Arrange</h3>
                </div>
                <div class="space-y-3 pt-1 pb-2">
                    <div class="grid grid-cols-4 gap-2">
                        ${optionButton("Send to back", false, "sendWhiteboardToBack()", '<i class="fa-solid fa-angles-down"></i>')}
                        ${optionButton("Send backward", false, "sendWhiteboardBackward()", '<i class="fa-solid fa-arrow-down"></i>')}
                        ${optionButton("Bring forward", false, "bringWhiteboardForward()", '<i class="fa-solid fa-arrow-up"></i>')}
                        ${optionButton("Bring to front", false, "bringWhiteboardToFront()", '<i class="fa-solid fa-angles-up"></i>')}
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <button type="button" onclick="duplicateWhiteboardSelection()" class="prop-action-btn"><i class="fa-regular fa-copy"></i> Copy</button>
                        <button type="button" onclick="deleteWhiteboardSelection()" class="prop-action-btn"><i class="fa-regular fa-trash-can"></i> Delete</button>
                        <button type="button" onclick="clearWhiteboard()" class="prop-action-btn text-rose-600"><i class="fa-solid fa-trash-can"></i> Clear</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.renderWhiteboardPropertiesPanel = renderWhiteboardPropertiesPanel;

window.toggleWhiteboardMode = function () {
    const container = document.getElementById("whiteboard-overlay-container");
    const canvas = document.getElementById("slideforge-whiteboard");
    const toolbar = document.getElementById("whiteboard-floating-toolbar");
    const guide = document.getElementById("whiteboard-guide-card");
    const btn = document.getElementById("btn-whiteboard-toggle");
    const panel = getStylePanel();
    if (!container || !canvas || !toolbar) return;
    renderWhiteboardToolbarTools();
    const isActive = container.style.display !== "none";
    if (isActive) {
        exitWhiteboardMode();
        return;
    }
    closeWhiteboardBlockingOverlays();
    if (!whiteboardSessionUndoCaptured && typeof window.saveStateToUndo === "function") {
        window.saveStateToUndo();
        whiteboardSessionUndoCaptured = true;
    }
    syncWhiteboardFromSlide({ force: true });
    if (!positionWhiteboardOverSlide()) return;
    container.style.display = "block";
    container.style.pointerEvents = "none";
    canvas.style.pointerEvents = "auto";
    document.body.classList.add("whiteboard-mode-active");
    getCallableGlobal("clearSelection")?.();
    if (typeof window.setPropertiesPanelVisible === "function") {
        window.setPropertiesPanelVisible(true);
        requestAnimationFrame(scheduleWhiteboardPosition);
        setTimeout(scheduleWhiteboardPosition, 120);
    }
    btn?.classList.add("bg-indigo-100", "ring-2", "ring-indigo-300");
    if (guide) guide.style.display = "none";
    const activeEngine = getEngine();
    activeEngine.setOptions({ showGrid: false, allowPanZoom: false });
    activeEngine.setupEventHandlers();
    bindWhiteboardRadialMenu();
    startPositionTracking();
    setTimeout(() => {
        container.style.opacity = "1";
        toolbar.style.opacity = "1";
        toolbar.style.pointerEvents = "auto";
        toolbar.style.transform = "translateX(-50%) scale(1)";
        if (panel) {
            panel.classList.add("opacity-0", "pointer-events-none");
            panel.classList.remove("opacity-100");
        }
        if (guide) guide.style.display = "none";
    }, 10);
    setWhiteboardTool("select");
    window.buildPropertiesPanel?.();
    registerEscHandler();
};

window.exitWhiteboardMode = function (options = {}) {
    if (exitingWhiteboard) return;
    exitingWhiteboard = true;
    const preserveSelection = options?.preserveSelection !== false;
    const container = document.getElementById("whiteboard-overlay-container");
    const toolbar = document.getElementById("whiteboard-floating-toolbar");
    const guide = document.getElementById("whiteboard-guide-card");
    const btn = document.getElementById("btn-whiteboard-toggle");
    const panel = getStylePanel();
    if (!container || !toolbar) {
        exitingWhiteboard = false;
        return;
    }
    unregisterEscHandler();
    if (livePersistTimer) {
        clearTimeout(livePersistTimer);
        livePersistTimer = null;
    }
    getEngine()?.commitActiveTextEditor?.();
    getEngine()?.removeEventHandlers?.();
    container.style.opacity = "0";
    container.style.pointerEvents = "none";
    const canvas = document.getElementById("slideforge-whiteboard");
    if (canvas) canvas.style.pointerEvents = "none";
    document.getElementById("whiteboard-radial-menu")?.classList.add("hidden");
    document.body.classList.remove("whiteboard-mode-active");
    toolbar.style.opacity = "0";
    toolbar.style.pointerEvents = "none";
    toolbar.style.transform = "translateX(-50%) scale(0.95)";
    panel?.classList.add("opacity-0", "pointer-events-none");
    panel?.classList.remove("opacity-100");
    if (guide) {
        guide.style.opacity = "0";
        guide.style.transform = "translateY(16px)";
    }
    btn?.classList.remove("bg-indigo-100", "ring-2", "ring-indigo-300");
    container.style.display = "none";
    setTimeout(() => {
        container.style.display = "none";
        if (guide) guide.style.display = "none";
        exitingWhiteboard = false;
    }, 300);
    persistWhiteboardToSlide({ renderSlide: true, finalizeActive: true, preserveSelection });
    whiteboardSessionUndoCaptured = false;
    stopPositionTracking();
    requestAnimationFrame(() => window.buildPropertiesPanel?.());
};

window.setWhiteboardTool = function (tool) {
    const activeEngine = getEngine();
    const config = WHITEBOARD_TOOLS.find(item => item.id === tool);
    if (activeEngine) activeEngine.annotationTool = tool;
    if (tool === "highlighter") {
        activeEngine.annotationRole = "highlighter";
        activeEngine?.updateSelectedStyle({
            strokeColor: "#facc15",
            strokeWidth: 14,
            opacity: 0.38,
            fillStyle: "none",
        });
    } else if (tool === "callout") {
        activeEngine.annotationRole = "figure-callout";
        activeEngine?.updateSelectedStyle({
            strokeColor: "#2563eb",
            backgroundColor: "#dbeafe",
            fillStyle: "solid",
            strokeWidth: 2,
            opacity: 0.92,
        });
    } else if (activeEngine) {
        activeEngine.annotationRole = null;
    }
    activeEngine?.setTool(config?.mapsTo || tool);
    document.getElementById("whiteboard-more-tools")?.classList.add("hidden");
    updateWhiteboardUi();
};

window.setWhiteboardScientificPreset = function (presetId) {
    const activeEngine = getEngine();
    const preset = SCIENTIFIC_ANNOTATION_PRESETS.find(item => item.id === presetId);
    if (!activeEngine || !preset) return;
    if (preset.tool === "moleculeHighlight") {
        activeEngine.updateSelectedStyle({ strokeColor: "#14b8a6", backgroundColor: "#ccfbf1", fillStyle: "solid", strokeWidth: 3, opacity: 0.72 });
        activeEngine.setTool("ellipse");
    } else if (preset.tool === "pathwayArrow") {
        activeEngine.updateSelectedStyle({ strokeColor: "#7c3aed", backgroundColor: "transparent", fillStyle: "none", strokeWidth: 4, opacity: 1 });
        activeEngine.setTool("curve_arrow");
    } else if (preset.tool === "equationMarker") {
        activeEngine.updateSelectedStyle({ strokeColor: "#f97316", backgroundColor: "#ffedd5", fillStyle: "solid", strokeWidth: 2, opacity: 0.62 });
        activeEngine.setTool("rectangle");
    } else {
        activeEngine.updateSelectedStyle({ strokeColor: "#2563eb", backgroundColor: "#dbeafe", fillStyle: "solid", strokeWidth: 2, opacity: 0.9 });
        activeEngine.setTool(preset.tool === "callout" ? "rectangle" : "text");
    }
    updateWhiteboardUi();
};

window.setWhiteboardColor = function (color) {
    const activeEngine = getEngine();
    if (activeEngine) activeEngine.updateSelectedStyle({ strokeColor: color });
    updateWhiteboardUi();
};

window.setWhiteboardBackground = function (color) {
    const activeEngine = getEngine();
    if (activeEngine) activeEngine.updateSelectedStyle({ backgroundColor: color });
    updateWhiteboardUi();
};

window.setWhiteboardFillStyle = function (fillStyle) {
    getEngine()?.updateSelectedStyle({ fillStyle });
    updateWhiteboardUi();
};

window.setWhiteboardStrokeWidth = function (strokeWidth) {
    getEngine()?.updateSelectedStyle({ strokeWidth: Number(strokeWidth) || 2 });
    updateWhiteboardUi();
};

window.setWhiteboardStrokeStyle = function (strokeStyle) {
    getEngine()?.updateSelectedStyle({ strokeStyle });
    updateWhiteboardUi();
};

window.setWhiteboardRoughness = function (roughness) {
    getEngine()?.updateSelectedStyle({ roughness: Number(roughness) || 1.6 });
    updateWhiteboardUi();
};

window.setWhiteboardOpacity = function (opacity) {
    getEngine()?.updateSelectedStyle({ opacity: Number(opacity) || 1 });
    updateWhiteboardUi();
};

window.getWhiteboardColor = function () {
    return getEngine()?.strokeColor || "#1f2937";
};

window.undoWhiteboard = function () {
    getEngine()?.undo();
    updateWhiteboardUi();
};

window.redoWhiteboard = function () {
    getEngine()?.redo();
    updateWhiteboardUi();
};

window.clearWhiteboard = function () {
    if (confirm("Clear the slide whiteboard?")) {
        getEngine()?.clear();
        updateWhiteboardUi();
    }
};

window.duplicateWhiteboardSelection = function () {
    getEngine()?.duplicateSelected();
    updateWhiteboardUi();
};

window.deleteWhiteboardSelection = function () {
    getEngine()?.deleteSelected();
    updateWhiteboardUi();
};

window.bringWhiteboardForward = function () {
    getEngine()?.bringForward();
};

window.sendWhiteboardBackward = function () {
    getEngine()?.sendBackward();
};

window.bringWhiteboardToFront = function () {
    getEngine()?.bringToFront();
};

window.sendWhiteboardToBack = function () {
    getEngine()?.sendToBack();
};

window.exportWhiteboardSVG = function () {
    const activeEngine = getEngine();
    if (!activeEngine || activeEngine.elements.length === 0) {
        alert("The whiteboard is empty. Draw something first.");
        return;
    }
    const slideConfig =
        typeof window.getPresentationPageSetupConfig === "function"
            ? window.getPresentationPageSetupConfig()
            : { width: 1024, height: 768 };
    const svg = ExportRenderer.generateSVG(activeEngine.getAnnotationObjects?.() || activeEngine.elements, activeEngine.viewport, slideConfig.width, slideConfig.height);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `slideforge-whiteboard-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.addEventListener("slideforge:whiteboard-change", updateWhiteboardUi);
window.addEventListener("slideforge:whiteboard-change", scheduleLiveWhiteboardPersist);
window.addEventListener("slideforge:render-complete", scheduleWhiteboardPosition);
window.addEventListener("hashchange", scheduleWhiteboardPosition);
