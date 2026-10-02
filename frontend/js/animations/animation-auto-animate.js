/**
 * Auto-Animate Module
 * Detects matching objects across slides and creates automatic smooth transitions
 * Integrates with the animation engine to provide seamless morphing animations
 */

// ═══════════════════════════════════════════════════════════════════════════
// Object Matching Strategy
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect matching objects between two slides
 * Strategy:
 * 1. First, match by ID (exact match)
 * 2. If no ID match, use position/size/color similarity (fallback)
 * 3. Return array of matching pairs
 */
function detectMatchingObjects(fromSlide, toSlide) {
    if (!fromSlide || !fromSlide.elements || !toSlide || !toSlide.elements) {
        return [];
    }

    const matches = [];
    const usedToIndices = new Set();

    // Pass 1: Match by ID
    for (const fromEl of fromSlide.elements) {
        if (!fromEl.id) continue;
        if (!_isAnimatableElement(fromEl)) continue;

        const toEl = toSlide.elements.find(el => el.id === fromEl.id);
        if (toEl && _isAnimatableElement(toEl)) {
            matches.push({
                fromEl,
                toEl,
                confidence: 1.0, // Perfect match
                matchType: 'id',
            });
            usedToIndices.add(toSlide.elements.indexOf(toEl));
        }
    }

    // Pass 2: Match by position/size/color similarity (fallback)
    // Only for elements that weren't matched in Pass 1
    for (const fromEl of fromSlide.elements) {
        // Skip if already matched by ID
        if (matches.find(m => m.fromEl.id === fromEl.id)) continue;

        // Skip non-animatable elements
        if (!_isAnimatableElement(fromEl)) continue;

        let bestMatch = null;
        let bestScore = 0.3; // Minimum confidence threshold

        for (let i = 0; i < toSlide.elements.length; i++) {
            const toEl = toSlide.elements[i];

            // Skip if already used or not animatable
            if (usedToIndices.has(i) || !_isAnimatableElement(toEl)) continue;

            // Skip type mismatch
            if (fromEl.type !== toEl.type) continue;

            const score = _calculateSimilarityScore(fromEl, toEl);

            if (score > bestScore) {
                bestScore = score;
                bestMatch = toEl;
            }
        }

        if (bestMatch) {
            const matchIndex = toSlide.elements.indexOf(bestMatch);
            matches.push({
                fromEl,
                toEl: bestMatch,
                confidence: bestScore,
                matchType: 'similarity',
            });
            usedToIndices.add(matchIndex);
        }
    }

    return matches;
}

/**
 * Calculate similarity score between two elements (0-1)
 * Considers: position, size, opacity, color
 */
function _calculateSimilarityScore(el1, el2) {
    const toNumber = (value, fallback = 0) => {
        const number = Number.parseFloat(String(value ?? ""));
        return Number.isFinite(number) ? number : fallback;
    };
    let score = 0;
    let weightSum = 0;

    // Position similarity (40%)
    const dx = Math.abs(toNumber(el1.x) - toNumber(el2.x));
    const dy = Math.abs(toNumber(el1.y) - toNumber(el2.y));
    const maxDist = 500; // Max distance considered similar
    const positionScore = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / maxDist);
    score += positionScore * 0.4;
    weightSum += 0.4;

    // Size similarity (30%)
    const w1 = Math.max(1, toNumber(el1.width, 100));
    const w2 = Math.max(1, toNumber(el2.width, 100));
    const h1 = Math.max(1, toNumber(el1.height, 100));
    const h2 = Math.max(1, toNumber(el2.height, 100));

    const sizeRatio = Math.min(w1, w2) / Math.max(w1, w2);
    const aspectRatioDiff = Math.abs((h1 / w1) - (h2 / w2));
    const sizeScore = sizeRatio * (1 - Math.min(aspectRatioDiff, 1));
    score += sizeScore * 0.3;
    weightSum += 0.3;

    // Opacity similarity (15%)
    const op1 = (el1.styles && el1.styles.opacity !== undefined) ? el1.styles.opacity : 1;
    const op2 = (el2.styles && el2.styles.opacity !== undefined) ? el2.styles.opacity : 1;
    const opacityScore = 1 - Math.abs(op1 - op2);
    score += opacityScore * 0.15;
    weightSum += 0.15;

    // Color similarity (15%)
    const color1 = el1.styles && el1.styles.color ? el1.styles.color : '#000000';
    const color2 = el2.styles && el2.styles.color ? el2.styles.color : '#000000';
    const colorScore = _colorSimilarity(color1, color2);
    score += colorScore * 0.15;
    weightSum += 0.15;

    return weightSum > 0 ? score / weightSum : 0;
}

/**
 * Calculate color similarity score (0-1)
 */
function _colorSimilarity(color1, color2) {
    const rgb1 = hexToRGB(color1);
    const rgb2 = hexToRGB(color2);

    const maxDiff = 255 * 3; // Max possible difference
    const actualDiff = Math.abs(rgb1[0] - rgb2[0]) + Math.abs(rgb1[1] - rgb2[1]) + Math.abs(rgb1[2] - rgb2[2]);

    return 1 - (actualDiff / maxDiff);
}

/**
 * Check if element type can be animated
 */
function _isAnimatableElement(el) {
    if (!el) return false;
    if (el.editableMasterFooterElement) return false;

    const nonAnimatableTypes = ['master'];
    if (nonAnimatableTypes.includes(el.type)) return false;

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-Animate Transition Creation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create auto-animate transition between two matched elements
 * Generates a transformation animation with interpolation of:
 * - position (x, y)
 * - scale (scaleX, scaleY)
 * - opacity
 * - color
 * - rotation
 */
function createAutoAnimateTransition(fromEl, toEl, duration = 600, easing = 'easeInOut') {
    const fromState = _captureElementState(fromEl);
    const toState = _captureElementState(toEl);

    const transformations = _calculateTransformations(fromState, toState);

    const animation = createAnimation('transform', {
        duration: Math.max(100, Number(duration) || 600),
        easing: easing,
        delay: 0,
        startOpacity: fromState.opacity,
        endOpacity: toState.opacity,
        startScale: fromState.scale,
        endScale: toState.scale,
        startColor: fromState.color,
        endColor: toState.color,
    });

    // Store transformation metadata
    animation._autoAnimateData = {
        transformations,
        fromState,
        toState,
    };

    return animation;
}

/**
 * Capture the current state of an element
 */
function _captureElementState(el) {
    if (!el) return _getDefaultElementState();

    const styles = el.styles || {};
    const toNumber = (value, fallback = 0) => {
        const number = Number.parseFloat(String(value ?? ""));
        return Number.isFinite(number) ? number : fallback;
    };

    return {
        x: toNumber(el.x, 0),
        y: toNumber(el.y, 0),
        width: Math.max(1, toNumber(el.width, 100)),
        height: Math.max(1, toNumber(el.height, 100)),
        scaleX: toNumber(el.scaleX, 1),
        scaleY: toNumber(el.scaleY, 1),
        rotation: toNumber(el.rotation, 0),
        opacity: (styles.opacity !== undefined) ? styles.opacity : 1,
        color: styles.color || '#000000',
    };
}

/**
 * Get default element state
 */
function _getDefaultElementState() {
    return {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        color: '#000000',
    };
}

/**
 * Calculate transformations between two element states
 */
function _calculateTransformations(fromState, toState) {
    return {
        position: {
            from: { x: fromState.x, y: fromState.y },
            to: { x: toState.x, y: toState.y },
            delta: {
                x: toState.x - fromState.x,
                y: toState.y - fromState.y,
            },
        },
        scale: {
            from: { x: fromState.scaleX, y: fromState.scaleY },
            to: { x: toState.scaleX, y: toState.scaleY },
        },
        size: {
            from: { w: fromState.width, h: fromState.height },
            to: { w: toState.width, h: toState.height },
        },
        rotation: {
            from: fromState.rotation,
            to: toState.rotation,
            delta: toState.rotation - fromState.rotation,
        },
        opacity: {
            from: fromState.opacity,
            to: toState.opacity,
        },
        color: {
            from: fromState.color,
            to: toState.color,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-Animate Sequence Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate full auto-animate sequence for slide transition
 * Returns an array of animations with timing information
 */
function generateAutoAnimateSequence(fromSlide, toSlide, config = {}) {
    const {
        duration = 600,
        easing = 'easeInOut',
        staggerDelay = 0,
        useStagger = false,
    } = config;

    const matches = detectMatchingObjects(fromSlide, toSlide);
    const sequence = [];

    matches.forEach((match, index) => {
        const startTime = useStagger ? index * staggerDelay : 0;
        const animation = createAutoAnimateTransition(
            match.fromEl,
            match.toEl,
            duration,
            easing
        );

        sequence.push({
            elementId: match.toEl.id,
            animation,
            startTime,
            fromElement: match.fromEl,
            toElement: match.toEl,
            matchType: match.matchType,
            confidence: match.confidence,
        });
    });

    return sequence;
}

// ═══════════════════════════════════════════════════════════════════════════
// Engine Integration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply auto-animate sequence to animation engine
 */
function applyAutoAnimateSequence(engine, sequence) {
    if (!engine || !sequence) return;

    for (const item of sequence) {
        if (item.elementId && item.animation) {
            engine.addAnimation(item.elementId, item.animation, item.startTime);
        }
    }
}

/**
 * Clear all auto-animate animations from engine
 */
function clearAutoAnimateAnimations(engine, elementIds) {
    if (!engine || !elementIds) return;

    for (const elementId of elementIds) {
        const timeline = engine.getTimeline(elementId);
        if (timeline && timeline.animations) {
            timeline.animations = timeline.animations.filter(anim => !anim._autoAnimateData);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration & State Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create default auto-animate configuration for a slide
 */
function createDefaultAutoAnimateConfig() {
    return {
        enabled: false,
        duration: 600,
        easing: 'easeInOut',
        staggerDelay: 0,
        useStagger: false,
        matchStrategy: 'id', // 'id' | 'similarity' | 'both'
    };
}

/**
 * Extend slide state with auto-animate configuration
 */
function extendSlideStateWithAutoAnimate(slide) {
    if (!slide) return;

    if (!slide.autoAnimate) {
        slide.autoAnimate = {
            config: createDefaultAutoAnimateConfig(),
            matchedPairs: [],
        };
    }

    return slide;
}

/**
 * Update auto-animate configuration for a slide
 */
function updateAutoAnimateConfig(slide, config) {
    slide = extendSlideStateWithAutoAnimate(slide);

    if (config) {
        slide.autoAnimate.config = {
            ...slide.autoAnimate.config,
            ...config,
        };
    }

    return slide;
}

/**
 * Get auto-animate config for a slide
 */
function getAutoAnimateConfig(slide) {
    slide = extendSlideStateWithAutoAnimate(slide);
    return slide.autoAnimate.config;
}

// ═══════════════════════════════════════════════════════════════════════════
// Caching & Performance
// ═══════════════════════════════════════════════════════════════════════════

// Cache for matching results to avoid recomputation
const AUTO_ANIMATE_CACHE = new Map();

/**
 * Get cached matching results for a slide pair
 */
function getCachedMatches(fromSlideId, toSlideId) {
    const key = `${fromSlideId}_${toSlideId}`;
    return AUTO_ANIMATE_CACHE.get(key);
}

/**
 * Set cached matching results
 */
function setCachedMatches(fromSlideId, toSlideId, matches) {
    const key = `${fromSlideId}_${toSlideId}`;
    AUTO_ANIMATE_CACHE.set(key, matches);
}

/**
 * Clear auto-animate cache
 */
function clearAutoAnimateCache() {
    AUTO_ANIMATE_CACHE.clear();
}

/**
 * Invalidate cache entry for a slide pair
 */
function invalidateCacheForSlide(slideId) {
    const keysToDelete = [];

    for (const key of AUTO_ANIMATE_CACHE.keys()) {
        if (key.includes(slideId)) {
            keysToDelete.push(key);
        }
    }

    keysToDelete.forEach(key => AUTO_ANIMATE_CACHE.delete(key));
}
