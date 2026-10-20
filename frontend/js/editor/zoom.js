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
    // Ctrl+wheel, and a trackpad pinch (which arrives as Ctrl+wheel), zoom in proportion to the wheel's movement,
    // about the pointer. Each event was a fixed 10% step: a pinch sends dozens of small events, so it jumped straight
    // to the 500% limit, and at 20% one notch halved or doubled the slide.
    wrapper.addEventListener("wheel", (e) => {
        if (isPresentationPlaying()) return;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
            zoomBy(Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.0015), { anchorEvent: e });
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
            document.body.classList.add("sf-space-pan");
            // Prevent scrolling with space
            if (e.target === document.body) e.preventDefault();
        }
    });

    window.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
            isSpaceDown = false;
            isPanning = false;
            if (wrapper) wrapper.style.cursor = "";
            document.body.classList.remove("sf-space-pan", "sf-canvas-panning");
        }
    });

    // Space+drag or a middle-button drag pans the canvas, over objects too. Caught on the way down, before the
    // object under the pointer selects itself and the empty canvas clears the selection or starts a marquee.
    wrapper.addEventListener("mousedown", (e) => {
        if ((isSpaceDown || e.button === 1) && !isPresentationPlaying()) {
            isPanning = true;
            startPanX = e.clientX;
            startPanY = e.clientY;
            startScrollX = wrapper.scrollLeft;
            startScrollY = wrapper.scrollTop;
            wrapper.style.cursor = "grabbing";
            document.body.classList.add("sf-canvas-panning");
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    window.addEventListener("mousemove", (e) => {
        if (isPanning) {
            const dx = e.clientX - startPanX;
            const dy = e.clientY - startPanY;
            wrapper.scrollLeft = startScrollX - dx;
            wrapper.scrollTop = startScrollY - dy;
        }
    });

    let panEndedAt = 0;
    window.addEventListener("mouseup", () => {
        if (isPanning) {
            isPanning = false;
            panEndedAt = Date.now();
            wrapper.style.cursor = isSpaceDown ? "grab" : "";
            document.body.classList.remove("sf-canvas-panning");
        }
    });
    // The click that ends a pan over an object is not a click on the object (some select themselves on click).
    wrapper.addEventListener("click", (e) => {
        if (Date.now() - panEndedAt < 300) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
    // A middle click only pans (on Linux it would also paste the text selection into a text box being edited).
    wrapper.addEventListener("auxclick", (e) => {
        if (e.button === 1) e.preventDefault();
    });

    initCanvasTouchGestures(wrapper);
}

// Touch on the canvas: two fingers pinch to zoom and move the view together; one finger on empty canvas pans it;
// a finger held still on an object or the canvas opens the context menu. Before, none of these did anything (and
// on a touch laptop a pinch zoomed the whole window, toolbars and all).
let canvasGestureActive = false;
function isCanvasGestureActive() {
    return canvasGestureActive;
}
window.isCanvasGestureActive = isCanvasGestureActive;

function initCanvasTouchGestures(wrapper) {
    const touches = new Map();
    let pinch = null;
    let pan = null;
    let hold = null;
    let frame = 0;
    let suppressContextMenuUntil = 0;
    const HOLD_MS = 550;
    const HOLD_SLOP = 8;

    const cancelHold = () => {
        if (hold) clearTimeout(hold.timer);
        hold = null;
    };
    const points = () => [...touches.values()];
    const startPinch = () => {
        const [a, b] = points();
        const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
        pinch = {
            distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
            zoom: stateZoom,
            anchor: getZoomAnchor(wrapper, mid),
        };
        pan = null;
        cancelHold();
        canvasGestureActive = true;
    };
    const applyPinch = () => {
        frame = 0;
        if (!pinch || touches.size < 2) return;
        const [a, b] = points();
        zoomMode = "manual";
        stateZoom = clampZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
        // The point that was between the fingers stays between them: pinching zooms, moving both fingers pans.
        const rect = wrapper.getBoundingClientRect();
        applyZoom({
            anchor: { ...pinch.anchor, clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, rectLeft: rect.left, rectTop: rect.top },
        });
        if (typeof updateGroupBound === "function") updateGroupBound();
    };

    wrapper.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch" || isPresentationPlaying()) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
            // The second finger: whatever the first one started (a drag of an object) gives way to the pinch.
            e.stopPropagation();
            startPinch();
            return;
        }
        if (touches.size > 2) return;
        const onEmptyCanvas = !e.target.closest?.(".canvas-element, .resize-handle, .rotate-handle, #group-bound, .floating-text-toolbar, [data-floating-toolbar]");
        if (onEmptyCanvas) {
            pan = { x: e.clientX, y: e.clientY, left: wrapper.scrollLeft, top: wrapper.scrollTop };
        }
        const target = e.target;
        hold = {
            x: e.clientX,
            y: e.clientY,
            timer: setTimeout(() => {
                hold = null;
                if (touches.size !== 1 || canvasGestureActive) return;
                suppressContextMenuUntil = Date.now() + 800; // the browser's own long-press menu event, if it sends one
                pan = null;
                target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
                if (navigator.vibrate) navigator.vibrate(10);
            }, HOLD_MS),
        };
    }, true);

    // Moves and releases are followed on the whole window: a text box being edited stops them on their way, and a
    // missed release left a stale long-press that opened the menu under the next tap.
    window.addEventListener("pointermove", (e) => {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) cancelHold();
        if (pinch) {
            e.stopPropagation();
            if (!frame) frame = requestAnimationFrame(applyPinch);
        } else if (pan && touches.size === 1) {
            wrapper.scrollLeft = pan.left - (e.clientX - pan.x);
            wrapper.scrollTop = pan.top - (e.clientY - pan.y);
        }
    }, true);

    const release = (e) => {
        if (!touches.has(e.pointerId)) return;
        touches.delete(e.pointerId);
        cancelHold();
        if (touches.size < 2 && pinch) {
            pinch = null;
            pan = null;
            if (typeof updateFloatingToolbars === "function") updateFloatingToolbars();
        }
        if (!touches.size) {
            pan = null;
            // Cleared after the events of this release (a tap's click) have run.
            setTimeout(() => {
                canvasGestureActive = false;
            }, 0);
        }
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    wrapper.addEventListener("contextmenu", (e) => {
        if (e.isTrusted && Date.now() < suppressContextMenuUntil) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, true);
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
    // Just below the top bar, however tall it is: on a narrow window it wraps onto a second row (the project name),
    // which the bar at its fixed 58px covered.
    const header = document.getElementById("app-toolbar");
    const headerBottom = header?.getBoundingClientRect().bottom;
    if (headerBottom > 0) row.style.top = `${Math.round(headerBottom + 2)}px`;
    window.fitInsertToolbar?.();
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
        // At once as well as after the frame: the next wheel event of a pinch measures from the scroll position,
        // and before it was restored each step drifted away from the pointer.
        restoreZoomAnchor(wrapper, anchor);
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

// Zoom by a factor (1.2 = 20% larger) about the pointer, or the canvas centre.
function zoomBy(factor, options = {}) {
    const wrapper = document.getElementById("canvas-wrapper");
    const anchor = getZoomAnchor(wrapper, options.anchorEvent);
    zoomMode = "manual";
    stateZoom = clampZoom(stateZoom * factor);
    applyZoom({ ...options, preserveViewport: false, anchor });
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
