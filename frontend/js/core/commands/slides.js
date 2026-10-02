// Commands: active slide tracking and adding, deleting and duplicating slides.

function getActiveSlideIndex() {
    if (typeof Reveal !== "undefined" && typeof Reveal.isReady === "function" && Reveal.isReady()) {
        const indices = Reveal.getIndices?.();
        const h = indices?.h;
        if (Number.isInteger(h)) {
            return Math.max(0, Math.min(h, state.slides.length - 1));
        }
    }
    return Math.max(0, Math.min(currentSlideIndex, state.slides.length - 1));
}

function ensureActiveSlideSync() {
    const idx = getActiveSlideIndex();
    if (idx !== currentSlideIndex) setCurrentSlideIndex(idx);
    if (!state.slides[idx])
        state.slides[idx] = {
            id: generateId("slide"),
            layoutId: "blank-titled",
            masterId: "content",
            notes: "",
            elements: [],
        };
    return idx;
}

function _normalizeSlideIndex(index) {
    if (!Number.isInteger(index)) return null;
    return Math.max(0, Math.min(index, state.slides.length - 1));
}

// ─── Slide Commands ──────────────────────────────────────────────────────────

// "Title and content" layout for new slides, styled by the current theme.
// The title and body fonts of a slide with no master (an imported one): its largest text is the title, the
// rest is body. A new slide after it uses them, so it matches the imported slides rather than the theme.
function _slideOwnFonts(slide) {
    if (!slide || (slide.masterId && slide.masterId !== "none")) return null;
    const texts = (slide.elements || []).filter((el) => el.type === "text" && !el.footerRole && el.styles?.fontFamily);
    if (!texts.length) return null;
    const size = (el) => parseFloat(el.styles?.fontSize) || 0;
    const title = texts.reduce((best, el) => (size(el) > size(best) ? el : best), texts[0]);
    const body = texts.find((el) => el !== title) || title;
    return { heading: title.styles.fontFamily, body: body.styles.fontFamily, color: body.styles.color || title.styles.color };
}

function _titleAndContentPlaceholders(referenceSlide = null) {
    const theme = typeof getPresentationTheme === "function" ? getPresentationTheme() : {};
    const page = typeof getPresentationPageSetupConfig === "function" ? getPresentationPageSetupConfig() : {};
    const width = (Number(page.width) || 1024) - 128;
    const own = _slideOwnFonts(referenceSlide);
    return [
        buildPlaceholderText({
            x: 64, y: 52, width, fitHeight: 96, fontSize: 40, fontWeight: "700", zIndex: 1, placeholder: "Click to add title",
            fontFamily: own?.heading || theme.headingFont || '"Manrope", sans-serif', color: own?.color || theme.defaultTextColor || "#172033",
        }),
        buildPlaceholderText({
            x: 64, y: 168, width, fontSize: 24, zIndex: 2, placeholder: "Click to add text", role: "content",
            fontFamily: own?.body || theme.bodyFont || '"Manrope", sans-serif', color: own?.color || theme.defaultTextColor || "#172033",
        }),
    ];
}

function addSlide(targetIndex = null) {
    const activeIndex = _normalizeSlideIndex(targetIndex) ?? ensureActiveSlideSync();
    saveStateToUndo();
    const reference = state.slides[activeIndex];
    state.slides.splice(activeIndex + 1, 0, {
        id: generateId("slide"),
        layoutId: "blank-titled",
        // The master of the slide it follows: in an imported deck (no master) a new slide got the SlideForge footer.
        masterId: reference?.masterId || "content",
        notes: "",
        presentationTransition: "none",
        elements: _titleAndContentPlaceholders(reference),
    });
    setCurrentSlideIndex(activeIndex + 1);
    renderSlidesFromState();
    Reveal.slide(activeIndex + 1);
    updateSlideCounter();
}

function deleteCurrentSlide(targetIndex = null) {
    const activeIndex = _normalizeSlideIndex(targetIndex) ?? ensureActiveSlideSync();
    if (state.slides.length <= 1) return;
    
    // CRITICAL FIX: Cleanup 3D backgrounds before deleting slide
    if (typeof cleanupSlideBackground3D === 'function') {
        const slideElement = document.querySelector(
            `.presentation-slide[data-slide-index="${activeIndex}"]`
        );
        if (slideElement) cleanupSlideBackground3D(slideElement);
    }
    
    saveStateToUndo();
    state.slides.splice(activeIndex, 1);
    const nextIndex = Math.max(0, activeIndex - 1);
    setCurrentSlideIndex(nextIndex);
    renderSlidesFromState();
    Reveal.slide(nextIndex);
    updateSlideCounter();
}

function duplicateCurrentSlide(targetIndex = null) {
    const activeIndex = _normalizeSlideIndex(targetIndex) ?? ensureActiveSlideSync();
    const sourceSlide = state.slides[activeIndex];
    if (!sourceSlide) return;

    saveStateToUndo();
    const slideCopy = JSON.parse(JSON.stringify(sourceSlide));
    const groupIdMap = {};
    slideCopy.id = generateId("slide");
    const idMap = {};
    slideCopy.elements = (slideCopy.elements || []).map(el => {
        const copy = { ...el, id: generateId("el") };
        idMap[el.id] = copy.id;
        if (copy.groupId) {
            if (!groupIdMap[copy.groupId]) {
                groupIdMap[copy.groupId] = generateId("grp");
            }
            copy.groupId = groupIdMap[copy.groupId];
        }
        return copy;
    });

    if (typeof remapConnectorBindings === "function") remapConnectorBindings(slideCopy.elements, idMap);
    state.slides.splice(activeIndex + 1, 0, slideCopy);
    
    // CRITICAL FIX: Cleanup old slide's 3D background if needed
    if (typeof cleanupSlideBackground3D === 'function') {
        const sourceSlideElement = document.querySelector(
            `.presentation-slide[data-slide-index="${activeIndex}"]`
        );
        if (sourceSlideElement) cleanupSlideBackground3D(sourceSlideElement);
    }
    
    setCurrentSlideIndex(activeIndex + 1);
    clearSelection();
    renderSlidesFromState();
    Reveal.slide(activeIndex + 1);
    updateSlideCounter();
}

function updateSlideCounter() {
    const el = document.getElementById("slide-counter");
    if (el) el.innerText = `Slide ${currentSlideIndex + 1} / ${state.slides.length}`;
}
