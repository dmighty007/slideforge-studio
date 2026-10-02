function getMasterSlideOptions() {
    return MASTER_SLIDE_DEFINITIONS || {};
}

function inferMasterIdForLayout(layoutId) {
    const id = String(layoutId || "");
    if (id.includes("title") || id.includes("thank")) return "title";
    if (id.includes("section")) return "section";
    return "content";
}

function getMasterSlideConfig(masterId) {
    if (masterId === "none") return null;
    if (!state.masterSlides) state.masterSlides = normalizeMasterSlidesState();
    const resolvedId = MASTER_SLIDE_DEFINITIONS?.[masterId] ? masterId : "content";
    const config = state.masterSlides?.[resolvedId];
    return config?.enabled === false ? null : config;
}

function setCurrentSlideMaster(masterId) {
    const slide = state.slides?.[currentSlideIndex];
    if (!slide) return;
    const nextMasterId = masterId === "none" ? "none" : MASTER_SLIDE_DEFINITIONS?.[masterId] ? masterId : "content";
    saveStateToUndo?.();
    slide.masterId = nextMasterId;
    renderSlidesFromState?.();
    buildPropertiesPanel?.();
}

function updateMasterSlide(masterId, updates = {}) {
    if (!MASTER_SLIDE_DEFINITIONS?.[masterId] || masterId === "none") return;
    if (!state.masterSlides) state.masterSlides = normalizeMasterSlidesState();
    saveStateToUndo?.();
    const current = state.masterSlides[masterId] || createDefaultMasterSlidesState()[masterId];
    state.masterSlides[masterId] = {
        ...current,
        ...updates,
        id: masterId,
        footerText:
            typeof updates.footerText === "string" ? updates.footerText.slice(0, 180) : current.footerText,
        logoText: typeof updates.logoText === "string" ? updates.logoText.slice(0, 80) : current.logoText,
    };
    renderSlidesFromState?.();
    renderSlidePreviews?.(null, { preserveScroll: true });
}

function _masterThemeParts(theme) {
    const accent = theme?.accentStrong || theme?.cssVars?.["--slide-accent"] || "#2563EB";
    const accent2 = theme?.cssVars?.["--slide-accent-2"] || theme?.defaultShapeColor || accent;
    // Footer words in colours that read at 4.5:1 (the slide number in the accent was 2-3:1 on light themes).
    const isLight = typeof _presetMeta === "function" && theme ? _presetMeta(theme).isLightCanvas : true;
    const readable = color => (typeof _readableTextAccent === "function" ? _readableTextAccent(color, isLight) : color);
    return {
        accent,
        accent2,
        accentText: readable(accent),
        text: theme?.defaultTextColor || "#172033",
        muted: readable(theme?.defaultMutedColor || "#64748B"),
        headingFont: theme?.headingFont || '"Manrope", sans-serif',
        bodyFont: theme?.bodyFont || '"Manrope", sans-serif',
        surface: theme?.surfaceColor || "rgba(255,255,255,0.80)",
        border: theme?.surfaceBorder || "rgba(148,163,184,0.28)",
    };
}

function _masterEl(type, x, y, width, height, styles = {}, content = "", role = "") {
    return {
        id: `master_${type}_${Math.round(x)}_${Math.round(y)}_${Math.round(width)}_${Math.round(height)}`,
        type,
        x,
        y,
        width: `${width}px`,
        height: `${height}px`,
        content,
        isMasterElement: true,
        masterRole: role,
        styles: { zIndex: -20, ...styles },
    };
}

function _masterText(x, y, width, content, styles = {}, role = "") {
    return {
        ..._masterEl("text", x, y, width, 28, styles, content, role),
        autoHeight: true,
        textFitMode: "autoHeight",
    };
}

function _isEditableFooterMasterRole(role) {
    return ["footer-rule", "logo", "footer", "slide-number-bg", "slide-number"].includes(role);
}

const EDITABLE_FOOTER_NUMBER_ALIGNMENT_VERSION = 1;

function _scaleMasterElement(el, sx, sy) {
    const scalePx = (value, factor) => `${Math.max(1, Number.parseFloat(String(value || "0")) * factor)}px`;
    return {
        ...el,
        x: Math.round(el.x * sx),
        y: Math.round(el.y * sy),
        width: scalePx(el.width, sx),
        height: scalePx(el.height, sy),
        styles: {
            ...(el.styles || {}),
            fontSize: el.styles?.fontSize ? scalePx(el.styles.fontSize, Math.min(sx, sy)) : el.styles?.fontSize,
        },
    };
}

function _editableFooterElementZIndex(role, index = 0) {
    if (role === "footer-rule") return 1 + index;
    if (role === "slide-number-bg") return 2 + index;
    return 3 + index;
}

function _toEditableFooterElement(el, index = 0) {
    const role = el.masterRole || "footer";
    const fixedFooterText = ["logo", "footer", "slide-number"].includes(role);
    return {
        ...el,
        id: typeof generateId === "function" ? generateId("el") : `el_footer_${Date.now()}_${index}`,
        isMasterElement: undefined,
        masterRole: undefined,
        editableMasterFooterElement: true,
        footerRole: role,
        sourceMasterId: el.masterId || "",
        themeManaged: true,
        shapeType: el.type === "shape" ? "rectangle" : el.shapeType,
        autoHeight: el.type === "text" ? !fixedFooterText && el.autoHeight !== false : el.autoHeight,
        textFitMode: el.type === "text" ? (fixedFooterText ? "fixed" : el.textFitMode || "autoHeight") : el.textFitMode,
        styles: {
            ...(el.styles || {}),
            zIndex: _editableFooterElementZIndex(role, index),
        },
    };
}

function _alignEditableFooterSlideNumber(slide, slideIndex, theme = getPresentationTheme()) {
    if (!slide) return false;
    const footerElements = (slide.elements || []).filter(el => el?.editableMasterFooterElement);
    if (!footerElements.length) return false;

    const template = buildMasterSlideElements(slide, slideIndex, theme, { includeEditableFooter: true });
    const numberBgTemplate = template.find(el => el.masterRole === "slide-number-bg");
    const numberTemplate = template.find(el => el.masterRole === "slide-number");
    const numberBg = footerElements.find(el => el.footerRole === "slide-number-bg");
    const number = footerElements.find(el => el.footerRole === "slide-number");
    let changed = false;
    const alreadyAligned = slide.editableFooterNumberAlignmentVersion === EDITABLE_FOOTER_NUMBER_ALIGNMENT_VERSION;

    if (!alreadyAligned && numberBg && numberBgTemplate) {
        numberBg.x = numberBgTemplate.x;
        numberBg.y = numberBgTemplate.y;
        numberBg.width = numberBgTemplate.width;
        numberBg.height = numberBgTemplate.height;
        numberBg.styles = { ...(numberBg.styles || {}), ...(numberBgTemplate.styles || {}), zIndex: numberBg.styles?.zIndex ?? 2 };
        changed = true;
    }

    if (number && numberTemplate && number.content !== numberTemplate.content) {
        number.content = numberTemplate.content;
        changed = true;
    }

    if (!alreadyAligned && number && numberBgTemplate && numberTemplate) {
        number.x = numberBgTemplate.x;
        number.y = numberBgTemplate.y;
        number.width = numberBgTemplate.width;
        number.height = numberBgTemplate.height;
        number.autoHeight = false;
        number.textFitMode = "fixed";
        number.content = numberTemplate.content;
        number.styles = {
            ...(number.styles || {}),
            ...(numberTemplate.styles || {}),
            zIndex: number.styles?.zIndex ?? 3,
            textAlign: "center",
        };
        changed = true;
    }

    // Decks saved while "textTransform" was dropped from saved styles lost the brand's capitals; put them back.
    const logoTemplate = template.find(el => el.masterRole === "logo");
    const logo = footerElements.find(el => el.footerRole === "logo" && el.themeManaged !== false);
    if (logo && logoTemplate?.styles?.textTransform && !logo.styles?.textTransform) {
        logo.styles = { ...(logo.styles || {}), textTransform: logoTemplate.styles.textTransform };
        changed = true;
    }

    slide.editableFooterNumberAlignmentVersion = EDITABLE_FOOTER_NUMBER_ALIGNMENT_VERSION;
    return changed;
}

function ensureEditableMasterFooterElements(slide, slideIndex, theme = getPresentationTheme()) {
    if (!slide) return false;
    if (Array.isArray(slide.elements)) {
        const originalCount = slide.elements.length;
        slide.elements = slide.elements.filter(el => !el?.footerRole || el.editableMasterFooterElement);
        if (slide.elements.length !== originalCount) {
            slide.editableMasterFooter = false;
        }
    }
    if (slide.editableMasterFooter === true) {
        return _alignEditableFooterSlideNumber(slide, slideIndex, theme);
    }
    const masterId = resolveSlideMasterId(slide);
    const config = getMasterSlideConfig(masterId);
    if (!config) return false;

    slide.elements = Array.isArray(slide.elements) ? slide.elements : [];
    if (slide.elements.some(el => el?.editableMasterFooterElement)) {
        slide.editableMasterFooter = true;
        return _alignEditableFooterSlideNumber(slide, slideIndex, theme);
    }

    const footerElements = buildMasterSlideElements(slide, slideIndex, theme, { includeEditableFooter: true })
        .filter(el => _isEditableFooterMasterRole(el.masterRole))
        .map(_toEditableFooterElement);

    slide.editableMasterFooter = true;
    slide.editableFooterNumberAlignmentVersion = EDITABLE_FOOTER_NUMBER_ALIGNMENT_VERSION;
    if (!footerElements.length) return false;
    slide.elements.push(...footerElements);
    return true;
}

function buildMasterSlideElements(slide, slideIndex, theme = getPresentationTheme(), options = {}) {
    const masterId = resolveSlideMasterId(slide);
    const config = getMasterSlideConfig(masterId);
    if (!config) return [];

    const slideConfig = getPresentationPageSetupConfig?.() || { width: 1024, height: 768 };
    const sx = (Number(slideConfig.width) || 1024) / 1024;
    const sy = (Number(slideConfig.height) || 768) / 768;
    const { accent, accent2, accentText, text, muted, headingFont, bodyFont, surface, border } = _masterThemeParts(theme);
    const footerText = config.footerText || "";
    const logoText = config.logoText || "";
    const slideNumber = String((slideIndex || 0) + 1).padStart(2, "0");
    const elements = [];

    if (masterId === "title") {
        if (config.showTopRule) elements.push(_masterEl("shape", 0, 0, 1024, 8, { backgroundColor: accent, borderRadius: "0px" }));
        elements.push(_masterEl("shape", 882, 48, 88, 88, { backgroundColor: accent2, opacity: "0.18", borderRadius: "22px" }));
        elements.push(_masterEl("shape", 930, 96, 40, 40, { backgroundColor: accent, opacity: "0.82", borderRadius: "999px" }));
        elements.push(_masterEl("shape", 52, 714, 920, 1, { backgroundColor: border, borderRadius: "0px", opacity: "0.85" }, "", "footer-rule"));
        if (logoText) {
            elements.push(_masterText(64, 724, 360, logoText, {
                color: muted,
                fontFamily: bodyFont,
                fontSize: "12px",
                fontWeight: "700",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
            }, "logo"));
        }
    } else if (masterId === "section") {
        // Keeps the section divider slide canvas clean and lets preset layout determine the styling
    } else {
        if (config.showTopRule) elements.push(_masterEl("shape", 0, 0, 1024, 5, { backgroundColor: accent, borderRadius: "0px" }));
        elements.push(_masterEl("shape", 52, 714, 920, 1, { backgroundColor: border, borderRadius: "0px", opacity: "0.85" }, "", "footer-rule"));
    }

    if (config.showFooter) {
        if (logoText) {
            elements.push(_masterText(54, 724, 170, logoText, {
                color: text,
                fontFamily: bodyFont,
                fontSize: "12px",
                fontWeight: "800",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
            }, "logo"));
        }
        if (footerText) {
            elements.push(_masterText(244, 724, 500, footerText, {
                color: muted,
                fontFamily: bodyFont,
                fontSize: "12px",
                fontWeight: "600",
                textAlign: "center",
            }, "footer"));
        }
    }

    if (config.showSlideNumber) {
        elements.push(_masterEl("shape", 912, 718, 62, 28, {
            backgroundColor: surface,
            border: `1px solid ${border}`,
            borderRadius: "999px",
        }, "", "slide-number-bg"));
        elements.push(_masterText(912, 718, 62, slideNumber, {
            color: accentText,
            fontFamily: bodyFont,
            fontSize: "12px",
            fontWeight: "800",
            textAlign: "center",
        }, "slide-number"));
    }

    const scaled = elements.map(el => ({ ..._scaleMasterElement(el, sx, sy), masterId }));
    if (slide?.editableMasterFooter === true && options.includeEditableFooter !== true) {
        return scaled.filter(el => !_isEditableFooterMasterRole(el.masterRole));
    }
    return scaled;
}

window.getMasterSlideOptions = getMasterSlideOptions;
window.inferMasterIdForLayout = inferMasterIdForLayout;
window.getMasterSlideConfig = getMasterSlideConfig;
window.setCurrentSlideMaster = setCurrentSlideMaster;
window.updateMasterSlide = updateMasterSlide;
window.ensureEditableMasterFooterElements = ensureEditableMasterFooterElements;
window.buildMasterSlideElements = buildMasterSlideElements;
