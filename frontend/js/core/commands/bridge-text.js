// Document import: text cleanup, matching and content-aware fitting for generated slides.

function _bridgeWordClamp(text, maxWords = 22) {
    const words = _bridgeCleanImportedText(text).split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return words.join(" ");
    return `${words.slice(0, maxWords).join(" ")}...`;
}

function _bridgeTokenSet(text) {
    const stop = new Set([
        "the",
        "and",
        "for",
        "with",
        "that",
        "this",
        "from",
        "into",
        "over",
        "under",
        "across",
        "after",
        "before",
        "figure",
        "panel",
        "shows",
        "show",
        "display",
        "displays",
        "result",
        "results",
        "using",
        "method",
        "methods",
        "simulation",
        "simulations",
    ]);
    return new Set(
        String(text || "")
            .toLowerCase()
            .match(/[a-z0-9][a-z0-9-]{2,}/g)
            ?.filter(token => !stop.has(token)) || [],
    );
}

function _bridgeTextMatchScore(left, right) {
    const a = _bridgeTokenSet(left);
    const b = _bridgeTokenSet(right);
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    a.forEach(token => {
        if (b.has(token)) overlap += 1;
    });
    return overlap / Math.max(1, Math.min(a.size, b.size));
}

function _bridgeSlideMatchText(slide) {
    const parts = [slide?.title, slide?.claim, slide?.goal];
    (Array.isArray(slide?.points) ? slide.points : []).forEach(point => {
        parts.push(point?.heading);
        const content = Array.isArray(point?.content) ? point.content : [point?.content];
        parts.push(...content);
    });
    return parts.filter(Boolean).join(" ");
}

function _bridgeTextPlain(value) {
    return String(value || "")
        .replace(/<[^>]*>/g, "")
        .trim();
}

const BRIDGE_CASE_ACRONYMS = [
    "MD",
    "ML",
    "AI",
    "DNA",
    "RNA",
    "PDB",
    "RMSD",
    "RMSF",
    "PCA",
    "UMAP",
    "t-SNE",
    "GNN",
    "CNN",
    "RNN",
    "AUC",
    "ROC",
    "MSE",
    "RMSE",
    "MAE",
    "GPU",
    "CPU",
    "NVT",
    "NPT",
    "PMF",
    "MSM",
    "FEP",
    "TI",
];

function _bridgeHumanizeImportedCase(value) {
    const raw = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    if (!raw) return "";
    const letters = raw.match(/[A-Za-z]/g) || [];
    if (letters.length < 8 && !/\s/.test(raw)) return raw;
    const uppercase = letters.filter(ch => ch === ch.toUpperCase()).length;
    const lowercase = letters.filter(ch => ch === ch.toLowerCase()).length;
    if (uppercase / letters.length < 0.78 || lowercase > 2) return raw;
    let text = raw.toLowerCase();
    text = text.replace(/(^|[.!?:]\s+)([a-z])/g, (_, prefix, ch) => `${prefix}${ch.toUpperCase()}`);
    BRIDGE_CASE_ACRONYMS.forEach(acronym => {
        const escaped = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`\\b${escaped}\\b`, "gi"), acronym);
    });
    text = text.replace(/\b([a-z]+)(\d+)\b/g, (_, word, number) => `${word.toUpperCase()}${number}`);
    return text;
}

function _bridgeCleanImportedText(value, fallback = "") {
    const cleaned = String(value || "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[•\-\u2022]\s*/, "")
        .trim();
    return cleaned ? _bridgeHumanizeImportedCase(cleaned) : fallback;
}

function _bridgeIsPlaceholderText(text) {
    return /^(imported presentation|imported (slide )?content|imported figure|imported section from the source document|insert figure( \/ chart)? here|chart \/ graph placeholder|insert figure or chart here|insert chart:.*)$/i.test(
        String(text || "")
            .replace(/[\[\]]/g, "")
            .trim(),
    );
}

function _bridgeFindText(elements, matcher) {
    return (elements || []).find(el => el.type === "text" && matcher(_bridgeTextPlain(el.content), el));
}

function _bridgeSetTextByPlaceholder(elements, placeholder, content) {
    const el = _bridgeFindText(elements, text => text === placeholder);
    if (el) el.content = content || "";
    return el;
}

function _bridgeSetTextByPlaceholders(elements, placeholders, content) {
    for (const placeholder of placeholders) {
        const el = _bridgeSetTextByPlaceholder(elements, placeholder, content);
        if (el) return el;
    }
    return null;
}

function _bridgeSetFirstBulletBlock(elements, content, options = {}) {
    const el = (elements || []).find(item => item.type === "text" && Array.isArray(item.content));
    if (!el) return null;
    el.content = content;
    if (options.x != null) el.x = options.x;
    if (options.y != null) el.y = options.y;
    if (options.width != null) el.width = `${options.width}px`;
    if (options.fontSize) el.styles.fontSize = options.fontSize;
    return el;
}

function _bridgeBulletPlainText(item) {
    if (typeof item === "string") return _bridgeCleanImportedText(item);
    return _bridgeCleanImportedText(item?.html || item?.text || "");
}

function _bridgeSetBulletLines(elements, content, options = {}) {
    const structured = _bridgeSetFirstBulletBlock(elements, content, options);
    if (structured) return structured;
    const bulletTexts = (Array.isArray(content) ? content : []).map(_bridgeBulletPlainText).filter(Boolean);
    if (!bulletTexts.length) return null;
    const bulletEls = (elements || []).filter(
        item => item.type === "text" && /^•\s+/.test(_bridgeTextPlain(item.content)),
    );
    bulletEls.forEach((el, idx) => {
        el.content = bulletTexts[idx] ? `• ${bulletTexts[idx]}` : "";
    });
    return bulletEls[0] || null;
}

function _bridgeContentText(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => _bridgeTextPlain(item?.html || item?.text || ""))
            .filter(Boolean)
            .join(" ");
    }
    return _bridgeTextPlain(value);
}

function _bridgeTextLineCount(value, charsPerLine) {
    if (Array.isArray(value)) {
        return value.reduce((sum, item) => {
            const text = _bridgeTextPlain(item?.html || item?.text || "");
            if (!text) return sum;
            return sum + Math.max(1, Math.ceil(text.length / charsPerLine)) + (item?.level ? 0.15 : 0.35);
        }, 0);
    }
    const chunks = String(_bridgeTextPlain(value) || "")
        .split(/\n+/)
        .filter(Boolean);
    if (!chunks.length) return 1;
    return chunks.reduce((sum, chunk) => sum + Math.max(1, Math.ceil(chunk.length / charsPerLine)), 0);
}

function _bridgeFitTextElement(el, { maxHeight, minFontSize = 11, minLineHeight = 1.16 } = {}) {
    if (!el || el.type !== "text" || !maxHeight) return;
    const width = parseFloat(el.width) || 320;
    const styles = el.styles || {};
    const originalFont = parseFloat(styles.fontSize) || 18;
    let fontSize = originalFont;
    let lineHeight = parseFloat(styles.lineHeight) || 1.35;
    const text = _bridgeContentText(el.content);
    if (!text) return;

    for (let i = 0; i < 16; i += 1) {
        const charsPerLine = Math.max(8, Math.floor(width / Math.max(5.5, fontSize * 0.54)));
        const lines = _bridgeTextLineCount(el.content, charsPerLine);
        const estimatedHeight = Math.ceil(lines * fontSize * lineHeight + 10);
        if (estimatedHeight <= maxHeight || fontSize <= minFontSize) break;
        if (lineHeight > minLineHeight + 0.01) {
            lineHeight = Math.max(minLineHeight, lineHeight - 0.05);
        } else {
            fontSize = Math.max(minFontSize, fontSize - 1);
        }
    }

    el.styles = {
        ...styles,
        fontSize: `${Math.round(fontSize)}px`,
        lineHeight: String(Number(lineHeight.toFixed(2))),
        overflow: "hidden",
    };
    el.height = `${maxHeight}px`;
    el.autoHeight = false;
}

function _bridgeFindNearText(elements, x, y, tolerance = 8) {
    return (elements || []).find(el => {
        if (el.type !== "text") return false;
        return Math.abs((parseFloat(el.x) || 0) - x) <= tolerance && Math.abs((parseFloat(el.y) || 0) - y) <= tolerance;
    });
}

function _bridgeApplyContentAwareFit(slideState) {
    const layoutId = slideState?.layoutId;
    const elements = slideState?.elements || [];
    const fitAt = (x, y, maxHeight, options = {}) =>
        _bridgeFitTextElement(_bridgeFindNearText(elements, x, y), { maxHeight, ...options });
    const fitArrayText = (index, maxHeight, options = {}) => {
        const el = elements.filter(item => item.type === "text" && Array.isArray(item.content))[index];
        _bridgeFitTextElement(el, { maxHeight, ...options });
    };

    if (layoutId === "title-page") {
        fitAt(80, 220, 126, { minFontSize: 30, minLineHeight: 1.02 });
        fitAt(80, 358, 36, { minFontSize: 13 });
        fitAt(80, 400, 56, { minFontSize: 11 });
        return slideState;
    }
    if (layoutId === "section-divider") {
        fitAt(400, 270, 72, { minFontSize: 26, minLineHeight: 1.02 });
        fitAt(400, 355, 112, { minFontSize: 13 });
        return slideState;
    }
    if (layoutId === "content-slide") {
        fitAt(76, 44, 60, { minFontSize: 24, minLineHeight: 1.02 });
        fitAt(54, 126, 42, { minFontSize: 13 });
        fitArrayText(0, 370, { minFontSize: 14, minLineHeight: 1.18 });
        fitAt(790, 384, 72, { minFontSize: 12 });
        return slideState;
    }
    if (layoutId === "two-column") {
        fitAt(76, 22, 62, { minFontSize: 24, minLineHeight: 1.05 });
        fitArrayText(0, 548, { minFontSize: 13, minLineHeight: 1.18 });
        fitArrayText(1, 548, { minFontSize: 13, minLineHeight: 1.18 });
        return slideState;
    }
    if (layoutId === "figure-caption") {
        fitAt(76, 22, 62, { minFontSize: 23, minLineHeight: 1.05 });
        fitAt(54, 106, 36, { minFontSize: 12 });
        fitAt(54, 582, 48, { minFontSize: 10 });
        fitAt(698, 202, 122, { minFontSize: 12, minLineHeight: 1.18 });
        fitAt(698, 330, 34, { minFontSize: 15 });
        fitAt(698, 368, 52, { minFontSize: 10 });
        return slideState;
    }
    if (layoutId === "results-data") {
        fitAt(76, 22, 62, { minFontSize: 23, minLineHeight: 1.05 });
        fitAt(54, 106, 34, { minFontSize: 12 });
        fitAt(54, 538, 46, { minFontSize: 10 });
        [136, 276, 416].forEach(y => {
            fitAt(716, y + 18, 36, { minFontSize: 14 });
            fitAt(716, y + 58, 44, { minFontSize: 10 });
        });
        return slideState;
    }
    if (layoutId === "conclusion") {
        fitAt(76, 18, 58, { minFontSize: 26, minLineHeight: 1.05 });
        fitArrayText(0, 432, { minFontSize: 13, minLineHeight: 1.18 });
        fitAt(54, 614, 44, { minFontSize: 10 });
    }
    return slideState;
}
