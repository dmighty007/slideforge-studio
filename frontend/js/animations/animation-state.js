/**
 * Animation State Management
 * Manages animation timeline, keyframes, and serialization
 */

// Animation configuration types
const ANIMATION_TRANSITION_TYPES = [
    "fadeIn",
    "fadeOut",
    "elegantFadeIn",
    "elegantFadeOut",
    "fadeWithBlur",
    "diffuse",
    "transform",
    "replacementTransform",
    "moveAlongPath",
    "textMorph",
    "animatedChart",
    "uncreateAdvanced",
    "emphasis",
    "blur",
    "flip3D",
    "glow",
    "scaleInPlace",
    "rotate",
    "write",
    "create",
    "uncreate",
    "moveInPlace",
    "colorShift",
    "strokeAnimate",
    "scaleXY",
    "combinedTransform",
    "zIndex",
];

const ANIMATION_EASINGS = [
    "linear",
    "easeIn",
    "easeOut",
    "easeInOut",
    "easeInQuad",
    "easeOutQuad",
    "easeInCubic",
    "easeOutCubic",
    "easeInQuart",
    "easeOutQuart",
    "easeInQuint",
    "easeOutQuint",
    "easeInExpo",
    "easeOutExpo",
    "easeInCirc",
    "easeOutCirc",
    "easeInBack",
    "easeOutBack",
    "easeInElastic",
    "easeOutElastic",
];

// Create a keyframe for an animation
function createKeyframe(time = 0, property = "opacity", value = 1, easing = "easeOut") {
    return {
        time: Math.max(0, Number(time) || 0),
        property: String(property),
        value,
        easing: ANIMATION_EASINGS.includes(easing) ? easing : "easeOut",
    };
}

// Create an animation object
function createAnimation(type = "fadeIn", overrides = {}) {
    const isValidType = ANIMATION_TRANSITION_TYPES.includes(type);
    const safeType = isValidType ? type : "fadeIn";
    const finiteNumber = (value, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    };
    const clampedNumber = (value, fallback, min, max) => Math.max(min, Math.min(max, finiteNumber(value, fallback)));

    return {
        id: generateId("anim"),
        type: safeType,
        duration: Math.max(100, finiteNumber(overrides.duration, 600)),
        delay: Math.max(0, finiteNumber(overrides.delay, 0)),
        trigger: overrides.trigger === "on-click" ? "on-click" : "on-slide",
        easing: ANIMATION_EASINGS.includes(overrides.easing) ? overrides.easing : "easeOut",
        repeatCount: Math.max(0, finiteNumber(overrides.repeatCount, 0)),
        repeatDelay: Math.max(0, finiteNumber(overrides.repeatDelay, 0)),
        autoReverse: Boolean(overrides.autoReverse),
        keyframes: [],
        // Type-specific properties
        startScale: finiteNumber(overrides.startScale, 0.8),
        startOpacity: clampedNumber(overrides.startOpacity, 0, 0, 1),
        endScale: finiteNumber(overrides.endScale, 1),
        endOpacity: clampedNumber(overrides.endOpacity, 1, 0, 1),
        startColor: String(overrides.startColor || "#000000"),
        endColor: String(overrides.endColor || "#000000"),
        path: String(overrides.path || ""),
        strokeLength: finiteNumber(overrides.strokeLength, 0),
        direction: String(overrides.direction || "up"),
        rotation: finiteNumber(overrides.rotation, 0),
        // NEW: Position animation properties
        startX: finiteNumber(overrides.startX, 0),
        endX: finiteNumber(overrides.endX, 0),
        startY: finiteNumber(overrides.startY, 0),
        endY: finiteNumber(overrides.endY, 0),
        // NEW: Separate X/Y scale properties
        startScaleX: finiteNumber(overrides.startScaleX, 1),
        endScaleX: finiteNumber(overrides.endScaleX, 1),
        startScaleY: finiteNumber(overrides.startScaleY, 1),
        endScaleY: finiteNumber(overrides.endScaleY, 1),
        // NEW: Color animation properties
        colorProperty: String(overrides.colorProperty || "fill"),
        // NEW: Stroke width properties
        startStrokeWidth: finiteNumber(overrides.startStrokeWidth, 0),
        endStrokeWidth: finiteNumber(overrides.endStrokeWidth, 2),
        // NEW: Z-index properties
        startZIndex: finiteNumber(overrides.startZIndex, 0),
        endZIndex: finiteNumber(overrides.endZIndex, 100),
        // NEW: Combined transform - rotation
        startRotation: finiteNumber(overrides.startRotation, 0),
        endRotation: finiteNumber(overrides.endRotation, 0),
        // Advanced animation properties
        startGeometry: overrides.startGeometry || { width: 100, height: 100, x: 0, y: 0 },
        endGeometry: overrides.endGeometry || { width: 100, height: 100, x: 0, y: 0 },
        pathType: String(overrides.pathType || "bezier"),
        controlPoints: overrides.controlPoints || null,
        svgPath: overrides.svgPath || null,
        linearPoints: overrides.linearPoints || null,
        followPath: Boolean(overrides.followPath),
        startText: String(overrides.startText || ""),
        endText: String(overrides.endText || ""),
        morphMode: String(overrides.morphMode || "letter-by-letter"),
        chartType: String(overrides.chartType || "bar"),
        animationMode: String(overrides.animationMode || "staggered"),
        staggerDelay: Math.max(0, finiteNumber(overrides.staggerDelay, 100)),
        dataValues: Array.isArray(overrides.dataValues) ? overrides.dataValues : [100, 200, 300, 250],
        maxValue: Math.max(1, finiteNumber(overrides.maxValue, 300)),
        destructionMode: String(overrides.destructionMode || "fade"),
        explosionVelocity: finiteNumber(overrides.explosionVelocity, 5),
        fragmentCount: Math.max(1, finiteNumber(overrides.fragmentCount, 8)),
        emphasisType: String(overrides.emphasisType || "pulse"),
        cycles: Math.max(1, finiteNumber(overrides.cycles, 1)),
        intensity: Math.max(0, finiteNumber(overrides.intensity, 0.2)),
        amplitude: finiteNumber(overrides.amplitude, 5),
        startBlur: Math.max(0, finiteNumber(overrides.startBlur, 0)),
        endBlur: Math.max(0, finiteNumber(overrides.endBlur, 0)),
        axis: String(overrides.axis || "y"),
        perspective: Math.max(1, finiteNumber(overrides.perspective, 1000)),
        glowColor: String(overrides.glowColor || "#ffff00"),
        peakBlur: Math.max(0, finiteNumber(overrides.peakBlur, 20)),
        pulses: Math.max(1, finiteNumber(overrides.pulses, 2)),
    };
}

// Create a timeline for an element
function createElementTimeline(elementId = "") {
    return {
        elementId: String(elementId),
        animations: [],
        totalDuration: 0,
    };
}

// Add animation to timeline
function addAnimationToTimeline(timeline, animation, startTime = 0) {
    if (!timeline || !animation) return timeline;

    const newTimeline = { ...timeline };
    newTimeline.animations = [...(timeline.animations || [])];

    newTimeline.animations.push({
        ...animation,
        startTime: Math.max(0, Number(startTime) || 0),
    });

    newTimeline.totalDuration = Math.max(
        newTimeline.totalDuration,
        Math.max(...newTimeline.animations.map(a => a.startTime + a.duration)),
    );

    return newTimeline;
}

// Remove animation from timeline
function removeAnimationFromTimeline(timeline, animationId) {
    if (!timeline) return timeline;

    const newTimeline = { ...timeline };
    newTimeline.animations = (timeline.animations || []).filter(a => a.id !== animationId);

    newTimeline.totalDuration =
        newTimeline.animations.length > 0 ? Math.max(...newTimeline.animations.map(a => a.startTime + a.duration)) : 0;

    return newTimeline;
}

// Update animation in timeline
function updateAnimationInTimeline(timeline, animationId, updates) {
    if (!timeline) return timeline;

    const newTimeline = { ...timeline };
    newTimeline.animations = (timeline.animations || []).map(a => (a.id === animationId ? { ...a, ...updates } : a));

    newTimeline.totalDuration =
        newTimeline.animations.length > 0 ? Math.max(...newTimeline.animations.map(a => a.startTime + a.duration)) : 0;

    return newTimeline;
}

// Normalize animation config from element state
function normalizeElementAnimationConfig(el = {}) {
    const legacyValue = typeof el.animation === "string" ? el.animation.trim() : "";
    const raw = legacyValue
        ? { type: legacyValue }
        : el.animation && typeof el.animation === "object"
          ? el.animation
          : null;

    if (!raw) return null;

    // If it's the NEW format with timelines array, return directly
    if (Array.isArray(raw.timelines)) {
        return {
            timelines: raw.timelines,
            autoAnimate: Boolean(raw.autoAnimate),
            laggedStart: Boolean(raw.laggedStart),
            laggedStartDelay: Math.max(0, Number(raw.laggedStartDelay) || 50),
        };
    }

    // If it's the old format with 'effect', convert to new 'type'
    if (raw.effect && !raw.type) {
        raw.type = convertLegacyEffectToType(raw.effect);
    }

    if (!ANIMATION_TRANSITION_TYPES.includes(raw.type)) {
        return null;
    }

    return {
        timelines: [],
        autoAnimate: Boolean(raw.autoAnimate),
        laggedStart: Boolean(raw.laggedStart),
        laggedStartDelay: Math.max(0, Number(raw.laggedStartDelay) || 50),
    };
}

// Convert legacy animation effect names to new types
function convertLegacyEffectToType(effect) {
    const mapping = {
        "fade-in": "fadeIn",
        "fade-out": "fadeOut",
        "slide-up": "transform",
        "slide-down": "transform",
        "slide-left": "transform",
        "slide-right": "transform",
        "zoom-in": "scaleInPlace",
        "pop-in": "scaleInPlace",
        "wipe-in": "write",
    };
    return mapping[effect] || "fadeIn";
}

// Create default animation config for element
function createDefaultAnimationConfig(elementId = "") {
    return {
        elementId,
        timelines: [],
        autoAnimate: false,
        laggedStart: false,
        laggedStartDelay: 50,
    };
}

// Serialize animation to JSON (named apart from animation-export.js's serializeAnimation, a different format)
function serializeAnimationState(animation) {
    if (!animation) return null;
    return JSON.parse(JSON.stringify(animation));
}

// Serialize timeline to JSON
function serializeTimeline(timeline) {
    if (!timeline) return null;
    return JSON.parse(JSON.stringify(timeline));
}

// Serialize animation config to JSON
function serializeAnimationConfig(config) {
    if (!config) return null;
    return JSON.parse(JSON.stringify(config));
}

// Deserialize animation from JSON (named apart from animation-export.js's deserializeAnimation)
function deserializeAnimationState(json) {
    if (!json || typeof json !== "object") return null;
    return createAnimation(json.type, json);
}

// Deserialize timeline from JSON
function deserializeTimeline(json) {
    if (!json || typeof json !== "object") return null;
    return {
        elementId: String(json.elementId || ""),
        animations: Array.isArray(json.animations) ? json.animations.map(deserializeAnimationState) : [],
        totalDuration: Number(json.totalDuration) || 0,
    };
}

// Deserialize animation config from JSON
function deserializeAnimationConfig(json) {
    if (!json || typeof json !== "object") return null;
    return {
        elementId: String(json.elementId || ""),
        timelines: Array.isArray(json.timelines) ? json.timelines.map(deserializeTimeline) : [],
        autoAnimate: Boolean(json.autoAnimate),
        laggedStart: Boolean(json.laggedStart),
        laggedStartDelay: Math.max(0, Number(json.laggedStartDelay) || 50),
    };
}

// Check if element has animations configured
function hasAnimations(el = {}) {
    const config = normalizeElementAnimationConfig(el);
    return config && config.timelines && config.timelines.length > 0;
}

// Get total animation duration for element
function getAnimationDuration(el = {}) {
    const config = normalizeElementAnimationConfig(el);
    if (!config || !config.timelines) return 0;

    return Math.max(
        0,
        ...config.timelines.map(timeline =>
            Math.max(0, ...timeline.animations.map(anim => (anim.startTime || 0) + anim.duration)),
        ),
    );
}

// Export animation state
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        ANIMATION_TRANSITION_TYPES,
        ANIMATION_EASINGS,
        createKeyframe,
        createAnimation,
        createElementTimeline,
        addAnimationToTimeline,
        removeAnimationFromTimeline,
        updateAnimationInTimeline,
        normalizeElementAnimationConfig,
        convertLegacyEffectToType,
        createDefaultAnimationConfig,
        serializeAnimation: serializeAnimationState,
        serializeTimeline,
        serializeAnimationConfig,
        deserializeAnimation: deserializeAnimationState,
        deserializeTimeline,
        deserializeAnimationConfig,
        hasAnimations,
        getAnimationDuration,
    };
}
