// Build a compact feature presentation using SlideForge itself. No user project is modified.
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "slideforge-feature-showcase");
const URL = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8090/";
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        page.on("dialog", d => d.dismiss());
        await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { window.openStartScreen = () => false; }));
        await page.goto(URL, { waitUntil: "networkidle" });
        await page.waitForFunction(() => typeof getSlidePlugin === "function" && getSlidePlugin("landscape") && typeof buildViewerBundle === "function" && !isPresentationHydrating());
        const protein = fs.readFileSync(path.join(ROOT, "tools", "showcase", "1ubq.pdb"), "utf8");
        await page.evaluate(protein => {
            _presentationPersistenceEnabled = false;
            window.schedulePresentationAutosave = () => {};
            const C = { paper: "#F4F3EE", ink: "#132F3A", muted: "#526B73", blue: "#365FF4", mint: "#138C78", gold: "#D79D40", dark: "#10232C", pale: "#E8ECE8", white: "#FFFFFF" };
            let count = 0, z = 0;
            const id = prefix => prefix + "-" + (++count);
            const box = (slide, x, y, w, h, color, radius = 0, border = "none") => {
                const element = { id: id("box"), type: "shape", shapeType: "rectangle", x, y, width: w + "px", height: h + "px", content: "", styles: { zIndex: z++, backgroundColor: color, borderRadius: radius + "px", border } };
                slide.elements.push(element); return element;
            };
            const text = (slide, content, x, y, w, h, size = 20, color = C.ink, weight = 500, extras = {}) => {
                const element = { id: id("text"), type: "text", content, x, y, width: w + "px", height: h + "px",
                    bulletStyle: "none", autoHeight: false, textFitMode: "fixed",
                    styles: { zIndex: z++, fontFamily: '"Manrope", sans-serif', fontSize: size + "px", fontWeight: String(weight),
                        lineHeight: "1.22", color, backgroundColor: "transparent", padding: "0px", border: "none", minWidth: "0px", minHeight: "0px", ...extras } };
                slide.elements.push(element); return element;
            };
            const animate = (element, { delay = 0, click = null, type = "fadeIn", duration = 650 } = {}) => {
                const animation = { id: id("animation"), name: "Reveal", category: "entrance", type, duration, delay, easing: "easeOut",
                    startOpacity: 0, endOpacity: 1, trigger: click ? "on-click" : "on-slide", ...(click ? { clickGroup: click } : {}) };
                element.animation = { elementId: element.id, timelines: [{ elementId: element.id, animations: [animation], totalDuration: delay + duration }] };
                return element;
            };
            const slide = (number, dark, transition, notes) => {
                const s = { id: "feature-slide-" + number, layoutId: "blank", masterId: "none", notes, presentationTransition: transition, elements: [] };
                box(s, 0, 0, 1280, 720, dark ? C.dark : C.paper);
                text(s, "SLIDEFORGE", 56, 37, 200, 24, 16, dark ? "#85CABC" : C.mint, 800, { letterSpacing: "0.16em" });
                text(s, "CAPABILITY SHOWCASE", 268, 39, 540, 24, 13, dark ? "#A0B6BD" : C.muted, 700, { letterSpacing: "0.14em" });
                text(s, String(number).padStart(2, "0") + " / 03", 1125, 37, 100, 24, 15, dark ? "#A0B6BD" : C.muted, 600, { textAlign: "right" });
                return s;
            };
            const a = slide(1, false, "fade",
                "Overview. The headline and three feature panels enter automatically. The response chart contains illustrative values, not experimental results. This deck demonstrates editable text/shapes/charts, native scientific objects, equation rendering, automatic entrance animations, click groups, and slide transitions. Use arrow keys or Space to continue.");
            animate(text(a, "Scientific figures.<br>Presentation ready.", 56, 94, 1120, 145, 58, C.ink, 800), { duration: 800 });
            animate(text(a, "Build from your data, explain with live objects, and keep the source editable.", 59, 254, 1120, 50, 23, C.muted, 500), { delay: 200 });
            const cardXs = [56, 454, 852], cardW = 372;
            for (let i = 0; i < 3; i++) animate(box(a, cardXs[i], 337, cardW, 274, C.white, 20), { delay: 350 + i * 180 });
            animate(text(a, "01   BUILD THE FIGURE", 80, 361, 320, 28, 13, C.mint, 800, { letterSpacing: "0.09em" }), { delay: 400 });
            animate(text(a, "Data stays editable", 80, 402, 320, 38, 25, C.ink, 800), { delay: 450 });
            animate(text(a, "Charts, equations and scientific plots", 80, 444, 320, 45, 17, C.muted), { delay: 500 });
            const chart = { id: id("chart"), type: "chart", chartType: "line", x: 78, y: 495, width: "320px", height: "96px",
                chartData: { labels: ["0", "1", "2", "3", "4"], datasets: [{ label: "Example response", data: [8, 23, 58, 82, 91], borderColor: C.blue, backgroundColor: "#DCE5FF", borderWidth: 3, pointRadius: 3, fill: false, tension: 0.35 }] },
                chartStyle: { legend: "none", xTitle: "", yTitle: "", grid: true, fontSize: 11, seriesColors: [C.blue] },
                styles: { zIndex: z++, backgroundColor: C.white, padding: "0px", border: "none" } };
            a.elements.push(chart); animate(chart, { delay: 550 });
            animate(text(a, "02   EXPLAIN THE SCIENCE", 478, 361, 320, 28, 13, C.blue, 800, { letterSpacing: "0.09em" }), { delay: 580 });
            animate(text(a, "Go beyond a screenshot", 478, 402, 320, 38, 24, C.ink, 800), { delay: 630 });
            animate(text(a, "Molecules, trajectories and 3D surfaces", 478, 444, 320, 45, 17, C.muted), { delay: 680 });
            animate(box(a, 478, 507, 324, 68, "#EAF1EF", 12), { delay: 730 });
            animate(text(a, "ROTATE   /   INSPECT   /   REPLAY", 492, 531, 298, 24, 12, C.mint, 800, { letterSpacing: "0.08em", textAlign: "center" }), { delay: 780 });
            animate(text(a, "03   TAKE IT WITH YOU", 876, 361, 320, 28, 13, "#94661E", 800, { letterSpacing: "0.09em" }), { delay: 760 });
            animate(text(a, "Keep the deck portable", 876, 402, 320, 38, 24, C.ink, 800), { delay: 810 });
            animate(text(a, "Import PPTX + Keynote. Export the story.", 876, 444, 320, 45, 17, C.muted), { delay: 860 });
            ["PPTX", "PDF", "HTML"].forEach((label, i) => {
                animate(box(a, 876 + i * 106, 519, 95, 44, "#F7F0E1", 10), { delay: 910 });
                animate(text(a, label, 876 + i * 106, 532, 95, 22, 13, "#94661E", 800, { textAlign: "center" }), { delay: 940 });
            });
            text(a, "Automatic entrances", 58, 655, 250, 26, 14, C.muted, 600);
            text(a, "Click-by-click reveals", 454, 655, 300, 26, 14, C.muted, 600);
            text(a, "Presenter notes + transitions", 852, 655, 370, 26, 14, C.muted, 600);

            const b = slide(2, true, "fade",
                "Scientific interaction demo. In SlideForge, both scientific objects mount live during presentation: drag the landscape or molecule and inspect the surface. Ubiquitin is the bundled PDB 1UBQ structure, not a simulation trajectory. The 3D surface is an illustrative mathematical double well. Auto rotation is enabled. PowerPoint and PDF preserve still images; the source deck keeps the native objects.");
            animate(text(b, "Keep the science interactive.", 56, 100, 1160, 86, 52, "#F0F5F3", 800), { duration: 750 });
            text(b, "Respond to a question by exploring the object on the slide.", 59, 188, 1120, 45, 22, "#B2C6CD");
            text(b, "A SURFACE YOU CAN INSPECT", 56, 259, 550, 25, 14, "#85CABC", 800, { letterSpacing: "0.08em" });
            text(b, "A STRUCTURE YOU CAN TURN", 664, 259, 550, 25, 14, "#85CABC", 800, { letterSpacing: "0.08em" });
            box(b, 56, 301, 560, 308, "#142D37", 16);
            box(b, 664, 301, 560, 308, "#142D37", 16);
            text(b, "Double-well landscape · illustrative f(x, y)", 72, 625, 544, 32, 16, "#B2C6CD", 500);
            text(b, "Ubiquitin · PDB 1UBQ · native molecule object", 680, 625, 544, 32, 16, "#B2C6CD", 500);
            text(b, "Live in SlideForge. PowerPoint and PDF retain still images.", 57, 680, 1150, 22, 13, "#8CAAB4", 500);
            const molecule = { id: id("molecule"), type: "molecule", ...createMoleculeElementData({ data: protein, name: "Ubiquitin · 1UBQ", format: "pdb" }),
                x: 680, y: 308, width: "528px", height: "294px", moleculeBackgroundMode: "custom", moleculeAutoRotate: true, moleculeProjection: "orthographic",
                styles: { zIndex: z++, backgroundColor: "#142D37", border: "none", borderRadius: "10px" } };
            b.elements.push(molecule);

            const c = slide(3, false, "slide",
                "Animation and workflow demonstration. The title appears automatically. Click once to reveal Import, again to reveal Build, and again to reveal Present. Shared click groups keep each card's shapes and text together. A final click emphasizes the takeaway. The roadmap line contains possible future features, not implemented promises. Native live objects remain editable in the SlideForge JSON; exported stills cannot replace their source data.");
            animate(text(c, "Reveal the story.<br>One step at a time.", 56, 96, 1120, 144, 55, C.ink, 800), { duration: 700 });
            text(c, "Three clicks build one narrative. Each stage is an editable group of elements.", 59, 254, 1155, 38, 21, C.muted);
            const stages = [
                { x: 56, n: "01", title: "Bring your work", desc: "PowerPoint + Keynote imports<br>Images, tables and diagrams", color: C.mint },
                { x: 454, n: "02", title: "Build the explanation", desc: "Editable scientific objects<br>LaTeX + charts + curve fits", color: C.blue },
                { x: 852, n: "03", title: "Choose the delivery", desc: "Present live with notes<br>Export PPTX, PDF or offline HTML", color: "#94661E" },
            ];
            for (let i = 0; i < stages.length; i++) {
                const q = stages[i], group = "workflow-step-" + i;
                const members = [
                    box(c, q.x, 330, cardW, 252, C.white, 20),
                    text(c, q.n, q.x + 26, 352, 100, 60, 43, q.color, 800),
                    text(c, q.title, q.x + 26, 425, 324, 40, 24, C.ink, 800),
                    text(c, q.desc, q.x + 26, 479, 324, 75, 17, C.muted),
                ];
                members.forEach(element => animate(element, { click: group, duration: 650 }));
            }
            const takeaway = text(c, "Keep the scientific source. Share the presentation.", 58, 612, 1160, 35, 24, C.ink, 800);
            animate(takeaway, { click: "takeaway", duration: 600 });
            text(c, "POSSIBLE NEXT FEATURES", 58, 672, 240, 22, 12, C.mint, 800, { letterSpacing: "0.08em" });
            text(c, "Frame annotations  /  Per-frame metrics  /  Reference alignment", 326, 671, 900, 24, 14, C.muted);

            state = { ...buildDefaultPresentationState(), title: "SlideForge — Scientific Presentation Showcase", schemaVersion: 1,
                presentationTheme: "blank", presentationTransition: "fade", pageSetup: "talk-16-9", slides: [a, b, c] };
            setCurrentSlideIndex(1);
            applyPresentationTheme("blank", { persist: false });
            setCurrentPresentationTitle("SlideForge — Scientific Presentation Showcase");
            renderSlidesFromState();
            window.__showcaseIds = { molecule: molecule.id, chart: chart.id };
        }, protein);
        const landscape = await page.evaluate(async () => {
            const id = await insertPluginElement("landscape", { view: "surface", equation: "(x^2 - 1)^2 + y^2", resolution: 33, title: "", palette: "viridis", stage: "slate", axesBox: true, zeroPlane: false, autoRotate: true, rotationSpeed: 12, valueLabel: "f(x,y)", fontSize: 13 }, { ask: false });
            const element = _findPluginElementInState(id);
            Object.assign(element, { x: 72, y: 308, width: "528px", height: "294px", styles: { ...element.styles, backgroundColor: "#142D37", padding: "0px", border: "none", borderRadius: "10px" } });
            renderSlidesFromState();
            return id;
        });
        await page.waitForFunction(id => {
            const element = _findPluginElementInState(id);
            return element?.pluginPreview && element.pluginPreviewKey === _pluginPreviewKey(getSlidePlugin("landscape"), element.pluginData, element);
        }, landscape);
        await page.waitForTimeout(1500);
        // Keep a native equation as an editable scientific element on the workflow slide.
        await page.evaluate(() => {
            setCurrentSlideIndex(2);
            addEquationElement("R=\\frac{R_{max}[D]^n}{EC_{50}^n+[D]^n}");
            const equation = state.slides[2].elements.find(el => el.type === "equation");
            if (equation) {
                // The equation sits beside the headline and shares the Build card click.
                Object.assign(equation, { x: 918, y: 116, width: "280px", height: "110px" });
                equation.styles = { ...equation.styles, fontSize: "16px", color: "#365FF4", zIndex: 200 };
                const animation = { id: "equation-reveal", name: "Equation reveal", category: "entrance", type: "fadeIn", duration: 650, delay: 0, trigger: "on-click", clickGroup: "workflow-step-1", startOpacity: 0, endOpacity: 1 };
                equation.animation = { elementId: equation.id, timelines: [{ elementId: equation.id, animations: [animation], totalDuration: 650 }] };
            }
            setCurrentSlideIndex(0);
            renderSlidesFromState();
            clearSelection();
        });
        // Font/layout readiness and actual screenshots from the app.
        await page.evaluate(() => document.fonts.ready);
        for (let index = 0; index < 3; index++) {
            await page.evaluate(index => { setCurrentSlideIndex(index); renderSlidesFromState(); clearSelection(); }, index);
            await page.waitForTimeout(index === 1 ? 1800 : 700);
            const root = page.locator(".reveal .slides > section.present").first();
            await root.locator(".plugin-live-toggle").evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = "hidden"; }));
            await root.screenshot({ path: path.join(OUT, `slide-${index + 1}.png`) });
        }
        // Verify real staged click groups and configured transitions, rather than labels alone.
        const checks = await page.evaluate(() => {
            const groups = _getAdvancedAnimationClickGroups(2);
            return { size: getExportPageSetup(), transitions: state.slides.map(s => s.presentationTransition),
                clickGroups: groups.map(g => g.clickGroup), plugin: state.slides[1].elements.some(e => e.pluginId === "landscape"),
                molecule: state.slides[1].elements.some(e => e.type === "molecule"), chart: state.slides[0].elements.some(e => e.type === "chart") };
        });
        assert.equal(checks.size.width, 1280); assert.equal(checks.size.height, 720);
        assert.equal(checks.clickGroups.length, 4);
        assert(checks.plugin && checks.molecule && checks.chart);
        await page.evaluate(() => { setCurrentSlideIndex(0); renderSlidesFromState(); togglePlayMode(); });
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        await page.waitForTimeout(1600);
        await page.evaluate(() => switchSlide(2));
        await page.waitForFunction(() => currentSlideIndex === 2 && _presentationRuntimeState.advancedClickGroups.length === 4);
        const clickTargets = await page.evaluate(() => _presentationRuntimeState.advancedClickGroups.map(group => group.entries[0].el.id));
        for (let step = 0; step < clickTargets.length; step++) {
            const target = clickTargets[step];
            assert(await page.evaluate(id => Number(getComputedStyle(document.getElementById(id)).opacity) < 0.05, target), "Click stage was visible before its reveal");
            await page.keyboard.press("ArrowRight");
            await page.waitForFunction(([id, expected]) => Number(getComputedStyle(document.getElementById(id)).opacity) > 0.98 && _presentationRuntimeState.revealedAdvancedGroups === expected, [target, step + 1]);
            assert.equal(await page.evaluate(() => currentSlideIndex), 2, "Reveal advanced the slide instead");
        }
        checks.liveClickPlayback = "4 staged groups verified";
        await page.evaluate(() => togglePlayMode());
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        await page.waitForTimeout(500);
        const native = await page.evaluate(() => ({ title: currentPresentationTitle, schemaVersion: 1, ...getPersistableState() }));
        fs.writeFileSync(path.join(OUT, "SlideForge Showcase.json"), JSON.stringify(native, null, 2));
        // Capture actual app export downloads.
        const pptxDownload = page.waitForEvent("download", { timeout: 120000 });
        await page.evaluate(() => exportPPTX());
        await (await pptxDownload).saveAs(path.join(OUT, "SlideForge Showcase.pptx"));
        execFileSync("python3", [path.join(ROOT, "tools", "showcase-transitions.py"), path.join(OUT, "SlideForge Showcase.pptx")]);
        const pdfDownload = page.waitForEvent("download", { timeout: 120000 });
        await page.evaluate(() => exportPDF());
        await (await pdfDownload).saveAs(path.join(OUT, "SlideForge Showcase.pdf"));
        const web = await page.evaluate(async () => {
            const blob = await buildViewerBundle({ includeVendor: true });
            return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
        });
        fs.writeFileSync(path.join(OUT, "SlideForge Showcase Web.zip"), Buffer.from(web, "base64"));
        fs.writeFileSync(path.join(OUT, "README.md"), "# SlideForge feature showcase\n\nOpen **SlideForge Showcase.json** in SlideForge for native editable objects and live 3D exploration.\n\nThe three slides cover: a detailed capability overview, live scientific objects, and a four-click workflow build. Slide transitions are Fade and Slide. Speaker notes explain each demonstration.\n\nOpen the PPTX in PowerPoint for compatible slide builds/transitions. The PDF and PNGs are static previews. Extract the Web ZIP and open index.html for the offline presentation. Landscape objects are saved stills in standalone HTML, PDF and PowerPoint; the native SlideForge deck retains live interaction. The protein is the bundled Ubiquitin structure, PDB 1UBQ. The chart and surface are illustrative. The last slide labels possible next features explicitly.\n");
        fs.writeFileSync(path.join(OUT, "validation.json"), JSON.stringify({ ...checks, browserErrors: errors }, null, 2));
        assert.deepEqual(errors, []);
        console.log("Created presentation and exports:", OUT, checks);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
