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
    if (el.footerRole || el.locked) return false;
    return ["text", "image", "video", "chart", "table", "equation", "html", "pdf", "molecule", "whiteboard", "sketch"].includes(el.type);
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

function _mergeTableContentIntoPreset(targetTableData, sourceTableData) {
    if (!targetTableData || !sourceTableData) return targetTableData;
    const next = _clonePresetContentValue(targetTableData);
    const nextCells = Array.isArray(next.cells) ? next.cells : [];
    const sourceCells = Array.isArray(sourceTableData.cells) ? sourceTableData.cells : [];
    next.cells = nextCells.map((row, rowIndex) => {
        const sourceRow = Array.isArray(sourceCells[rowIndex]) ? sourceCells[rowIndex] : [];
        return (Array.isArray(row) ? row : []).map((cell, cellIndex) => {
            const sourceCell = sourceRow[cellIndex];
            if (!sourceCell || typeof sourceCell !== "object") return cell;
            return {
                ...cell,
                text: sourceCell.text ?? cell?.text ?? "",
            };
        });
    });
    return next;
}

function _applyContentFromElementToPresetElement(target, source) {
    if (!target || !source || target.type !== source.type) return target;
    const next = { ...target };
    if (target.type === "text") {
        next.content = _clonePresetContentValue(source.content);
        next.bulletStyle = source.bulletStyle || target.bulletStyle || "default";
        if (typeof createTextDocumentFromLegacyContent === "function") {
            next.textDocument = createTextDocumentFromLegacyContent(next.content || "", {
                bulletStyle: next.bulletStyle || "default",
            });
        } else if (source.textDocument) {
            next.textDocument = _clonePresetContentValue(source.textDocument);
        }
        return next;
    }
    if (target.type === "table") {
        next.tableData = _mergeTableContentIntoPreset(target.tableData, source.tableData);
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

function preserveSlideContentForPresetLayout(nextSlide, previousSlide) {
    if (!nextSlide || !previousSlide) return nextSlide;
    const sourcesByType = new Map();
    (previousSlide.elements || []).filter(_isReusablePresetContentElement).forEach(element => {
        if (!sourcesByType.has(element.type)) sourcesByType.set(element.type, []);
        sourcesByType.get(element.type).push(element);
    });
    let reused = 0;
    nextSlide.elements = (nextSlide.elements || []).map(element => {
        if (!_isPresetContentTargetElement(element)) return element;
        const queue = sourcesByType.get(element.type) || [];
        const source = queue.shift();
        if (!source) return element;
        reused += 1;
        return _applyContentFromElementToPresetElement(element, source);
    });
    nextSlide.contentPreservedFromLayoutId = previousSlide.layoutId || "";
    nextSlide.contentPreservedCount = reused;
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
    state.slides[activeIndex] = preserveSlideContentForPresetLayout(nextSlide, existing);
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
