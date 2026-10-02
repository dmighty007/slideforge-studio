/**
 * Modern Animation Engine
 * GSAP-inspired timeline-based animation system for slide objects
 */

class AnimationEngine {
    constructor() {
        this.timelines = new Map();
        this.activeAnimations = new Map();
        this.playheadTime = 0;
        this.isPlaying = false;
        this.animationFrameId = null;
        this.lastFrameTime = 0;
        this.speed = 1;
        this.onUpdate = null;
        this.onComplete = null;
        this.elementSnapshots = new Map();
    }

    /**
     * Create or get animation timeline for element
     */
    getTimeline(elementId) {
        if (!this.timelines.has(elementId)) {
            this.timelines.set(elementId, {
                elementId,
                animations: [],
                currentFrame: 0,
            });
        }
        return this.timelines.get(elementId);
    }

    /**
     * Add animation to element timeline
     */
    addAnimation(elementId, animation, startTime = 0) {
        if (!elementId || !animation) return;

        const timeline = this.getTimeline(elementId);
        timeline.animations.push({
            ...animation,
            startTime: Math.max(0, Number(startTime) || 0),
            id: animation.id || `anim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        });

        timeline.animations.sort((a, b) => a.startTime - b.startTime);
    }

    /**
     * Load timeline animations stored on a slide's element state.
     */
    loadSlide(slide, options = {}) {
        this.pause();
        this.playheadTime = 0;
        this.clearAnimations();
        this.elementSnapshots.clear(); // Clear old snapshots for new slide
        const animationFilter = typeof options.animationFilter === "function" ? options.animationFilter : null;

        (slide?.elements || []).forEach(elementState => {
            const config =
                typeof normalizeElementAnimationConfig === "function"
                    ? normalizeElementAnimationConfig(elementState)
                    : elementState.animation;
            if (!config || !Array.isArray(config.timelines)) return;

            config.timelines.forEach(timeline => {
                (timeline.animations || []).forEach(animation => {
                    if (animationFilter && !animationFilter(animation, elementState, timeline)) return;
                    const startTime = Number(animation.startTime ?? animation.delay) || 0;
                    this.addAnimation(elementState.id, animation, startTime);
                });
            });
        });

        // Capture initial element snapshots BEFORE any animations play
        // This ensures we can restore to the true pre-animation state
        for (const [elementId] of this.timelines) {
            const element = this._resolveElement(elementId);
            if (element) {
                this._captureElementSnapshot(element);
            }
        }
    }

    /**
     * Remove animation from timeline
     */
    removeAnimation(elementId, animationId) {
        const timeline = this.getTimeline(elementId);
        timeline.animations = timeline.animations.filter(a => a.id !== animationId);
    }

    /**
     * Clear all animations for element
     */
    clearAnimations(elementId) {
        if (elementId) {
            this.timelines.delete(elementId);
        } else {
            this.timelines.clear();
        }
    }

    /**
     * Get total duration of animations for element
     */
    getMaxDuration(elementId) {
        const timeline = this.getTimeline(elementId);
        if (!timeline.animations.length) return 0;

        return Math.max(...timeline.animations.map(anim => anim.startTime + anim.duration));
    }

    /**
     * Play animations from current position
     */
    play() {
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
        this._updateFrame();
    }

    /**
     * Pause animations
     */
    pause() {
        this.isPlaying = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    restoreElements() {
        for (const [elementId, snapshot] of this.elementSnapshots) {
            const element = this._resolveElement(elementId);
            if (!element) continue;
            this._restoreElementSnapshot(element, snapshot);
        }
        this.elementSnapshots.clear();

        // CRITICAL: In editor mode, ensure ALL elements are visible (not in play mode)
        // This handles case where animations were never captured as snapshots
        if (typeof document !== "undefined" && !document.body.classList.contains("play-mode-active")) {
            this._ensureAllElementsVisible();
        }
    }

    /**
     * Ensure all animated elements are visible in editor mode
     * This is called when exiting presentation mode to cleanup any hidden elements
     */
    _ensureAllElementsVisible() {
        for (const [elementId] of this.timelines) {
            const element = this._resolveElement(elementId);
            if (!element) continue;

            // Restore element visibility by removing animation-induced styles
            if (element.style.opacity === "0") {
                element.style.opacity = "";
            }
            if (element.style.display === "none") {
                element.style.display = "";
            }
            if (element.style.visibility === "hidden") {
                element.style.visibility = "";
            }
        }
    }

    /**
     * Seek to specific time (ms)
     */
    seek(time) {
        this.playheadTime = Math.max(0, Number(time) || 0);
        this._updateAnimations();
        if (this.onUpdate) {
            this.onUpdate({
                time: this.playheadTime,
                isPlaying: this.isPlaying,
            });
        }
    }

    /**
     * Set animation speed multiplier
     */
    setSpeed(speed) {
        this.speed = Math.max(0.1, Math.min(2, Number(speed) || 1));
    }

    /**
     * Internal frame update loop
     */
    _updateFrame() {
        const now = performance.now();
        const deltaMs = now - this.lastFrameTime;
        this.lastFrameTime = now;

        if (this.isPlaying) {
            this.playheadTime += deltaMs * this.speed;
            this._updateAnimations();

            if (this.onUpdate) {
                this.onUpdate({
                    time: this.playheadTime,
                    isPlaying: this.isPlaying,
                });
            }

            this.animationFrameId = requestAnimationFrame(() => this._updateFrame());
        }
    }

    /**
     * Update all active animations based on playhead position
     */
    _updateAnimations() {
        for (const [elementId, timeline] of this.timelines) {
            const element = this._resolveElement(elementId);
            if (!element) continue;
            this._captureElementSnapshot(element);
            const currentTime = this.playheadTime;
            const animations = [...(timeline.animations || [])].sort((a, b) => {
                const startDelta = (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
                if (startDelta !== 0) return startDelta;
                return (Number(a.duration) || 0) - (Number(b.duration) || 0);
            });
            let appliedAny = false;

            for (const animation of animations) {
                const startTime = Math.max(0, Number(animation.startTime) || 0);
                const duration = Math.max(1, Number(animation.duration) || 1);
                const endTime = startTime + duration;

                if (currentTime >= startTime && currentTime <= endTime) {
                    const progress = (currentTime - startTime) / duration;
                    this._applyAnimation(element, animation, progress);
                    appliedAny = true;
                } else if (currentTime > endTime) {
                    this._applyAnimationFinal(element, animation);
                    appliedAny = true;
                } else if (!appliedAny) {
                    this._applyAnimationInitial(element, animation);
                    appliedAny = true;
                    break;
                } else {
                    break;
                }
            }
        }
    }

    /**
     * Apply animation at specific progress (0-1)
     */
    _applyAnimation(element, animation, progress) {
        const easing = getEasingFunction(animation.easing);
        const easedProgress = Math.max(0, Math.min(1, easing(Math.max(0, Math.min(1, progress)))));

        switch (animation.type) {
            case "fadeIn":
                this._applyFadeIn(element, animation, easedProgress);
                break;
            case "fadeOut":
                this._applyFadeOut(element, animation, easedProgress);
                break;
            case "transform":
                this._applyTransform(element, animation, easedProgress);
                break;
            case "scaleInPlace":
                this._applyScaleInPlace(element, animation, easedProgress);
                break;
            case "rotate":
                this._applyRotate(element, animation, easedProgress);
                break;
            case "write":
                this._applyWrite(element, animation, easedProgress);
                break;
            case "create":
                this._applyCreate(element, animation, easedProgress);
                break;
            case "uncreate":
                this._applyUncreate(element, animation, easedProgress);
                break;
            case "moveInPlace":
                this._applyMoveInPlace(element, animation, easedProgress);
                break;
            case "colorShift":
                this._applyColorShift(element, animation, easedProgress);
                break;
            case "strokeAnimate":
                this._applyStrokeAnimate(element, animation, easedProgress);
                break;
            case "scaleXY":
                this._applyScaleXY(element, animation, easedProgress);
                break;
            case "combinedTransform":
                this._applyCombinedTransform(element, animation, easedProgress);
                break;
            case "zIndex":
                this._applyZIndex(element, animation, easedProgress);
                break;
            // Advanced animation types
            case "replacementTransform":
                this._applyReplacementTransform(element, animation, easedProgress);
                break;
            case "moveAlongPath":
                this._applyMoveAlongPath(element, animation, easedProgress);
                break;
            case "textMorph":
                this._applyTextMorph(element, animation, easedProgress);
                break;
            case "animatedChart":
                this._applyAnimatedChart(element, animation, easedProgress);
                break;
            case "uncreateAdvanced":
                this._applyUncreateAdvanced(element, animation, easedProgress);
                break;
            case "emphasis":
                this._applyEmphasis(element, animation, easedProgress);
                break;
            case "blur":
                this._applyBlur(element, animation, easedProgress);
                break;
            case "flip3D":
                this._applyFlip3D(element, animation, easedProgress);
                break;
            case "glow":
                this._applyGlow(element, animation, easedProgress);
                break;
            case "elegantFadeIn":
                this._applyElegantFadeIn(element, animation, easedProgress);
                break;
            case "elegantFadeOut":
                this._applyElegantFadeOut(element, animation, easedProgress);
                break;
            case "fadeWithBlur":
                this._applyFadeWithBlur(element, animation, easedProgress);
                break;
            case "diffuse":
                this._applyDiffuse(element, animation, easedProgress);
                break;
            default:
                break;
        }
    }

    _getBaseTransform(element) {
        if (!element) return "";
        if (!element.dataset.sfAnimationBaseTransform) {
            const dataX = Number(element.dataset.x);
            const dataY = Number(element.dataset.y);
            element.dataset.sfAnimationBaseTransform =
                Number.isFinite(dataX) && Number.isFinite(dataY)
                    ? `translate(${dataX}px, ${dataY}px)`
                    : element.style.transform || "";
        }
        return element.dataset.sfAnimationBaseTransform;
    }

    _resolveElement(elementId) {
        if (!elementId) return null;
        const byId = document.getElementById(elementId);
        if (byId) return byId;
        const safeId =
            typeof CSS !== "undefined" && typeof CSS.escape === "function"
                ? CSS.escape(String(elementId))
                : String(elementId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return document.querySelector(`.canvas-element[data-id="${safeId}"]`);
    }

    _setTransform(element, localTransform = "") {
        const baseTransform = this._getBaseTransform(element);
        element.style.transform = [baseTransform, localTransform].filter(Boolean).join(" ");
    }

    _hasOpacityAnimation(animation) {
        return (
            Object.prototype.hasOwnProperty.call(animation || {}, "startOpacity") ||
            Object.prototype.hasOwnProperty.call(animation || {}, "endOpacity")
        );
    }

    _captureElementSnapshot(element) {
        const snapshotKey = this._getElementSnapshotKey(element);
        if (!snapshotKey || this.elementSnapshots.has(snapshotKey)) return;
        const textHost = element.querySelector(".text-element-content");
        const styledChildren = this._getAnimationStyledChildren(element).map(child => ({
            element: child,
            strokeDasharray: child.style.strokeDasharray,
            strokeDashoffset: child.style.strokeDashoffset,
            strokeWidth: child.style.strokeWidth,
            opacity: child.style.opacity,
            height: child.style.height,
            filter: child.style.filter,
        }));
        this.elementSnapshots.set(snapshotKey, {
            transform: element.style.transform,
            opacity: element.style.opacity,
            filter: element.style.filter,
            width: element.style.width,
            height: element.style.height,
            color: element.style.color,
            backgroundColor: element.style.backgroundColor,
            fill: element.style.fill,
            stroke: element.style.stroke,
            borderWidth: element.style.borderWidth,
            strokeWidth: element.style.strokeWidth,
            clipPath: element.style.clipPath,
            zIndex: element.style.zIndex,
            parentPerspective: element.parentElement?.style.perspective || "",
            textHost,
            textHtml: textHost ? textHost.innerHTML : null,
            textText: textHost ? textHost.textContent || "" : null,
            styledChildren,
        });
    }

    _getElementSnapshotKey(element) {
        return element?.id || element?.dataset?.id || "";
    }

    _restoreElementSnapshot(element, snapshot) {
        element.style.transform = snapshot.transform;
        element.style.opacity = snapshot.opacity;
        element.style.filter = snapshot.filter;
        element.style.width = snapshot.width;
        element.style.height = snapshot.height;
        element.style.color = snapshot.color;
        element.style.backgroundColor = snapshot.backgroundColor;
        element.style.fill = snapshot.fill;
        element.style.stroke = snapshot.stroke;
        element.style.borderWidth = snapshot.borderWidth;
        element.style.strokeWidth = snapshot.strokeWidth;
        element.style.clipPath = snapshot.clipPath;
        element.style.zIndex = snapshot.zIndex;
        if (element.parentElement) {
            element.parentElement.style.perspective = snapshot.parentPerspective;
        }
        if (snapshot.textHost?.isConnected && snapshot.textHtml !== null) {
            snapshot.textHost.innerHTML = snapshot.textHtml;
        }
        (snapshot.styledChildren || []).forEach(childSnapshot => {
            if (!childSnapshot.element?.isConnected) return;
            childSnapshot.element.style.strokeDasharray = childSnapshot.strokeDasharray;
            childSnapshot.element.style.strokeDashoffset = childSnapshot.strokeDashoffset;
            childSnapshot.element.style.strokeWidth = childSnapshot.strokeWidth;
            childSnapshot.element.style.opacity = childSnapshot.opacity;
            childSnapshot.element.style.height = childSnapshot.height;
            childSnapshot.element.style.filter = childSnapshot.filter;
        });
        delete element.dataset.sfAnimationBaseTransform;
    }

    _getAnimationStyledChildren(element) {
        if (!element) return [];
        return Array.from(
            element.querySelectorAll(
                "path, circle, line, rect, polyline, polygon, ellipse, [data-chart-bar], .chart-bar, [data-chart-line], .chart-line",
            ),
        );
    }

    _getDrawableElements(element) {
        if (!element) return [];
        const selector = "path, circle, line, rect, polyline, polygon, ellipse";
        if (element.matches?.(selector)) return [element];
        const svg = element.tagName?.toLowerCase() === "svg" ? element : element.querySelector?.("svg");
        return svg ? Array.from(svg.querySelectorAll(selector)) : [];
    }

    _getDrawableLength(drawable) {
        const measured = drawable?.getTotalLength?.();
        if (Number.isFinite(measured) && measured > 0) return measured;
        const box = drawable?.getBBox?.();
        if (box && Number.isFinite(box.width) && Number.isFinite(box.height)) {
            return Math.max(1, (box.width + box.height) * 2);
        }
        return 1000;
    }

    _getSnapshotForElement(element) {
        const key = this._getElementSnapshotKey(element);
        return key ? this.elementSnapshots.get(key) || null : null;
    }

    _getTextMorphText(element, animation, key, fallback = "") {
        const value = animation?.[key];
        if (typeof value === "string" && value.length > 0) return value;
        const snapshot = this._getSnapshotForElement(element);
        if (typeof snapshot?.textText === "string") return snapshot.textText;
        const textHost = element?.querySelector?.(".text-element-content") || element;
        return textHost?.textContent || fallback || "";
    }

    _hasExplicitTextMorphText(animation, key) {
        return typeof animation?.[key] === "string" && animation[key].length > 0;
    }

    _applyTextMorphFinalContent(element, textHost, animation) {
        if (this._hasExplicitTextMorphText(animation, "endText")) {
            textHost.textContent = animation.endText;
            return;
        }
        const snapshot = this._getSnapshotForElement(element);
        if (typeof snapshot?.textHtml === "string") {
            textHost.innerHTML = snapshot.textHtml;
        } else {
            textHost.textContent = this._getTextMorphText(element, animation, "endText");
        }
    }

    /**
     * Apply initial state (before animation starts)
     */
    _applyAnimationInitial(element, animation) {
        switch (animation.type) {
            case "fadeIn":
                element.style.opacity = String(animation.startOpacity ?? 0);
                break;
            case "fadeOut":
                element.style.opacity = String(animation.startOpacity ?? 1);
                break;
            case "scaleInPlace":
                this._setTransform(
                    element,
                    `scale3d(${animation.startScale ?? 0.8}, ${animation.startScale ?? 0.8}, 1)`,
                );
                if (this._hasOpacityAnimation(animation)) {
                    element.style.opacity = String(animation.startOpacity ?? 1);
                }
                break;
            case "moveInPlace":
                const startX = animation.startX ?? 0;
                const startY = animation.startY ?? 0;
                this._setTransform(element, `translate3d(${startX}px, ${startY}px, 0)`);
                break;
            case "colorShift":
                const startColor = animation.startColor ?? "#000000";
                const colorProperty = animation.colorProperty ?? "fill";
                if (colorProperty === "fill" || colorProperty === "backgroundColor") {
                    if (colorProperty === "backgroundColor") {
                        element.style.backgroundColor = startColor;
                    } else {
                        element.style.fill = startColor;
                    }
                } else if (colorProperty === "stroke") {
                    element.style.stroke = startColor;
                } else if (colorProperty === "color") {
                    element.style.color = startColor;
                }
                break;
            case "strokeAnimate":
                element.style.strokeWidth = String(animation.startStrokeWidth ?? 0);
                break;
            case "scaleXY":
                this._setTransform(element, `scale3d(${animation.startScaleX ?? 1}, ${animation.startScaleY ?? 1}, 1)`);
                break;
            case "combinedTransform":
                this._setTransform(
                    element,
                    `translate3d(${animation.startX ?? 0}px, ${animation.startY ?? 0}px, 0) scale3d(${animation.startScaleX ?? 1}, ${animation.startScaleY ?? 1}, 1) rotate(${animation.startRotation ?? 0}deg)`,
                );
                break;
            case "zIndex":
                element.style.zIndex = String(animation.startZIndex ?? 0);
                break;
            case "create":
                // Create animation: start hidden with no stroke
                element.style.opacity = "0";
                if (this._getDrawableElements(element).length) {
                    this._getDrawableElements(element).forEach(path => {
                        const length = this._getDrawableLength(path);
                        path.style.strokeDasharray = `${length}`;
                        path.style.strokeDashoffset = `${length}`;
                    });
                }
                break;
            case "uncreate":
                // Uncreate animation: start visible with full stroke
                element.style.opacity = "1";
                if (this._getDrawableElements(element).length) {
                    this._getDrawableElements(element).forEach(path => {
                        path.style.strokeDasharray = "";
                        path.style.strokeDashoffset = "0";
                    });
                }
                break;
            case "transform":
            case "rotate":
            case "replacementTransform":
            case "moveAlongPath":
                this._applyAnimation(element, animation, 0);
                break;
            case "textMorph":
                // For text morphing, set initial text state
                this._applyTextMorphInitial(element, animation);
                break;
            case "write":
                // For write animation (SVG path), set initial state with no stroke
                if (this._getDrawableElements(element).length) {
                    this._getDrawableElements(element).forEach(path => {
                        const length = this._getDrawableLength(path);
                        path.style.strokeDasharray = `${length}`;
                        path.style.strokeDashoffset = `${length}`;
                    });
                }
                break;
            case "animatedChart":
            case "uncreateAdvanced":
            case "emphasis":
            case "blur":
            case "flip3D":
            case "glow":
                this._applyAnimation(element, animation, 0);
                break;
            default:
                break;
        }
    }

    /**
     * Apply final state (after animation completes)
     */
    _applyAnimationFinal(element, animation) {
        switch (animation.type) {
            case "fadeIn":
                element.style.opacity = String(animation.endOpacity ?? 1);
                break;
            case "fadeOut":
                element.style.opacity = String(animation.endOpacity ?? 0);
                break;
            case "scaleInPlace":
                this._setTransform(element, `scale3d(${animation.endScale ?? 1}, ${animation.endScale ?? 1}, 1)`);
                if (this._hasOpacityAnimation(animation)) {
                    element.style.opacity = String(animation.endOpacity ?? 1);
                }
                break;
            case "moveInPlace":
                const endX = animation.endX ?? 0;
                const endY = animation.endY ?? 0;
                this._setTransform(element, `translate3d(${endX}px, ${endY}px, 0)`);
                break;
            case "colorShift":
                const endColor = animation.endColor ?? "#ffffff";
                const colorProperty = animation.colorProperty ?? "fill";
                if (colorProperty === "fill" || colorProperty === "backgroundColor") {
                    if (colorProperty === "backgroundColor") {
                        element.style.backgroundColor = endColor;
                    } else {
                        element.style.fill = endColor;
                    }
                } else if (colorProperty === "stroke") {
                    element.style.stroke = endColor;
                } else if (colorProperty === "color") {
                    element.style.color = endColor;
                }
                break;
            case "strokeAnimate":
                element.style.strokeWidth = String(animation.endStrokeWidth ?? 2);
                break;
            case "scaleXY":
                this._setTransform(element, `scale3d(${animation.endScaleX ?? 1}, ${animation.endScaleY ?? 1}, 1)`);
                break;
            case "combinedTransform":
                this._setTransform(
                    element,
                    `translate3d(${animation.endX ?? 0}px, ${animation.endY ?? 0}px, 0) scale3d(${animation.endScaleX ?? 1}, ${animation.endScaleY ?? 1}, 1) rotate(${animation.endRotation ?? 0}deg)`,
                );
                break;
            case "zIndex":
                element.style.zIndex = String(animation.endZIndex ?? 100);
                break;
            case "create":
                // Create animation: end fully visible with full stroke
                element.style.opacity = "1";
                if (this._getDrawableElements(element).length) {
                    this._getDrawableElements(element).forEach(path => {
                        path.style.strokeDasharray = "";
                        path.style.strokeDashoffset = "0";
                    });
                }
                break;
            case "uncreate":
                // Uncreate animation: end fully hidden with no stroke
                element.style.opacity = "0";
                if (this._getDrawableElements(element).length) {
                    this._getDrawableElements(element).forEach(path => {
                        const length = this._getDrawableLength(path);
                        path.style.strokeDasharray = `${length}`;
                        path.style.strokeDashoffset = `${length}`;
                    });
                }
                break;
            case "transform":
            case "rotate":
            case "replacementTransform":
            case "moveAlongPath":
                this._applyAnimation(element, animation, 1);
                break;
            case "textMorph":
                // For text morphing, set final text state
                this._applyTextMorphFinal(element, animation);
                break;
            case "write":
                // For write animation (SVG path), set final state with full stroke
                if (this._getDrawableElements(element).length) {
                    this._getDrawableElements(element).forEach(path => {
                        path.style.strokeDasharray = "";
                        path.style.strokeDashoffset = "0";
                    });
                }
                break;
            case "animatedChart":
            case "uncreateAdvanced":
            case "emphasis":
            case "blur":
            case "flip3D":
            case "glow":
                this._applyAnimation(element, animation, 1);
                break;
            default:
                break;
        }
    }

    // Animation implementations
    _applyFadeIn(element, animation, progress) {
        const startOpacity = animation.startOpacity ?? 0;
        const endOpacity = animation.endOpacity ?? 1;
        const opacity = interpolate(startOpacity, endOpacity, progress);
        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

    _applyFadeOut(element, animation, progress) {
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 0, progress);
        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

    _applyTransform(element, animation, progress) {
        const direction = animation.direction || "up";
        let x = 0,
            y = 0;
        const distance = 50;

        const startOpacity = animation.startOpacity ?? 0;
        const endOpacity = animation.endOpacity ?? 1;
        const isExit = startOpacity > endOpacity;

        switch (direction) {
            case "up":
                y = isExit ? interpolate(0, -distance, progress) : interpolate(distance, 0, progress);
                break;
            case "down":
                y = isExit ? interpolate(0, distance, progress) : interpolate(-distance, 0, progress);
                break;
            case "left":
                x = isExit ? interpolate(0, -distance, progress) : interpolate(distance, 0, progress);
                break;
            case "right":
                x = isExit ? interpolate(0, distance, progress) : interpolate(-distance, 0, progress);
                break;
        }

        this._setTransform(element, `translate3d(${x}px, ${y}px, 0)`);
        element.style.opacity = String(interpolate(startOpacity, endOpacity, progress));
    }

    _applyScaleInPlace(element, animation, progress) {
        const startScale = animation.startScale ?? 0.8;
        const endScale = animation.endScale ?? 1;
        const scale = interpolate(startScale, endScale, progress);

        this._setTransform(element, `scale3d(${scale}, ${scale}, 1)`);
        if (this._hasOpacityAnimation(animation)) {
            const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 1, progress);
            element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        }
    }

    _applyRotate(element, animation, progress) {
        const rotation = interpolate(0, animation.rotation ?? 360, progress);
        this._setTransform(element, `rotate(${rotation}deg)`);
    }

    _applyWrite(element, animation, progress) {
        const drawables = this._getDrawableElements(element);
        drawables.forEach(path => {
            const length = this._getDrawableLength(path);
            const offset = length * (1 - Math.max(0, Math.min(1, progress)));
            path.style.strokeDasharray = `${length}`;
            path.style.strokeDashoffset = `${offset}`;
        });
    }

    _applyCreate(element, animation, progress) {
        // Similar to write, but also fade in
        this._applyWrite(element, animation, progress);
        element.style.opacity = String(progress);
    }

    _applyUncreate(element, animation, progress) {
        // Reverse of create
        this._applyWrite(element, animation, 1 - progress);
        element.style.opacity = String(1 - progress);
    }

    // NEW: Position-based animation (direct x, y movement)
    _applyMoveInPlace(element, animation, progress) {
        const startX = animation.startX ?? 0;
        const endX = animation.endX ?? 0;
        const startY = animation.startY ?? 0;
        const endY = animation.endY ?? 0;

        const x = interpolate(startX, endX, progress);
        const y = interpolate(startY, endY, progress);

        this._setTransform(element, `translate3d(${x}px, ${y}px, 0)`);
    }

    // NEW: Color animation (fill/stroke color interpolation)
    _applyColorShift(element, animation, progress) {
        const startColor = animation.startColor ?? "#000000";
        const endColor = animation.endColor ?? "#ffffff";
        const colorProperty = animation.colorProperty ?? "fill";

        const interpolatedColor = interpolateColor(startColor, endColor, progress);

        if (colorProperty === "fill" || colorProperty === "backgroundColor") {
            if (colorProperty === "backgroundColor") {
                element.style.backgroundColor = interpolatedColor;
            } else {
                element.style.fill = interpolatedColor;
                if (element.dataset.type === "shape") {
                    element.style.backgroundColor = interpolatedColor;
                }
            }
        } else if (colorProperty === "stroke") {
            element.style.stroke = interpolatedColor;
        } else if (colorProperty === "color") {
            element.style.color = interpolatedColor;
        }
    }

    // NEW: SVG stroke width animation
    _applyStrokeAnimate(element, animation, progress) {
        const startStrokeWidth = animation.startStrokeWidth ?? 0;
        const endStrokeWidth = animation.endStrokeWidth ?? 2;

        const strokeWidth = interpolate(startStrokeWidth, endStrokeWidth, progress);

        if (element.tagName.toLowerCase() === "svg" || element.querySelector("svg")) {
            const paths = this._getDrawableElements(element);
            paths.forEach(path => {
                path.style.strokeWidth = String(strokeWidth);
            });
        } else if (element.matches?.("path, circle, line, rect, polyline, polygon, ellipse")) {
            element.style.strokeWidth = String(strokeWidth);
        } else {
            element.style.borderWidth = String(strokeWidth) + "px";
        }
    }

    // NEW: Separate X/Y scale animation
    _applyScaleXY(element, animation, progress) {
        const startScaleX = animation.startScaleX ?? 1;
        const endScaleX = animation.endScaleX ?? 1;
        const startScaleY = animation.startScaleY ?? 1;
        const endScaleY = animation.endScaleY ?? 1;

        const scaleX = interpolate(startScaleX, endScaleX, progress);
        const scaleY = interpolate(startScaleY, endScaleY, progress);
        const type = element.dataset.type || "";
        if (!["shape", "connector"].includes(type) && Math.abs(scaleX - scaleY) > 0.001) {
            const uniformScale = (scaleX + scaleY) / 2;
            this._setTransform(element, `scale3d(${uniformScale}, ${uniformScale}, 1)`);
            return;
        }

        this._setTransform(element, `scale3d(${scaleX}, ${scaleY}, 1)`);
    }

    // NEW: Combined transform (position + scale + rotation simultaneously)
    _applyCombinedTransform(element, animation, progress) {
        const startX = animation.startX ?? 0;
        const endX = animation.endX ?? 0;
        const startY = animation.startY ?? 0;
        const endY = animation.endY ?? 0;
        const startScaleX = animation.startScaleX ?? 1;
        const endScaleX = animation.endScaleX ?? 1;
        const startScaleY = animation.startScaleY ?? 1;
        const endScaleY = animation.endScaleY ?? 1;
        const startRotation = animation.startRotation ?? 0;
        const endRotation = animation.endRotation ?? 0;

        const x = interpolate(startX, endX, progress);
        const y = interpolate(startY, endY, progress);
        const scaleX = interpolate(startScaleX, endScaleX, progress);
        const scaleY = interpolate(startScaleY, endScaleY, progress);
        const rotation = interpolate(startRotation, endRotation, progress);
        const type = element.dataset.type || "";
        const safeScaleX =
            !["shape", "connector"].includes(type) && Math.abs(scaleX - scaleY) > 0.001
                ? (scaleX + scaleY) / 2
                : scaleX;
        const safeScaleY =
            !["shape", "connector"].includes(type) && Math.abs(scaleX - scaleY) > 0.001 ? safeScaleX : scaleY;

        this._setTransform(
            element,
            `translate3d(${x}px, ${y}px, 0) scale3d(${safeScaleX}, ${safeScaleY}, 1) rotate(${rotation}deg)`,
        );
    }

    // NEW: Z-index animation
    _applyZIndex(element, animation, progress) {
        const startZIndex = animation.startZIndex ?? 0;
        const endZIndex = animation.endZIndex ?? 100;

        const zIndex = Math.round(interpolate(startZIndex, endZIndex, progress));
        element.style.zIndex = String(zIndex);
    }

    // ADVANCED: ReplacementTransform - smooth morphing between object states
    _applyReplacementTransform(element, animation, progress) {
        // Interpolate geometry
        const startGeo = animation.startGeometry || { width: 100, height: 100, x: 0, y: 0 };
        const endGeo = animation.endGeometry || { width: 100, height: 100, x: 0, y: 0 };

        const width = interpolate(startGeo.width, endGeo.width, progress);
        const height = interpolate(startGeo.height, endGeo.height, progress);
        const x = interpolate(startGeo.x, endGeo.x, progress);
        const y = interpolate(startGeo.y, endGeo.y, progress);

        // Interpolate visual properties
        const color = interpolateColor(animation.startColor || "#000000", animation.endColor || "#000000", progress);
        const scale = interpolate(animation.startScale || 1, animation.endScale || 1, progress);
        const rotation = interpolate(animation.startRotation || 0, animation.endRotation || 0, progress);
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 1, progress);

        element.style.opacity = String(opacity);
        if (animation.resizeGeometry === true) {
            element.style.width = width + "px";
            element.style.height = height + "px";
        }
        element.style.fill = color;
        element.style.color = color;
        if (element.dataset.type === "shape") {
            element.style.backgroundColor = color;
        }
        this._setTransform(
            element,
            `translate3d(${x}px, ${y}px, 0) scale3d(${scale}, ${scale}, 1) rotate(${rotation}deg)`,
        );
    }

    // ADVANCED: MoveAlongPath - animate object along Bézier or SVG path
    _applyMoveAlongPath(element, animation, progress) {
        let position = { x: 0, y: 0 };
        let rotation = 0;

        // Calculate position based on path type
        if (animation.pathType === "bezier" && animation.controlPoints) {
            position = interpolateBezierCurve(animation.controlPoints, progress);
            if (animation.followPath) {
                rotation = calculateBezierTangent(animation.controlPoints, progress);
            }
        } else if (animation.pathType === "svgPath" && animation.svgPath) {
            const pathPoints = parseSVGPath(animation.svgPath);
            position = interpolateAlongPath(pathPoints, progress);
            if (animation.followPath && pathPoints.length > 1) {
                const nextIdx = Math.min(Math.floor(progress * (pathPoints.length - 1)) + 1, pathPoints.length - 1);
                const p1 = interpolateAlongPath(pathPoints, progress);
                const p2 = pathPoints[nextIdx] || pathPoints[pathPoints.length - 1];
                rotation = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
            }
        } else if (animation.pathType === "linearPoints" && animation.linearPoints) {
            position = interpolateAlongPath(animation.linearPoints, progress);
        }

        // Apply rotation if not following path
        if (!animation.followPath) {
            rotation = interpolate(animation.startRotation || 0, animation.endRotation || 0, progress);
        }

        this._setTransform(element, `translate3d(${position.x}px, ${position.y}px, 0) rotate(${rotation}deg)`);
    }

    // ADVANCED: TextMorph - transform text content with animation
    _applyTextMorph(element, animation, progress) {
        const textHost = element.querySelector(".text-element-content") || element;
        if (progress >= 1) {
            this._applyTextMorphFinalContent(element, textHost, animation);
            if (animation.endColor) {
                element.style.color = animation.endColor;
            }
            if (Object.prototype.hasOwnProperty.call(animation, "endOpacity")) {
                element.style.opacity = String(animation.endOpacity);
            }
            this._setTransform(element, `scale3d(${animation.endScale || 1}, ${animation.endScale || 1}, 1)`);
            return;
        }
        const originalText = this._getTextMorphText(element, animation, "endText");
        const startText =
            typeof animation.startText === "string" && animation.startText.length > 0 ? animation.startText : "";
        const endText = this._getTextMorphText(element, animation, "endText", originalText);
        const morphMode = animation.morphMode || "letter-by-letter";

        let displayText = "";

        if (morphMode === "full" || morphMode === "fade") {
            // Crossfade: show end text as progress increases
            displayText = progress >= 0.5 ? endText : startText;
        } else if (morphMode === "letter-by-letter") {
            // Progressive reveal of letters
            const maxLength = Math.max(startText.length, endText.length);
            const letterIndex = Math.floor(progress * maxLength);
            displayText = endText.slice(0, letterIndex);
        } else if (morphMode === "word-by-word") {
            const words = endText.split(/\s+/);
            const wordCount = Math.ceil(progress * words.length);
            displayText = words.slice(0, wordCount).join(" ");
        } else if (morphMode === "typewriter") {
            const letterIndex = Math.ceil(progress * endText.length);
            displayText = endText.slice(0, letterIndex);
        } else {
            // 'crossfade' default
            displayText = progress >= 0.5 ? endText : startText;
        }

        textHost.textContent = displayText;

        // Interpolate color and scale
        const scale = interpolate(animation.startScale || 1, animation.endScale || 1, progress);
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 1, progress);

        if (animation.startColor || animation.endColor) {
            const color = interpolateColor(
                animation.startColor || animation.endColor,
                animation.endColor || animation.startColor,
                progress,
            );
            element.style.color = color;
        }
        this._setTransform(element, `scale3d(${scale}, ${scale}, 1)`);
        element.style.opacity = String(opacity);
    }

    // Initial state for text morphing
    _applyTextMorphInitial(element, animation) {
        const textHost = element.querySelector(".text-element-content") || element;
        const startText =
            typeof animation.startText === "string" && animation.startText.length > 0 ? animation.startText : "";
        textHost.textContent = startText;
        if (animation.startColor) {
            element.style.color = animation.startColor;
        }
        if (Object.prototype.hasOwnProperty.call(animation, "startOpacity")) {
            element.style.opacity = String(animation.startOpacity);
        }
    }

    // Final state for text morphing
    _applyTextMorphFinal(element, animation) {
        const textHost = element.querySelector(".text-element-content") || element;
        this._applyTextMorphFinalContent(element, textHost, animation);
        if (animation.endColor) {
            element.style.color = animation.endColor;
        }
        if (Object.prototype.hasOwnProperty.call(animation, "endOpacity")) {
            element.style.opacity = String(animation.endOpacity);
        }
    }

    // ADVANCED: AnimatedChart - progressive reveal of chart data
    _applyAnimatedChart(element, animation, progress) {
        const dataValues = animation.dataValues || [100, 200, 300, 250];
        const maxValue = animation.maxValue || 300;
        const staggerDelay = animation.staggerDelay || 100;
        const animationMode = animation.animationMode || "staggered";
        const chartType = animation.chartType || "bar";

        // Calculate which data points should be visible
        let visibleCount = dataValues.length;
        if (animationMode === "staggered") {
            const totalStaggerTime = dataValues.length * staggerDelay;
            const effectiveProgress = (progress * (animation.duration + totalStaggerTime)) / animation.duration;
            visibleCount = Math.floor(effectiveProgress * dataValues.length);
        } else if (animationMode === "progressive") {
            visibleCount = Math.ceil(progress * dataValues.length);
        } else if (animationMode === "simultaneous" || animationMode === "all-at-once") {
            visibleCount = progress > 0 ? dataValues.length : 0;
        }

        // Update SVG bars/lines
        const bars = element.querySelectorAll('[data-chart-bar], .chart-bar, rect[role="bar"]');
        const lines = element.querySelectorAll('[data-chart-line], .chart-line, path[role="line"]');

        bars.forEach((bar, i) => {
            if (i < visibleCount) {
                const value = dataValues[i];
                const height = (value / maxValue) * 100;
                bar.style.height = height + "%";
                bar.style.opacity = "1";
            } else {
                bar.style.height = "0%";
                bar.style.opacity = "0.1";
            }
        });

        lines.forEach((line, i) => {
            if (i < visibleCount) {
                line.style.opacity = "1";
                line.style.strokeDashoffset = "0";
            } else {
                line.style.opacity = "0";
                line.style.strokeDashoffset = String(this._getDrawableLength(line));
            }
        });
    }

    // ADVANCED: UncreateAdvanced - sophisticated destruction effects
    _applyUncreateAdvanced(element, animation, easedProgress) {
        const destructionMode = animation.destructionMode || "fade";
        const reverseProgress = 1 - easedProgress;

        switch (destructionMode) {
            case "fade":
                element.style.opacity = String(reverseProgress);
                break;
            case "shrink":
                this._setTransform(element, `scale3d(${reverseProgress}, ${reverseProgress}, 1)`);
                element.style.opacity = String(reverseProgress);
                break;
            case "explode": {
                const velocity = animation.explosionVelocity || 5;
                const seed = String(animation.id || element.id || "explode")
                    .split("")
                    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
                const angle = ((seed % 360) * Math.PI) / 180;
                const distance = (1 - reverseProgress) * velocity * 100;
                const x = Math.cos(angle) * distance;
                const y = Math.sin(angle) * distance;
                this._setTransform(
                    element,
                    `translate3d(${x}px, ${y}px, 0) scale3d(${reverseProgress}, ${reverseProgress}, 1)`,
                );
                element.style.opacity = String(reverseProgress);
                break;
            }
            case "disintegrate": {
                const fragmentCount = animation.fragmentCount || 8;
                element.style.opacity = String(reverseProgress);
                if (easedProgress < 0.5) {
                    element.style.filter = `blur(${easedProgress * 10}px)`;
                } else {
                    element.style.filter = `blur(${(1 - easedProgress) * 10}px)`;
                }
                break;
            }
        }
    }

    // ADVANCED: Emphasis - Pulse, Wiggle, Bounce, Heartbeat effects
    _applyEmphasis(element, animation, progress) {
        const emphasisType = animation.emphasisType || "pulse";
        const cycles = animation.cycles || 1;
        const intensity = animation.intensity || 0.2;
        const amplitude = animation.amplitude || 5;
        if (progress >= 1) {
            if (this._hasOpacityAnimation(animation)) {
                element.style.opacity = String(animation.endOpacity ?? 1);
            }
            this._setTransform(element, "");
            return;
        }

        // Map progress to cycle
        const cycleProgress = (progress * cycles) % 1;

        let scale = 1;
        let translateX = 0;
        let rotation = 0;

        switch (emphasisType) {
            case "pulse": {
                // Scale up and down
                const t = Math.sin(cycleProgress * Math.PI * 2) * 0.5 + 0.5;
                scale = 1 + t * intensity;
                break;
            }
            case "wiggle": {
                // Oscillate left/right
                translateX = Math.sin(cycleProgress * Math.PI * 2) * amplitude;
                break;
            }
            case "bounce": {
                // Bounce down and back up
                const t = cycleProgress < 0.5 ? cycleProgress * 2 : 2 - cycleProgress * 2;
                const bounceHeight = Math.sin(t * Math.PI) * intensity * 100;
                this._setTransform(element, `translate3d(0, ${bounceHeight}px, 0)`);
                return;
            }
            case "heartbeat": {
                // Two quick pulses
                const t =
                    cycleProgress < 0.3 ? cycleProgress / 0.3 : cycleProgress > 0.5 ? (cycleProgress - 0.5) / 0.3 : 1;
                scale = 1 + Math.sin(t * Math.PI * 2) * intensity * 0.5;
                break;
            }
            case "shake": {
                translateX = Math.sin(cycleProgress * Math.PI * 8) * amplitude;
                rotation = Math.sin(cycleProgress * Math.PI * 8) * intensity * 8;
                break;
            }
            case "flash": {
                element.style.opacity = String(
                    progress >= 1 ? 1 : 0.35 + Math.abs(Math.sin(cycleProgress * Math.PI * 2)) * 0.65,
                );
                break;
            }
        }

        this._setTransform(
            element,
            `translate3d(${translateX}px, 0, 0) scale3d(${scale}, ${scale}, 1) rotate(${rotation}deg)`,
        );
    }

    // ADVANCED: Blur - Progressive blur in/out
    _applyBlur(element, animation, progress) {
        const direction = animation.direction || "in";
        const startBlur = animation.startBlur || 10;
        const endBlur = animation.endBlur || 0;

        let blurAmount;
        blurAmount = interpolate(startBlur, endBlur, progress);

        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 1, progress);

        element.style.filter = `blur(${blurAmount}px)`;
        element.style.opacity = String(opacity);
    }

    // ADVANCED: 3D Flip - Rotate in 3D space
    _applyFlip3D(element, animation, progress) {
        const axis = animation.axis || "y";
        const totalRotation = animation.rotation || 180;
        const perspective = animation.perspective || 1000;

        const rotation = progress * totalRotation;

        // Apply perspective to parent
        if (element.parentElement) {
            element.parentElement.style.perspective = perspective + "px";
        }

        const transformValue = axis === "x" ? `rotateX(${rotation}deg)` : `rotateY(${rotation}deg)`;

        this._setTransform(element, transformValue);
    }

    // ADVANCED: Glow - Pulsing glow effect
    _applyGlow(element, animation, progress) {
        const glowColor = animation.glowColor || "#ffff00";
        const startBlur = Math.max(0, Number(animation.startBlur) || 0);
        const peakBlur = animation.peakBlur || 20;
        const pulses = animation.pulses || 2;
        const clampedProgress = Math.max(0, Math.min(1, progress));
        const pulseWave = Math.abs(Math.sin(clampedProgress * pulses * Math.PI));
        const envelope = Math.sin(clampedProgress * Math.PI);
        const strength = Math.max(0, Math.min(1, pulseWave * envelope));

        if (strength <= 0.001) {
            element.style.filter = "";
            return;
        }

        const blurAmount = startBlur + (peakBlur - startBlur) * strength;
        const alpha = 0.22 + 0.78 * strength;
        element.style.filter = `drop-shadow(0 0 ${blurAmount}px ${this._colorWithAlpha(glowColor, alpha)})`;
    }

    _colorWithAlpha(color, alpha) {
        const hex = String(color || "").trim();
        const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!match) return color;
        const value =
            match[1].length === 3
                ? match[1]
                      .split("")
                      .map(char => char + char)
                      .join("")
                : match[1];
        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
    }

    // IMPROVED: Elegant Fade In - Smooth fade with anticipation (Apple-style)
    _applyElegantFadeIn(element, animation, progress) {
        const startOpacity = animation.startOpacity ?? 0;
        const endOpacity = animation.endOpacity ?? 1;
        const startScale = animation.startScale ?? 0.95;
        const endScale = animation.endScale ?? 1;

        // Ease-out cubic for responsive entrance
        const easeOutCubic = 1 - Math.pow(1 - progress, 3);
        
        const opacity = interpolate(startOpacity, endOpacity, easeOutCubic);
        const scale = interpolate(startScale, endScale, easeOutCubic);

        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        this._setTransform(element, `scale3d(${scale}, ${scale}, 1)`);
    }

    // IMPROVED: Elegant Fade Out - Smooth fade with confident exit
    _applyElegantFadeOut(element, animation, progress) {
        const startOpacity = animation.startOpacity ?? 1;
        const endOpacity = animation.endOpacity ?? 0;
        const startScale = animation.startScale ?? 1;
        const endScale = animation.endScale ?? 0.92;

        // Ease-in cubic for confident exit (opposite of entrance)
        const easeInCubic = Math.pow(progress, 3);
        
        const opacity = interpolate(startOpacity, endOpacity, easeInCubic);
        const scale = interpolate(startScale, endScale, easeInCubic);

        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        this._setTransform(element, `scale3d(${scale}, ${scale}, 1)`);
    }

    // IMPROVED: Fade with Blur - Blur reduces first, opacity continues (natural focus effect)
    _applyFadeWithBlur(element, animation, progress) {
        const startOpacity = animation.startOpacity ?? 0;
        const endOpacity = animation.endOpacity ?? 1;
        const startBlur = animation.startBlur ?? 16;
        const endBlur = animation.endBlur ?? 0;

        // Blur reduces faster (first 60% of time), creating "coming into focus" effect
        const blurProgress = Math.min(1, progress / 0.6);
        const blurEaseOut = 1 - Math.pow(1 - blurProgress, 2.5);
        const blur = interpolate(startBlur, endBlur, blurEaseOut);

        // Opacity follows ease-out curve for responsive feel
        const opacityEaseOut = 1 - Math.pow(1 - progress, 3);
        const opacity = interpolate(startOpacity, endOpacity, opacityEaseOut);

        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        element.style.filter = `blur(${Math.max(0, blur)}px)`;
    }

    // NEW: Diffuse/Particle Effect - Creates a dispersing/dissolving effect
    _applyDiffuse(element, animation, progress) {
        const diffuseType = animation.diffuseType || "sparkle";
        const intensity = interpolate(animation.startIntensity ?? 1, animation.endIntensity ?? 0, progress);
        
        // Initialize particle container if needed
        if (!element.dataset.sfDiffuseInitialized) {
            this._initializeDiffuseEffect(element, animation, diffuseType);
            element.dataset.sfDiffuseInitialized = "true";
        }

        switch (diffuseType) {
            case "sparkle":
                this._applyDiffuseSparkle(element, animation, progress, intensity);
                break;
            case "wave":
                this._applyDiffuseWave(element, animation, progress, intensity);
                break;
            case "smoke":
                this._applyDiffuseSmoke(element, animation, progress, intensity);
                break;
            case "dissolve":
                this._applyDiffuseDissolve(element, animation, progress, intensity);
                break;
            default:
                this._applyDiffuseSparkle(element, animation, progress, intensity);
        }
    }

    // Initialize diffuse effect with particle elements
    _initializeDiffuseEffect(element, animation, diffuseType) {
        const particleCount = animation.particleCount || 12;
        const container = document.createElement("div");
        container.className = "sf-diffuse-container";
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.pointerEvents = "none";
        container.style.overflow = "hidden";

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement("div");
            particle.className = `sf-diffuse-particle sf-diffuse-${diffuseType}`;
            particle.style.position = "absolute";
            particle.style.pointerEvents = "none";
            
            const size = Math.random() * 4 + 2;
            particle.style.width = size + "px";
            particle.style.height = size + "px";
            particle.style.borderRadius = "50%";
            particle.style.backgroundColor = animation.particleColor || "rgba(255, 255, 255, 0.8)";

            const x = Math.random() * 100;
            const y = Math.random() * 100;
            particle.style.left = x + "%";
            particle.style.top = y + "%";

            container.appendChild(particle);
        }

        element.appendChild(container);
        element.dataset.sfDiffuseContainer = "true";
    }

    // Sparkle diffuse effect - Professional timing with stagger
    _applyDiffuseSparkle(element, animation, progress, intensity) {
        const container = element.querySelector(".sf-diffuse-container");
        if (!container) return;

        const particles = container.querySelectorAll(".sf-diffuse-particle");
        const staggerDelay = (animation.staggerDelay || 30) / (animation.duration || 500);
        
        particles.forEach((particle, index) => {
            // Staggered start: each particle starts slightly after previous
            const particleProgress = Math.max(0, progress - (index * staggerDelay));
            const particleProgressNorm = Math.min(1, particleProgress / (1 - index * staggerDelay));
            
            const angle = (index / particles.length) * Math.PI * 2;
            const distance = particleProgressNorm * (animation.disperseDistance || 80);
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;

            // Ease-out curve for scale: starts full, shrinks smoothly
            const easeOutProgress = 1 - Math.pow(1 - particleProgressNorm, 3);
            const scale = Math.max(0.1, 1 - easeOutProgress);
            
            // Opacity follows ease-out: stays visible longer, then fades
            const opacityEaseOut = 1 - Math.pow(1 - particleProgressNorm, 2);
            const opacity = Math.max(0, intensity * (1 - opacityEaseOut * 0.8));

            particle.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
            particle.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        });

        // Fade main element: faster in first 60%, then slow
        const fadeEaseOut = 1 - Math.pow(1 - progress, 2.5);
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 0, fadeEaseOut);
        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

    // Wave diffuse effect - Professional timing with stagger
    _applyDiffuseWave(element, animation, progress, intensity) {
        const container = element.querySelector(".sf-diffuse-container");
        if (!container) return;

        const particles = container.querySelectorAll(".sf-diffuse-particle");
        const staggerDelay = (animation.staggerDelay || 30) / (animation.duration || 500);
        const waveLength = animation.waveLength || 8;
        
        particles.forEach((particle, index) => {
            // Staggered start
            const particleProgress = Math.max(0, progress - (index * staggerDelay));
            const particleProgressNorm = Math.min(1, particleProgress / (1 - index * staggerDelay));
            
            const wavePhase = (index / waveLength) * Math.PI * 2;
            const distance = particleProgressNorm * (animation.disperseDistance || 100);
            
            // Wave motion with harmonic oscillation
            const waveOscillation = Math.sin(particleProgressNorm * Math.PI * 2 + wavePhase) * 20;
            const x = Math.cos(wavePhase) * distance + waveOscillation;
            const y = Math.sin(wavePhase) * distance + Math.sin(particleProgressNorm * Math.PI) * 30;

            // Smooth ease-out scale
            const easeOutProgress = 1 - Math.pow(1 - particleProgressNorm, 3);
            const scale = Math.max(0.05, 1 - easeOutProgress * 0.6);
            
            // Opacity with subtle pulsing
            const opacityWave = Math.abs(Math.cos(particleProgressNorm * Math.PI * 2 + wavePhase)) * 0.3 + 0.7;
            const opacity = Math.max(0, intensity * (1 - particleProgressNorm) * opacityWave);

            particle.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
            particle.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        });

        // Main element fade with cubic easing
        const fadeEaseOut = 1 - Math.pow(1 - progress, 2.2);
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 0, fadeEaseOut);
        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

    // Smoke diffuse effect - Professional timing with stagger
    _applyDiffuseSmoke(element, animation, progress, intensity) {
        const container = element.querySelector(".sf-diffuse-container");
        if (!container) return;

        const particles = container.querySelectorAll(".sf-diffuse-particle");
        const staggerDelay = (animation.staggerDelay || 30) / (animation.duration || 500);
        
        particles.forEach((particle, index) => {
            // Staggered start: creates cascade effect
            const particleProgress = Math.max(0, progress - (index * staggerDelay));
            const particleProgressNorm = Math.min(1, particleProgress / (1 - index * staggerDelay));
            
            // Angled dispersion with upward drift
            const angle = (index / particles.length) * Math.PI * 2 + Math.sin(particleProgressNorm * Math.PI) * 0.3;
            const distance = particleProgressNorm * (animation.disperseDistance || 120);
            
            const x = Math.cos(angle) * distance + (Math.random() - 0.5) * 40;
            const y = Math.sin(angle) * distance - particleProgressNorm * 100; // Upward drift

            // Ease-out scale for organic dissipation
            const easeOutProgress = 1 - Math.pow(1 - particleProgressNorm, 2.8);
            const scale = Math.max(0.05, (1 - particleProgressNorm * 0.5) * (0.8 + Math.random() * 0.4));
            
            // Opacity: holds longer at start, fades faster at end
            const opacity = Math.max(0, intensity * Math.pow(1 - particleProgressNorm, 1.5));

            particle.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
            particle.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        });

        // Smooth fade with ease-out
        const fadeEaseOut = 1 - Math.pow(1 - progress, 2.4);
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 0, fadeEaseOut);
        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

    // Dissolve diffuse effect - Professional timing with stagger
    _applyDiffuseDissolve(element, animation, progress, intensity) {
        const container = element.querySelector(".sf-diffuse-container");
        if (!container) return;

        const particles = container.querySelectorAll(".sf-diffuse-particle");
        const staggerDelay = (animation.staggerDelay || 30) / (animation.duration || 500);
        
        particles.forEach((particle, index) => {
            // Staggered start: offset each particle
            const particleProgress = Math.max(0, progress - (index * staggerDelay * 1.5)); // Extra stagger for dissolve
            const particleProgressNorm = Math.min(1, particleProgress / (1 - index * staggerDelay));
            
            const seed = index * 12.9898;
            const randomX = Math.sin(seed) * 0.5 + 0.5;
            const randomY = Math.sin(seed * 78.233) * 0.5 + 0.5;
            
            // Scattered movement pattern
            const distance = particleProgressNorm * (animation.disperseDistance || 75);
            const x = (randomX - 0.5) * distance * 2;
            const y = (randomY - 0.5) * distance * 2;

            // Ease-out cubic for smooth dissipation
            const easeOutProgress = 1 - Math.pow(1 - particleProgressNorm, 3.5);
            const scale = Math.max(0.02, 1 - easeOutProgress * 0.7);
            
            // Opacity: starts visible, quickly fades
            const opacity = Math.max(0, intensity * Math.pow(1 - particleProgressNorm, 2.2));

            particle.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
            particle.style.opacity = String(Math.max(0, Math.min(1, opacity)));
        });

        // Main fade: medium speed with ease-out
        const fadeEaseOut = 1 - Math.pow(1 - progress, 2.3);
        const opacity = interpolate(animation.startOpacity ?? 1, animation.endOpacity ?? 0, fadeEaseOut);
        element.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

}

// Global animation engine instance
let _animationEngine = null;

function getAnimationEngine() {
    if (!_animationEngine) {
        _animationEngine = new AnimationEngine();
    }
    return _animationEngine;
}

// Helper function to apply animation to element
function applyAnimationToElement(elementId, animationType, options = {}) {
    const engine = getAnimationEngine();
    const animation = createAnimation(animationType, options);
    engine.addAnimation(elementId, animation, options.startTime || 0);
    return animation.id;
}

// Helper to play all animations on slide
function playSlideAnimations(slideSelector = ".slide") {
    const engine = getAnimationEngine();
    engine.play();
}

function playConfiguredSlideAnimations(slideIndex = 0, options = {}) {
    if (typeof state === "undefined" || !Array.isArray(state.slides)) return null;
    const slide = state.slides[slideIndex];
    if (!slide) return null;

    const engine = getAnimationEngine();
    if (options.restoreBeforePlay !== false) {
        engine.restoreElements();
    }
    const trigger = options.trigger === "on-click" ? "on-click" : options.trigger === "all" ? "all" : "on-slide";
    const animationIds = Array.isArray(options.animationIds) ? new Set(options.animationIds.map(String)) : null;
    engine.loadSlide(slide, {
        animationFilter(animation, elementState, timeline) {
            const animationTrigger = animation?.trigger === "on-click" ? "on-click" : "on-slide";
            if (trigger !== "all" && animationTrigger !== trigger) return false;
            if (animationIds && !animationIds.has(String(animation.id || ""))) return false;
            if (typeof options.animationFilter === "function") {
                return options.animationFilter(animation, elementState, timeline);
            }
            return true;
        },
    });
    engine.seek(0);

    let totalDuration = 0;
    for (const timeline of engine.timelines.values()) {
        for (const animation of timeline.animations) {
            totalDuration = Math.max(
                totalDuration,
                (Number(animation.startTime) || 0) + (Number(animation.duration) || 0),
            );
        }
    }

    if (totalDuration > 0) {
        engine.play();
        window.clearTimeout(engine._autoStopTimeout);
        engine._autoStopTimeout = window.setTimeout(() => {
            if (engine.isPlaying) engine.pause();
            if (options.restoreOnComplete) {
                engine.restoreElements();
            }
        }, totalDuration + 80);
    }

    return engine;
}

// Helper to stop all animations
function stopSlideAnimations(options = {}) {
    const engine = getAnimationEngine();
    window.clearTimeout(engine._autoStopTimeout);
    engine.pause();
    if (options.discardSnapshots) {
        engine.clearAnimations();
        engine.elementSnapshots.clear();
        engine.playheadTime = 0;
        return;
    }
    if (options.seekToStart !== false) {
        engine.seek(0);
    }
    if (options.restoreElements !== false) {
        engine.restoreElements();
    }
}

// Export
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        AnimationEngine,
        getAnimationEngine,
        applyAnimationToElement,
        playSlideAnimations,
        playConfiguredSlideAnimations,
        stopSlideAnimations,
    };
}

// ============================================================================
// MERGED ADVANCED ANIMATIONS MODULE
// ============================================================================

/**
 * Advanced Animation Types
 * ReplacementTransform, MoveAlongPath, TextMorph, and more
 * Extends the base animation engine with sophisticated transformation and morphing capabilities
 */

/**
 * Create a ReplacementTransform animation
 * Morphs one object into another through smooth interpolation
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createReplacementTransformAnimation(options = {}) {
    return {
        type: "replacementTransform",
        duration: options.duration || 800,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        // Starting geometry/properties (captured from source element)
        startGeometry: options.startGeometry || { width: 100, height: 100, x: 0, y: 0 },
        endGeometry: options.endGeometry || { width: 100, height: 100, x: 0, y: 0 },
        startColor: options.startColor || "#000000",
        endColor: options.endColor || "#000000",
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 1,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 1,
        startScale: options.startScale || 1,
        endScale: options.endScale || 1,
        startRotation: options.startRotation || 0,
        endRotation: options.endRotation || 0,
    };
}

/**
 * Create a MoveAlongPath animation
 * Animates object movement along a Bézier curve or SVG path
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createMoveAlongPathAnimation(options = {}) {
    return {
        type: "moveAlongPath",
        duration: options.duration || 2000,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        // Path definition: either Bézier control points or SVG path string
        pathType: options.pathType || "bezier", // 'bezier', 'svgPath', 'linearPoints'
        // Bézier control points: { start, cp1, cp2, end } where each is {x, y}
        controlPoints: options.controlPoints || {
            start: { x: 0, y: 0 },
            cp1: { x: 100, y: -100 },
            cp2: { x: 200, y: -100 },
            end: { x: 300, y: 0 },
        },
        // Or SVG path: "M100,100 Q200,200 300,100"
        svgPath: options.svgPath || null,
        // Array of points: [{x, y}, {x, y}, ...]
        linearPoints: options.linearPoints || null,
        // Rotation: follow path (true) or fixed (false)
        followPath: options.followPath !== undefined ? options.followPath : false,
        // Start and end rotation (if not following path)
        startRotation: options.startRotation || 0,
        endRotation: options.endRotation || 0,
        // Optional: loop the path
        loop: options.loop || false,
    };
}

/**
 * Create a TextMorph animation
 * Smoothly transforms one text string to another
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createTextMorphAnimation(options = {}) {
    return {
        type: "textMorph",
        duration: options.duration || 1000,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        startText: options.startText || "Start",
        endText: options.endText || "End",
        morphMode: options.morphMode || "letter-by-letter", // 'full', 'letter-by-letter', 'crossfade'
        startColor: options.startColor || "#000000",
        endColor: options.endColor || "#000000",
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 1,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 1,
        startScale: options.startScale || 1,
        endScale: options.endScale || 1,
    };
}

/**
 * Create an AnimatedChart animation
 * Progressive reveal of chart elements (bars, lines, points)
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createAnimatedChartAnimation(options = {}) {
    return {
        type: "animatedChart",
        duration: options.duration || 2000,
        delay: options.delay || 0,
        easing: options.easing || "easeOut",
        chartType: options.chartType || "bar", // 'bar', 'line', 'scatter', 'area'
        animationMode: options.animationMode || "staggered", // 'all-at-once', 'staggered', 'progressive'
        staggerDelay: options.staggerDelay || 100,
        // Data values: used for bar/area charts
        dataValues: options.dataValues || [100, 200, 300, 250],
        // Max value for scaling
        maxValue: options.maxValue || 300,
        // Direction: 'from-zero', 'from-right', 'from-bottom'
        direction: options.direction || "from-zero",
        // For line charts: reveal path progressively
        lineDrawMode: options.lineDrawMode || "stroke-dash", // 'stroke-dash', 'point-by-point'
    };
}

/**
 * Create an Uncreate animation (advanced version)
 * More sophisticated than the basic version, supports different destruction modes
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createUncreateAdvancedAnimation(options = {}) {
    return {
        type: "uncreateAdvanced",
        duration: options.duration || 800,
        delay: options.delay || 0,
        easing: options.easing || "easeIn",
        // Destruction modes: 'fade', 'shrink', 'explode', 'disintegrate'
        destructionMode: options.destructionMode || "fade",
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 1,
        endOpacity: options.endOpacity || 0,
        // For explode mode: particle velocity
        explosionVelocity: options.explosionVelocity || 5,
        // For disintegrate mode: fragment count
        fragmentCount: options.fragmentCount || 8,
    };
}

/**
 * Create an Emphasis animation - Pulse/Wiggle/Bounce
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createEmphasisAnimation(options = {}) {
    return {
        type: "emphasis",
        duration: options.duration || 600,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        emphasisType: options.emphasisType || "pulse", // 'pulse', 'wiggle', 'bounce', 'heartbeat'
        // Number of cycles/repetitions
        cycles: options.cycles || 1,
        // Intensity: 0-1 (how much scale/position change)
        intensity: options.intensity || 0.2,
        // For wiggle: amplitude
        amplitude: options.amplitude || 5,
    };
}

/**
 * Create a Blur transition animation
 * Progressive blur in or out
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createBlurAnimation(options = {}) {
    return {
        type: "blur",
        duration: options.duration || 600,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        // Blur direction: 'in' (appears from blur) or 'out' (blurs away)
        direction: options.direction || "in",
        startBlur: options.startBlur || 10,
        endBlur: options.endBlur || 0,
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 1,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 1,
    };
}

/**
 * Create a Flip/3D rotation animation
 * Flip object in 3D space along X or Y axis
 * @param {Object} options
 * @returns {Object} Animation config
 */
function create3DFlipAnimation(options = {}) {
    return {
        type: "flip3D",
        duration: options.duration || 800,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        // Flip axis: 'x' (horizontal) or 'y' (vertical)
        axis: options.axis || "y",
        // Rotation amount in degrees
        rotation: options.rotation || 180,
        // Perspective depth
        perspective: options.perspective || 1000,
    };
}

/**
 * Create a Glow/Highlight animation
 * Pulsing glow effect or highlight emphasis
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createGlowAnimation(options = {}) {
    return {
        type: "glow",
        duration: options.duration || 1000,
        delay: options.delay || 0,
        easing: options.easing || "easeInOut",
        // Glow color
        glowColor: options.glowColor || "#ffff00",
        // Starting glow blur radius
        startBlur: options.startBlur || 5,
        // Peak glow blur radius
        peakBlur: options.peakBlur || 20,
        // Number of pulses
        pulses: options.pulses || 2,
    };
}

/**
 * Create an Elegant Fade In animation
 * Smooth fade in with subtle scale effect
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createElegantFadeInAnimation(options = {}) {
    return {
        type: "elegantFadeIn",
        duration: options.duration || 800,
        delay: options.delay || 0,
        easing: options.easing || "easeOutCubic",
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 0,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 1,
        startScale: options.startScale !== undefined ? options.startScale : 0.95,
        endScale: options.endScale !== undefined ? options.endScale : 1,
    };
}

/**
 * Create an Elegant Fade Out animation
 * Smooth fade out with subtle scale effect
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createElegantFadeOutAnimation(options = {}) {
    return {
        type: "elegantFadeOut",
        duration: options.duration || 800,
        delay: options.delay || 0,
        easing: options.easing || "easeInCubic",
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 1,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 0,
        startScale: options.startScale !== undefined ? options.startScale : 1,
        endScale: options.endScale !== undefined ? options.endScale : 0.95,
    };
}

/**
 * Create a Fade with Blur animation
 * Fade in/out combined with blur effect for smooth transitions
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createFadeWithBlurAnimation(options = {}) {
    return {
        type: "fadeWithBlur",
        duration: options.duration || 1000,
        delay: options.delay || 0,
        easing: options.easing || "easeOut",
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 0,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 1,
        startBlur: options.startBlur !== undefined ? options.startBlur : 15,
        endBlur: options.endBlur !== undefined ? options.endBlur : 0,
    };
}

/**
 * Create a Diffuse/Particle animation
 * Creates dispersing particle effects (sparkle, wave, smoke, dissolve)
 * @param {Object} options
 * @returns {Object} Animation config
 */
function createDiffuseAnimation(options = {}) {
    return {
        type: "diffuse",
        duration: options.duration || 1200,
        delay: options.delay || 0,
        easing: options.easing || "easeOut",
        diffuseType: options.diffuseType || "sparkle", // sparkle, wave, smoke, dissolve
        startOpacity: options.startOpacity !== undefined ? options.startOpacity : 1,
        endOpacity: options.endOpacity !== undefined ? options.endOpacity : 0,
        startIntensity: options.startIntensity !== undefined ? options.startIntensity : 1,
        endIntensity: options.endIntensity !== undefined ? options.endIntensity : 0,
        particleCount: options.particleCount || 12,
        particleColor: options.particleColor || "rgba(255, 200, 100, 0.8)",
        disperseDistance: options.disperseDistance || 120,
        waveLength: options.waveLength || 8,
    };
}

/**
 * Path interpolation utilities for MoveAlongPath animations
 */

/**
 * Calculate point on Bézier curve using de Casteljau's algorithm
 * @param {Object} controlPoints { start, cp1, cp2, end } each with {x, y}
 * @param {number} t Progress (0-1)
 * @returns {Object} {x, y} point on curve
 */
function interpolateBezierCurve(controlPoints, t) {
    const { start, cp1, cp2, end } = controlPoints;

    // de Casteljau's algorithm
    const m0 = lerp(start, cp1, t);
    const m1 = lerp(cp1, cp2, t);
    const m2 = lerp(cp2, end, t);

    const m3 = lerp(m0, m1, t);
    const m4 = lerp(m1, m2, t);

    return lerp(m3, m4, t);
}

/**
 * Linear interpolation between two points
 */
function lerp(p1, p2, t) {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
    };
}

/**
 * Calculate angle (rotation) from Bézier curve tangent
 * @param {Object} controlPoints
 * @param {number} t Progress
 * @param {number} delta Small step for tangent calculation
 * @returns {number} Rotation in degrees
 */
function calculateBezierTangent(controlPoints, t, delta = 0.01) {
    const p1 = interpolateBezierCurve(controlPoints, Math.max(0, t - delta));
    const p2 = interpolateBezierCurve(controlPoints, Math.min(1, t + delta));

    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    return (angle * 180) / Math.PI;
}

/**
 * Parse SVG path and extract points
 * Simple parser for common SVG path commands (M, L, Q, C, Z)
 * @param {string} pathString SVG path string like "M100,100 L200,200 Q300,300 400,200"
 * @returns {Array} Array of {x, y} points
 */
function parseSVGPath(pathString) {
    const points = [];
    const commands = pathString.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];

    let currentPoint = { x: 0, y: 0 };
    let i = 0;

    while (i < commands.length) {
        const cmd = commands[i];

        if (/[MmLl]/.test(cmd)) {
            // MoveTo or LineTo
            const isRelative = cmd === "m" || cmd === "l";
            const x = parseFloat(commands[i + 1]);
            const y = parseFloat(commands[i + 2]);
            const nextPoint = isRelative ? { x: currentPoint.x + x, y: currentPoint.y + y } : { x, y };
            currentPoint = nextPoint;
            points.push(currentPoint);
            i += 3;
        } else if (/[HhVv]/.test(cmd)) {
            // Horizontal or Vertical line
            if (cmd === "H") {
                currentPoint = { ...currentPoint, x: parseFloat(commands[i + 1]) };
            } else if (cmd === "h") {
                currentPoint.x += parseFloat(commands[i + 1]);
            } else if (cmd === "V") {
                currentPoint = { ...currentPoint, y: parseFloat(commands[i + 1]) };
            } else {
                currentPoint.y += parseFloat(commands[i + 1]);
            }
            points.push(currentPoint);
            i += 2;
        } else if (/[Zz]/.test(cmd)) {
            i += 1;
        } else {
            i += 1;
        }
    }

    return points.length > 0 ? points : [{ x: 0, y: 0 }];
}

/**
 * Find closest point on path for smooth interpolation
 * @param {Array} pathPoints Array of {x, y}
 * @param {number} t Progress (0-1)
 * @returns {Object} {x, y} interpolated point
 */
function interpolateAlongPath(pathPoints, t) {
    if (pathPoints.length === 0) return { x: 0, y: 0 };
    if (pathPoints.length === 1) return pathPoints[0];

    const index = t * (pathPoints.length - 1);
    const floorIndex = Math.floor(index);
    const fraction = index - floorIndex;

    const p1 = pathPoints[floorIndex];
    const p2 = pathPoints[Math.min(floorIndex + 1, pathPoints.length - 1)];

    return {
        x: p1.x + (p2.x - p1.x) * fraction,
        y: p1.y + (p2.y - p1.y) * fraction,
    };
}

/**
 * Export advanced animation creation functions
 */
window.createReplacementTransformAnimation = createReplacementTransformAnimation;
window.createMoveAlongPathAnimation = createMoveAlongPathAnimation;
window.createTextMorphAnimation = createTextMorphAnimation;
window.createAnimatedChartAnimation = createAnimatedChartAnimation;
window.createUncreateAdvancedAnimation = createUncreateAdvancedAnimation;
window.createEmphasisAnimation = createEmphasisAnimation;
window.createBlurAnimation = createBlurAnimation;
window.create3DFlipAnimation = create3DFlipAnimation;
window.createGlowAnimation = createGlowAnimation;
window.createElegantFadeInAnimation = createElegantFadeInAnimation;
window.createElegantFadeOutAnimation = createElegantFadeOutAnimation;
window.createFadeWithBlurAnimation = createFadeWithBlurAnimation;
window.createDiffuseAnimation = createDiffuseAnimation;

// Path utilities
window.interpolateBezierCurve = interpolateBezierCurve;
window.calculateBezierTangent = calculateBezierTangent;
window.parseSVGPath = parseSVGPath;
window.interpolateAlongPath = interpolateAlongPath;
