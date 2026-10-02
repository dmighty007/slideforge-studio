// Slide presets: metadata, slot inference, recent usage and recommendations.

const PRESET_METADATA = {
    "poster-conference": {
        category: "poster",
        narrativeRole: "poster",
        contentTypes: ["poster", "figure", "summary"],
        audience: ["conference", "scientific"],
        density: "high",
        keywords: ["poster", "conference", "abstract", "qr", "doi"],
        aiHint: "Use for conference poster exports with title, columns, figures, and takeaway.",
    },
    "talk-title": {
        category: "talk",
        narrativeRole: "open",
        contentTypes: ["title", "subtitle", "author"],
        audience: ["conference", "general"],
        density: "low",
        keywords: ["talk", "title", "conference", "opening"],
        aiHint: "Use as the opening slide for a professional talk.",
    },
    "talk-key-message": {
        category: "talk",
        narrativeRole: "claim",
        contentTypes: ["claim", "bullets", "chart"],
        audience: ["conference", "business", "scientific"],
        density: "medium",
        keywords: ["talk", "key message", "claim", "evidence"],
        aiHint: "Use for one central talk takeaway with supporting evidence.",
    },
    "lecture-concept": {
        category: "lecture",
        narrativeRole: "explain",
        contentTypes: ["definition", "diagram", "example"],
        audience: ["students", "teaching"],
        density: "medium",
        keywords: ["lecture", "concept", "definition", "example"],
        aiHint: "Use to introduce a concept with definition, mechanism, and example.",
    },
    "lecture-worked-example": {
        category: "lecture",
        narrativeRole: "practice",
        contentTypes: ["problem", "steps", "answer"],
        audience: ["students", "teaching"],
        density: "medium",
        keywords: ["lecture", "worked example", "problem", "solution"],
        aiHint: "Use to teach a step-by-step worked example.",
    },
    "paper-title": {
        category: "paper",
        narrativeRole: "open",
        contentTypes: ["title", "abstract", "citation"],
        audience: ["scientific", "reading group"],
        density: "medium",
        keywords: ["paper", "summary", "abstract", "reading group"],
        aiHint: "Use for paper summaries, journal clubs, and handout exports.",
    },
    "paper-figure": {
        category: "paper",
        narrativeRole: "evidence",
        contentTypes: ["figure", "caption", "interpretation"],
        audience: ["scientific", "technical"],
        density: "medium",
        keywords: ["paper", "figure", "caption", "result"],
        aiHint: "Use for a publication figure with interpretation.",
    },
    "paper-methods": {
        category: "paper",
        narrativeRole: "method",
        contentTypes: ["workflow", "method", "reproducibility"],
        audience: ["scientific", "technical"],
        density: "medium",
        keywords: ["paper", "methods", "workflow", "protocol"],
        aiHint: "Use for methods and reproducibility summaries.",
    },
    "paper-references": {
        category: "paper",
        narrativeRole: "appendix",
        contentTypes: ["references", "citations"],
        audience: ["scientific"],
        density: "high",
        keywords: ["references", "bibliography", "citations", "paper"],
        aiHint: "Use for references or paper appendix slides.",
    },
    "title-page": {
        category: "narrative",
        narrativeRole: "open",
        contentTypes: ["title", "subtitle", "author"],
        audience: ["general", "conference", "scientific"],
        density: "low",
        keywords: ["title", "cover", "opening", "talk"],
        aiHint: "Use for the first slide or a major restart.",
    },
    "section-divider": {
        category: "narrative",
        narrativeRole: "transition",
        contentTypes: ["section", "milestone"],
        audience: ["general", "conference"],
        density: "low",
        keywords: ["section", "divider", "chapter", "transition"],
        aiHint: "Use to pace long decks and reset attention.",
    },
    "content-slide": {
        category: "narrative",
        narrativeRole: "context",
        contentTypes: ["paragraph", "bullets"],
        audience: ["general", "business", "scientific"],
        density: "medium",
        keywords: ["content", "bullets", "explain", "summary"],
        aiHint: "Use for one idea with supporting explanation.",
    },
    "two-column": {
        category: "comparison",
        narrativeRole: "comparison",
        contentTypes: ["comparison", "bullets"],
        audience: ["general", "business", "scientific"],
        density: "medium",
        keywords: ["two column", "compare", "split", "before after"],
        aiHint: "Use when two ideas need equal visual weight.",
    },
    "figure-caption": {
        category: "scientific",
        narrativeRole: "evidence",
        contentTypes: ["figure", "caption", "image", "chart"],
        audience: ["scientific", "technical"],
        density: "expert",
        keywords: ["figure", "caption", "image", "evidence", "publication"],
        aiHint: "Use for publication-style figure explanation.",
    },
    methodology: {
        category: "scientific",
        narrativeRole: "method",
        contentTypes: ["workflow", "method", "process"],
        audience: ["scientific", "technical"],
        density: "expert",
        keywords: ["method", "workflow", "protocol", "pipeline"],
        aiHint: "Use to explain how the result was produced.",
    },
    "results-data": {
        category: "data",
        narrativeRole: "evidence",
        contentTypes: ["chart", "metric", "result"],
        audience: ["scientific", "business", "technical"],
        density: "medium",
        keywords: ["results", "data", "chart", "metric", "evidence"],
        aiHint: "Use for result claims backed by quantitative evidence.",
    },
    conclusion: {
        category: "narrative",
        narrativeRole: "close",
        contentTypes: ["takeaway", "summary"],
        audience: ["general", "conference", "scientific"],
        density: "low",
        keywords: ["conclusion", "takeaway", "summary", "close"],
        aiHint: "Use to make the final point memorable.",
    },
    bibliography: {
        category: "scientific",
        narrativeRole: "appendix",
        contentTypes: ["references", "citations"],
        audience: ["scientific"],
        density: "expert",
        keywords: ["references", "bibliography", "citations", "doi"],
        aiHint: "Use for references or appendix citations.",
    },
    "blank-titled": {
        category: "narrative",
        narrativeRole: "context",
        contentTypes: ["blank", "custom"],
        audience: ["general"],
        density: "low",
        keywords: ["blank", "custom", "title"],
        aiHint: "Use for custom layouts.",
    },
    "quote-slide": {
        category: "narrative",
        narrativeRole: "context",
        contentTypes: ["quote", "citation"],
        audience: ["general", "editorial"],
        density: "low",
        keywords: ["quote", "citation", "statement"],
        aiHint: "Use to isolate a memorable statement.",
    },
    "timeline-slide": {
        category: "animation",
        narrativeRole: "transition",
        contentTypes: ["timeline", "milestones"],
        audience: ["general", "business", "scientific"],
        density: "medium",
        keywords: ["timeline", "sequence", "milestone", "roadmap"],
        aiHint: "Use for temporal structure or staged builds.",
    },
    agenda: {
        category: "narrative",
        narrativeRole: "open",
        contentTypes: ["agenda", "outline"],
        audience: ["general", "business", "scientific"],
        density: "medium",
        keywords: ["agenda", "outline", "contents"],
        aiHint: "Use near the start to set expectations.",
    },
    "big-number": {
        category: "data",
        narrativeRole: "claim",
        contentTypes: ["metric", "kpi", "number"],
        audience: ["business", "conference"],
        density: "low",
        keywords: ["number", "metric", "kpi", "headline"],
        aiHint: "Use for one dominant quantitative takeaway.",
    },
    "cards-grid": {
        category: "comparison",
        narrativeRole: "synthesis",
        contentTypes: ["cards", "list", "features"],
        audience: ["general", "business"],
        density: "medium",
        keywords: ["cards", "grid", "features", "modules"],
        aiHint: "Use for parallel concepts or grouped ideas.",
    },
    "problem-solution": {
        category: "narrative",
        narrativeRole: "claim",
        contentTypes: ["problem", "solution", "argument"],
        audience: ["business", "conference"],
        density: "medium",
        keywords: ["problem", "solution", "argument"],
        aiHint: "Use to frame why a proposal matters.",
    },
    "image-grid": {
        category: "scientific",
        narrativeRole: "evidence",
        contentTypes: ["image", "figure", "multi-panel"],
        audience: ["scientific", "editorial"],
        density: "expert",
        keywords: ["image", "grid", "multi panel", "figure"],
        aiHint: "Use for multi-panel figure collections.",
    },
    dashboard: {
        category: "dashboard",
        narrativeRole: "evidence",
        contentTypes: ["dashboard", "metrics", "charts"],
        audience: ["business", "technical"],
        density: "high",
        keywords: ["dashboard", "metrics", "status", "monitoring"],
        aiHint: "Use for dense metric monitoring.",
    },
    swot: {
        category: "comparison",
        narrativeRole: "comparison",
        contentTypes: ["matrix", "swot", "strategy"],
        audience: ["business"],
        density: "medium",
        keywords: ["swot", "matrix", "strategy", "tradeoff"],
        aiHint: "Use for strategic comparison.",
    },
    "comparison-table": {
        category: "comparison",
        narrativeRole: "comparison",
        contentTypes: ["table", "comparison", "decision"],
        audience: ["business", "scientific"],
        density: "high",
        keywords: ["table", "comparison", "decision", "options"],
        aiHint: "Use when exact differences matter.",
    },
    "thank-you": {
        category: "narrative",
        narrativeRole: "close",
        contentTypes: ["closing", "contact"],
        audience: ["general", "conference"],
        density: "low",
        keywords: ["thank you", "questions", "contact", "close"],
        aiHint: "Use as a final slide.",
    },
};

const PRESET_CATEGORY_LABELS = {
    recommended: "Recommended",
    poster: "Posters",
    talk: "Talks",
    lecture: "Lectures",
    paper: "Papers",
    narrative: "Narrative",
    scientific: "Scientific",
    data: "Data",
    comparison: "Comparison",
    dashboard: "Dashboard",
    whiteboard: "Whiteboard",
    interactive: "Interactive",
    animation: "Motion",
};

function installPresetMetadata() {
    Object.entries(SLIDE_PRESETS).forEach(([id, preset]) => {
        const metadata = PRESET_METADATA[id] || {
            category: "narrative",
            narrativeRole: "context",
            contentTypes: ["content"],
            audience: ["general"],
            density: "medium",
            keywords: [preset.name || id],
            aiHint: "Use for general slide composition.",
        };
        preset.metadata = metadata;
        preset.category = metadata.category;
        preset.narrativeRole = metadata.narrativeRole;
        preset.slots = inferPresetSlots(id, metadata);
        preset.ai = {
            recommendationSignals: metadata.keywords,
            promptHints: [metadata.aiHint],
            rewriteGuidance: metadata.aiHint,
        };
    });
}

function inferPresetSlots(id, metadata) {
    const slots = [{ id: "title", type: "text", semanticRole: "heading", required: id !== "blank-titled", priority: 1 }];
    if (metadata.contentTypes.includes("figure") || metadata.contentTypes.includes("image")) {
        slots.push({ id: "figure", type: "figure", semanticRole: "evidence", required: true, priority: 2 });
        slots.push({ id: "caption", type: "caption", semanticRole: "figure-caption", required: false, priority: 3 });
    } else if (metadata.contentTypes.includes("chart") || metadata.contentTypes.includes("metric")) {
        slots.push({ id: "data", type: "chart", semanticRole: "evidence", required: true, priority: 2 });
        slots.push({ id: "insight", type: "text", semanticRole: "interpretation", required: false, priority: 3 });
    } else if (metadata.contentTypes.includes("workflow")) {
        slots.push({ id: "steps", type: "diagram", semanticRole: "method-flow", required: true, priority: 2 });
    } else {
        slots.push({ id: "body", type: "text", semanticRole: "supporting-content", required: false, priority: 2 });
    }
    return slots;
}

function getPresetMetadata(presetId) {
    return SLIDE_PRESETS[presetId]?.metadata || PRESET_METADATA[presetId] || null;
}

function getPresetRecentList() {
    try {
        return JSON.parse(localStorage.getItem("slideforge_recent_presets") || "[]");
    } catch {
        return [];
    }
}

function rememberPresetUsage(presetId) {
    const recent = [presetId, ...getPresetRecentList().filter(id => id !== presetId)].slice(0, 6);
    localStorage.setItem("slideforge_recent_presets", JSON.stringify(recent));
}

function getSlideContentSignals(slide = state?.slides?.[currentSlideIndex]) {
    const elements = Array.isArray(slide?.elements) ? slide.elements : [];
    const types = new Set(elements.map(el => el.type));
    const text = elements
        .filter(el => el.type === "text")
        .map(el => String(el.content || ""))
        .join(" ")
        .toLowerCase();
    const keywords = [];
    if (types.has("chart")) keywords.push("chart", "data", "results");
    if (types.has("image")) keywords.push("image", "figure");
    if (types.has("equation")) keywords.push("equation", "method");
    if (types.has("mermaid") || types.has("connector")) keywords.push("diagram", "workflow", "pathway");
    if (/method|protocol|pipeline|workflow/.test(text)) keywords.push("method", "workflow");
    if (/result|increase|decrease|significant|auc|p value|fold|metric/.test(text)) keywords.push("result", "metric", "data");
    if (/compare|versus|vs|tradeoff|option/.test(text)) keywords.push("comparison");
    return {
        elementCount: elements.length,
        types: [...types],
        keywords,
        density: elements.length > 8 ? "expert" : elements.length > 5 ? "high" : elements.length > 2 ? "medium" : "low",
    };
}

function scorePresetForContext(presetId, preset, signals = getSlideContentSignals()) {
    const meta = preset.metadata || {};
    let score = 0;
    if (presetId === state?.slides?.[currentSlideIndex]?.layoutId) score += 16;
    if (getPresetRecentList().includes(presetId)) score += 8;
    signals.keywords.forEach(keyword => {
        if ((meta.keywords || []).some(item => item.includes(keyword) || keyword.includes(item))) score += 12;
        if ((meta.contentTypes || []).includes(keyword)) score += 10;
    });
    if (signals.types.includes("chart") && ["data", "dashboard", "scientific"].includes(meta.category)) score += 14;
    if (signals.types.includes("image") && meta.category === "scientific") score += 14;
    if (signals.density === "expert" && ["expert", "high"].includes(meta.density)) score += 8;
    if (signals.elementCount <= 1 && ["open", "transition", "close"].includes(meta.narrativeRole)) score += 5;
    return score;
}

function recommendSlidePresets(context = {}) {
    const signals = context.signals || getSlideContentSignals();
    return Object.entries(SLIDE_PRESETS)
        .filter(([, preset]) => !preset.hiddenInPalette)
        .map(([id, preset]) => ({
            id,
            preset,
            score: scorePresetForContext(id, preset, signals),
            reason: preset.metadata?.aiHint || "Matches current slide context.",
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

window.getPresetMetadata = getPresetMetadata;

window.recommendSlidePresets = recommendSlidePresets;

window.rememberPresetUsage = rememberPresetUsage;
