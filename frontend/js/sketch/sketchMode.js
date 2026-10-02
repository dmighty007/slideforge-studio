// Sketch drawing mode for sketch elements on slides

let _currentSketchMode = null;

function initSketchMode(sketchElementId) {
    const slide = state.slides[currentSlideIndex];
    if (!slide) return;

    const elData = slide.elements.find(e => e.id === sketchElementId);
    if (!elData || elData.type !== "sketch") return;

    // If already in sketch mode for this element, cancel it
    if (_currentSketchMode?.elementId === sketchElementId) {
        exitSketchMode();
        return;
    }

    // Exit any existing sketch mode
    if (_currentSketchMode) {
        exitSketchMode();
    }

    const elDom = document.getElementById(sketchElementId);
    if (!elDom) return;

    const canvas = elDom.querySelector("canvas.sketch-canvas");
    if (!canvas) return;

    _currentSketchMode = {
        elementId: sketchElementId,
        elementData: elData,
        canvas,
        elementDom: elDom,
        isDrawing: false,
        currentStroke: null,
        capturedPointerId: null,
        isErasing: false,
        activeTool: "pen",
        dirty: false,
        toolbar: null,
        tools: {
            color: elData.sketchStrokeColor || "#000000",
            width: elData.sketchStrokeWidth || 2,
        },
        boundHandlers: {},
    };

    // Mark element as in sketch mode
    elDom.classList.add("sketch-mode-active");

    // Bind pointer events to canvas
    _setupSketchPointerHandlers(_currentSketchMode);
}

function exitSketchMode() {
    if (!_currentSketchMode) return;

    const mode = _currentSketchMode;

    // Remove pointer event listeners
    if (mode.boundHandlers.pointerdown) {
        mode.canvas.removeEventListener("pointerdown", mode.boundHandlers.pointerdown);
    }
    if (mode.boundHandlers.pointermove) {
        document.removeEventListener("pointermove", mode.boundHandlers.pointermove);
    }
    if (mode.boundHandlers.pointerup) {
        document.removeEventListener("pointerup", mode.boundHandlers.pointerup);
    }

    // Remove keyboard listener
    if (mode.boundHandlers.keydown) {
        document.removeEventListener("keydown", mode.boundHandlers.keydown);
    }
    if (mode.toolbar) {
        mode.toolbar.remove();
    }

    // Remove visual indicator
    if (mode.elementDom) {
        mode.elementDom.classList.remove("sketch-mode-active");
    }

    // Save to undo if strokes were added
    if (mode.dirty || (mode.elementData.strokes && mode.elementData.strokes.length > 0)) {
        if (typeof schedulePresentationAutosave === "function") {
            schedulePresentationAutosave();
        }
        if (window.refreshPreviews) {
            window.refreshPreviews();
        } else if (window.refreshActiveSlidePreview) {
            window.refreshActiveSlidePreview();
        }
    }

    _currentSketchMode = null;
}

function _setupSketchPointerHandlers(mode) {
    _createSketchToolbar(mode);

    const handlePointerDown = e => {
        if (e.isPrimary === false) return;

        e.preventDefault();
        e.stopPropagation();

        mode.capturedPointerId = e.pointerId;
        mode.isDrawing = true;

        const rect = mode.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check for keyboard modifiers for eraser
        mode.isErasing = mode.activeTool === "eraser" || e.ctrlKey || e.metaKey;

        if (mode.isErasing) {
            // Eraser mode
            _eraseSketchPoint(mode, { x, y });
        } else {
            // Start new stroke
            mode.currentStroke = {
                points: [{ x, y }],
                color: mode.tools.color,
                width: mode.tools.width,
                timestamp: Date.now(),
            };
        }

        try {
            mode.canvas.setPointerCapture(e.pointerId);
        } catch (_err) {}
    };

    const handlePointerMove = e => {
        if (!mode.isDrawing || e.pointerId !== mode.capturedPointerId) return;

        e.preventDefault();
        e.stopPropagation();

        const rect = mode.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (mode.isErasing) {
            _eraseSketchPoint(mode, { x, y });
        } else {
            if (mode.currentStroke) {
                mode.currentStroke.points.push({ x, y });
                _renderSketchCanvas(mode);
            }
        }
    };

    const handlePointerUp = e => {
        if (e.pointerId !== mode.capturedPointerId) return;

        e.preventDefault();
        e.stopPropagation();

        mode.isDrawing = false;

        // Finalize stroke
        if (!mode.isErasing && mode.currentStroke && mode.currentStroke.points.length >= 2) {
            mode.elementData.strokes = mode.elementData.strokes || [];
            mode.elementData.strokes.push(mode.currentStroke);
            mode.dirty = true;
        }

        mode.currentStroke = null;
        mode.capturedPointerId = null;

        // Save state
        if (typeof updateElementState === "function") {
            updateElementState(mode.elementId, {
                strokes: mode.elementData.strokes,
                sketchStrokeColor: mode.tools.color,
                sketchStrokeWidth: mode.tools.width,
            });
        }
        if (typeof schedulePresentationAutosave === "function") {
            schedulePresentationAutosave(250);
        }

        _renderSketchCanvas(mode);

        try {
            mode.canvas.releasePointerCapture(e.pointerId);
        } catch (err) {
            // Ignore release errors
        }
    };

    const handleKeyDown = e => {
        if (e.key === "Escape") {
            exitSketchMode();
        } else if (e.key.toLowerCase() === "e") {
            e.preventDefault();
            _setSketchTool(mode, "eraser");
        } else if (e.key.toLowerCase() === "p") {
            e.preventDefault();
            _setSketchTool(mode, "pen");
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            _undoSketchStroke(mode);
        } else if (e.key === "Delete" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) {
            e.preventDefault();
            _clearSketch(mode);
        }
    };

    // Store bound handlers for cleanup
    mode.boundHandlers.pointerdown = handlePointerDown;
    mode.boundHandlers.pointermove = handlePointerMove;
    mode.boundHandlers.pointerup = handlePointerUp;
    mode.boundHandlers.keydown = handleKeyDown;

    // Attach listeners
    mode.canvas.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("keydown", handleKeyDown);

    // Focus canvas for keyboard input
    mode.canvas.tabIndex = 0;
    mode.canvas.focus();

    _renderSketchCanvas(mode);
}

function _createSketchToolbar(mode) {
    const toolbar = document.createElement("div");
    toolbar.className = "sketch-inline-toolbar";
    toolbar.innerHTML = `
        <button type="button" class="sketch-tool-btn is-active" data-tool="pen" title="Pen"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="sketch-tool-btn" data-tool="eraser" title="Eraser"><i class="fa-solid fa-eraser"></i></button>
        <input class="sketch-color-input" type="color" value="${escapeHtml(mode.tools.color)}" title="Stroke color">
        <select class="sketch-width-select" title="Stroke width">
            ${[1, 2, 3, 4, 6, 8, 12, 16].map(width => `<option value="${width}" ${Number(mode.tools.width) === width ? "selected" : ""}>${width}</option>`).join("")}
        </select>
        <button type="button" class="sketch-tool-btn" data-action="undo" title="Undo last stroke"><i class="fa-solid fa-rotate-left"></i></button>
        <button type="button" class="sketch-tool-btn" data-action="clear" title="Clear"><i class="fa-regular fa-trash-can"></i></button>
        <button type="button" class="sketch-tool-btn sketch-done-btn" data-action="done" title="Done"><i class="fa-solid fa-check"></i></button>
    `;
    toolbar.addEventListener("pointerdown", e => {
        e.preventDefault();
        e.stopPropagation();
    });
    toolbar.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const button = e.target.closest("button");
        if (!button) return;
        const tool = button.dataset.tool;
        const action = button.dataset.action;
        if (tool) _setSketchTool(mode, tool);
        else if (action === "undo") _undoSketchStroke(mode);
        else if (action === "clear") _clearSketch(mode);
        else if (action === "done") exitSketchMode();
        mode.canvas.focus();
    });
    toolbar.querySelector(".sketch-color-input")?.addEventListener("input", e => {
        mode.tools.color = e.target.value;
        mode.elementData.sketchStrokeColor = e.target.value;
        mode.dirty = true;
        if (typeof updateElementState === "function") updateElementState(mode.elementId, { sketchStrokeColor: e.target.value });
    });
    toolbar.querySelector(".sketch-width-select")?.addEventListener("change", e => {
        mode.tools.width = Number(e.target.value) || 2;
        mode.elementData.sketchStrokeWidth = mode.tools.width;
        mode.dirty = true;
        if (typeof updateElementState === "function") updateElementState(mode.elementId, { sketchStrokeWidth: mode.tools.width });
    });
    mode.elementDom.appendChild(toolbar);
    mode.toolbar = toolbar;
}

function _setSketchTool(mode, tool) {
    mode.activeTool = tool;
    mode.toolbar?.querySelectorAll("[data-tool]").forEach(btn => {
        btn.classList.toggle("is-active", btn.dataset.tool === tool);
    });
    mode.canvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
}

function _undoSketchStroke(mode) {
    if (!mode.elementData.strokes?.length) return;
    mode.elementData.strokes = mode.elementData.strokes.slice(0, -1);
    mode.dirty = true;
    if (typeof updateElementState === "function") updateElementState(mode.elementId, { strokes: mode.elementData.strokes });
    _renderSketchCanvas(mode);
}

function _clearSketch(mode) {
    mode.elementData.strokes = [];
    mode.dirty = true;
    if (typeof updateElementState === "function") updateElementState(mode.elementId, { strokes: [] });
    _renderSketchCanvas(mode);
}

function _renderSketchCanvas(mode) {
    const canvas = mode.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Render background + all saved strokes
    if (typeof renderSketchStrokes === "function") {
        renderSketchStrokes(ctx, mode.elementData.strokes || [], rect.width, rect.height);
    }

    // Render current stroke being drawn
    if (mode.currentStroke && mode.currentStroke.points.length > 0) {
        const stroke = mode.currentStroke;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 0.8;

        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
    }
}

function _eraseSketchPoint(mode, point) {
    const eraserRadius = 30;

    if (!mode.elementData.strokes) return;

    // Filter out points within eraser radius
    mode.elementData.strokes = mode.elementData.strokes
        .map(stroke => {
            if (!stroke.points) return stroke;

            const filteredPoints = stroke.points.filter(p => {
                const dx = p.x - point.x;
                const dy = p.y - point.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                return dist > eraserRadius;
            });

            return {
                ...stroke,
                points: filteredPoints,
            };
        })
        .filter(stroke => stroke.points && stroke.points.length >= 2);

    mode.dirty = true;
    if (typeof updateElementState === "function") {
        updateElementState(mode.elementId, { strokes: mode.elementData.strokes });
    }
    _renderSketchCanvas(mode);
}

// Expose to window for onclick handlers
window.initSketchMode = initSketchMode;
window.exitSketchMode = exitSketchMode;
