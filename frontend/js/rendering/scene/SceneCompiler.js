import { createRenderScene } from "./RenderScene.js";
import { resolveExportProfile } from "../export/ExportProfiles.js";
import { compileShapeGeometry, compileShapeStyle, parsePx } from "../vector/ShapeCompiler.js";

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

// Classic-script globals (including top-level let/const) resolve by bare name from this module.
// A static table avoids Function(), which the Content-Security-Policy blocks.
const GLOBAL_READERS = {
    state: () => (typeof state !== "undefined" ? state : undefined),
};

function readGlobal(name, fallback = undefined) {
    try {
        const value = GLOBAL_READERS[name]?.();
        return value === undefined ? fallback : value;
    } catch (_error) {
        return fallback;
    }
}

function readPageSetup(sourceState = {}) {
    const config = typeof window.getPresentationPageSetupConfig === "function"
        ? window.getPresentationPageSetupConfig()
        : {};
    return {
        width: Number(config.width) || Number(sourceState.pageSetup?.width) || 1024,
        height: Number(config.height) || Number(sourceState.pageSetup?.height) || 768,
        unit: "px",
    };
}

function readTheme() {
    return typeof window.getPresentationTheme === "function" ? window.getPresentationTheme() : null;
}

function normalizeBounds(element = {}) {
    return {
        x: Number.parseFloat(element.x) || 0,
        y: Number.parseFloat(element.y) || 0,
        width: parsePx(element.width, 120),
        height: parsePx(element.height, 80),
    };
}

function compileBackground(slide = {}, theme = null) {
    const background = slide.background || {};
    if (background.type === "image" && background.content) {
        return { kind: "image", src: background.content, exportPolicy: "raster" };
    }
    if (background.type === "video" && background.content) {
        return { kind: "video", src: background.content, exportPolicy: "placeholder" };
    }
    // The slide's own colour or gradient, else the theme's slide background (a CSS gradient stack). The theme's
    // surface colour (a card fill) was used before, so dark themes exported as a nearly white slide.
    const own = typeof slide.background === "string" ? slide.background : background.color || background.value || "";
    const css = String(own || theme?.cssVars?.["--slide-bg"] || theme?.surfaceColor || "#ffffff").trim();
    return /gradient\(/i.test(css) ? { kind: "css", css } : { kind: "solid", color: css };
}

function baseNode(element = {}) {
    return {
        id: element.id || `node_${Math.random().toString(36).slice(2)}`,
        sourceElementId: element.id || "",
        type: element.type || "unknown",
        bounds: normalizeBounds(element),
        transform: {
            rotate: Number(element.rotation) || 0,
            scaleX: 1,
            scaleY: 1,
        },
        opacity: Number(element.opacity ?? element.styles?.opacity ?? 1),
        zIndex: Number(element.styles?.zIndex) || 0,
        style: clone(element.styles || {}),
        metadata: {
            exportPolicy: "vector",
            semanticRole: element.semanticRole || "",
        },
    };
}

function compileText(element = {}) {
    const textDocument =
        element.textDocument ||
        (typeof window !== "undefined" && window.SlideForgeText?.textDocumentFromLegacyContent
            ? window.SlideForgeText.textDocumentFromLegacyContent(element.content || "", { bulletStyle: element.bulletStyle || "default" })
            : null);
    return {
        ...baseNode(element),
        type: "text",
        content: element.content || "",
        textDocument: clone(textDocument),
        bulletStyle: element.bulletStyle || "default",
        textFitMode: element.textFitMode || "fixed",
        exportPolicy: "vector",
    };
}

function compileShape(element = {}) {
    return {
        ...baseNode(element),
        type: "shape",
        shapeType: element.shapeType || "rectangle",
        geometry: compileShapeGeometry(element),
        vectorStyle: compileShapeStyle(element),
        // Words typed into the shape, with their worked-out style (defaults depend on the fill and theme).
        shapeText: element.shapeText ? String(element.shapeText) : "",
        shapeTextStyle: element.shapeText && typeof window !== "undefined" && typeof window.getShapeTextStyle === "function"
            ? window.getShapeTextStyle(element)
            : element.shapeTextStyle || null,
        exportPolicy: "vector",
    };
}

function compileImage(element = {}) {
    return {
        ...baseNode(element),
        type: "image",
        src: element.content || "",
        cropTransform: clone(element.cropTransform || null),
        exportPolicy: "raster",
    };
}

function compileTable(element = {}) {
    return {
        ...baseNode(element),
        type: "table",
        tableData: clone(element.tableData || {}),
        exportPolicy: "vector",
    };
}

function compileEquation(element = {}) {
    return {
        ...baseNode(element),
        type: "equation",
        latex: element.latex || element.content || "",
        exportPolicy: "vector",
    };
}

function compileGraph(element = {}) {
    return {
        ...baseNode(element),
        type: "graph",
        graphDocument: clone(element.graphDocument || null),
        mermaidSource: element.mermaidSource || "",
        svgContent: element.svgContent || "",
        exportPolicy: element.graphDocument ? "vector" : "raster",
    };
}

function compileAnnotationLayer(slide = {}) {
    const annotations = Array.isArray(slide.whiteboardElements) ? slide.whiteboardElements : [];
    if (!annotations.length) return null;
    return {
        id: `annotations_${slide.id || "slide"}`,
        type: "annotationLayer",
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        annotations: clone(annotations),
        zIndex: 1_000_000,
        exportPolicy: "vector",
    };
}

function compileSketch(element = {}) {
    return {
        ...baseNode(element),
        type: "sketch",
        strokes: clone(element.strokes || []),
        exportPolicy: "vector",
    };
}

function compileFallback(element = {}) {
    const node = baseNode(element);
    const liveTypes = new Set(["video", "html", "pdf", "molecule"]);
    node.exportPolicy = liveTypes.has(element.type) ? "placeholder" : "raster";
    node.content = element.content || "";
    return node;
}

export function compileElementToSceneNode(element = {}) {
    switch (element.type) {
        case "text":
            return compileText(element);
        case "shape":
            return compileShape(element);
        case "image":
            return compileImage(element);
        case "table":
            return compileTable(element);
        case "equation":
        case "latex":
            return compileEquation(element);
        case "mermaid":
            return compileGraph(element);
        case "sketch":
            return compileSketch(element);
        default:
            return compileFallback(element);
    }
}

export function compileSlideToSceneSlide(slide = {}, index = 0, context = {}) {
    const nodes = (slide.elements || [])
        .filter(element => element && !element.hidden && element.type !== "whiteboard")
        .map(compileElementToSceneNode)
        .sort((a, b) => a.zIndex - b.zIndex);
    const annotationLayer = compileAnnotationLayer(slide);
    if (annotationLayer) nodes.push(annotationLayer);
    return {
        id: slide.id || `slide_${index + 1}`,
        index,
        title: slide.title || `Slide ${index + 1}`,
        background: compileBackground(slide, context.theme),
        layers: [
            {
                id: "main",
                nodes,
            },
        ],
        animations: clone(slide.animations || []),
        metadata: {
            notes: slide.notes || "",
            layoutId: slide.layoutId || "",
        },
    };
}

export function compileStateToRenderScene(sourceState = null, options = {}) {
    const liveState = sourceState || readGlobal("state", window.state) || {};
    const snapshot = clone(liveState || {});
    const profile = resolveExportProfile(options.profile || "publication");
    const page = readPageSetup(snapshot);
    const theme = readTheme();
    const scene = createRenderScene({ state: snapshot, page, theme, profile });
    scene.slides = (snapshot.slides || []).map((slide, index) =>
        compileSlideToSceneSlide(slide, index, { theme, profile, page }),
    );
    return scene;
}
