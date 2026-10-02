/**
 * Animation Properties Tests
 * Comprehensive test suite for new animation properties and types
 */

// ==========================================
// PHASE 1: PROPERTY STRUCTURE TESTS
// ==========================================

function testNewAnimationTypesExist() {
    console.log("🧪 Testing new animation types...");

    const newTypes = ["moveInPlace", "colorShift", "strokeAnimate", "scaleXY", "combinedTransform", "zIndex"];
    const allPresent = newTypes.every(type => ANIMATION_TRANSITION_TYPES.includes(type));

    if (allPresent) {
        console.log("✅ All new animation types registered");
        return true;
    } else {
        console.error(
            "❌ Missing animation types:",
            newTypes.filter(t => !ANIMATION_TRANSITION_TYPES.includes(t)),
        );
        return false;
    }
}

function testAnimationPropertyStructure() {
    console.log("🧪 Testing animation property structure...");

    const testCases = [
        {
            type: "moveInPlace",
            expectedProps: ["startX", "endX", "startY", "endY"],
        },
        {
            type: "colorShift",
            expectedProps: ["startColor", "endColor", "colorProperty"],
        },
        {
            type: "strokeAnimate",
            expectedProps: ["startStrokeWidth", "endStrokeWidth"],
        },
        {
            type: "scaleXY",
            expectedProps: ["startScaleX", "endScaleX", "startScaleY", "endScaleY"],
        },
        {
            type: "combinedTransform",
            expectedProps: [
                "startX",
                "endX",
                "startY",
                "endY",
                "startScaleX",
                "endScaleX",
                "startScaleY",
                "endScaleY",
                "startRotation",
                "endRotation",
            ],
        },
        {
            type: "zIndex",
            expectedProps: ["startZIndex", "endZIndex"],
        },
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        const animation = createAnimation(testCase.type);
        const hasAllProps = testCase.expectedProps.every(prop => prop in animation);

        if (hasAllProps) {
            console.log(`  ✅ ${testCase.type} has all expected properties`);
        } else {
            const missing = testCase.expectedProps.filter(p => !(p in animation));
            console.error(`  ❌ ${testCase.type} missing: ${missing.join(", ")}`);
            allPassed = false;
        }
    }

    return allPassed;
}

// ==========================================
// PHASE 2: ANIMATION ENGINE TESTS
// ==========================================

function testAnimationEngineHandlesNewTypes() {
    console.log("🧪 Testing animation engine handlers...");

    const engine = new AnimationEngine();
    const testElement = document.createElement("div");
    testElement.id = "test-elem-" + Date.now();
    testElement.style.position = "absolute";
    testElement.style.width = "100px";
    testElement.style.height = "100px";
    document.body.appendChild(testElement);

    const animations = [
        { type: "moveInPlace", startX: 0, endX: 100, startY: 0, endY: 50 },
        { type: "colorShift", startColor: "#000000", endColor: "#ff0000", colorProperty: "fill" },
        { type: "strokeAnimate", startStrokeWidth: 0, endStrokeWidth: 5 },
        { type: "scaleXY", startScaleX: 1, endScaleX: 2, startScaleY: 1, endScaleY: 0.5 },
        {
            type: "combinedTransform",
            startX: 0,
            endX: 100,
            startScaleX: 1,
            endScaleX: 1.5,
            startRotation: 0,
            endRotation: 90,
        },
        { type: "zIndex", startZIndex: 1, endZIndex: 100 },
    ];

    let allPassed = true;

    for (const animationConfig of animations) {
        try {
            const animation = createAnimation(animationConfig.type, animationConfig);
            engine.addAnimation(testElement.id, animation);
            engine.seek(animation.duration / 2);

            console.log(`  ✅ ${animationConfig.type} animation applied successfully`);
        } catch (error) {
            console.error(`  ❌ ${animationConfig.type} failed:`, error.message);
            allPassed = false;
        }
    }

    // Cleanup
    document.body.removeChild(testElement);

    return allPassed;
}

// ==========================================
// PHASE 3: PRESET TESTS
// ==========================================

function testNewPresetsExist() {
    console.log("🧪 Testing new animation presets...");

    const expectedPresets = {
        color: ["colorFadeFromRed", "colorPulse", "highlightBlink"],
        position: ["moveRight", "moveUp", "floatAround"],
        scale: ["scaleUpDown", "stretchHorizontal"],
        svg: ["strokeDraw", "strokeThicken"],
        advanced: ["slideAndGrow", "spinAndMove"],
    };

    let allPassed = true;

    for (const [category, presets] of Object.entries(expectedPresets)) {
        for (const presetName of presets) {
            if (presetName in ANIMATION_PRESETS) {
                const preset = ANIMATION_PRESETS[presetName];
                console.log(`  ✅ ${presetName} exists (category: ${category})`);
            } else {
                console.error(`  ❌ ${presetName} not found in presets`);
                allPassed = false;
            }
        }
    }

    return allPassed;
}

function testPresetStructureValidity() {
    console.log("🧪 Testing preset structure validity...");

    const requiredFields = ["name", "category", "type", "duration", "delay", "easing"];
    const newPresets = [
        "colorFadeFromRed",
        "colorPulse",
        "highlightBlink",
        "moveRight",
        "moveUp",
        "floatAround",
        "scaleUpDown",
        "stretchHorizontal",
        "strokeDraw",
        "strokeThicken",
        "slideAndGrow",
        "spinAndMove",
    ];

    let allPassed = true;

    for (const presetName of newPresets) {
        const preset = ANIMATION_PRESETS[presetName];
        const hasAllFields = requiredFields.every(field => field in preset);

        if (hasAllFields) {
            console.log(`  ✅ ${presetName} has all required fields`);
        } else {
            const missing = requiredFields.filter(f => !(f in preset));
            console.error(`  ❌ ${presetName} missing: ${missing.join(", ")}`);
            allPassed = false;
        }
    }

    return allPassed;
}

// ==========================================
// PHASE 4: PROPERTY INTERPOLATION TESTS
// ==========================================

function testColorInterpolation() {
    console.log("🧪 Testing color interpolation...");

    const testCases = [
        {
            from: "#000000",
            to: "#ffffff",
            progress: 0.5,
            name: "Black to White (50%)",
        },
        {
            from: "#ff0000",
            to: "#0000ff",
            progress: 0.75,
            name: "Red to Blue (75%)",
        },
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        try {
            const result = interpolateColor(testCase.from, testCase.to, testCase.progress);
            if (result && typeof result === "string" && result.startsWith("#")) {
                console.log(`  ✅ ${testCase.name}: ${result}`);
            } else {
                console.error(`  ❌ ${testCase.name}: Invalid result ${result}`);
                allPassed = false;
            }
        } catch (error) {
            console.error(`  ❌ ${testCase.name}: ${error.message}`);
            allPassed = false;
        }
    }

    return allPassed;
}

function testPositionInterpolation() {
    console.log("🧪 Testing position interpolation...");

    const testCases = [
        { from: 0, to: 100, progress: 0.5, expected: 50, name: "0 to 100 at 50%" },
        { from: -50, to: 50, progress: 0.75, expected: 25, name: "-50 to 50 at 75%" },
        { from: 100, to: 200, progress: 0, expected: 100, name: "100 to 200 at 0%" },
        { from: 0, to: 100, progress: 1, expected: 100, name: "0 to 100 at 100%" },
    ];

    let allPassed = true;

    for (const testCase of testCases) {
        try {
            const result = interpolate(testCase.from, testCase.to, testCase.progress);
            const margin = 0.01; // Allow small floating point errors
            if (Math.abs(result - testCase.expected) < margin) {
                console.log(`  ✅ ${testCase.name}: ${result}`);
            } else {
                console.error(`  ❌ ${testCase.name}: Expected ${testCase.expected}, got ${result}`);
                allPassed = false;
            }
        } catch (error) {
            console.error(`  ❌ ${testCase.name}: ${error.message}`);
            allPassed = false;
        }
    }

    return allPassed;
}

// ==========================================
// PHASE 5: INTEGRATION TESTS
// ==========================================

function testFullAnimationWorkflow() {
    console.log("🧪 Testing full animation workflow...");

    const engine = getAnimationEngine();
    const testElement = document.createElement("div");
    testElement.id = "test-workflow-" + Date.now();
    testElement.style.position = "absolute";
    testElement.style.width = "50px";
    testElement.style.height = "50px";
    testElement.style.backgroundColor = "#0000ff";
    document.body.appendChild(testElement);

    try {
        // Apply colorShift animation
        const colorAnim = createAnimation("colorShift", {
            startColor: "#0000ff",
            endColor: "#ff0000",
            duration: 500,
        });
        engine.addAnimation(testElement.id, colorAnim);

        // Apply moveInPlace animation
        const moveAnim = createAnimation("moveInPlace", {
            startX: 0,
            endX: 100,
            startY: 0,
            endY: 50,
            duration: 500,
        });
        engine.addAnimation(testElement.id, moveAnim);

        console.log("  ✅ Multiple animations added successfully");

        // Simulate animation playback
        engine.play();
        let animationFrameCount = 0;
        const checkAnimation = () => {
            animationFrameCount++;
            if (animationFrameCount < 5) {
                requestAnimationFrame(checkAnimation);
            } else {
                engine.pause();
                console.log("  ✅ Animation playback works");
            }
        };
        checkAnimation();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(testElement);
        }, 100);

        return true;
    } catch (error) {
        console.error("  ❌ Workflow failed:", error.message);
        document.body.removeChild(testElement);
        return false;
    }
}

// ==========================================
// MAIN TEST SUITE
// ==========================================

function runAllAnimationPropertyTests() {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 ANIMATION PROPERTIES TEST SUITE");
    console.log("=".repeat(60) + "\n");

    const results = [];

    // Phase 1: Property Structure
    console.log("PHASE 1: Property Structure Tests");
    console.log("-".repeat(40));
    results.push(["New animation types", testNewAnimationTypesExist()]);
    results.push(["Animation property structure", testAnimationPropertyStructure()]);
    console.log();

    // Phase 2: Animation Engine
    console.log("PHASE 2: Animation Engine Tests");
    console.log("-".repeat(40));
    results.push(["Animation engine handlers", testAnimationEngineHandlesNewTypes()]);
    console.log();

    // Phase 3: Presets
    console.log("PHASE 3: Animation Preset Tests");
    console.log("-".repeat(40));
    results.push(["New presets exist", testNewPresetsExist()]);
    results.push(["Preset structure validity", testPresetStructureValidity()]);
    console.log();

    // Phase 4: Interpolation
    console.log("PHASE 4: Property Interpolation Tests");
    console.log("-".repeat(40));
    results.push(["Color interpolation", testColorInterpolation()]);
    results.push(["Position interpolation", testPositionInterpolation()]);
    console.log();

    // Phase 5: Integration
    console.log("PHASE 5: Integration Tests");
    console.log("-".repeat(40));
    results.push(["Full animation workflow", testFullAnimationWorkflow()]);
    console.log();

    // Summary
    console.log("=".repeat(60));
    console.log("TEST SUMMARY");
    console.log("=".repeat(60));

    let passCount = 0;
    let failCount = 0;

    for (const [name, passed] of results) {
        const status = passed ? "✅ PASS" : "❌ FAIL";
        console.log(`${status}: ${name}`);
        if (passed) passCount++;
        else failCount++;
    }

    console.log("-".repeat(60));
    console.log(`Total: ${passCount} passed, ${failCount} failed`);
    console.log(`Success Rate: ${Math.round((passCount / results.length) * 100)}%`);
    console.log("=".repeat(60) + "\n");

    return failCount === 0;
}

// Export for use in browser console or test runners
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        runAllAnimationPropertyTests,
        testNewAnimationTypesExist,
        testAnimationPropertyStructure,
        testAnimationEngineHandlesNewTypes,
        testNewPresetsExist,
        testPresetStructureValidity,
        testColorInterpolation,
        testPositionInterpolation,
        testFullAnimationWorkflow,
    };
}
