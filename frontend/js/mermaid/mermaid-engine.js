import { inferMermaidType } from "./mermaid-templates.js";

const MERMAID_VERSION = "11.4.1";
const MERMAID_LOCAL_URL = "./vendor/mermaid/mermaid.esm.min.mjs";
const SAFE_SVG_TAGS = new Set([
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "marker",
    "linearGradient", "radialGradient", "stop", "style", "title", "desc", "use", "pattern", "clipPath", "mask",
    "filter", "feTurbulence", "feDisplacementMap",
]);
const URL_ATTRS = new Set(["href", "xlink:href"]);

let mermaidPromise = null;
let renderQueue = Promise.resolve();
const svgCache = new Map();

function normalizeColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : fallback;
}

// What each theme sets the diagram's colours to. Flowcharts are drawn by SlideForge from these colours, so the
// theme on its own changed nothing for them; picking a theme now sets the Fill, Text and Line colours (for every
// diagram type, so they also agree with Mermaid's own theme).
export const MERMAID_THEME_PALETTES = {
    default: { primaryColor: "#eef2ff", primaryTextColor: "#0f172a", lineColor: "#4f46e5" },
    neutral: { primaryColor: "#f4f4f5", primaryTextColor: "#18181b", lineColor: "#52525b" },
    dark: { primaryColor: "#1f2937", primaryTextColor: "#f9fafb", lineColor: "#93c5fd" },
    forest: { primaryColor: "#ecfdf5", primaryTextColor: "#064e3b", lineColor: "#059669" },
    base: { primaryColor: "#fff7ed", primaryTextColor: "#431407", lineColor: "#ea580c" },
};
if (typeof window !== "undefined") window.MERMAID_THEME_PALETTES = MERMAID_THEME_PALETTES;

// Which hand-drawn looks a diagram type has. Flowcharts are drawn by SlideForge (Draw and Sketch); of the types
// Mermaid draws, version 11.4 has a hand-drawn look for state and class diagrams only (sequence, ER, Gantt, journey
// and mind map ignore it, so Draw and Sketch looked exactly like Real for them).
const MERMAID_HAND_DRAWN_TYPES = new Set(["stateDiagram-v2", "classDiagram"]);
export function mermaidRenderModes(source = "") {
    const firstLine = String(source || "").replace(/^\s*(%%.*\n\s*)*/, "").split("\n")[0].trim();
    if (/^(flowchart|graph)\b/i.test(firstLine)) return ["real", "draw", "sketch"];
    const type = inferMermaidType(source);
    return MERMAID_HAND_DRAWN_TYPES.has(type) ? ["real", "sketch"] : ["real"];
}

if (typeof window !== "undefined") window.mermaidRenderModes = mermaidRenderModes;

export function normalizeMermaidStyle(style = {}) {
    const renderMode = ["real", "draw", "sketch"].includes(style.renderMode) ? style.renderMode : (style.handDrawn ? "sketch" : "real");
    return {
        fontFamily: String(style.fontFamily || "Inter, Arial, sans-serif").slice(0, 120),
        fontSize: Math.max(10, Math.min(28, Number(style.fontSize) || 16)),
        primaryColor: normalizeColor(style.primaryColor, "#eef2ff"),
        primaryTextColor: normalizeColor(style.primaryTextColor, "#0f172a"),
        lineColor: normalizeColor(style.lineColor, "#4f46e5"),
        backgroundColor: normalizeColor(style.backgroundColor, "#ffffff"),
        renderMode,
        handDrawn: renderMode !== "real",
    };
}

function cacheKey(source, theme, style) {
    return `${theme || "default"}::${JSON.stringify(normalizeMermaidStyle(style))}::${source || ""}`;
}

function idle() {
    return new Promise(resolve => {
        const runner = () => resolve();
        if (typeof requestIdleCallback === "function") requestIdleCallback(runner, { timeout: 800 });
        else setTimeout(runner, 0);
    });
}

export async function loadMermaid() {
    if (!mermaidPromise) {
        mermaidPromise = import(MERMAID_LOCAL_URL).then(module => {
            const mermaid = module.default || module;
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                theme: "default",
                htmlLabels: false,
                deterministicIds: true,
                deterministicIDSeed: "slideforge",
                fontFamily: "Inter, Arial, sans-serif",
            });
            return mermaid;
        });
    }
    return mermaidPromise;
}

export function getMermaidRuntimeInfo() {
    return {
        version: MERMAID_VERSION,
        localUrl: MERMAID_LOCAL_URL,
        fallbackUrl: MERMAID_CDN_URL,
        pinned: true,
    };
}

export function sanitizeMermaidSvg(rawSvg = "") {
    if (typeof DOMPurify === 'undefined') {
        console.error("DOMPurify is not loaded! Cannot safely render SVG.");
        return "";
    }
    // svgFilters keeps the hand-drawn effect's filter primitives; without them the filter is empty and every
    // shape drawn through it becomes invisible.
    const sanitized = DOMPurify.sanitize(String(rawSvg || ""), { USE_PROFILES: { svg: true, svgFilters: true } });
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, "image/svg+xml");
    if (doc.querySelector("parsererror")) return "";
    const svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== "svg") return "";

    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    return new XMLSerializer().serializeToString(svg);
}

export async function validateMermaid(source) {
    try {
        const mermaid = await loadMermaid();
        const result = mermaid.parse ? mermaid.parse(String(source || "")) : true;
        if (result && typeof result.then === "function") await result;
        return { ok: true, message: "Syntax looks valid" };
    } catch (error) {
        return { ok: false, message: error?.str || error?.message || String(error) };
    }
}

export async function renderMermaid(source, options = {}) {
    const diagramSource = String(source || "").trim();
    const theme = options.theme || "default";
    const style = normalizeMermaidStyle(options.style || {});
    if (!diagramSource) throw new Error("Mermaid source is empty.");
    const key = cacheKey(diagramSource, theme, style);
    if (svgCache.has(key)) return svgCache.get(key);

    renderQueue = renderQueue.then(async () => {
        await idle();
        const mermaid = await loadMermaid();
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            look: style.renderMode !== "real" && mermaidRenderModes(diagramSource).length > 1 ? "handDrawn" : "classic",
            theme,
            themeVariables: {
                fontFamily: style.fontFamily,
                fontSize: `${style.fontSize}px`,
                primaryColor: style.primaryColor,
                primaryTextColor: style.primaryTextColor,
                primaryBorderColor: style.lineColor,
                lineColor: style.lineColor,
                textColor: style.primaryTextColor,
                mainBkg: style.primaryColor,
                nodeBorder: style.lineColor,
                clusterBkg: style.backgroundColor,
                background: style.backgroundColor,
            },
            htmlLabels: false,
            // Gantt and ER diagrams take their text size from their own settings, not the theme's: the diagram's
            // Font size did nothing for them, and their 11-12px text was unreadable on a slide.
            gantt: {
                fontSize: style.fontSize,
                sectionFontSize: style.fontSize,
                barHeight: Math.round(style.fontSize * 1.6),
                barGap: Math.round(style.fontSize * 0.4),
                topPadding: Math.round(style.fontSize * 3),
            },
            er: { fontSize: style.fontSize },
            deterministicIds: true,
            deterministicIDSeed: `slideforge-${Math.abs(hashCode(key))}`,
            fontFamily: style.fontFamily,
        });
        const id = `sf-mermaid-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const rendered = await mermaid.render(id, diagramSource);
        const svg = sanitizeMermaidSvg(rendered?.svg || "");
        if (!svg) throw new Error("Mermaid rendered an empty or unsafe SVG.");
        const payload = { svg, bindFunctions: rendered?.bindFunctions || null };
        svgCache.set(key, payload);
        return payload;
    });

    return renderQueue;
}

export function clearMermaidCache() {
    svgCache.clear();
}

function hashCode(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}
