// Mayavi-style comparison: actual WebGL pixels, shared scientific scales and real pointer/touch interactions.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert/strict");
(async () => {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
    const output = process.env.LANDSCAPE_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "slideforge-wigner-"));
    fs.mkdirSync(output, { recursive: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, hasTouch: true, acceptDownloads: true });
        const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.dismiss());
        await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { window.openStartScreen = () => false; }));
        await page.goto(process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/", { waitUntil: "networkidle" });
        await page.waitForFunction(() => typeof getSlidePlugin === "function" && getSlidePlugin("landscape"));
        const checks = await page.evaluate(async () => {
            const plugin = getSlidePlugin("landscape"), context = _pluginRenderContext(plugin, { width: "1100px", height: "520px" });
            await plugin.render(plugin.normalize(plugin.defaultData), context);
            const api = SlideForgeLandscape, check = (ok, why) => { if (!ok) throw Error(why); };
            const data = plugin.normalize({ ...plugin.defaultData, ...api.wignerPreset() }), grid = api.dataset(data, context.parseTable), scene = api.scene(data, grid, context);
            check(grid.surfaces.length === 3 && grid.low < 0 && grid.high > 0, "Wigner example must contain three signed surfaces");
            check(grid.colorMin === -0.5 && grid.colorMax === 0.5 && scene.planes.length === 3, "shared color limits / zero planes");
            const single = plugin.normalize({ ...data, view: "both" });
            check(!single.compare && api.model(single, context.parseTable).low < 0, "switching to 2D must show the editable first Wigner equation");
            check(grid.surfaces.every(s => Math.abs(api.sample(s, 0, 0) - 0.5) < 1e-10), "cat-state center values");
            const peaks = new Map();
            for (const face of scene.faces) for (const p of face.vertices) if (p.x === 0 && p.y === 0) peaks.set(face.surface, p.wz);
            check(peaks.size === 3 && new Set([...peaks.values()].map(z => z.toFixed(10))).size === 1, "equal values must have equal physical heights across surfaces");
            const unequalData = plugin.normalize({ ...data, comparison: "Small,exp(-x^2-y^2)\nLarge,4*exp(-x^2-y^2)", colorMin: "", colorMax: "", resolution: 17 });
            const unequal = api.scene(unequalData, api.dataset(unequalData, context.parseTable), context), heights = new Map();
            for (const face of unequal.faces) for (const p of face.vertices) if (p.x === 0 && p.y === 0) heights.set(face.surface, p.wz);
            const zero = unequal.planes[0].vertices[0].wz;
            check(Math.abs((heights.get(1) - zero) / (heights.get(0) - zero) - 4) < 1e-8, "per-surface normalization destroyed a 4:1 amplitude ratio");
            const shifted = api.dataset(plugin.normalize({ ...data, comparison: "Small,1+x^2+y^2\nLarge,10+x^2+y^2", subtractMin: true }), context.parseTable);
            check(shifted.surfaces[0].low === 0 && shifted.surfaces[1].low === 9, "minimum subtraction must be global");
            const canvas = document.createElement("canvas"), renderer = api.createSurfaceRenderer(canvas);
            check(Boolean(renderer) && renderer.render(scene), "WebGL renderer is required for this test");
            const gl = canvas.getContext("webgl");
            const read = () => { const pixels = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); let count = 0, hash = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) { count++; hash = (hash + pixels[i] * 3 + pixels[i + 1] * 5 + pixels[i + 2] * 7) >>> 0; } return { count, hash }; };
            const lit = read(); renderer.render({ ...scene, lighting: false }); const unlit = read();
            check(lit.count > 1000 && unlit.count > 1000 && lit.hash !== unlit.hash, "GPU pixels / lighting toggle did not change the surface");
            check(gl.getError() === gl.NO_ERROR, "WebGL reported an error"); renderer.dispose();
            const original = api.createSurfaceRenderer; let fallback;
            try { api.createSurfaceRenderer = () => null; fallback = api.snapshot(scene); } finally { api.createSurfaceRenderer = original; }
            const image = new Image(); image.src = fallback; await image.decode();
            check(image.naturalWidth === 1100, "non-WebGL fallback failed");
            return { surfaces: grid.surfaces.length, triangles: scene.faces.length * 2, gpuPixels: lit.count, fallbackDecoded: true, preview: api.snapshot(scene) };
        });
        fs.writeFileSync(path.join(output, "wigner-default.png"), Buffer.from(checks.preview.split(",")[1], "base64")); delete checks.preview;
        console.log("PASS shared scales, signed values, smooth GPU lighting and fallback", checks);
        const id = await page.evaluate(async () => {
            state.slides = [{ id: "wigner-slide", layoutId: "blank", masterId: "none", elements: [] }, { id: "next-slide", layoutId: "blank", masterId: "none", elements: [] }];
            setCurrentSlideIndex(0); renderSlidesFromState();
            return insertPluginElement("landscape", { example: "wigner" }, { ask: false });
        });
        await page.waitForFunction(id => _findPluginElementInState(id)?.pluginData.compare === true && Boolean(_findPluginElementInState(id)?.pluginPreview), id);
        const root = page.locator(`.presentation-slide [id="${id}"]`).first();
        await root.locator(".plugin-live-toggle").click();
        await page.waitForFunction(() => document.querySelector(".landscape-canvas")?.dataset.engine === "webgl");
        let bounds = await root.locator("canvas").boundingBox();
        const point = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
        await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 45, point.y + 15, { steps: 4 }); await page.mouse.up();
        await page.keyboard.down("Shift"); await page.mouse.down(); await page.mouse.move(point.x + 75, point.y + 35, { steps: 4 }); await page.mouse.up(); await page.keyboard.up("Shift");
        await page.waitForFunction(id => { const d = _findPluginElementInState(id)?.pluginData; return d && d.yaw !== -25 && Math.abs(d.panX) > 0.001; }, id);
        await root.locator("canvas").waitFor();
        bounds = await root.locator("canvas").boundingBox();
        const editorZoom = await page.evaluate(() => stateZoom);
        const cdp = await page.context().newCDPSession(page), cy = bounds.y + bounds.height * 0.5, cx = bounds.x + bounds.width * 0.5;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx - 35, y: cy, id: 1 }, { x: cx + 35, y: cy, id: 2 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx - 50, y: cy, id: 1 }, { x: cx + 50, y: cy, id: 2 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForFunction(id => _findPluginElementInState(id)?.pluginData.zoom > 1.2, id);
        const pinchResult = await page.evaluate(id => ({ zoom: _findPluginElementInState(id)?.pluginData.zoom, editorZoom: stateZoom }), id);
        assert(pinchResult.zoom > 1.2 && pinchResult.editorZoom === editorZoom, JSON.stringify(pinchResult));
        const saved = await page.evaluate(async id => { await saveCurrentProject(); const project = currentPresentationId; await loadProjectById(project); const e = _findPluginElementInState(id); return { data: e.pluginData, preview: e.pluginPreview }; }, id);
        assert(saved.data.compare && saved.data.zoom > 1.2 && saved.data.panX !== 0);
        console.log("PASS orbit, pan, real touch pinch and saved comparison camera");
        const preview = await page.evaluate(async id => {
            const e = _findPluginElementInState(id), plugin = getSlidePlugin("landscape"), context = _pluginRenderContext(plugin, e), data = plugin.normalize(e.pluginData);
            return SlideForgeLandscape.snapshot(SlideForgeLandscape.scene(data, SlideForgeLandscape.dataset(data, context.parseTable), context));
        }, id);
        fs.writeFileSync(path.join(output, "wigner.png"), Buffer.from(preview.split(",")[1], "base64"));
        const pdf = page.waitForEvent("download", { timeout: 60000 }); await page.evaluate(() => exportPDF()); await (await pdf).saveAs(path.join(output, "wigner.pdf"));
        const pptx = page.waitForEvent("download", { timeout: 60000 }); await page.evaluate(() => exportPPTX()); await (await pptx).saveAs(path.join(output, "wigner.pptx"));
        // The explorer stays open through saves; close it so the show alone owns the live view below.
        await root.locator(".plugin-live-toggle").click(); await page.waitForFunction(() => !document.querySelector(".plugin-live-view"));
        await page.evaluate(() => document.body.classList.add("play-mode-active")); await root.locator("canvas").waitFor();
        await root.getByRole("button", { name: "3D view" }).click();
        assert.equal(await page.evaluate(() => currentSlideIndex), 0, "a plot view button advanced the show");
        await page.evaluate(() => document.body.classList.remove("play-mode-active"));
        await page.waitForFunction(() => !document.querySelector(".plugin-live-view"));
        assert.equal(errors.length, 0, errors.join("\n"));
        console.log("PASS comparison image/PDF/PPTX exports and presentation cleanup", output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
