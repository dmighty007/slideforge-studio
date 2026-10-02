/**
 * SIMPLIFIED CROP SYSTEM (Fixed Math)
 * This system allows trimming the image edges while keeping the content stable.
 */

class SimpleCrop {
    constructor(elementId) {
        this.elementId = elementId;
        this.elData = state.slides[currentSlideIndex].elements.find(e => e.id === elementId);
        if (!this.elData || this.elData.type !== "image") return;

        this.originalEl = document.getElementById(this.elementId);
        if (!this.originalEl) return;

        // Save full element state for cancellation and undo.
        this.initialElementState = JSON.parse(JSON.stringify(this.elData));
        this.hasRecordedUndo = false;

        const img = new Image();
        img.src = this.elData.content;
        const init = () => {
            this.naturalW = img.naturalWidth || 1000;
            this.naturalH = img.naturalHeight || 1000;
            this.naturalRatio = this.naturalW / this.naturalH;

            this.width = parseFloat(this.elData.width);
            this.height = parseFloat(this.elData.height);
            this.x = parseFloat(this.elData.x);
            this.y = parseFloat(this.elData.y);

            // Calculate current internal image size in pixels
            if (this.elData.cropTransform) {
                this.imgW = (this.elData.cropTransform.widthPercent / 100) * this.width;
                this.imgH = (this.elData.cropTransform.heightPercent / 100) * this.height;
                this.imgL = (this.elData.cropTransform.leftPercent / 100) * this.width;
                this.imgT = (this.elData.cropTransform.topPercent / 100) * this.height;
            } else {
                // Default: simulate 'object-fit: cover' centering
                const scale = Math.max(this.width / this.naturalW, this.height / this.naturalH);
                this.imgW = this.naturalW * scale;
                this.imgH = this.naturalH * scale;
                this.imgL = (this.width - this.imgW) / 2;
                this.imgT = (this.height - this.imgH) / 2;
                this.writeCropTransform(this.width, this.height, this.imgW, this.imgH, this.imgL, this.imgT);
            }

            this.buildUI();
            this.setupInteractions();

            const bound = document.getElementById("group-bound");
            if (bound) bound.classList.add("hidden");
        };

        if (img.complete) init(); else img.onload = init;
    }

    buildUI() {
        this.overlay = document.createElement("div");
        this.overlay.className = "crop-simple-overlay";
        this.overlay.style.cssText = "position:absolute; inset:0; background:rgba(15,23,42,0.36); z-index:10000; cursor:crosshair;";

        this.cropBox = document.createElement("div");
        this.cropBox.style.cssText = "position:absolute; border:2px solid #fbbf24; box-shadow:0 0 0 9999px rgba(0,0,0,0.48); cursor:move; z-index:10001;";

        const handleStyle = "position:absolute; width:14px; height:14px; background:#fbbf24; border:2px solid #0f172a; border-radius:3px; box-shadow:0 1px 4px rgba(0,0,0,0.35);";
        const positions = [
            { id: "tl", css: "top:-6px; left:-6px; cursor:nwse-resize;" },
            { id: "tr", css: "top:-6px; right:-6px; cursor:nesw-resize;" },
            { id: "bl", css: "bottom:-6px; left:-6px; cursor:nesw-resize;" },
            { id: "br", css: "bottom:-6px; right:-6px; cursor:nwse-resize;" },
            { id: "tc", css: "top:-6px; left:50%; margin-left:-6px; cursor:ns-resize;" },
            { id: "bc", css: "bottom:-6px; left:50%; margin-left:-6px; cursor:ns-resize;" },
            { id: "lc", css: "left:-6px; top:50%; margin-top:-6px; cursor:ew-resize;" },
            { id: "rc", css: "right:-6px; top:50%; margin-top:-6px; cursor:ew-resize;" }
        ];

        positions.forEach(p => {
            const h = document.createElement("div");
            h.className = "crop-simple-handle";
            h.dataset.id = p.id;
            h.style.cssText = handleStyle + p.css;
            this.cropBox.appendChild(h);
        });

        const hint = document.createElement("div");
        hint.textContent = "Drag edges to crop. Enter applies, Esc cancels.";
        hint.style.cssText = "position:absolute;left:0;bottom:-34px;white-space:nowrap;padding:5px 8px;border-radius:6px;background:#0f172a;color:#f8fafc;font:600 12px/1.2 Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,0.24);";
        this.cropBox.appendChild(hint);

        this.overlay.appendChild(this.cropBox);
        const section = document.querySelector(".reveal .slides section.present") || document.getElementById("slides-container");
        section.appendChild(this.overlay);

        this.applyPreviewDOM();
        this.updateDOM();
    }

    updateDOM() {
        // Since this.cropBox is a child of the slide section,
        // we can use logical coordinates directly.
        this.cropBox.style.left = typeof this.elData.x === "number" ? `${this.elData.x}px` : this.elData.x;
        this.cropBox.style.top = typeof this.elData.y === "number" ? `${this.elData.y}px` : this.elData.y;
        this.cropBox.style.width = this.elData.width;
        this.cropBox.style.height = this.elData.height;
    }

    applyPreviewDOM() {
        const el = document.getElementById(this.elementId);
        if (!el) return;
        el.style.transform = canvasElementTransform(this.elData);
        el.style.width = this.elData.width;
        el.style.height = this.elData.height;
        el.setAttribute("data-x", parseFloat(this.elData.x) || 0);
        el.setAttribute("data-y", parseFloat(this.elData.y) || 0);

        let wrapper = el.querySelector(":scope > .crop-live-preview");
        if (!wrapper) {
            Array.from(el.children).forEach(child => {
                if (
                    child.classList.contains("resize-handle")
                    || child.classList.contains("anim-badge")
                    || child.classList.contains("crop-live-preview")
                ) return;
                child.remove();
            });
            wrapper = document.createElement("div");
            wrapper.className = "crop-live-preview w-full h-full rounded-[inherit]";
            wrapper.style.overflow = "hidden";
            wrapper.style.position = "relative";
            const img = document.createElement("img");
            img.src = this.elData.content;
            img.draggable = false;
            img.style.position = "absolute";
            img.style.maxWidth = "none";
            img.style.maxHeight = "none";
            img.style.objectFit = "fill";
            img.style.display = "block";
            img.style.setProperty("margin", "0", "important");
            img.style.pointerEvents = "none";
            wrapper.appendChild(img);
            const firstHandle = Array.from(el.children).find(child => child.classList.contains("resize-handle"));
            el.insertBefore(wrapper, firstHandle || null);
        }

        const img = wrapper.querySelector("img");
        const crop =
            typeof normalizeImageCropTransform === "function"
                ? normalizeImageCropTransform(this.elData.cropTransform)
                : this.elData.cropTransform;
        if (img && crop) {
            this.elData.cropTransform = crop;
            img.style.left = `${crop.leftPercent}%`;
            img.style.top = `${crop.topPercent}%`;
            img.style.width = `${crop.widthPercent}%`;
            img.style.height = `${crop.heightPercent}%`;
        }
    }

    writeCropTransform(w, h, imgW, imgH, imgL, imgT) {
        const crop = {
            widthPercent: (imgW / w) * 100,
            heightPercent: (imgH / h) * 100,
            leftPercent: (imgL / w) * 100,
            topPercent: (imgT / h) * 100,
        };
        this.elData.cropTransform =
            typeof normalizeImageCropTransform === "function"
                ? normalizeImageCropTransform(crop)
                : crop;
        this.elData.heightSetManually = true;
        this.elData.imageAspectRatio = w / Math.max(1, h);
    }

    setupInteractions() {
        this.onMouseDown = this.handleMouseDown.bind(this);
        this.onMouseMove = this.handleMouseMove.bind(this);
        this.onMouseUp = this.handleMouseUp.bind(this);
        this.onKeyDown = this.handleKeyDown.bind(this);

        this.cropBox.addEventListener("mousedown", this.onMouseDown);
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.onMouseUp);
        document.addEventListener("keydown", this.onKeyDown, true);
    }

    handleMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!this.hasRecordedUndo && window.saveStateToUndo) {
            window.saveStateToUndo();
            this.hasRecordedUndo = true;
        }
        if (e.target.classList.contains("crop-simple-handle")) {
            this.activeHandle = e.target.dataset.id;
        } else {
            this.isDraggingBox = true;
        }
        this.startX = e.clientX;
        this.startY = e.clientY;

        // Calculate current pixels from state
        const curW = parseFloat(this.elData.width);
        const curH = parseFloat(this.elData.height);

        let imgW, imgH, imgL, imgT;
        if (this.elData.cropTransform) {
            imgW = (this.elData.cropTransform.widthPercent / 100) * curW;
            imgH = imgW / this.naturalRatio; // Force ratio
            imgL = (this.elData.cropTransform.leftPercent / 100) * curW;
            imgT = (this.elData.cropTransform.topPercent / 100) * curH;
        } else {
            const scale = Math.max(curW / this.naturalW, curH / this.naturalH);
            imgW = this.naturalW * scale;
            imgH = this.naturalH * scale;
            imgL = (curW - imgW) / 2;
            imgT = (curH - imgH) / 2;
        }

        this.s = { x: parseFloat(this.elData.x), y: parseFloat(this.elData.y), w: curW, h: curH, imgW, imgH, imgL, imgT };
    }

    handleMouseMove(e) {
        if (!this.activeHandle && !this.isDraggingBox) return;
        e.preventDefault();

        const scale = typeof getCanvasScale === "function" ? getCanvasScale() : 1;
        const dx = (e.clientX - this.startX) / scale;
        const dy = (e.clientY - this.startY) / scale;

        let { x, y, w, h, imgW, imgH, imgL, imgT } = this.s;

        if (this.activeHandle) {
            if (this.activeHandle.includes("l")) {
                const nextW = Math.max(20, this.s.w - dx);
                const applied = this.s.w - nextW;
                x = this.s.x + applied;
                w = nextW;
                imgL = this.s.imgL - applied;
            }
            if (this.activeHandle.includes("r")) {
                w = Math.max(20, this.s.w + dx);
            }
            if (this.activeHandle.includes("t")) {
                const nextH = Math.max(20, this.s.h - dy);
                const applied = this.s.h - nextH;
                y = this.s.y + applied;
                h = nextH;
                imgT = this.s.imgT - applied;
            }
            if (this.activeHandle.includes("b")) {
                h = Math.max(20, this.s.h + dy);
            }

            // Update container state
            this.elData.x = x;
            this.elData.y = y;
            this.elData.width = `${w}px`;
            this.elData.height = `${h}px`;

            // Recalculate imgH from imgW to ensure ZERO distortion
            const currentImgH = imgW / this.naturalRatio;
            this.writeCropTransform(w, h, imgW, currentImgH, imgL, imgT);
        } else if (this.isDraggingBox) {
            this.elData.x = x + dx;
            this.elData.y = y + dy;
        }

        this.applyPreviewDOM();
        this.updateDOM();
    }

    handleMouseUp() {
        if (this.activeHandle || this.isDraggingBox) {
            updateElementState?.(this.elementId, {
                x: this.elData.x,
                y: this.elData.y,
                width: this.elData.width,
                height: this.elData.height,
                cropTransform: this.elData.cropTransform,
                heightSetManually: true,
                imageAspectRatio: this.elData.imageAspectRatio,
            });
            if (window.updateGroupBound) window.updateGroupBound();
            if (typeof schedulePresentationAutosave === "function") schedulePresentationAutosave();
        }
        this.activeHandle = null;
        this.isDraggingBox = false;
    }

    handleKeyDown(e) {
        if (e.key === "Enter") {
            e.stopPropagation();
            this.confirm();
        } else if (e.key === "Escape") {
            e.stopPropagation();
            this.cancel();
        }
    }

    confirm() {
        this.cleanup();
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        if (window.updateGroupBound) window.updateGroupBound();
        if (window.buildPropertiesPanel) window.buildPropertiesPanel();
    }

    cancel() {
        this.cleanup();
        const slide = state.slides[currentSlideIndex];
        const elementIndex = slide?.elements?.findIndex(e => e.id === this.elementId) ?? -1;
        if (elementIndex >= 0) {
            slide.elements[elementIndex] = JSON.parse(JSON.stringify(this.initialElementState));
            this.elData = slide.elements[elementIndex];
        }
        if (window.renderSlidesFromState) window.renderSlidesFromState();
        if (window.updateGroupBound) window.updateGroupBound();
        if (window.buildPropertiesPanel) window.buildPropertiesPanel();
    }

    cleanup() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
        document.removeEventListener("keydown", this.onKeyDown, true);
        window._activeCropSession = null;
    }
}

window.enterCropMode = function(id) {
    if (window._activeCropSession) window._activeCropSession.confirm();
    window._activeCropSession = new SimpleCrop(id);
};
