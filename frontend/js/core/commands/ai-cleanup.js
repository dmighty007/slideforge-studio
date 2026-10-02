// Commands: slide clean-up (AI-assisted and heuristic).

function _snapshotCleanableElements(slide, targetIds = null) {
    const elements = slide?.elements || [];
    return (targetIds ? elements.filter(el => targetIds.has(el.id)) : elements).filter(el => {
        if (!el || el.type === "connector") return false;
        // The footer (logo, rule, number pill) is laid out as one unit; snapping its parts separately split it.
        // Locked objects and theme background bands are not the user's layout either.
        if (el.footerRole || el.locked || el.presetBackground) return false;
        const w = parseFloat(el.width) || 0;
        const h = parseFloat(el.height) || 0;
        return w > 0 && h > 0;
    });
}

function _applyAiCleanupUpdates(slide, updates) {
    if (!slide || !Array.isArray(updates) || !updates.length) return 0;
    const elementsById = new Map((slide.elements || []).map(el => [el.id, el]));
    let changedCount = 0;
    updates.forEach(update => {
        const el = elementsById.get(update?.id);
        if (!el) return;
        const before = JSON.stringify({
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            content: el.content,
            styles: el.styles || {},
        });
        ["x", "y", "width", "height"].forEach(key => {
            if (update[key] !== undefined && update[key] !== null) el[key] = update[key];
        });
        if (el.type === "text" && typeof update.content === "string") {
            el.content = update.content;
        }
        if (update.styles && typeof update.styles === "object") {
            el.styles = { ...(el.styles || {}), ...update.styles };
        }
        const after = JSON.stringify({
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            content: el.content,
            styles: el.styles || {},
        });
        if (after !== before) changedCount += 1;
    });
    return changedCount;
}

// What the tidy-up did, said plainly, with a way back: it changed the slide without asking or saying what it did
// (and was labelled an AI action when no AI model was involved).
function _showCleanupSummary(changedCount, usedAi, message) {
    document.getElementById("sf-cleanup-summary")?.remove();
    const toast = document.createElement("div");
    toast.id = "sf-cleanup-summary";
    toast.className = "sf-cleanup-summary";
    toast.setAttribute("role", "status");
    const text = document.createElement("span");
    const how = usedAi ? "by the AI model" : "by the layout rules (grid, margins and centre lines)";
    text.textContent = changedCount
        ? `Tidied ${changedCount} ${changedCount === 1 ? "object" : "objects"} ${how}.`
        : message || "The layout is already tidy: nothing was moved.";
    toast.appendChild(text);
    if (changedCount) {
        const undoButton = document.createElement("button");
        undoButton.type = "button";
        undoButton.textContent = "Undo";
        undoButton.addEventListener("click", () => {
            toast.remove();
            undo();
        });
        toast.appendChild(undoButton);
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
}

function _finishSlideCleanup(changedCount, message = null, { usedAi = false } = {}) {
    renderSlidesFromState();
    updateGroupBound?.();
    if (typeof refreshPreviews === "function") refreshPreviews();
    if (typeof buildPropertiesPanel === "function") buildPropertiesPanel();
    schedulePresentationAutosave?.(250);
    if (typeof setProjectSaveHint === "function") {
        setProjectSaveHint(
            changedCount ? `Tidied ${changedCount} ${changedCount === 1 ? "object" : "objects"}` : "Layout already tidy",
            changedCount ? "success" : "muted",
        );
    }
    _showCleanupSummary(changedCount, usedAi, message);
}

async function aiCleanUpSlide() {
    const activeIndex = ensureActiveSlideSync();
    const slide = state.slides[activeIndex];
    const targetIds = state.selectedIds?.length ? new Set(state.selectedIds) : null;
    const targetElements = _snapshotCleanableElements(slide, targetIds);
    if (!targetElements.length) {
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Nothing to clean up", "muted");
        }
        return;
    }

    if (typeof _apiFetch === "function") {
        try {
            if (typeof setProjectSaveHint === "function") {
                setProjectSaveHint("Tidying the slide layout…", "muted");
            }
            const slideConfig = getPresentationPageSetupConfig();
            const payload = {
                slide: {
                    ...slide,
                    elements: targetElements,
                },
                pageSetup: {
                    width: Number(slideConfig.width) || 1024,
                    height: Number(slideConfig.height) || 768,
                },
                theme: state.presentationTheme || "editorial",
                selectedOnly: Boolean(targetIds),
            };
            const response = await _apiFetch("/api/slides/cleanup/", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `AI cleanup failed (${response.status})`);
            saveStateToUndo();
            const changedCount = _applyAiCleanupUpdates(slide, result.elements);
            // The server says when it fell back to the layout rules (no AI model, or it failed or was busy).
            _finishSlideCleanup(changedCount, result.summary || null, { usedAi: !result.fallback });
            return;
        } catch (err) {
            console.warn("AI cleanup unavailable; using local cleanup", err);
            if (typeof setProjectSaveHint === "function") {
                setProjectSaveHint("AI unavailable; using local cleanup", "muted");
            }
        }
    }

    aiCleanUpSlideHeuristic();
}

function aiCleanUpSlideHeuristic() {
    const activeIndex = ensureActiveSlideSync();
    const slide = state.slides[activeIndex];
    const targetIds = state.selectedIds?.length ? new Set(state.selectedIds) : null;
    const targetElements = _snapshotCleanableElements(slide, targetIds);
    if (!targetElements.length) {
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Nothing to clean up", "muted");
        }
        return;
    }

    const slideConfig = getPresentationPageSetupConfig();
    const slideW = Number(slideConfig.width) || 1024;
    const slideH = Number(slideConfig.height) || 768;
    const centerX = slideW / 2;
    const centerY = slideH / 2;
    const snapThreshold = 28;
    const grid = 10;
    const edgeMargin = Math.round(Math.max(36, Math.min(slideW, slideH) * 0.05) / grid) * grid;
    const gap = 16;
    let changedCount = 0;
    const before = new Map(
        targetElements.map(el => [
            el.id,
            JSON.stringify({
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
            }),
        ]),
    );

    saveStateToUndo();

    const snap = value => Math.round((Number(value) || 0) / grid) * grid;
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
    const median = values => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return 0;
        return sorted[Math.floor(sorted.length / 2)];
    };
    const numericBounds = el => ({
        x: Number(el.x) || 0,
        y: Number(el.y) || 0,
        w: Math.max(1, parseFloat(el.width) || 1),
        h: Math.max(1, parseFloat(el.height) || 1),
    });

    targetElements.forEach(el => {
        const b = numericBounds(el);
        let nx = snap(b.x);
        let ny = snap(b.y);

        if (Math.abs(nx + b.w / 2 - centerX) < snapThreshold) {
            nx = snap(centerX - b.w / 2);
        }
        if (Math.abs(ny + b.h / 2 - centerY) < snapThreshold) {
            ny = snap(centerY - b.h / 2);
        }
        if (Math.abs(nx - edgeMargin) < snapThreshold) nx = edgeMargin;
        if (Math.abs(ny - edgeMargin) < snapThreshold) ny = edgeMargin;
        if (Math.abs(nx + b.w - (slideW - edgeMargin)) < snapThreshold) nx = snap(slideW - edgeMargin - b.w);
        if (Math.abs(ny + b.h - (slideH - edgeMargin)) < snapThreshold) ny = snap(slideH - edgeMargin - b.h);

        el.x = clamp(nx, 0, Math.max(0, slideW - b.w));
        el.y = clamp(ny, 0, Math.max(0, slideH - b.h));
    });

    const alignCluster = (items, key, setter) => {
        const buckets = [];
        items.forEach(el => {
            const b = numericBounds(el);
            const value = key(b);
            const bucket = buckets.find(group => Math.abs(group.value - value) <= snapThreshold);
            if (bucket) {
                bucket.items.push(el);
                bucket.values.push(value);
                bucket.value = median(bucket.values);
            } else {
                buckets.push({ value, values: [value], items: [el] });
            }
        });
        buckets
            .filter(group => group.items.length >= 2)
            .forEach(group => {
                const target = snap(median(group.values));
                group.items.forEach(el => setter(el, target));
            });
    };

    alignCluster(
        targetElements,
        b => b.x,
        (el, value) => {
            const b = numericBounds(el);
            el.x = clamp(value, 0, Math.max(0, slideW - b.w));
        },
    );
    alignCluster(
        targetElements,
        b => b.x + b.w / 2,
        (el, value) => {
            const b = numericBounds(el);
            el.x = clamp(snap(value - b.w / 2), 0, Math.max(0, slideW - b.w));
        },
    );
    alignCluster(
        targetElements,
        b => b.y,
        (el, value) => {
            const b = numericBounds(el);
            el.y = clamp(value, 0, Math.max(0, slideH - b.h));
        },
    );

    const sorted = [...targetElements].sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const current = sorted[i];
        const pb = numericBounds(prev);
        const cb = numericBounds(current);
        const overlapsX = cb.x < pb.x + pb.w - gap && cb.x + cb.w > pb.x + gap;
        const overlapsY = cb.y < pb.y + pb.h + gap;
        if (overlapsX && overlapsY && cb.y >= pb.y) {
            current.y = clamp(snap(pb.y + pb.h + gap), 0, Math.max(0, slideH - cb.h));
        }
    }

    targetElements.forEach(el => {
        if (el.type === "text" && el.autoHeight !== false) {
            const dom = document.getElementById(el.id);
            if (dom && typeof syncTextBoxLayout === "function") {
                const layout = syncTextBoxLayout(dom, el);
                if (layout?.autoHeight && Number.isFinite(layout.height)) {
                    el.height = `${layout.height}px`;
                }
            }
        }
        const after = JSON.stringify({
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
        });
        if (after !== before.get(el.id)) changedCount += 1;
    });

    _finishSlideCleanup(changedCount);
}
