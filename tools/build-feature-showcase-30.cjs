// Builds a 30-slide scientific presentation with the actual editor and export pipeline.
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "slideforge-feature-showcase-30");
const STEM = "SlideForge Showcase 30 Slides";
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
            const uid = p => "sf30-" + p + "-" + (++serial);
            const slides = [], jobs = [];
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
            const slide = (chapter, title, subtitle = "", { dark = false, transition = "fade", notes = "" } = {}) => {
                const n = slides.length + 1, s = { id: "showcase-30-slide-" + n, layoutId: "blank", masterId: "none",
                    presentationTransition: transition, notes, elements: [] };
                rect(s, 0, 0, 1280, 720, dark ? C.dark : C.paper, 0);
                txt(s, "SLIDEFORGE", 56, 34, 200, 26, 15, dark ? "#85CABC" : C.mint, 800, { letterSpacing: "0.16em" });
                txt(s, chapter.toUpperCase(), 274, 37, 720, 24, 12, dark ? "#A0B6BD" : C.muted, 700, { letterSpacing: "0.13em" });
                txt(s, String(n).padStart(2, "0") + " / 30", 1110, 35, 114, 24, 14, dark ? "#A0B6BD" : C.muted, 600, { textAlign: "right" });
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
            txt(s, "30 slides · native objects · staged reveals · slide transitions", 58, 611, 1160, 30, 18, "#B2C6CD");

            s = slide("01 / Why it matters", "A research talk is more than a set of pictures.", "The opportunity is to reduce the gap between making a figure and explaining it.", { notes: "Explain the workflow problem. SlideForge is useful when scientific objects need repeated editing or live inspection. Ordinary business slides may be served equally well by established tools." });
            card(s, 56, 324, 372, 293, "THE INPUT", "Data changes", "A new condition, fit or structure<br>should not require rebuilding<br>the entire slide.", { color: C.mint });
            card(s, 454, 324, 372, 293, "THE QUESTION", "The room asks why", "Rotate a structure or inspect<br>a surface while discussing<br>the underlying mechanism.", { delay: 430, color: C.blue });
            card(s, 852, 324, 372, 293, "THE HANDOFF", "Keep the source", "Share an accessible output<br>while retaining an editable<br>scientific master deck.", { delay: 610, color: C.gold });

            s = slide("01 / End-to-end workflow", "One workspace. Four stages.", "Import → build → explain → deliver. Each click adds the next stage.", { transition: "slide", notes: "Click four times. Each stage's background, label, title and body share a click group. Native and offline web playback use the same grouping." });
            [["01", "Bring", "PPTX + Keynote<br>Tables + structure files"], ["02", "Build", "Figures + equations<br>Scientific plugins"], ["03", "Explain", "Notes + live objects<br>Click-by-click builds"], ["04", "Deliver", "PPTX + PDF<br>Offline web"]].forEach((v, i) => {
                card(s, 56 + i * 298, 330, 274, 285, v[0], v[1], v[2], { group: "workflow-" + i, color: [C.mint, C.blue, C.gold, C.mint][i] });
            });

            s = slide("02 / Editable charts", "Your chart should remain a chart.", "Edit series and labels directly rather than replacing a pasted screenshot.", { notes: illustrative });
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

            s = slide("03 / Landscapes in two dimensions", "Inspect the shape of a field.", "A heatmap and contours provide a complementary view of the same equation.", { notes: "Illustrative equation, not measured energy or a probability-to-energy conversion. In SlideForge, hover over the live landscape to inspect values." });
            plot(s, "landscape", { view: "both", equation: "(x^2-1)^2+y^2", title: "", resolution: 41, fontSize: 15, xLabel: "x", yLabel: "y", valueLabel: "f(x,y)" });
            aside(s, "Keep the definition.", ["Equation or CSV grid.", "Contour levels and colour scale.", "Units and normalization stated explicitly."]);

            s = slide("03 / Landscapes in three dimensions", "Let the audience explore the surface.", "Rotate, zoom and inspect a native 3D landscape while presenting.", { dark: true, transition: "zoom", notes: "Live 3D surface in the native app. Automatic rotation is enabled at 12 degrees per second. The plot is an illustrative double well. Standalone HTML/PPTX/PDF retain its saved still." });
            plot(s, "landscape", { view: "surface", equation: "(x^2-1)^2+y^2", title: "", resolution: 33, fontSize: 14, autoRotate: true, rotationSpeed: 12, stage: "slate", zeroPlane: false });
            aside(s, "A live explanation.", ["Drag to change the view.", "Inspect a region in response to a question.", "Keep a still for fixed-format exports."], { dark: true });

            s = slide("03 / Molecular structures", "Turn the protein, not the entire slide.", "A native molecule object keeps the structure available for exploration.", { dark: true, notes: "Ubiquitin, PDB 1UBQ, from the bundled source file tools/showcase/1ubq.pdb. Orthographic projection and automatic molecular rotation are enabled." });
            molecule(s, protein, "Ubiquitin · PDB 1UBQ");
            aside(s, "Ubiquitin / 1UBQ", ["Load a supported structure file.", "Choose the representation.", "Rotate and inspect during the talk."], { dark: true });

            s = slide("03 / Trajectory playback", "Move through conformations deliberately.", "Play, pause, step and jump to a frame inside the presentation.", { dark: true, transition: "slide", notes: "Sa1 V90T connected_path: eight sampled conformations from source frames 0, 218, 435, 653, 870, 1088, 1305 and 1523 of path_protein.dcd, paired with protein.pdb (1,545 atoms). Sampling is non-contiguous; 3 FPS is an illustrative presentation rate, not simulation time. Source files were read without changes. Native presentation autoplay is enabled; exports may use a still." });
            molecule(s, trajectory, "Sa1 V90T · eight sampled conformations", { frames: true, auto: false });
            aside(s, "Your folding pathway.", ["8 sampled conformations.", "1,545 atoms per frame.", "Illustrative playback rate: 3 FPS."], { dark: true });

            s = slide("03 / Molecular selections", "Direct attention to a region.", "Representation layers separate a selected region from the rest of the structure.", { dark: true, notes: "PDB 1UBQ. Residues 20–35 are highlighted as a visual selection example; no functional claim about this region is made." });
            molecule(s, protein, "1UBQ · selected residues 20–35", { auto: false, layers: [{ id: "residue-highlight", kind: "cartoon", selectionQuery: "20-35", colorScheme: "custom", customColor: "#F2B84B", radius: 1, opacity: 1 }] });
            aside(s, "A visual selection.", ["Highlight a residue range.", "Choose its colour and style.", "Explain what the selection means."], { dark: true });

            s = slide("04 / Chemistry", "Bring chemical structure into the story.", "Structure drawings and energy profiles can sit beside the explanation.", { notes: "Illustrative chemistry objects. The structure uses the bundled RDKit example SMILES. The energy profile uses example states and values, not a calculated reaction pathway." });
            plot(s, "rdkit", { smiles: "CC(=O)Oc1ccccc1C(=O)O", fontSize: 17 }, { x: 56, y: 310, w: 550, h: 337 });
            plot(s, "energy-levels", { fontSize: 15, curve: true }, { x: 650, y: 310, w: 574, h: 337 });

            s = slide("04 / Biology annotations", "Make biological organization visible.", "Maps and domain architecture turn a feature list into a figure.", { notes: "Bundled plasmid-map and protein-domain examples. These are capability demonstrations and should be replaced or checked against the intended sequence." });
            plot(s, "plasmid-map", { fontSize: 16 }, { x: 56, y: 309, w: 550, h: 338 });
            plot(s, "domain-architecture", { fontSize: 15 }, { x: 650, y: 309, w: 574, h: 338 });

            s = slide("04 / Trees and sequences", "Keep relationships and sequence context together.", "Phylogenetic trees and sequence logos are separate editable scientific objects.", { notes: "Bundled illustrative tree and sequence-logo inputs. This deck does not infer a phylogeny or a new motif from experimental data." });
            plot(s, "phylo-tree", { fontSize: 16 }, { x: 56, y: 310, w: 550, h: 337 });
            plot(s, "sequence-logo", { fontSize: 16 }, { x: 650, y: 310, w: 574, h: 337 });

            s = slide("05 / Mechanism diagrams", "Turn a pathway into a narrative.", "Use connected shapes or a Mermaid diagram to explain cause and sequence.", { notes: "The mechanism shown here is a generic explanatory diagram: stimulus → transition → response. It is not a claimed biological mechanism." });
            const diagram = createMermaidElementData({ mermaidSource: "flowchart LR\nA[Input or stimulus] --> B[State transition]\nB --> C[Measured response]", theme: "default", style: { fontSize: 22 } });
            Object.assign(diagram, { id: uid("diagram"), x: 72, y: 332, width: "1120px", height: "248px", styles: { zIndex: layer++ } });
            rect(s, 56, 310, 1168, 320, C.white); diagram.styles.zIndex = layer++; s.elements.push(diagram); reveal(diagram, 350);

            s = slide("05 / Animation vocabulary", "Use motion to establish visual order.", "Automatic entrance effects can introduce information without requiring a click.", { transition: "zoom", notes: "The five tiles enter automatically with staggered fade/zoom entrances. Motion is used to direct attention, not to obscure information." });
            ["Frame the question", "Show the evidence", "Name the mechanism", "State the conclusion", "Invite inspection"].forEach((label, i) => {
                const x = 56 + i * 238;
                reveal(rect(s, x, 348, 216, 235, C.white), i * 230 + 250);
                reveal(txt(s, String(i + 1).padStart(2, "0"), x + 23, 373, 170, 46, 34, i % 2 ? C.blue : C.mint, 800), i * 230 + 300);
                reveal(txt(s, label, x + 23, 441, 170, 108, 23, C.ink, 800), i * 230 + 350, null, i === 3 ? "scaleInPlace" : "fadeIn");
            });

            s = slide("05 / Click-by-click storytelling", "One click. One idea.", "Each card enters as a coherent group, keeping text and background together.", { notes: "Click once for each of the three cards. The formula shares the second card's click. This is an actual grouped-build demonstration." });
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

            s = slide("05 / Slide transitions", "Let transitions signal a change of context.", "The deck uses Fade, Slide and Zoom transitions at deliberate boundaries.", { transition: "slide", notes: "This slide arrives with a Slide transition. The scientific surface slide and animation-vocabulary slide use Zoom. Most detail slides use Fade. These are actual per-slide transition settings." });
            card(s, 56, 329, 372, 292, "FADE", "Stay in the argument", "Use continuity when the<br>audience is comparing<br>closely related evidence.", { color: C.mint });
            card(s, 454, 329, 372, 292, "SLIDE", "Move to the next stage", "Signal a new workflow step<br>or a different part<br>of the explanation.", { delay: 450, color: C.blue });
            card(s, 852, 329, 372, 292, "ZOOM", "Change the scale", "Use sparingly when moving<br>between an overview<br>and a specific object.", { delay: 650, color: C.gold });

            s = slide("06 / Presenter tools", "Keep the explanation in your hands.", "Notes, presenter view, pointer tools and staged builds support the talk.", { notes: "Demonstrate presenter view from the app if desired. Tools mentioned here are capabilities, not screenshots of a running presenter session. This slide includes an actual QR-code plugin object linking to the project's repository." });
            card(s, 56, 329, 372, 292, "BEFORE", "Prepare the narrative", "Write speaker notes.<br>Rehearse the click order.<br>Check fonts and media.", { color: C.mint });
            card(s, 454, 329, 372, 292, "DURING", "Direct attention", "Use pointer or spotlight.<br>Annotate with the chalkboard.<br>Pause to inspect an object.", { delay: 450, color: C.blue });
            plot(s, "qr-code", { text: "https://github.com/dmighty007/slideforge-studio", label: "Project repository" }, { x: 944, y: 330, w: 200, h: 200 });
            txt(s, "OPEN THE PROJECT", 884, 559, 320, 30, 15, C.mint, 800, { textAlign: "center" });

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

            s = slide("07 / Existing decks", "Bring PowerPoint and Keynote into one workspace.", "Direct imports are useful; preservation quality still depends on the source deck.", { transition: "slide", notes: "SlideForge can import PPTX and KEY. This is not a claim that import fidelity is perfect or that SlideForge exports native Keynote files. Check complex layouts, missing fonts, media, and unsupported builds." });
            tag(s, "PPTX", 118, 334, 222, C.blue, "#E2E9FF"); tag(s, "KEYNOTE", 118, 422, 222, C.mint);
            txt(s, "→", 385, 379, 100, 90, 60, C.muted, 500);
            rect(s, 534, 328, 690, 285, C.white);
            txt(s, "A common editing canvas", 565, 358, 620, 55, 31, C.ink, 800);
            txt(s, "Check layout, fonts, charts and media.<br><br>Retain the original file and compare the imported result.", 565, 441, 620, 140, 22, C.muted);

            s = slide("07 / Export and portability", "Choose the format for the destination.", "The native deck is the editable master; exports carry supported representations.", { notes: "Native SlideForge preserves supported input objects and data. PPTX preserves supported editable text, shapes, tables and charts, while scientific objects may become images. PDF is static. Offline HTML preserves supported viewer interactions; Landscape is currently a saved still in standalone HTML." });
            table(s, [["Format", "Best use", "Important boundary"], ["SlideForge", "Continue scientific editing", "Keep source data + objects"], ["PowerPoint", "Share a familiar deck", "Some science objects become images"], ["PDF", "Read, print, archive", "Static pages"], ["Offline HTML", "Present in a browser", "Live support varies by object"]], 56, 314, 1168, 325, 18);

            s = slide("08 / Possible next features", "Build depth before adding more surface area.", "These are proposed directions, not features promised by this deck.", { dark: true, notes: "Roadmap: timeline annotations, per-frame metrics and reference alignment are possible future improvements. They are explicitly not presented as implemented capabilities. Prioritize reliability and scientific validation." });
            card(s, 56, 329, 372, 292, "PROPOSED", "Annotate the trajectory", "Mark important frames.<br>Attach mechanism notes.<br>Jump to named events.", { color: C.mint });
            card(s, 454, 329, 372, 292, "PROPOSED", "Link metrics to motion", "Synchronize plots and frames.<br>Inspect time and segment labels.<br>Keep provenance visible.", { delay: 450, color: C.blue });
            card(s, 852, 329, 372, 292, "PROPOSED", "Align and compare", "Align to a reference frame.<br>Compare conformations.<br>Validate scientific results.", { delay: 650, color: C.gold });

            s = slide("08 / Your next research story", "Bring the evidence.<br>Keep the explanation alive.", "Start with one figure, one structure, or one mechanism worth exploring.", { dark: true, transition: "zoom", notes: "Closing slide. Invite the audience to open the native deck to explore scientific objects. The overview, figures and roadmap are all editable. Use the PDF for reading and the offline web package for supported browser playback." });
            ["LOAD YOUR INPUT", "BUILD YOUR FIGURE", "REHEARSE THE STORY"].forEach((label, i) => {
                const group = "closing-" + i;
                reveal(rect(s, 56 + i * 398, 372, 372, 126, "#193642"), 0, group);
                reveal(txt(s, label, 82 + i * 398, 410, 320, 55, 18, "#85CABC", 800), 0, group);
            });
            txt(s, "Open the native deck for live science. Use the exports for the audience.", 58, 585, 1150, 65, 23, "#B2C6CD");

            if (slides.length !== 30) throw Error("Expected 30 slides; found " + slides.length);
            state = { ...buildDefaultPresentationState(), title: "SlideForge — Scientific Presentation Showcase", schemaVersion: 1,
                presentationTheme: "blank", presentationTransition: "fade", pageSetup: "talk-16-9", slides };
            setCurrentSlideIndex(0);
            applyPresentationTheme("blank", { persist: false });
            setCurrentPresentationTitle("SlideForge Showcase 30 Slides");
            window.__showcase30 = { jobs, notes: slides.map((s, i) => ({ slide: i + 1, title: s.elements.find(e => e.type === "text" && parseFloat(e.styles.fontSize) === 46)?.content.replace(/<br>/g, " ") || "", notes: s.notes })) };
            return { jobs, notes: window.__showcase30.notes };
        }, { protein, trajectory });
        console.log("Built 30-slide structure. Rendering", plan.jobs.length, "scientific objects.");
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
        fs.writeFileSync(path.join(OUT, "speaker-notes.md"), plan.notes.map(n => `## ${String(n.slide).padStart(2, "0")} — ${n.title}\n\n${n.notes}\n`).join("\n"));
        fs.writeFileSync(path.join(OUT, "contents.json"), JSON.stringify(plan.notes, null, 2));
        for (let index = 0; index < 30; index++) {
            await page.evaluate(index => { switchSlide(index); clearSelection(); }, index);
            await page.waitForTimeout([13, 14, 15].includes(index) ? 1300 : 230);
            const root = page.locator(".reveal .slides > section.present").first();
            await root.locator(".plugin-live-toggle").evaluateAll(nodes => nodes.forEach(n => { n.style.visibility = "hidden"; }));
            await root.screenshot({ path: path.join(OUT, "previews", `slide-${String(index + 1).padStart(2, "0")}.png`) });
            if ((index + 1) % 5 === 0) console.log("Captured", index + 1, "/ 30 previews");
        }
        // Test actual grouped playback on the two instructional build slides.
        await page.evaluate(async () => { switchSlide(0); await togglePlayMode(); });
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        const builds = [];
        for (const index of [2, 21, 29]) {
            await page.evaluate(i => switchSlide(i), index);
            await page.waitForFunction(i => _presentationRuntimeState.slideIndex === i && _presentationRuntimeState.advancedClickGroups.length > 0, index);
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
        await page.evaluate(async () => { await togglePlayMode(); });
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        await page.waitForTimeout(350);
        const native = await page.evaluate(() => ({ title: currentPresentationTitle, schemaVersion: 1, ...getPersistableState() }));
        fs.writeFileSync(path.join(OUT, STEM + ".json"), JSON.stringify(native, null, 2));
        console.log("Exporting PowerPoint…");
        const pptxDownload = page.waitForEvent("download", { timeout: 600000 });
        await page.evaluate(() => exportPPTX());
        await (await pptxDownload).saveAs(path.join(OUT, STEM + ".pptx"));
        execFileSync("python3", [path.join(ROOT, "tools", "showcase-transitions.py"), path.join(OUT, STEM + ".pptx")]);
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
            slideCount: state.slides.length, pageSize: getExportPageSetup(), transitions: [...new Set(state.slides.map(s => s.presentationTransition))],
            plugins: state.slides.flatMap((s, i) => s.elements.filter(e => e.type === "plugin").map(e => ({ slide: i + 1, plugin: e.pluginId, preview: Boolean(e.pluginPreview) }))),
            types: [...new Set(state.slides.flatMap(s => s.elements.map(e => e.type)))],
        }));
        validation.builds = builds; validation.browserErrors = errors;
        fs.writeFileSync(path.join(OUT, "validation.json"), JSON.stringify(validation, null, 2));
        fs.writeFileSync(path.join(OUT, "README.md"), `# SlideForge: 30-slide scientific showcase\n\nOpen **${STEM}.json** in SlideForge for editable source objects and live exploration. The PowerPoint copy preserves supported slide builds and transitions. The PDF and numbered PNG previews are static. Extract the Web ZIP and open index.html for the offline viewer.\n\nThe original three-slide showcase is preserved in ../slideforge-feature-showcase/.\n\nSlides cover: workflow (1–3), data and figures (4–11), landscapes and molecules (12–16), chemistry and biology (17–19), diagrams and motion (20–24), presenting and media (25–26), imports/exports (27–28), proposed features (29), and a closing build (30). Notes are embedded in the deck and provided in speaker-notes.md.\n\nMost plot data is illustrative. Ubiquitin uses the bundled PDB 1UBQ structure. Slide 15 contains eight non-contiguous conformations sampled from the provided Sa1 V90T protein trajectory; 3 FPS is a presentation rate, not physical simulation time. No original simulation files were modified.\n\nLive scientific interaction is best experienced in the native app. Landscape objects use saved stills in PPTX, PDF and standalone HTML. Advanced motion-path effects may be simplified by PowerPoint. Proposed roadmap features are explicitly labelled.\n`);
        assert.equal(validation.slideCount, 30); assert(validation.plugins.every(p => p.preview));
        assert.deepEqual(errors, []);
        console.log("Created", OUT, JSON.stringify(validation));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
