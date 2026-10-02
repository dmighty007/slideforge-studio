/**
 * Advanced Animation Integration Examples
 * Real-world usage patterns for the new animation system
 */

/**
 * Example 1: Molecular Trajectory Animation
 * Animate a molecule moving along a path with rotation
 */
function exampleMolecularTrajectory() {
    const engine = getAnimationEngine();

    // Get or create molecule element
    const moleculeId = "molecule-1";

    // Define trajectory control points (e.g., from MD simulation)
    const trajectory = {
        start: { x: 50, y: 50 },
        cp1: { x: 150, y: 0 }, // Intermediate control point
        cp2: { x: 250, y: 100 }, // Second control point
        end: { x: 350, y: 50 },
    };

    // Create animation
    const animation = createMoveAlongPathAnimation({
        duration: 3000, // 3 second trajectory
        easing: "easeInOut",
        pathType: "bezier",
        controlPoints: trajectory,
        followPath: true, // Rotate with path
    });

    engine.addAnimation(moleculeId, animation, 0);
    engine.play();

    console.log("✓ Molecular trajectory animation started");
}

/**
 * Example 2: Progressive Bar Chart Reveal
 * Show chart data one bar at a time with smooth animation
 */
function exampleAnimatedBarChart() {
    const engine = getAnimationEngine();
    const chartId = "chart-bars";

    const animation = createAnimatedChartAnimation({
        chartType: "bar",
        duration: 2000,
        animationMode: "staggered",
        staggerDelay: 150, // 150ms between each bar
        dataValues: [120, 180, 240, 210, 160],
        maxValue: 250,
        direction: "from-zero",
        easing: "easeOut",
    });

    engine.addAnimation(chartId, animation, 0);
    engine.play();

    console.log("✓ Chart animation started");
}

/**
 * Example 3: Equation Symbol Revelation
 * Reveal equation terms progressively
 */
function exampleEquationReveal() {
    const engine = getAnimationEngine();
    const equationId = "equation-display";

    // Sequence of equation transformations
    const keyframes = [
        { startText: "", endText: "E", time: 0 },
        { startText: "E", endText: "E = ", time: 500 },
        { startText: "E = ", endText: "E = m", time: 1000 },
        { startText: "E = m", endText: "E = mc", time: 1500 },
        { startText: "E = mc", endText: "E = mc²", time: 2000 },
    ];

    keyframes.forEach((kf, i) => {
        if (i < keyframes.length - 1) {
            const nextKf = keyframes[i + 1];
            const duration = nextKf.time - kf.time;

            const animation = createTextMorphAnimation({
                startText: kf.startText,
                endText: kf.endText,
                morphMode: "letter-by-letter",
                duration: duration,
                easing: "easeOut",
                startColor: "#4488ff",
                endColor: "#4488ff",
            });

            engine.addAnimation(equationId, animation, kf.time);
        }
    });

    engine.play();
    console.log("✓ Equation reveal sequence started");
}

/**
 * Example 4: Object Morphing with Color Shift
 * Transform shape while changing color
 */
function exampleShapeMorph() {
    const engine = getAnimationEngine();
    const shapeId = "circle-to-square";

    const animation = createReplacementTransformAnimation({
        duration: 1500,
        easing: "easeInOut",
        // Circle: geometry
        startGeometry: { width: 100, height: 100, x: 50, y: 50 },
        // Square: geometry
        endGeometry: { width: 150, height: 150, x: 25, y: 25 },
        // Color transition
        startColor: "#ff4488",
        endColor: "#4488ff",
        // Scale effect
        startScale: 1,
        endScale: 1.2,
        // Rotation during morph
        startRotation: 0,
        endRotation: 360,
    });

    engine.addAnimation(shapeId, animation, 0);
    engine.play();

    console.log("✓ Shape morph animation started");
}

/**
 * Example 5: Emphasis Effects Cascade
 * Apply multiple emphasis effects in sequence
 */
function exampleEmphasisCascade() {
    const engine = getAnimationEngine();

    const elements = ["button-1", "button-2", "button-3"];
    const delayBetweenButtons = 200;

    elements.forEach((elementId, index) => {
        const startTime = index * delayBetweenButtons;

        // Pulse effect
        const pulseAnim = createEmphasisAnimation({
            emphasisType: "pulse",
            cycles: 2,
            intensity: 0.25,
            duration: 600,
            easing: "easeInOut",
        });

        engine.addAnimation(elementId, pulseAnim, startTime);

        // Follow with bounce
        const bounceAnim = createEmphasisAnimation({
            emphasisType: "bounce",
            cycles: 1,
            intensity: 0.3,
            duration: 400,
            easing: "easeOut",
        });

        engine.addAnimation(elementId, bounceAnim, startTime + 700);
    });

    engine.play();
    console.log("✓ Emphasis cascade started");
}

/**
 * Example 6: Focus Transition with Blur
 * Blur out unfocused elements, focus on main element
 */
function exampleFocusTransition() {
    const engine = getAnimationEngine();

    const focusElement = "main-content";
    const blurElements = ["sidebar", "header-secondary", "footer"];

    // Blur out other elements
    blurElements.forEach(id => {
        const blurAnim = createBlurAnimation({
            direction: "out",
            startBlur: 0,
            endBlur: 10,
            startOpacity: 1,
            endOpacity: 0.4,
            duration: 800,
            easing: "easeInOut",
        });
        engine.addAnimation(id, blurAnim, 0);
    });

    // Focus main element
    const focusAnim = createBlurAnimation({
        direction: "in",
        startBlur: 10,
        endBlur: 0,
        startOpacity: 0.5,
        endOpacity: 1,
        duration: 800,
        easing: "easeOut",
    });
    engine.addAnimation(focusElement, focusAnim, 0);

    engine.play();
    console.log("✓ Focus transition started");
}

/**
 * Example 7: 3D Card Flip Presentation
 * Flip cards to reveal content
 */
function exampleCardFlips() {
    const engine = getAnimationEngine();

    const cards = ["card-1", "card-2", "card-3"];
    const flipDelay = 500;

    cards.forEach((cardId, index) => {
        const flipAnim = create3DFlipAnimation({
            axis: "y",
            rotation: 180,
            perspective: 1200,
            duration: 800,
            easing: "easeInOut",
        });

        const startTime = index * flipDelay;
        engine.addAnimation(cardId, flipAnim, startTime);
    });

    engine.play();
    console.log("✓ Card flip sequence started");
}

/**
 * Example 8: Glow Effect Highlight
 * Pulse glow on important elements
 */
function exampleGlowHighlight() {
    const engine = getAnimationEngine();

    const importantElements = ["alert-box", "highlight-text", "button-primary"];

    importantElements.forEach(id => {
        const glowAnim = createGlowAnimation({
            glowColor: "#ffff00",
            startBlur: 5,
            peakBlur: 25,
            pulses: 3,
            duration: 1500,
            easing: "easeInOut",
        });

        engine.addAnimation(id, glowAnim, 0);
    });

    engine.play();
    console.log("✓ Glow highlight started");
}

/**
 * Example 9: Complex Trajectory with Multiple Animations
 * Combine path animation with emphasis
 */
function exampleComplexSequence() {
    const engine = getAnimationEngine();
    const objectId = "animated-object";

    // Phase 1: Entrance with glow (0-500ms)
    const glowAnim = createGlowAnimation({
        glowColor: "#44ff44",
        startBlur: 3,
        peakBlur: 20,
        pulses: 2,
        duration: 500,
        easing: "easeOut",
    });
    engine.addAnimation(objectId, glowAnim, 0);

    // Phase 2: Move along path (500-2500ms)
    const pathAnim = createMoveAlongPathAnimation({
        pathType: "bezier",
        controlPoints: {
            start: { x: 0, y: 0 },
            cp1: { x: 100, y: -150 },
            cp2: { x: 200, y: -150 },
            end: { x: 300, y: 0 },
        },
        followPath: true,
        duration: 2000,
        easing: "easeInOut",
    });
    engine.addAnimation(objectId, pathAnim, 500);

    // Phase 3: Emphasis pulse at end (2500-3100ms)
    const pulseAnim = createEmphasisAnimation({
        emphasisType: "pulse",
        cycles: 2,
        intensity: 0.3,
        duration: 600,
        easing: "easeInOut",
    });
    engine.addAnimation(objectId, pulseAnim, 2500);

    engine.play();
    console.log("✓ Complex animation sequence started");
}

/**
 * Example 10: Animated Data Visualization
 * Progressive chart reveal with explanatory text
 */
function exampleDataVisualization() {
    const engine = getAnimationEngine();

    // Timeline
    const chartId = "data-chart";
    const labelId = "chart-label";
    const captionId = "chart-caption";

    // Animate chart bars
    const chartAnim = createAnimatedChartAnimation({
        chartType: "bar",
        animationMode: "staggered",
        staggerDelay: 100,
        dataValues: [50, 120, 180, 140, 90, 160],
        maxValue: 200,
        duration: 2000,
        easing: "easeOut",
    });
    engine.addAnimation(chartId, chartAnim, 0);

    // Fade in label
    const labelAnim = {
        type: "fadeIn",
        duration: 600,
        easing: "easeOut",
        startOpacity: 0,
        endOpacity: 1,
    };
    engine.addAnimation(labelId, labelAnim, 1000);

    // Text reveal caption
    const captionAnim = createTextMorphAnimation({
        startText: "",
        endText: "Data Growth Over Time",
        morphMode: "letter-by-letter",
        duration: 1200,
        easing: "easeOut",
    });
    engine.addAnimation(captionId, captionAnim, 1700);

    engine.play();
    console.log("✓ Data visualization animation started");
}

/**
 * Example 11: Destruction/Exit Effects
 * Advanced uncreate animations for object removal
 */
function exampleDestructionEffects() {
    const engine = getAnimationEngine();

    const destructionModes = [
        { id: "obj-1", mode: "fade" },
        { id: "obj-2", mode: "shrink" },
        { id: "obj-3", mode: "explode" },
        { id: "obj-4", mode: "disintegrate" },
    ];

    destructionModes.forEach((item, index) => {
        const uncreateAnim = createUncreateAdvancedAnimation({
            destructionMode: item.mode,
            duration: 800,
            easing: "easeOut",
            startOpacity: 1,
            endOpacity: 0,
            explosionVelocity: 8,
            fragmentCount: 12,
        });

        engine.addAnimation(item.id, uncreateAnim, index * 200);
    });

    engine.play();
    console.log("✓ Destruction effects started");
}

/**
 * Example 12: Interactive Animation Control
 * User-controlled animation with scrubbing
 */
function exampleInteractiveControl() {
    const engine = getAnimationEngine();
    const objectId = "interactive-object";

    // Create animation
    const animation = createMoveAlongPathAnimation({
        pathType: "bezier",
        controlPoints: {
            start: { x: 0, y: 0 },
            cp1: { x: 100, y: -100 },
            cp2: { x: 200, y: -100 },
            end: { x: 300, y: 0 },
        },
        followPath: true,
        duration: 2000,
        easing: "easeInOut",
    });
    engine.addAnimation(objectId, animation, 0);

    // Set up interactive controls
    window.playAnimation = () => engine.play();
    window.pauseAnimation = () => engine.pause();
    window.scrubAnimation = ms => engine.seek(ms);
    window.setSpeed = multiplier => engine.setSpeed(multiplier);

    console.log("✓ Interactive controls available:");
    console.log("  playAnimation()");
    console.log("  pauseAnimation()");
    console.log("  scrubAnimation(ms)");
    console.log("  setSpeed(multiplier)");
}

// Export examples
window.exampleMolecularTrajectory = exampleMolecularTrajectory;
window.exampleAnimatedBarChart = exampleAnimatedBarChart;
window.exampleEquationReveal = exampleEquationReveal;
window.exampleShapeMorph = exampleShapeMorph;
window.exampleEmphasisCascade = exampleEmphasisCascade;
window.exampleFocusTransition = exampleFocusTransition;
window.exampleCardFlips = exampleCardFlips;
window.exampleGlowHighlight = exampleGlowHighlight;
window.exampleComplexSequence = exampleComplexSequence;
window.exampleDataVisualization = exampleDataVisualization;
window.exampleDestructionEffects = exampleDestructionEffects;
window.exampleInteractiveControl = exampleInteractiveControl;

console.log("✓ Advanced Animation Examples loaded");
console.log("  Available examples:");
console.log("    exampleMolecularTrajectory()");
console.log("    exampleAnimatedBarChart()");
console.log("    exampleEquationReveal()");
console.log("    exampleShapeMorph()");
console.log("    exampleEmphasisCascade()");
console.log("    exampleFocusTransition()");
console.log("    exampleCardFlips()");
console.log("    exampleGlowHighlight()");
console.log("    exampleComplexSequence()");
console.log("    exampleDataVisualization()");
console.log("    exampleDestructionEffects()");
console.log("    exampleInteractiveControl()");
