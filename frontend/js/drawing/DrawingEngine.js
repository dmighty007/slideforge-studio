import { HistoryManager } from "./HistoryManager.js";
import { PathSimplifier } from "./PathSimplifier.js";
import { RoughRenderer } from "./RoughRenderer.js";
import { StrokeRenderer } from "./StrokeRenderer.js";

const DRAWING_TOOLS = new Set(["pen", "rectangle", "diamond", "ellipse", "triangle", "star", "line", "arrow", "curve", "curve_arrow", "text"]);

export class DrawingEngine {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext("2d");
        this.options = {
            showGrid: options.showGrid !== false,
            allowPanZoom: options.allowPanZoom !== false,
        };
        this.elements = [];
        this.viewport = { panX: 0, panY: 0, zoom: 1.0 };
        this.activeTool = "select";
        this.isDrawing = false;
        this.isPanning = false;
        this.isMovingSelection = false;
        this.isResizingSelection = false;
        this.isErasing = false;
        this.panStart = { x: 0, y: 0 };
        this.moveStart = null;
        this.resizeStart = null;
        this.currentStroke = null;
        this.textEditor = null;
        this.capturedPointerId = null;
        this.selectedElementId = null;
        this.hoverElementId = null;
        this._handlersAttached = false;
        this._renderLoopStarted = false;
        this._needsRender = true;
        this._spaceDown = false;

        this.strokeColor = "#1f2937";
        this.backgroundColor = "#fff1a8";
        this.fillStyle = "solid";
        this.strokeWidth = 2;
        this.strokeStyle = "solid";
        this.roughness = 1.6;
        this.bowing = 1.0;
        this.opacity = 1;
        this.annotationRole = null;
        this.fontFamily = '"Virgil", "Comic Sans MS", "Segoe Print", cursive';
        this.fontSize = 22;

        this.history = new HistoryManager();
        this.boundHandlers = {};
        this.setupEventHandlers();
        this.startRenderLoop();
    }

    requestRender() {
        this._needsRender = true;
    }

    setOptions(options = {}) {
        this.options = { ...this.options, ...options };
        if (this.options.allowPanZoom === false) {
            this.viewport = { panX: 0, panY: 0, zoom: 1.0 };
        }
        this.emitChange();
    }

    setElements(elements = []) {
        this.cancelActiveTextEditor();
        this.elements = JSON.parse(JSON.stringify(Array.isArray(elements) ? elements : []));
        this.selectedElementId = null;
        this.currentStroke = null;
        this.history = new HistoryManager();
        this.requestRender();
        this.emitChange();
    }

    getElements() {
        return JSON.parse(JSON.stringify(this.elements));
    }

    setupEventHandlers() {
        if (!this.canvas || this._handlersAttached) return;
        this.boundHandlers.pointerDown = e => this.handlePointerDown(e);
        this.boundHandlers.pointerMove = e => this.handlePointerMove(e);
        this.boundHandlers.pointerUp = e => this.handlePointerUp(e);
        this.boundHandlers.wheel = e => this.handleWheel(e);
        this.boundHandlers.keyDown = e => this.handleKeyDown(e);
        this.boundHandlers.keyUp = e => this.handleKeyUp(e);
        this.canvas.addEventListener("pointerdown", this.boundHandlers.pointerDown);
        this.canvas.addEventListener("pointermove", this.boundHandlers.pointerMove);
        document.addEventListener("pointerup", this.boundHandlers.pointerUp);
        document.addEventListener("keydown", this.boundHandlers.keyDown);
        document.addEventListener("keyup", this.boundHandlers.keyUp);
        this.canvas.addEventListener("wheel", this.boundHandlers.wheel, { passive: false });
        this._handlersAttached = true;
    }

    removeEventHandlers() {
        if (!this.canvas || !this._handlersAttached) return;
        this.commitActiveTextEditor();
        this.canvas.removeEventListener("pointerdown", this.boundHandlers.pointerDown);
        this.canvas.removeEventListener("pointermove", this.boundHandlers.pointerMove);
        document.removeEventListener("pointerup", this.boundHandlers.pointerUp);
        document.removeEventListener("keydown", this.boundHandlers.keyDown);
        document.removeEventListener("keyup", this.boundHandlers.keyUp);
        this.canvas.removeEventListener("wheel", this.boundHandlers.wheel);
        this._handlersAttached = false;
    }

    screenToWorld(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = screenX - rect.left;
        const canvasY = screenY - rect.top;
        return {
            x: (canvasX - this.viewport.panX) / this.viewport.zoom,
            y: (canvasY - this.viewport.panY) / this.viewport.zoom,
        };
    }

    createBaseElement(type, overrides = {}) {
        return {
            id: `draw_${type}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            type,
            seed: Math.floor(Math.random() * 1000000000),
            strokeColor: this.strokeColor,
            backgroundColor: this.backgroundColor,
            fillStyle: this.fillStyle,
            strokeWidth: this.strokeWidth,
            strokeStyle: this.strokeStyle,
            roughness: this.roughness,
            bowing: this.bowing,
            opacity: this.opacity,
            role: this.annotationRole || overrides.role || type,
            blendMode: this.annotationRole === "highlighter" ? "multiply" : "normal",
            ...overrides,
        };
    }

    setTool(tool) {
        this.commitActiveTextEditor();
        this.activeTool = tool;
        if (tool !== "select") this.selectedElementId = null;
        this.updateCursor();
        this.requestRender();
        this.emitChange();
    }

    getSelectedElement() {
        return this.elements.find(el => el.id === this.selectedElementId) || null;
    }

    updateSelectedStyle(updates) {
        const selected = this.getSelectedElement();
        if (selected) Object.assign(selected, updates);
        Object.assign(this, this.normalizeStyleUpdates(updates));
        this.requestRender();
        this.emitChange();
    }

    normalizeStyleUpdates(updates) {
        const allowed = {};
        ["strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity"].forEach(key => {
            if (updates[key] !== undefined) allowed[key] = updates[key];
        });
        return allowed;
    }

    handlePointerDown(e) {
        if (e.button === 2) return;
        e.preventDefault();
        const worldPt = this.screenToWorld(e.clientX, e.clientY);
        const shouldPan = this.options.allowPanZoom && (e.button === 1 || this.activeTool === "pan" || this._spaceDown);
        if (shouldPan) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.capturePointer(e);
            return;
        }

        if (this.activeTool === "eraser") {
            this.history.pushState(this.elements);
            this.isErasing = true;
            this.capturePointer(e);
            this.handleEraser(worldPt, { emit: false });
            return;
        }

        if (this.activeTool === "select") {
            const handle = this.hitResizeHandle(worldPt);
            if (handle) {
                const selected = this.getSelectedElement();
                this.history.pushState(this.elements);
                this.isResizingSelection = true;
                this.resizeStart = {
                    handle,
                    pointer: worldPt,
                    element: JSON.parse(JSON.stringify(selected)),
                    bounds: this.getElementBounds(selected),
                };
                this.capturePointer(e);
                this.requestRender();
                return;
            }
            const hit = this.hitTest(worldPt);
            this.selectedElementId = hit?.id || null;
            if (hit && !hit.locked) {
                this.history.pushState(this.elements);
                this.isMovingSelection = true;
                this.moveStart = {
                    pointer: worldPt,
                    element: JSON.parse(JSON.stringify(hit)),
                };
                this.capturePointer(e);
            }
            this.requestRender();
            this.emitChange();
            return;
        }

        if (this.activeTool === "text") {
            e.preventDefault();
            e.stopPropagation();
            this.startTextEditor(worldPt, e);
            return;
        }

        if (!DRAWING_TOOLS.has(this.activeTool)) return;
        this.history.pushState(this.elements);
        this.isDrawing = true;
        this.capturePointer(e);
        if (this.activeTool === "pen") {
            this.currentStroke = this.createBaseElement("freehand", {
                points: [this.createPoint(worldPt, e)],
                backgroundColor: "transparent",
                fillStyle: "solid",
            });
        } else {
            this.currentStroke = this.createBaseElement("draw_shape", {
                shapeType: this.activeTool,
                x: worldPt.x,
                y: worldPt.y,
                width: 0,
                height: 0,
            });
            this.shapeStartPt = { ...worldPt };
        }
        this.requestRender();
    }

    handlePointerMove(e) {
        if (this.isPanning) {
            const dx = e.clientX - this.panStart.x;
            const dy = e.clientY - this.panStart.y;
            this.viewport.panX += dx;
            this.viewport.panY += dy;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.requestRender();
            return;
        }

        const worldPt = this.screenToWorld(e.clientX, e.clientY);
        if (this.isErasing) {
            this.handleEraser(worldPt, { emit: false });
            return;
        }
        if (!this.isDrawing && !this.isMovingSelection && !this.isResizingSelection && this.activeTool === "select") {
            const handle = this.hitResizeHandle(worldPt);
            if (handle) {
                this.canvas.style.cursor = `${handle}-resize`;
                return;
            }
            const hit = this.hitTest(worldPt);
            const nextHoverId = hit?.id || null;
            if (nextHoverId !== this.hoverElementId) {
                this.hoverElementId = nextHoverId;
                this.requestRender();
            }
        }

        if (this.isMovingSelection && this.moveStart) {
            const selected = this.getSelectedElement();
            if (!selected) return;
            const dx = worldPt.x - this.moveStart.pointer.x;
            const dy = worldPt.y - this.moveStart.pointer.y;
            this.moveElementTo(selected, this.moveStart.element, dx, dy);
            this.requestRender();
            return;
        }

        if (this.isResizingSelection && this.resizeStart) {
            const selected = this.getSelectedElement();
            if (!selected) return;
            this.resizeElementFromHandle(selected, this.resizeStart, worldPt, e);
            this.requestRender();
            return;
        }

        if (!this.isDrawing || !this.currentStroke) return;
        if (this.currentStroke.type === "freehand") {
            this.addPointerPointsToCurrentStroke(e);
        } else if (this.currentStroke.type === "draw_shape") {
            this.updateDraftShape(worldPt, e);
        }
        this.requestRender();
    }

    updateDraftShape(worldPt, event = {}) {
        if (!this.currentStroke || this.currentStroke.type !== "draw_shape") return;
        const shape = this.currentStroke;
        let dx = worldPt.x - this.shapeStartPt.x;
        let dy = worldPt.y - this.shapeStartPt.y;
        const isLinear = ["line", "arrow", "curve", "curve_arrow"].includes(shape.shapeType);
        const isBoxShape = ["rectangle", "diamond", "ellipse", "triangle", "star"].includes(shape.shapeType);

        if (event.shiftKey && isLinear) {
            const constrained = this.constrainLinearDelta(dx, dy);
            dx = constrained.dx;
            dy = constrained.dy;
        }

        if (event.shiftKey && isBoxShape) {
            const size = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx || 1) * size;
            dy = Math.sign(dy || 1) * size;
        }

        if (isLinear) {
            if (event.altKey) {
                shape.x = this.shapeStartPt.x - dx;
                shape.y = this.shapeStartPt.y - dy;
                shape.width = dx * 2;
                shape.height = dy * 2;
            } else {
                shape.x = this.shapeStartPt.x;
                shape.y = this.shapeStartPt.y;
                shape.width = dx;
                shape.height = dy;
            }
            return;
        }

        const left = event.altKey ? this.shapeStartPt.x - Math.abs(dx) : Math.min(this.shapeStartPt.x, this.shapeStartPt.x + dx);
        const top = event.altKey ? this.shapeStartPt.y - Math.abs(dy) : Math.min(this.shapeStartPt.y, this.shapeStartPt.y + dy);
        shape.x = left;
        shape.y = top;
        shape.width = event.altKey ? Math.abs(dx) * 2 : Math.abs(dx);
        shape.height = event.altKey ? Math.abs(dy) * 2 : Math.abs(dy);
    }

    handlePointerUp(e) {
        if (this.isPanning) {
            this.isPanning = false;
            this.releasePointer(e);
            return;
        }
        if (this.isErasing) {
            this.isErasing = false;
            this.releasePointer(e);
            this.emitChange();
            return;
        }
        if (this.isMovingSelection) {
            this.isMovingSelection = false;
            this.moveStart = null;
            this.releasePointer(e);
            this.emitChange();
            return;
        }
        if (this.isResizingSelection) {
            this.isResizingSelection = false;
            this.resizeStart = null;
            this.releasePointer(e);
            this.emitChange();
            return;
        }
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this.releasePointer(e);

        if (this.finalizeCurrentStroke()) {
            this.emitChange();
        }
    }

    handleKeyDown(e) {
        if (this.textEditor) return;
        // Typing in a form field (e.g. the properties panel) is not a whiteboard shortcut.
        const target = e.target;
        if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)) return;
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            const toolKeys = {
                v: "select",
                p: "pen",
                r: "rectangle",
                o: "ellipse",
                d: "diamond",
                l: "line",
                a: "arrow",
                h: "highlighter",
                c: "callout",
                t: "text",
                e: "eraser",
            };
            const nextTool = toolKeys[e.key.toLowerCase()];
            if (nextTool) {
                e.preventDefault();
                if (typeof window.setWhiteboardTool === "function" && ["highlighter", "callout"].includes(nextTool)) {
                    window.setWhiteboardTool(nextTool);
                } else {
                    this.setTool(nextTool);
                }
                return;
            }
        }
        if (this.options.allowPanZoom && e.code === "Space") {
            this._spaceDown = true;
            this.updateCursor();
            this.requestRender();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) this.redo();
            else this.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            this.redo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
            e.preventDefault();
            this.duplicateSelected();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
            e.preventDefault();
            this.toggleSelectedLock();
        }
        if (e.key === "[" || e.key === "]") {
            e.preventDefault();
            const delta = e.key === "]" ? 1 : -1;
            this.updateSelectedStyle({ strokeWidth: Math.max(1, (Number(this.strokeWidth) || 2) + delta) });
        }
        if (/^[1-6]$/.test(e.key) && typeof window.setWhiteboardColor === "function") {
            const swatches = ["#1f2937", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#6741d9"];
            e.preventDefault();
            window.setWhiteboardColor(swatches[Number(e.key) - 1]);
        }
        if (e.key === "Delete" || e.key === "Backspace") {
            if (this.selectedElementId) {
                e.preventDefault();
                this.deleteSelected();
            }
        }
        if (e.key === "Escape" && this.selectedElementId) {
            this.selectedElementId = null;
            this.hoverElementId = null;
            this.requestRender();
            this.emitChange();
        }
    }

    handleKeyUp(e) {
        if (this.textEditor) return;
        if (e.code === "Space") {
            this._spaceDown = false;
            this.updateCursor();
            this.requestRender();
        }
    }

    addPointerPointsToCurrentStroke(e) {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
        events.forEach(event => {
            const pt = this.screenToWorld(event.clientX, event.clientY);
            const next = this.createPoint(pt, event);
            const points = this.currentStroke.points;
            const last = points[points.length - 1];
            const minDistance = Math.max(0.35, 0.8 / this.viewport.zoom);
            if (!last || Math.hypot(next.x - last.x, next.y - last.y) >= minDistance) {
                points.push(next);
            }
        });
    }

    constrainLinearDelta(dx, dy) {
        const length = Math.hypot(dx, dy);
        if (!length) return { dx, dy };
        const step = Math.PI / 12;
        const angle = Math.round(Math.atan2(dy, dx) / step) * step;
        return { dx: Math.cos(angle) * length, dy: Math.sin(angle) * length };
    }

    createPoint(worldPt, e) {
        return {
            x: worldPt.x,
            y: worldPt.y,
            pressure: Math.max(0, Math.min(1, e.pressure || 0.5)),
            t: Date.now(),
        };
    }

    capturePointer(e) {
        if (!this.canvas || e.pointerId === undefined) return;
        try {
            this.canvas.setPointerCapture(e.pointerId);
            this.capturedPointerId = e.pointerId;
        } catch (_err) {
            this.capturedPointerId = e.pointerId;
        }
    }

    releasePointer(e) {
        if (this.canvas && e.pointerId === this.capturedPointerId) {
            try {
                this.canvas.releasePointerCapture(e.pointerId);
            } catch (_err) {}
        }
        this.capturedPointerId = null;
    }

    handleWheel(e) {
        if (!this.options.allowPanZoom) return;
        e.preventDefault();
        const zoomFactor = 1.08;
        const targetZoom = e.deltaY < 0 ? this.viewport.zoom * zoomFactor : this.viewport.zoom / zoomFactor;
        const finalZoom = Math.max(0.15, Math.min(targetZoom, 6.0));
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        const mouseWorld = {
            x: (canvasX - this.viewport.panX) / this.viewport.zoom,
            y: (canvasY - this.viewport.panY) / this.viewport.zoom,
        };
        this.viewport.zoom = finalZoom;
        this.viewport.panX = canvasX - mouseWorld.x * finalZoom;
        this.viewport.panY = canvasY - mouseWorld.y * finalZoom;
        this.requestRender();
    }

    handleEraser(worldPt, options = {}) {
        const eraserRadius = 24 / this.viewport.zoom;
        const before = this.elements.length;
        this.elements = this.elements.filter(el => !this.elementIntersectsPoint(el, worldPt, eraserRadius));
        if (!this.elements.some(el => el.id === this.selectedElementId)) this.selectedElementId = null;
        this.requestRender();
        if (options.emit !== false && before !== this.elements.length) this.emitChange();
    }

    hitTest(point) {
        for (let i = this.elements.length - 1; i >= 0; i -= 1) {
            const el = this.elements[i];
            if (this.elementIntersectsPoint(el, point, 8 / this.viewport.zoom)) return el;
        }
        return null;
    }

    distanceToSegment(point, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (!dx && !dy) return Math.hypot(point.x - a.x, point.y - a.y);
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        return Math.hypot(point.x - px, point.y - py);
    }

    distanceToPolyline(point, points = []) {
        if (!points.length) return Infinity;
        if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
        let min = Infinity;
        for (let i = 1; i < points.length; i += 1) {
            min = Math.min(min, this.distanceToSegment(point, points[i - 1], points[i]));
        }
        return min;
    }

    pointInPolygon(point, points = []) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
            const pi = points[i];
            const pj = points[j];
            const dy = pj.y - pi.y || 0.0001;
            const intersects = pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / dy + pi.x;
            if (intersects) inside = !inside;
        }
        return inside;
    }

    getShapePoints(el) {
        const x = Number(el.x) || 0;
        const y = Number(el.y) || 0;
        const w = Number(el.width) || 0;
        const h = Number(el.height) || 0;
        if (el.shapeType === "diamond") {
            return [
                { x: x + w / 2, y },
                { x: x + w, y: y + h / 2 },
                { x: x + w / 2, y: y + h },
                { x, y: y + h / 2 },
            ];
        }
        if (el.shapeType === "triangle") {
            return [
                { x: x + w / 2, y },
                { x: x + w, y: y + h },
                { x, y: y + h },
            ];
        }
        if (el.shapeType === "star") {
            const cx = x + w / 2;
            const cy = y + h / 2;
            const outer = Math.min(Math.abs(w), Math.abs(h)) / 2;
            const inner = outer * 0.382;
            return Array.from({ length: 10 }, (_, index) => {
                const radius = index % 2 === 0 ? outer : inner;
                const angle = (Math.PI * 2 * index) / 10 - Math.PI / 2;
                return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
            });
        }
        return [];
    }

    getCurveSamplePoints(el, steps = 18) {
        const x1 = Number(el.x) || 0;
        const y1 = Number(el.y) || 0;
        const x2 = x1 + (Number(el.width) || 0);
        const y2 = y1 + (Number(el.height) || 0);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(1, Math.hypot(dx, dy));
        const cx = (x1 + x2) / 2 - (dy / length) * length * 0.25;
        const cy = (y1 + y2) / 2 + (dx / length) * length * 0.25;
        return Array.from({ length: steps + 1 }, (_, index) => {
            const t = index / steps;
            const mt = 1 - t;
            return {
                x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
                y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2,
            };
        });
    }

    getSelectionHandles(el = this.getSelectedElement()) {
        const b = this.getElementBounds(el);
        if (!b) return [];
        const pad = 6 / this.viewport.zoom;
        const x1 = b.x - pad;
        const y1 = b.y - pad;
        const x2 = b.x + b.width + pad;
        const y2 = b.y + b.height + pad;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        return [
            { id: "nw", x: x1, y: y1 },
            { id: "n", x: cx, y: y1 },
            { id: "ne", x: x2, y: y1 },
            { id: "e", x: x2, y: cy },
            { id: "se", x: x2, y: y2 },
            { id: "s", x: cx, y: y2 },
            { id: "sw", x: x1, y: y2 },
            { id: "w", x: x1, y: cy },
        ];
    }

    hitResizeHandle(point) {
        const selected = this.getSelectedElement();
        if (!selected) return null;
        const radius = 8 / this.viewport.zoom;
        const handle = this.getSelectionHandles(selected).find(h => Math.hypot(point.x - h.x, point.y - h.y) <= radius);
        return handle?.id || null;
    }

    resizeElementFromHandle(el, resizeStart, worldPt, event) {
        const bounds = resizeStart.bounds;
        if (!bounds) return;
        const minSize = 8;
        let left = bounds.x;
        let right = bounds.x + bounds.width;
        let top = bounds.y;
        let bottom = bounds.y + bounds.height;
        const handle = resizeStart.handle;
        if (handle.includes("w")) left = worldPt.x;
        if (handle.includes("e")) right = worldPt.x;
        if (handle.includes("n")) top = worldPt.y;
        if (handle.includes("s")) bottom = worldPt.y;
        if (event.shiftKey) {
            const size = Math.max(Math.abs(right - left), Math.abs(bottom - top), minSize);
            if (handle.includes("w")) left = right - size;
            else right = left + size;
            if (handle.includes("n")) top = bottom - size;
            else bottom = top + size;
        }
        if (Math.abs(right - left) < minSize) {
            if (handle.includes("w")) left = right - minSize;
            else right = left + minSize;
        }
        if (Math.abs(bottom - top) < minSize) {
            if (handle.includes("n")) top = bottom - minSize;
            else bottom = top + minSize;
        }
        const nextBounds = {
            x: Math.min(left, right),
            y: Math.min(top, bottom),
            width: Math.abs(right - left),
            height: Math.abs(bottom - top),
        };
        this.applyElementBounds(el, resizeStart.element, bounds, nextBounds);
    }

    applyElementBounds(el, startEl, startBounds, nextBounds) {
        const sx = nextBounds.width / Math.max(1, startBounds.width);
        const sy = nextBounds.height / Math.max(1, startBounds.height);
        if (el.type === "freehand") {
            el.points = (startEl.points || []).map(p => ({
                ...p,
                x: nextBounds.x + (p.x - startBounds.x) * sx,
                y: nextBounds.y + (p.y - startBounds.y) * sy,
            }));
            return;
        }
        if (el.type === "draw_shape") {
            const relX = startEl.x - startBounds.x;
            const relY = startEl.y - startBounds.y;
            el.x = nextBounds.x + relX * sx;
            el.y = nextBounds.y + relY * sy;
            el.width = startEl.width * sx;
            el.height = startEl.height * sy;
            return;
        }
        if (el.type === "text") {
            el.x = nextBounds.x + (startEl.x - startBounds.x) * sx;
            el.y = nextBounds.y + (startEl.y - startBounds.y) * sy;
            el.fontSize = Math.max(8, (startEl.fontSize || this.fontSize) * Math.max(sx, sy));
        }
    }

    elementIntersectsPoint(el, point, tolerance = 8) {
        const b = this.getElementBounds(el);
        if (!b) return false;
        if (point.x < b.x - tolerance || point.x > b.x + b.width + tolerance || point.y < b.y - tolerance || point.y > b.y + b.height + tolerance) {
            return false;
        }
        const strokeTolerance = tolerance + Math.max(1, Number(el.strokeWidth) || 2);
        if (el.type === "freehand") {
            return this.distanceToPolyline(point, el.points || []) <= strokeTolerance;
        }
        if (el.type === "text") return true;
        if (el.type !== "draw_shape") return true;
        const x = Number(el.x) || 0;
        const y = Number(el.y) || 0;
        const w = Number(el.width) || 0;
        const h = Number(el.height) || 0;
        if (["line", "arrow"].includes(el.shapeType)) {
            return this.distanceToSegment(point, { x, y }, { x: x + w, y: y + h }) <= strokeTolerance;
        }
        if (["curve", "curve_arrow"].includes(el.shapeType)) {
            return this.distanceToPolyline(point, this.getCurveSamplePoints(el)) <= strokeTolerance;
        }
        const hasVisibleFill = el.fillStyle !== "none" && el.backgroundColor && el.backgroundColor !== "transparent";
        if (el.shapeType === "ellipse") {
            const rx = Math.max(0.001, Math.abs(w / 2));
            const ry = Math.max(0.001, Math.abs(h / 2));
            const cx = x + w / 2;
            const cy = y + h / 2;
            const normalized = ((point.x - cx) ** 2) / (rx ** 2) + ((point.y - cy) ** 2) / (ry ** 2);
            if (hasVisibleFill && normalized <= 1) return true;
            const edgeDistance = Math.abs(Math.sqrt(normalized) - 1) * Math.min(rx, ry);
            return edgeDistance <= strokeTolerance;
        }
        if (el.shapeType === "rectangle") {
            if (hasVisibleFill) return true;
            const left = Math.min(x, x + w);
            const right = Math.max(x, x + w);
            const top = Math.min(y, y + h);
            const bottom = Math.max(y, y + h);
            const edgeDistance = Math.min(Math.abs(point.x - left), Math.abs(point.x - right), Math.abs(point.y - top), Math.abs(point.y - bottom));
            return edgeDistance <= strokeTolerance;
        }
        const polygon = this.getShapePoints(el);
        if (polygon.length) {
            if (hasVisibleFill && this.pointInPolygon(point, polygon)) return true;
            return this.distanceToPolyline(point, [...polygon, polygon[0]]) <= strokeTolerance;
        }
        return true;
    }

    getElementBounds(el) {
        if (!el) return null;
        if (el.type === "freehand") {
            const points = el.points || [];
            if (!points.length) return null;
            const xs = points.map(p => p.x);
            const ys = points.map(p => p.y);
            const pad = (el.strokeWidth || 2) + 8;
            const minX = Math.min(...xs) - pad;
            const minY = Math.min(...ys) - pad;
            return { x: minX, y: minY, width: Math.max(...xs) - Math.min(...xs) + pad * 2, height: Math.max(...ys) - Math.min(...ys) + pad * 2 };
        }
        if (el.type === "text") {
            const lines = String(el.text || "").split("\n");
            const width = Math.max(...lines.map(line => line.length), 1) * (el.fontSize || 22) * 0.6;
            const height = lines.length * (el.fontSize || 22) * 1.25;
            const pad = Math.max(8, (el.fontSize || 22) * 0.2);
            return { x: el.x - pad, y: el.y - height * 0.85 - pad, width: width + pad * 2, height: height + pad * 2 };
        }
        if (el.type === "draw_shape") {
            const x2 = el.x + el.width;
            const y2 = el.y + el.height;
            const strokePad = (Number(el.strokeWidth) || 2) / 2;
            const roughPad = Math.max(4, (Number(el.roughness) || 1.4) * 6);
            const arrowPad = ["arrow", "curve_arrow"].includes(el.shapeType) ? 12 + (Number(el.strokeWidth) || 2) * 2.4 : 0;
            const curvePad = ["curve", "curve_arrow"].includes(el.shapeType) ? Math.hypot(Number(el.width) || 0, Number(el.height) || 0) * 0.28 : 0;
            const pad = Math.ceil(strokePad + roughPad + arrowPad + curvePad);
            return {
                x: Math.min(el.x, x2) - pad,
                y: Math.min(el.y, y2) - pad,
                width: Math.abs(el.width) + pad * 2,
                height: Math.abs(el.height) + pad * 2,
            };
        }
        return null;
    }

    startTextEditor(worldPt, event) {
        this.commitActiveTextEditor();
        const rect = this.canvas.getBoundingClientRect();
        const editor = document.createElement("textarea");
        editor.className = "whiteboard-text-editor";
        editor.placeholder = "Text";
        editor.rows = 1;
        editor.style.left = `${event.clientX - rect.left}px`;
        editor.style.top = `${event.clientY - rect.top}px`;
        editor.style.font = `${this.fontSize}px ${this.fontFamily}`;
        editor.style.color = this.strokeColor || "#1f2937";
        editor.style.minWidth = "120px";
        editor.style.minHeight = `${Math.ceil(this.fontSize * 1.45)}px`;
        editor.style.lineHeight = "1.25";

        const stopEvent = e => e.stopPropagation();
        const resizeEditor = () => {
            editor.style.height = "auto";
            editor.style.height = `${Math.max(this.fontSize * 1.45, editor.scrollHeight)}px`;
            editor.style.width = `${Math.min(Math.max(120, editor.scrollWidth + 8), Math.max(120, rect.width - (event.clientX - rect.left) - 12))}px`;
        };
        editor.addEventListener("pointerdown", stopEvent);
        editor.addEventListener("pointermove", stopEvent);
        editor.addEventListener("keydown", e => {
            e.stopPropagation();
            if (e.key === "Escape") {
                e.preventDefault();
                this.cancelActiveTextEditor();
            } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.commitActiveTextEditor();
            }
        });
        editor.addEventListener("input", resizeEditor);
        const commitOnBlur = () => this.commitActiveTextEditor();
        editor.addEventListener("blur", commitOnBlur);

        this.canvas.parentElement?.appendChild(editor);
        this.textEditor = { editor, worldPt: { ...worldPt }, commitOnBlur };
        requestAnimationFrame(() => {
            editor.focus();
            resizeEditor();
        });
    }

    commitActiveTextEditor() {
        if (!this.textEditor) return;
        const { editor, worldPt } = this.textEditor;
        this.textEditor = null;
        const text = editor.value.trim();
        editor.remove();
        if (!text) return;
        this.history.pushState(this.elements);
        const element = this.createBaseElement("text", {
            x: worldPt.x,
            y: worldPt.y + this.fontSize,
            text,
            fontSize: this.fontSize,
            fontFamily: this.fontFamily,
            backgroundColor: "transparent",
            fillStyle: "solid",
        });
        this.elements.push(element);
        this.selectedElementId = element.id;
        this.requestRender();
        this.emitChange();
    }

    cancelActiveTextEditor() {
        if (!this.textEditor) return;
        // Removing the focused textarea fires "blur"; detach that listener first so cancelling does not commit.
        const { editor, commitOnBlur } = this.textEditor;
        this.textEditor = null;
        editor.removeEventListener("blur", commitOnBlur);
        editor.remove();
    }

    finalizeCurrentStroke() {
        if (!this.currentStroke) return false;
        let didAdd = false;
        if (this.currentStroke.type === "freehand") {
            if (this.currentStroke.points.length >= 2) {
                this.currentStroke.points = PathSimplifier.simplifyRDP(this.currentStroke.points, 0.9);
                this.currentStroke.points = StrokeRenderer.generateSplinePoints(this.currentStroke.points, 4);
                this.elements.push(this.currentStroke);
                this.selectedElementId = this.currentStroke.id;
                didAdd = true;
            }
        } else if (this.currentStroke.type === "draw_shape") {
            const rawWidth = Math.abs(Number(this.currentStroke.width) || 0);
            const rawHeight = Math.abs(Number(this.currentStroke.height) || 0);
            if (rawWidth > 3 || rawHeight > 3) {
                this.elements.push(this.currentStroke);
                this.selectedElementId = this.currentStroke.id;
                didAdd = true;
            }
        }
        this.currentStroke = null;
        this.isDrawing = false;
        this.requestRender();
        return didAdd;
    }

    moveElementTo(el, startEl, dx, dy) {
        if (el.type === "freehand") {
            el.points = (startEl.points || []).map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
        } else {
            el.x = startEl.x + dx;
            el.y = startEl.y + dy;
        }
    }

    bringForward() {
        this.moveSelectedLayer(1);
    }

    sendBackward() {
        this.moveSelectedLayer(-1);
    }

    bringToFront() {
        this.moveSelectedLayer(Infinity);
    }

    sendToBack() {
        this.moveSelectedLayer(-Infinity);
    }

    moveSelectedLayer(delta) {
        const index = this.elements.findIndex(el => el.id === this.selectedElementId);
        if (index < 0) return;
        this.history.pushState(this.elements);
        const [item] = this.elements.splice(index, 1);
        let nextIndex = delta === Infinity ? this.elements.length : delta === -Infinity ? 0 : Math.max(0, Math.min(this.elements.length, index + delta));
        this.elements.splice(nextIndex, 0, item);
        this.requestRender();
        this.emitChange();
    }

    duplicateSelected() {
        const selected = this.getSelectedElement();
        if (!selected || selected.locked) return;
        this.history.pushState(this.elements);
        const copy = JSON.parse(JSON.stringify(selected));
        copy.id = `${selected.id}_copy_${Date.now()}`;
        copy.seed = Math.floor(Math.random() * 1000000000);
        this.moveElementTo(copy, copy, 24, 24);
        this.elements.push(copy);
        this.selectedElementId = copy.id;
        this.requestRender();
        this.emitChange();
    }

    toggleSelectedLock() {
        const selected = this.getSelectedElement();
        if (!selected || selected.locked) return;
        this.history.pushState(this.elements);
        selected.locked = !selected.locked;
        this.requestRender();
        this.emitChange();
    }

    deleteSelected() {
        if (!this.selectedElementId) return;
        const selected = this.getSelectedElement();
        if (selected?.locked) return;
        this.history.pushState(this.elements);
        this.elements = this.elements.filter(el => el.id !== this.selectedElementId);
        this.selectedElementId = null;
        this.hoverElementId = null;
        this.requestRender();
        this.emitChange();
    }

    undo() {
        const prev = this.history.undo(this.elements);
        if (prev) {
            this.elements = prev;
            this.selectedElementId = null;
            this.hoverElementId = null;
            this.requestRender();
            this.emitChange();
        }
    }

    redo() {
        const next = this.history.redo(this.elements);
        if (next) {
            this.elements = next;
            this.selectedElementId = null;
            this.hoverElementId = null;
            this.requestRender();
            this.emitChange();
        }
    }

    clear() {
        this.history.pushState(this.elements);
        this.elements = [];
        this.selectedElementId = null;
        this.hoverElementId = null;
        this.requestRender();
        this.emitChange();
    }

    emitChange() {
        this.requestRender();
        window.dispatchEvent(new CustomEvent("slideforge:whiteboard-change", { detail: { engine: this } }));
    }

    updateCursor() {
        if (!this.canvas) return;
        if (this.isPanning || (this.options.allowPanZoom && this._spaceDown)) this.canvas.style.cursor = "grab";
        else if (this.isMovingSelection) this.canvas.style.cursor = "grabbing";
        else if (this.isResizingSelection) this.canvas.style.cursor = "nwse-resize";
        else if (this.isErasing) this.canvas.style.cursor = "cell";
        else if (this.activeTool === "select") this.canvas.style.cursor = "default";
        else if (this.activeTool === "eraser") this.canvas.style.cursor = "cell";
        else if (this.activeTool === "pan") this.canvas.style.cursor = "grab";
        else this.canvas.style.cursor = "crosshair";
    }

    startRenderLoop() {
        if (this._renderLoopStarted) return;
        this._renderLoopStarted = true;
        const render = () => {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const nextW = Math.max(1, Math.round(rect.width * dpr));
            const nextH = Math.max(1, Math.round(rect.height * dpr));
            if (this.canvas.width !== nextW || this.canvas.height !== nextH) {
                this.canvas.width = nextW;
                this.canvas.height = nextH;
                this.requestRender();
            }
            this.updateCursor();
            if (!this._needsRender) {
                requestAnimationFrame(render);
                return;
            }
            this._needsRender = false;
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.ctx.clearRect(0, 0, rect.width, rect.height);
            this.ctx.save();
            this.ctx.translate(this.viewport.panX, this.viewport.panY);
            this.ctx.scale(this.viewport.zoom, this.viewport.zoom);
            if (this.options.showGrid) this.renderGrid(rect.width, rect.height);
            this.elements.forEach(el => this.renderElement(el));
            if (this.currentStroke) this.renderElement(this.currentStroke);
            const hover = this.elements.find(el => el.id === this.hoverElementId && el.id !== this.selectedElementId);
            if (hover) this.renderSelection(hover, { hover: true });
            const selected = this.getSelectedElement();
            if (selected) this.renderSelection(selected);
            this.ctx.restore();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    renderGrid(width, height) {
        this.ctx.fillStyle = "#d6d9e0";
        const gridSize = 40;
        const leftTop = this.screenToWorld(0, 0);
        const rightBottom = this.screenToWorld(width, height);
        const startX = Math.floor(leftTop.x / gridSize) * gridSize;
        const endX = Math.ceil(rightBottom.x / gridSize) * gridSize;
        const startY = Math.floor(leftTop.y / gridSize) * gridSize;
        const endY = Math.ceil(rightBottom.y / gridSize) * gridSize;
        this.ctx.beginPath();
        for (let x = startX; x <= endX; x += gridSize) {
            for (let y = startY; y <= endY; y += gridSize) {
                this.ctx.rect(x - 0.75, y - 0.75, 1.5, 1.5);
            }
        }
        this.ctx.fill();
    }

    getRenderStyle(el) {
        return {
            ...el,
            random: RoughRenderer.seededRandom(el.seed || 1),
            fillOpacity: el.fillStyle === "solid" ? 0.58 : 0.35,
        };
    }

    renderElement(el) {
        this.ctx.save();
        this.ctx.globalAlpha *= el.opacity ?? 1;
        if (el.type === "freehand") {
            StrokeRenderer.drawInkStroke(this.ctx, el.points, el.strokeColor, el.strokeWidth);
        } else if (el.type === "text") {
            this.ctx.font = `${el.fontSize || 22}px ${el.fontFamily || this.fontFamily}`;
            this.ctx.fillStyle = el.strokeColor || "#1f2937";
            this.ctx.textBaseline = "alphabetic";
            String(el.text || "").split("\n").forEach((line, index) => {
                this.ctx.fillText(line, el.x, el.y + index * (el.fontSize || 22) * 1.25);
            });
        } else if (el.type === "draw_shape") {
            const style = this.getRenderStyle(el);
            if (el.shapeType === "rectangle") RoughRenderer.drawRoughRect(this.ctx, el.x, el.y, el.width, el.height, style);
            else if (el.shapeType === "diamond") RoughRenderer.drawRoughDiamond(this.ctx, el.x, el.y, el.width, el.height, style);
            else if (el.shapeType === "ellipse") RoughRenderer.drawRoughEllipse(this.ctx, el.x + el.width / 2, el.y + el.height / 2, Math.abs(el.width / 2), Math.abs(el.height / 2), style);
            else if (el.shapeType === "triangle") RoughRenderer.drawRoughTriangle(this.ctx, el.x, el.y, el.width, el.height, style);
            else if (el.shapeType === "star") RoughRenderer.drawRoughStar(this.ctx, el.x, el.y, el.width, el.height, style);
            else if (el.shapeType === "line") RoughRenderer.drawRoughLine(this.ctx, el.x, el.y, el.x + el.width, el.y + el.height, style);
            else if (el.shapeType === "arrow") RoughRenderer.drawRoughArrow(this.ctx, el.x, el.y, el.x + el.width, el.y + el.height, style);
            else if (el.shapeType === "curve") RoughRenderer.drawRoughCurve(this.ctx, el.x, el.y, el.x + el.width, el.y + el.height, style);
            else if (el.shapeType === "curve_arrow") RoughRenderer.drawRoughCurveArrow(this.ctx, el.x, el.y, el.x + el.width, el.y + el.height, style);
        }
        this.ctx.restore();
    }

    renderSelection(el, options = {}) {
        const b = this.getElementBounds(el);
        if (!b) return;
        const pad = 6 / this.viewport.zoom;
        this.ctx.save();
        this.ctx.strokeStyle = options.hover ? "rgba(99, 102, 241, 0.45)" : "#a5b4fc";
        this.ctx.lineWidth = (options.hover ? 1 : 1.5) / this.viewport.zoom;
        this.ctx.setLineDash(options.hover ? [4 / this.viewport.zoom, 4 / this.viewport.zoom] : [8 / this.viewport.zoom, 6 / this.viewport.zoom]);
        this.ctx.strokeRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
        if (options.hover) {
            this.ctx.restore();
            return;
        }
        this.ctx.setLineDash([]);
        this.ctx.fillStyle = "#ffffff";
        this.ctx.strokeStyle = "#6366f1";
        const size = 8 / this.viewport.zoom;
        this.getSelectionHandles(el).forEach(({ x, y }) => {
            this.ctx.beginPath();
            this.ctx.rect(x - size / 2, y - size / 2, size, size);
            this.ctx.fill();
            this.ctx.stroke();
        });
        this.ctx.restore();
    }
}
