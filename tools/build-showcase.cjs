// Builds the capability showcase decks for the documentation site (mkdocs.yml) with the real editor, and exports
// each one with SlideForge's own offline web export: docs/showcase/decks/<name>/index.html plays in a browser.
// A screenshot of every slide goes to docs/showcase/decks/<name>/slides/NN.png for the pages around them.
//
// Needs a running SlideForge server (the same one the browser tests use):
//   SLIDEFORGE_ACCOUNTS_ENABLED=0 python backend/manage.py runserver 127.0.0.1:8076
//   node tools/build-showcase.cjs [--url=http://127.0.0.1:8076/] [--only=capabilities]
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "showcase", "decks");
const URL = process.argv.find(a => a.startsWith("--url="))?.slice(6) || process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/";
const ONLY = process.argv.find(a => a.startsWith("--only="))?.slice(7);

async function openEditor(browser) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
        try {
            sessionStorage.setItem("pptmaker_entry_gate_dismissed", "true");
        } catch {} // the molecule viewer's sandboxed frame has no storage
        document.addEventListener("DOMContentLoaded", () => {
            window.openStartScreen = () => false;
        });
    });
    page.on("pageerror", error => console.warn("  page error:", error.message));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof addElement === "function" && typeof insertPluginElement === "function" && typeof Reveal?.slide === "function" && typeof buildViewerBundle === "function", null, { timeout: 30000 });
    // As the browser tests do: once the deck the page opened with has loaded, a new project.
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => typeof isPresentationHydrating !== "function" || !isPresentationHydrating());
    await page.evaluate(async () => {
        await createNewProject();
    });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    return { context, page };
}

// Helpers defined inside the page: text for a slide's title and body, and boxes placed in slide coordinates.
async function installHelpers(page) {
    await page.evaluate(() => {
        const html = text => String(text);
        window.__sf = {
            slide: () => state.slides[currentSlideIndex],
            setText(el, content) {
                el.content = html(content);
                delete el.textDocument;
                if (typeof createTextDocumentFromLegacyContent === "function") {
                    el.textDocument = createTextDocumentFromLegacyContent(el.content, { bulletStyle: el.bulletStyle || "none" });
                }
            },
            title(text) {
                const el = window.__sf.slide().elements.find(e => e.placeholderRole === "title" || e.placeholder === "Click to add title");
                if (el) window.__sf.setText(el, text);
                return el?.id;
            },
            dropEmptyContent() {
                const slide = window.__sf.slide();
                slide.elements = slide.elements.filter(e => !(e.placeholderRole === "content" && !String(e.content || "").replace(/<[^>]*>/g, "").trim()));
            },
            place(id, x, y, w, h) {
                const el = window.__sf.slide().elements.find(e => e.id === id);
                if (!el) return;
                Object.assign(el, { x, y, width: `${w}px`, height: `${h}px` });
            },
            caption(text, x, y, w, size = 20) {
                const id = generateId("el");
                const theme = getPresentationTheme();
                const el = {
                    id,
                    type: "text",
                    content: text,
                    bulletStyle: "none",
                    autoHeight: true,
                    textFitMode: "autoHeight",
                    x,
                    y,
                    width: `${w}px`,
                    height: "auto",
                    styles: { zIndex: getNextZIndex(), color: theme.mutedTextColor || theme.defaultTextColor, fontSize: `${size}px`, textAlign: "left" },
                };
                window.__sf.setText(el, text);
                window.__sf.slide().elements.push(el);
                return id;
            },
        };
    });
}

const settle = page => page.waitForTimeout(700);
const newSlide = async (page, title) => {
    await page.evaluate(t => {
        addSlide();
        window.__sf.title(t);
        renderSlidesFromState();
    }, title);
};
const plugin = (page, id, data = null) => page.evaluate(([id, data]) => insertPluginElement(id, data, { ask: false }), [id, data]);
const redraw = page => page.evaluate(() => renderSlidesFromState());

// The capabilities deck: one kind of figure per slide, each made the way a user would (charts, plugins with their
// example data, an equation, a protein from a PDB file).
async function buildCapabilities(page) {
    const W = await page.evaluate(() => getExportPageSetup().width);
    const H = await page.evaluate(() => getExportPageSetup().height);
    console.log(`  slide size ${W}x${H}`);

    await page.evaluate(() => {
        changePresentationTheme("tidepool");
        const slide = state.slides[0];
        const theme = getPresentationTheme();
        const [title, ...rest] = slide.elements.filter(e => e.type === "text");
        if (title) {
            window.__sf.setText(title, "<strong>SlideForge</strong>");
            title.styles = { ...title.styles, fontSize: "88px", fontWeight: "700" };
        }
        if (rest[0]) {
            window.__sf.setText(rest[0], "Scientific figures. Presentation ready.");
            rest[0].styles = { ...rest[0].styles, fontSize: "34px", color: theme.accentStrong || rest[0].styles?.color };
        }
        renderSlidesFromState();
    });

    // Charts
    await newSlide(page, "Paste a table, get a chart");
    await page.evaluate(() => {
        addChart("bar");
        const el = window.__sf.slide().elements.find(e => e.type === "chart");
        el.chartData.labels = ["Control", "1 µM", "5 µM", "10 µM", "50 µM"];
        el.chartData.datasets = [
            { label: "Wild type", data: [100, 92, 71, 48, 22] },
            { label: "Resistant mutant", data: [100, 98, 94, 87, 70] },
        ];
        el.chartStyle = { ...el.chartStyle, xTitle: "Drug concentration", yTitle: "Growth (% of control)", legend: "top" };
        applyChartSeriesColors?.(el, getPresentationTheme());
        renderSlidesFromState();
    });

    // Curve fit and its equation
    await newSlide(page, "Fit a model where the data lives");
    const fit = await plugin(page, "curve-fit");
    // The example fits a dose-response (Hill) curve: its equation beside the plot.
    await page.evaluate(() => addEquationElement("R = \\frac{R_{\\max}\\,[D]^{\\,n}}{EC_{50}^{\\,n} + [D]^{\\,n}}"));
    await settle(page);
    await page.evaluate(([fit, W]) => {
        const slide = window.__sf.slide();
        const eq = slide.elements.find(e => e.type === "equation");
        window.__sf.dropEmptyContent();
        window.__sf.place(fit, 60, 150, Math.round(W * 0.62), 520);
        if (eq) window.__sf.place(eq.id, Math.round(W * 0.68), 330, Math.round(W * 0.28), 120);
        renderSlidesFromState();
    }, [fit, W]);
    await settle(page);

    // Survival
    await newSlide(page, "Survival curves with the numbers at risk");
    await plugin(page, "kaplan-meier");

    // Heatmap
    await newSlide(page, "Heatmaps from a pasted matrix");
    await plugin(page, "heatmap");

    // Volcano
    await newSlide(page, "Volcano plots for differential expression");
    await plugin(page, "volcano");

    // Plasmid
    await newSlide(page, "Plasmid maps from a feature list");
    await plugin(page, "plasmid-map");

    // Phylogeny
    await newSlide(page, "Phylogenetic trees from Newick text");
    await plugin(page, "phylo-tree");

    // Chemistry
    await newSlide(page, "Chemistry: structures and energy diagrams");
    const smiles = await plugin(page, "rdkit");
    const energy = await plugin(page, "energy-levels");
    await page.evaluate(([a, b, W]) => {
        window.__sf.dropEmptyContent();
        window.__sf.place(a, 80, 170, W / 2 - 120, 420);
        window.__sf.place(b, W / 2 + 40, 170, W / 2 - 120, 420);
        renderSlidesFromState();
    }, [smiles, energy, W]);

    // Molecule
    await newSlide(page, "Proteins you can turn during the talk");
    const chooser = page.waitForEvent("filechooser");
    await page.evaluate(() => {
        const button = document.querySelector("button[title='PDB or Trajectory']");
        button.closest("details")?.setAttribute("open", "");
        button.click();
    });
    await (await chooser).setFiles(path.join(__dirname, "showcase", "1ubq.pdb"));
    await page.waitForFunction(() => state.slides[currentSlideIndex].elements.some(e => e.type === "molecule"), null, { timeout: 20000 });
    await page.evaluate(([W, H]) => {
        const mol = window.__sf.slide().elements.find(e => e.type === "molecule");
        window.__sf.dropEmptyContent();
        window.__sf.place(mol.id, 80, 140, W - 160, H - 210);
        renderSlidesFromState();
    }, [W, H]);
    await page.waitForTimeout(3000);
    // Framed again for the larger box (the viewer fitted the structure to the box it was inserted in).
    await page.evaluate(() => document.querySelectorAll(".molecule-embed-frame").forEach(f => f.contentWindow?.postMessage({ type: "pptmaker:molecule:reset-view" }, "*")));
    await page.waitForTimeout(1500);

    // Physics
    await newSlide(page, "Physics: Feynman diagrams and circuits");
    const feyn = await plugin(page, "feynman");
    const circuit = await plugin(page, "circuit");
    await page.evaluate(([a, b, W]) => {
        window.__sf.dropEmptyContent();
        window.__sf.place(a, 80, 170, W / 2 - 120, 420);
        window.__sf.place(b, W / 2 + 40, 170, W / 2 - 120, 420);
        renderSlidesFromState();
    }, [feyn, circuit, W]);

    // Closing
    await newSlide(page, "Free, open source, on your computer");
    await page.evaluate(() => {
        const body = window.__sf.slide().elements.find(e => e.placeholderRole === "content");
        if (body) {
            body.bulletStyle = "default";
            window.__sf.setText(body, "<ul><li>Open PowerPoint and Keynote files</li><li>Export editable PowerPoint, searchable PDF or this web page</li><li>26 science plugins, and your own</li><li>Linux, macOS and Windows</li></ul>");
        }
        renderSlidesFromState();
    });
    await settle(page);
}

async function loadJsonDeck(page, file) {
    const deck = JSON.parse(fs.readFileSync(file, "utf8"));
    await page.evaluate(deck => {
        state = { ...buildDefaultPresentationState(), ...deck };
        currentSlideIndex = 0;
        if (deck.presentationTheme) applyPresentationTheme(deck.presentationTheme, { persist: false });
        renderSlidesFromState();
    }, deck);
    await page.waitForTimeout(1500);
}

async function screenshotSlides(page, dir) {
    fs.mkdirSync(dir, { recursive: true });
    const count = await page.evaluate(() => state.slides.length);
    for (let i = 0; i < count; i++) {
        await page.evaluate(i => {
            currentSlideIndex = i;
            renderSlidesFromState();
            selectElement?.(null);
            clearSelection?.();
        }, i);
        await page.waitForTimeout(i === 0 ? 1500 : 900);
        const slide = page.locator(".reveal .slides > section.present").first();
        await slide.screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, "0")}.png`) });
    }
    return count;
}

async function exportWeb(page, dir) {
    const files = await page.evaluate(async () => {
        const blob = await buildViewerBundle({ includeVendor: true });
        const zip = await JSZip.loadAsync(blob);
        const out = {};
        for (const [name, entry] of Object.entries(zip.files)) {
            if (!entry.dir) out[name] = await entry.async("base64");
        }
        return out;
    });
    for (const [name, data] of Object.entries(files)) {
        const target = path.join(dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(data, "base64"));
    }
    return Object.keys(files).length;
}

const DECKS = {
    capabilities: { title: "SlideForge capabilities", build: buildCapabilities },
    animations: { title: "Animation showcase", build: page => loadJsonDeck(page, path.join(ROOT, "docs", "examples", "animation-showcase.json")) },
};

(async () => {
    const browser = await chromium.launch();
    for (const [name, deck] of Object.entries(DECKS)) {
        if (ONLY && ONLY !== name) continue;
        console.log(`${name}: building`);
        const { context, page } = await openEditor(browser);
        await installHelpers(page);
        await deck.build(page);
        const dir = path.join(OUT, name);
        fs.rmSync(dir, { recursive: true, force: true });
        const slides = await screenshotSlides(page, path.join(dir, "slides"));
        if (!process.argv.includes("--no-export")) {
            const n = await exportWeb(page, dir);
            console.log(`${name}: ${slides} slides, ${n} files in docs/showcase/decks/${name}/`);
        } else console.log(`${name}: ${slides} slides (not exported)`);
        await context.close();
    }
    await browser.close();
})();
