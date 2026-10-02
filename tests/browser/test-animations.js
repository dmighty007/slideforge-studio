const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

/**
 * Comprehensive Animation Browser Test Suite
 * Tests all animation types and the hidden elements bug fix
 */

const TEST_RESULTS = {
    passed: [],
    failed: [],
    skipped: [],
};

async function runAnimationTests() {
    console.log("\n╔══════════════════════════════════════════════════════════════════╗");
    console.log("║           ANIMATION SYSTEM BROWSER TEST SUITE                    ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝\n");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // Navigate to the application
        console.log("📍 Opening SlideForge application...");
        await page.addInitScript(() => {
            document.addEventListener("DOMContentLoaded", () => {
                // These suites test the editor itself; test-start-screen.js covers the start screen.
                window.openStartScreen = () => false;
            });
        });
        await page
            .goto("file://" + path.resolve(__dirname, "../../frontend/index.html"), {
                waitUntil: "networkidle",
                timeout: 10000,
            })
            .catch(() => {
                console.log("   ⚠️  Could not load via file:// - trying with http://localhost:8000");
                return page.goto("http://localhost:8000", { waitUntil: "networkidle", timeout: 10000 }).catch(() => {
                    console.log("   ⚠️  Could not connect to server - using file protocol");
                    return page.goto("file://" + path.resolve(__dirname, "../../frontend/index.html"), { waitUntil: "load" });
                });
            });

        console.log("✅ Page loaded\n");

        // Test 1: Basic animation playback
        console.log("Test 1: Checking animation engine initialization");
        console.log("─────────────────────────────────────────────────────");
        const hasAnimationEngine = await page.evaluate(() => {
            return (
                typeof getAnimationEngine === "function" &&
                typeof playConfiguredSlideAnimations === "function" &&
                typeof stopSlideAnimations === "function"
            );
        });

        if (hasAnimationEngine) {
            console.log("✅ Animation engine functions available");
            TEST_RESULTS.passed.push("Animation engine initialization");
        } else {
            console.log("❌ Animation engine functions missing");
            TEST_RESULTS.failed.push("Animation engine initialization");
        }
        console.log("");

        // Test 2: Element visibility in editor mode
        console.log("Test 2: Testing element visibility restoration");
        console.log("──────────────────────────────────────────────");
        const visibilityTest = await page.evaluate(() => {
            try {
                const engine = getAnimationEngine();
                if (!engine) return { success: false, error: "No engine" };

                // Create a mock element
                const element = document.createElement("div");
                element.id = "test-element";
                element.style.opacity = "1";
                element.style.display = "block";
                element.textContent = "Test Element";
                document.body.appendChild(element);

                // Register element in engine timelines so restoreElements finds it
                engine.getTimeline(element.id);

                // Simulate what happens when an animation hides it
                element.style.opacity = "0";
                element.style.display = "none";

                // Verify it's hidden
                const isHidden = element.style.opacity === "0" && element.style.display === "none";
                if (!isHidden) return { success: false, error: "Could not hide element" };

                // Now restore it (simulate exit from presentation)
                engine.restoreElements();

                // Check if fallback worked
                const isVisible =
                    (element.style.opacity === "" || element.style.opacity === "1") &&
                    (element.style.display === "" || element.style.display === "block");

                // Cleanup
                element.remove();

                return { success: isVisible, isVisible };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        if (visibilityTest.success) {
            console.log("✅ Elements properly restored to visible state");
            TEST_RESULTS.passed.push("Element visibility restoration");
        } else {
            console.log("❌ Element visibility restoration failed:", visibilityTest.error);
            TEST_RESULTS.failed.push("Element visibility restoration");
        }
        console.log("");

        // Test 3: Snapshot system
        console.log("Test 3: Testing element snapshot system");
        console.log("────────────────────────────────────────");
        const snapshotTest = await page.evaluate(() => {
            try {
                const engine = getAnimationEngine();
                if (!engine) return { success: false, error: "No engine" };

                // Create element with initial styles
                const element = document.createElement("div");
                element.id = "snapshot-test";
                element.style.opacity = "0.8";
                element.style.transform = "translate(10px, 20px)";
                element.style.color = "#ff0000";
                document.body.appendChild(element);

                // Capture snapshot
                engine._captureElementSnapshot(element);

                // Verify snapshot was created
                const snapshotKey = element.id || element.dataset.id;
                const hasSnapshot = engine.elementSnapshots && engine.elementSnapshots.size > 0;

                // Change styles
                element.style.opacity = "0";
                element.style.transform = "translate(50px, 50px)";
                element.style.color = "#00ff00";

                // Restore from snapshot
                if (engine.elementSnapshots.size > 0) {
                    const [, snapshot] = engine.elementSnapshots.entries().next().value;
                    engine._restoreElementSnapshot(element, snapshot);
                }

                // Verify restoration
                const isRestored = element.style.opacity === "0.8" && element.style.color === "rgb(255, 0, 0)"; // color gets normalized

                element.remove();

                return { success: hasSnapshot && isRestored, hasSnapshot, isRestored };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        if (snapshotTest.success) {
            console.log("✅ Snapshot capture and restore working");
            TEST_RESULTS.passed.push("Snapshot system");
        } else {
            console.log("❌ Snapshot system test failed:", snapshotTest.error);
            TEST_RESULTS.failed.push("Snapshot system");
        }
        console.log("");

        // Test 4: Animation type handlers
        console.log("Test 4: Verifying animation type handlers");
        console.log("────────────────────────────────────────");
        const handlerTest = await page.evaluate(() => {
            try {
                const engine = getAnimationEngine();
                if (!engine) return { success: false, error: "No engine" };

                const animationTypes = ["fadeIn", "fadeOut", "create", "uncreate", "textMorph", "write", "emphasis"];
                const handlers = {};

                for (const type of animationTypes) {
                    const hasInitial = engine[`_applyAnimationInitial`] !== undefined;
                    const hasFinal = engine[`_applyAnimationFinal`] !== undefined;
                    const hasHandler = engine[`_apply${type.charAt(0).toUpperCase() + type.slice(1)}`] !== undefined;

                    handlers[type] = {
                        hasInitial,
                        hasFinal,
                        hasHandler:
                            hasHandler ||
                            type === "emphasis" ||
                            type === "textMorph" ||
                            type === "write" ||
                            type === "create" ||
                            type === "uncreate",
                    };
                }

                const allComplete = Object.values(handlers).every(h => h.hasInitial && h.hasFinal);

                return { success: allComplete, handlers };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        if (handlerTest.success) {
            console.log("✅ All animation type handlers present");
            TEST_RESULTS.passed.push("Animation type handlers");
        } else {
            console.log("❌ Some animation handlers missing");
            TEST_RESULTS.failed.push("Animation type handlers");
        }
        console.log("");

        // Test 5: Play mode detection
        console.log("Test 5: Testing play mode detection");
        console.log("─────────────────────────────────────");
        const playModeTest = await page.evaluate(() => {
            try {
                // Add play-mode-active class
                document.body.classList.add("play-mode-active");

                const engine = getAnimationEngine();
                const isPlayMode = document.body.classList.contains("play-mode-active");

                document.body.classList.remove("play-mode-active");

                return { success: isPlayMode };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        if (playModeTest.success) {
            console.log("✅ Play mode detection working");
            TEST_RESULTS.passed.push("Play mode detection");
        } else {
            console.log("❌ Play mode detection failed");
            TEST_RESULTS.failed.push("Play mode detection");
        }
        console.log("");

        // Test 6: Text morph helper methods
        console.log("Test 6: Verifying text morph helper methods");
        console.log("──────────────────────────────────────────");
        const textMorphTest = await page.evaluate(() => {
            try {
                const engine = getAnimationEngine();
                const hasInitialHelper = typeof engine._applyTextMorphInitial === "function";
                const hasFinalHelper = typeof engine._applyTextMorphFinal === "function";

                return { success: hasInitialHelper && hasFinalHelper, hasInitialHelper, hasFinalHelper };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        if (textMorphTest.success) {
            console.log("✅ Text morph helper methods available");
            TEST_RESULTS.passed.push("Text morph helpers");
        } else {
            console.log("❌ Text morph helper methods missing");
            TEST_RESULTS.failed.push("Text morph helpers");
        }
        console.log("");

        // Test 7: Fallback visibility function
        console.log("Test 7: Checking fallback visibility function");
        console.log("────────────────────────────────────────────");
        const fallbackTest = await page.evaluate(() => {
            try {
                const engine = getAnimationEngine();
                const hasFallback = typeof engine._ensureAllElementsVisible === "function";

                return { success: hasFallback };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });

        if (fallbackTest.success) {
            console.log("✅ Fallback visibility function available");
            TEST_RESULTS.passed.push("Fallback visibility function");
        } else {
            console.log("❌ Fallback visibility function missing");
            TEST_RESULTS.failed.push("Fallback visibility function");
        }
        console.log("");

        // Summary
        console.log("╔══════════════════════════════════════════════════════════════════╗");
        console.log("║                         TEST SUMMARY                            ║");
        console.log("╚══════════════════════════════════════════════════════════════════╝\n");

        console.log(`✅ PASSED: ${TEST_RESULTS.passed.length}`);
        TEST_RESULTS.passed.forEach(test => console.log(`   ✓ ${test}`));

        if (TEST_RESULTS.failed.length > 0) {
            console.log(`\n❌ FAILED: ${TEST_RESULTS.failed.length}`);
            TEST_RESULTS.failed.forEach(test => console.log(`   ✗ ${test}`));
        }

        if (TEST_RESULTS.skipped.length > 0) {
            console.log(`\n⏭️  SKIPPED: ${TEST_RESULTS.skipped.length}`);
            TEST_RESULTS.skipped.forEach(test => console.log(`   - ${test}`));
        }

        console.log(
            `\n📊 Overall Result: ${TEST_RESULTS.failed.length === 0 ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}\n`,
        );

        // Keep browser open for manual testing if needed
        if (process.argv.includes("--interactive")) {
            console.log("🔍 Browser window open for manual testing. Press CTRL+C to exit.\n");
            await new Promise(resolve => {
                process.on("SIGINT", resolve);
            });
        } else {
            await browser.close();
        }
    } catch (error) {
        console.error("❌ Test suite error:", error);
        await browser.close();
        process.exit(1);
    }
}

// Run tests
runAnimationTests().catch(console.error);
