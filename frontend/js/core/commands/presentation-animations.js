// Presentation mode: slide transitions and click-to-reveal animation groups.

const _presentationRuntimeState = {
    slideIndex: -1,
    clickGroups: [],
    advancedClickGroups: [],
    revealedGroups: 0,
    revealedAdvancedGroups: 0,
    restorePreviousSlideFully: false,
    channel: null,
    presenterWindow: null,
    presenterStartTs: 0,
    presenterBound: false,
};

const PRESENTATION_SLIDE_TRANSITIONS = new Set(["fade", "diffuse", "slide", "convex", "concave", "zoom"]);

function _importantStyle(el, prop, value) {
    el?.style?.setProperty(prop, value, "important");
}

function _removeImportantStyles(el, props = []) {
    props.forEach(prop => el?.style?.removeProperty(prop));
}

function _getPresentationSlideTransition(slideIndex = currentSlideIndex) {
    const slideTransition = state.slides?.[slideIndex]?.presentationTransition;
    const transition = String(slideTransition || "none").trim();
    return PRESENTATION_SLIDE_TRANSITIONS.has(transition) ? transition : "none";
}

function _getRevealPresentationSlideTransition(slideIndex = currentSlideIndex) {
    const transition = _getPresentationSlideTransition(slideIndex);
    return transition === "diffuse" ? "fade" : transition;
}

function _clearPresentationSlideTransition() {
    const runtime = _presentationRuntimeState;
    if (runtime.slideTransitionTimer) {
        clearTimeout(runtime.slideTransitionTimer);
        runtime.slideTransitionTimer = null;
    }
    document.querySelectorAll(".presentation-slide-transition-clone").forEach(el => el.remove());
    document.querySelectorAll(".presentation-slide-transitioning").forEach(el => {
        el.classList.remove("presentation-slide-transitioning");
        _removeImportantStyles(el, [
            "opacity",
            "transform",
            "transform-origin",
            "transition",
            "filter",
            "backface-visibility",
            "will-change",
        ]);
    });
}

function _getAnimatedSlideEntries(slideIndex) {
    const slide = state.slides?.[slideIndex];
    if (!slide) return [];
    return (slide.elements || [])
        .map(el => {
            const rawAnimation = el?.animation && typeof el.animation === "object" ? el.animation : null;
            if (rawAnimation && Array.isArray(rawAnimation.timelines)) {
                return { el, animation: null };
            }
            const animation = normalizeElementAnimation(el);
            return {
                el,
                animation: animation?.effect ? animation : null,
            };
        })
        .filter(entry => entry.animation)
        .sort((a, b) => {
            const triggerDelta =
                (a.animation.trigger === "on-slide" ? 0 : 1) - (b.animation.trigger === "on-slide" ? 0 : 1);
            if (triggerDelta !== 0) return triggerDelta;
            const orderDelta = (Number(a.animation.order) || 0) - (Number(b.animation.order) || 0);
            if (orderDelta !== 0) return orderDelta;
            return String(a.el.id).localeCompare(String(b.el.id));
        });
}

function _groupAnimatedEntries(entries) {
    const groups = [];
    entries.forEach(entry => {
        if (entry.animation.trigger !== "on-click") return;
        const order = Number(entry.animation.order) || 0;
        const current = groups[groups.length - 1];
        if (current && current.order === order) {
            current.entries.push(entry);
        } else {
            groups.push({ order, entries: [entry] });
        }
    });
    return groups;
}

function _getAdvancedAnimationClickGroups(slideIndex) {
    const slide = state.slides?.[slideIndex];
    if (!slide) return [];
    const groups = [];
    (slide.elements || []).forEach(el => {
        const config =
            typeof normalizeElementAnimationConfig === "function" ? normalizeElementAnimationConfig(el) : null;
        if (!config || !Array.isArray(config.timelines)) return;
        config.timelines.forEach((timeline, timelineIndex) => {
            (timeline.animations || []).forEach((animation, animationIndex) => {
                if ((animation?.trigger || "on-slide") !== "on-click") return;
                if (!animation.id) animation.id = `anim_${el.id || "el"}_${timelineIndex}_${animationIndex}`;
                groups.push({
                    order: groups.length,
                    animationIds: [String(animation.id)],
                    entries: [{ el, animation }],
                });
            });
        });
    });
    return groups;
}

function _applyAdvancedAnimationInitial(group) {
    if (!group || typeof getAnimationEngine !== "function") return;
    const engine = getAnimationEngine();
    (group.entries || []).forEach(entry => {
        const dom = document.getElementById(entry.el?.id || "");
        if (!dom || !entry.animation) return;
        if (typeof engine._captureElementSnapshot === "function") engine._captureElementSnapshot(dom);
        if (typeof engine._applyAnimationInitial === "function") engine._applyAnimationInitial(dom, entry.animation);
    });
}

function _applyAdvancedAnimationFinal(group) {
    if (!group || typeof getAnimationEngine !== "function") return;
    const engine = getAnimationEngine();
    (group.entries || []).forEach(entry => {
        const dom = document.getElementById(entry.el?.id || "");
        if (!dom || !entry.animation) return;
        if (typeof engine._captureElementSnapshot === "function") engine._captureElementSnapshot(dom);
        if (typeof engine._applyAnimationFinal === "function") engine._applyAnimationFinal(dom, entry.animation);
    });
}

function _clearAnimationClasses(dom) {
    if (!dom) return;
    [
        "sf-anim-hidden",
        "sf-anim-visible",
        "sf-anim-playing",
        "sf-anim-done",
        "sf-anim-effect-fade-in",
        "sf-anim-effect-slide-up",
        "sf-anim-effect-slide-down",
        "sf-anim-effect-slide-left",
        "sf-anim-effect-slide-right",
        "sf-anim-effect-zoom-in",
        "sf-anim-effect-pop-in",
        "sf-anim-effect-wipe-in",
        "sf-anim-effect-pulse",
        "sf-anim-effect-glow",
    ].forEach(className => dom.classList.remove(className));
    dom.style.removeProperty("--sf-base-transform");
    dom.style.removeProperty("--sf-anim-duration");
    dom.style.removeProperty("--sf-anim-delay");
    dom.style.removeProperty("--sf-anim-easing");
    dom.style.removeProperty("--sf-anim-distance");
    dom.style.removeProperty("--sf-anim-scale");
}

function _applyAnimationDomState(dom, animation) {
    if (!dom || !animation) return;
    _clearAnimationClasses(dom);
    dom.classList.add(`sf-anim-effect-${animation.effect}`);
    dom.style.setProperty("--sf-base-transform", dom.style.transform || "");
    dom.style.setProperty("--sf-anim-duration", `${Math.max(100, Number(animation.durationMs) || 800)}ms`);
    dom.style.setProperty("--sf-anim-delay", `${Math.max(0, Number(animation.delayMs) || 0)}ms`);
    dom.style.setProperty("--sf-anim-easing", animation.easing || "ease-out");
    dom.style.setProperty("--sf-anim-distance", `${Math.max(8, Number(animation.distancePx) || 48)}px`);
    dom.style.setProperty("--sf-anim-scale", String(Number(animation.scaleFrom) || 0.88));
}

function _hideAnimatedEntry(entry) {
    const dom = document.getElementById(entry.el.id);
    if (!dom) return;
    _applyAnimationDomState(dom, entry.animation);
    dom.classList.remove("sf-anim-visible", "sf-anim-playing", "sf-anim-done");
    dom.classList.add("sf-anim-hidden");
}

function _showAnimatedEntry(entry, { animate = true } = {}) {
    const dom = document.getElementById(entry.el.id);
    if (!dom) return;
    _applyAnimationDomState(dom, entry.animation);
    dom.classList.remove("sf-anim-hidden");
    dom.classList.add("sf-anim-visible");
    if (!animate) {
        dom.classList.remove("sf-anim-playing", "sf-anim-done");
        return;
    }
    dom.classList.remove("sf-anim-playing", "sf-anim-done");
    void dom.offsetWidth;
    dom.classList.add("sf-anim-playing");

    // Add professional cleanup once animation ends to free GPU memory
    const onAnimEnd = e => {
        if (e.target !== dom) return;
        dom.classList.remove("sf-anim-playing");
        dom.classList.add("sf-anim-done");
        dom.removeEventListener("animationend", onAnimEnd);
    };
    dom.removeEventListener("animationend", dom._sfAnimEndListener);
    dom._sfAnimEndListener = onAnimEnd;
    dom.addEventListener("animationend", onAnimEnd);
}

function _resetAnimatedEntry(entry) {
    const dom = document.getElementById(entry.el.id);
    if (!dom) return;
    _clearAnimationClasses(dom);
    dom.removeEventListener("animationend", dom._sfAnimEndListener);
}

// A flowchart with "Branch Reveal": each click shows its next step (in the order the flow is read), with the arrows
// that lead into it and their labels. The setting was stored but nothing played it.
function _getDiagramRevealSteps(el, node) {
    const graph = el.graphDocument;
    if (graph?.presentationState?.activePreset !== "branch-reveal" || !node) return [];
    const ids = (graph.nodes || []).map(item => item.id);
    const stored = (graph.presentationState.revealOrder || []).filter(id => ids.includes(id));
    const order = [...stored, ...ids.filter(id => !stored.includes(id))];
    const svg = node.querySelector(".mermaid-svg-host svg") || node.querySelector("svg");
    if (!svg) return [];
    const byAttr = (selector, attr, value) => [...svg.querySelectorAll(selector)].filter(part => part.getAttribute(attr) === value);
    return order
        .map(id => {
            const incoming = (graph.edges || []).filter(edge => edge.to === id).map(edge => edge.id);
            const rows = [
                ...byAttr(".mermaid-graph-node", "data-node-id", id),
                ...incoming.flatMap(edgeId => byAttr("[data-edge-id]", "data-edge-id", edgeId)),
            ];
            rows.forEach(part => part.classList.add("sf-diagram-step-part"));
            return { elementId: el.id, rows };
        })
        .filter(step => step.rows.length);
}

// "Reveal bullets one by one": each top-level bullet of such a text box (with its sub-bullets) is one click step.
function _getBulletRevealSteps(slideIndex) {
    const slide = state.slides?.[slideIndex];
    if (!slide) return [];
    const steps = [];
    (slide.elements || [])
        .filter(el => (el?.type === "text" && el.revealBullets) || el?.type === "mermaid")
        .forEach(el => {
            const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find(n => !n.closest("#slide-previews"));
            if (el.type === "mermaid") {
                steps.push(..._getDiagramRevealSteps(el, node));
                return;
            }
            const rows = [...(node?.querySelectorAll(".ppt-bullet-row") || [])];
            let current = null;
            rows.forEach(row => {
                const level = Number(row.dataset.level) || 0;
                if (level === 0 || !current) {
                    current = { elementId: el.id, rows: [] };
                    steps.push(current);
                }
                current.rows.push(row);
            });
        });
    return steps;
}

function _setBulletStepShown(step, shown, { animate = true } = {}) {
    (step?.rows || []).forEach(row => {
        row.classList.toggle("sf-bullet-instant", !animate);
        row.classList.toggle("sf-bullet-hidden", !shown);
        row.classList.toggle("sf-bullet-shown", shown);
    });
}

function _clearBulletReveal() {
    document.querySelectorAll(".sf-bullet-hidden, .sf-bullet-shown, .sf-bullet-instant").forEach(row =>
        row.classList.remove("sf-bullet-hidden", "sf-bullet-shown", "sf-bullet-instant"),
    );
}

// A box with "Reveal bullets one by one" and its own click entrance (a fade, a slide...) comes in with its first
// bullet, as PowerPoint plays an effect "by paragraph". Its entrance was a separate click after all the bullets, so
// the bullets were revealed inside a hidden box and then appeared all at once.
function _attachBulletBoxEntrances(runtime) {
    const firstSteps = new Map();
    (runtime.bulletSteps || []).forEach(step => {
        if (!firstSteps.has(step.elementId)) firstSteps.set(step.elementId, step);
    });
    const onlyFor = (group, id) => (group.entries || []).length > 0 && group.entries.every(entry => entry.el?.id === id);
    firstSteps.forEach((step, id) => {
        const basic = (runtime.clickGroups || []).findIndex(group => onlyFor(group, id));
        if (basic >= 0) {
            step.entrance = { kind: "basic", group: runtime.clickGroups.splice(basic, 1)[0] };
            return;
        }
        const advanced = (runtime.advancedClickGroups || []).findIndex(group => onlyFor(group, id));
        if (advanced >= 0) step.entrance = { kind: "advanced", group: runtime.advancedClickGroups.splice(advanced, 1)[0] };
    });
}

function _playBulletBoxEntrance(step, show, { animate = true } = {}) {
    const entrance = step?.entrance;
    if (!entrance) return;
    if (entrance.kind === "basic") {
        entrance.group.entries.forEach(entry => (show ? _showAnimatedEntry(entry, { animate }) : _hideAnimatedEntry(entry)));
    } else if (!show) {
        _applyAdvancedAnimationInitial(entrance.group);
    } else if (animate && typeof playConfiguredSlideAnimations === "function") {
        playConfiguredSlideAnimations(currentSlideIndex, { trigger: "on-click", animationIds: entrance.group.animationIds, restoreBeforePlay: false });
    } else {
        _applyAdvancedAnimationFinal(entrance.group);
    }
}

function _revealNextBulletStep() {
    const runtime = _presentationRuntimeState;
    const step = runtime.bulletSteps?.[runtime.revealedBullets || 0];
    if (!step) return false;
    _playBulletBoxEntrance(step, true);
    _setBulletStepShown(step, true);
    runtime.revealedBullets = (runtime.revealedBullets || 0) + 1;
    _syncPresenterPayload();
    return true;
}

function _hidePreviousBulletStep() {
    const runtime = _presentationRuntimeState;
    const index = (runtime.revealedBullets || 0) - 1;
    if (index < 0 || !runtime.bulletSteps?.[index]) return false;
    _setBulletStepShown(runtime.bulletSteps[index], false, { animate: false });
    _playBulletBoxEntrance(runtime.bulletSteps[index], false);
    runtime.revealedBullets = index;
    _syncPresenterPayload();
    return true;
}

function _preparePresentationSlideAnimations(slideIndex) {
    _presentationRuntimeState.slideIndex = slideIndex;
    _clearBulletReveal();
    _presentationRuntimeState.bulletSteps = _getBulletRevealSteps(slideIndex);
    _presentationRuntimeState.revealedBullets = 0;
    if (_presentationRuntimeState.restorePreviousSlideFully) {
        // Going back to a slide shows it as it was left: every bullet in.
        _presentationRuntimeState.bulletSteps.forEach(step => _setBulletStepShown(step, true, { animate: false }));
        _presentationRuntimeState.revealedBullets = _presentationRuntimeState.bulletSteps.length;
    } else {
        _presentationRuntimeState.bulletSteps.forEach(step => _setBulletStepShown(step, false, { animate: false }));
    }
    if (typeof stopSlideAnimations === "function") {
        stopSlideAnimations();
    }
    const entries = _getAnimatedSlideEntries(slideIndex);
    entries.forEach(entry => _hideAnimatedEntry(entry));
    entries
        .filter(entry => entry.animation.trigger === "on-slide")
        .forEach(entry => _showAnimatedEntry(entry, { animate: true }));
    _presentationRuntimeState.clickGroups = _groupAnimatedEntries(entries);
    _presentationRuntimeState.advancedClickGroups = _getAdvancedAnimationClickGroups(slideIndex);
    _attachBulletBoxEntrances(_presentationRuntimeState);
    _presentationRuntimeState.revealedGroups = 0;
    _presentationRuntimeState.revealedAdvancedGroups = 0;
    const restoreFully = _presentationRuntimeState.restorePreviousSlideFully;
    if (restoreFully) {
        _presentationRuntimeState.revealedGroups = _presentationRuntimeState.clickGroups.length;
        _presentationRuntimeState.clickGroups.forEach(group =>
            group.entries.forEach(entry => _showAnimatedEntry(entry, { animate: false })),
        );
        _presentationRuntimeState.revealedAdvancedGroups = _presentationRuntimeState.advancedClickGroups.length;
        _presentationRuntimeState.advancedClickGroups.forEach(group => _applyAdvancedAnimationFinal(group));
        _presentationRuntimeState.bulletSteps.forEach(step => _playBulletBoxEntrance(step, true, { animate: false }));
        _presentationRuntimeState.restorePreviousSlideFully = false;
    }
    if (typeof playConfiguredSlideAnimations === "function") {
        playConfiguredSlideAnimations(slideIndex, { trigger: "on-slide" });
    }
    if (!restoreFully) {
        _presentationRuntimeState.advancedClickGroups
            .slice(_presentationRuntimeState.revealedAdvancedGroups)
            .forEach(group => _applyAdvancedAnimationInitial(group));
        _presentationRuntimeState.bulletSteps.forEach(step => {
            if (step.entrance?.kind === "advanced") _applyAdvancedAnimationInitial(step.entrance.group);
        });
    }
    _syncPresenterPayload();
}

function _runPresentationSlideAnimations(slideIndex) {
    _preparePresentationSlideAnimations(slideIndex);
}

function _schedulePresentationSlideAnimations(slideIndex) {
    window.requestAnimationFrame(() => {
        if (!document.body.classList.contains("play-mode-active")) return;
        const safeIndex = Math.max(0, Math.min(Number(slideIndex) || 0, Math.max(0, (state.slides?.length || 1) - 1)));
        if (typeof Reveal !== "undefined" && typeof Reveal.slide === "function") {
            Reveal.slide(safeIndex, 0, -1);
        }
        window.requestAnimationFrame(() => {
            if (!document.body.classList.contains("play-mode-active")) return;
            _preparePresentationSlideAnimations(safeIndex);
        });
    });
}

function _revealNextAnimationGroup() {
    const group = _presentationRuntimeState.clickGroups[_presentationRuntimeState.revealedGroups];
    if (!group) return false;
    group.entries.forEach(entry => _showAnimatedEntry(entry, { animate: true }));
    _presentationRuntimeState.revealedGroups += 1;
    _syncPresenterPayload();
    return true;
}

function _revealNextAdvancedAnimationGroup() {
    const group = _presentationRuntimeState.advancedClickGroups[_presentationRuntimeState.revealedAdvancedGroups];
    if (!group) return false;
    if (typeof playConfiguredSlideAnimations === "function") {
        playConfiguredSlideAnimations(currentSlideIndex, {
            trigger: "on-click",
            animationIds: group.animationIds,
            restoreBeforePlay: false,
        });
    } else {
        _applyAdvancedAnimationFinal(group);
    }
    _presentationRuntimeState.revealedAdvancedGroups += 1;
    _syncPresenterPayload();
    return true;
}

function _hidePreviousAnimationGroup() {
    const previousIndex = _presentationRuntimeState.revealedGroups - 1;
    if (previousIndex < 0) return false;
    const group = _presentationRuntimeState.clickGroups[previousIndex];
    if (!group) return false;
    group.entries.forEach(entry => _hideAnimatedEntry(entry));
    _presentationRuntimeState.revealedGroups = previousIndex;
    _syncPresenterPayload();
    return true;
}

function _hidePreviousAdvancedAnimationGroup() {
    const previousIndex = _presentationRuntimeState.revealedAdvancedGroups - 1;
    if (previousIndex < 0) return false;
    const group = _presentationRuntimeState.advancedClickGroups[previousIndex];
    if (!group) return false;
    _applyAdvancedAnimationInitial(group);
    _presentationRuntimeState.revealedAdvancedGroups = previousIndex;
    _syncPresenterPayload();
    return true;
}

function _hasRevealFragmentAdvance(reverse = false) {
    if (typeof Reveal === "undefined") return false;
    const fn = reverse ? Reveal.prevFragment : Reveal.nextFragment;
    if (typeof fn !== "function") return false;
    return Boolean(fn.call(Reveal));
}
