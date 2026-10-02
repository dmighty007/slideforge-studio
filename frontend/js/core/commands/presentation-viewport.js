// Presentation mode: fullscreen and viewport layout.

// ─── Play Mode ───────────────────────────────────────────────────────────────

async function _syncBrowserFullscreen(shouldEnter) {
    const target = _getPresentationFullscreenTarget();
    const isFullscreen = !!document.fullscreenElement;

    if (shouldEnter && !isFullscreen && target?.requestFullscreen) {
        try {
            await target.requestFullscreen();
            return true;
        } catch (err) {
            console.warn("Entering fullscreen failed:", err);
        }
    } else if (!shouldEnter && isFullscreen && document.exitFullscreen) {
        try {
            await document.exitFullscreen();
            return true;
        } catch (err) {
            console.warn("Exiting fullscreen failed:", err);
        }
    }
    return false;
}

function _getPresentationFullscreenTarget() {
    return document.getElementById("canvas-wrapper") || document.documentElement;
}

function _clearPresentationViewportLayout() {
    document.documentElement.style.removeProperty("--presentation-scale");
    document.documentElement.style.removeProperty("--presentation-offset-x");
    document.documentElement.style.removeProperty("--presentation-offset-y");
    document.documentElement.style.removeProperty("--presentation-viewport-width");
    document.documentElement.style.removeProperty("--presentation-viewport-height");
    document.documentElement.style.removeProperty("--presentation-stage-bg");
    const reveal = document.querySelector(".reveal");
    if (reveal) {
        reveal.style.removeProperty("transform");
        reveal.style.removeProperty("scale");
        reveal.style.removeProperty("zoom");
    }
    const { wrapper } = _presentationToolsElements();
    if (wrapper) {
        wrapper.style.removeProperty("width");
        wrapper.style.removeProperty("height");
        wrapper.style.removeProperty("min-height");
    }
}

function _resetRevealPresentationTransform() {
    const reveal = document.querySelector(".reveal");
    if (!reveal) return;
    reveal.style.setProperty("position", "absolute", "important");
    reveal.style.setProperty("inset", "0", "important");
    reveal.style.setProperty("left", "0", "important");
    reveal.style.setProperty("top", "0", "important");
    reveal.style.setProperty("width", "100%", "important");
    reveal.style.setProperty("height", "100%", "important");
    reveal.style.setProperty("margin", "0", "important");
    reveal.style.setProperty("padding", "0", "important");
    reveal.style.setProperty("transform", "none", "important");
    reveal.style.setProperty("scale", "1", "important");
    reveal.style.setProperty("zoom", "1", "important");
}

function _getPresentationViewportSize() {
    const viewport = window.visualViewport;
    const browserWidth = Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1);
    const browserHeight = Math.round(
        viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1,
    );
    const fullscreenRect = document.fullscreenElement?.getBoundingClientRect?.();
    const fullscreenWidth = Math.round(fullscreenRect?.width || document.fullscreenElement?.clientWidth || 0);
    const fullscreenHeight = Math.round(fullscreenRect?.height || document.fullscreenElement?.clientHeight || 0);
    const screenWidth = document.fullscreenElement ? Math.round(window.screen?.width || 0) : 0;
    const screenHeight = document.fullscreenElement ? Math.round(window.screen?.height || 0) : 0;
    if (document.fullscreenElement) {
        return {
            width: Math.max(1, fullscreenWidth, browserWidth, screenWidth),
            height: Math.max(1, fullscreenHeight, browserHeight, screenHeight),
        };
    }
    return {
        width: Math.max(1, browserWidth),
        height: Math.max(1, browserHeight),
    };
}

function _syncPresentationViewportLayout() {
    if (!document.body.classList.contains("play-mode-active")) return;
    const { wrapper } = _presentationToolsElements();
    const { width, height } = _getPresentationViewportSize();
    const slideConfig =
        typeof getPresentationPageSetupConfig === "function"
            ? getPresentationPageSetupConfig()
            : { width: 1024, height: 768 };
    const slideWidth = Number(slideConfig.width) || 1024;
    const slideHeight = Number(slideConfig.height) || 768;
    const activeSlide =
        document.querySelector(".presentation-slide.present") ||
        document.querySelector(`.presentation-slide[data-slide-index="${currentSlideIndex}"]`) ||
        document.querySelector(".presentation-slide");
    const slideBg = activeSlide ? window.getComputedStyle(activeSlide).backgroundColor : "";
    const fallbackBg =
        getComputedStyle(document.documentElement).getPropertyValue("--slide-bg").trim() ||
        getPresentationTheme?.()?.cssVars?.["--slide-bg"] ||
        "#000";
    const stageBg = slideBg && slideBg !== "rgba(0, 0, 0, 0)" && slideBg !== "transparent" ? slideBg : fallbackBg;
    document.documentElement.style.setProperty("--slide-width", `${slideWidth}px`);
    document.documentElement.style.setProperty("--slide-height", `${slideHeight}px`);
    document.documentElement.style.setProperty("--presentation-viewport-width", `${width}px`);
    document.documentElement.style.setProperty("--presentation-viewport-height", `${height}px`);
    document.documentElement.style.setProperty("--presentation-stage-bg", stageBg);
    if (wrapper) {
        wrapper.style.setProperty("width", `${width}px`, "important");
        wrapper.style.setProperty("height", `${height}px`, "important");
        wrapper.style.setProperty("min-height", `${height}px`, "important");
        wrapper.scrollLeft = 0;
        wrapper.scrollTop = 0;
    }
    if (typeof Reveal !== "undefined") {
        Reveal.sync?.();
        _resetRevealPresentationTransform();
    }
    _resizePresentationChalkboard();
}
