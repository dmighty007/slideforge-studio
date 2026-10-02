/**
 * Animation Interaction Module
 * Integrates auto-animate with Reveal.js slidechanged events
 * Manages auto-animate lifecycle and state synchronization
 */

// ═══════════════════════════════════════════════════════════════════════════
// Global State
// ═══════════════════════════════════════════════════════════════════════════

const AutoAnimateInteraction = {
    enabled: false,
    engine: null,
    lastSlideIndex: -1,
    lastAutoAnimateSequence: null,
    isTransitioning: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize auto-animate interaction with Reveal.js
 * Call this after Reveal.js has loaded
 */
function initializeAutoAnimateInteraction() {
    if (typeof Reveal === 'undefined') {
        console.warn('Reveal.js not found; auto-animate interaction not initialized');
        return false;
    }

    // Get animation engine reference
    AutoAnimateInteraction.engine = typeof getAnimationEngine === 'function' ? getAnimationEngine() : null;

    if (!AutoAnimateInteraction.engine) {
        console.warn('Animation engine not available; auto-animate interaction not initialized');
        return false;
    }

    // Hook into Reveal.js slidechanged event
    Reveal.on('slidechanged', event => {
        _handleSlideChanged(event);
    });

    // Also hook into ready event for initial setup
    if (Reveal.isReady && Reveal.isReady()) {
        _setupInitialState();
    } else {
        Reveal.on('ready', () => {
            _setupInitialState();
        });
    }

    console.log('Auto-animate interaction initialized');
    return true;
}

/**
 * Setup initial state after Reveal is ready
 */
function _setupInitialState() {
    if (typeof Reveal !== 'undefined' && Reveal.getIndices) {
        const indices = Reveal.getIndices();
        AutoAnimateInteraction.lastSlideIndex = indices.h || 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle slidechanged event from Reveal.js
 */
function _handleSlideChanged(event) {
    if (!AutoAnimateInteraction.enabled || !AutoAnimateInteraction.engine) {
        return;
    }

    if (AutoAnimateInteraction.isTransitioning) {
        return;
    }

    const currentIndex = event.indexh || 0;
    const previousIndex = AutoAnimateInteraction.lastSlideIndex;

    // Update last slide index
    AutoAnimateInteraction.lastSlideIndex = currentIndex;

    // Only auto-animate for consecutive slides
    if (Math.abs(currentIndex - previousIndex) !== 1) {
        return;
    }

    _generateAndApplyAutoAnimate(previousIndex, currentIndex);
}

/**
 * Generate and apply auto-animate for slide transition
 */
function _generateAndApplyAutoAnimate(fromIndex, toIndex) {
    if (typeof state === 'undefined' || !state.slides) {
        return;
    }

    const fromSlide = state.slides[fromIndex];
    const toSlide = state.slides[toIndex];

    if (!fromSlide || !toSlide) {
        return;
    }

    // Check if auto-animate is enabled for this slide pair
    const toSlideConfig = getAutoAnimateConfig(toSlide);
    if (!toSlideConfig || !toSlideConfig.enabled) {
        return;
    }

    // Clear previous auto-animate animations
    if (AutoAnimateInteraction.lastAutoAnimateSequence) {
        const elementIds = AutoAnimateInteraction.lastAutoAnimateSequence.map(item => item.elementId);
        clearAutoAnimateAnimations(AutoAnimateInteraction.engine, elementIds);
    }

    // Generate auto-animate sequence
    const sequence = generateAutoAnimateSequence(
        fromSlide,
        toSlide,
        toSlideConfig
    );

    if (sequence.length === 0) {
        return;
    }

    // Apply sequence to animation engine
    applyAutoAnimateSequence(AutoAnimateInteraction.engine, sequence);

    // Store for cleanup
    AutoAnimateInteraction.lastAutoAnimateSequence = sequence;

    // Start playback
    AutoAnimateInteraction.engine.play();

    // Calculate total animation duration
    const totalDuration = Math.max(
        ...sequence.map(item => (item.startTime || 0) + (item.animation.duration || 0))
    );

    // Auto-stop after animations complete
    setTimeout(() => {
        if (AutoAnimateInteraction.engine && AutoAnimateInteraction.engine.isPlaying) {
            AutoAnimateInteraction.engine.pause();
        }
    }, totalDuration + 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// Control Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enable/disable auto-animate
 */
function setAutoAnimateEnabled(enabled) {
    AutoAnimateInteraction.enabled = Boolean(enabled);
}

/**
 * Check if auto-animate is enabled
 */
function isAutoAnimateEnabled() {
    return AutoAnimateInteraction.enabled;
}

/**
 * Set animation engine reference
 */
function setAutoAnimateEngine(engine) {
    AutoAnimateInteraction.engine = engine;
}

/**
 * Get animation engine reference
 */
function getAutoAnimateEngine() {
    return AutoAnimateInteraction.engine;
}

/**
 * Manually trigger auto-animate for a slide transition
 */
function triggerAutoAnimate(fromSlideIndex, toSlideIndex) {
    if (!AutoAnimateInteraction.enabled || !AutoAnimateInteraction.engine) {
        console.warn('Auto-animate is not properly initialized');
        return false;
    }

    _generateAndApplyAutoAnimate(fromSlideIndex, toSlideIndex);
    return true;
}

/**
 * Clear current auto-animate sequence
 */
function clearCurrentAutoAnimate() {
    if (AutoAnimateInteraction.lastAutoAnimateSequence) {
        const elementIds = AutoAnimateInteraction.lastAutoAnimateSequence.map(item => item.elementId);
        clearAutoAnimateAnimations(AutoAnimateInteraction.engine, elementIds);
        AutoAnimateInteraction.lastAutoAnimateSequence = null;
    }
}

/**
 * Update auto-animate settings for all slides
 */
function updateAllSlidesAutoAnimateConfig(config) {
    if (typeof state === 'undefined' || !state.slides) {
        return;
    }

    state.slides.forEach((slide, index) => {
        if (index > 0) { // Skip first slide
            updateAutoAnimateConfig(slide, config);
        }
    });

    // Invalidate cache
    clearAutoAnimateCache();
}

/**
 * Update auto-animate settings for a specific slide
 */
function updateSlideAutoAnimateConfig(slideIndex, config) {
    if (typeof state === 'undefined' || !state.slides) {
        return;
    }

    const slide = state.slides[slideIndex];
    if (slide) {
        updateAutoAnimateConfig(slide, config);
        invalidateCacheForSlide(slide.id);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Debugging & Inspection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current auto-animate state (debugging)
 */
function getAutoAnimateState() {
    return {
        enabled: AutoAnimateInteraction.enabled,
        hasEngine: Boolean(AutoAnimateInteraction.engine),
        lastSlideIndex: AutoAnimateInteraction.lastSlideIndex,
        hasActiveSequence: Boolean(AutoAnimateInteraction.lastAutoAnimateSequence),
        sequenceLength: AutoAnimateInteraction.lastAutoAnimateSequence ? AutoAnimateInteraction.lastAutoAnimateSequence.length : 0,
    };
}

/**
 * Get details about the last auto-animate sequence
 */
function getLastAutoAnimateSequenceDetails() {
    if (!AutoAnimateInteraction.lastAutoAnimateSequence) {
        return null;
    }

    return AutoAnimateInteraction.lastAutoAnimateSequence.map(item => ({
        elementId: item.elementId,
        duration: item.animation.duration,
        startTime: item.startTime,
        matchType: item.matchType,
        confidence: item.confidence,
    }));
}

/**
 * Log auto-animate debug information
 */
function logAutoAnimateDebugInfo() {
    console.group('Auto-Animate Debug Info');
    console.log('State:', getAutoAnimateState());
    console.log('Last Sequence:', getLastAutoAnimateSequenceDetails());
    console.groupEnd();
}

// ═══════════════════════════════════════════════════════════════════════════
// Reveal.js Integration Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if auto-animate should apply to a slide transition
 * (Can be used by custom logic)
 */
function shouldAutoAnimateSlideTransition(fromIndex, toIndex) {
    if (!AutoAnimateInteraction.enabled) return false;
    if (Math.abs(toIndex - fromIndex) !== 1) return false;

    if (typeof state === 'undefined' || !state.slides) return false;

    const toSlide = state.slides[toIndex];
    if (!toSlide) return false;

    const config = getAutoAnimateConfig(toSlide);
    return config && config.enabled;
}

/**
 * Get total duration of auto-animate for a slide transition
 */
function getAutoAnimateDuration(fromIndex, toIndex) {
    if (typeof state === 'undefined' || !state.slides) {
        return 0;
    }

    const fromSlide = state.slides[fromIndex];
    const toSlide = state.slides[toIndex];

    if (!fromSlide || !toSlide) {
        return 0;
    }

    const sequence = generateAutoAnimateSequence(fromSlide, toSlide);

    if (sequence.length === 0) {
        return 0;
    }

    return Math.max(...sequence.map(item => (item.startTime || 0) + (item.animation.duration || 0)));
}
