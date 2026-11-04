// Builds the 40+ slide SlideForge showcase (the 30-slide deck, extended) with the actual editor and export pipeline.
// Usage: SLIDEFORGE_TEST_URL=<disposable app> node tools/build-feature-showcase-40.cjs
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "slideforge-feature-showcase-40");
const STEM = "SlideForge Showcase 40 Slides";
const URL = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8090/";
(async () => {
    fs.mkdirSync(path.join(OUT, "previews"), { recursive: true });
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("dialog", dialog => dialog.dismiss());
        await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { window.openStartScreen = () => false; }));
        await page.goto(URL, { waitUntil: "networkidle" });
        await page.waitForFunction(() => typeof drawPluginElement === "function" && getSlidePlugin("landscape") && !isPresentationHydrating());
        const protein = fs.readFileSync(path.join(ROOT, "tools", "showcase", "1ubq.pdb"), "utf8");
        const trajectory = fs.readFileSync(process.env.SHOWCASE_TRAJECTORY || "/tmp/slideforge-sampled-trajectory.pdb", "utf8");
        const plan = await page.evaluate(({ protein, trajectory }) => {
            _presentationPersistenceEnabled = false;
            window.schedulePresentationAutosave = () => {};
            const C = { paper: "#F4F3EE", ink: "#132F3A", muted: "#526B73", blue: "#365FF4", mint: "#138C78", gold: "#B88636", dark: "#10232C", white: "#FFFFFF", pale: "#E7EFEB", line: "#D9E2DD" };
            let serial = 0, layer = 0;
            const uid = p => "sf40-" + p + "-" + (++serial);
            const slides = [], jobs = [], keys = {};
            const rect = (s, x, y, w, h, fill = C.white, radius = 16) => {
                const e = { id: uid("panel"), type: "shape", shapeType: "rectangle", x, y, width: w + "px", height: h + "px", content: "",
                    styles: { zIndex: layer++, backgroundColor: fill, border: "none", borderRadius: radius + "px" } };
                s.elements.push(e); return e;
            };
            const txt = (s, content, x, y, w, h, size = 21, color = C.ink, weight = 500, extra = {}) => {
                const e = { id: uid("text"), type: "text", content, x, y, width: w + "px", height: h + "px", bulletStyle: "none", autoHeight: false, textFitMode: "fixed",
                    styles: { zIndex: layer++, fontFamily: '"Manrope", sans-serif', fontSize: size + "px", fontWeight: String(weight), lineHeight: "1.24",
                        color, padding: "0px", border: "none", minWidth: "0px", minHeight: "0px", backgroundColor: "transparent", ...extra } };
                s.elements.push(e); return e;
            };
            const reveal = (e, delay = 0, group = null, type = "fadeIn") => {
                const a = { id: uid("anim"), name: "Reveal", category: "entrance", type, duration: 650, delay, easing: "easeOut",
                    startOpacity: 0, endOpacity: 1, trigger: group ? "on-click" : "on-slide", ...(group ? { clickGroup: group } : {}) };
                e.animation = { elementId: e.id, timelines: [{ elementId: e.id, animations: [a], totalDuration: delay + 650 }] };
                return e;
            };
            // key: a name other slides link to (#slide:@key); hidden: a backup slide the show steps over;
            // background: a slide background object in place of the flat panel (a 3D scene).
            // Any of the editor's animation presets (animation-presets.js), added to the element's timelines: an entrance,
            // an emphasis or an exit, on its own click (group) or as the slide appears.
            const fx = (e, preset, { group = null, delay = 0, ...overrides } = {}) => {
                const a = createPresetAnimation(preset, { trigger: group ? "on-click" : "on-slide", delay, ...overrides });
                if (!a) throw Error("Unknown animation preset: " + preset);
                if (group) a.clickGroup = group;
                e.animation = e.animation?.timelines ? e.animation : { elementId: e.id, timelines: [] };
                e.animation.timelines.push({ elementId: e.id, animations: [a], totalDuration: delay + a.duration });
                return e;
            };
            const link = (key, label) => `<a href="#slide:@${key}">${label}</a>`;
            const slide = (chapter, title, subtitle = "", { dark = false, transition = "fade", notes = "", key = null, hidden = false, background = null } = {}) => {
                const n = slides.length + 1, s = { id: "showcase-40-slide-" + n, layoutId: "blank", masterId: "none",
                    presentationTransition: transition, notes, elements: [], ...(hidden ? { hidden: true } : {}), ...(background ? { background } : {}) };
                if (key) keys[key] = s.id;
                if (!background) rect(s, 0, 0, 1280, 720, dark ? C.dark : C.paper, 0);
                txt(s, "SLIDEFORGE", 56, 34, 200, 26, 15, dark ? "#85CABC" : C.mint, 800, { letterSpacing: "0.16em" });
                txt(s, chapter.toUpperCase(), 274, 37, 720, 24, 12, dark ? "#A0B6BD" : C.muted, 700, { letterSpacing: "0.13em" });
                txt(s, hidden ? "BACKUP" : String(n).padStart(2, "0") + " / __TOTAL__", 1080, 35, 144, 24, 14, dark ? "#A0B6BD" : C.muted, 600, { textAlign: "right" });
                reveal(txt(s, title, 56, 102, 1160, 118, 46, dark ? "#F0F5F3" : C.ink, 800));
                if (subtitle) reveal(txt(s, subtitle, 59, 230, 1160, 58, 21, dark ? "#B2C6CD" : C.muted), 180);
                rect(s, 56, 681, 1168, 1, dark ? "#29424C" : C.line, 0);
                txt(s, "SCIENTIFIC FIGURES / INTERACTIVE EXPLANATIONS / PORTABLE DECKS", 56, 691, 1140, 18, 10, dark ? "#8CAAB4" : C.muted, 700, { letterSpacing: "0.06em" });
                slides.push(s); return s;
            };
            const tag = (s, label, x, y, w = 150, color = C.mint, fill = C.pale) => {
                rect(s, x, y, w, 37, fill, 10);
                txt(s, label, x + 10, y + 10, w - 20, 21, 12, color, 800, { textAlign: "center" });
            };
            const card = (s, x, y, w, h, label, title, body, { group = null, delay = 250, color = C.mint, fill = C.white } = {}) => {
                const es = [rect(s, x, y, w, h, fill), txt(s, label, x + 24, y + 24, w - 48, 25, 13, color, 800, { letterSpacing: "0.07em" }),
                    txt(s, title, x + 24, y + 70, w - 48, 80, 26, C.ink, 800),
                    txt(s, body, x + 24, y + 165, w - 48, h - 180, 18, C.muted)];
                es.forEach(e => reveal(e, group ? 0 : delay, group)); return es;
            };
            const aside = (s, title, lines, { x = 884, y = 312, w = 320, dark = false } = {}) => {
                txt(s, title, x, y, w, 78, 27, dark ? "#F0F5F3" : C.ink, 800);
                txt(s, lines.join("<br><br>"), x, y + 95, w, 248, 19, dark ? "#B2C6CD" : C.muted);
            };
            const plot = (s, pluginId, data = {}, box = { x: 56, y: 304, w: 790, h: 350 }) => {
                rect(s, box.x, box.y, box.w, box.h, C.white, 16);
                const e = { id: uid(pluginId), type: "plugin", pluginId, pluginSurfaceMode: "theme", pluginData: data,
                    x: box.x + 12, y: box.y + 12, width: box.w - 24 + "px", height: box.h - 24 + "px",
                    styles: { zIndex: layer++, backgroundColor: C.white, padding: "0px", border: "none", borderRadius: "10px" } };
                s.elements.push(e); jobs.push({ slide: slides.length - 1, id: e.id, pluginId });
                reveal(e, 350); return e;
            };
            const equation = (s, latex, x, y, w, h, size = 33, color = C.blue, group = null) => {
                const e = { id: uid("equation"), type: "equation", latexSrc: latex, content: katex.renderToString(latex, { throwOnError: false, displayMode: true }),
                    x, y, width: w + "px", height: h + "px", styles: { color, fontSize: size + "px", backgroundColor: "transparent", zIndex: layer++ } };
                s.elements.push(e); reveal(e, 300, group); return e;
            };
            const chart = (s, type, labels, datasets, { x = 56, y = 304, w = 790, h = 350, yTitle = "Response (%)" } = {}) => {
                rect(s, x, y, w, h, C.white);
                const colors = [C.blue, C.mint, "#D99A42"];
                const e = { id: uid("chart"), type: "chart", chartType: type, x: x + 20, y: y + 18, width: w - 40 + "px", height: h - 36 + "px",
                    chartData: { labels, datasets: datasets.map((d, i) => ({ ...d, borderColor: colors[i], backgroundColor: type === "bar" ? colors[i] : colors[i] + "30",
                        borderWidth: 3, pointRadius: 4, fill: false, tension: 0.2 })) },
                    chartStyle: { legend: "top", yTitle, xTitle: "Condition", grid: true, fontSize: 16, seriesColors: colors },
                    styles: { zIndex: layer++, backgroundColor: C.white, padding: "0px", border: "none" } };
                s.elements.push(e); reveal(e, 300); return e;
            };
            const table = (s, values, x, y, w, h, size = 18) => {
                const t = createDefaultTableData(values.length, values[0].length);
                Object.assign(t, { headerRow: true, fontSize: size + "px", fontFamily: '"Manrope", sans-serif', headerFill: C.ink, headerTextColor: C.white,
                    bodyFill: C.white, altFill: "#EAF0EC", textColor: C.ink, borderColor: "#CBD8D4", zebra: true,
                    rowHeights: values.map(() => h / values.length), colWidths: values[0].map(() => w / values[0].length) });
                t.cells = values.map(row => row.map(text => ({ text, styles: {} })));
                const e = { id: uid("table"), type: "table", tableData: t, x, y, width: w + "px", height: h + "px", content: "",
                    styles: { zIndex: layer++, backgroundColor: C.white, padding: "0px" } };
                s.elements.push(e); reveal(e, 300); return e;
            };
            const molecule = (s, data, name, { x = 56, y = 304, w = 790, h = 350, auto = true, frames = false, layers = [] } = {}) => {
                rect(s, x, y, w, h, "#142D37");
                const e = { id: uid("molecule"), type: "molecule", ...createMoleculeElementData({ data, name, format: "pdb", isTrajectory: frames }),
                    x: x + 12, y: y + 12, width: w - 24 + "px", height: h - 24 + "px",
                    moleculeBackgroundMode: "custom", moleculeAutoRotate: auto, moleculeProjection: "orthographic", moleculeRepresentationLayers: layers,
                    moleculePlayback: { autoplay: frames, fps: 3, startFrame: 1 },
                    styles: { zIndex: layer++, backgroundColor: "#142D37", borderRadius: "10px", border: "none" } };
                s.elements.push(e); return e;
            };
            const illustrative = "Illustrative data. Use your own measurements and verify analysis before scientific use.";
            let s;

            s = slide("01 / The promise", "Scientific figures.<br>Presentation ready.", "A workspace for building the figure and explaining the story.", {
                dark: true, notes: "Open the talk. This is a capability showcase, not a claim of perfect compatibility or scientific validation. Most scientific figures use illustrative plugin example data. The protein and sampled trajectory are labelled separately." });
            ["DATA → FIGURE", "OBJECT → EXPLANATION", "DECK → DELIVERY"].forEach((label, i) => {
                rect(s, 56 + i * 398, 368, 372, 167, "#193642", 18);
                reveal(txt(s, label, 82 + i * 398, 397, 320, 30, 15, "#85CABC", 800), 300 + i * 180);
                reveal(txt(s, ["Editable inputs", "Live scientific views", "Multiple output formats"][i], 82 + i * 398, 448, 320, 70, 28, "#F0F5F3", 800), 350 + i * 180);
            });
            txt(s, "__TOTAL__ slides · native objects · staged reveals · seven slide transitions · a hidden backup", 58, 611, 1160, 30, 18, "#B2C6CD");

            s = slide("00 / Agenda", "Jump to any chapter.", "Each line is a link to its slide: while presenting, click one to go there and carry on from it.", { key: "agenda", notes: "Agenda with live links. While presenting, clicking a chapter name jumps to its first slide (links of the form #slide:<id>); the show continues from there. The last line opens the hidden backup slide, which the normal order steps over. In the editor, a click on a link selects its text box instead." });
            [["01", "Workflow", "why"], ["02", "Data and figures", "charts"], ["03", "Landscapes and molecules", "landscape2d"], ["04", "Chemistry and biology", "chemistry"],
             ["05", "Diagrams and motion", "diagrams"], ["06", "Presenting and media", "presenter"], ["07", "Imports, exports and sharing", "imports"], ["08", "What could come next", "roadmap"]].forEach(([num, label, key], i) => {
                const x = 56 + (i % 2) * 592, y = 304 + Math.floor(i / 2) * 82, delay = 150 + i * 90;
                reveal(rect(s, x, y, 568, 68, C.white, 12), delay);
                reveal(txt(s, num, x + 22, y + 20, 56, 30, 21, i % 2 ? C.blue : C.mint, 800), delay);
                reveal(txt(s, link(key, label), x + 84, y + 19, 460, 32, 23, C.ink, 700), delay);
            });
            reveal(txt(s, "Backup: " + link("backup", "where the data on these slides comes from") + " (a hidden slide).", 58, 640, 1100, 28, 17, C.muted, 600), 900);

            s = slide("01 / Why it matters", "A research talk is more than a set of pictures.", "The opportunity is to reduce the gap between making a figure and explaining it.", { key: "why", notes: "Explain the workflow problem. SlideForge is useful when scientific objects need repeated editing or live inspection. Ordinary business slides may be served equally well by established tools." });
            card(s, 56, 324, 372, 293, "THE INPUT", "Data changes", "A new condition, fit or structure<br>should not require rebuilding<br>the entire slide.", { color: C.mint });
            card(s, 454, 324, 372, 293, "THE QUESTION", "The room asks why", "Rotate a structure or inspect<br>a surface while discussing<br>the underlying mechanism.", { delay: 430, color: C.blue });
            card(s, 852, 324, 372, 293, "THE HANDOFF", "Keep the source", "Share an accessible output<br>while retaining an editable<br>scientific master deck.", { delay: 610, color: C.gold });

            s = slide("01 / End-to-end workflow", "One workspace. Four stages.", "Import → build → explain → deliver. Each click adds the next stage.", { key: "workflow", transition: "slide", notes: "Click four times. Each stage's background, label, title and body share a click group. Native and offline web playback use the same grouping." });
            [["01", "Bring", "PPTX + Keynote<br>Tables + structure files"], ["02", "Build", "Figures + equations<br>Scientific plugins"], ["03", "Explain", "Notes + live objects<br>Click-by-click builds"], ["04", "Deliver", "PPTX + PDF<br>Offline web"]].forEach((v, i) => {
                card(s, 56 + i * 298, 330, 274, 285, v[0], v[1], v[2], { group: "workflow-" + i, color: [C.mint, C.blue, C.gold, C.mint][i] });
            });

            s = slide("02 / Editable charts", "Your chart should remain a chart.", "Edit series and labels directly rather than replacing a pasted screenshot.", { key: "charts", notes: illustrative });
            chart(s, "line", ["Control", "1 µM", "5 µM", "10 µM", "50 µM"], [{ label: "Series A", data: [100, 92, 71, 48, 22] }, { label: "Series B", data: [100, 98, 94, 87, 70] }]);
            aside(s, "Change the inputs.", ["Edit the data table.", "Keep labels and units visible.", "Use consistent series colours."]);

            s = slide("02 / Tables and comparisons", "Show the values beside the visual.", "Editable tables help the audience inspect the evidence.", { notes: illustrative });
            table(s, [["Condition", "Series A", "Series B"], ["Control", "100%", "100%"], ["1 µM", "92%", "98%"], ["5 µM", "71%", "94%"], ["10 µM", "48%", "87%"], ["50 µM", "22%", "70%"]], 56, 307, 790, 342, 20);
            aside(s, "Use a table when…", ["Exact values matter.", "Readers need a compact reference.", "Conditions and units must remain explicit."]);

            s = slide("02 / LaTeX equations", "Keep the mathematical statement precise.", "LaTeX equations remain native editable elements in the SlideForge deck.", { notes: "Two illustrative mathematical expressions. PowerPoint/PDF represent the rendered equations visually; retain the native deck to edit LaTeX." });
            rect(s, 56, 318, 1168, 273, C.white);
            equation(s, "R=\\frac{R_{\\max}[D]^n}{EC_{50}^{\\,n}+[D]^n}", 115, 355, 460, 145, 36);
            equation(s, "f(x,y)=(x^2-1)^2+y^2", 660, 365, 500, 115, 31, C.mint);
            txt(s, "Dose-response model", 126, 539, 450, 27, 18, C.muted);
            txt(s, "Illustrative double-well surface", 670, 539, 480, 27, 18, C.muted);

            s = slide("02 / Curve fitting", "Fit the model where the figure lives.", "Dose-response data with fitted curves and parameter reporting.", { notes: illustrative + " The plugin uses its bundled example values. Fit quality and assumptions must be checked for real analyses." });
            plot(s, "curve-fit", { fontSize: 16 });
            aside(s, "Keep the context.", ["Show the model and axis units.", "Compare more than one series.", "Treat parameter estimates as results to validate."]);

            s = slide("02 / Heatmaps", "Turn a matrix into a pattern.", "Rows, columns, scales and colour are part of the scientific explanation.", { notes: illustrative });
            plot(s, "heatmap", { fontSize: 16 });
            aside(s, "Make scales legible.", ["Keep the colour bar visible.", "Explain any normalization.", "Use clustering as an aid, not a substitute for interpretation."]);

            s = slide("02 / Distributions", "Show the distribution, not only the mean.", "Box plots make group spread visible and keep the underlying values editable.", { notes: illustrative });
            plot(s, "box-plot", { kind: "box", points: "all", mean: true, fontSize: 17 });
            aside(s, "Ask what varies.", ["Compare spread and outliers.", "Keep the sample context nearby.", "Avoid hiding the data behind one bar."]);

            s = slide("02 / Differential change", "Separate effect size from significance.", "Volcano plots combine fold change with a clearly defined significance threshold.", { notes: illustrative + " Labels in this figure are bundled example gene names. This is not a new biological result." });
            plot(s, "volcano", { fontSize: 16 });
            aside(s, "State the rule.", ["Label both axes.", "Show the thresholds.", "Explain multiple-testing treatment for your real dataset."]);

            s = slide("02 / Time-to-event data", "Give survival curves their context.", "A Kaplan–Meier view can carry groups, censoring marks and risk information.", { notes: illustrative + " Example survival data; no clinical inference is intended." });
            plot(s, "kaplan-meier", { fontSize: 16 });
            aside(s, "Read more than a line.", ["Identify the groups.", "Check follow-up and censoring.", "Keep sample numbers accessible."]);

            s = slide("02 / Animated charts", "Let the data draw itself.", "Chart animations grow bars from zero and draw lines on a click, so the audience reads them in order.", { transition: "convex", key: "animatedCharts", notes: illustrative + " Click once to grow the bars (Chart Bars Reveal), again to draw the lines (Chart Lines Draw). Both charts stay editable native charts; PowerPoint and PDF show them finished." });
            fx(chart(s, "bar", ["Control", "Low", "Mid", "High"], [{ label: "Week 1", data: [12, 18, 25, 31] }, { label: "Week 4", data: [14, 26, 38, 52] }], { x: 56, y: 304, w: 568, h: 350, yTitle: "Signal (a.u.)" }), "chartBarsReveal", { group: "bars" });
            fx(chart(s, "line", ["0 h", "2 h", "4 h", "8 h", "24 h"], [{ label: "Treated", data: [5, 18, 34, 51, 62] }, { label: "Vehicle", data: [5, 7, 9, 12, 14] }], { x: 656, y: 304, w: 568, h: 350, yTitle: "Uptake (%)" }), "chartLinesDraw", { group: "lines" });

            s = slide("03 / Landscapes in two dimensions", "Inspect the shape of a field.", "A heatmap and contours provide a complementary view of the same equation.", { key: "landscape2d", notes: "Illustrative equation, not measured energy or a probability-to-energy conversion. In SlideForge, hover over the live landscape to inspect values." });
            plot(s, "landscape", { view: "both", equation: "(x^2-1)^2+y^2", title: "", resolution: 41, fontSize: 15, xLabel: "x", yLabel: "y", valueLabel: "f(x,y)" });
            aside(s, "Keep the definition.", ["Equation or CSV grid.", "Contour levels and colour scale.", "Units and normalization stated explicitly."]);

            s = slide("03 / Landscapes in three dimensions", "Let the audience explore the surface.", "Rotate, zoom and inspect a native 3D landscape while presenting.", { dark: true, transition: "zoom", notes: "Live 3D surface in the native app. Automatic rotation is enabled at 12 degrees per second. The plot is an illustrative double well. Standalone HTML/PPTX/PDF retain its saved still." });
            plot(s, "landscape", { view: "surface", equation: "(x^2-1)^2+y^2", title: "", resolution: 33, fontSize: 14, autoRotate: true, rotationSpeed: 12, stage: "slate", zeroPlane: false });
            aside(s, "A live explanation.", ["Drag to change the view.", "Inspect a region in response to a question.", "Keep a still for fixed-format exports."], { dark: true });

            s = slide("03 / Straight-on views", "Look along an axis.", "Top shows a surface as a map, Front as a profile; 3D is the angled view you can orbit.", { key: "landscapeViews", transition: "zoom", notes: "New in 0.6.0. The same illustrative double-well surface saved at three views: Top (looking straight down the value axis), Front (along y) and the angled 3D view. In the native app, open Explore and use the Top / Front / Side / 3D buttons; the view you leave a surface at is kept on the slide and in its exports." });
            [["TOP", { yaw: 0, pitch: 90 }], ["FRONT", { yaw: 0, pitch: 0 }], ["3D", { yaw: -35, pitch: 40 }]].forEach(([label, view], i) => {
                const x = 56 + i * 398;
                plot(s, "landscape", { view: "surface", equation: "(x^2-1)^2+y^2", title: "", resolution: 29, fontSize: 13, colorBar: false, ...view }, { x, y: 300, w: 372, h: 318 });
                tag(s, label + " VIEW", x + 111, 632, 150, i === 2 ? C.blue : C.mint);
            });

            s = slide("03 / Molecular structures", "Turn the protein, not the entire slide.", "A native molecule object keeps the structure available for exploration.", { dark: true, notes: "Ubiquitin, PDB 1UBQ, from the bundled source file tools/showcase/1ubq.pdb. Orthographic projection and automatic molecular rotation are enabled." });
            molecule(s, protein, "Ubiquitin · PDB 1UBQ");
            aside(s, "Ubiquitin / 1UBQ", ["Load a supported structure file.", "Choose the representation.", "Rotate and inspect during the talk."], { dark: true });

            s = slide("03 / Trajectory playback", "Move through conformations deliberately.", "Play, pause, step and jump to a frame inside the presentation.", { dark: true, transition: "slide", notes: "Sa1 V90T connected_path: eight sampled conformations from source frames 0, 218, 435, 653, 870, 1088, 1305 and 1523 of path_protein.dcd, paired with protein.pdb (1,545 atoms). Sampling is non-contiguous; 3 FPS is an illustrative presentation rate, not simulation time. Source files were read without changes. Native presentation autoplay is enabled; exports may use a still." });
            molecule(s, trajectory, "Sa1 V90T · eight sampled conformations", { frames: true, auto: false });
            aside(s, "Your folding pathway.", ["8 sampled conformations.", "1,545 atoms per frame.", "Illustrative playback rate: 3 FPS."], { dark: true });

            s = slide("03 / Frame by frame", "Step to the frame you mean.", "First, previous, next and last buttons, a frame number to type, and a visible playback speed.", { dark: true, transition: "slide", key: "frames", notes: "New in 0.6.0. The same eight sampled Sa1 V90T conformations as the previous slide, opened at frame 5 and paused (play on entry is off here). Use the |‹ ‹ › ›| buttons to step, type a frame number to jump, or press Play; stepping or scrubbing pauses playback. Speed, starting frame and play-on-entry are saved with the slide." });
            molecule(s, trajectory, "Sa1 V90T · frame by frame", { frames: true, auto: false }).moleculePlayback = { autoplay: false, fps: 3, startFrame: 5 };
            aside(s, "Frame controls.", ["|‹ ‹ › ›| step one frame or jump to either end.", "Type a number to go to that frame.", "Speed, start frame and autoplay are saved with the slide."], { dark: true });

            s = slide("03 / Molecular selections", "Direct attention to a region.", "Representation layers separate a selected region from the rest of the structure.", { dark: true, notes: "PDB 1UBQ. Residues 20–35 are highlighted as a visual selection example; no functional claim about this region is made." });
            molecule(s, protein, "1UBQ · selected residues 20–35", { auto: false, layers: [{ id: "residue-highlight", kind: "cartoon", selectionQuery: "20-35", colorScheme: "custom", customColor: "#F2B84B", radius: 1, opacity: 1 }] });
            aside(s, "A visual selection.", ["Highlight a residue range.", "Choose its colour and style.", "Explain what the selection means."], { dark: true });

            s = slide("04 / Chemistry", "Bring chemical structure into the story.", "Structure drawings and energy profiles can sit beside the explanation.", { key: "chemistry", notes: "Illustrative chemistry objects. The structure uses the bundled RDKit example SMILES. The energy profile uses example states and values, not a calculated reaction pathway." });
            plot(s, "rdkit", { smiles: "CC(=O)Oc1ccccc1C(=O)O", fontSize: 17 }, { x: 56, y: 310, w: 550, h: 337 });
            plot(s, "energy-levels", { fontSize: 15, curve: true }, { x: 650, y: 310, w: 574, h: 337 });

            s = slide("04 / Biology annotations", "Make biological organization visible.", "Maps and domain architecture turn a feature list into a figure.", { notes: "Bundled plasmid-map and protein-domain examples. These are capability demonstrations and should be replaced or checked against the intended sequence." });
            plot(s, "plasmid-map", { fontSize: 16 }, { x: 56, y: 309, w: 550, h: 338 });
            plot(s, "domain-architecture", { fontSize: 15 }, { x: 650, y: 309, w: 574, h: 338 });

            s = slide("04 / Trees and sequences", "Keep relationships and sequence context together.", "Phylogenetic trees and sequence logos are separate editable scientific objects.", { notes: "Bundled illustrative tree and sequence-logo inputs. This deck does not infer a phylogeny or a new motif from experimental data." });
            plot(s, "phylo-tree", { fontSize: 16 }, { x: 56, y: 310, w: 550, h: 337 });
            plot(s, "sequence-logo", { fontSize: 16 }, { x: 650, y: 310, w: 574, h: 337 });

            s = slide("05 / Mechanism diagrams", "Turn a pathway into a narrative.", "Use connected shapes or a Mermaid diagram to explain cause and sequence.", { key: "diagrams", notes: "The mechanism shown here is a generic explanatory diagram: stimulus → transition → response. It is not a claimed biological mechanism." });
            const diagram = createMermaidElementData({ mermaidSource: "flowchart LR\nA[Input or stimulus] --> B[State transition]\nB --> C[Measured response]", theme: "default", style: { fontSize: 22 } });
            Object.assign(diagram, { id: uid("diagram"), x: 72, y: 332, width: "1120px", height: "248px", styles: { zIndex: layer++ } });
            rect(s, 56, 310, 1168, 320, C.white); diagram.styles.zIndex = layer++; s.elements.push(diagram); reveal(diagram, 350);

            s = slide("05 / Branch reveal", "Reveal a pathway branch by branch.", "Each click shows the next step of the diagram, with the arrows that lead into it.", { transition: "concave", key: "branches", notes: "Click five times: Stimulus, then the state change, then each branch, then the shared response. This is the diagram's Reveal by branch preset. The diagram is generic and makes no biological claim." });
            const branched = createMermaidElementData({ mermaidSource: "flowchart LR\nA[Stimulus] --> B[Receptor state change]\nB --> C[Branch 1: fast signal]\nB --> D[Branch 2: slow adaptation]\nC --> E[Measured response]\nD --> E", theme: "default", style: { fontSize: 20 } });
            if (!branched.graphDocument) throw Error("Branch reveal needs a diagram the visual editor can read");
            branched.graphDocument.presentationState = { ...(branched.graphDocument.presentationState || {}), activePreset: "branch-reveal", revealOrder: [] };
            Object.assign(branched, { id: uid("diagram"), x: 72, y: 322, width: "1136px", height: "300px", styles: { zIndex: layer++ } });
            rect(s, 56, 306, 1168, 330, C.white); branched.styles.zIndex = layer++; s.elements.push(branched);

            s = slide("05 / One point at a time", "Build an argument line by line.", "Turn on Reveal bullets one by one for a text box: each click brings in its next point.", { key: "bullets", notes: "Illustrative statements. Click four times for the four bullets (a bullet with sub-points is one step), then a fifth time for the takeaway, which enters with Fade with Blur. Bullet reveal plays in the native app and the offline viewer." });
            rect(s, 56, 304, 760, 340, C.white);
            const points = txt(s, "<ul><li>The signal rises within two hours of treatment.</li><li>It plateaus by eight hours, unlike the vehicle control.</li><li>The plateau tracks receptor occupancy.</li><li>So occupancy, not exposure time, sets the response.</li></ul>", 88, 332, 700, 290, 24, C.ink, 600, { lineHeight: "1.5" });
            delete points.bulletStyle; points.revealBullets = true;
            [rect(s, 852, 304, 372, 340, C.ink), txt(s, "TAKEAWAY", 880, 336, 316, 24, 13, "#85CABC", 800, { letterSpacing: "0.08em" }),
             txt(s, "Occupancy sets the response.", 880, 380, 316, 120, 30, "#F0F5F3", 800), txt(s, "One claim per slide,<br>built from its evidence.", 880, 540, 316, 70, 19, "#B2C6CD")]
                .forEach(e => fx(e, "fadeWithBlurIn", { group: "takeaway" }));

            s = slide("05 / Animation vocabulary", "Use motion to establish visual order.", "Automatic entrance effects can introduce information without requiring a click.", { transition: "zoom", notes: "The five tiles enter automatically with staggered fade/zoom entrances. Motion is used to direct attention, not to obscure information." });
            ["Frame the question", "Show the evidence", "Name the mechanism", "State the conclusion", "Invite inspection"].forEach((label, i) => {
                const x = 56 + i * 238;
                reveal(rect(s, x, 348, 216, 235, C.white), i * 230 + 250);
                reveal(txt(s, String(i + 1).padStart(2, "0"), x + 23, 373, 170, 46, 34, i % 2 ? C.blue : C.mint, 800), i * 230 + 300);
                reveal(txt(s, label, x + 23, 441, 170, 108, 23, C.ink, 800), i * 230 + 350, null, i === 3 ? "scaleInPlace" : "fadeIn");
            });

            s = slide("05 / Emphasis", "Point at what matters, then move on.", "Emphasis effects act on something already on the slide: each tile responds to its own click.", { transition: "diffuse", key: "emphasis", notes: "Click five times: Pulse, Glow, Heartbeat, Wiggle and Color Pulse, one tile each. Emphasis effects do not hide or reveal anything; use them sparingly to direct attention. PowerPoint may simplify these effects." });
            [["Pulse", "pulseEmphasis"], ["Glow", "glowHighlight"], ["Heartbeat", "heartbeatEmphasis"], ["Wiggle", "wiggleEmphasis"], ["Color pulse", "colorPulse"]].forEach(([label, preset], i) => {
                const x = 56 + i * 238, delay = 200 + i * 120;
                [reveal(rect(s, x, 348, 216, 235, C.white), delay), reveal(txt(s, String(i + 1).padStart(2, "0"), x + 23, 373, 170, 46, 34, i % 2 ? C.blue : C.mint, 800), delay),
                 reveal(txt(s, label, x + 23, 441, 170, 70, 25, C.ink, 800), delay), reveal(txt(s, "CLICK " + (i + 1), x + 23, 536, 170, 24, 13, C.muted, 800, { letterSpacing: "0.08em" }), delay)]
                    .forEach(e => fx(e, preset, { group: "emphasis-" + i }));
            });

            s = slide("05 / Entrances and exits", "Bring ideas in, then clear the stage.", "Slide in, 3D flip and blur-to-focus entrances; the fourth click explodes the open question and lands the answer.", { transition: "convex", key: "entrances", notes: "Click four times. 1: Slide In Left. 2: 3D Flip. 3: Blur In Focus. 4: the open question leaves with Explode Out while the answer enters with Bounce In, on the same click. Effects PowerPoint lacks are simplified there." });
            [["SLIDE IN", "Observation", "The response plateaus<br>after eight hours.", "slideInLeft", C.mint], ["3D FLIP", "Comparison", "The vehicle control<br>keeps rising slowly.", "flip3DHorizontal", C.blue], ["BLUR TO FOCUS", "Measurement", "Occupancy saturates<br>at the same time.", "blurInFocus", C.gold]].forEach(([label, title, body, preset, color], i) => {
                const x = 56 + i * 398;
                [rect(s, x, 312, 372, 232, C.white), txt(s, label, x + 24, 334, 324, 24, 13, color, 800, { letterSpacing: "0.07em" }), txt(s, title, x + 24, 374, 324, 44, 27, C.ink, 800), txt(s, body, x + 24, 438, 324, 80, 19, C.muted)]
                    .forEach(e => fx(e, preset, { group: "enter-" + i }));
            });
            // Last in the list, so its click comes after the three entrances (clicks follow the order objects are listed).
            [reveal(rect(s, 56, 562, 1168, 96, "#E7EFEB", 14), 300), reveal(txt(s, "Open question: what sets the size of the response?", 86, 595, 1100, 36, 25, C.ink, 700), 300)]
                .forEach(e => fx(e, "uncreateExplode", { group: "answer" }));
            [rect(s, 56, 562, 1168, 96, C.ink, 14), txt(s, "Answer: receptor occupancy, not exposure time.", 86, 595, 1100, 36, 25, "#F0F5F3", 800)]
                .forEach(e => fx(e, "bounce", { group: "answer" }));

            s = slide("05 / Click-by-click storytelling", "One click. One idea.", "Each card enters as a coherent group, keeping text and background together.", { key: "storytelling", notes: "Click once for each of the three cards. The formula shares the second card's click. This is an actual grouped-build demonstration." });
            card(s, 56, 329, 372, 292, "CLICK 01", "Ask the question", "What changed between<br>the two conditions?", { group: "question", color: C.mint });
            card(s, 454, 329, 372, 292, "CLICK 02", "Show the evidence", "Bring in the fit, comparison<br>or structural observation.", { group: "evidence", color: C.blue });
            card(s, 852, 329, 372, 292, "CLICK 03", "Explain the mechanism", "Connect the observation<br>to a defensible claim.", { group: "mechanism", color: C.gold });

            s = slide("05 / Motion paths", "Make a route visible.", "A moving marker can trace a process or a conceptual trajectory.", { notes: "Illustrative motion path: a marker traverses a Bezier route automatically. This animation is not a molecular trajectory or a simulated physical path. PowerPoint may simplify unsupported advanced effects." });
            rect(s, 56, 318, 1168, 320, C.white);
            ["INPUT", "TRANSITION", "OUTPUT"].forEach((label, i) => {
                tag(s, label, 98 + i * 420, 493, 195, i % 2 ? C.blue : C.mint);
            });
            const marker = { id: uid("motion-marker"), type: "shape", shapeType: "circle", x: 142, y: 417, width: "36px", height: "36px", content: "",
                styles: { zIndex: layer++, backgroundColor: C.blue, borderRadius: "50%", boxShadow: "0 0 0 12px #365FF418" },
                animation: { timelines: [{ animations: [{ id: uid("motion"), name: "Conceptual pathway", type: "moveAlongPath", category: "scientific", duration: 3600, delay: 500, easing: "easeInOut", trigger: "on-slide", pathType: "bezier",
                    controlPoints: { start: { x: 0, y: 0 }, cp1: { x: 280, y: -130 }, cp2: { x: 590, y: 100 }, end: { x: 865, y: 0 } }, followPath: false }] }] } };
            marker.animation.elementId = marker.id; marker.animation.timelines[0].elementId = marker.id;
            s.elements.push(marker);
            txt(s, "The path communicates sequence; the labels explain meaning.", 100, 570, 1070, 40, 22, C.muted);

            s = slide("05 / Slide transitions", "Let transitions signal a change of context.", "Seven per-slide transitions, each used at a deliberate boundary; None (a cut) opens the backup.", { transition: "slide", key: "transitions", notes: "This slide arrives with Slide. Every transition named here is used somewhere in the deck as an actual per-slide setting: Fade for most detail slides, Diffuse on Emphasis and 3D backgrounds, Slide at workflow steps, Convex on Animated charts and Entrances and exits, Concave on Branch reveal and Sharing, Zoom on the 3D landscape, straight-on views and closing, and None on the hidden backup. PowerPoint receives the nearest equivalents (Convex as Gallery and Concave as Doors, with a Fade fallback for older viewers)." });
            [["FADE", "Stay in the argument", "Closely related evidence,<br>one idea after another.", C.mint],
             ["DIFFUSE", "Dissolve to a new angle", "Same subject, seen<br>a different way.", C.blue],
             ["SLIDE", "Move to the next stage", "A new step in a workflow<br>or an explanation.", C.gold],
             ["CONVEX", "Open a new chapter", "The page turns outward<br>to signal a fresh topic.", C.mint],
             ["CONCAVE", "Fold into detail", "Go deeper on one idea<br>before coming back.", C.blue],
             ["ZOOM", "Change the scale", "From an overview to one<br>object, used sparingly.", C.gold]].forEach(([label, title, body, color], i) => {
                const x = 56 + (i % 3) * 398, y = 300 + Math.floor(i / 3) * 188, delay = 200 + i * 120;
                reveal(rect(s, x, y, 372, 170, C.white), delay);
                reveal(txt(s, label, x + 24, y + 20, 324, 22, 13, color, 800, { letterSpacing: "0.08em" }), delay);
                reveal(txt(s, title, x + 24, y + 50, 324, 40, 25, C.ink, 800), delay);
                reveal(txt(s, body, x + 24, y + 98, 324, 60, 17, C.muted), delay);
            });

            s = slide("06 / Presenter tools", "Keep the explanation in your hands.", "Notes, presenter view, pointer tools and staged builds support the talk.", { key: "presenter", notes: "Demonstrate presenter view from the app if desired. Tools mentioned here are capabilities, not screenshots of a running presenter session. This slide includes an actual QR-code plugin object linking to the project's repository." });
            card(s, 56, 329, 372, 292, "BEFORE", "Prepare the narrative", "Write speaker notes.<br>Rehearse the click order.<br>Check fonts and media.", { color: C.mint });
            card(s, 454, 329, 372, 292, "DURING", "Direct attention", "Use pointer or spotlight.<br>Annotate with the chalkboard.<br>Pause to inspect an object.", { delay: 450, color: C.blue });
            plot(s, "qr-code", { text: "https://github.com/dmighty007/slideforge-studio", label: "Project repository" }, { x: 944, y: 330, w: 200, h: 200 });
            txt(s, "OPEN THE PROJECT", 884, 559, 320, 30, 15, C.mint, 800, { textAlign: "center" });

            s = slide("06 / Timer, recorder, presenter view", "Keep time, keep a record, stay ahead.", "A talk-length countdown, a recorder for the show, and a presenter window that matches the room.", { transition: "slide", key: "timer", notes: "This deck has a 40-minute talk length set. During the show: T shows or hides the timer and Shift+T pauses it; it turns amber near the end and red when time is up. R sets up a recording (screen and microphone, or sound only), pause and resume as you go, Shift+R stops and offers the file. P opens the presenter view: notes, total and per-slide time, and the next slide as the audience will first see it." });
            card(s, 56, 329, 372, 292, "SHOW TIMER · T", "Count down the talk", "Shift+T pauses it.<br>Amber near the end,<br>red when time is up.", { color: C.mint });
            card(s, 454, 329, 372, 292, "RECORDER · R", "Record the show", "Screen and microphone,<br>or sound only. Pause,<br>resume; Shift+R saves.", { delay: 430, color: C.blue });
            card(s, 852, 329, 372, 292, "PRESENTER VIEW · P", "See what comes next", "Notes, total and slide time,<br>and the next slide as the<br>audience will first see it.", { delay: 610, color: C.gold });

            s = slide("06 / 3D backgrounds", "Set a scene, quietly.", "A slow 3D background sits behind the content. This one is the double helix; there are eight scenes.", { transition: "diffuse", key: "scene",
                background: { type: "three", content: "theme-motion", style: "vortex", side: "right", strength: "subtle", motion: "slow", calm: true, seed: 4242, opacity: 1, blur: 0, brightness: 100, saturate: 100 },
                notes: "The slide background is a 3D scene (Double helix, subtle strength, slow motion, on the right). The eight scenes are Orbits, Terrain, Drift, Crystal lattice, Ribbons, Double helix, Network and Globe; each also takes a side, a strength and a speed. Exports carry a still of the scene." });
            [["SCENE", "Eight to choose from", "Orbits, terrain, drift, lattice,<br>ribbons, helix, network, globe."], ["PLACEMENT", "Keep text clear", "Put the scene on the left,<br>the right or the centre."], ["MOTION", "Slow by default", "Choose still, slow or normal,<br>and a subtle or bold strength."]].forEach(([label, title, body], i) => {
                const y = 312 + i * 118, delay = 250 + i * 160;
                reveal(rect(s, 56, y, 640, 104, C.dark, 14), delay);
                reveal(txt(s, label, 80, y + 18, 230, 22, 13, "#85CABC", 800, { letterSpacing: "0.08em" }), delay);
                reveal(txt(s, title, 80, y + 44, 230, 50, 21, "#F0F5F3", 800), delay);
                reveal(txt(s, body, 340, y + 24, 330, 64, 17, "#B2C6CD"), delay);
            });

            s = slide("06 / Media and embeds", "Use media when it adds evidence.", "Sound, video, PDF pages and web embeds can support a scientific explanation.", { notes: "The small audio object contains a quiet generated 440 Hz tone. It does not autoplay. Click it manually to hear the demonstration. No recorded research audio is included." });
            card(s, 56, 329, 372, 292, "AUDIO + VIDEO", "Control the timing", "Keep autoplay intentional.<br>Pause when discussing.<br>Check playback before a talk.", { color: C.mint });
            card(s, 454, 329, 372, 292, "PDF + WEB", "Bring in context", "Show a paper panel,<br>supporting document,<br>or an embedded example.", { delay: 450, color: C.blue });
            rect(s, 852, 329, 372, 292, C.white);
            txt(s, "MANUAL AUDIO DEMO", 876, 354, 324, 28, 13, C.gold, 800);
            txt(s, "A short test tone", 876, 402, 324, 74, 27, C.ink, 800);
            txt(s, "Click the player to listen.<br>Autoplay is disabled.", 876, 480, 324, 64, 18, C.muted);
            // Minimal WAV, embedded locally. A short fade prevents an abrupt click.
            const rate = 8000, samples = 8000, wav = new ArrayBuffer(44 + samples * 2), view = new DataView(wav);
            const str = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
            str(0, "RIFF"); view.setUint32(4, wav.byteLength - 8, true); str(8, "WAVE"); str(12, "fmt ");
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
            view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, samples * 2, true);
            for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / rate) * 1200 * Math.min(1, i / 400, (samples - i) / 400), true);
            let binary = ""; new Uint8Array(wav).forEach(value => { binary += String.fromCharCode(value); });
            s.elements.push({ id: uid("audio"), type: "audio", x: 875, y: 550, width: "325px", height: "54px", content: "data:audio/wav;base64," + btoa(binary), audioName: "Quiet demo tone", autoplay: false, loop: false, muted: false, styles: { zIndex: layer++ } });

            s = slide("07 / Existing decks", "Bring PowerPoint and Keynote into one workspace.", "Direct imports are useful; preservation quality still depends on the source deck.", { key: "imports", transition: "slide", notes: "SlideForge can import PPTX and KEY. This is not a claim that import fidelity is perfect or that SlideForge exports native Keynote files. Check complex layouts, missing fonts, media, and unsupported builds." });
            tag(s, "PPTX", 118, 334, 222, C.blue, "#E2E9FF"); tag(s, "KEYNOTE", 118, 422, 222, C.mint);
            txt(s, "→", 385, 379, 100, 90, 60, C.muted, 500);
            rect(s, 534, 328, 690, 285, C.white);
            txt(s, "A common editing canvas", 565, 358, 620, 55, 31, C.ink, 800);
            txt(s, "Check layout, fonts, charts and media.<br><br>Retain the original file and compare the imported result.", 565, 441, 620, 140, 22, C.muted);

            s = slide("07 / Export and portability", "Choose the format for the destination.", "The native deck is the editable master; exports carry supported representations.", { notes: "Native SlideForge preserves supported input objects and data. PPTX preserves supported editable text, shapes, tables and charts, while scientific objects may become images. PDF is static. Offline HTML preserves supported viewer interactions; Landscape is currently a saved still in standalone HTML." });
            table(s, [["Format", "Best use", "Important boundary"], ["SlideForge", "Continue scientific editing", "Keep source data + objects"], ["PowerPoint", "Share a familiar deck", "Some science objects become images"], ["PDF", "Read, print, archive", "Static pages"], ["Offline HTML", "Present in a browser", "Live support varies by object"]], 56, 314, 1168, 325, 18);

            s = slide("07 / Sharing", "Share a link the audience can open.", "A view-only link shows the deck in any browser, follows your saved changes, and stops when you stop sharing.", { transition: "concave", key: "sharing", notes: "Checked for this release: the link opens view-only, fits a phone, shows saved changes, stops working when sharing stops, and cannot reach the editing API. The desktop app can also make the link reachable beyond your network through a Cloudflare tunnel; that route has not been tested for this release." });
            card(s, 56, 329, 372, 292, "VIEW ONLY", "Nothing to install", "Any browser, phone or laptop.<br>Viewers cannot edit<br>or reach your other decks.", { color: C.mint });
            card(s, 454, 329, 372, 292, "LIVE", "Follows your saves", "Fix a typo after sending:<br>the open link updates<br>with the saved deck.", { delay: 430, color: C.blue });
            card(s, 852, 329, 372, 292, "IN YOUR HANDS", "Stop any time", "Stop sharing and the link<br>stops working. Offline HTML<br>covers no-network rooms.", { delay: 610, color: C.gold });

            s = slide("08 / Possible next features", "Build depth before adding more surface area.", "These are proposed directions, not features promised by this deck.", { key: "roadmap", dark: true, notes: "Roadmap: timeline annotations, per-frame metrics and reference alignment are possible future improvements. They are explicitly not presented as implemented capabilities. Prioritize reliability and scientific validation." });
            card(s, 56, 329, 372, 292, "PROPOSED", "Annotate the trajectory", "Mark important frames.<br>Attach mechanism notes.<br>Jump to named events.", { color: C.mint });
            card(s, 454, 329, 372, 292, "PROPOSED", "Link metrics to motion", "Synchronize plots and frames.<br>Inspect time and segment labels.<br>Keep provenance visible.", { delay: 450, color: C.blue });
            card(s, 852, 329, 372, 292, "PROPOSED", "Align and compare", "Align to a reference frame.<br>Compare conformations.<br>Validate scientific results.", { delay: 650, color: C.gold });

            s = slide("08 / Your next research story", "Bring the evidence.<br>Keep the explanation alive.", "Start with one figure, one structure, or one mechanism worth exploring.", { key: "closing", dark: true, transition: "zoom", notes: "Closing slide. Invite the audience to open the native deck to explore scientific objects. The overview, figures and roadmap are all editable. Use the PDF for reading and the offline web package for supported browser playback." });
            ["LOAD YOUR INPUT", "BUILD YOUR FIGURE", "REHEARSE THE STORY"].forEach((label, i) => {
                const group = "closing-" + i;
                reveal(rect(s, 56 + i * 398, 372, 372, 126, "#193642"), 0, group);
                reveal(txt(s, label, 82 + i * 398, 410, 320, 55, 18, "#85CABC", 800), 0, group);
            });
            txt(s, "Open the native deck for live science. Use the exports for the audience.", 58, 572, 1150, 40, 23, "#B2C6CD");
            txt(s, "Questions about the data? " + link("backup", "Open the backup slide") + ".", 58, 628, 900, 30, 18, "#85CABC", 700);

            s = slide("Backup / Data sources", "Where the data on these slides comes from.", "A hidden slide: the show steps over it; links on the agenda and closing slides open it.", { hidden: true, transition: "none", key: "backup", notes: "Hidden backup slide (Hide Slide). Normal next and previous step over it; the agenda and closing links open it. It arrives with no transition, an instant cut." });
            table(s, [["Slides", "Content", "Source"], ["Charts, plots, chemistry, biology", "Example values", "Plugin examples, illustrative"], ["Landscapes", "(x² − 1)² + y²", "Illustrative equation"], ["Ubiquitin", "PDB 1UBQ", "Bundled structure file"], ["Trajectory", "8 sampled frames, 1,545 atoms", "Sa1 V90T path_protein.dcd, read only"]], 56, 304, 1168, 300, 18);
            txt(s, link("agenda", "← Back to the agenda"), 58, 628, 500, 30, 18, C.blue, 700);

            // The total in each counter (shown slides only) and the links: #slide:@key becomes the slide's id.
            const total = slides.filter(item => !item.hidden).length;
            slides.forEach(item => item.elements.forEach(e => {
                if (typeof e.content !== "string") return;
                e.content = e.content.replace(/__TOTAL__/g, String(total)).replace(/#slide:@([\w-]+)/g, (_m, key) => {
                    if (!keys[key]) throw Error("A link names no slide: @" + key);
                    return "#slide:" + keys[key];
                });
            }));
            if (slides.length < 40) throw Error("Expected at least 40 slides; found " + slides.length);
            state = { ...buildDefaultPresentationState(), title: "SlideForge — Scientific Presentation Showcase", schemaVersion: 1,
                presentationTheme: "blank", presentationTransition: "fade", pageSetup: "talk-16-9", showSettings: { targetMinutes: 40 }, slides };
            setCurrentSlideIndex(0);
            applyPresentationTheme("blank", { persist: false });
            setCurrentPresentationTitle("SlideForge Showcase 40 Slides");
            const at = Object.fromEntries(Object.entries(keys).map(([key, id]) => [key, slides.findIndex(item => item.id === id)]));
            window.__showcase40 = { jobs, at, notes: slides.map((s, i) => ({ slide: i + 1, hidden: Boolean(s.hidden), title: s.elements.find(e => e.type === "text" && parseFloat(e.styles.fontSize) === 46)?.content.replace(/<br>/g, " ") || "", notes: s.notes })) };
            return { jobs, at, count: slides.length, notes: window.__showcase40.notes };
        }, { protein, trajectory });
        console.log("Built", plan.count, "slides. Rendering", plan.jobs.length, "scientific objects.");
        for (const job of plan.jobs) {
            await page.evaluate(async job => {
                const e = state.slides[job.slide].elements.find(e => e.id === job.id);
                const plugin = getSlidePlugin(job.pluginId);
                if (!plugin) throw Error("Plugin unavailable: " + job.pluginId);
                e.pluginData = normalizePluginData(plugin, { ...plugin.defaultData, ...e.pluginData });
                const preview = await drawPluginElement(e);
                e.pluginPreview = preview.dataUrl; e.pluginPreviewKey = preview.key;
            }, job);
            console.log("Rendered", job.pluginId, "on slide", job.slide + 1);
        }
        await page.evaluate(async () => {
            await document.fonts.ready;
            normalizeStateIds();
            renderSlidesFromState();
            clearSelection();
        });
        // Avoid changing a user's existing deck; this process only uses the temporary instance.
        fs.writeFileSync(path.join(OUT, "speaker-notes.md"), plan.notes.map(n => `## ${String(n.slide).padStart(2, "0")}${n.hidden ? " (hidden backup)" : ""} — ${n.title.replace(/<[^>]+>/g, "")}\n\n${n.notes}\n`).join("\n"));
        fs.writeFileSync(path.join(OUT, "contents.json"), JSON.stringify(plan.notes, null, 2));
        // Slides with a live viewer or a 3D scene need longer to draw before their preview is taken.
        const slow = await page.evaluate(() => state.slides.map(s => s.background?.type === "three" || s.elements.some(e => e.type === "molecule" || e.pluginId === "landscape")));
        for (let index = 0; index < plan.count; index++) {
            await page.evaluate(index => { switchSlide(index); clearSelection(); }, index);
            await page.waitForTimeout(slow[index] ? 1500 : 260);
            const root = page.locator(".reveal .slides > section.present").first();
            await root.locator(".plugin-live-toggle").evaluateAll(nodes => nodes.forEach(n => { n.style.visibility = "hidden"; }));
            await root.screenshot({ path: path.join(OUT, "previews", `slide-${String(index + 1).padStart(2, "0")}.png`) });
            if ((index + 1) % 6 === 0) console.log("Captured", index + 1, "/", plan.count, "previews");
        }
        // Grouped playback on the build slides, reached as the show reaches them (presentationGoToSlide, as keys and links do).
        await page.evaluate(async () => { switchSlide(0); await togglePlayMode(); });
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        const builds = [];
        for (const index of [plan.at.workflow, plan.at.storytelling, plan.at.closing]) {
            await page.evaluate(i => presentationGoToSlide(i), index);
            await page.waitForFunction(i => _presentationRuntimeState.slideIndex === i && _presentationRuntimeState.advancedClickGroups.length > 0, index, { timeout: 15000 })
                .catch(async error => { throw Error(error.message + " " + JSON.stringify(await page.evaluate(i => ({ want: i, currentSlideIndex, prepared: _presentationRuntimeState.slideIndex, groups: _presentationRuntimeState.advancedClickGroups.length, playing: document.body.classList.contains("play-mode-active") }), index))); });
            const ids = await page.evaluate(() => _presentationRuntimeState.advancedClickGroups.map(g => g.entries[0].el.id));
            for (const id of ids) {
                const before = await page.evaluate(id => ({ opacity: getComputedStyle(document.querySelector('.presentation-slide.present [id="' + id + '"]')).opacity,
                    index: currentSlideIndex, shown: _presentationRuntimeState.revealedAdvancedGroups }), id);
                assert(Number(before.opacity) < 0.05, "Stage already visible: " + JSON.stringify({ slide: index + 1, id, before }));
                await page.keyboard.press("ArrowRight");
                await page.waitForFunction(id => Number(getComputedStyle(document.getElementById(id)).opacity) > 0.98, id);
                assert.equal(await page.evaluate(() => currentSlideIndex), index);
            }
            builds.push({ slide: index + 1, verifiedClicks: ids.length });
        }
        // The new slides' click steps, counted as the show prepares each slide.
        const steps = async key => {
            await page.evaluate(i => presentationGoToSlide(i), plan.at[key]);
            await page.waitForFunction(i => _presentationRuntimeState.slideIndex === i, plan.at[key]);
            await page.waitForTimeout(400);
            return page.evaluate(() => ({ bullets: _presentationRuntimeState.bulletSteps.length, clicks: _presentationRuntimeState.advancedClickGroups.length }));
        };
        const expected = { bullets: { bullets: 4, clicks: 1 }, branches: { bullets: 5, clicks: 0 }, emphasis: { bullets: 0, clicks: 5 }, entrances: { bullets: 0, clicks: 4 }, animatedCharts: { bullets: 0, clicks: 2 } };
        for (const [key, want] of Object.entries(expected)) {
            const got = await steps(key);
            assert.deepEqual(got, want, "Click steps on " + key + ": " + JSON.stringify(got));
            builds.push({ slide: plan.at[key] + 1, key, ...got });
        }
        // Click through the bullets: each click shows one more, and the slide stays put until the takeaway has come in.
        await steps("bullets");
        for (let k = 1; k <= 5; k++) {
            await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
            assert.equal(await page.evaluate(() => currentSlideIndex), plan.at.bullets, "left the bullet slide early");
        }
        assert.equal(await page.evaluate(() => document.querySelectorAll(".presentation-slide.present .sf-bullet-hidden").length), 0, "a bullet stayed hidden");
        // The hidden backup: Next steps over it from the slide before; a link opens it.
        await page.evaluate(i => presentationGoToSlide(i), plan.at.closing);
        await page.waitForFunction(i => _presentationRuntimeState.slideIndex === i, plan.at.closing);
        assert.equal(await page.evaluate(() => presentationShownSlideFrom(currentSlideIndex, 1)), -1, "the backup slide is not stepped over");
        await page.evaluate(id => goToLinkedSlide(id), await page.evaluate(i => state.slides[i].id, plan.at.backup));
        await page.waitForFunction(i => currentSlideIndex === i, plan.at.backup);
        builds.push({ slide: plan.at.backup + 1, key: "backup", hiddenSkipped: true, linkOpens: true });
        await page.evaluate(async () => { await togglePlayMode(); });
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        await page.waitForTimeout(350);
        const native = await page.evaluate(() => ({ title: currentPresentationTitle, schemaVersion: 1, ...getPersistableState() }));
        fs.writeFileSync(path.join(OUT, STEM + ".json"), JSON.stringify(native, null, 2));
        console.log("Exporting PowerPoint…");
        const pptxDownload = page.waitForEvent("download", { timeout: 600000 });
        await page.evaluate(() => exportPPTX());
        await (await pptxDownload).saveAs(path.join(OUT, STEM + ".pptx"));
        execFileSync("python3", [path.join(ROOT, "tools", "showcase-transitions-40.py"), path.join(OUT, STEM + ".pptx")]);
        console.log("Exporting PDF…");
        const pdfDownload = page.waitForEvent("download", { timeout: 600000 });
        await page.evaluate(() => exportPDF());
        await (await pdfDownload).saveAs(path.join(OUT, STEM + ".pdf"));
        console.log("Exporting offline web presentation…");
        const web = await page.evaluate(async () => {
            const blob = await buildViewerBundle({ includeVendor: true });
            return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
        });
        fs.writeFileSync(path.join(OUT, STEM + " Web.zip"), Buffer.from(web, "base64"));
        const validation = await page.evaluate(() => ({
            slideCount: state.slides.length, shownSlides: state.slides.filter(s => !s.hidden).length, talkMinutes: state.showSettings?.targetMinutes || 0,
            pageSize: getExportPageSetup(), transitions: [...new Set(state.slides.map(s => s.presentationTransition))],
            presets: [...new Set(state.slides.flatMap(s => s.elements.flatMap(e => (e.animation?.timelines || []).flatMap(t => t.animations.map(a => a.name)))))],
            plugins: state.slides.flatMap((s, i) => s.elements.filter(e => e.type === "plugin").map(e => ({ slide: i + 1, plugin: e.pluginId, preview: Boolean(e.pluginPreview) }))),
            types: [...new Set(state.slides.flatMap(s => s.elements.map(e => e.type)))],
        }));
        validation.builds = builds; validation.browserErrors = errors;
        fs.writeFileSync(path.join(OUT, "validation.json"), JSON.stringify(validation, null, 2));
        const slideList = plan.notes.map(n => `${String(n.slide).padStart(2, "0")}. ${n.title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}${n.hidden ? " (hidden backup)" : ""}`).join("\n");
        fs.writeFileSync(path.join(OUT, "README.md"), `# SlideForge: ${validation.shownSlides}-slide feature showcase\n\nOpen **${STEM}.json** in SlideForge for editable source objects, live exploration and every animation. The PowerPoint copy keeps supported builds and the nearest transitions (Convex as Gallery, Concave as Doors, with a Fade fallback). The PDF and numbered PNG previews are static. Extract the Web ZIP and open index.html for the offline viewer.\n\nThis extends the 30-slide showcase (../slideforge-feature-showcase-30/, unchanged) with an agenda of live links, animated charts, the landscape Top/Front/3D views, trajectory frame stepping, diagram branch reveal, bullet-by-bullet reveal, emphasis effects, entrances and exits, the show timer, recorder and presenter view, a 3D background, sharing, and a hidden backup slide. All seven slide transitions are used (${validation.transitions.join(", ")}); the deck has a ${validation.talkMinutes}-minute talk length for the show timer.\n\n## Slides\n\n${slideList}\n\nNotes are embedded in the deck and in speaker-notes.md.\n\nMost plot data is illustrative. Ubiquitin uses the bundled PDB 1UBQ structure. The trajectory slides use eight non-contiguous conformations sampled from the Sa1 V90T protein trajectory; 3 FPS is a presentation rate, not simulation time. No original simulation files were modified.\n\nLive scientific interaction is best in the native app. Landscape objects and the 3D background are saved stills in PPTX, PDF and standalone HTML. PowerPoint simplifies effects it lacks (emphasis, 3D flip, blur, explode, chart drawing, motion paths). Proposed roadmap features are labelled as such.\n`);
        assert(validation.slideCount >= 40, "slide count"); assert(validation.plugins.every(p => p.preview));
        assert.equal(validation.transitions.length, 7, "all seven transitions: " + validation.transitions);
        assert.deepEqual(errors, []);
        console.log("Created", OUT, JSON.stringify(validation));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
