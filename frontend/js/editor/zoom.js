// js/zoom.js

let stateZoom = 1;
let isSpaceDown = false;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let startScrollX = 0;
let startScrollY = 0;
let zoomMode = "fit";

const EDITOR_ZOOM_MIN = 0.1;
const EDITOR_ZOOM_MAX = 5;
const EDITOR_ZOOM_PADDING = 18;

function isPresentationPlaying() {
    return document.body.classList.contains("play-mode-active");
}

function clampZoom(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(Math.max(parsed, EDITOR_ZOOM_MIN), EDITOR_ZOOM_MAX);
}

function getSlideSize() {
    const slideConfig = getPresentationPageSetupConfig();
    return {
        width: Number(slideConfig.width) || 1024,
        height: Number(slideConfig.height) || 768,
    };
}

function setImportantStyle(el, prop, value) {
    el.style.setProperty(prop, value, "important");
}

function initZoom() {
    const wrapper = document.getElementById("canvas-wrapper");
    if (!wrapper || wrapper.dataset.zoomInitialized === "true") return;
    wrapper.dataset.zoomInitialized = "true";
    initZoomControlDisclosure();

    // --- Zoom Events ---
    wrapper.addEventListener("wheel", (e) => {
        if (isPresentationPlaying()) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            changeZoom(delta, { anchorEvent: e });
        }
    }, { passive: false });

    // --- Panning Events ---
    window.addEventListener("keydown", (e) => {
        if (isPresentationPlaying()) return;
        if (e.code === "Space" && !isSpaceDown) {
            const isEditing = document.activeElement.tagName === "INPUT" || 
                              document.activeElement.tagName === "TEXTAREA" || 
                              document.activeElement.isContentEditable;
            if (isEditing) return;

            isSpaceDown = true;
            wrapper.style.cursor = "grab";
            // Prevent scrolling with space
            if (e.target === document.body) e.preventDefault();
        }
    });

    window.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
            isSpaceDown = false;
            isPanning = false;
            if (wrapper) wrapper.style.cursor = "";
        }
    });

    wrapper.addEventListener("mousedown", (e) => {
        if (isSpaceDown && !isPresentationPlaying()) {
            isPanning = true;
            startPanX = e.clientX;
            startPanY = e.clientY;
            startScrollX = wrapper.scrollLeft;
            startScrollY = wrapper.scrollTop;
            wrapper.style.cursor = "grabbing";
            e.preventDefault();
        }
    });

    window.addEventListener("mousemove", (e) => {
        if (isPanning) {
            const dx = e.clientX - startPanX;
            const dy = e.clientY - startPanY;
            wrapper.scrollLeft = startScrollX - dx;
            wrapper.scrollTop = startScrollY - dy;
        }
    });

    window.addEventListener("mouseup", () => {
        if (isPanning) {
            isPanning = false;
            wrapper.style.cursor = isSpaceDown ? "grab" : "";
        }
    });
}

function getZoomAnchor(wrapper, event = null) {
    if (!wrapper) return null;
    const engine = document.getElementById("zoom-engine");
    const padX = parseFloat(engine?.dataset.zoomPadX) || 0;
    const padY = parseFloat(engine?.dataset.zoomPadY) || 0;
    const rect = wrapper.getBoundingClientRect();
    const clientX = event?.clientX ?? rect.left + wrapper.clientWidth / 2;
    const clientY = event?.clientY ?? rect.top + wrapper.clientHeight / 2;
    return {
        x: (wrapper.scrollLeft + clientX - rect.left - padX) / stateZoom,
        y: (wrapper.scrollTop + clientY - rect.top - padY) / stateZoom,
        clientX,
        clientY,
        rectLeft: rect.left,
        rectTop: rect.top,
    };
}

function restoreZoomAnchor(wrapper, anchor) {
    if (!wrapper || !anchor) return;
    const engine = document.getElementById("zoom-engine");
    const padX = parseFloat(engine?.dataset.zoomPadX) || 0;
    const padY = parseFloat(engine?.dataset.zoomPadY) || 0;
    wrapper.scrollLeft = padX + anchor.x * stateZoom - (anchor.clientX - anchor.rectLeft);
    wrapper.scrollTop = padY + anchor.y * stateZoom - (anchor.clientY - anchor.rectTop);
}

// The floating insert bar sits over the top of the canvas: keep it centred on the canvas (the side panels change
// its width) and report how far it reaches into the canvas, so the slide is fitted and placed below it.
function positionInsertToolbar(wrapper) {
    const row = document.getElementById("insert-toolbar-row");
    if (!row || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    if (!rect.width) return;
    row.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    row.style.width = `${Math.round(Math.max(200, Math.min(980, rect.width - 24)))}px`;
}

function getCanvasTopInset(wrapper) {
    const bar = document.querySelector("#insert-toolbar-row .toolbar-secondary-bar");
    if (!bar || !wrapper) return 0;
    const barRect = bar.getBoundingClientRect();
    if (!barRect.height) return 0;
    const overlap = barRect.bottom + 8 - wrapper.getBoundingClientRect().top;
    return Math.max(0, Math.round(overlap - EDITOR_ZOOM_PADDING));
}

// Room for the zoom and AI buttons along the bottom of the canvas, so a fitted slide is not covered by them.
function getCanvasBottomInset(wrapper) {
    if (!wrapper) return 0;
    const wrapperRect = wrapper.getBoundingClientRect();
    const tops = ["zoom-lens-toggle", "ai-assistant-dock"]
        .map(id => document.getElementById(id) || document.querySelector(`.${id}`))
        .map(node => node?.querySelector?.(".ai-dock-toggle") || node)
        .filter(node => node && node.offsetParent)
        .map(node => node.getBoundingClientRect().top)
        .filter(top => top > wrapperRect.top + wrapperRect.height / 2);
    if (!tops.length) return 0;
    const covered = wrapperRect.bottom - Math.min(...tops) + 8;
    return Math.max(0, Math.round(covered - EDITOR_ZOOM_PADDING));
}

function applyZoom(options = {}) {
    const engine = document.getElementById("zoom-engine");
    const wrapper = document.getElementById("canvas-wrapper");
    const label = document.getElementById("zoom-label");
    const lensLabel = document.getElementById("zoom-lens-label");
    const slider = document.getElementById("zoom-slider");

    const anchor = options.anchor || (options.preserveViewport ? getZoomAnchor(wrapper, options.anchorEvent) : null);

    if (engine && wrapper) {
        if (isPresentationPlaying()) {
            suspendEditorZoom();
            return;
        }

        const { width: slideW, height: slideH } = getSlideSize();
        
        const scaledW = slideW * stateZoom;
        const scaledH = slideH * stateZoom;

        positionInsertToolbar(wrapper);
        const topInset = getCanvasTopInset(wrapper);
        const bottomInset = getCanvasBottomInset(wrapper);
        const padX = Math.max(EDITOR_ZOOM_PADDING, (wrapper.clientWidth - scaledW) / 2);
        // Centred in the space between the insert bar and the button row.
        const padMiddle = Math.max(EDITOR_ZOOM_PADDING, (wrapper.clientHeight - topInset - bottomInset - scaledH) / 2);
        const padY = padMiddle + topInset; // slide's top offset: below the insert bar
        const padBelow = padMiddle + bottomInset;

        engine.style.width = `${scaledW + padX * 2}px`;
        engine.style.height = `${scaledH + padY + padBelow}px`;
        engine.style.left = "0";
        engine.style.top = "0";
        engine.style.marginLeft = "0";
        engine.style.marginTop = "0";
        engine.style.marginRight = "0";
        engine.style.marginBottom = "0";
        engine.dataset.zoomPadX = String(padX);
        engine.dataset.zoomPadY = String(padY);
        
        const revealEl = engine.querySelector(".reveal");
        if (revealEl) {
            setImportantStyle(revealEl, "width", `${slideW}px`);
            setImportantStyle(revealEl, "height", `${slideH}px`);
            setImportantStyle(revealEl, "position", "absolute");
            setImportantStyle(revealEl, "left", `${padX}px`);
            setImportantStyle(revealEl, "top", `${padY}px`);
            setImportantStyle(revealEl, "transform", `scale(${stateZoom})`);
            setImportantStyle(revealEl, "transform-origin", "0 0");
            revealEl.style.maxWidth = "none";
            revealEl.style.maxHeight = "none";
        }
        
        engine.style.transform = "none";
    }

    const zoomText = `${Math.round(stateZoom * 100)}%`;
    if (label) label.textContent = zoomText;
    if (lensLabel) lensLabel.textContent = zoomText;
    if (slider) slider.value = stateZoom;

    if (typeof Reveal !== "undefined" && Reveal.layout) {
        Reveal.layout();
    }

    if (anchor) {
        requestAnimationFrame(() => restoreZoomAnchor(wrapper, anchor));
    }
}

function setZoomControlExpanded(expanded) {
    const control = document.getElementById("zoom-control");
    const toggle = document.getElementById("zoom-lens-toggle");
    if (!control) return;
    control.dataset.expanded = expanded ? "true" : "false";
    control.classList.toggle("is-open", Boolean(expanded));
    toggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function toggleZoomControl() {
    const control = document.getElementById("zoom-control");
    setZoomControlExpanded(control?.dataset.expanded !== "true");
}

function initZoomControlDisclosure() {
    const control = document.getElementById("zoom-control");
    if (!control || control.dataset.disclosureInitialized === "true") return;
    control.dataset.disclosureInitialized = "true";

    document.addEventListener("pointerdown", event => {
        if (!control.contains(event.target)) {
            setZoomControlExpanded(false);
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            setZoomControlExpanded(false);
        }
    });
}

function changeZoom(delta, options = {}) {
    const wrapper = document.getElementById("canvas-wrapper");
    const anchor = getZoomAnchor(wrapper, options.anchorEvent);
    zoomMode = "manual";
    stateZoom = clampZoom(stateZoom + delta);
    applyZoom({ ...options, preserveViewport: false, anchor });
}

function handleZoomSlider(val, options = {}) {
    const wrapper = document.getElementById("canvas-wrapper");
    const anchor = getZoomAnchor(wrapper, options.anchorEvent);
    zoomMode = "manual";
    stateZoom = clampZoom(val);
    applyZoom({ ...options, preserveViewport: false, anchor });
}

function calculateFitZoom() {
    const wrapper = document.getElementById("canvas-wrapper");
    if (!wrapper) return 1;
    const { width: slideW, height: slideH } = getSlideSize();
    const padding = EDITOR_ZOOM_PADDING * 2;
    // The area without its scrollbars (offset size, not client size): a fitted slide needs none, and counting them
    // made "fit" flip between two values depending on whether they happened to be showing when it was measured
    // (the slide came back about 1% larger after each presentation).
    const availableW = Math.max(1, wrapper.offsetWidth - padding);
    const availableH = Math.max(1, wrapper.offsetHeight - padding - getCanvasTopInset(wrapper) - getCanvasBottomInset(wrapper));

    const scaleX = availableW / slideW;
    const scaleY = availableH / slideH;
    return clampZoom(Math.min(scaleX, scaleY));
}

function resetZoom() {
    if (isPresentationPlaying()) return;
    zoomMode = "fit";
    stateZoom = calculateFitZoom();
    
    applyZoom();
    centerSlide();
}

function handleEditorViewportResize() {
    if (isPresentationPlaying()) return;
    if (zoomMode === "fit") {
        stateZoom = calculateFitZoom();
        applyZoom();
        centerSlide();
    } else {
        applyZoom({ preserveViewport: true });
    }
    requestAnimationFrame(() => {
        if (typeof updateGroupBound === "function") updateGroupBound();
    });
}

function centerSlide() {
    if (isPresentationPlaying()) return;
    const wrapper = document.getElementById("canvas-wrapper");
    const engine = document.getElementById("zoom-engine");
    if (!wrapper || !engine) return;

    // Use multiple requestAnimationFrames to ensure layout is flushed 
    // after zoom changes or slide transitions.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const targetLeft = engine.offsetWidth / 2 - wrapper.clientWidth / 2;
            const targetTop = engine.offsetHeight / 2 - wrapper.clientHeight / 2;
            wrapper.scrollTo({
                left: Math.max(0, targetLeft),
                top: Math.max(0, targetTop),
                behavior: 'auto' // Use auto for instant programmatic resets
            });
        });
    });
}

function suspendEditorZoom() {
    const engine = document.getElementById("zoom-engine");
    const revealEl = engine?.querySelector(".reveal");
    if (engine) {
        ["width", "height", "left", "top", "margin-left", "margin-top", "margin-right", "margin-bottom", "transform"].forEach(prop =>
            engine.style.removeProperty(prop),
        );
        delete engine.dataset.zoomPadX;
        delete engine.dataset.zoomPadY;
    }
    if (revealEl) {
        ["width", "height", "position", "left", "top", "transform", "transform-origin", "max-width", "max-height"].forEach(prop =>
            revealEl.style.removeProperty(prop),
        );
    }
}

function restoreEditorZoom() {
    if (isPresentationPlaying()) return;
    // While presenting, the canvas fills the window, so a fit computed then is too large for the editor.
    if (zoomMode === "fit") stateZoom = calculateFitZoom();
    applyZoom();
    centerSlide();
    requestAnimationFrame(() => {
        if (zoomMode === "fit" && !isPresentationPlaying()) {
            const fit = calculateFitZoom();
            if (Math.abs(fit - stateZoom) > 0.001) {
                stateZoom = fit;
                applyZoom();
                centerSlide();
            }
        }
        if (typeof updateGroupBound === "function") updateGroupBound();
        if (typeof updateFloatingToolbars === "function") updateFloatingToolbars();
    });
}

window.getCanvasScale = function() {
    if (isPresentationPlaying()) {
        return typeof Reveal !== "undefined" && typeof Reveal.getScale === "function" ? Reveal.getScale() || 1 : 1;
    }
    return stateZoom;
};

// Global bindings
window.changeZoom = changeZoom;
window.handleZoomSlider = handleZoomSlider;
window.toggleZoomControl = toggleZoomControl;
window.setZoomControlExpanded = setZoomControlExpanded;
window.applyZoom = applyZoom;
window.resetZoom = resetZoom;
window.centerSlide = centerSlide;
window.handleEditorViewportResize = handleEditorViewportResize;
window.suspendEditorZoom = suspendEditorZoom;
window.restoreEditorZoom = restoreEditorZoom;
window.initZoom = initZoom;
