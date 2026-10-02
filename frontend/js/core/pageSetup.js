const PRESENTATION_PAGE_SETUPS = {
    "talk-16-9": { id: "talk-16-9", label: "Talk 16:9", width: 1280, height: 720 },
    "lecture-16-10": { id: "lecture-16-10", label: "Lecture 16:10", width: 1280, height: 800 },
    "paper-letter": { id: "paper-letter", label: "Paper / Handout", width: 816, height: 1056 },
    "poster-portrait": { id: "poster-portrait", label: "Conference Poster", width: 1440, height: 1920 },
    "standard-4-3": { id: "standard-4-3", label: "Classic 4:3", width: 1024, height: 768 },
    "widescreen-16-9": { id: "widescreen-16-9", label: "Legacy 16:9", width: 1280, height: 720 },
    "widescreen-16-10": { id: "widescreen-16-10", label: "Legacy 16:10", width: 1280, height: 800 },
};

// Decks saved without a page setup were made at 4:3, so that stays the fallback when reading one.
const DEFAULT_PRESENTATION_PAGE_SETUP = "standard-4-3";
// A new deck is widescreen, as in current PowerPoint and Keynote.
const NEW_PRESENTATION_PAGE_SETUP = "talk-16-9";

function normalizePresentationPageSetup(value) {
    return PRESENTATION_PAGE_SETUPS[value] ? value : DEFAULT_PRESENTATION_PAGE_SETUP;
}

function getPresentationPageSetupId(source = null) {
    const candidate = source && typeof source === "object" ? source.pageSetup : typeof state !== "undefined" ? state?.pageSetup : null;
    return normalizePresentationPageSetup(candidate);
}

function getPresentationPageSetupConfig(source = null) {
    return PRESENTATION_PAGE_SETUPS[getPresentationPageSetupId(source)];
}

function ensurePresentationPageSetup(source = null) {
    const target = source && typeof source === "object" ? source : typeof state !== "undefined" ? state : null;
    if (!target || typeof target !== "object") return DEFAULT_PRESENTATION_PAGE_SETUP;
    const normalized = normalizePresentationPageSetup(target.pageSetup);
    target.pageSetup = normalized;
    return normalized;
}

function _scaleLengthValue(value, ratio) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return `${_layoutNumber(value * ratio)}px`;
    }
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed || trimmed === "auto") return value;
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)px$/i);
    if (!match) return value;
    return `${_layoutNumber(Number(match[1]) * ratio)}px`;
}

function _layoutNumber(value) {
    const rounded = Number(Number(value || 0).toFixed(4));
    const integer = Math.round(rounded);
    return Math.abs(rounded - integer) < 0.001 ? integer : rounded;
}

function _pxNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return NaN;
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
    return match ? Number(match[1]) : NaN;
}

function _scaleNumericArray(values, ratio) {
    if (!Array.isArray(values)) return values;
    return values.map(value => _layoutNumber((Number(value) || 0) * ratio));
}

function _scaleElementStylesForPageSetup(styles, metricScale, fontScale = 1) {
    if (!styles || typeof styles !== "object") return styles;
    const next = { ...styles };
    ["padding", "borderRadius", "borderWidth"].forEach(key => {
        if (next[key] !== undefined) next[key] = _scaleLengthValue(next[key], metricScale);
    });
    ["fontSize", "letterSpacing"].forEach(key => {
        if (next[key] !== undefined) next[key] = _scaleLengthValue(next[key], fontScale);
    });
    return next;
}

// One axis of a frame on the new page: centred where it was, but an object that sat inside the old page stays
// inside the new one with its margins scaled. The uniform size scale could leave a wide title wider than its
// share of a narrower page, so it started left of the slide (x < 0).
function _fitFrameAxisToPage(start, size, nextSize, scale, fromLength, toLength) {
    let fitted = nextSize;
    let nextStart = (start + size / 2) * scale - fitted / 2;
    const wasInside = start >= -0.5 && start + size <= fromLength + 0.5;
    if (wasInside && Number.isFinite(fromLength) && Number.isFinite(toLength)) {
        const leadMargin = Math.max(0, start) * scale;
        const trailMargin = Math.max(0, fromLength - (start + size)) * scale;
        fitted = Math.max(1, Math.min(fitted, toLength - leadMargin - trailMargin));
        nextStart = Math.max(leadMargin, Math.min((start + size / 2) * scale - fitted / 2, toLength - trailMargin - fitted));
    }
    return [_layoutNumber(nextStart), Math.max(1, _layoutNumber(fitted))];
}

function _scaleElementFrameForPageSetup(element, scaleX, scaleY, sizeScale, fromConfig = null, toConfig = null) {
    const next = { ...element };
    const x = Number(next.x);
    const y = Number(next.y);
    const width = _pxNumber(next.width);
    const height = _pxNumber(next.height);
    const hasFrame = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height);

    if (hasFrame) {
        const [nextX, nextWidth] = _fitFrameAxisToPage(x, width, width * sizeScale, scaleX, fromConfig?.width, toConfig?.width);
        const [nextY, nextHeight] = _fitFrameAxisToPage(y, height, height * sizeScale, scaleY, fromConfig?.height, toConfig?.height);
        next.x = nextX;
        next.y = nextY;
        next.width = `${nextWidth}px`;
        next.height = `${nextHeight}px`;
        return next;
    }

    if (Number.isFinite(x)) next.x = _layoutNumber(x * scaleX);
    if (Number.isFinite(y)) next.y = _layoutNumber(y * scaleY);
    next.width = _scaleLengthValue(next.width, sizeScale);
    if (!(typeof next.height === "string" && next.height.trim() === "auto")) {
        next.height = _scaleLengthValue(next.height, sizeScale);
    }
    return next;
}

function _scaleConnectorPointsForPageSetup(points, scaleX, scaleY, sizeScale) {
    if (!Array.isArray(points) || !points.length) return points;
    const normalized = points.map(point => ({
        x: Number(point?.x || 0),
        y: Number(point?.y || 0),
    }));
    const minX = Math.min(...normalized.map(point => point.x));
    const maxX = Math.max(...normalized.map(point => point.x));
    const minY = Math.min(...normalized.map(point => point.y));
    const maxY = Math.max(...normalized.map(point => point.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const nextCenterX = centerX * scaleX;
    const nextCenterY = centerY * scaleY;
    return normalized.map(point => ({
        x: _layoutNumber(nextCenterX + (point.x - centerX) * sizeScale),
        y: _layoutNumber(nextCenterY + (point.y - centerY) * sizeScale),
    }));
}

function _scaleDrawingObjectForPageSetup(element, scaleX, scaleY, sizeScale) {
    if (!element || typeof element !== "object") return element;
    if (Number(element.schemaVersion) >= 2 && element.geometry && typeof element.geometry === "object") {
        const next = JSON.parse(JSON.stringify(element));
        const geometry = next.geometry;
        if (Array.isArray(geometry.points)) {
            geometry.points = _scaleConnectorPointsForPageSetup(geometry.points, scaleX, scaleY, sizeScale);
        }
        const x = Number(geometry.x);
        const y = Number(geometry.y);
        const width = Number(geometry.width);
        const height = Number(geometry.height);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
            const nextWidth = width * sizeScale;
            const nextHeight = height * sizeScale;
            geometry.x = _layoutNumber((x + width / 2) * scaleX - nextWidth / 2);
            geometry.y = _layoutNumber((y + height / 2) * scaleY - nextHeight / 2);
            geometry.width = Math.max(1, _layoutNumber(nextWidth));
            geometry.height = Math.max(1, _layoutNumber(nextHeight));
        } else {
            if (Number.isFinite(x)) geometry.x = _layoutNumber(x * scaleX);
            if (Number.isFinite(y)) geometry.y = _layoutNumber(y * scaleY);
        }
        if (next.style && Number.isFinite(Number(next.style.strokeWidth))) {
            next.style.strokeWidth = Math.max(0.5, _layoutNumber(Number(next.style.strokeWidth) * sizeScale));
        }
        if (next.style && Number.isFinite(Number(next.style.fontSize))) {
            next.style.fontSize = Math.max(6, _layoutNumber(Number(next.style.fontSize) * sizeScale));
        }
        return next;
    }
    if (element.type === "freehand" && Array.isArray(element.points)) {
        return {
            ...element,
            points: _scaleConnectorPointsForPageSetup(element.points, scaleX, scaleY, sizeScale),
        };
    }
    const next = { ...element };
    const x = Number(next.x);
    const y = Number(next.y);
    const width = Number(next.width);
    const height = Number(next.height);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
        const nextWidth = width * sizeScale;
        const nextHeight = height * sizeScale;
        next.x = _layoutNumber((x + width / 2) * scaleX - nextWidth / 2);
        next.y = _layoutNumber((y + height / 2) * scaleY - nextHeight / 2);
        next.width = Math.max(1, _layoutNumber(nextWidth));
        next.height = Math.max(1, _layoutNumber(nextHeight));
    } else {
        if (Number.isFinite(x)) next.x = _layoutNumber(x * scaleX);
        if (Number.isFinite(y)) next.y = _layoutNumber(y * scaleY);
    }
    return next;
}

// Switching the slide size and back gives the same layout. The scaling keeps objects inside the new page, which
// cannot be undone exactly (16:9 -> 4:3 -> 16:9 left every title box 154 px narrower). Each object therefore
// remembers the layout it had at a size (sizeMemo.saved) and gets it back when the deck returns to that size,
// provided it was not moved or resized in between (sizeMemo.at is what the last size change produced).
function _layoutForSizeMemo(element) {
    const table = element.tableData;
    return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        ...(Array.isArray(element.points) ? { points: element.points } : {}),
        ...(element.styles ? { styles: { padding: element.styles.padding, borderRadius: element.styles.borderRadius, borderWidth: element.styles.borderWidth, fontSize: element.styles.fontSize, letterSpacing: element.styles.letterSpacing } } : {}),
        ...(table && typeof table === "object" ? { table: { cellPadding: table.cellPadding, rowHeights: table.rowHeights, colWidths: table.colWidths } } : {}),
    };
}

function _applyLayoutFromSizeMemo(element, layout) {
    ["x", "y", "width", "height"].forEach(key => {
        if (layout[key] !== undefined) element[key] = layout[key];
    });
    if (layout.points) element.points = layout.points;
    if (layout.styles && element.styles) {
        Object.entries(layout.styles).forEach(([key, value]) => {
            if (value === undefined) delete element.styles[key];
            else element.styles[key] = value;
        });
    }
    if (layout.table && element.tableData) Object.assign(element.tableData, layout.table);
}

function _rememberLayoutAcrossSizes(previous, next, fromConfig, toConfig) {
    if (!fromConfig?.id || !toConfig?.id) return next;
    const memo = previous.sizeMemo;
    const now = JSON.stringify(_layoutForSizeMemo(previous));
    // A text box that grows with its text gets a new height at every render: that is not the user touching it.
    const mark = element => JSON.stringify({ ..._layoutForSizeMemo(element), ...(element.autoHeight ? { height: null } : {}) });
    const untouched = Boolean(memo && memo.at?.setup === fromConfig.id && memo.at.layout === mark(previous));
    const saved = untouched ? { ...(memo.saved || {}) } : {};
    saved[fromConfig.id] = JSON.parse(now);
    if (untouched && saved[toConfig.id]) _applyLayoutFromSizeMemo(next, JSON.parse(JSON.stringify(saved[toConfig.id])));
    next.sizeMemo = { saved, at: { setup: toConfig.id, layout: mark(next) } };
    return next;
}

function scaleSlideElementsForPageSetup(slide, fromConfig, toConfig, options = {}) {
    if (!slide || !Array.isArray(slide.elements)) return slide;
    const scaleX = toConfig.width / fromConfig.width;
    const scaleY = toConfig.height / fromConfig.height;
    // Use a reversible uniform scale for object sizes and stroke-like style values.
    // `min(scaleX, scaleY)` causes recursive shrink when toggling between
    // aspect ratios because at least one axis is often below 1 on every change.
    // Text is intentionally preserved by default; rounded pixel font sizes can
    // otherwise ratchet down after repeated layout switches.
    const sizeScale = Math.sqrt(Math.max(0.0001, scaleX * scaleY));
    const fontScale = options.preserveTextSize === false ? sizeScale : 1;
    const nextSlide = JSON.parse(JSON.stringify(slide));
    nextSlide.elements = nextSlide.elements.map(element => {
        const next = _scaleElementFrameForPageSetup(element, scaleX, scaleY, sizeScale, fromConfig, toConfig);
        next.styles = _scaleElementStylesForPageSetup(next.styles, sizeScale, fontScale);
        if (next.tableData && typeof next.tableData === "object") {
            next.tableData = {
                ...next.tableData,
                cellPadding: _layoutNumber((Number(next.tableData.cellPadding) || 0) * sizeScale),
                rowHeights: _scaleNumericArray(next.tableData.rowHeights, sizeScale),
                colWidths: _scaleNumericArray(next.tableData.colWidths, sizeScale),
            };
        }
        if (next.type === "connector" && Array.isArray(next.points)) {
            next.points = _scaleConnectorPointsForPageSetup(next.points, scaleX, scaleY, sizeScale);
        }
        return _rememberLayoutAcrossSizes(element, next, fromConfig, toConfig);
    });
    if (Array.isArray(nextSlide.whiteboardElements)) {
        nextSlide.whiteboardElements = nextSlide.whiteboardElements.map(element =>
            _scaleDrawingObjectForPageSetup(element, scaleX, scaleY, sizeScale)
        );
    }
    return nextSlide;
}

function _scaleElementFrameResponsivelyForPageSetup(element, scaleX, scaleY) {
    const next = { ...element };
    const x = Number(next.x);
    const y = Number(next.y);
    const width = _pxNumber(next.width);
    const height = _pxNumber(next.height);

    if (Number.isFinite(x)) next.x = _layoutNumber(x * scaleX);
    if (Number.isFinite(y)) next.y = _layoutNumber(y * scaleY);
    if (Number.isFinite(width)) next.width = `${Math.max(1, _layoutNumber(width * scaleX))}px`;
    if (Number.isFinite(height) && !(typeof next.height === "string" && next.height.trim() === "auto")) {
        next.height = `${Math.max(1, _layoutNumber(height * scaleY))}px`;
    }
    return next;
}

function scalePresetElementsForPageSetup(slide, fromConfig, toConfig, options = {}) {
    if (!slide || !Array.isArray(slide.elements)) return slide;
    const scaleX = toConfig.width / fromConfig.width;
    const scaleY = toConfig.height / fromConfig.height;
    const metricScale = Math.min(scaleX, scaleY);
    // scaleTextUp: a preset built fresh from its 1024 x 768 design for a larger page (a poster) gets larger text;
    // kept at its design size it was tiny on the page. Only for fresh builds, so switching sizes back and forth
    // cannot grow the text step by step.
    const fontScale = options.preserveTextSize === false
        ? metricScale
        : options.scaleTextUp && metricScale > 1
          ? metricScale
          : Math.min(1, Math.max(0.92, metricScale));
    const nextSlide = JSON.parse(JSON.stringify(slide));
    nextSlide.elements = nextSlide.elements.map(element => {
        const next = _scaleElementFrameResponsivelyForPageSetup(element, scaleX, scaleY);
        next.styles = _scaleElementStylesForPageSetup(next.styles, metricScale, fontScale);
        if (next.tableData && typeof next.tableData === "object") {
            next.tableData = {
                ...next.tableData,
                cellPadding: _layoutNumber((Number(next.tableData.cellPadding) || 0) * metricScale),
                rowHeights: _scaleNumericArray(next.tableData.rowHeights, scaleY),
                colWidths: _scaleNumericArray(next.tableData.colWidths, scaleX),
            };
        }
        if (next.type === "connector" && Array.isArray(next.points)) {
            next.points = (next.points || []).map(point => ({
                x: _layoutNumber((Number(point?.x) || 0) * scaleX),
                y: _layoutNumber((Number(point?.y) || 0) * scaleY),
            }));
        }
        return next;
    });
    return nextSlide;
}

function canRebuildPresetSlideForPageSetup(slide) {
    if (!slide || !slide.layoutId || slide.layoutId === "blank-titled") return false;
    if (typeof SLIDE_PRESETS === "undefined" || !SLIDE_PRESETS?.[slide.layoutId]) return false;
    // The footer added to every slide is not part of the preset: counting it meant no preset slide was ever
    // rebuilt for a new size, only stretched (text then overlapped at 4:3 and poster size).
    const elements = (Array.isArray(slide.elements) ? slide.elements : []).filter(element => !element?.footerRole);
    if (!elements.length) return true;
    if (!elements.every(element => element?.themeManaged !== false)) return false;
    if (typeof buildPresetSlideState !== "function") return false;
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    const reference = buildPresetSlideState(slide.layoutId, theme, {
        slideId: slide.id,
        notes: slide.notes || "",
        background: slide.background || "",
        masterId: slide.masterId || null,
    });
    const referenceElements = Array.isArray(reference?.elements) ? reference.elements : [];
    if (referenceElements.length !== elements.length) return false;
    return referenceElements.every((element, index) => element?.type === elements[index]?.type);
}

function rebuildPresetSlideForPageSetup(slide, fromConfig = null, toConfig = null) {
    if (!canRebuildPresetSlideForPageSetup(slide) || typeof buildPresetSlideState !== "function") return null;
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    const nextSlide = buildPresetSlideState(slide.layoutId, theme, {
        slideId: slide.id,
        notes: slide.notes || "",
        background: slide.background || "",
        masterId: slide.masterId || null,
    });
    const footers = (slide.elements || []).filter(element => element?.footerRole);
    // The same preset rebuilt: its elements match one for one (canRebuild checked), so each keeps its own content.
    // Matching by type and order instead put the "TALK" label into the title and every text one slot down.
    const previous = (slide.elements || []).filter(element => !element?.footerRole);
    const rebuilt = nextSlide;
    rebuilt.elements = (nextSlide.elements || []).map((element, index) => {
        const source = previous[index];
        if (!source || source.type !== element.type || typeof _applyContentFromElementToPresetElement !== "function") return element;
        if (typeof _isReusablePresetContentElement === "function" && !_isReusablePresetContentElement(source)) return element;
        return { ..._applyContentFromElementToPresetElement(element, source), id: source.id || element.id };
    });
    // The slide's own footer (with any edits) comes along, moved to the new page size.
    if (footers.length) {
        const moved = fromConfig && toConfig
            ? scaleSlideElementsForPageSetup({ ...slide, elements: footers }, fromConfig, toConfig).elements
            : footers;
        rebuilt.elements = [...(rebuilt.elements || []), ...moved];
        rebuilt.editableMasterFooter = slide.editableMasterFooter;
        rebuilt.editableFooterNumberAlignmentVersion = slide.editableFooterNumberAlignmentVersion;
    }
    return rebuilt;
}

function syncPresentationPageSetup() {
    const config = getPresentationPageSetupConfig();
    document.documentElement.style.setProperty("--slide-width", `${config.width}px`);
    document.documentElement.style.setProperty("--slide-height", `${config.height}px`);
    document.documentElement.style.setProperty("--slide-preview-aspect", `${config.width} / ${config.height}`);
    const selector = document.getElementById("page-setup-selector");
    if (selector) selector.value = config.id;
    if (typeof Reveal !== "undefined" && typeof Reveal.configure === "function") {
        Reveal.configure({ width: config.width, height: config.height });
    }
}

function changePresentationPageSetup(nextId) {
    ensurePresentationPageSetup();
    const currentConfig = getPresentationPageSetupConfig();
    const normalized = normalizePresentationPageSetup(nextId);
    if (normalized === getPresentationPageSetupId()) {
        syncPresentationPageSetup();
        if (typeof renderSlidesFromState === "function") renderSlidesFromState();
        if (typeof resetZoom === "function") requestAnimationFrame(() => resetZoom());
        return false;
    }

    if (typeof saveStateToUndo === "function") saveStateToUndo();
    const nextConfig = PRESENTATION_PAGE_SETUPS[normalized];
    state.pageSetup = normalized;
    state.slides = (state.slides || []).map(slide => {
        const rebuilt = rebuildPresetSlideForPageSetup(slide, currentConfig, nextConfig);
        return rebuilt || scaleSlideElementsForPageSetup(slide, currentConfig, nextConfig);
    });
    syncPresentationPageSetup();
    if (typeof renderSlidesFromState === "function") renderSlidesFromState();
    if (typeof resetZoom === "function") requestAnimationFrame(() => resetZoom());
    if (typeof updateSlideCounter === "function") updateSlideCounter();
    return true;
}

function applyPresentationPageSetup(nextId) {
    return changePresentationPageSetup(nextId);
}

window.PRESENTATION_PAGE_SETUPS = PRESENTATION_PAGE_SETUPS;
window.DEFAULT_PRESENTATION_PAGE_SETUP = DEFAULT_PRESENTATION_PAGE_SETUP;
window.NEW_PRESENTATION_PAGE_SETUP = NEW_PRESENTATION_PAGE_SETUP;
window.normalizePresentationPageSetup = normalizePresentationPageSetup;
window.getPresentationPageSetupId = getPresentationPageSetupId;
window.getPresentationPageSetupConfig = getPresentationPageSetupConfig;
window.ensurePresentationPageSetup = ensurePresentationPageSetup;
window.scaleSlideElementsForPageSetup = scaleSlideElementsForPageSetup;
window.scalePresetElementsForPageSetup = scalePresetElementsForPageSetup;
window.canRebuildPresetSlideForPageSetup = canRebuildPresetSlideForPageSetup;
window.rebuildPresetSlideForPageSetup = rebuildPresetSlideForPageSetup;
window.syncPresentationPageSetup = syncPresentationPageSetup;
window.changePresentationPageSetup = changePresentationPageSetup;
window.applyPresentationPageSetup = applyPresentationPageSetup;
