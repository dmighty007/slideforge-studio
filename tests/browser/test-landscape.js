// Requires a running app with temporary/test data. SLIDEFORGE_TEST_URL defaults to localhost:8076.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");

(async () => {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const output = process.env.LANDSCAPE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "slideforge-landscape-"));
    fs.mkdirSync(output, { recursive: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("dialog", dialog => dialog.dismiss());
        await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { window.openStartScreen = () => false; }));
        await page.goto(process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/", { waitUntil: "networkidle" });
        await page.waitForFunction(() => typeof getSlidePlugin === "function" && getSlidePlugin("landscape") && typeof renderSlidesFromState === "function");
        const calculations = await page.evaluate(async () => {
            const plugin = getSlidePlugin("landscape"), base = plugin.normalize(plugin.defaultData);
            const context = _pluginRenderContext(plugin, { width: "640px", height: "420px" });
            await plugin.render(base, context);
            const api = window.SlideForgeLandscape, check = (ok, message) => { if (!ok) throw Error(message); };
            const expectError = (fn, message) => { let failed = false; try { fn(); } catch (_) { failed = true; } check(failed, message); };
            check(api.expression("-x^2 + 2y")(3, 4) === -1, "unary precedence / two-variable evaluation");
            check(api.expression("2^3^2")(0, 0) === 512, "power associativity");
            check(Math.abs(api.expression("sin(pi/2) + ln(e) + 2xy")(2, 3) - 14) < 1e-10, "functions / implicit multiplication");
            expectError(() => api.expression("window.alert(1)"), "JS must not be executable");
            expectError(() => api.expression("sin("), "incomplete equation must fail");
            const make = changes => api.model(plugin.normalize({ ...base, ...changes }), context.parseTable);
            const matrix = make({ input: "csv", csv: "y/x,3,1,0\n2,7,5,4\n0,3,1,0" });
            check(JSON.stringify(matrix.xs) === "[0,1,3]" && api.sample(matrix, 2, 1) === 4, "descending/nonuniform grid reordered incorrectly");
            const xyz = make({ input: "csv", csvFormat: "xyz", csv: "x,y,value\n1,1,3\n0,0,0\n0,1,2\n1,0,1" });
            check(api.sample(xyz, 0.25, 0.75) === 1.75, "shuffled xyz samples / interpolation");
            const firstMissing = make({ input: "csv", csvFormat: "xyz", csv: "0,0,NA\n1,0,1\n2,0,2\n1,1,2\n2,1,3" });
            check(firstMissing.xs[0] === 0 && firstMissing.missing === 2, "first missing sample was discarded as a header");
            expectError(() => make({ input: "csv", csvFormat: "xyz", csv: "0,0,1\n0,0,2\n1,0,3\n0,1,4" }), "duplicate coordinates must fail");
            expectError(() => make({ input: "csv", csvFormat: "xyz", csv: "0,0,1\n1,1,2\n2,2,3\n3,3,4" }), "scattered points must not invent a surface");
            const gap = make({ input: "csv", csv: "y/x,0,1,2,3\n0,,1,2,3\n1,1,2,3,4\n2,2,3,4,5" });
            check(gap.missing === 1 && api.sample(gap, 0.5, 0.5) === null && api.sample(gap, 2.5, 0.5) === 3, "missing values must stay masked");
            const contourGrid = make({ equation: "x", xMin: -1, xMax: 1, yMin: -1, yMax: 1, resolution: 9 });
            const contour = api.contours(contourGrid, [0])[0];
            check(contour.segments.length > 0 && contour.segments.every(s => s.every(p => Math.abs(p.x) < 1e-10)), "known f=x contour is wrong");
            const singular = make({ equation: "1/x", resolution: 9 });
            check(singular.missing === 9 && api.sample(singular, 0, 0) === null, "singularity should leave a gap");
            const shifted = make({ equation: "x+y", subtractMin: true });
            check(shifted.low === 0 && shifted.offset === -4, "subtract-min normalization");
            expectError(() => make({ colorMin: "4", colorMax: "2" }), "reversed color limits must fail");
            expectError(() => make({ xMin: 2, xMax: 1 }), "reversed domain must fail");
            for (const view of ["heatmap", "contours", "both", "surface"]) {
                const raw = await plugin.render(plugin.normalize({ ...base, view, title: '<script>alert("x")</script>' }), context);
                const clean = cleanPluginSvg(raw), doc = new DOMParser().parseFromString(clean, "image/svg+xml");
                check(!doc.querySelector("parsererror, script, foreignObject"), `${view} SVG invalid/unsafe`);
                const image = new Image(); image.src = _svgDataUrl(clean); await image.decode();
                check(image.naturalWidth === 640 && image.naturalHeight === 420, `${view} SVG dimensions`);
            }
            const dense = await plugin.render(plugin.normalize({ ...base, equation: "sin(30x)*cos(30y)", resolution: 81, levels: 24 }), context);
            check(encodeURIComponent(dense).length < 1800000, "dense fallback exceeds the saved-preview budget");
            check(make({ equation: "3", view: "contours" }).low === 3, "constant fields should work");
            return { numericalChecks: "passed", viewsDecoded: 4, maskedSamples: gap.missing };
        });
        console.log("PASS numerical validation and all static views", calculations);

        const id = await page.evaluate(async () => {
            state.slides = [{ id: "landscape-test-slide", layoutId: "blank", masterId: "none", elements: [] }, { id: "landscape-next-slide", layoutId: "blank", masterId: "none", elements: [] }];
            setCurrentSlideIndex(0); renderSlidesFromState();
            return insertPluginElement("landscape", { view: "surface", resolution: 25 }, { ask: false });
        });
        await page.waitForFunction(id => Boolean(_findPluginElementInState(id)?.pluginPreview), id);
        const root = page.locator(`.presentation-slide [id="${id}"]`).first();
        await root.locator(".plugin-live-toggle").click();
        await root.locator("canvas").waitFor();
        await page.evaluate(id => {
            const element = _findPluginElementInState(id);
            element.width = `${Math.round(parseFloat(element.width) * 0.85)}px`;
            document.querySelector(`.presentation-slide [id="${id}"]`).style.width = element.width;
        }, id);
        await page.waitForFunction(id => {
            const e = _findPluginElementInState(id), canvas = document.querySelector(`.presentation-slide [id="${id}"] canvas`);
            return canvas?.width === Math.round(Math.max(320, parseFloat(e.width)) * Math.min(2, window.devicePixelRatio || 1));
        }, id);
        const canvas = root.locator("canvas"), bounds = await canvas.boundingBox();
        await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
        await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, { steps: 5 }); await page.mouse.up();
        await root.getByRole("button", { name: "Use view for export" }).click();
        await page.waitForFunction(id => _findPluginElementInState(id)?.pluginData.yaw !== -35, id);
        await page.waitForFunction(id => { const e = _findPluginElementInState(id); return e.pluginPreviewKey === _pluginPreviewKey(getSlidePlugin("landscape"), e.pluginData, e); }, id);
        const persistence = await page.evaluate(id => {
            const saved = getPersistableState(), e = saved.slides[0].elements.find(e => e.id === id);
            return { data: e.pluginData, preview: e.pluginPreview, cameraKept: e.pluginData.yaw !== -35 };
        }, id);
        assert(persistence.cameraKept && persistence.preview.startsWith("data:image/svg+xml"), "saved camera/preview missing");
        const reloaded = await page.evaluate(async id => {
            await saveCurrentProject();
            const project = currentPresentationId;
            if (!project || !await loadProjectById(project)) return null;
            const e = _findPluginElementInState(id);
            return e ? { data: e.pluginData, preview: e.pluginPreview } : null;
        }, id);
        assert(reloaded && reloaded.data.yaw === persistence.data.yaw && reloaded.preview.startsWith("data:image/svg+xml"), "backend save/reload lost landscape data or still");
        console.log("PASS editor rotation, explicit saved camera and backend save/reload");

        await page.evaluate(() => document.body.classList.add("play-mode-active"));
        await root.locator("canvas").waitFor();
        const liveBounds = await root.locator("canvas").boundingBox();
        await page.mouse.move(liveBounds.x + liveBounds.width / 2, liveBounds.y + liveBounds.height / 2);
        await page.mouse.wheel(0, 120);
        await page.mouse.click(liveBounds.x + liveBounds.width / 2, liveBounds.y + liveBounds.height / 2);
        assert.equal(await page.evaluate(() => currentSlideIndex), 0, "plot gestures advanced the show");
        assert.equal(await root.locator(".plugin-live-toggle").isVisible(), false, "editor toggle leaked into presentation");
        await page.waitForFunction(() => document.querySelector(".landscape-readout")?.textContent.includes("interpolated"));
        await page.evaluate(() => window.switchSlide(1));
        await page.waitForFunction(() => !document.querySelector(".plugin-live-view"));
        await page.evaluate(() => window.switchSlide(0));
        await root.locator("canvas").waitFor();
        const fallback = await page.evaluate(async () => {
            const slide = document.querySelector(".presentation-slide");
            const restore = await showPluginPicturesForCapture(slide);
            const result = { liveHidden: slide.querySelector(".plugin-live-view").hidden, imageShown: !slide.querySelector(".plugin-element-content img").hidden };
            restore(); return result;
        });
        assert(fallback.liveHidden && fallback.imageShown, "capture must show the still, not the live controls");
        await page.evaluate(() => document.body.classList.remove("play-mode-active"));
        await page.waitForFunction(() => !document.querySelector(".plugin-live-view"));
        console.log("PASS presentation hover, gesture ownership, capture fallback and exit cleanup");

        // Actual export artifacts: the presentation has two slides, only the first holds a landscape.
        const pptxDownload = page.waitForEvent("download", { timeout: 60000 });
        await page.evaluate(() => exportPPTX());
        const pptx = await pptxDownload; await pptx.saveAs(path.join(output, "landscape.pptx"));
        const pdfDownload = page.waitForEvent("download", { timeout: 60000 });
        await page.evaluate(() => exportPDF());
        const pdf = await pdfDownload; await pdf.saveAs(path.join(output, "landscape.pdf"));
        assert(fs.statSync(path.join(output, "landscape.pptx")).size > 1000);
        assert(fs.statSync(path.join(output, "landscape.pdf")).size > 1000);
        await root.screenshot({ path: path.join(output, "landscape.png") });
        console.log("PASS actual PowerPoint and PDF exports", output);

        await page.evaluate(async id => updatePluginElementData(id, { input: "csv", csvFormat: "matrix", csv: "y/x,0,1,2\n0,0,1,2\n1,1,2,3\n2,2,3,4", view: "both" }), id);
        await root.locator(".plugin-live-toggle").click();
        await root.locator("canvas").waitFor();
        await page.evaluate(id => {
            const canvas = document.querySelector(`.presentation-slide [id="${id}"] canvas`), r = canvas.getBoundingClientRect();
            canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
        }, id);
        assert((await root.locator(".landscape-readout").textContent()).includes("interpolated"), "CSV heatmap inspection failed");
        await page.evaluate(() => disableSlidePlugin("landscape"));
        await page.waitForFunction(() => _sfPluginLiveViews.size === 0);
        assert(await root.locator(".plugin-element-content img").isVisible(), "disabling must retain the saved picture");
        await page.evaluate(() => enableSlidePlugin("landscape"));
        await root.locator(".plugin-live-toggle").click();
        await root.locator("canvas").waitFor();
        await page.evaluate(id => { state.slides[0].elements = state.slides[0].elements.filter(e => e.id !== id); renderSlidesFromState(); }, id);
        await page.waitForFunction(() => _sfPluginLiveViews.size === 0);
        assert.equal(errors.length, 0, errors.join("\n"));
        console.log("PASS deletion disposes live views; no uncaught browser errors");
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
