import { normalizeMermaidStyle, renderMermaid, sanitizeMermaidSvg } from "./mermaid-engine.js";
import { canUseVisualGraph, graphBounds, graphToSvg, layoutGraphModel } from "./mermaid-graph.js";
import { documentToGraphModel, renderDocumentToSvg } from "./mermaid-document.js";
import { DEFAULT_MERMAID_TEMPLATE, inferMermaidType } from "./mermaid-templates.js";
import { ensureGraphElementDocument } from "../graph/schema/migrations.js";
import { MermaidExporter } from "../graph/parsers/MermaidExporter.js";
import { SvgGraphRenderer } from "../graph/renderers/SvgGraphRenderer.js";

// Classic-script globals (including top-level let/const) resolve by bare name from this module.
// A static table avoids Function(), which the Content-Security-Policy blocks.
const GLOBAL_READERS = {
    currentSlideIndex: () => (typeof currentSlideIndex !== "undefined" ? currentSlideIndex : undefined),
    state: () => (typeof state !== "undefined" ? state : undefined),
    updateElementState: () => (typeof updateElementState !== "undefined" ? updateElementState : undefined),
    generateId: () => (typeof generateId !== "undefined" ? generateId : undefined),
    getNextZIndex: () => (typeof getNextZIndex !== "undefined" ? getNextZIndex : undefined),
    renderSlidesFromState: () => (typeof renderSlidesFromState !== "undefined" ? renderSlidesFromState : undefined),
    saveStateToUndo: () => (typeof saveStateToUndo !== "undefined" ? saveStateToUndo : undefined),
    selectElement: () => (typeof selectElement !== "undefined" ? selectElement : undefined),
};

function readGlobal(name, fallback = null) {
    try {
        const value = GLOBAL_READERS[name]?.();
        return value === undefined ? fallback : value;
    } catch (_err) {
        return fallback;
    }
}

function callGlobal(name, ...args) {
    const fn = readGlobal(name, null);
    return typeof fn === "function" ? fn(...args) : undefined;
}

export function createMermaidElementData(overrides = {}) {
    const source = overrides.mermaidSource || DEFAULT_MERMAID_TEMPLATE.source;
    const theme = overrides.theme || "default";
    const id = overrides.id || callGlobal("generateId", "el") || `el_mermaid_${Date.now()}`;
    const zIndex = callGlobal("getNextZIndex") || 1;
    const graphState = canUseVisualGraph(source) || overrides.graphDocument || overrides.graphModel
        ? ensureGraphElementDocument({
            ...overrides,
            mermaidSource: source,
            style: normalizeMermaidStyle(overrides.style || {}),
        })
        : { graphDocument: null, graphModel: null };
    return {
        id,
        type: "mermaid",
        x: overrides.x ?? 120,
        y: overrides.y ?? 110,
        width: overrides.width || "560px",
        height: overrides.height || "360px",
        rotation: overrides.rotation || 0,
        zIndex,
        locked: false,
        opacity: 1,
        mermaidSource: source,
        mermaidType: overrides.mermaidType || inferMermaidType(source),
        theme,
        svgContent: sanitizeMermaidSvg(overrides.svgContent || ""),
        svgManualEdits: Boolean(overrides.svgManualEdits),
        editMode: ["visual", "code", "split"].includes(overrides.editMode) ? overrides.editMode : "visual",
        graphDocument: graphState.graphDocument,
        graphModel: graphState.graphModel,
        semanticGraphVersion: graphState.graphDocument?.schemaVersion || null,
        nodePositions: overrides.nodePositions || {},
        lockedLayout: Boolean(overrides.lockedLayout),
        autoLayout: overrides.autoLayout !== false,
        routingStyle: overrides.routingStyle || "orthogonal",
        connectionStyle: overrides.connectionStyle || "arrow",
        animation: overrides.animation || null,
        style: normalizeMermaidStyle(overrides.style || {}),
        styles: {
            zIndex,
            backgroundColor: "transparent",
            borderRadius: "8px",
            overflow: "hidden",
            ...(overrides.styles || {}),
        },
    };
}

// The element's box follows the diagram's proportions, so a wide or tall diagram is not shrunk into a fixed
// 560x360 box with empty bands around it. On insert the width suits the diagram; later the width is kept.
function fitMermaidBoxToDiagram(element, { keepWidth = false } = {}) {
    const document = element.graphDocument;
    // Diagrams Mermaid draws (sequence, Gantt, ER, mind map...) have no graph: their SVG's viewBox gives the size.
    // They all got 560x360, so a wide Gantt chart or a tall ER diagram was a sliver with unreadable text.
    const bounds = document?.nodes?.length
        ? graphBounds(layoutGraphModel(documentToGraphModel(document), { preservePositions: true }))
        : svgViewBoxSize(element.svgContent);
    if (!bounds) return;
    const aspect = bounds.width / Math.max(1, bounds.height);
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    let width = keepWidth ? parseFloat(element.width) || 560 : clamp(bounds.width, 360, 880);
    let height = width / aspect;
    if (height > 520 || height < 140) {
        height = clamp(height, 140, 520);
        width = clamp(height * aspect, 240, 900);
    }
    element.width = `${Math.round(width)}px`;
    element.height = `${Math.round(height)}px`;
}

function svgViewBoxSize(svgText) {
    const match = String(svgText || "").match(/<svg\b[^>]*\bviewBox="([^"]+)"/i);
    const [, , width, height] = (match?.[1] || "").split(/[\s,]+/).map(Number);
    return width > 0 && height > 0 ? { width, height } : null;
}

export function insertMermaidElement(data = {}) {
    const state = readGlobal("state");
    const currentSlideIndex = readGlobal("currentSlideIndex", 0);
    const slide = state?.slides?.[currentSlideIndex];
    if (!slide) return null;
    callGlobal("saveStateToUndo");
    const element = createMermaidElementData(data);
    fitMermaidBoxToDiagram(element);
    // The empty content placeholder if there is one, else wherever it covers the least (it landed at 120,110 on
    // top of whatever was there). Only the editor's dialog inserts flowcharts, always as a new object.
    if (typeof window.placeWhereFree === "function") window.placeWhereFree(slide, element);
    else window.placeInContentPlaceholder?.(slide, element);
    slide.elements.push(element);
    callGlobal("renderSlidesFromState");
    callGlobal("selectElement", element.id, "replace");
    return element;
}

export function updateMermaidElement(id, updates = {}, options = {}) {
    const state = readGlobal("state");
    const currentSlideIndex = readGlobal("currentSlideIndex", 0);
    const slide = state?.slides?.[currentSlideIndex];
    const element = slide?.elements?.find(item => item.id === id && item.type === "mermaid");
    if (!element) return null;
    if (options.captureUndo !== false) callGlobal("saveStateToUndo");
    Object.assign(element, updates);
    if (updates.mermaidSource !== undefined) element.mermaidType = updates.mermaidType || inferMermaidType(updates.mermaidSource);
    if (updates.theme !== undefined) element.theme = updates.theme;
    if (updates.style !== undefined) element.style = normalizeMermaidStyle(updates.style);
    if (updates.graphModel !== undefined) element.graphModel = updates.graphModel;
    if (updates.graphDocument !== undefined) element.graphDocument = updates.graphDocument;
    if (
        element.graphDocument ||
        element.graphModel ||
        updates.mermaidSource !== undefined ||
        updates.graphModel !== undefined ||
        updates.graphDocument !== undefined
    ) {
        const shouldKeepGraph = updates.mermaidSource !== undefined
            ? (canUseVisualGraph(element.mermaidSource || "") || updates.graphDocument || updates.graphModel)
            : (canUseVisualGraph(element.mermaidSource || "") || element.graphDocument || element.graphModel);
        const graphState = shouldKeepGraph
            ? ensureGraphElementDocument(element)
            : { graphDocument: null, graphModel: null };
        element.graphDocument = graphState.graphDocument;
        element.graphModel = graphState.graphModel;
        element.semanticGraphVersion = graphState.graphDocument?.schemaVersion || null;
        if (element.graphDocument?.nodes?.length && updates.mermaidSource === undefined) {
            element.mermaidSource = MermaidExporter.fromGraphDocument(element.graphDocument);
            element.mermaidType = inferMermaidType(element.mermaidSource);
        }
        if (updates.mermaidSource !== undefined || updates.graphDocument !== undefined || updates.graphModel !== undefined) {
            fitMermaidBoxToDiagram(element, { keepWidth: true });
        }
    }
    const dom = document.getElementById(id);
    if (dom) renderMermaidElement(dom, element, { force: true, updateState: false });
    if (options.render !== false) callGlobal("renderSlidesFromState", { preserveState: true });
    if (typeof window.schedulePresentationAutosave === "function") window.schedulePresentationAutosave(250);
    return element;
}

export function renderMermaidElement(host, elData = {}, options = {}) {
    if (!host) return;
    host.classList.add("mermaid-canvas-element");
    host.style.opacity = elData.opacity ?? host.style.opacity ?? "1";

    let surface = host.querySelector(":scope > .mermaid-object-surface");
    if (!surface) {
        surface = document.createElement("div");
        surface.className = "mermaid-object-surface";
        host.appendChild(surface);
    }

    let svgHost = surface.querySelector(":scope > .mermaid-svg-host");
    if (!svgHost) {
        svgHost = document.createElement("div");
        svgHost.className = "mermaid-svg-host";
        surface.appendChild(svgHost);
    }

    const currentSvg = sanitizeMermaidSvg(elData.svgContent || "");
    const shouldUseSemanticGraph = (elData.graphDocument || elData.graphModel) && (canUseVisualGraph(elData.mermaidSource || "") || elData.graphDocument?.nodes?.length);
    if (shouldUseSemanticGraph) {
        const graphState = ensureGraphElementDocument(elData);
        elData.graphDocument = graphState.graphDocument;
        elData.graphModel = graphState.graphModel;
        elData.semanticGraphVersion = graphState.graphDocument?.schemaVersion || null;
        const svg = SvgGraphRenderer.render(elData.graphDocument, {
            style: normalizeMermaidStyle(elData.style || {}),
            selectedIds: [],
        }) || renderDocumentToSvg(elData.graphDocument, normalizeMermaidStyle(elData.style || {}), { selectedId: "" }) || graphToSvg(elData.graphModel, normalizeMermaidStyle(elData.style || {}), { selectedId: "" });
        svgHost.innerHTML = svg || currentSvg || `<div class="mermaid-render-status"><i class="fa-solid fa-diagram-project"></i><span>Diagram</span></div>`;
        elData.svgContent = svg || currentSvg;
        return;
    }
    if (currentSvg && (options.force || !svgHost.innerHTML)) {
        svgHost.innerHTML = currentSvg;
    } else if (!svgHost.innerHTML) {
        svgHost.innerHTML = `<div class="mermaid-render-status"><i class="fa-solid fa-diagram-project"></i><span>Rendering diagram...</span></div>`;
    }
    if (elData.svgManualEdits && currentSvg && !options.forceRerender) {
        return;
    }

    const source = String(elData.mermaidSource || "").trim();
    if (!source) {
        svgHost.innerHTML = `<div class="mermaid-render-error">Mermaid source is empty.</div>`;
        return;
    }

    const style = normalizeMermaidStyle(elData.style || {});
    const token = `${source}::${elData.theme || "default"}::${JSON.stringify(style)}`;
    host.dataset.mermaidRenderToken = token;
    renderMermaid(source, { theme: elData.theme || "default", style })
        .then(({ svg }) => {
            if (host.dataset.mermaidRenderToken !== token) return;
            svgHost.innerHTML = svg;
            elData.svgContent = svg;
            elData.mermaidType = inferMermaidType(source);
            const updateElementState = readGlobal("updateElementState", null);
            if (options.updateState !== false && typeof updateElementState === "function") {
                updateElementState(elData.id, {
                    svgContent: svg,
                    mermaidType: elData.mermaidType,
                    mermaidSource: source,
                    theme: elData.theme || "default",
                    style,
                    svgManualEdits: false,
                });
            }
        })
        .catch(error => {
            if (host.dataset.mermaidRenderToken !== token) return;
            if (!currentSvg) {
                svgHost.innerHTML = `<div class="mermaid-render-error">${escapeHtml(error?.message || String(error))}</div>`;
            }
            host.dataset.mermaidError = error?.message || String(error);
        });
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

window.createMermaidElementData = createMermaidElementData;
window.insertMermaidElement = insertMermaidElement;
window.updateMermaidElement = updateMermaidElement;
window.renderMermaidElement = renderMermaidElement;
