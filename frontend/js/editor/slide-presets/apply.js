// Slide presets: building preset slide state, carrying content over, and inserting/applying presets.

/* ─── Insert Preset as New Slide ────────────────────────────────────────── */

function _normalizePresetTextColorsForTheme(elements, theme) {
    const { themeId, a, a2, aText, a2Text } = _t(theme);
    if (themeId !== "retroPop" || !Array.isArray(elements)) return elements;
    const accentMap = new Map([
        [String(a).toLowerCase(), aText],
        [String(a2).toLowerCase(), a2Text],
    ]);
    return elements.map(el => {
        if (!el || typeof el !== "object") return el;
        const next = { ...el };
        if (next.type === "text" && next.styles) {
            const styles = { ...next.styles };
            const replacement = accentMap.get(String(styles.color || "").toLowerCase());
            if (replacement) styles.color = replacement;
            next.styles = styles;
        }
        if (next.type === "table" && next.tableData) {
            const tableData = { ...next.tableData };
            ["textColor", "headerTextColor"].forEach(key => {
                const replacement = accentMap.get(String(tableData[key] || "").toLowerCase());
                if (replacement) tableData[key] = replacement;
            });
            next.tableData = tableData;
        }
        return next;
    });
}

function buildPresetSlideState(
    presetId,
    theme,
    { slideId = generateId("slide"), notes = "", background = "", masterId = "content" } = {},
) {
    const preset = SLIDE_PRESETS[presetId];
    if (!preset) return null;
    const resolvedTheme = theme || (typeof getPresentationTheme === "function" ? getPresentationTheme() : null);
    let elements = preset.build(resolvedTheme).map(el => ({
        ...el,
        id: generateId("el"),
        themeManaged: el.themeManaged ?? true,
    })).filter(el => !el.footerRole);
    elements = elements.map(el => {
        if (!el || el.type !== "text" || el.iconMode || el.textDocument || typeof createTextDocumentFromLegacyContent !== "function") {
            return el;
        }
        return {
            ...el,
            textDocument: createTextDocumentFromLegacyContent(el.content || "", { bulletStyle: el.bulletStyle || "default" }),
        };
    });
    if (
        (typeof scalePresetElementsForPageSetup === "function" || typeof scaleSlideElementsForPageSetup === "function") &&
        typeof getPresentationPageSetupConfig === "function" &&
        typeof PRESENTATION_PAGE_SETUPS !== "undefined"
    ) {
        const baseConfig = PRESENTATION_PAGE_SETUPS["standard-4-3"] || { width: 1024, height: 768 };
        const targetConfig = getPresentationPageSetupConfig();
        if (targetConfig && (targetConfig.width !== baseConfig.width || targetConfig.height !== baseConfig.height)) {
            const scaler =
                typeof scalePresetElementsForPageSetup === "function"
                    ? scalePresetElementsForPageSetup
                    : scaleSlideElementsForPageSetup;
            elements = scaler({ elements }, baseConfig, targetConfig, {
                preserveTextSize: true,
                scaleTextUp: true,
            }).elements;
        }
    }
    elements = _normalizePresetTextColorsForTheme(elements, resolvedTheme);
    return {
        id: slideId,
        layoutId: presetId,
        masterId:
            masterId || "content",
        background: normalizeSlideBackground(background),
        notes,
        elements,
    };
}

function _isReusablePresetContentElement(el) {
    if (!el || typeof el !== "object") return false;
    if (typeof isPresetBackgroundElement === "function" && isPresetBackgroundElement(el)) return false;
    if (el.footerRole || el.locked || el.isMasterElement || el.editableMasterFooterElement || el.importedBackground) return false;
    return ["text", "image", "video", "chart", "table", "equation", "html", "pdf", "molecule", "whiteboard", "sketch", "plugin"].includes(el.type);
}

function _plainPresetTextContent(content) {
    if (Array.isArray(content)) {
        return content
            .map(item => String(item?.text || item?.html || "").replace(/<[^>]*>/g, " "))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }
    return String(content || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function _isPresetTextContentSlot(el) {
    if (!el || el.type !== "text" || el.iconMode) return false;
    const plain = _plainPresetTextContent(el.content);
    const width = parseFloat(String(el.width || "").replace("px", "")) || 0;
    if (!plain) return width >= 220;
    if (/^\d{1,3}$/.test(plain)) return false;
    if (plain.length <= 20 && plain === plain.toUpperCase() && /[A-Z]/.test(plain)) return false;
    return width >= 180 || plain.length >= 24 || Array.isArray(el.content);
}

function _isPresetContentTargetElement(el) {
    if (!_isReusablePresetContentElement(el)) return false;
    if (el.type === "text") return _isPresetTextContentSlot(el);
    return true;
}

function _clonePresetContentValue(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "object") {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }
    return value;
}

function _applyContentFromElementToPresetElement(target, source) {
    if (!target || !source || target.type !== source.type) return target;
    const next = { ...target };
    if (target.type === "text") {
        next.content = _clonePresetContentValue(source.content);
        next.bulletStyle = source.bulletStyle || target.bulletStyle || "default";
        // The text as it is, lists and formatting included (rebuilt from its legacy content, a list came out as
        // "[object Object]").
        if (source.textDocument) {
            next.textDocument = _clonePresetContentValue(source.textDocument);
        } else if (typeof createTextDocumentFromLegacyContent === "function") {
            next.textDocument = createTextDocumentFromLegacyContent(next.content || "", {
                bulletStyle: next.bulletStyle || "default",
            });
        } else if (source.textDocument) {
            next.textDocument = _clonePresetContentValue(source.textDocument);
        }
        return next;
    }
    if (target.type === "table") {
        // The user's whole table, every row and column: cells copied into the preset's fixed grid lost the rest
        // (a 7 x 6 table became 5 x 4) and kept the preset's sample rows ("Risk", "Fit").
        next.tableData = _clonePresetContentValue(source.tableData);
        if (parseFloat(source.height)) next.height = source.height;
        return next;
    }
    if (target.type === "chart") {
        ["chartType", "chartData", "chartStyle", "chartOptions"].forEach(key => {
            if (source[key] !== undefined) next[key] = _clonePresetContentValue(source[key]);
        });
        return next;
    }
    if (target.type === "plugin") {
        ["pluginId", "pluginData", "pluginPreview", "pluginPreviewKey"].forEach(key => {
            if (source[key] !== undefined) next[key] = _clonePresetContentValue(source[key]);
        });
        return next;
    }

    [
        "content",
        "alt",
        "caption",
        "src",
        "url",
        "latexSrc",
        "chartData",
        "moleculeData",
        "whiteboardData",
        "sketchData",
        "pdfAnnotations",
    ].forEach(key => {
        if (source[key] !== undefined) next[key] = _clonePresetContentValue(source[key]);
    });
    return next;
}

// A text box with no words (an empty "Click to add title" placeholder) has nothing to carry over: carried over, it
// replaced the preset's own title and text with nothing, and its empty bullet list showed as a lone "•".
function _presetSourceHasContent(el) {
    if (el?.type !== "text") return true;
    const plain = el.textDocument && typeof textDocumentToPlainText === "function"
        ? textDocumentToPlainText(el.textDocument)
        : _plainPresetTextContent(el.content);
    return Boolean(String(plain || "").trim());
}

// What identifies an object a preset puts on a slide (its sample text, data or shape and place), to tell the
// layout's own samples, left as they were, from the user's content.
function _presetElementSignature(el) {
    const n = value => Math.round(parseFloat(value) || 0);
    const geometry = `${n(el.x)},${n(el.y)},${n(el.width)},${n(el.height)}`;
    if (el.type === "text") {
        if (el.iconMode) return `icon|${el.iconClass || ""}|${geometry}`;
        const plain = el.textDocument && typeof textDocumentToPlainText === "function"
            ? textDocumentToPlainText(el.textDocument)
            : _plainPresetTextContent(el.content);
        return `text|${String(plain || "").replace(/\s+/g, " ").trim()}`;
    }
    if (el.type === "table") return `table|${JSON.stringify((el.tableData?.cells || []).map(row => (row || []).map(cell => cell?.text ?? "")))}`;
    if (el.type === "chart") return `chart|${JSON.stringify(el.chartData || null)}`;
    if (el.type === "shape" || el.type === "connector") return `${el.type}|${el.shapeType || ""}|${geometry}`;
    return `${el.type}|${geometry}|${String(typeof el.content === "string" ? el.content : JSON.stringify(el.content || "")).slice(0, 200)}`;
}

function _presetSampleSignatures(layoutId, theme) {
    if (!layoutId || !SLIDE_PRESETS?.[layoutId]) return new Set();
    try {
        const built = buildPresetSlideState(layoutId, theme, {});
        return new Set((built?.elements || []).map(_presetElementSignature));
    } catch (_error) {
        return new Set();
    }
}

// The user's content on a slide: not the master's footer or the background, not an empty placeholder, and not a
// sample the slide's preset put there and nobody changed. Locked objects, shapes, connectors and icons count:
// applying a layout dropped them all.
function _userContentOnSlide(slide, theme) {
    const samples = _presetSampleSignatures(slide?.layoutId, theme);
    return (slide?.elements || []).filter(el => {
        if (!el || el.isMasterElement || el.editableMasterFooterElement || el.footerRole || el.importedBackground) return false;
        if (typeof isPresetBackgroundElement === "function" && isPresetBackgroundElement(el)) return false;
        if (el.type === "text" && !el.iconMode && !_presetSourceHasContent(el)) return false;
        return !samples.has(_presetElementSignature(el));
    });
}

function _presetBox(el) {
    const node = typeof document !== "undefined"
        ? [...document.querySelectorAll(`[id="${el.id}"]`)].find(n => !n.closest("#slide-previews"))
        : null;
    const w = parseFloat(el.width) || node?.offsetWidth || 0;
    const h = parseFloat(el.height) || node?.offsetHeight || (el.type === "text" ? 60 : 0);
    return { x: parseFloat(el.x) || 0, y: parseFloat(el.y) || 0, w, h };
}

// Kept objects that had no slot in the new layout: where they were if that is clear of the layout's own content,
// else in the largest free part of the slide (smaller if need be, down to half size), else on a new slide after
// this one. Kept in front of the new layout, they covered its title (a table hid "Measured results").
function _placeKeptPresetObjects(nextSlide, kept) {
    const { slideW, slideH, margin } = _getSlideInsertBounds();
    const floor = slideH - margin;
    const area = { x: margin, y: margin, w: slideW - margin * 2, h: floor - margin };
    const gap = 12;
    const layoutBoxes = (nextSlide.elements || [])
        .filter(el => !(typeof isPresetBackgroundElement === "function" && isPresetBackgroundElement(el)) && !el.footerRole && !el.editableMasterFooterElement)
        .map(_presetBox)
        .filter(b => b.w > 0 && b.h > 0 && b.w * b.h < slideW * slideH * 0.6)
        .map(b => ({ x: b.x - gap, y: b.y - gap, w: b.w + gap * 2, h: b.h + gap * 2 }));
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    // Grouped objects move together.
    const units = [];
    kept.forEach(el => {
        const unit = el.groupId ? units.find(u => u.groupId === el.groupId) : null;
        if (unit) unit.elements.push(el);
        else units.push({ groupId: el.groupId || null, elements: [el] });
    });
    const unitBox = unit => {
        const boxes = unit.elements.map(_presetBox);
        const x = Math.min(...boxes.map(b => b.x));
        const y = Math.min(...boxes.map(b => b.y));
        return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
    };
    units.sort((a, b) => unitBox(b).w * unitBox(b).h - unitBox(a).w * unitBox(a).h);
    const taken = [...layoutBoxes];
    const overflow = [];
    units.forEach(unit => {
        const box = unitBox(unit);
        if (!taken.some(t => overlaps(box, t))) {
            taken.push(box);
            return;
        }
        let best = null;
        (typeof _freeRectangles === "function" ? _freeRectangles(area, taken) : []).forEach(r => {
            const scale = Math.min(1, r.w / Math.max(1, box.w), r.h / Math.max(1, box.h));
            if (scale < 0.5) return;
            if (!best || scale > best.scale || (scale === best.scale && r.w * r.h > best.r.w * best.r.h)) best = { r, scale };
        });
        if (!best) {
            overflow.push(unit);
            return;
        }
        const { r, scale } = best;
        const dx = r.x + (r.w - box.w * scale) / 2;
        const dy = r.y + (r.h - box.h * scale) / 2;
        unit.elements.forEach(el => {
            const b = _presetBox(el);
            el.x = Math.round(dx + (b.x - box.x) * scale);
            el.y = Math.round(dy + (b.y - box.y) * scale);
            if (scale < 1) {
                if (parseFloat(el.width)) el.width = `${Math.round(b.w * scale)}px`;
                if (parseFloat(el.height)) el.height = `${Math.round(b.h * scale)}px`;
            }
        });
        taken.push({ x: dx, y: dy, w: box.w * scale, h: box.h * scale });
    });
    return overflow.flatMap(unit => unit.elements);
}

function preserveSlideContentForPresetLayout(nextSlide, previousSlide, { theme = null } = {}) {
    if (!nextSlide || !previousSlide) return nextSlide;
    const resolvedTheme = theme || (typeof getPresentationTheme === "function" ? getPresentationTheme() : null);
    const content = _userContentOnSlide(previousSlide, resolvedTheme);
    const sourcesByType = new Map();
    content.filter(el => _isReusablePresetContentElement(el) && !(el.type === "text" && el.iconMode)).forEach(element => {
        if (!sourcesByType.has(element.type)) sourcesByType.set(element.type, []);
        sourcesByType.get(element.type).push(element);
    });
    const used = new Set();
    let reused = 0;
    nextSlide.elements = (nextSlide.elements || []).map(element => {
        if (!_isPresetContentTargetElement(element)) return element;
        const queue = sourcesByType.get(element.type) || [];
        // A plugin's settings only go into the same plugin.
        const index = queue.findIndex(source => element.type !== "plugin" || source.pluginId === element.pluginId);
        if (index < 0) return element;
        const [source] = queue.splice(index, 1);
        used.add(source);
        reused += 1;
        return _applyContentFromElementToPresetElement(element, source);
    });
    // Everything else the user made stays: placed clear of the new layout, or on a new slide after this one.
    const kept = content.filter(el => !used.has(el)).map(el => _clonePresetContentValue(el));
    const top = Math.max(0, ...nextSlide.elements.map(el => parseInt(el.styles?.zIndex, 10) || 0));
    kept.forEach((element, i) => {
        element.styles = { ...(element.styles || {}), zIndex: top + 1 + i };
    });
    const overflow = kept.length ? _placeKeptPresetObjects(nextSlide, kept) : [];
    nextSlide.elements.push(...kept.filter(el => !overflow.includes(el)));
    nextSlide.contentPreservedFromLayoutId = previousSlide.layoutId || "";
    nextSlide.contentPreservedCount = reused;
    nextSlide._overflowElements = overflow; // taken off by applyPresetLayoutToCurrentSlide
    return nextSlide;
}

function applyPresetLayoutToCurrentSlide(presetId) {
    const preset = SLIDE_PRESETS[presetId];
    if (!preset) {
        console.warn("Unknown preset:", presetId);
        return;
    }
    const activeIndex = typeof ensureActiveSlideSync === "function" ? ensureActiveSlideSync() : currentSlideIndex;
    const existing = state.slides[activeIndex];
    if (!existing) return;
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : null;
    saveStateToUndo();
    const nextSlide = buildPresetSlideState(presetId, theme, {
        slideId: existing.id,
        notes: existing.notes || "",
        background: existing.background || "",
        masterId: existing.masterId && existing.masterId !== "none" ? existing.masterId : "content",
    });
    const converted = preserveSlideContentForPresetLayout(nextSlide, existing, { theme });
    const overflow = converted._overflowElements || [];
    delete converted._overflowElements;
    state.slides[activeIndex] = converted;
    // What did not fit the new layout goes on a slide of its own right after it, where it was (one undo puts it all back).
    if (overflow.length) {
        state.slides.splice(activeIndex + 1, 0, {
            id: generateId("slide"),
            layoutId: "blank-titled",
            masterId: existing.masterId && existing.masterId !== "none" ? existing.masterId : "content",
            background: existing.background || "",
            notes: "",
            elements: overflow,
        });
        window.showCanvasNotice?.(`${overflow.length === 1 ? "One object" : `${overflow.length} objects`} did not fit this layout and moved to a new slide after this one. Undo puts them back.`);
    }
    clearSelection?.();
    renderSlidesFromState?.();
    buildPropertiesPanel?.();
    rememberPresetUsage(presetId);
    renderPresetSlidePalette?.();
}

function insertPresetSlide(presetId) {
    const preset = SLIDE_PRESETS[presetId];
    if (!preset) {
        console.warn("Unknown preset:", presetId);
        return;
    }

    const theme =
        typeof getPresentationTheme === "function"
            ? getPresentationTheme()
            : {
                  defaultTextColor: "#f5f5f5",
                  defaultMutedColor: "#a0a0a0",
                  accentStrong: "#7c83ef",
                  headingFont: '"Montserrat", sans-serif',
                  bodyFont: '"Inter", sans-serif',
                  surfaceColor: "rgba(255,255,255,0.06)",
                  surfaceBorder: "rgba(255,255,255,0.12)",
                  cssVars: { "--slide-accent-2": "#3949ab" },
              };

    saveStateToUndo();

    const newSlide = buildPresetSlideState(presetId, theme, { background: "", notes: "" });
    const insertAt = typeof currentSlideIndex !== "undefined" ? currentSlideIndex + 1 : state.slides.length;
    state.slides.splice(insertAt, 0, newSlide);

    if (typeof setCurrentSlideIndex === "function") setCurrentSlideIndex(insertAt);
    if (typeof renderSlidesFromState === "function") renderSlidesFromState();
    rememberPresetUsage(presetId);
    renderPresetSlidePalette?.();
}

window.insertPresetSlide = insertPresetSlide;

window.applyPresetLayoutToCurrentSlide = applyPresetLayoutToCurrentSlide;

window.buildPresetSlideState = buildPresetSlideState;

window.preserveSlideContentForPresetLayout = preserveSlideContentForPresetLayout;
