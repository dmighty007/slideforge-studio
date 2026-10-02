// Commands: setting and clearing the current slide background.

async function _resolveSlideBackgroundAsset(file) {
    try {
        const upload = await _uploadAssetFile(file);
        return { url: upload.url, mimeType: file.type || "" };
    } catch (err) {
        if (!_isSessionOnlyAssetFallbackError(err)) throw err;
        return { url: _createSessionObjectUrl(file), mimeType: file.type || "" };
    }
}

function setCurrentSlideBackground(background) {
    const activeIndex = ensureActiveSlideSync();
    const slide = state.slides[activeIndex];
    if (!slide) return;
    slide.background = background ? normalizeSlideBackground(background) : null;
    renderSlidesFromState?.();
    buildPropertiesPanel?.();
    schedulePresentationAutosave?.(150);
}

function setCurrentSlideBackgroundFit(fit) {
    const activeIndex = ensureActiveSlideSync();
    const slide = state.slides[activeIndex];
    if (!slide?.background) return;
    const current = normalizeSlideBackground(slide.background);
    if (!current || current.type === "three") return;
    const nextFit = ["cover", "contain", "fill"].includes(fit) ? fit : "cover";
    saveStateToUndo();
    slide.background = {
        ...current,
        fit: nextFit,
    };
    renderSlidesFromState?.();
    buildPropertiesPanel?.();
    schedulePresentationAutosave?.(150);
}

function setCurrentSlideBackgroundAdjustments(updates = {}) {
    const activeIndex = ensureActiveSlideSync();
    const slide = state.slides[activeIndex];
    const current = normalizeSlideBackground(slide?.background);
    if (!slide || !current) return;
    saveStateToUndo();
    slide.background = normalizeSlideBackground({
        ...current,
        ...updates,
    });
    renderSlidesFromState?.();
    buildPropertiesPanel?.();
    schedulePresentationAutosave?.(150);
}

function setCurrentSlideBackgroundThree(style = "orbital") {
    const activeIndex = ensureActiveSlideSync();
    const current = normalizeSlideBackground(state.slides?.[activeIndex]?.background);
    saveStateToUndo();
    setCurrentSlideBackground({
        type: "three",
        content: "theme-motion",
        style,
        opacity: current?.opacity ?? 0.92,
        blur: current?.blur ?? 0,
        brightness: current?.brightness ?? 100,
        saturate: current?.saturate ?? 100,
    });
}

async function setCurrentSlideBackgroundFromFile(file) {
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
        setProjectSaveHint?.("Choose an image, GIF, or video background", "danger");
        return;
    }
    const resolved = await _resolveSlideBackgroundAsset(file);
    saveStateToUndo();
    setCurrentSlideBackground({
        type: isVideo ? "video" : "image",
        content: resolved.url,
        mimeType: resolved.mimeType,
        fit: "cover",
    });
}

function pickCurrentSlideBackgroundFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/mp4,video/webm,video/ogg";
    input.onchange = async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            await setCurrentSlideBackgroundFromFile(file);
        } catch (err) {
            console.error("Slide background upload failed:", err);
            setProjectSaveHint?.(err?.message || "Failed to set slide background", "danger");
        }
    };
    input.click();
}

function setCurrentSlideBackgroundFromUrl(url) {
    const value = String(url || "").trim();
    if (!value) return;
    const isVideo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(value) || /^data:video\//i.test(value);
    saveStateToUndo();
    setCurrentSlideBackground({
        type: isVideo ? "video" : "image",
        content: value,
        mimeType: "",
        fit: normalizeSlideBackground(state.slides?.[ensureActiveSlideSync()]?.background)?.fit || "cover",
        opacity: normalizeSlideBackground(state.slides?.[ensureActiveSlideSync()]?.background)?.opacity ?? 1,
        blur: normalizeSlideBackground(state.slides?.[ensureActiveSlideSync()]?.background)?.blur ?? 0,
        brightness: normalizeSlideBackground(state.slides?.[ensureActiveSlideSync()]?.background)?.brightness ?? 100,
        saturate: normalizeSlideBackground(state.slides?.[ensureActiveSlideSync()]?.background)?.saturate ?? 100,
    });
}

function clearCurrentSlideBackground() {
    saveStateToUndo();
    setCurrentSlideBackground(null);
}
