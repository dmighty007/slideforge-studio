// Commands: undo and redo.

// ─── Undo ─────────────────────────────────────────────────────────────────────

function _currentPageSetupId() {
    return typeof getPresentationPageSetupId === "function" ? getPresentationPageSetupId() : null;
}

// Undoing a slide-size change restored the size in the state, but the canvas, Reveal and zoom kept the other
// size, so the slide ran under the Properties panel until a reload.
function _syncPageSetupAfterHistoryStep(pageSetupBefore) {
    if (_currentPageSetupId() === pageSetupBefore) return;
    if (typeof syncPresentationPageSetup === "function") syncPresentationPageSetup();
    if (typeof resetZoom === "function") requestAnimationFrame(() => resetZoom());
}

// The same for the theme: undoing a theme change put the text colours back, but the page kept the other theme's
// slide background and fonts (dark text on a dark slide) until a reload.
function _syncThemeAfterHistoryStep() {
    const applied = document.body?.dataset?.presentationTheme;
    if (applied && applied === state.presentationTheme) return;
    if (typeof syncPresentationThemeFromState === "function") syncPresentationThemeFromState();
}

function undo() {
    if (undoStack.length === 0) {
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Nothing to undo", "muted");
        }
        return;
    }
    const pageSetupBefore = _currentPageSetupId();
    if (restoreUndoState()) {
        _syncPageSetupAfterHistoryStep(pageSetupBefore);
        _syncThemeAfterHistoryStep();
        renderSlidesFromState({ preserveState: true });
        clearSelection();
        Reveal.slide(Math.min(currentSlideIndex, state.slides.length - 1));
        updateSlideCounter();
        schedulePresentationAutosave?.(150);
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Action undone", "success");
        }
    }
}

function redo() {
    if (redoStack.length === 0) {
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Nothing to redo", "muted");
        }
        return;
    }
    const pageSetupBefore = _currentPageSetupId();
    if (restoreRedoState()) {
        _syncPageSetupAfterHistoryStep(pageSetupBefore);
        _syncThemeAfterHistoryStep();
        renderSlidesFromState({ preserveState: true });
        clearSelection();
        Reveal.slide(Math.min(currentSlideIndex, state.slides.length - 1));
        updateSlideCounter();
        schedulePresentationAutosave?.(150);
        if (typeof setProjectSaveHint === "function") {
            setProjectSaveHint("Action redone", "success");
        }
    }
}
