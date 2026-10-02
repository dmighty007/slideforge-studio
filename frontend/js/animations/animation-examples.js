/**
 * Animation System Quick Start & Testing
 *
 * This file demonstrates the modern animation engine usage and provides
 * quick reference for integrating animations into your presentations.
 */

// ═══════════════════════════════════════════════════════════════════════════
// QUICK START: Add Animation to Selected Object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Apply a preset animation to the selected element
 */
function exampleApplyFadeInAnimation() {
    const elementId = state.selectedIds[0];
    if (!elementId) {
        console.log("No element selected");
        return;
    }

    // Method 1: Using preset
    applyAnimationPreset(elementId, "fadeIn");

    // Method 2: Manually creating animation
    const element = getCurrentSlide().elements.find(el => el.id === elementId);
    if (element) {
        if (!element.animation) {
            element.animation = createDefaultAnimationConfig(elementId);
        }

        const timeline = createElementTimeline(elementId);
        const animation = createAnimation("fadeIn", {
            duration: 800,
            delay: 0,
            easing: "easeOut",
            startOpacity: 0,
            endOpacity: 1,
        });

        timeline.animations.push(animation);
        element.animation.timelines.push(timeline);
    }

    renderSlidesFromState();
    buildPropertiesPanel();
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION ENGINE USAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Programmatically add animation and play
 */
function examplePlayAnimation() {
    const engine = getAnimationEngine();
    const elementId = state.selectedIds[0];

    if (!elementId) return;

    // Clear previous animations
    engine.clearAnimations(elementId);

    // Add animation
    const animation = createAnimation("scaleInPlace", {
        duration: 600,
        startScale: 0.5,
        endScale: 1,
        startOpacity: 0,
        endOpacity: 1,
    });

    engine.addAnimation(elementId, animation, 0);

    // Play animation
    engine.play();

    // Optional: Stop after animation completes
    setTimeout(() => {
        engine.pause();
        engine.seek(0);
    }, 600);
}

/**
 * Example: Scrub through animation with mouse or slider
 */
function exampleScrubAnimation() {
    const engine = getAnimationEngine();
    const elementId = state.selectedIds[0];

    if (!elementId) return;

    engine.clearAnimations(elementId);

    const animation = createAnimation("transform", {
        duration: 1000,
        direction: "up",
        startOpacity: 0,
        endOpacity: 1,
    });

    engine.addAnimation(elementId, animation, 0);

    // Create slider to scrub
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1000";
    slider.value = "0";
    slider.style.width = "100%";
    slider.style.marginTop = "20px";

    slider.addEventListener("input", e => {
        engine.seek(Number(e.target.value));
    });

    document.body.appendChild(slider);
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION PRESETS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: List all available animation presets
 */
function exampleListPresets() {
    const allPresets = getAllPresets();

    console.group("Available Animation Presets");
    const byCategory = {};

    allPresets.forEach(preset => {
        if (!byCategory[preset.category]) {
            byCategory[preset.category] = [];
        }
        byCategory[preset.category].push(preset);
    });

    Object.entries(byCategory).forEach(([category, presets]) => {
        console.group(category);
        presets.forEach(p => {
            console.log(`  - ${p.name}: ${p.duration}ms, easing: ${p.easing}`);
        });
        console.groupEnd();
    });

    console.groupEnd();
}

/**
 * Example: Get a specific preset and modify it
 */
function exampleCustomizePreset() {
    const basePreset = getPreset("zoomIn");

    const customAnimation = {
        ...basePreset,
        duration: 1200, // Longer duration
        easing: "easeOutElastic", // More bouncy
    };

    console.log("Custom animation:", customAnimation);
    return customAnimation;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGGERED/LAGGED ANIMATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Apply same animation to multiple objects with delay (laggedStart)
 */
function exampleLaggedStartAnimation() {
    const engine = getAnimationEngine();
    const delay = 100; // 100ms delay between each object

    state.selectedIds.forEach((elementId, index) => {
        engine.clearAnimations(elementId);

        const animation = createAnimation("fadeIn", {
            duration: 600,
            delay: index * delay, // Stagger by index
            startOpacity: 0,
            endOpacity: 1,
        });

        engine.addAnimation(elementId, animation, 0);
    });

    engine.play();
}

// ═══════════════════════════════════════════════════════════════════════════
// SCIENTIFIC ANIMATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Animate SVG path drawing (for scientific diagrams)
 */
function exampleDrawSVGPath() {
    const engine = getAnimationEngine();
    const elementId = state.selectedIds[0];

    if (!elementId) return;

    const animation = createAnimation("write", {
        duration: 2000,
        easing: "easeOut",
    });

    engine.addAnimation(elementId, animation, 0);
    engine.play();
}

/**
 * Example: Create and uncreate animations for equations/symbols
 */
function exampleEquationAnimation() {
    const engine = getAnimationEngine();
    const elementId = state.selectedIds[0];

    if (!elementId) return;

    // Create (appear)
    const createAnim = createAnimation("create", {
        duration: 800,
        easing: "easeOut",
    });

    // Uncreate (disappear) - set to start after create
    const uncreateAnim = createAnimation("uncreate", {
        duration: 800,
        easing: "easeIn",
    });

    engine.addAnimation(elementId, createAnim, 0);
    engine.addAnimation(elementId, uncreateAnim, 800 + 1000); // 1s pause between

    engine.play();
}

// ═══════════════════════════════════════════════════════════════════════════
// EASING EXPLORATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: List all available easing functions
 */
function exampleListEasings() {
    console.group("Available Easing Functions");
    ANIMATION_EASINGS.forEach(easing => {
        console.log(`  - ${easing}`);
    });
    console.groupEnd();
}

/**
 * Example: Create custom spring easing
 */
function exampleSpringEasing() {
    const springEasing = createSpringEasing(
        100, // stiffness
        30, // damping
        1, // mass
    );

    // Test easing at different progress values
    const testPoints = [0, 0.25, 0.5, 0.75, 1];
    console.group("Spring Easing Values");
    testPoints.forEach(t => {
        console.log(`  ${(t * 100).toFixed(0)}%: ${springEasing(t).toFixed(3)}`);
    });
    console.groupEnd();
}

/**
 * Example: Create custom cubic-bezier easing
 */
function exampleCustomCubicBezier() {
    const bezierEasing = createCubicBezierEasing(
        0.25, // p1x
        0.46, // p1y
        0.45, // p2x
        0.94, // p2y
    );

    console.log("Custom cubic-bezier easing created");
    console.log("At 50% progress:", bezierEasing(0.5).toFixed(3));
}

// ═══════════════════════════════════════════════════════════════════════════
// ANIMATION STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Example: Serialize animation to JSON
 */
function exampleSerializeAnimation() {
    const element = getCurrentSlide()?.elements[0];
    if (!element) return;

    const config = normalizeElementAnimationConfig(element);
    const json = serializeAnimationConfig(config);

    console.log("Serialized animation config:");
    console.log(JSON.stringify(json, null, 2));
}

/**
 * Example: Check if element has animations
 */
function exampleCheckAnimations() {
    const element = getCurrentSlide()?.elements.find(el => el.id === state.selectedIds[0]);

    if (!element) {
        console.log("No element selected");
        return;
    }

    const hasAnims = hasAnimations(element);
    const duration = getAnimationDuration(element);

    console.log(`Element "${element.id}" has animations:`, hasAnims);
    console.log(`Total animation duration: ${duration}ms`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTING & DEBUGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test: Check if all animation utilities are loaded
 */
function testAnimationSystemReady() {
    const checks = {
        "Animation Engine": typeof getAnimationEngine === "function",
        "Animation Utils": typeof getEasingFunction === "function",
        "Animation State": typeof createAnimation === "function",
        "Animation Presets": typeof getPreset === "function",
        "Inspector Panel": typeof buildAnimationInspectorPanel === "function",
    };

    console.group("Animation System Status");
    let allReady = true;
    Object.entries(checks).forEach(([name, ready]) => {
        const status = ready ? "✓" : "✗";
        console.log(`${status} ${name}`);
        if (!ready) allReady = false;
    });
    console.groupEnd();

    if (allReady) {
        console.log("✓ Animation system is fully loaded and ready!");
    } else {
        console.warn("✗ Some animation components are missing");
    }

    return allReady;
}

/**
 * Debug: Log current engine state
 */
function debugAnimationEngine() {
    const engine = getAnimationEngine();

    console.group("Animation Engine State");
    console.log("Playhead time:", engine.playheadTime, "ms");
    console.log("Is playing:", engine.isPlaying);
    console.log("Speed:", engine.speed);
    console.log("Active timelines:", engine.timelines.size);

    engine.timelines.forEach((timeline, elementId) => {
        console.log(`  Element ${elementId}:`, timeline.animations.length, "animations");
    });

    console.groupEnd();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        // Quick start
        exampleApplyFadeInAnimation,
        examplePlayAnimation,
        exampleScrubAnimation,

        // Presets
        exampleListPresets,
        exampleCustomizePreset,

        // Staggered
        exampleLaggedStartAnimation,

        // Scientific
        exampleDrawSVGPath,
        exampleEquationAnimation,

        // Easing
        exampleListEasings,
        exampleSpringEasing,
        exampleCustomCubicBezier,

        // State
        exampleSerializeAnimation,
        exampleCheckAnimations,

        // Testing
        testAnimationSystemReady,
        debugAnimationEngine,
    };
}

// Auto-test on load
if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
        if (typeof testAnimationSystemReady === "function") {
            testAnimationSystemReady();
        }
    });
}
