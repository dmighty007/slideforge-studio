// Presentation mode: laser pointer, spotlight, chalkboard and annotations.

const _presentationToolsState = {
    bound: false,
    chalkEnabled: false,
    laserEnabled: false,
    spotlightEnabled: false,
    frozen: false,
    isDrawing: false,
    lastDrawPoint: null,
    chalkColor: "#fff59d",
    currentStroke: null,
    tempStrokes: [],
};

function _presentationToolsElements() {
    return {
        wrapper: document.getElementById("canvas-wrapper"),
        chalkboard: document.getElementById("presentation-chalkboard"),
        laser: document.getElementById("presentation-laser-pointer"),
        chalkTools: document.getElementById("present-chalk-tools"),
        chalkIndicator: document.getElementById("present-chalk-indicator"),
        chalkColorChip: document.getElementById("present-chalk-color-chip"),
        chalkEraserBtn: document.getElementById("present-chalk-eraser-btn"),
        chalkBtn: document.getElementById("present-chalk-btn"),
        laserBtn: document.getElementById("present-laser-btn"),
        clearBtn: document.getElementById("present-clear-chalk-btn"),
        presenterBtn: document.getElementById("present-presenter-btn"),
        colorInput: document.getElementById("present-chalk-color"),
        fullscreenBtn: document.getElementById("present-menu-fullscreen-btn"),
        exitBtn: document.getElementById("present-exit-btn"),
        menuToggle: document.getElementById("present-menu-toggle"),
        menu: document.getElementById("present-menu"),
        contextMenu: document.getElementById("present-context-menu"),
        contextLaserBtn: document.getElementById("present-context-laser-btn"),
        contextChalkBtn: document.getElementById("present-context-chalk-btn"),
        contextClearBtn: document.getElementById("present-context-clear-btn"),
        saveAnnotationsBtn: document.getElementById("present-save-annotations-btn"),
        undoAnnotationBtn: document.getElementById("present-undo-annotation-btn"),
        freezeAnnotationsBtn: document.getElementById("present-freeze-annotations-btn"),
        spotlightBtn: document.getElementById("present-spotlight-btn"),
        contextSaveBtn: document.getElementById("present-context-save-btn"),
        contextUndoBtn: document.getElementById("present-context-undo-btn"),
        contextFreezeBtn: document.getElementById("present-context-freeze-btn"),
        contextSpotlightBtn: document.getElementById("present-context-spotlight-btn"),
        contextFullscreenBtn: document.getElementById("present-context-fullscreen-btn"),
        contextExitBtn: document.getElementById("present-context-exit-btn"),
    };
}

function _updatePresentationToolButtons() {
    const {
        chalkBtn,
        laserBtn,
        contextChalkBtn,
        contextLaserBtn,
        fullscreenBtn,
        contextFullscreenBtn,
        freezeAnnotationsBtn,
        spotlightBtn,
        contextFreezeBtn,
        contextSpotlightBtn,
        menuToggle,
        chalkTools,
        chalkColorChip,
    } = _presentationToolsElements();
    chalkBtn?.classList.toggle("is-active", _presentationToolsState.chalkEnabled);
    laserBtn?.classList.toggle("is-active", _presentationToolsState.laserEnabled);
    contextChalkBtn?.classList.toggle("is-active", _presentationToolsState.chalkEnabled);
    contextLaserBtn?.classList.toggle("is-active", _presentationToolsState.laserEnabled);
    freezeAnnotationsBtn?.classList.toggle("is-active", _presentationToolsState.frozen);
    contextFreezeBtn?.classList.toggle("is-active", _presentationToolsState.frozen);
    spotlightBtn?.classList.toggle("is-active", _presentationToolsState.spotlightEnabled);
    contextSpotlightBtn?.classList.toggle("is-active", _presentationToolsState.spotlightEnabled);
    const fullscreen = !!document.fullscreenElement;
    fullscreenBtn?.classList.toggle("is-active", fullscreen);
    contextFullscreenBtn?.classList.toggle("is-active", fullscreen);
    menuToggle?.classList.toggle(
        "is-active",
        _presentationToolsState.chalkEnabled || _presentationToolsState.laserEnabled,
    );
    chalkTools?.classList.toggle("hidden", !_presentationToolsState.chalkEnabled);
    if (chalkColorChip) {
        chalkColorChip.value = _presentationToolsState.chalkColor;
        chalkColorChip.style.boxShadow = `0 0 0 2px ${_presentationToolsState.chalkColor}`;
    }
}

function closePresentationMenus() {
    const { menu, contextMenu } = _presentationToolsElements();
    menu?.classList.add("hidden");
    contextMenu?.classList.add("hidden");
}

function togglePresentationMenu() {
    const { menu, contextMenu } = _presentationToolsElements();
    contextMenu?.classList.add("hidden");
    menu?.classList.toggle("hidden");
}

function openPresentationContextMenu(clientX, clientY) {
    const { contextMenu, menu } = _presentationToolsElements();
    if (!contextMenu) return;
    menu?.classList.add("hidden");
    contextMenu.classList.remove("hidden");
    const margin = 12;
    const width = contextMenu.offsetWidth || 220;
    const height = contextMenu.offsetHeight || 220;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, clientX));
    const top = Math.min(window.innerHeight - height - margin, Math.max(margin, clientY));
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
}

function _resizePresentationChalkboard() {
    const { wrapper, chalkboard, laser } = _presentationToolsElements();
    if (!wrapper || !chalkboard) return;
    const slideConfig = getPresentationPageSetupConfig();
    const width = Number(slideConfig.width) || 1024;
    const height = Number(slideConfig.height) || 768;
    const viewport = document.body.classList.contains("play-mode-active")
        ? _getPresentationViewportSize()
        : { width: wrapper.clientWidth, height: wrapper.clientHeight };
    const scale = Math.max(0.1, Math.min(viewport.width / width, viewport.height / height));
    document.documentElement.style.setProperty("--presentation-scale", String(scale));
    document.documentElement.style.setProperty(
        "--presentation-offset-x",
        `${Math.max(0, (viewport.width - width * scale) / 2)}px`,
    );
    document.documentElement.style.setProperty(
        "--presentation-offset-y",
        `${Math.max(0, (viewport.height - height * scale) / 2)}px`,
    );
    const snapshotCtx = chalkboard.getContext("2d", { willReadFrequently: true });
    const snapshot =
        chalkboard.width > 0 && chalkboard.height > 0
            ? snapshotCtx?.getImageData(0, 0, chalkboard.width, chalkboard.height)
            : null;

    chalkboard.width = width;
    chalkboard.height = height;
    chalkboard.style.transform = `scale(${scale})`;

    const ctx = chalkboard.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = _presentationToolsState.chalkColor;
    ctx.lineWidth = 5;
    if (snapshot && snapshot.width === width && snapshot.height === height) {
        ctx.putImageData(snapshot, 0, 0);
    }
}

function _getPresentationStagePoint(event) {
    const { chalkboard } = _presentationToolsElements();
    if (!chalkboard) return null;
    const rect = chalkboard.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
        x: Math.max(0, Math.min(chalkboard.width, ((event.clientX - rect.left) / rect.width) * chalkboard.width)),
        y: Math.max(0, Math.min(chalkboard.height, ((event.clientY - rect.top) / rect.height) * chalkboard.height)),
    };
}

function _drawPresentationSegment(from, to) {
    const { chalkboard } = _presentationToolsElements();
    const ctx = chalkboard?.getContext("2d");
    if (!ctx || !from || !to) return;
    ctx.strokeStyle = _presentationToolsState.chalkColor;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
}

function _redrawPresentationTemporaryAnnotations() {
    const { chalkboard } = _presentationToolsElements();
    const ctx = chalkboard?.getContext("2d");
    if (!ctx || !chalkboard) return;
    ctx.clearRect(0, 0, chalkboard.width, chalkboard.height);
    _presentationToolsState.tempStrokes.forEach(stroke => {
        ctx.save();
        ctx.strokeStyle = stroke.color || "#fff59d";
        ctx.lineWidth = Number(stroke.width) || 5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = stroke.opacity ?? 0.95;
        (stroke.points || []).forEach((point, index, points) => {
            if (!index) return;
            const prev = points[index - 1];
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(point.x, point.y);
            ctx.stroke();
        });
        ctx.restore();
    });
}

function undoPresentationAnnotation() {
    _presentationToolsState.tempStrokes.pop();
    _redrawPresentationTemporaryAnnotations();
}

function savePresentationAnnotationsToSlide() {
    const slide = state?.slides?.[currentSlideIndex];
    if (!slide || !_presentationToolsState.tempStrokes.length) return;
    const existing = Array.isArray(slide.whiteboardElements) ? slide.whiteboardElements : [];
    const next = _presentationToolsState.tempStrokes.map((stroke, index) => ({
        id: `anno_present_${Date.now()}_${index}`,
        schemaVersion: 2,
        kind: "stroke",
        role: "presenter-pen",
        geometry: {
            points: (stroke.points || []).map(point => ({
                x: Number(point.x) || 0,
                y: Number(point.y) || 0,
                pressure: point.pressure ?? 0.6,
                t: point.t || Date.now(),
            })),
        },
        style: {
            strokeColor: stroke.color || "#fff59d",
            strokeWidth: Number(stroke.width) || 5,
            strokeStyle: "solid",
            backgroundColor: "transparent",
            fillStyle: "none",
            roughness: 0,
            opacity: stroke.opacity ?? 0.95,
        },
        metadata: { source: "presentation-live-annotation" },
        zIndex: existing.length + index,
        opacity: stroke.opacity ?? 0.95,
        groupId: null,
        locked: false,
        visible: true,
        export: { includeInPdf: true, includeInPng: true, includeInSvg: true, flatten: false },
        presentation: { mode: "persistent", audienceVisible: true },
        animation: {
            type: "strokeDraw",
            delay: 0,
            duration: Math.max(500, (stroke.points || []).length * 7),
            sequence: null,
        },
    }));
    saveStateToUndo?.();
    slide.whiteboardElements = [...existing, ...next];
    _presentationToolsState.tempStrokes = [];
    _redrawPresentationTemporaryAnnotations();
    refreshPreviews?.();
    schedulePresentationAutosave?.(150);
}

function setPresentationFreezeAnnotations(enabled) {
    _presentationToolsState.frozen = !!enabled;
    _updatePresentationToolButtons();
}

function setPresentationSpotlightActive(enabled) {
    _presentationToolsState.spotlightEnabled = !!enabled;
    const { wrapper } = _presentationToolsElements();
    wrapper?.classList.toggle("presentation-spotlight-active", _presentationToolsState.spotlightEnabled);
    _updatePresentationToolButtons();
}

function _updatePresentationCursorMode() {
    const { wrapper } = _presentationToolsElements();
    if (!wrapper) return;
    wrapper.classList.toggle("presentation-cursor-hidden", _presentationToolsState.laserEnabled);
    wrapper.classList.toggle(
        "presentation-cursor-chalk",
        _presentationToolsState.chalkEnabled && !_presentationToolsState.laserEnabled,
    );
}

function _updatePresentationLaserPosition(event) {
    if (_presentationToolsState.spotlightEnabled) {
        const { wrapper } = _presentationToolsElements();
        wrapper?.style.setProperty("--spotlight-x", `${event.clientX}px`);
        wrapper?.style.setProperty("--spotlight-y", `${event.clientY}px`);
    }
    if (!_presentationToolsState.laserEnabled || !document.body.classList.contains("play-mode-active")) return;
    const { laser } = _presentationToolsElements();
    if (!laser) return;
    laser.style.left = `${event.clientX}px`;
    laser.style.top = `${event.clientY}px`;
}

function setPresentationLaserActive(enabled) {
    _presentationToolsState.laserEnabled = !!enabled;
    const { laser } = _presentationToolsElements();
    laser?.classList.toggle("is-active", _presentationToolsState.laserEnabled);
    if (!_presentationToolsState.laserEnabled && laser) {
        laser.style.left = "-100px";
        laser.style.top = "-100px";
    }
    _updatePresentationToolButtons();
    _updatePresentationCursorMode();
}

function setPresentationChalkActive(enabled) {
    _presentationToolsState.chalkEnabled = !!enabled;
    _presentationToolsState.isDrawing = false;
    _presentationToolsState.lastDrawPoint = null;
    const { chalkboard } = _presentationToolsElements();
    chalkboard?.classList.toggle("is-active", _presentationToolsState.chalkEnabled);
    _updatePresentationToolButtons();
    _updatePresentationCursorMode();
}

function clearPresentationChalkboard() {
    const { chalkboard } = _presentationToolsElements();
    const ctx = chalkboard?.getContext("2d");
    if (!ctx || !chalkboard) return;
    _presentationToolsState.tempStrokes = [];
    _presentationToolsState.currentStroke = null;
    ctx.clearRect(0, 0, chalkboard.width, chalkboard.height);
}

function resetPresentationTools() {
    setPresentationChalkActive(false);
    setPresentationLaserActive(false);
    closePresentationMenus();
}

function initPresentationTools() {
    if (_presentationToolsState.bound) return;
    _presentationToolsState.bound = true;
    // Moving the pointer during a show brings up the menu button; it fades again after 2.5 s of stillness.
    let pointerTimer = null;
    document.addEventListener("pointermove", () => {
        if (!document.body.classList.contains("play-mode-active")) return;
        document.body.classList.add("presentation-pointer-active");
        clearTimeout(pointerTimer);
        pointerTimer = setTimeout(() => document.body.classList.remove("presentation-pointer-active"), 2500);
    }, { passive: true });
    const {
        wrapper,
        chalkboard,
        chalkEraserBtn,
        chalkColorChip,
        chalkBtn,
        laserBtn,
        clearBtn,
        presenterBtn,
        colorInput,
        fullscreenBtn,
        exitBtn,
        menuToggle,
        contextLaserBtn,
        contextChalkBtn,
        contextClearBtn,
        saveAnnotationsBtn,
        undoAnnotationBtn,
        freezeAnnotationsBtn,
        spotlightBtn,
        contextSaveBtn,
        contextUndoBtn,
        contextFreezeBtn,
        contextSpotlightBtn,
        contextFullscreenBtn,
        contextExitBtn,
    } = _presentationToolsElements();
    if (!wrapper || !chalkboard) return;

    chalkBtn?.addEventListener("click", () => {
        setPresentationChalkActive(!_presentationToolsState.chalkEnabled);
        closePresentationMenus();
    });
    laserBtn?.addEventListener("click", () => {
        setPresentationLaserActive(!_presentationToolsState.laserEnabled);
        closePresentationMenus();
    });
    clearBtn?.addEventListener("click", () => {
        clearPresentationChalkboard();
        closePresentationMenus();
    });
    saveAnnotationsBtn?.addEventListener("click", () => {
        savePresentationAnnotationsToSlide();
        closePresentationMenus();
    });
    undoAnnotationBtn?.addEventListener("click", () => {
        undoPresentationAnnotation();
        closePresentationMenus();
    });
    freezeAnnotationsBtn?.addEventListener("click", () => {
        setPresentationFreezeAnnotations(!_presentationToolsState.frozen);
        closePresentationMenus();
    });
    spotlightBtn?.addEventListener("click", () => {
        setPresentationSpotlightActive(!_presentationToolsState.spotlightEnabled);
        closePresentationMenus();
    });
    presenterBtn?.addEventListener("click", () => {
        openPresenterView();
        closePresentationMenus();
    });
    // Also in the right-click menu: the full menu's hint sends people there, and it had no Presenter View.
    document.getElementById("present-context-presenter-btn")?.addEventListener("click", () => {
        openPresenterView();
        closePresentationMenus();
    });
    chalkEraserBtn?.addEventListener("click", () => {
        clearPresentationChalkboard();
    });
    colorInput?.addEventListener("input", event => {
        _presentationToolsState.chalkColor = event.target.value || "#fff59d";
        closePresentationMenus();
        _updatePresentationToolButtons();
    });
    chalkColorChip?.addEventListener("input", event => {
        _presentationToolsState.chalkColor = event.target.value || "#fff59d";
        if (colorInput) colorInput.value = _presentationToolsState.chalkColor;
        _updatePresentationToolButtons();
    });
    fullscreenBtn?.addEventListener("click", async () => {
        if (document.fullscreenElement) {
            await _syncBrowserFullscreen(false);
        } else {
            await _syncBrowserFullscreen(true);
        }
        _updatePresentationToolButtons();
        closePresentationMenus();
    });
    exitBtn?.addEventListener("click", () => {
        closePresentationMenus();
        togglePlayMode();
    });
    menuToggle?.addEventListener("click", event => {
        event.stopPropagation();
        togglePresentationMenu();
    });

    contextLaserBtn?.addEventListener("click", () => {
        setPresentationLaserActive(!_presentationToolsState.laserEnabled);
        closePresentationMenus();
    });
    contextChalkBtn?.addEventListener("click", () => {
        setPresentationChalkActive(!_presentationToolsState.chalkEnabled);
        closePresentationMenus();
    });
    contextClearBtn?.addEventListener("click", () => {
        clearPresentationChalkboard();
        closePresentationMenus();
    });
    contextSaveBtn?.addEventListener("click", () => {
        savePresentationAnnotationsToSlide();
        closePresentationMenus();
    });
    contextUndoBtn?.addEventListener("click", () => {
        undoPresentationAnnotation();
        closePresentationMenus();
    });
    contextFreezeBtn?.addEventListener("click", () => {
        setPresentationFreezeAnnotations(!_presentationToolsState.frozen);
        closePresentationMenus();
    });
    contextSpotlightBtn?.addEventListener("click", () => {
        setPresentationSpotlightActive(!_presentationToolsState.spotlightEnabled);
        closePresentationMenus();
    });
    contextFullscreenBtn?.addEventListener("click", async () => {
        if (document.fullscreenElement) {
            await _syncBrowserFullscreen(false);
        } else {
            await _syncBrowserFullscreen(true);
        }
        _updatePresentationToolButtons();
        closePresentationMenus();
    });
    contextExitBtn?.addEventListener("click", () => {
        closePresentationMenus();
        togglePlayMode();
    });

    chalkboard.addEventListener("pointerdown", event => {
        _updatePresentationLaserPosition(event);
        if (!_presentationToolsState.chalkEnabled) return;
        if (_presentationToolsState.frozen) return;
        const point = _getPresentationStagePoint(event);
        if (!point) return;
        _presentationToolsState.isDrawing = true;
        _presentationToolsState.lastDrawPoint = point;
        _presentationToolsState.currentStroke = {
            color: _presentationToolsState.chalkColor,
            width: 5,
            opacity: 0.95,
            points: [{ ...point, pressure: event.pressure || 0.6, t: Date.now() }],
        };
        _drawPresentationSegment(point, point);
        chalkboard.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    chalkboard.addEventListener("pointermove", event => {
        _updatePresentationLaserPosition(event);
        if (!_presentationToolsState.chalkEnabled || !_presentationToolsState.isDrawing) return;
        if (_presentationToolsState.frozen) return;
        const point = _getPresentationStagePoint(event);
        if (!point || !_presentationToolsState.lastDrawPoint) return;
        _drawPresentationSegment(_presentationToolsState.lastDrawPoint, point);
        _presentationToolsState.lastDrawPoint = point;
        _presentationToolsState.currentStroke?.points?.push({
            ...point,
            pressure: event.pressure || 0.6,
            t: Date.now(),
        });
        event.preventDefault();
    });
    chalkboard.addEventListener("pointerup", () => {
        if (_presentationToolsState.currentStroke?.points?.length > 1) {
            _presentationToolsState.tempStrokes.push(_presentationToolsState.currentStroke);
        }
        _presentationToolsState.currentStroke = null;
        _presentationToolsState.isDrawing = false;
        _presentationToolsState.lastDrawPoint = null;
    });
    chalkboard.addEventListener("pointerleave", () => {
        if (_presentationToolsState.currentStroke?.points?.length > 1) {
            _presentationToolsState.tempStrokes.push(_presentationToolsState.currentStroke);
        }
        _presentationToolsState.currentStroke = null;
        _presentationToolsState.isDrawing = false;
        _presentationToolsState.lastDrawPoint = null;
    });

    wrapper.addEventListener("pointermove", event => {
        _updatePresentationLaserPosition(event);
    });
    document.addEventListener("pointermove", _updatePresentationLaserPosition, true);
    wrapper.addEventListener("contextmenu", event => {
        if (!document.body.classList.contains("play-mode-active")) return;
        event.preventDefault();
        openPresentationContextMenu(event.clientX, event.clientY);
    });
    document.addEventListener(
        "contextmenu",
        event => {
            if (!document.body.classList.contains("play-mode-active")) return;
            event.preventDefault();
            openPresentationContextMenu(event.clientX, event.clientY);
        },
        true,
    );
    wrapper.addEventListener("click", event => {
        if (!document.body.classList.contains("play-mode-active")) return;
        if (_presentationToolsState.chalkEnabled || event.button !== 0) return;
        const { menu, contextMenu, menuToggle: toggle } = _presentationToolsElements();
        if (menu?.contains(event.target) || contextMenu?.contains(event.target) || toggle?.contains(event.target))
            return;
        presentationNextStep();
    });

    document.addEventListener("mousedown", event => {
        const { menu, contextMenu, menuToggle: toggle } = _presentationToolsElements();
        if (menu?.contains(event.target) || contextMenu?.contains(event.target) || toggle?.contains(event.target))
            return;
        closePresentationMenus();
    });

    document.addEventListener("keydown", event => {
        if (!document.body.classList.contains("play-mode-active")) return;
        const key = String(event.key || "").toLowerCase();
        if (key === "escape") {
            event.preventDefault();
            closePresentationMenus();
            togglePlayMode();
        } else if (key === "b") {
            event.preventDefault();
            setPresentationChalkActive(!_presentationToolsState.chalkEnabled);
        } else if (key === "l") {
            event.preventDefault();
            setPresentationLaserActive(!_presentationToolsState.laserEnabled);
        } else if (key === "x") {
            event.preventDefault();
            clearPresentationChalkboard();
        } else if ((event.ctrlKey || event.metaKey) && key === "z") {
            event.preventDefault();
            undoPresentationAnnotation();
        } else if (key === "s") {
            event.preventDefault();
            savePresentationAnnotationsToSlide();
        } else if (key === "m") {
            event.preventDefault();
            togglePresentationMenu();
        } else if (key === "f") {
            event.preventDefault();
            if (document.fullscreenElement) {
                _syncBrowserFullscreen(false);
            } else {
                _syncBrowserFullscreen(true);
            }
            _updatePresentationToolButtons();
        } else if (key === "p") {
            event.preventDefault();
            openPresenterView();
        } else if (["arrowright", "arrowdown", "pagedown", " "].includes(key)) {
            event.preventDefault();
            presentationNextStep();
        } else if (["arrowleft", "arrowup", "pageup"].includes(key)) {
            event.preventDefault();
            presentationPrevStep();
        }
    });
}
