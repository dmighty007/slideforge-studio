/**
 * Advanced Animation System - Test Suite
 * Validates new animation types and integrations
 */

// Test utilities
function testAnimationType(typeName, creatorFn, expectedProps) {
    try {
        const anim = creatorFn();

        // Check animation object structure
        if (!anim || typeof anim !== "object") {
            return { type: typeName, status: "FAIL", message: "Not an object" };
        }

        // Check type property
        if (anim.type !== typeName) {
            return { type: typeName, status: "FAIL", message: `Wrong type: ${anim.type}` };
        }

        // Check required properties
        const requiredProps = ["duration", "delay", "easing"];
        for (const prop of requiredProps) {
            if (!(prop in anim)) {
                return { type: typeName, status: "FAIL", message: `Missing required prop: ${prop}` };
            }
        }

        return { type: typeName, status: "PASS", properties: Object.keys(anim).length };
    } catch (error) {
        return { type: typeName, status: "ERROR", message: error.message };
    }
}

function testPathUtility(name, fn, testData) {
    try {
        const result = fn(...testData);
        if (result === null || result === undefined) {
            return { name, status: "FAIL", message: "Returned null/undefined" };
        }
        return { name, status: "PASS", resultType: typeof result };
    } catch (error) {
        return { name, status: "ERROR", message: error.message };
    }
}

function runAdvancedAnimationTests() {
    console.log("\n╔════════════════════════════════════════════════════════════════╗");
    console.log("║  ADVANCED ANIMATION SYSTEM TEST SUITE                          ║");
    console.log("╚════════════════════════════════════════════════════════════════╝\n");

    const results = [];

    // Test 1: Animation Type Creation
    console.log("🔍 Testing Animation Type Creation...");
    results.push(
        testAnimationType("replacementTransform", () => createReplacementTransformAnimation({ duration: 800 })),
    );
    results.push(testAnimationType("moveAlongPath", () => createMoveAlongPathAnimation({ duration: 2000 })));
    results.push(testAnimationType("textMorph", () => createTextMorphAnimation({ startText: "a", endText: "b" })));
    results.push(testAnimationType("animatedChart", () => createAnimatedChartAnimation({ chartType: "bar" })));
    results.push(
        testAnimationType("uncreateAdvanced", () => createUncreateAdvancedAnimation({ destructionMode: "fade" })),
    );
    results.push(testAnimationType("emphasis", () => createEmphasisAnimation({ emphasisType: "pulse" })));
    results.push(testAnimationType("blur", () => createBlurAnimation({ direction: "in" })));
    results.push(testAnimationType("flip3D", () => create3DFlipAnimation({ axis: "y" })));
    results.push(testAnimationType("glow", () => createGlowAnimation({ glowColor: "#ffff00" })));

    // Test 2: Path Utilities
    console.log("🔍 Testing Path Utilities...");

    const bezierPoints = {
        start: { x: 0, y: 0 },
        cp1: { x: 100, y: -100 },
        cp2: { x: 200, y: -100 },
        end: { x: 300, y: 0 },
    };

    results.push(testPathUtility("interpolateBezierCurve", interpolateBezierCurve, [bezierPoints, 0.5]));
    results.push(testPathUtility("calculateBezierTangent", calculateBezierTangent, [bezierPoints, 0.5]));
    results.push(testPathUtility("parseSVGPath", parseSVGPath, ["M100,100 L200,200 Q300,300 400,200"]));
    results.push(
        testPathUtility("interpolateAlongPath", interpolateAlongPath, [
            [
                { x: 0, y: 0 },
                { x: 100, y: 100 },
                { x: 200, y: 200 },
            ],
            0.5,
        ]),
    );

    // Test 3: Preset Library
    console.log("🔍 Testing Preset Library...");
    const presetNames = [
        "replacementTransformSmooth",
        "trajectorySmooth",
        "textReveal",
        "pulseEmphasis",
        "wiggleEmphasis",
        "bounceEmphasis",
        "heartbeatEmphasis",
        "blurInFocus",
        "blurOutOfFocus",
        "flip3DHorizontal",
        "flip3DVertical",
        "glowHighlight",
        "energyGlow",
        "uncreateExplode",
        "uncreaeShrink",
        "chartBarsReveal",
        "chartLinesDraw",
        "scatterPointsReveal",
    ];

    for (const presetName of presetNames) {
        const preset = ANIMATION_PRESETS[presetName];
        if (preset && preset.type && preset.duration !== undefined) {
            results.push({
                preset: presetName,
                status: "PASS",
                type: preset.type,
            });
        } else {
            results.push({
                preset: presetName,
                status: "FAIL",
                message: "Preset not found or incomplete",
            });
        }
    }

    // Test 4: Engine Integration
    console.log("🔍 Testing Engine Integration...");

    try {
        const engine = getAnimationEngine();
        const testAnimation = createMoveAlongPathAnimation({ duration: 800 });

        engine.addAnimation("test-element", testAnimation, 0);
        results.push({ test: "Engine.addAnimation", status: "PASS" });

        if (
            typeof engine.play === "function" &&
            typeof engine.pause === "function" &&
            typeof engine.seek === "function"
        ) {
            results.push({ test: "Engine methods exist", status: "PASS" });
        } else {
            results.push({ test: "Engine methods exist", status: "FAIL" });
        }

        engine.clearAnimations("test-element");
    } catch (error) {
        results.push({ test: "Engine Integration", status: "ERROR", message: error.message });
    }

    // Test 5: Global Export Validation
    console.log("🔍 Testing Global Exports...");

    const globalFunctions = [
        "createReplacementTransformAnimation",
        "createMoveAlongPathAnimation",
        "createTextMorphAnimation",
        "createAnimatedChartAnimation",
        "createUncreateAdvancedAnimation",
        "createEmphasisAnimation",
        "createBlurAnimation",
        "create3DFlipAnimation",
        "createGlowAnimation",
        "interpolateBezierCurve",
        "calculateBezierTangent",
        "parseSVGPath",
        "interpolateAlongPath",
    ];

    for (const fn of globalFunctions) {
        if (typeof window[fn] === "function") {
            results.push({ export: fn, status: "PASS" });
        } else {
            results.push({ export: fn, status: "FAIL", message: "Not exported to window" });
        }
    }

    // Print Results Summary
    console.log("\n");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("TEST RESULTS");
    console.log("═══════════════════════════════════════════════════════════════\n");

    const categories = {
        animationTypes: [],
        pathUtilities: [],
        presets: [],
        engine: [],
        exports: [],
        errors: [],
    };

    results.forEach(result => {
        if (result.type) categories.animationTypes.push(result);
        else if (result.name) categories.pathUtilities.push(result);
        else if (result.preset) categories.presets.push(result);
        else if (result.test) categories.engine.push(result);
        else if (result.export) categories.exports.push(result);

        if (result.status === "ERROR") categories.errors.push(result);
    });

    // Print by category
    const printCategory = (title, items) => {
        console.log(`\n${title}`);
        console.log("─".repeat(50));
        items.forEach(item => {
            const icon = item.status === "PASS" ? "✓" : item.status === "ERROR" ? "✗" : "○";
            const key = item.type || item.name || item.preset || item.test || item.export;
            console.log(`${icon} ${key}: ${item.status}`);
            if (item.message) console.log(`  → ${item.message}`);
        });
    };

    printCategory("📝 Animation Types", categories.animationTypes);
    printCategory("🔧 Path Utilities", categories.pathUtilities);
    printCategory("📚 Presets", categories.presets);
    printCategory("⚙️  Engine Integration", categories.engine);
    printCategory("🌐 Global Exports", categories.exports);

    // Summary Statistics
    console.log("\n" + "═".repeat(50));
    const totalTests = results.length;
    const passed = results.filter(r => r.status === "PASS").length;
    const failed = results.filter(r => r.status === "FAIL").length;
    const errors = results.filter(r => r.status === "ERROR").length;

    console.log(`
SUMMARY
──────────────────────────────────────
Total Tests:    ${totalTests}
✓ Passed:       ${passed}
○ Failed:       ${failed}
✗ Errors:       ${errors}
Pass Rate:      ${((passed / totalTests) * 100).toFixed(1)}%
    `);

    if (failed === 0 && errors === 0) {
        console.log("🎉 ALL TESTS PASSED!\n");
        return true;
    } else {
        console.log("⚠️  SOME TESTS FAILED\n");
        return false;
    }
}

// Performance test for path interpolation
function benchmarkPathInterpolation() {
    console.log("\n📊 Performance Benchmark: Path Interpolation\n");

    const bezierPoints = {
        start: { x: 0, y: 0 },
        cp1: { x: 100, y: -100 },
        cp2: { x: 200, y: -100 },
        end: { x: 300, y: 0 },
    };

    const iterations = 10000;

    // Benchmark Bezier interpolation
    console.time("Bezier Interpolation (10k iterations)");
    for (let i = 0; i < iterations; i++) {
        interpolateBezierCurve(bezierPoints, (i % 100) / 100);
    }
    console.timeEnd("Bezier Interpolation (10k iterations)");

    // Benchmark linear path interpolation
    const linearPoints = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i }));
    console.time("Linear Path Interpolation (10k iterations)");
    for (let i = 0; i < iterations; i++) {
        interpolateAlongPath(linearPoints, (i % 100) / 100);
    }
    console.timeEnd("Linear Path Interpolation (10k iterations)");

    // Benchmark SVG parsing
    const svgPath = "M100,100 L200,200 Q300,300 400,200 C500,100 600,200 700,100";
    console.time("SVG Path Parsing (1k iterations)");
    for (let i = 0; i < 1000; i++) {
        parseSVGPath(svgPath);
    }
    console.timeEnd("SVG Path Parsing (1k iterations)");

    console.log("\n✓ Benchmark complete\n");
}

// Export test functions
window.runAdvancedAnimationTests = runAdvancedAnimationTests;
window.benchmarkPathInterpolation = benchmarkPathInterpolation;

// Auto-run tests on page load if in debug mode
if (window.location.hash.includes("test")) {
    document.addEventListener("DOMContentLoaded", () => {
        runAdvancedAnimationTests();
        benchmarkPathInterpolation();
    });
}

console.log("✓ Advanced Animation Test Suite loaded");
console.log("  Run: runAdvancedAnimationTests()");
console.log("  Run: benchmarkPathInterpolation()");
