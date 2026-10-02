// Presentation mode: entering/leaving play mode and slide navigation.

function presentationGoToSlide(index) {
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, Math.max(0, (state.slides?.length || 1) - 1)));
    currentSlideIndex = safeIndex;
    if (typeof Reveal !== "undefined" && typeof Reveal.slide === "function") {
        if (document.body.classList.contains("play-mode-active") && typeof Reveal.configure === "function") {
            const revealTransition = _getRevealPresentationSlideTransition(safeIndex);
            Reveal.configure({
                transition: revealTransition,
                backgroundTransition: revealTransition,
                transitionSpeed: "default",
            });
        }
        Reveal.slide(safeIndex, 0, -1);
    } else {
        _preparePresentationSlideAnimations(safeIndex);
    }
}

function presentationNextStep() {
    if (!document.body.classList.contains("play-mode-active")) return false;
    if (_hasRevealFragmentAdvance(false)) {
        _syncPresenterPayload();
        return true;
    }
    if (_revealNextBulletStep()) return true;
    if (_revealNextAnimationGroup()) return true;
    if (_revealNextAdvancedAnimationGroup()) return true;
    const nextIndex = Math.min((state.slides?.length || 1) - 1, currentSlideIndex + 1);
    if (nextIndex === currentSlideIndex) return true;
    presentationGoToSlide(nextIndex);
    return true;
}

function presentationPrevStep() {
    if (!document.body.classList.contains("play-mode-active")) return false;
    if (_hidePreviousAdvancedAnimationGroup()) return true;
    if (_hidePreviousAnimationGroup()) return true;
    if (_hidePreviousBulletStep()) return true;
    if (_hasRevealFragmentAdvance(true)) {
        _syncPresenterPayload();
        return true;
    }
    const prevIndex = Math.max(0, currentSlideIndex - 1);
    if (prevIndex === currentSlideIndex) return true;
    _presentationRuntimeState.restorePreviousSlideFully = true;
    presentationGoToSlide(prevIndex);
    return true;
}

let _playModeExiting = false;
let _playModeEntering = false;
let _playModeExitRequested = false;

// Resolves once the window has stopped changing size (leaving fullscreen takes the window manager a moment), or
// after maxMs at the latest.
function _whenViewportSettles(maxMs = 700) {
    return new Promise(resolve => {
        const started = performance.now();
        let last = `${window.innerWidth}x${window.innerHeight}`;
        let stable = 0;
        const check = () => {
            const now = `${window.innerWidth}x${window.innerHeight}`;
            stable = now === last ? stable + 1 : 0;
            last = now;
            if (stable >= 3 || performance.now() - started > maxMs) resolve();
            else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

async function togglePlayMode() {
    if (_playModeExiting) return;
    // Escape (or Present again) while the presentation is still starting: the start finishes first, then it ends.
    // Running the exit in the middle of the start left the editor half in presentation state.
    if (_playModeEntering) {
        _playModeExitRequested = true;
        return;
    }
    const willPlay = !document.body.classList.contains("play-mode-active");
    if (willPlay) _playModeEntering = true;
    try {
        await _togglePlayModeNow(willPlay);
    } finally {
        if (willPlay) {
            _playModeEntering = false;
            if (_playModeExitRequested) {
                _playModeExitRequested = false;
                if (document.body.classList.contains("play-mode-active")) togglePlayMode();
            }
        }
    }
}

async function _togglePlayModeNow(willPlay) {
    const indices = Reveal.getIndices?.() || {};
    const targetH = Number.isInteger(indices.h) ? indices.h : currentSlideIndex;
    const targetV = Number.isInteger(indices.v) ? indices.v : 0;
    // Reveal uses -1/undefined as the "before the first fragment" state.
    // Starting play mode at fragment 0 makes the first text/object reveal
    // appear already visible instead of animating on the first advance.
    const targetF = willPlay ? -1 : Number.isInteger(indices.f) ? indices.f : -1;

    // CRITICAL: requestFullscreen() must be called SYNCHRONOUSLY within the
    // user gesture call stack. Any await/microtask before it will invalidate
    // the browser's user activation token, causing "not granted" rejection.
    // Fire the fullscreen request immediately, then do setup work after.
    let fullscreenPromise = null;
    if (willPlay) {
        const target = _getPresentationFullscreenTarget();
        if (!document.fullscreenElement && target?.requestFullscreen) {
            try {
                fullscreenPromise = target.requestFullscreen();
            } catch (err) {
                console.warn("Entering fullscreen failed (sync):", err);
            }
        }
    }

    if (willPlay) {
        if (typeof clearSelection === "function") clearSelection();
        if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
        }
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }
        if (typeof commitActiveTextEditors === "function") {
            commitActiveTextEditors();
        }
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            el.contentEditable = "false";
        });

        if (typeof suspendEditorZoom === "function") suspendEditorZoom();
        document.body.classList.add("play-mode-active");
        _syncPresentationViewportLayout();
        // Now await the already-initiated fullscreen promise
        if (fullscreenPromise) {
            try {
                await fullscreenPromise;
            } catch (err) {
                console.warn("Entering fullscreen failed:", err);
            }
        }
        _syncPresentationViewportLayout();
        requestAnimationFrame(() => {
            _syncPresentationViewportLayout();
            requestAnimationFrame(() => _syncPresentationViewportLayout());
        });
    } else {
        _playModeExiting = true;
        // Out of fullscreen first, and only then back to the editor: the other way round showed the editor
        // fullscreen for a moment and then jumped when the window shrank. The wait is bounded so a fullscreen exit
        // that never completes cannot leave Present disabled.
        if (document.fullscreenElement) {
            await Promise.race([_syncBrowserFullscreen(false), new Promise(resolve => setTimeout(resolve, 1200))]);
        }
        await _whenViewportSettles();
        _clearPresentationSlideTransition();
        _resetAnimations();
        document.body.classList.remove("play-mode-active");
    }

    const isPlaying = willPlay;

    if (window.renderSlidesFromState) {
        window.renderSlidesFromState();
    }

    if (typeof Reveal !== "undefined" && typeof Reveal.configure === "function") {
        const activeTransition = isPlaying ? _getRevealPresentationSlideTransition(targetH) : "none";
        Reveal.configure({
            controls: false,
            progress: false,
            keyboard: false,
            transition: activeTransition,
            backgroundTransition: activeTransition,
            transitionSpeed: "default",
            disableLayout: isPlaying,
        });
        Reveal.sync?.();
    }
    requestAnimationFrame(() => {
        if (isPlaying && typeof suspendEditorZoom === "function") suspendEditorZoom();
        if (!isPlaying) Reveal.layout?.();
        if (isPlaying) _resetRevealPresentationTransform();
        Reveal.slide?.(targetH, targetV, targetF);
        if (isPlaying) _resetRevealPresentationTransform();
        if (isPlaying && typeof _resizePresentationChalkboard === "function") {
            _syncPresentationViewportLayout();
            requestAnimationFrame(() => _syncPresentationViewportLayout());
        }
        if (isPlaying) {
            _schedulePresentationSlideAnimations(targetH);
        }

        updatePresentButtonState(isPlaying);
    });
    if (isPlaying) {
        clearSelection();
        _syncPresentationViewportLayout();
        _ensurePresenterMessaging();
        _presentationRuntimeState.presenterStartTs = Date.now();
    } else {
        resetPresentationTools();
        _clearPresentationViewportLayout();
        requestAnimationFrame(() => {
            if (typeof restoreEditorZoom === "function") restoreEditorZoom();
            // Allow re-entry after layout has settled
            requestAnimationFrame(() => {
                if (typeof window.refreshCanvasBackedElements === "function") {
                    window.refreshCanvasBackedElements();
                }
                // Once more after the editor's zoom and layout have settled.
                setTimeout(() => window.resizeEditorCharts?.(), 400);
                _playModeExiting = false;
            });
        });
        try {
            _presentationRuntimeState.presenterWindow?.close?.();
        } catch (_err) {
            // ignore cross-window close errors
        }
        _presentationRuntimeState.presenterWindow = null;
    }
}

function handlePresentationFullscreenChange() {
    const isFullscreen = !!document.fullscreenElement;
    const isPlaying = document.body.classList.contains("play-mode-active");
    if (!isPlaying || _playModeExiting) return;

    if (!isFullscreen) {
        // Leaving fullscreen ends the show, except when the presenter window caused it (see openPresenterView).
        if (Date.now() < (_presentationRuntimeState.fullscreenExitExpectedUntil || 0)) return;
        togglePlayMode();
        return;
    }

    // Re-sync viewport layout whenever fullscreen state changes
    // (entering or leaving fullscreen while still in play mode)
    _updatePresentationToolButtons();
    requestAnimationFrame(() => {
        // Guard again — togglePlayMode may have started during the rAF delay
        if (!document.body.classList.contains("play-mode-active")) return;
        _syncPresentationViewportLayout();
        requestAnimationFrame(() => {
            if (document.body.classList.contains("play-mode-active")) {
                _syncPresentationViewportLayout();
            }
        });
    });
}

function updatePresentButtonState(isPlaying) {
    const btn = document.getElementById("btn-present");
    if (!btn) return;
    btn.innerHTML = isPlaying ? '<i class="fa-solid fa-stop text-red-500"></i>' : '<i class="fa-solid fa-play"></i>';
    btn.title = isPlaying ? "Exit Presentation (Esc)" : "Present";
    btn.setAttribute("aria-label", btn.title);
}

function _playSlideAnimations(slideIndex) {
    _runPresentationSlideAnimations(slideIndex);
}

function _resetAnimations() {
    document.querySelectorAll(".canvas-element").forEach(el => _clearAnimationClasses(el));
    if (typeof stopSlideAnimations === "function") {
        stopSlideAnimations({ discardSnapshots: true, seekToStart: false, restoreElements: false });
    }
    _presentationRuntimeState.slideIndex = -1;
    _presentationRuntimeState.clickGroups = [];
    _presentationRuntimeState.advancedClickGroups = [];
    _presentationRuntimeState.revealedGroups = 0;
    _presentationRuntimeState.revealedAdvancedGroups = 0;
    _presentationRuntimeState.restorePreviousSlideFully = false;
}
