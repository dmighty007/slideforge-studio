// Capture current app UI and public, illustrative scientific examples for MkDocs.
// node tools/capture-docs-visuals.cjs --url=http://127.0.0.1:8094/
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, ".."), OUT = path.join(ROOT, "docs", "images", "current");
const URL = process.argv.find(a => a.startsWith("--url="))?.slice(6) || "http://127.0.0.1:8094/";
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
        const page = await context.newPage(), errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.addInitScript(() => {
            try { localStorage.setItem("pptmaker_properties_panel_visible", "1"); } catch (_) {}
            document.addEventListener("DOMContentLoaded", () => { window.openStartScreen = () => false; });
        });
        await page.goto(URL, { waitUntil: "networkidle" });
        await page.waitForFunction(() => getSlidePlugin("curve-fit") && typeof createMermaidElementData === "function" && !isPresentationHydrating());
        const pdb = fs.readFileSync(path.join(ROOT, "tools", "showcase", "1ubq.pdb"), "utf8");
        const ids = await page.evaluate(pdb => {
            _presentationPersistenceEnabled = false; window.schedulePresentationAutosave = () => {};
            const slides = [], title = (s, text, subtitle) => {
                s.elements.push({ id: "heading-" + s.id, type: "text", x: 60, y: 54, width: "1150px", height: "75px", content: text, bulletStyle: "none", styles: { fontFamily: '"Manrope", sans-serif', fontSize: "43px", fontWeight: "800", color: "#132f3a", zIndex: 2 } });
                s.elements.push({ id: "subtitle-" + s.id, type: "text", x: 62, y: 145, width: "1150px", height: "45px", content: subtitle, bulletStyle: "none", styles: { fontFamily: '"Manrope", sans-serif', fontSize: "20px", color: "#526b73", zIndex: 3 } });
            };
            for (let i = 0; i < 4; i++) slides.push({ id: "docs-slide-" + i, layoutId: "blank", masterId: "none", elements: [] });
            title(slides[0], "Fit the model where the data lives.", "Illustrative dose-response data • editable curves and parameters");
            title(slides[1], "Explore the surface. Change the view.", "Illustrative double-well equation • orthographic 3D surface");
            title(slides[2], "Show the structure. Explain the mechanism.", "Ubiquitin • PDB 1UBQ • native, interactive molecular view");
            title(slides[3], "Reveal the mechanism, one step at a time.", "A simple editable diagram • illustrative process");
            const molecule = { id: "docs-molecule", type: "molecule", ...createMoleculeElementData({ data: pdb, name: "Ubiquitin · PDB 1UBQ" }),
                x: 60, y: 218, width: "1160px", height: "440px", moleculeBackgroundMode: "custom", moleculeAutoRotate: false, moleculeProjection: "orthographic",
                styles: { backgroundColor: "#142d37", borderRadius: "16px", zIndex: 4 } };
            slides[2].elements.push(molecule);
            const diagram = createMermaidElementData({ mermaidSource: "flowchart LR\nA[Input or stimulus] --> B[State transition]\nB --> C[Measured response]", theme: "default", style: { fontSize: 24 } });
            Object.assign(diagram, { id: "docs-diagram", x: 60, y: 245, width: "1160px", height: "330px", styles: { zIndex: 4 } }); slides[3].elements.push(diagram);
            state = { ...buildDefaultPresentationState(), presentationTheme: "blank", pageSetup: "talk-16-9", slides };
            setCurrentSlideIndex(0); applyPresentationTheme("blank", { persist: false }); setCurrentPresentationTitle("Scientific figures — documentation examples"); renderSlidesFromState();
            return { molecule: molecule.id, diagram: diagram.id };
        }, pdb);
        const fitId = await page.evaluate(async () => {
            const id = await insertPluginElement("curve-fit", { fontSize: 18 }, { ask: false });
            Object.assign(_findPluginElementInState(id), { x: 60, y: 224, width: "1160px", height: "440px" }); renderSlidesFromState(); return id;
        });
        await page.waitForFunction(id => Boolean(_findPluginElementInState(id)?.pluginPreview), fitId);
        await page.evaluate(id => { selectElement(id); buildPropertiesPanel(); }, fitId);
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, "editor.png") });
        await page.evaluate(() => clearSelection());
        await page.locator(".presentation-slide.present .plugin-live-toggle").evaluateAll(nodes => nodes.forEach(n => n.style.visibility = "hidden"));
        await page.locator(".presentation-slide.present").screenshot({ path: path.join(OUT, "curve-fit.png") });

        await page.evaluate(() => switchSlide(1));
        const surface = await page.evaluate(async () => {
            const id = await insertPluginElement("landscape", { view: "surface", equation: "(x^2-1)^2+y^2", title: "", stage: "theme", resolution: 33, autoRotate: false, fontSize: 16 }, { ask: false });
            Object.assign(_findPluginElementInState(id), { x: 60, y: 214, width: "1160px", height: "450px" }); renderSlidesFromState(); clearSelection(); return id;
        });
        await page.waitForFunction(id => Boolean(_findPluginElementInState(id)?.pluginPreview), surface);
        await page.locator(".presentation-slide.present .plugin-live-toggle").click();
        await page.locator(".presentation-slide.present canvas.landscape-canvas").waitFor();
        await page.waitForTimeout(700);
        await page.locator(".presentation-slide.present").screenshot({ path: path.join(OUT, "landscape.png") });
        await page.evaluate(() => switchSlide(2));
        await page.waitForTimeout(2000);
        await page.locator(".presentation-slide.present").screenshot({ path: path.join(OUT, "molecule.png") });
        await page.evaluate(() => switchSlide(3));
        await page.waitForTimeout(600);
        await page.locator(".presentation-slide.present").screenshot({ path: path.join(OUT, "mechanism.png") });
        if (errors.length) throw Error(errors.join("\n"));
        execFileSync(process.env.PYTHON || (fs.existsSync(path.join(ROOT, ".venv", "bin", "python")) ? path.join(ROOT, ".venv", "bin", "python") : "python"), ["-c", [
            "from PIL import Image", "from pathlib import Path", "folder=Path(" + JSON.stringify(OUT) + ")",
            "for p in folder.glob('*.png'):", " image=Image.open(p).convert('RGB')", " image.save(p.with_suffix('.webp'),quality=87,method=6)", " p.unlink()",
        ].join("\n")]);
        fs.writeFileSync(path.join(OUT, "README.txt"), "Current application captures, generated with tools/capture-docs-visuals.cjs. The chart, surface and process diagram are illustrative. The structure is the bundled Ubiquitin PDB 1UBQ. No user trajectory or private research data is included.\n");
        console.log("Captured current app visuals:", OUT);
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
