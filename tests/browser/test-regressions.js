// Regression tests for bugs found in the 2026-09 audit.
// Usage: SLIDEFORGE_TEST_URL=<launch URL printed by `slideforge --no-open`> node tests/browser/test-regressions.js
// Set SLIDEFORGE_FRONTEND_ONLY=1 to skip the tests that need the saving API.
const { chromium } = require("playwright");

const TEST_URL = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/";
const FRONTEND_ONLY = process.env.SLIDEFORGE_FRONTEND_ONLY === "1";
const results = { passed: [], failed: [] };

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function openEditor(context) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.dismiss());
    await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
            // These suites test the editor itself; test-start-screen.js covers the start screen.
            window.openStartScreen = () => false;
        });
    });
    await page.goto(TEST_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof renderSlidesFromState === "function" && document.querySelector(".presentation-slide"));
    await page.waitForTimeout(500);
    return { page, errors };
}

// SLIDEFORGE_TEST_FILTER: optional text; only tests whose name contains it run ("a||b" runs tests matching either).
const TEST_FILTERS = (process.env.SLIDEFORGE_TEST_FILTER || "").split("||").filter(Boolean);

// The editor on a new, empty project: tests that add their own objects do not meet ones an earlier run saved.
async function openFreshEditor(context) {
    const opened = await openEditor(context);
    // After the deck the page opened with has finished loading: a new project made while it was still loading
    // raced with it (the page's context was lost in the next step now and then).
    await opened.page.waitForLoadState("networkidle");
    await opened.page.waitForFunction(() => typeof isPresentationHydrating !== "function" || !isPresentationHydrating());
    await opened.page.evaluate(async () => {
        await createNewProject();
    });
    await opened.page.waitForLoadState("networkidle");
    await opened.page.waitForTimeout(300);
    return opened;
}

async function test(name, fn) {
    if (TEST_FILTERS.length && !TEST_FILTERS.some(filter => name.includes(filter))) return;
    try {
        await fn();
        results.passed.push(name);
        console.log(`PASS ${name}`);
    } catch (error) {
        results.failed.push(name);
        console.log(`FAIL ${name}\n  ${error.message}`);
    }
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    // SLIDEFORGE_STORAGE_STATE: optional Playwright storage state (e.g. a signed-in session for the web app).
    const context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
        ...(process.env.SLIDEFORGE_STORAGE_STATE ? { storageState: process.env.SLIDEFORGE_STORAGE_STATE } : {}),
    });

    await test("whiteboard text: Escape cancels without an error or a committed text", async () => {
        const { page, errors } = await openEditor(context);
        const before = await page.evaluate(async () => {
            toggleWhiteboardMode();
            await new Promise(resolve => setTimeout(resolve, 300));
            const engine = getWhiteboardEngine();
            const rect = engine.canvas.getBoundingClientRect();
            const count = engine.elements.length;
            engine.startTextEditor({ x: 120, y: 120 }, { clientX: rect.left + 120, clientY: rect.top + 120 });
            await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
            return count;
        });
        await page.keyboard.type("draft note");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => getWhiteboardEngine().elements.length);
        assert(!errors.some(e => /remove/.test(e)), `page error: ${errors.join(" | ")}`);
        assert(after === before, `Escape committed the text (${before} -> ${after} elements)`);
        await page.close();
    });

    await test("PDF panel: a crafted PDF URL is not executed and javascript: URLs are rejected", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(async () => {
            state.slides[currentSlideIndex].elements.push({
                id: "el_pdfxss", type: "pdf", x: 40, y: 40, width: "300px", height: "200px",
                content: 'x" autofocus onfocus="window.__pdfXss = 1', pdfAnnotations: [], styles: {},
            });
            renderSlidesFromState();
            selectElement("el_pdfxss");
            await new Promise(resolve => setTimeout(resolve, 800));
            const field = document.getElementById("prop-pdf-url");
            field.focus();
            field.value = "javascript:alert(1)";
            field.dispatchEvent(new Event("change"));
            field.dispatchEvent(new Event("blur"));
            await new Promise(resolve => setTimeout(resolve, 300));
            return {
                executed: Boolean(window.__pdfXss),
                injectedAttribute: field.hasAttribute("onfocus"),
                content: state.slides[currentSlideIndex].elements.find(e => e.id === "el_pdfxss").content,
            };
        });
        assert(!outcome.executed && !outcome.injectedAttribute, "PDF URL value broke out of its attribute");
        assert(!/^javascript:/i.test(outcome.content), "javascript: URL was stored");
        await page.close();
    });

    await test("color and slider drags add one undo step, not one per tick", async () => {
        const { page } = await openEditor(context);
        const added = await page.evaluate(async () => {
            addConnector("line");
            const id = state.slides[currentSlideIndex].elements.at(-1).id;
            selectElement(id);
            await new Promise(resolve => setTimeout(resolve, 800));
            const input = document.getElementById("prop-connector-color");
            const before = undoStack.length;
            for (let i = 0; i < 20; i++) {
                input.value = `#${(0x100000 + i * 4000).toString(16).slice(0, 6)}`;
                input.dispatchEvent(new Event("input"));
            }
            input.dispatchEvent(new Event("change"));
            return undoStack.length - before;
        });
        assert(added === 1, `expected 1 undo step for the drag, got ${added}`);
        await page.close();
    });

    await test("reordering slides is its own undo step", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(() => {
            addSlide();
            addSlide();
            const order = () => state.slides.map(s => s.id).join(",");
            const before = order();
            reorderSlides(2, 0);
            const moved = order();
            undo();
            return { before, moved, afterUndo: order() };
        });
        assert(outcome.moved !== outcome.before, "reorder did nothing");
        assert(outcome.afterUndo === outcome.before, "undo did not restore the slide order");
        await page.close();
    });

    await test("re-rendering a molecule does not pile up window message listeners", async () => {
        const { page } = await openEditor(context);
        const cdp = await context.newCDPSession(page);
        const count = async () => {
            const { result } = await cdp.send("Runtime.evaluate", { expression: "window" });
            const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
            return listeners.filter(l => l.type === "message").length;
        };
        await page.evaluate(() => {
            addElement("molecule");
            const el = state.slides[currentSlideIndex].elements.at(-1);
            el.content = "/media/assets/0123456789abcdef0123456789abcdef.pdb";
            renderSlidesFromState();
        });
        const first = await count();
        for (let i = 0; i < 10; i++) await page.evaluate(() => renderSlidesFromState());
        const after = await count();
        assert(after <= first + 1, `message listeners grew from ${first} to ${after} over 10 renders`);
        await page.close();
    });

    await test("Escape closes the equation dialog from its text field, and the start screen closes dialogs", async () => {
        const { page } = await openEditor(context);
        await page.evaluate(() => openEquationModal());
        await page.locator("#equation-modal textarea").focus();
        await page.keyboard.press("Escape");
        const closedByEscape = await page.evaluate(() => getComputedStyle(document.getElementById("equation-modal")).display === "none");
        assert(closedByEscape, "Escape did not close the equation dialog");
        const placeholder = await page.evaluate(() => document.querySelector("#equation-modal textarea").placeholder);
        assert(placeholder.startsWith("\\frac{-b \\pm"), `example LaTeX has wrong backslashes: ${placeholder}`);
        await page.evaluate(() => { openEquationModal(); window.closeEditorDialogs({ all: true }); });
        assert(await page.evaluate(() => getComputedStyle(document.getElementById("equation-modal")).display === "none"), "closeEditorDialogs left the equation dialog open");
        await page.close();
    });

    await test("new slides get title and content placeholders that never show when presenting or exporting", async () => {
        const { page } = await openEditor(context);
        const hints = await page.evaluate(() => {
            addSlide();
            renderSlidesFromState();
            return [...document.querySelectorAll(".presentation-slide.present [data-placeholder]")].map(n => n.dataset.placeholder);
        });
        assert(JSON.stringify(hints) === JSON.stringify(["Click to add title", "Click to add text"]), `placeholders: ${hints}`);
        const hintContent = () => getComputedStyle(document.querySelector(".presentation-slide.present [data-placeholder]"), "::before").content;
        assert((await page.evaluate(hintContent)) !== "none", "placeholder hint not shown in the editor");
        const exporting = await page.evaluate(() => { const restore = hideExportEditorUi(); const c = getComputedStyle(document.querySelector(".presentation-slide.present [data-placeholder]"), "::before").content; restore(); return c; });
        assert(exporting === "none", "placeholder hint would be exported");
        await page.evaluate(() => togglePlayMode());
        await page.waitForTimeout(700);
        const presenting = await page.evaluate(hintContent);
        await page.evaluate(() => { if (document.body.classList.contains("play-mode-active")) togglePlayMode(); });
        assert(presenting === "none", "placeholder hint shown while presenting");
        await page.close();
    });

    await test("the first inserted object takes the content placeholder; images avoid existing content and the footer", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(async () => {
            addSlide();
            addElement("table");
            const slide = state.slides[currentSlideIndex];
            const table = slide.elements.find(e => e.type === "table");
            const png = await new Promise(resolve => { const c = document.createElement("canvas"); c.width = 800; c.height = 500; c.toBlob(resolve); });
            const input = document.createElement("input");
            Object.defineProperty(input, "files", { value: [new File([png], "leaf.png", { type: "image/png" })] });
            await handleImageFileInsert({ target: input });
            await new Promise(resolve => setTimeout(resolve, 800));
            const box = e => ({ x: parseFloat(e.x), y: parseFloat(e.y), w: parseFloat(e.width), h: parseFloat(e.height) });
            const t = box(table), i = box(slide.elements.find(e => e.type === "image"));
            const footerTop = Math.min(...slide.elements.filter(e => e.editableMasterFooterElement).map(e => parseFloat(e.y)));
            const ow = Math.min(t.x + t.w, i.x + i.w) - Math.max(t.x, i.x), oh = Math.min(t.y + t.h, i.y + i.h) - Math.max(t.y, i.y);
            return { tableY: t.y, placeholderLeft: slide.elements.some(e => e.placeholderRole === "content"), overlap: ow > 0 && oh > 0, imageBottom: i.y + i.h, footerTop };
        });
        assert(outcome.tableY === 168 && !outcome.placeholderLeft, `table did not take the placeholder: ${JSON.stringify(outcome)}`);
        assert(!outcome.overlap, "image covers the table");
        assert(outcome.imageBottom <= outcome.footerTop, `image runs into the footer: ${JSON.stringify(outcome)}`);
        await page.close();
    });

    await test("a long title shrinks to fit instead of running off the slide or into the subtitle", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(async () => {
            state = buildDefaultPresentationState();
            normalizeStateIds();
            currentSlideIndex = 0;
            const title = state.slides[0].elements.find(e => e.placeholder === "Click to add title");
            title.content = "Photosynthesis and the light-dependent reactions in C4 plants, explained step by step";
            delete title.textDocument;
            renderSlidesFromState();
            await new Promise(resolve => setTimeout(resolve, 600));
            const slide = document.querySelector(".presentation-slide.present").getBoundingClientRect();
            const text = document.getElementById(title.id).querySelector(".text-element-content").getBoundingClientRect();
            const subtitle = document.querySelector(".presentation-slide.present [data-placeholder='Click to add subtitle']").getBoundingClientRect();
            return { inside: text.left >= slide.left && text.right <= slide.right + 1, clear: text.bottom <= subtitle.top + 1 };
        });
        assert(outcome.inside && outcome.clear, JSON.stringify(outcome));
        await page.close();
    });

    await test("the page number cannot be typed over", async () => {
        const { page } = await openEditor(context);
        await page.evaluate(() => { addSlide(); renderSlidesFromState(); });
        const number = page.locator(".presentation-slide.present .canvas-element", { hasText: /^\s*0?2\s*$/ }).last();
        await number.dblclick({ force: true });
        const editing = await page.evaluate(() => !!document.querySelector(".presentation-slide.present [contenteditable='true']"));
        assert(!editing, "double-clicking the page number started editing it");
        await page.close();
    });

    await test("HTML export is named after the project and references only files it contains", async () => {
        const { page } = await openEditor(context);
        await page.locator("#project-title-input").fill("Export: check/name");
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.evaluate(() => exportPresentationZip())]);
        assert(download.suggestedFilename() === "Export- check-name.zip", `zip name: ${download.suggestedFilename()}`);
        const html = await page.evaluate(() => generateViewerHtml("{}", getPresentationTheme()));
        assert(!html.includes("animation-advanced.js"), "viewer references a script the export does not include");
        await page.close();
    });

    // Text editing, found in a hands-on walkthrough (2026-09-30).
    const newContentSlide = page =>
        page.evaluate(() => {
            addSlide();
            const els = state.slides[currentSlideIndex].elements;
            return {
                title: els.find(e => e.placeholder === "Click to add title").id,
                body: els.find(e => e.placeholderRole === "content").id,
            };
        });
    const contentOf = (page, id) =>
        page.evaluate(id => state.slides[currentSlideIndex].elements.find(e => e.id === id)?.content, id);
    // A box's text whether it is plain or a list (a new slide's body starts as a bulleted list).
    const textOf = content =>
        (Array.isArray(content) ? content.map(item => item.html ?? item.text ?? "").join("\n") : String(content ?? ""))
            .replace(/&nbsp;/g, " ")
            .replace(/<[^>]+>/g, "");

    await test("Escape leaves a text box and keeps what was typed", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.title}`).dblclick();
        await page.keyboard.type("Quarterly review");
        await page.keyboard.press("Escape");
        const content = await contentOf(page, ids.title);
        assert(content === "Quarterly review", `title after Escape: ${JSON.stringify(content)}`);
        await page.close();
    });

    await test("lines typed with Enter become one bullet each", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).dblclick();
        for (const [i, line] of ["Revenue", "Costs", "Hiring"].entries()) {
            if (i) await page.keyboard.press("Enter");
            await page.keyboard.type(line);
        }
        await page.keyboard.press("Escape");
        const items = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            applyTextBulletState(el, "bulleted", "default");
            return el.content.map(item => item.html);
        }, ids.body);
        assert(JSON.stringify(items) === '["Revenue","Costs","Hiring"]', `bullets: ${JSON.stringify(items)}`);
        await page.close();
    });

    await test("bullets on an empty box add no 'List item' text", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        const content = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = ""; // an empty plain text box
            delete el.textDocument;
            applyTextBulletState(el, "bulleted", "default");
            return el.content;
        }, ids.body);
        assert(JSON.stringify(content) === '[{"html":"","level":0}]', `empty bullets: ${JSON.stringify(content)}`);
        await page.close();
    });

    await test("numbering keeps indent levels, on the canvas and back to bullets", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        const outcome = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = [{ html: "One", level: 0 }, { html: "Sub", level: 1 }, { html: "Two", level: 0 }];
            delete el.textDocument;
            applyTextBulletState(el, "numbered", "decimal");
            renderSlidesFromState();
            const nested = document.querySelectorAll(`#${id} ol ol li`).length;
            applyTextBulletState(el, "bulleted", "default");
            return { nested, levels: el.content.map(item => `${item.html}:${item.level}`) };
        }, ids.body);
        assert(outcome.nested === 1, `nested numbered items on the canvas: ${outcome.nested}`);
        assert(outcome.levels.join() === "One:0,Sub:1,Two:0", `levels after round trip: ${outcome.levels}`);
        await page.close();
    });

    await test("a new text box is empty, ready for typing, and clear of other content", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        await page.locator("button[title='Text Block']:visible").first().click();
        await page.waitForTimeout(300);
        await page.keyboard.type("Typed at once");
        await page.keyboard.press("Escape");
        await page.locator("button[title='Text Block']:visible").first().click();
        await page.waitForTimeout(300);
        const outcome = await page.evaluate(() => {
            const els = state.slides[currentSlideIndex].elements;
            const [first, second] = els.slice(-2);
            const box = e => ({ x: parseFloat(e.x), y: parseFloat(e.y), w: parseFloat(e.width), h: parseFloat(e.height) });
            const others = els.slice(0, -2).filter(e => !e.editableMasterFooterElement).map(box);
            const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            return {
                first: first.content,
                second: second.content,
                editing: document.activeElement?.closest(".canvas-element")?.id === second.id,
                overlaps: [box(first), box(second)].some((b, i, all) => others.some(o => hits(b, o)) || (i && hits(b, all[0]))),
            };
        });
        assert(outcome.first === "Typed at once", `typing after insert: ${JSON.stringify(outcome.first)}`);
        assert(outcome.second === "" && outcome.editing, `new box: ${JSON.stringify(outcome)}`);
        assert(!outcome.overlaps, "a new text box was placed over existing content");
        await page.close();
    });

    await test("Ctrl+A selects the slide's content but not its footer", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        await page.mouse.click(5, 500);
        await page.keyboard.press("Control+a");
        const footerSelected = await page.evaluate(() =>
            state.selectedIds.some(id => state.slides[currentSlideIndex].elements.find(e => e.id === id)?.editableMasterFooterElement),
        );
        assert(!footerSelected, "Ctrl+A selected the footer");
        await page.close();
    });

    await test("the PowerPoint export sends the editor's own layout elements (no second footer)", async () => {
        const { page } = await openEditor(context);
        let payload = null;
        await page.route("**/api/presentations/export/pptx/", route => {
            payload = JSON.parse(route.request().postData() || "{}");
            route.fulfill({ status: 500, body: "{}" });
        });
        await page.evaluate(() => exportPPTX());
        await page.waitForTimeout(300);
        assert(payload?.state?.masterElementsIncluded === true, "export did not say its layout elements are included");
        const footers = payload.state.slides[0].elements.filter(e => e.editableMasterFooterElement || (e.isMasterElement && ["logo", "footer", "slide-number"].includes(e.masterRole)));
        const roles = footers.map(e => e.footerRole || e.masterRole);
        assert(new Set(roles).size === roles.length, `duplicate footer elements: ${roles}`);
        await page.close();
    });

    const showPanelTab = async (page, name) => {
        if (await page.locator("#properties-panel").evaluate(n => n.classList.contains("hidden"))) {
            await page.locator("#toggle-properties-panel").click();
        }
        await page.locator("#properties-panel button", { hasText: new RegExp(`^\\s*${name}\\s*$`) }).first().click();
        await page.waitForTimeout(150);
    };

    await test("a font size typed with words selected applies to those words only", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).dblclick();
        await page.keyboard.type("Revenue grew");
        await page.keyboard.press("Home");
        for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
        await page.locator("#floating-text-size").click();
        await page.keyboard.press("Control+a");
        await page.keyboard.type("40");
        await page.keyboard.press("Enter");
        const outcome = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            return { content: el.content, size: el.styles.fontSize };
        }, ids.body);
        assert(/font-size:\s*40px[^>]*>Revenue</.test(JSON.stringify(outcome.content)) && outcome.size === "24px", JSON.stringify(outcome));
        await page.close();
    });

    await test("the floating toolbar turns bullets and numbering on and off, keeping formatting", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = '<b>Revenue</b> grew<br>Costs flat';
            delete el.textDocument;
            renderSlidesFromState();
        }, ids.body);
        await page.locator(`#${ids.body}`).dblclick();
        const contentOfBody = () => contentOf(page, ids.body);
        await page.locator("#floating-text-bullets").click();
        const bullets = await contentOfBody();
        await page.locator("#floating-text-numbers").click();
        const numbered = await contentOfBody();
        await page.locator("#floating-text-numbers").click();
        const plain = await contentOfBody();
        assert(JSON.stringify(bullets) === '[{"html":"<b>Revenue</b> grew","level":0},{"html":"Costs flat","level":0}]', `bullets: ${JSON.stringify(bullets)}`);
        assert(/^<ol/.test(numbered), `numbered: ${numbered}`);
        assert(plain === "<b>Revenue</b> grew<br>Costs flat", `numbering off: ${plain}`);
        await page.close();
    });

    await test("the floating toolbar does not cover the title while the body text is edited", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).dblclick();
        await page.keyboard.type("Body text");
        const [toolbar, title] = [await page.locator("#floating-text-toolbar").boundingBox(), await page.locator(`#${ids.title}`).boundingBox()];
        const hits = toolbar.x < title.x + title.width && title.x < toolbar.x + toolbar.width && toolbar.y < title.y + title.height && title.y < toolbar.y + toolbar.height;
        assert(!hits, "the toolbar covers the title");
        await page.close();
    });

    await test("after a panel button, Escape still ends the edit and the text box shows normally", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).dblclick();
        await page.keyboard.type("Alpha");
        await showPanelTab(page, "Style");
        await page.locator("#prop-align-center").click();
        await page.keyboard.press("Escape");
        const outcome = await page.evaluate(id => {
            const dom = document.getElementById(id);
            return {
                editing: dom.classList.contains("editing-text") || dom.querySelector(".text-element-content").isContentEditable,
                content: state.slides[currentSlideIndex].elements.find(e => e.id === id).content,
            };
        }, ids.body);
        assert(!outcome.editing, "the text box stayed in edit mode");
        assert(textOf(outcome.content) === "Alpha", `content: ${JSON.stringify(outcome.content)}`);
        await page.close();
    });

    await test("a centred bulleted list keeps each bullet beside its text", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        const gap = await page.evaluate(async id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = [{ html: "Alpha", level: 0 }];
            el.styles.textAlign = "center";
            delete el.textDocument;
            renderSlidesFromState();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const row = document.querySelector(`#${id} .ppt-bullet-row`);
            const marker = row.querySelector(".ppt-bullet-marker").getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(row.querySelector(".ppt-bullet-text"));
            return range.getBoundingClientRect().left - marker.right;
        }, ids.body);
        assert(gap >= 0 && gap < 40, `bullet is ${Math.round(gap)}px from its text`);
        await page.close();
    });

    await test("a bullet sits beside a large first word, not above it (shown and while editing)", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        const offsetOf = selector =>
            page.evaluate(([id, selector]) => {
                const item = document.querySelector(`#${id} ${selector}`);
                const word = item.querySelector("span[style*='font-size']").getBoundingClientRect();
                const marker = item.querySelector(".ppt-bullet-marker")?.getBoundingClientRect();
                // Edit mode draws the marker with ::before; its line box is the item's first line.
                const markerBottom = marker ? marker.bottom : item.getBoundingClientRect().top + parseFloat(getComputedStyle(item, "::before").lineHeight || 0);
                return word.bottom - markerBottom;
            }, [ids.body, selector]);
        await page.evaluate(async id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = [{ html: '<span style="font-size: 48px;">Revenue</span> grew', level: 0 }];
            delete el.textDocument;
            renderSlidesFromState();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, ids.body);
        const shown = await offsetOf(".ppt-bullet-row");
        assert(shown < 16, `shown: the bullet sits ${Math.round(shown)}px above the first word's bottom`);
        await page.locator(`#${ids.body}`).dblclick();
        await page.waitForTimeout(200);
        const baseline = await page.evaluate(id => {
            const item = document.querySelector(`#${id} .ppt-bullet-edit-item`);
            return getComputedStyle(item, "::before").display;
        }, ids.body);
        assert(baseline === "inline-block", `editing: the marker is ${baseline}, not inline on the first line`);
        await page.close();
    });

    await test("a centred bulleted list stays centred while it is edited", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.evaluate(async id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = [{ html: "Alpha", level: 0 }];
            el.styles.textAlign = "center";
            delete el.textDocument;
            renderSlidesFromState();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, ids.body);
        await page.locator(`#${ids.body}`).dblclick();
        await page.waitForTimeout(200);
        const align = await page.evaluate(id => getComputedStyle(document.querySelector(`#${id} .ppt-bullet-edit-item`)).textAlign, ids.body);
        assert(align === "center", `edit list is aligned ${align}`);
        await page.close();
    });

    await test("Ctrl+Z while typing undoes the last word and stays in the text box; Ctrl+Y brings it back", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).dblclick();
        await page.waitForTimeout(150); // the editor takes focus on the next frame
        await page.keyboard.type("Costs flat");
        await page.keyboard.press("Enter");
        await page.keyboard.type("Hiring approvedd");
        await page.keyboard.press("Control+z");
        await page.waitForTimeout(200);
        const outcome = await page.evaluate(id => ({
            editing: document.getElementById(id).classList.contains("editing-text"),
            content: state.slides[currentSlideIndex].elements.find(e => e.id === id).content,
        }), ids.body);
        assert(outcome.editing, "Ctrl+Z left the text box");
        assert(textOf(outcome.content) === "Costs flat\nHiring ", `content after Ctrl+Z: ${JSON.stringify(outcome.content)}`);
        await page.keyboard.press("Control+y");
        await page.waitForTimeout(100);
        const redone = await contentOf(page, ids.body);
        assert(textOf(redone) === "Costs flat\nHiring approvedd", `content after Ctrl+Y: ${JSON.stringify(redone)}`);
        await page.close();
    });

    await test("dragging a text box moves it without starting to edit its text", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = "Drag me";
            delete el.textDocument;
            renderSlidesFromState();
        }, ids.body);
        const box = await page.locator(`#${ids.body}`).boundingBox();
        await page.mouse.move(box.x + 40, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + box.height / 2 + 60, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        const outcome = await page.evaluate(id => ({
            editing: document.getElementById(id).classList.contains("editing-text"),
            y: parseFloat(state.slides[currentSlideIndex].elements.find(e => e.id === id).y),
        }), ids.body);
        assert(outcome.y > 168, `the box did not move (y=${outcome.y})`);
        assert(!outcome.editing, "dragging left the box in text edit mode");
        await page.close();
    });

    await test("after presenting, the editor zoom fits the slide again", async () => {
        const { page } = await openEditor(context);
        await page.locator("#btn-present").click();
        await page.waitForTimeout(900);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(700);
        const zoom = await page.evaluate(() => ({ zoom: stateZoom, fit: calculateFitZoom(), mode: zoomMode }));
        assert(zoom.mode !== "fit" || Math.abs(zoom.zoom - zoom.fit) < 0.01, `zoom ${Math.round(zoom.zoom * 100)}% but fit is ${Math.round(zoom.fit * 100)}%`);
        await page.close();
    });

    await test("leaving a presentation returns the editor exactly as it was, even when Escape comes while it is starting", async () => {
        const { page, errors } = await openEditor(context);
        const snapshot = () => page.evaluate(() => {
            const slide = document.querySelector(".slides section.present").getBoundingClientRect();
            const wrapper = document.getElementById("canvas-wrapper");
            const area = wrapper.getBoundingClientRect();
            return {
                playing: document.body.classList.contains("play-mode-active"),
                fullscreen: !!document.fullscreenElement,
                busy: _playModeExiting || _playModeEntering,
                button: document.getElementById("btn-present").title,
                layoutOff: Reveal.getConfig().disableLayout,
                slide: [slide.left - area.left, slide.top - area.top, slide.width, slide.height].map(Math.round).join(","),
                scrolls: wrapper.scrollWidth > wrapper.clientWidth + 1 || wrapper.scrollHeight > wrapper.clientHeight + 1,
            };
        });
        await page.evaluate(() => { zoomMode = "fit"; handleEditorViewportResize(); });
        await page.waitForTimeout(400);
        const before = await snapshot();
        assert(!before.scrolls, "a fitted slide needs scrollbars");
        for (const delay of [800, 0, 40]) {
            await page.locator("#btn-present").click();
            if (delay) await page.waitForTimeout(delay);
            await page.keyboard.press("Escape");
            await page.waitForTimeout(1500);
            const after = await snapshot();
            assert(JSON.stringify(after) === JSON.stringify(before), `Escape after ${delay} ms left ${JSON.stringify(after)} (was ${JSON.stringify(before)})`);
        }
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    const textToolbarShown = page =>
        page.evaluate(() => {
            const toolbar = document.getElementById("floating-text-toolbar");
            return !toolbar.classList.contains("hidden") && getComputedStyle(toolbar).visibility !== "hidden";
        });

    await test("the text toolbar appears while editing, never on mere hover; toolbars step aside while dragging", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = "Body text";
            delete el.textDocument;
            renderSlidesFromState();
        }, ids.body);
        const box = await page.locator(`#${ids.body}`).boundingBox();
        await page.mouse.move(box.x + 40, box.y + box.height / 2);
        await page.waitForTimeout(500);
        assert(!(await textToolbarShown(page)), "hovering a text box showed the toolbar");
        await page.mouse.click(box.x + 40, box.y + box.height / 2);
        await page.waitForTimeout(200);
        assert(await textToolbarShown(page), "editing a text box shows no toolbar");
        await page.keyboard.press("Escape");
        // A selected shape has a toolbar too; it must not hang in place while the shape is dragged.
        await page.mouse.click(5, 500);
        await page.evaluate(() => addShape("rectangle"));
        await page.waitForTimeout(300);
        const shapeId = await page.evaluate(() => state.selectedIds[0]);
        const shape = await page.locator(`#${shapeId}`).boundingBox();
        const shapeToolbar = () =>
            page.evaluate(() => {
                const toolbar = document.getElementById("floating-shape-toolbar");
                return !toolbar.classList.contains("hidden") && getComputedStyle(toolbar).visibility !== "hidden";
            });
        assert(await shapeToolbar(), "a selected shape has no toolbar");
        await page.mouse.move(shape.x + shape.width / 2, shape.y + shape.height / 2);
        await page.mouse.down();
        await page.mouse.move(shape.x + shape.width / 2 + 60, shape.y + shape.height / 2, { steps: 6 });
        const midDrag = await shapeToolbar();
        await page.mouse.up();
        await page.waitForTimeout(200);
        assert(!midDrag, "the toolbar stayed behind while the shape was dragged");
        assert(await shapeToolbar(), "the toolbar did not come back after the drop");
        await page.close();
    });

    await test("the insert bar is centred on the canvas and never covers the slide", async () => {
        const { page } = await openEditor(context);
        const geometry = () =>
            page.evaluate(() => {
                const bar = document.querySelector("#insert-toolbar-row .toolbar-secondary-bar").getBoundingClientRect();
                const slide = document.querySelector(".presentation-slide.present").getBoundingClientRect();
                const canvas = document.getElementById("canvas-wrapper").getBoundingClientRect();
                return { gap: slide.top - bar.bottom, offCentre: Math.abs(bar.left + bar.width / 2 - (canvas.left + canvas.width / 2)) };
            });
        for (const panelState of ["as opened", "panel toggled"]) {
            if (panelState === "panel toggled") {
                await page.locator("#toggle-properties-panel").click();
                await page.waitForTimeout(600);
            }
            const g = await geometry();
            assert(g.gap >= 0, `${panelState}: the insert bar overlaps the slide by ${Math.round(-g.gap)}px`);
            assert(g.offCentre <= 2, `${panelState}: the insert bar is ${Math.round(g.offCentre)}px off the canvas centre`);
        }
        await page.close();
    });

    const dragBy = async (page, box, dx, dy, from = null) => {
        const [x, y] = from || [box.x + box.width / 2, box.y + box.height / 2];
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(200);
    };

    await test("a drawing made in Excalidraw lands on the slide as a movable picture and reopens with its scene", async () => {
        const { page, errors } = await openEditor(context);
        await newContentSlide(page);
        await page.locator("#btn-add-drawing").click();
        await page.waitForSelector(".drawing-editor .excalidraw", { timeout: 20000 });
        await page.waitForTimeout(500);
        const canvas = await page.locator(".drawing-editor__canvas").boundingBox();
        await page.keyboard.press("r"); // Excalidraw's rectangle tool, straight from the keyboard
        await dragBy(page, canvas, 200, 120, [canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.4]);
        const slidesBefore = await page.evaluate(() => state.slides.length);
        await page.keyboard.press("Control+d"); // Excalidraw's duplicate, not the app's duplicate-slide
        await page.locator('[data-drawing-action="done"]').click();
        await page.waitForFunction(() => !isDrawingEditorOpen(), null, { timeout: 10000 });
        await page.waitForTimeout(300);
        const drawing = await page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.excalidraw);
            return el && { id: el.id, type: el.type, png: el.content.startsWith("data:image/png"), shapes: el.excalidraw.elements.length, x: parseFloat(el.x) };
        });
        assert(drawing && drawing.type === "image" && drawing.png, `no drawing on the slide: ${JSON.stringify(drawing)}`);
        assert(drawing.shapes >= 1, "the drawing has no Excalidraw elements");
        assert((await page.evaluate(() => state.slides.length)) === slidesBefore, "Ctrl+D in the drawing editor duplicated the slide");
        await dragBy(page, await page.locator(`#${drawing.id}`).boundingBox(), 60, 0);
        const movedX = await page.evaluate(id => parseFloat(state.slides[currentSlideIndex].elements.find(e => e.id === id).x), drawing.id);
        assert(movedX > drawing.x + 20, `the drawing did not move (x ${drawing.x} -> ${movedX})`);
        const box = await page.locator(`#${drawing.id}`).boundingBox();
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => (window.getOpenDrawingElements?.() || []).length > 0, null, { timeout: 20000 });
        const reopened = await page.evaluate(() => window.getOpenDrawingElements().length);
        await page.locator('[data-drawing-action="cancel"]').click();
        assert(reopened === drawing.shapes, `reopened with ${reopened} elements, saved ${drawing.shapes}`);
        assert(!errors.length, `page errors: ${errors.join("; ")}`);
        await page.close();
    });

    await test("a picture's corner handle resizes it, and its toolbar buttons work without deselecting it", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        const id = await page.evaluate(() => {
            const slide = state.slides[currentSlideIndex];
            const id = generateId("el");
            slide.elements.push({
                id,
                type: "image",
                content: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fde68a"/></svg>'),
                excalidraw: { version: 1, elements: [], files: {}, appState: {}, naturalWidth: 400, naturalHeight: 300 },
                x: 300, y: 250, width: "300px", height: "225px", lockAspectRatio: true, imageAspectRatio: 4 / 3,
                styles: { zIndex: 50 },
            });
            renderSlidesFromState();
            selectElement(id);
            return id;
        });
        await page.waitForTimeout(300);
        const handle = await page.locator(`#${id} .resize-handle.br`).boundingBox();
        await dragBy(page, handle, 80, 60);
        const width = await page.evaluate(id => parseFloat(state.slides[currentSlideIndex].elements.find(e => e.id === id).width), id);
        assert(width > 330, `the corner handle did not resize the picture (width ${width})`);
        await page.locator("#floating-image-edit-drawing").click();
        await page.waitForTimeout(300);
        const opened = await page.evaluate(() => isDrawingEditorOpen());
        await page.locator('[data-drawing-action="cancel"]').click();
        assert(opened, "the drawing toolbar's Edit button did nothing (the click deselected the picture)");
        await page.close();
    });

    await test("drawings from the old whiteboard can still be moved", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        const id = await page.evaluate(() => {
            const slide = state.slides[currentSlideIndex];
            const id = generateId("el");
            slide.elements.push({
                id, type: "whiteboard", x: 300, y: 300, width: "160px", height: "100px", styles: { zIndex: 50 },
                drawingElement: { type: "draw_shape", shapeType: "rectangle", x: 0, y: 0, width: 160, height: 100, strokeColor: "#1f2937", strokeWidth: 2 },
                drawingViewBox: { x: 0, y: 0, width: 160, height: 100 },
            });
            renderSlidesFromState();
            return id;
        });
        await page.waitForTimeout(300);
        await dragBy(page, await page.locator(`#${id}`).boundingBox(), 70, 0);
        const x = await page.evaluate(id => parseFloat(state.slides[currentSlideIndex].elements.find(e => e.id === id).x), id);
        assert(x > 330, `the whiteboard drawing did not move (x=${x})`);
        await page.close();
    });

    await test("slide captures for PDF/PNG run at full size with list numbers as text, and the editor is restored", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        const outcome = await page.evaluate(async id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            el.content = [{ html: "One", level: 0 }, { html: "Two", level: 0 }];
            delete el.textDocument;
            applyTextBulletState(el, "numbered", "upper-roman");
            renderSlidesFromState();
            await new Promise(resolve => setTimeout(resolve, 200));
            stateZoom = 0.7;
            applyZoom();
            const original = window.html2canvas;
            let seen = null;
            window.html2canvas = (node, options) => {
                seen = {
                    width: Math.round(node.getBoundingClientRect().width),
                    markers: [...node.querySelectorAll(".sf-export-list-marker")].map(m => m.textContent),
                };
                return original(node, { ...options, scale: 1 });
            };
            const link = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function () {}; // keep the PNG download out of the test
            try {
                await exportPresentationPNG();
            } finally {
                window.html2canvas = original;
                HTMLAnchorElement.prototype.click = link;
            }
            document.getElementById("project-title-input").value = "Q3: review / final";
            return {
                seen,
                pageWidth: getExportPageSetup().width,
                zoomAfter: stateZoom,
                leftover: document.querySelectorAll(".sf-export-list-marker").length,
                pdfName: exportFileName("pdf"),
            };
        }, ids.body);
        assert(outcome.seen, "html2canvas was not called");
        assert(Math.abs(outcome.seen.width - outcome.pageWidth) <= 1, `captured at ${outcome.seen.width}px, page is ${outcome.pageWidth}px`);
        assert(outcome.seen.markers.join() === "I.,II.", `list numbers during capture: ${outcome.seen.markers}`);
        assert(Math.abs(outcome.zoomAfter - 0.7) < 1e-6, `editor zoom not restored (${outcome.zoomAfter})`);
        assert(outcome.leftover === 0, "list-number stand-ins were left in the editor");
        assert(outcome.pdfName === "Q3- review - final.pdf", `PDF file name: ${outcome.pdfName}`);
        await page.close();
    });

    await test("flowchart code survives a save and reopen: hyphenated labels, every shape, every link style", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(async () => {
            const { parseMermaidToGraph, graphToMermaid } = await import("./js/mermaid/mermaid-graph.js");
            const summary = graph => ({
                nodes: graph.nodes.map(n => `${n.id}:${n.label}:${n.shape}`).sort(),
                edges: graph.edges.map(e => `${e.from}>${e.to}:${e.label}:${e.arrow}:${e.lineStyle}`).sort(),
            });
            const sources = [
                "flowchart LR\n  A[Customer orders] --> B{In stock?}\n  B -->|Yes| C[Pack and ship]\n  B -->|No| D[Back-order]\n  D --> C",
                "flowchart TD\n  a[(DB)] --> b((Cloud)) --> c{{Hex}} --> d[[Queue]] --> e([Sci])\n  e --> f[/Para/] --> g[\\Doc\\] --> h>Actor]",
                'flowchart TD\n  A["Revenue (EUR) [Q3]"] -->|e-mail| B["x | y"]\n  A --- C\n  C -.-> D\n  D ==> E\n  E --o F\n  F --x G\n  G -- yes --> H',
            ];
            return sources.map(source => {
                const first = parseMermaidToGraph(source);
                const again = parseMermaidToGraph(graphToMermaid(first));
                return { same: JSON.stringify(summary(first)) === JSON.stringify(summary(again)), first: summary(first) };
            });
        });
        outcome.forEach((result, index) => assert(result.same, `source ${index + 1} changed on reopen: ${JSON.stringify(result.first)}`));
        assert(outcome[0].first.nodes.includes("D:Back-order:process"), `hyphenated label: ${outcome[0].first.nodes}`);
        assert(outcome[0].first.nodes.includes("B:In stock?:decision"), `decision shape: ${outcome[0].first.nodes}`);
        await page.close();
    });

    await test("the Mermaid editor reports a broken line and reopens with plain code", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        await page.evaluate(() => window.openMermaidDialog());
        await page.waitForSelector(".mermaid-source-textarea", { state: "attached" });
        await page.locator("#mermaid-mode-code").click();
        const code = page.locator(".mermaid-source-textarea");
        await code.fill("flowchart LR\n  A[Customer orders] --> B{In stock?}\n  B -->|No| D[Back-order]\n  D -->");
        await code.dispatchEvent("input");
        await page.waitForTimeout(900);
        const error = await page.locator("#mermaid-diagnostics").textContent();
        assert(/Line 4/.test(error), `no error for the broken line: ${error}`);
        await code.fill("flowchart LR\n  A[Customer orders] --> B{In stock?}\n  B -->|No| D[Back-order]");
        await code.dispatchEvent("input");
        await page.waitForTimeout(900);
        await page.locator("#mermaid-apply-btn").click();
        await page.waitForTimeout(800);
        const id = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.type === "mermaid").id);
        await page.evaluate(id => window.openMermaidDialog(id), id);
        await page.waitForTimeout(800);
        const reopened = await page.locator(".mermaid-source-textarea").inputValue();
        await page.evaluate(() => window.closeMermaidDialog?.());
        assert(!reopened.includes("sf:graph"), "the code box shows internal layout data");
        assert(reopened.includes("D[Back-order]") && reopened.includes("B{In stock?}"), `reopened code: ${reopened}`);
        await page.close();
    });

    await test("flowchart layout never overlaps nodes, even with a loop", async () => {
        const { page } = await openEditor(context);
        const overlaps = await page.evaluate(async () => {
            const { parseMermaidToGraph } = await import("./js/mermaid/mermaid-graph.js");
            const hits = graph => {
                const found = [];
                graph.nodes.forEach((a, i) => graph.nodes.slice(i + 1).forEach(b => {
                    if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) found.push(`${a.id}/${b.id}`);
                }));
                return found;
            };
            return [
                "flowchart LR\n  A[Customer orders] --> B{In stock?}\n  B -->|Yes| C[Pack and ship]\n  B -->|No| D[Back-order]\n  D --> C",
                "flowchart TD\n  A[Start] --> B[A fairly long step name here] & C[Another long step name] & D[Third]",
                "flowchart TD\n  A --> B --> C --> A\n  C --> D",
            ].map(source => hits(parseMermaidToGraph(source)));
        });
        overlaps.forEach((found, index) => assert(!found.length, `layout ${index + 1} overlaps: ${found}`));
        await page.close();
    });

    await test("hand-drawn diagrams keep their boxes, and diagram SVGs draw arrowheads without id references", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(async () => {
            const { parseMermaidToGraph, graphToSvg } = await import("./js/mermaid/mermaid-graph.js");
            const graph = parseMermaidToGraph("flowchart LR\n  A[One] --> B{Two}\n  B --o C[Three]");
            const svg = graphToSvg(graph, { renderMode: "sketch", primaryColor: "#fde68a" });
            const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
            return {
                references: (svg.match(/url\(#/g) || []).length,
                shapes: doc.querySelectorAll(".mermaid-graph-node-shape[fill='#fde68a']").length,
                drawn: doc.querySelectorAll(".mermaid-graph-node-shape.is-drawn:not(.mermaid-graph-sketch-pass)").length,
                // Sketch goes over each outline a second time, unfilled.
                pencil: doc.querySelectorAll(".mermaid-graph-sketch-pass[fill='none']").length,
                heads: doc.querySelectorAll(".mermaid-graph-edge polygon, .mermaid-graph-edge circle").length,
            };
        });
        assert(outcome.references === 0, `SVG still references ids (${outcome.references})`);
        assert(outcome.shapes === 3 && outcome.drawn === 3 && outcome.pencil === 3, `hand-drawn boxes: ${JSON.stringify(outcome)}`);
        assert(outcome.heads === 2, `edge ends drawn: ${outcome.heads}`);
        await page.close();
    });

    await test("list controls are on the Content tab of a text box", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).click();
        await showPanelTab(page, "Content");
        assert(await page.locator("#prop-list-bullet").isVisible(), "no list controls on the Content tab");
        await page.close();
    });

    await test("a new slide's body is a bulleted list, and Tab never throws typing out of a text box", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.body}`).dblclick();
        await page.keyboard.type("Heat");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Tab");
        await page.keyboard.type("Gulf Stream");
        await page.keyboard.press("Escape");
        const items = await contentOf(page, ids.body);
        assert(Array.isArray(items) && items.length === 2 && items[1].level === 1, `body: ${JSON.stringify(items)}`);
        // A plain text box: Tab is a tab character, and what follows is still typed into the box.
        const plain = await page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.placeholder === "Click to add title");
            return el.id;
        });
        await page.locator(`#${plain}`).dblclick();
        await page.keyboard.type("Title");
        await page.keyboard.press("Tab");
        await page.keyboard.type("more");
        await page.keyboard.press("Escape");
        const title = String(await contentOf(page, plain));
        assert(/Title\s*more/.test(title.replace(/<[^>]+>/g, "")), `title: ${title}`);
        // An untouched body list is not shown outside the editor.
        await page.evaluate(() => addSlide());
        const shown = await page.evaluate(async () => {
            const bundle = await JSZip.loadAsync(await buildViewerBundle({ includeVendor: false }));
            const html = await bundle.file("index.html").async("string");
            const data = JSON.parse(new DOMParser().parseFromString(html, "text/html").getElementById("presentation-data").textContent);
            return data.slides.at(-1).elements.filter(e => e.placeholderRole === "content").length;
        });
        assert(shown === 0, "an empty body box was exported");
        await page.close();
    });

    await test("Tab moves through table cells even when typing straight on, and Escape keeps the cell", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        await page.evaluate(() => addElement("table"));
        const id = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.type === "table").id);
        const box = await page.evaluate(id => { const r = document.querySelector(`.slides [id="${id}"] .table-element-cell`).getBoundingClientRect(); return [r.x + 15, r.y + 15]; }, id);
        await page.mouse.dblclick(box[0], box[1]);
        await page.keyboard.press("Control+a");
        await page.keyboard.type("Current");
        await page.keyboard.press("Tab");
        await page.keyboard.type("Ocean");
        await page.keyboard.press("Tab");
        await page.keyboard.type("Warm");
        await page.keyboard.press("Escape");
        const row = await page.evaluate(id => state.slides[currentSlideIndex].elements.find(e => e.id === id).tableData.cells[0].map(c => c.text), id);
        assert(row[0] === "Current" && row[1] === "Ocean" && row[2] === "Warm", `first row: ${JSON.stringify(row)}`);
        await page.close();
    });

    await test("objects inserted on a busy slide land below the title, not on it", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        const placed = await page.evaluate(() => {
            addElement("table"); // takes the body placeholder
            addChart("bar");
            addElement("shape", { shapeType: "arrow-right" });
            const els = state.slides[currentSlideIndex].elements;
            const title = els.find(e => e.placeholder === "Click to add title");
            const titleBottom = parseFloat(title.y) + parseFloat(title.height);
            return els.filter(e => ["chart", "shape"].includes(e.type) && !e.footerRole && !e.masterElement).map(e => ({ type: e.type, y: e.y, titleBottom }));
        });
        assert(placed.length >= 2 && placed.every(e => e.y >= e.titleBottom), JSON.stringify(placed));
        await page.close();
    });

    await test("on a crowded slide, new objects shrink to fit beside the content instead of covering it", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        const outcome = await page.evaluate(() => {
            addElement("table");
            addChart("bar");
            addChart("line");
            addChart("pie");
            addShape("arrow-right");
            const boxes = state.slides[currentSlideIndex].elements
                .filter(e => !e.footerRole && !e.editableMasterFooterElement && !e.isMasterElement)
                .map(e => ({ type: e.type, x: parseFloat(e.x), y: parseFloat(e.y), w: parseFloat(e.width), h: parseFloat(e.height) }));
            const overlapping = [];
            boxes.forEach((a, i) =>
                boxes.slice(i + 1).forEach(b => {
                    if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0) {
                        overlapping.push(`${a.type}/${b.type}`);
                    }
                }),
            );
            return { overlapping, smallest: Math.min(...boxes.filter(b => b.type === "chart").map(b => b.w)) };
        });
        assert(!outcome.overlapping.length, `overlapping: ${outcome.overlapping}`);
        assert(outcome.smallest >= 200, `a chart was shrunk too far: ${outcome.smallest}px`);
        await page.close();
    });

    await test("objects have a Motion tab to add animations, and the Transitions button shows the transition", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.title}`).dblclick();
        await page.keyboard.type("Animated");
        await page.keyboard.press("Escape");
        await showPanelTab(page, "Motion");
        assert(await page.locator("#properties-panel button", { hasText: "Add animation" }).isVisible(), "no way to add an animation");
        const clipped = await page.evaluate(() => {
            const bar = document.querySelector(".properties-tabbar").getBoundingClientRect();
            return [...document.querySelectorAll(".properties-tab")].filter(t => t.getBoundingClientRect().right > bar.right + 1).map(t => t.innerText.trim());
        });
        assert(!clipped.length, `tabs cut off: ${clipped}`);
        await page.locator("#toggle-transitions-modal").click();
        await page.waitForTimeout(300);
        assert(await page.locator("#prop-slide-transition").isVisible(), "the transition control is not shown");
        await page.close();
    });

    await test("a loop back in a flowchart goes around the boxes instead of through them", async () => {
        const { page } = await openEditor(context);
        const crossings = await page.evaluate(async () => {
            const graph = await import("/js/mermaid/mermaid-graph.js");
            const model = graph.layoutGraphModel(graph.parseMermaidToGraph("flowchart LR\n A[One] --> B[Two]\n B --> C[Three]\n C --> D[Four]\n D --> A\n"));
            const svg = new DOMParser().parseFromString(graph.graphToSvg(model), "image/svg+xml");
            const lowestPoint = d => Math.max(...(d.match(/-?\d+(\.\d+)?/g) || []).filter((_, i) => i % 2 === 1).map(Number));
            const paths = [...svg.querySelectorAll("path")].map(p => p.getAttribute("d") || "").filter(d => /^M/.test(d));
            const boxesBottom = Math.max(...model.nodes.map(n => n.y + n.height));
            return { paths: paths.length, lowest: Math.max(...paths.map(lowestPoint)), boxesBottom };
        });
        assert(crossings.lowest > crossings.boxesBottom, `the D --> A link runs through the row: ${JSON.stringify(crossings)}`);
        await page.close();
    });

    // Mermaid dialog helpers: a node's centre in the preview, and the preview's diagram state as plain data.
    const mermaidNodeCenter = (page, label) => page.evaluate(label => {
        const node = [...document.querySelectorAll("#mermaid-preview .mermaid-graph-node")].find(n => n.textContent.trim() === label);
        const r = node?.querySelector("rect,path,polygon")?.getBoundingClientRect();
        return r ? [r.x + r.width / 2, r.y + r.height / 2] : null;
    }, label);
    const mermaidPreviewInfo = page => page.evaluate(() => ({
        labels: [...document.querySelectorAll("#mermaid-preview .mermaid-graph-node")].map(n => n.textContent.trim()),
        code: document.querySelector("#mermaid-editor-host textarea")?.value || "",
        svg: document.querySelector("#mermaid-preview svg")?.outerHTML || "",
    }));

    await test("mermaid: dialog buttons act once however often it was opened; drags, double-clicks, handle drops and curved routing work", async () => {
        const { page, errors } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); openMermaidDialog(); });
        await page.waitForTimeout(700);
        await page.locator("#mermaid-apply-btn").click();
        await page.waitForTimeout(700);
        const id = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.type === "mermaid").id);
        // Opened four times in all: one click on Child must add one node (it added four).
        for (let i = 0; i < 3; i++) {
            await page.evaluate(id => openMermaidDialog(id), id);
            await page.waitForTimeout(500);
        }
        let at = await mermaidNodeCenter(page, "Process");
        await page.mouse.click(at[0], at[1]);
        await page.waitForTimeout(300);
        const before = (await mermaidPreviewInfo(page)).labels.length;
        await page.locator("#mermaid-add-child").click();
        await page.waitForTimeout(400);
        const afterChild = (await mermaidPreviewInfo(page)).labels.length;
        assert(afterChild === before + 1, `one click on Child added ${afterChild - before} nodes`);

        // A dragged node stays where it is dropped (it jumped back).
        at = await mermaidNodeCenter(page, "End");
        await page.mouse.move(at[0], at[1]);
        await page.mouse.down();
        await page.mouse.move(at[0] + 140, at[1] + 70, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const moved = await mermaidNodeCenter(page, "End");
        assert(Math.abs(moved[0] - at[0]) > 60 && Math.abs(moved[1] - at[1]) > 30, `dragged node: ${at} -> ${moved}`);

        // Double-clicking empty canvas adds a node (nothing happened).
        const blank = await page.evaluate(() => { const r = document.getElementById("mermaid-preview").getBoundingClientRect(); return [r.x + 40, r.y + r.height - 40]; });
        const countBefore = (await mermaidPreviewInfo(page)).labels.length;
        await page.mouse.dblclick(blank[0], blank[1]);
        await page.waitForTimeout(400);
        assert((await mermaidPreviewInfo(page)).labels.length === countBefore + 1, "double-clicking the canvas added no node");
        // Escape ends the rename of the new node, not the whole dialog.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        assert(await page.locator("#mermaid-dialog .mermaid-dialog-panel").isVisible(), "Escape in the rename box closed the dialog");

        // Dropping a connect handle on another node links the two (it made a new node).
        const handle = await page.evaluate(() => {
            const node = [...document.querySelectorAll("#mermaid-preview .mermaid-graph-node")].find(n => n.textContent.trim() === "Start");
            const r = document.querySelector(`#mermaid-preview .mermaid-graph-connect-handle[data-node-id="${node.dataset.nodeId}"]`).getBoundingClientRect();
            return [r.x + r.width / 2, r.y + r.height / 2];
        });
        const target = await mermaidNodeCenter(page, "End");
        const countLinked = (await mermaidPreviewInfo(page)).labels.length;
        await page.mouse.move(handle[0], handle[1]);
        await page.mouse.down();
        await page.mouse.move(target[0], target[1], { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        const linked = await mermaidPreviewInfo(page);
        assert(linked.labels.length === countLinked, `a handle dropped on a node made a new node: ${linked.labels}`);
        assert(/A\[Start\] --> D\[End\]|A --> D\b/.test(linked.code), `no Start --> End link: ${linked.code}`);

        // Curved routing draws curves (the edges stayed square).
        await page.locator("#mermaid-routing-style").selectOption("curved");
        await page.waitForTimeout(400);
        assert(/ C [\d.-]/.test((await mermaidPreviewInfo(page)).svg), "curved routing drew no curves");
        await page.evaluate(() => closeMermaidDialog());
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    await test("mermaid: themes recolour flowcharts, Draw and Sketch differ, and the controls follow the diagram type", async () => {
        const { page, errors } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); openMermaidDialog(); });
        await page.waitForTimeout(700);
        // Diagram Style is there in the default Visual mode (it was only shown in Split mode).
        assert(await page.locator("#mermaid-font-family").isVisible(), "the Diagram Style section is hidden in Visual mode");
        const svg = async () => (await mermaidPreviewInfo(page)).svg;
        const plain = await svg();
        await page.locator("#mermaid-theme-select").selectOption("dark");
        await page.waitForTimeout(400);
        const dark = await svg();
        assert(dark !== plain && /fill="#1f2937"/i.test(dark), "the dark theme did not recolour the flowchart");
        await page.locator("#mermaid-theme-select").selectOption("default");
        await page.locator("#mermaid-render-mode").selectOption("draw");
        await page.waitForTimeout(400);
        const drawn = await svg();
        await page.locator("#mermaid-render-mode").selectOption("sketch");
        await page.waitForTimeout(400);
        const sketched = await svg();
        assert(drawn !== plain && sketched !== drawn && /mermaid-graph-sketch-pass/.test(sketched), "Draw and Sketch look the same");
        // A Gantt chart: no flowchart tools and no hand-drawn look; a state diagram: one hand-drawn look.
        await page.locator("#mermaid-template-select").selectOption("gantt");
        await page.waitForTimeout(1500);
        const gantt = await page.evaluate(() => ({
            child: !!document.getElementById("mermaid-add-child").offsetParent,
            layout: !!document.getElementById("mermaid-layout-mode").offsetParent,
            render: document.getElementById("mermaid-render-mode").disabled,
        }));
        assert(!gantt.child && !gantt.layout && gantt.render, `Gantt dialog controls: ${JSON.stringify(gantt)}`);
        await page.locator("#mermaid-template-select").selectOption("state");
        await page.waitForTimeout(1200);
        const modes = await page.evaluate(() => [...document.getElementById("mermaid-render-mode").options].filter(o => !o.hidden).map(o => o.textContent));
        assert(JSON.stringify(modes) === '["Real","Hand-drawn"]', `state diagram looks: ${modes}`);
        const classic = await svg();
        await page.locator("#mermaid-render-mode").selectOption("sketch");
        await page.waitForTimeout(1500);
        const rough = await svg();
        assert(rough.replace(/id="[^"]*"/g, "").length !== classic.replace(/id="[^"]*"/g, "").length, "the state diagram did not change to its hand-drawn look");
        const layoutModes = await page.evaluate(() => [...document.querySelectorAll("#mermaid-layout-mode option")].map(o => o.value));
        assert(!layoutModes.includes("auto"), `"Auto" layout (same as Assisted) is still offered: ${layoutModes}`);
        await page.evaluate(() => closeMermaidDialog());
        const placeholders = await page.evaluate(() => COMMANDS.filter(c => ["graph-create-group", "graph-generate-legend"].includes(c.id)).length);
        assert(placeholders === 0, "the placeholder Graph commands are still in the command palette");
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    await test("mermaid: a loop keeps its first step first, and diagrams Mermaid draws get a box of their shape and readable text", async () => {
        const { page } = await openFreshEditor(context);
        const order = await page.evaluate(async () => {
            const graph = await import("./js/mermaid/mermaid-graph.js");
            const model = graph.parseMermaidToGraph("flowchart LR\n  A[Commit] --> B[Build]\n  B --> C[Test]\n  C --> D{Pass?}\n  D -->|No| F[Fix]\n  F --> A");
            return model.nodes.slice().sort((a, b) => a.x - b.x).map(n => n.label);
        });
        assert(order[0] === "Commit", `left-to-right order: ${order}`);
        await page.evaluate(() => { addSlide(); openMermaidDialog(); });
        await page.waitForTimeout(600);
        await page.locator("#mermaid-template-select").selectOption("gantt");
        await page.waitForTimeout(1500);
        await page.locator("#mermaid-apply-btn").click();
        await page.waitForTimeout(800);
        const gantt = await page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.type === "mermaid");
            const sizes = (el.svgContent.match(/font-size:\s*(\d+)/g) || []).map(m => Number(m.replace(/\D/g, "")));
            return { width: parseFloat(el.width), height: parseFloat(el.height), text: Math.max(...sizes, 0) };
        });
        assert(gantt.width / gantt.height > 3, `a Gantt chart in a ${gantt.width}x${gantt.height} box`);
        assert(gantt.text >= 16, `Gantt text ${gantt.text}px (the diagram's font size is 16)`);
        await page.close();
    });

    await test("mermaid: Branch Reveal shows a flowchart step by step in the show, and switches off again", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); openMermaidDialog(); });
        await page.waitForTimeout(700);
        await page.locator("#mermaid-branch-reveal").click();
        await page.waitForTimeout(300);
        assert((await page.locator("#mermaid-branch-reveal").getAttribute("aria-pressed")) === "true", "Branch Reveal does not show as on");
        await page.locator("#mermaid-apply-btn").click();
        await page.waitForTimeout(800);
        const id = await page.evaluate(() => { state.selectedIds = []; renderSlidesFromState(); return state.slides[currentSlideIndex].elements.find(e => e.type === "mermaid").id; });
        const shown = () => page.evaluate(id => {
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            return [...node.querySelectorAll(".mermaid-graph-node")].filter(n => parseFloat(getComputedStyle(n).opacity) > 0.5).map(n => n.textContent.trim()).join(",");
        }, id);
        await page.locator("#btn-present").click();
        await page.waitForTimeout(1500);
        const seq = [await shown()];
        for (let k = 0; k < 4; k++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(700); seq.push(await shown()); }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
        assert(JSON.stringify(seq) === JSON.stringify(["", "Start", "Start,Decision", "Start,Decision,Process", "Start,Decision,Process,End"]), `steps shown per click: ${JSON.stringify(seq)}`);
        // Switched off, the diagram is there at once.
        await page.evaluate(id => openMermaidDialog(id), id);
        await page.waitForTimeout(600);
        await page.locator("#mermaid-branch-reveal").click();
        await page.locator("#mermaid-apply-btn").click();
        await page.waitForTimeout(800);
        await page.locator("#btn-present").click();
        await page.waitForTimeout(1500);
        const whole = await shown();
        await page.keyboard.press("Escape");
        assert(whole === "Start,Decision,Process,End", `with Branch Reveal off the show starts with: ${whole}`);
        await page.close();
    });

    await test("mermaid: the PowerPoint export sends diagrams as pictures with Mermaid's colours", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); openMermaidDialog(); });
        await page.waitForTimeout(600);
        await page.locator("#mermaid-template-select").selectOption("mindmap");
        await page.waitForTimeout(1500);
        await page.locator("#mermaid-apply-btn").click();
        await page.waitForTimeout(800);
        // The request PowerPoint is made from: the mind map must be a picture whose nodes keep their colours (the
        // server drew Mermaid's SVG without its CSS: black boxes, missing labels).
        const sent = await page.evaluate(async () => {
            let body = null;
            const realFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (String(url).includes("/export/pptx/")) { body = JSON.parse(options.body); return new Response(new Blob(["x"]), { status: 200 }); }
                return realFetch(url, options);
            };
            try { await exportPPTX(); } finally { window.fetch = realFetch; }
            const el = body.state.slides.flatMap(s => s.elements).find(e => e.exportedFrom === "mermaid" || e.type === "mermaid");
            if (el?.type !== "image") return { type: el?.type };
            const img = new Image();
            img.src = el.content;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, img.width, img.height).data;
            let coloured = 0;
            let black = 0;
            for (let i = 0; i < data.length; i += 4 * 7) {
                if (data[i + 3] < 200) continue;
                const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
                if (Math.max(r, g, b) - Math.min(r, g, b) > 60) coloured++;
                else if (r + g + b < 60) black++;
            }
            return { type: el.type, png: el.content.startsWith("data:image/png"), coloured, black };
        });
        assert(sent.type === "image" && sent.png, `the diagram was sent as ${JSON.stringify(sent)}`);
        assert(sent.coloured > sent.black * 3, `mind map picture colours: ${JSON.stringify(sent)}`);
        await page.close();
    });

    await test("packaging: SVG pictures go to PowerPoint as PNGs drawn by the browser (no Cairo needed)", async () => {
        const { page } = await openFreshEditor(context);
        const sent = await page.evaluate(async () => {
            addSlide();
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#e11d48"/></svg>';
            state.slides[currentSlideIndex].elements.push({ id: generateId("el"), type: "image", content: `data:image/svg+xml;base64,${btoa(svg)}`, x: 100, y: 100, width: "200px", height: "100px", styles: { zIndex: 5 } });
            renderSlidesFromState();
            let body = null;
            const realFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (String(url).includes("/export/pptx/")) { body = JSON.parse(options.body); return new Response(new Blob(["x"]), { status: 200 }); }
                return realFetch(url, options);
            };
            try { await exportPPTX(); } finally { window.fetch = realFetch; }
            const el = body.state.slides.flatMap(s => s.elements).find(e => e.type === "image" && e.width === "200px");
            const img = new Image();
            img.src = el.content;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext("2d").drawImage(img, 0, 0);
            const [r, g, b, a] = canvas.getContext("2d").getImageData(img.width / 2, img.height / 2, 1, 1).data;
            return { png: el.content.startsWith("data:image/png"), size: [img.width, img.height], pixel: [r, g, b, a] };
        });
        // The server needed CairoSVG and the Cairo library for this, usually missing on Windows and macOS.
        assert(sent.png, `the SVG picture was sent as ${JSON.stringify(sent)}`);
        assert(sent.size[0] === 400 && sent.size[1] === 200 && sent.pixel[0] > 200 && sent.pixel[1] < 60, `PNG of the picture: ${JSON.stringify(sent)}`);
        await page.close();
    });

    await test("shared and exported viewers show charts, diagrams and equations as pictures", async () => {
        const { page, errors } = await openEditor(context);
        await newContentSlide(page);
        const outcome = await page.evaluate(async () => {
            addChart("bar");
            const slide = state.slides[currentSlideIndex];
            slide.elements.push(
                { id: "el_mm", type: "mermaid", x: 40, y: 400, width: "300px", height: "120px", styles: {},
                  svgContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>' },
                { id: "el_eq", type: "equation", x: 400, y: 400, width: "300px", height: "auto", latexSrc: "\\frac{a}{b}", content: "", styles: { color: "#000000", fontSize: "28px" } },
            );
            const bundle = await JSZip.loadAsync(await buildViewerBundle({ includeVendor: false }));
            const html = await bundle.file("index.html").async("string");
            const data = JSON.parse(new DOMParser().parseFromString(html, "text/html").getElementById("presentation-data").textContent);
            const els = data.slides[currentSlideIndex].elements;
            return {
                types: els.filter(e => e.exportedFrom).map(e => `${e.exportedFrom}>${e.type}`).sort(),
                files: Object.keys(bundle.files).filter(name => name.startsWith("assets/")),
            };
        });
        assert(JSON.stringify(outcome.types) === JSON.stringify(["chart>image", "equation>image", "mermaid>image"]), JSON.stringify(outcome));
        assert(outcome.files.some(name => name.endsWith(".svg")) && !outcome.files.some(name => name.includes("+")), `asset names: ${outcome.files}`);
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    await test("a new drawing on a dark theme starts with light ink on the slide's colour", async () => {
        const { page } = await openEditor(context);
        const colors = await page.evaluate(() => {
            state.presentationTheme = "horizon";
            return _newDrawingColors();
        });
        assert(colors.currentItemStrokeColor === "#eef4ff" && colors.viewBackgroundColor.toLowerCase() !== "#ffffff", JSON.stringify(colors));
        await page.close();
    });

    await test("Ctrl+D duplicates the selected object, or the slide when nothing is selected", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.locator(`#${ids.title}`).dblclick();
        await page.keyboard.type("Copy me");
        await page.keyboard.press("Escape");
        const count = () => page.evaluate(() => [state.slides.length, state.slides[currentSlideIndex].elements.filter(e => /Copy me/.test(JSON.stringify(e.content))).length]);
        const before = await count();
        await page.keyboard.press("Control+d");
        await page.waitForTimeout(200);
        const withSelection = await count();
        assert(withSelection[0] === before[0] && withSelection[1] === 2, `with a box selected: ${before} -> ${withSelection}`);
        await page.keyboard.press("Escape");
        await page.mouse.click(5, 500);
        await page.keyboard.press("Control+d");
        await page.waitForTimeout(200);
        assert((await count())[0] === before[0] + 1, "Ctrl+D with nothing selected did not duplicate the slide");
        await page.close();
    });

    await test("Shift+click adds a text box to the selection without starting to edit it", async () => {
        const { page } = await openEditor(context);
        const ids = await newContentSlide(page);
        await page.evaluate(ids => {
            const els = state.slides[currentSlideIndex].elements;
            els.find(e => e.id === ids.title).content = "Title";
            els.find(e => e.id === ids.body).content = [{ html: "Body", level: 0 }];
            renderSlidesFromState();
        }, ids);
        await page.locator(`#${ids.body}`).click();
        await page.keyboard.press("Escape");
        await page.keyboard.down("Shift");
        await page.locator(`#${ids.title}`).click();
        await page.keyboard.up("Shift");
        const outcome = await page.evaluate(() => ({ selected: state.selectedIds.length, editing: !!document.querySelector(".slides .editing-text") }));
        assert(outcome.selected === 2 && !outcome.editing, JSON.stringify(outcome));
        await page.close();
    });

    await test("the footer brand keeps its capitals through saving, and gets them back in decks that lost them", async () => {
        const { page } = await openEditor(context);
        const outcome = await page.evaluate(() => {
            addSlide();
            const logo = () => state.slides[currentSlideIndex].elements.find(e => e.footerRole === "logo");
            const kept = getPersistableState().slides[currentSlideIndex].elements.find(e => e.footerRole === "logo")?.styles?.textTransform;
            delete logo().styles.textTransform; // a deck saved before the fix
            renderSlidesFromState();
            return { kept, healed: logo()?.styles?.textTransform };
        });
        assert(outcome.kept === "uppercase" && outcome.healed === "uppercase", JSON.stringify(outcome));
        await page.close();
    });

    await test("a chart's data can be edited: double-click, type down the rows with Tab, undo with Ctrl+Z", async () => {
        const { page, errors } = await openEditor(context);
        await newContentSlide(page);
        await page.evaluate(() => addChart("pie"));
        const chart = () => page.evaluate(() => {
            const e = state.slides[currentSlideIndex].elements.find(x => x.type === "chart");
            return { type: e.chartType, labels: e.chartData.labels.slice(0, 2), data: e.chartData.datasets[0].data.slice(0, 2), colours: new Set([].concat(e.chartData.datasets[0].backgroundColor)).size };
        });
        assert((await chart()).colours >= 5, `pie slices share colours: ${JSON.stringify(await chart())}`);
        const id = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.type === "chart").id);
        const box = await page.locator(`.slides [id="${id}"]`).boundingBox();
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(400);
        for (const [label, value] of [["Light", "50"], ["Deep", "20"]]) {
            await page.keyboard.press("Control+a");
            await page.keyboard.type(label);
            await page.keyboard.press("Tab");
            await page.keyboard.type(value);
            await page.keyboard.press("Tab");
        }
        const typed = await chart();
        assert(typed.labels.join() === "Light,Deep" && typed.data.join() === "50,20", `after typing: ${JSON.stringify(typed)}`);
        assert(await page.evaluate(id => !!document.querySelector(`.slides [id="${id}"] .resize-handle`), id), "redrawing the chart removed its handles");
        await page.keyboard.press("Control+z");
        await page.waitForTimeout(200);
        const undone = await chart();
        assert(undone.data.join() !== "50,20", `Ctrl+Z in the editor did not undo the chart: ${JSON.stringify(undone)}`);
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    await test("a table grows with added rows and columns instead of cutting them off", async () => {
        const { page } = await openEditor(context);
        await newContentSlide(page);
        const outcome = await page.evaluate(() => {
            addElement("table");
            const table = () => state.slides[currentSlideIndex].elements.find(e => e.type === "table");
            selectElement(table().id, "replace");
            const grow = mutator => mutateSelectedTableData(mutator, { fitElement: true });
            for (let i = 0; i < 6; i++) grow(t => { t.cols += 1; t.colWidths.push(140); t.cells.forEach(row => row.push({ text: "", styles: {} })); });
            const page = getPresentationPageSetupConfig();
            const sum = values => values.reduce((a, b) => a + b, 0);
            return { cols: table().tableData.cols, width: parseFloat(table().width), grid: sum(table().tableData.colWidths), right: table().x + parseFloat(table().width), pageWidth: page.width };
        });
        assert(outcome.cols === 10 && outcome.width === outcome.grid, `box does not follow the grid: ${JSON.stringify(outcome)}`);
        assert(outcome.right <= outcome.pageWidth, `the table runs off the slide: ${JSON.stringify(outcome)}`);
        await page.close();
    });

    await test("opening Presenter View does not end the presentation, and it gets the slide's colours", async () => {
        const { page } = await openEditor(context);
        const popupPromise = context.waitForEvent("page", { timeout: 8000 });
        await page.locator("#btn-present").click();
        await page.waitForTimeout(900);
        await page.evaluate(() => {
            openPresenterView();
            document.dispatchEvent(new Event("fullscreenchange")); // what the browser does when a window opens
        });
        const popup = await popupPromise;
        await popup.waitForTimeout(1200);
        const outcome = {
            presenting: await page.evaluate(() => document.body.classList.contains("play-mode-active")),
            background: await popup.evaluate(() => {
                const section = document.querySelector("#presenter-current > section");
                return section ? { bg: getComputedStyle(section).backgroundImage + getComputedStyle(section).backgroundColor, fits: section.getBoundingClientRect().width <= document.getElementById("presenter-current").clientWidth + 1 } : null;
            }),
        };
        assert(outcome.presenting, "opening Presenter View ended the presentation");
        assert(outcome.background && !/^nonergba\(0, 0, 0, 0\)$/.test(outcome.background.bg) && outcome.background.fits, JSON.stringify(outcome));
        await popup.close();
        await page.keyboard.press("Escape");
        await page.close();
    });

    await test("3D background: readable on/off toggle, saturation 0 is grey, light slides use normal blending", async () => {
        const { page } = await openEditor(context);
        await page.mouse.click(5, 500);
        await showPanelTab(page, "Style");
        const bg = () => page.evaluate(() => state.slides[currentSlideIndex].background || null);
        await page.locator("#prop-slide-bg-three").click();
        await page.waitForTimeout(600);
        assert((await bg())?.type === "three", "the 3D background did not turn on");
        const button = await page.locator("#prop-slide-bg-three").evaluate(node => {
            const style = getComputedStyle(node);
            const rgb = value => value.match(/\d+/g).slice(0, 3).map(Number);
            const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            return { label: node.innerText.trim(), contrast: Math.abs(lum(rgb(style.backgroundColor)) - lum(rgb(style.color))) };
        });
        assert(/on/i.test(button.label) && button.contrast > 0.4, `the active toggle is unreadable: ${JSON.stringify(button)}`);
        await page.locator("#prop-slide-bg-saturate").evaluate(node => { node.value = 0; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); });
        await page.waitForTimeout(400);
        const filter = await page.evaluate(() => getComputedStyle(document.querySelector(".reveal .slides section.present .slide-background-media")).filter);
        assert((await bg()).saturate === 0 && /saturate\(0\)/.test(filter), `saturation 0 ignored: ${JSON.stringify(await bg())} ${filter}`);
        const source = await page.evaluate(() => _tryRenderThreeThemeMotion.toString());
        assert(/NormalBlending/.test(source) && /lightSlide/.test(source), "light slides still use additive blending only");
        await page.locator("#prop-slide-bg-three").click();
        await page.waitForTimeout(400);
        assert((await bg()) === null, "clicking the active toggle did not turn the background off");
        await page.close();
    });

    await test("molecules: an XYZ small molecule is drawn, an unreadable file says so, and exports get a picture", async () => {
        const { page, errors } = await openEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-mol-"));
        const water = path.join(dir, "water.xyz");
        const broken = path.join(dir, "broken.pdb");
        fs.writeFileSync(water, "3\nwater\nO 0.000 0.000 0.117\nH 0.000 0.757 -0.469\nH 0.000 -0.757 -0.469\n");
        fs.writeFileSync(broken, "not a molecule\n");
        const insert = async file => {
            await page.evaluate(() => addSlide());
            const chooser = page.waitForEvent("filechooser");
            await page.locator("button[title='PDB or Trajectory']:visible").first().click();
            await (await chooser).setFiles(file);
            await page.waitForFunction(() => state.slides[currentSlideIndex].elements.some(e => e.type === "molecule"));
            return page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.type === "molecule").id);
        };
        const waterId = await insert(water);
        const snapshot = await page.evaluate(async id => {
            const frame = document.querySelector(`.slides [id="${id}"] .molecule-embed-frame`);
            const dataUrl = await requestMoleculeSnapshot(frame, 15000);
            const exportState = { slides: [{ elements: [JSON.parse(JSON.stringify(state.slides[currentSlideIndex].elements.find(e => e.id === id)))] }] };
            await replaceMoleculesWithPictures(exportState);
            return { length: dataUrl ? dataUrl.length : 0, exported: exportState.slides[0].elements[0].type };
        }, waterId);
        assert(snapshot.length > 2000, "the XYZ molecule was not drawn (no picture of it)");
        assert(snapshot.exported === "image", `export kept a ${snapshot.exported} placeholder`);
        const brokenId = await insert(broken);
        await page.waitForTimeout(2500);
        const frame = page.frames().find(f => f !== page.mainFrame() && f.parentFrame() === page.mainFrame() && f.url().startsWith("about:srcdoc") === true) || null;
        const messages = await Promise.all(page.frames().filter(f => f !== page.mainFrame()).map(f => f.evaluate(() => document.querySelector(".top.is-error")?.innerText || "").catch(() => "")));
        assert(messages.some(text => /could not show/i.test(text)), `no visible message for an unreadable file: ${JSON.stringify(messages)} ${brokenId} ${!!frame}`);
        const hiddenCancel = await page.evaluate(() => {
            selectElement(state.slides[currentSlideIndex].elements.find(e => e.type === "molecule").id, "replace");
            return true;
        });
        await showPanelTab(page, "Content");
        assert(hiddenCancel && !(await page.locator("#prop-molecule-cancel-layer-edit").isVisible()), "the hidden Cancel button is showing");
        assert(!errors.length, errors.join("; "));
        fs.rmSync(dir, { recursive: true, force: true });
        await page.close();
    });

    // Two short helices (chains A and B) and a 20-frame DCD trajectory of them, written here so the tests need no
    // data files.
    const writeTestProtein = dir => {
        const fs = require("fs");
        const path = require("path");
        const lines = [];
        const coords = [];
        let serial = 1;
        for (const [chain, x0, z0, dir] of [["A", 0, 0, 1], ["B", 10, 25, -1]]) {
            for (let i = 0; i < 12; i++) {
                const t = (100 * i * Math.PI) / 180;
                for (const [name, r, dphi, dz, el] of [["N", 1.55, -28, -0.9, "N"], ["CA", 2.3, 0, 0, "C"], ["C", 1.6, 28, 0.9, "C"], ["O", 1.8, 40, 2, "O"]]) {
                    const p = t + (dphi * Math.PI) / 180;
                    const xyz = [x0 + r * Math.cos(p), r * Math.sin(p), z0 + dir * (1.5 * i + dz * 0.5)];
                    coords.push(xyz);
                    lines.push(`ATOM  ${String(serial++).padStart(5)} ${name.padEnd(4)} ALA ${chain}${String(i + 1).padStart(4)}    ${xyz.map(v => v.toFixed(3).padStart(8)).join("")}  1.00 20.00           ${el}`);
                }
            }
        }
        const pdb = path.join(dir, "helices.pdb");
        fs.writeFileSync(pdb, lines.join("\n") + "\nEND\n");
        const dcd = (file, atoms, frames) => {
            const record = body => Buffer.concat([Buffer.from(new Int32Array([body.length]).buffer), body, Buffer.from(new Int32Array([body.length]).buffer)]);
            const header = Buffer.alloc(84);
            header.write("CORD", 0);
            header.writeInt32LE(frames, 4);
            header.writeInt32LE(1, 12);
            header.writeInt32LE(frames, 16);
            header.writeFloatLE(0.002, 40);
            header.writeInt32LE(24, 80);
            const title = Buffer.alloc(84);
            title.writeInt32LE(1, 0);
            title.write("SlideForge test", 4);
            const parts = [record(header), record(title), record(Buffer.from(new Int32Array([atoms]).buffer))];
            for (let f = 0; f < frames; f++) {
                for (let axis = 0; axis < 3; axis++) {
                    parts.push(record(Buffer.from(new Float32Array(Array.from({ length: atoms }, (_, i) => (coords[i % coords.length][axis] + (axis === 1 ? f * 0.3 : 0)))).buffer)));
                }
            }
            fs.writeFileSync(file, Buffer.concat(parts));
            return file;
        };
        return { pdb, dcd: dcd(path.join(dir, "swing.dcd"), coords.length, 20), wrong: dcd(path.join(dir, "other.dcd"), coords.length + 5, 3) };
    };
    const insertMoleculeFile = async (page, file) => {
        await page.evaluate(() => addSlide());
        const chooser = page.waitForEvent("filechooser");
        await page.locator("button[title='PDB or Trajectory']:visible").first().click();
        await (await chooser).setFiles(file);
        await page.waitForFunction(() => state.slides[currentSlideIndex].elements.some(e => e.type === "molecule"));
        const id = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.type === "molecule").id);
        const viewer = async () => {
            const frame = await (await page.locator(`.slides [id="${id}"] iframe`).elementHandle()).contentFrame();
            await frame.waitForFunction(() => window.sfMoleculeViewer?.component() && !document.querySelector(".top").className.includes("is-loading"), null, { timeout: 20000 });
            return frame;
        };
        return { id, viewer };
    };

    await test("molecule settings: transparent means no box at all, a layer restyles its atoms (no thick tube), depth cue and reset view work, nothing reloads", async () => {
        const { page, errors } = await openEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-mol-settings-"));
        const files = writeTestProtein(dir);
        await page.evaluate(() => setAppTheme("dark")); // a frame in a dark page used to get an opaque backdrop
        const { id, viewer } = await insertMoleculeFile(page, files.pdb);
        let frame = await viewer();
        await page.evaluate(id => { document.querySelector(`.slides [id="${id}"] iframe`).__kept = true; selectElement(id, "replace"); }, id);
        await showPanelTab(page, "Content");
        await page.locator("#prop-molecule-bg-transparent").check();
        await page.waitForTimeout(400);
        const box = await page.evaluate(id => {
            const node = document.querySelector(`.slides [id="${id}"]`);
            const iframe = node.querySelector("iframe");
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            return { fills: iframe.offsetWidth === node.querySelector(".molecule-embed-wrapper").offsetWidth, frameBg: getComputedStyle(iframe).backgroundColor, shield: getComputedStyle(node.querySelector(".molecule-editor-shield")).backgroundColor, scheme: iframe.style.colorScheme, styles: el.styles };
        }, id);
        const inside = await frame.evaluate(() => getComputedStyle(document.querySelector("#viewer canvas")).backgroundColor);
        assert(box.fills, "the viewer does not cover its whole box");
        assert([box.frameBg, box.shield, inside].every(c => c === "rgba(0, 0, 0, 0)") && box.scheme === "normal", `something behind a transparent molecule is filled: ${JSON.stringify({ ...box, inside })}`);
        assert(box.styles.border && box.styles.zIndex && box.styles.backgroundColor === "transparent", `changing the background lost other styles: ${JSON.stringify(box.styles)}`);

        await page.locator("#prop-molecule-layer-selection").fill("chain A");
        await page.locator("#prop-molecule-layer-color").selectOption("chain");
        await page.locator("#prop-molecule-add-layer").click();
        await page.waitForTimeout(600);
        const reps = await frame.evaluate(() => sfMoleculeViewer.component().reprList.map(r => ({ type: r.repr.type, sele: r.repr.selection.string, radiusScale: r.repr.radiusScale, radiusType: r.repr.radiusType })));
        const cartoons = reps.filter(r => r.type === "cartoon");
        assert(cartoons.length === 2 && cartoons.every(r => r.radiusScale === 0.7 && r.radiusType === "sstruc"), `cartoon layer is not a normal cartoon: ${JSON.stringify(reps)}`);
        assert(/^not \(+:A\)+$/.test(cartoons[0].sele) && cartoons[1].sele === ":A", `the base cartoon still draws chain A under the layer: ${JSON.stringify(cartoons)}`);

        await page.locator("#prop-molecule-depth-cue").uncheck();
        await page.waitForTimeout(300);
        const fog = await frame.evaluate(() => sfMoleculeViewer.stage().parameters.fogNear);
        assert(fog === 100, `depth cue still on (fogNear ${fog})`);

        const area = await page.locator(`.slides [id="${id}"]`).boundingBox();
        await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
        await page.mouse.down();
        await page.mouse.move(area.x + area.width / 2 + 140, area.y + area.height / 2 + 50, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const turned = await frame.evaluate(() => sfMoleculeViewer.stage().viewerControls.getOrientation().toArray());
        await page.locator("#prop-molecule-reset-view").click();
        await page.waitForTimeout(700);
        const reset = await frame.evaluate(() => ({ now: sfMoleculeViewer.stage().viewerControls.getOrientation().toArray(), initial: sfMoleculeViewer.initialOrientation().toArray() }));
        const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
        assert(!near(turned, reset.initial) && near(reset.now, reset.initial), `Reset view did not bring the molecule back to how it was loaded: ${JSON.stringify({ turned, ...reset })}`);

        const kept = await page.evaluate(id => document.querySelector(`.slides [id="${id}"] iframe`).__kept === true, id);
        assert(kept, "changing settings reloaded the viewer");
        const thumbnail = await page.waitForFunction(id => {
            const picture = [...document.querySelectorAll(`#slide-previews [id="${id}"] img, #slide-previews .canvas-element[data-type="molecule"] img`)][0];
            return picture?.src?.startsWith("data:image/png");
        }, id, { timeout: 5000 }).then(() => true, () => false);
        assert(thumbnail, "the slide thumbnail does not show the molecule");
        await page.evaluate(() => setAppTheme("light"));
        assert(!errors.length, errors.join("; "));
        fs.rmSync(dir, { recursive: true, force: true });
        await page.close();
    });

    await test("molecules: a binary DCD trajectory plays over its structure; one for other atoms says so", async () => {
        const { page, errors } = await openEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-mol-traj-"));
        const files = writeTestProtein(dir);
        const { id, viewer } = await insertMoleculeFile(page, files.pdb);
        await viewer();
        await page.evaluate(id => selectElement(id, "replace"), id);
        await showPanelTab(page, "Content");
        const attach = async file => {
            const chooser = page.waitForEvent("filechooser");
            await page.locator("#prop-molecule-add-trajectory").click();
            await (await chooser).setFiles(file);
            await page.waitForFunction(id => state.slides[currentSlideIndex].elements.find(e => e.id === id).moleculeTrajectory, id);
        };
        await attach(files.dcd);
        const frame = await viewer();
        const loaded = await frame.evaluate(() => ({ label: document.getElementById("traj-label").textContent, bar: !document.getElementById("trajectory-panel").hidden }));
        assert(loaded.bar && loaded.label === "1 / 20", `trajectory not loaded: ${JSON.stringify(loaded)}`);
        const moved = await frame.evaluate(async () => {
            const y = () => sfMoleculeViewer.component().structure.atomStore.y[0];
            const before = y();
            const input = document.getElementById("traj-frame");
            input.value = "10";
            input.dispatchEvent(new Event("input"));
            await new Promise(resolve => setTimeout(resolve, 400));
            return { delta: y() - before, label: document.getElementById("traj-label").textContent };
        });
        assert(Math.abs(moved.delta - 3) < 0.05 && moved.label === "11 / 20", `frame 11 does not show the trajectory's coordinates: ${JSON.stringify(moved)}`);

        await page.locator("#prop-molecule-remove-trajectory").click();
        await page.waitForFunction(id => !state.slides[currentSlideIndex].elements.find(e => e.id === id).moleculeTrajectory, id);
        await attach(files.wrong);
        // Review fix: the mismatched file is detached (the structure stays on the slide) and the reason is shown.
        await page.waitForFunction(id => !state.slides[currentSlideIndex].elements.find(e => e.id === id).moleculeTrajectory, id, { timeout: 15000 });
        const message = await page.evaluate(() => [...document.querySelectorAll(".notification")].map(n => n.textContent).join(" | "));
        assert(/101 atoms per frame but the structure has 96/.test(message), `unclear message for a mismatched trajectory: ${message}`);
        const drawn = await (await viewer()).evaluate(() => ({ atoms: sfMoleculeViewer.component()?.structure?.atomCount, error: !!document.querySelector(".top.is-error") }));
        assert(drawn.atoms === 96 && !drawn.error, `after rejecting the trajectory the structure is not shown: ${JSON.stringify(drawn)}`);
        assert(await page.locator("#prop-molecule-add-trajectory").isVisible(), "the panel does not offer Add trajectory again");
        assert(!errors.length, errors.join("; "));
        fs.rmSync(dir, { recursive: true, force: true });
        await page.close();
    });

    await test("a molecule viewer is not rebuilt when the slide is redrawn by other edits or undo", async () => {
        const { page, errors } = await openEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-keep-"));
        const file = path.join(dir, "water.xyz");
        fs.writeFileSync(file, "3\nwater\nO 0.000 0.000 0.117\nH 0.000 0.757 -0.469\nH 0.000 -0.757 -0.469\n");
        await page.evaluate(() => addSlide());
        const chooser = page.waitForEvent("filechooser");
        await page.locator("button[title='PDB or Trajectory']:visible").first().click();
        await (await chooser).setFiles(file);
        await page.waitForFunction(() => state.slides[currentSlideIndex].elements.some(e => e.type === "molecule"));
        const outcome = await page.evaluate(async () => {
            if (typeof Element.prototype.moveBefore !== "function") return { skipped: true };
            const id = state.slides[currentSlideIndex].elements.find(e => e.type === "molecule").id;
            const frame = () => document.querySelector(`.slides [id="${id}"] .molecule-embed-frame`);
            renderSlidesFromState(); // settles the element's saved form
            await new Promise(resolve => setTimeout(resolve, 400));
            const original = frame();
            let loads = 0;
            original.addEventListener("load", () => loads++);
            addElement("text");
            await new Promise(resolve => setTimeout(resolve, 300));
            const afterEdit = frame() === original;
            undo();
            await new Promise(resolve => setTimeout(resolve, 300));
            const afterUndo = frame() === original;
            const stateObject = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            // Look, size and place change in the viewer that is there; only a new file loads a new one.
            updateElementState(id, { moleculeDefaultStyle: "sphere", x: 140, width: "500px", styles: { ...stateObject.styles, backgroundColor: "transparent" } });
            renderSlidesFromState();
            await new Promise(resolve => setTimeout(resolve, 300));
            const keptWhenRestyled = frame() === original && frame().closest(".canvas-element").style.width === "500px";
            updateElementState(id, { content: "3\nwater\nO 0 0 0.1\nH 0 0.76 -0.47\nH 0 -0.76 -0.47\n" });
            renderSlidesFromState();
            await new Promise(resolve => setTimeout(resolve, 300));
            return { afterEdit, afterUndo, loads, keptWhenRestyled, rebuiltWhenChanged: frame() !== original, inState: !!stateObject };
        });
        if (!outcome.skipped) {
            assert(outcome.afterEdit && outcome.afterUndo && outcome.loads === 0, `the viewer was rebuilt or reloaded: ${JSON.stringify(outcome)}`);
            assert(outcome.keptWhenRestyled, "a restyled, moved or resized molecule got a new viewer (it reloads and flashes)");
            assert(outcome.rebuiltWhenChanged, "a molecule given a new file kept its old viewer");
        }
        assert(!errors.length, errors.join("; "));
        fs.rmSync(dir, { recursive: true, force: true });
        await page.close();
    });

    await test("the 3D background does not reallocate its surface every frame, and sliders or edits do not rebuild it", async () => {
        const { page, errors } = await openEditor(context);
        await page.mouse.click(5, 500);
        await showPanelTab(page, "Style");
        const hooked = await page.evaluate(() => {
            if (!window.THREE?.WebGLRenderer) return false;
            window.__sf3d = { created: 0, setSize: 0, frames: 0 };
            const Original = window.THREE.WebGLRenderer;
            window.THREE.WebGLRenderer = function (...args) {
                const renderer = new Original(...args);
                window.__sf3d.created++;
                const setSize = renderer.setSize.bind(renderer);
                renderer.setSize = (...a) => { window.__sf3d.setSize++; return setSize(...a); };
                const render = renderer.render.bind(renderer);
                renderer.render = (...a) => { window.__sf3d.frames++; return render(...a); };
                return renderer;
            };
            return true;
        });
        if (hooked) {
            await page.locator("#prop-slide-bg-three").click();
            await page.waitForTimeout(1500);
            await page.evaluate(() => { window.__sf3d.setSize = 0; window.__sf3d.frames = 0; });
            await page.waitForTimeout(1500);
            const idle = await page.evaluate(() => ({ ...window.__sf3d }));
            assert(idle.frames > 3 && idle.setSize === 0, `surface reallocated while idle: ${JSON.stringify(idle)}`);
            await page.locator("#prop-slide-bg-opacity").evaluate(node => { node.value = 50; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true })); });
            await page.evaluate(() => addElement("text"));
            await page.keyboard.press("Escape");
            await page.waitForTimeout(600);
            const after = await page.evaluate(() => ({ created: window.__sf3d.created, opacity: document.querySelector(".slides section.present .slide-background-media")?.style.opacity, filter: document.querySelector(".slides section.present .slide-background-media")?.style.filter }));
            if (await page.evaluate(() => typeof Element.prototype.moveBefore === "function")) {
                assert(after.created === 1, `the 3D scene was rebuilt ${after.created - 1} time(s) by a slider and an edit`);
            }
            assert(after.opacity === "0.5" && after.filter === "", `adjustments not applied in place: ${JSON.stringify(after)}`);
        }
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    await test("PDF tools: Highlight and Note work as soon as they are chosen, without reloading the document", async () => {
        const { page } = await openEditor(context);
        const id = await page.evaluate(() => {
            addSlide();
            const el = { id: generateId("el"), type: "pdf", content: "/media/assets/missing-for-test.pdf", x: 200, y: 200, width: "500px", height: "300px",
                pdfInteractive: true, pdfEditorMode: "navigate", pdfAnnotations: [], pdfSelectedAnnotationId: "", styles: { zIndex: 5 } };
            state.slides[currentSlideIndex].elements.push(el);
            renderSlidesFromState();
            selectElement(el.id, "replace");
            return el.id;
        });
        await showPanelTab(page, "Content");
        await page.evaluate(id => { document.querySelector(`.slides [id="${id}"] .pdf-embed-frame`).dataset.kept = "yes"; }, id);
        await page.locator("#prop-pdf-mode-highlight").click();
        await page.waitForTimeout(200);
        const box = await page.locator(`.slides [id="${id}"]`).boundingBox();
        await page.mouse.move(box.x + 60, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 220, box.y + 110, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const outcome = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            return { annotations: el.pdfAnnotations.map(a => a.type), page: pdfPageImageUrl(el), external: pdfPageImageUrl({ content: "https://example.com/a.pdf" }) };
        }, id);
        assert(outcome.annotations.join() === "highlight", `highlight not added: ${JSON.stringify(outcome)}`);
        assert(/^\/api\/assets\/pdf-page\/\?url=/.test(outcome.page) && outcome.external === null, JSON.stringify(outcome));
        await page.close();
    });

    await test("PowerPoint export: text is left-aligned unless set otherwise, and is sent with its drawn height, line spacing and the theme gradient", async () => {
        const { page } = await openEditor(context);
        let sent = null;
        await page.route("**/api/presentations/export/pptx/", route => {
            sent = JSON.parse(route.request().postData() || "{}");
            route.fulfill({ status: 500, body: "{}" });
        });
        const ids = await page.evaluate(() => {
            state.presentationTheme = "horizon";
            addSlide();
            const body = state.slides[currentSlideIndex].elements.find(e => e.placeholderRole === "content");
            body.content = [{ html: "One", level: 0 }, { html: "Two", level: 0 }];
            addElement("text");
            const box = state.slides[currentSlideIndex].elements.at(-1);
            box.content = "Plain box";
            delete box.styles.textAlign;
            box.height = "auto";
            const listSlide = currentSlideIndex;
            for (let i = 0; i < 4; i++) addSlide(); // the list's slide is now far from the one on screen
            renderSlidesFromState();
            return { body: body.id, box: box.id, listSlide };
        });
        const align = await page.evaluate(id => getComputedStyle([...document.querySelectorAll(`[id="${id}"]`)].find(n => !n.closest("#slide-previews"))).textAlign, ids.box);
        assert(/left|start/.test(align), `a text box without an alignment is drawn ${align}`);
        await page.evaluate(() => exportPPTX().catch(() => {}));
        await page.waitForTimeout(800);
        assert(sent, "nothing was sent to the export");
        const els = sent.state?.slides?.[ids.listSlide]?.elements || sent.slides?.[ids.listSlide]?.elements || [];
        const body = els.find(e => e.id === ids.body);
        const box = els.find(e => e.id === ids.box);
        const state = sent.state || sent;
        assert(body && body.exportLineHeight > 1 && body.exportParagraphGap > 0, `list spacing not sent: ${JSON.stringify(body && { lh: body.exportLineHeight, gap: body.exportParagraphGap })}`);
        assert(box && parseFloat(box.height) > 10, `auto height not measured: ${box && box.height}`);
        assert(/linear-gradient/.test(state.themeBackgroundCss || ""), `theme gradient not sent: ${state.themeBackgroundCss}`);
        await page.close();
    });

    // Bugs from the 2026-10-01 user review.

    await test("review: align buttons line shapes up instead of sending them to 100,100", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push(
                { id: "el_al1", type: "shape", shapeType: "rectangle", x: 437, y: 168, width: "150px", height: "150px", styles: { backgroundColor: "#4f7cff" } },
                { id: "el_al2", type: "shape", shapeType: "circle", x: 828, y: 309, width: "150px", height: "150px", styles: { backgroundColor: "#4f7cff" } },
            );
            renderSlidesFromState();
            const out = {};
            for (const mode of ["left", "middle", "right", "top", "center", "bottom"]) {
                state.selectedIds = ["el_al1", "el_al2"];
                alignSelection(mode);
                // Undo swaps in a restored copy of the slides, so read the live slide each time.
                out[mode] = state.slides[currentSlideIndex].elements.filter(e => e.id.startsWith("el_al")).map(e => [e.x, e.y]);
                undo();
            }
            return out;
        });
        const want = {
            left: [[437, 168], [437, 309]],
            right: [[828, 168], [828, 309]],
            center: [[632.5, 168], [632.5, 309]],
            top: [[437, 168], [828, 168]],
            middle: [[437, 238.5], [828, 238.5]],
            bottom: [[437, 309], [828, 309]],
        };
        for (const [mode, expected] of Object.entries(want)) {
            const got = result[mode].map(p => p.map(Number));
            assert(JSON.stringify(got) === JSON.stringify(expected), `align ${mode}: got ${JSON.stringify(result[mode])}, want ${JSON.stringify(expected)}`);
        }
        await page.close();
    });

    await test("review: slide clean-up leaves the footer (logo, rule, slide number) where it is", async () => {
        const { page } = await openFreshEditor(context);
        // No AI model in the test: the request fails and the local clean-up runs. The footer is left out before
        // either path sees the slide, and this keeps the test fast and off any configured AI provider.
        await page.route("**/api/slides/cleanup/", route => route.abort());
        const result = await page.evaluate(async () => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push({ id: "el_cu1", type: "shape", shapeType: "rectangle", x: 433, y: 203, width: "150px", height: "150px", styles: {} });
            renderSlidesFromState();
            const footer = () => slide.elements.filter(e => e.footerRole).map(e => `${e.footerRole}:${e.x},${e.y}`).sort().join(" ");
            const before = footer();
            state.selectedIds = [];
            await aiCleanUpSlide();
            return { before, after: footer(), count: slide.elements.filter(e => e.footerRole).length };
        });
        assert(result.count >= 3, `expected a footer on the new slide, found ${result.count} parts`);
        assert(result.before === result.after, `footer moved: ${result.before} -> ${result.after}`);
        await page.close();
    });

    await test("review: filled shapes keep their fill while several are selected", async () => {
        const { page } = await openFreshEditor(context);
        const colors = await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push(
                { id: "el_ms1", type: "shape", shapeType: "rectangle", x: 100, y: 200, width: "150px", height: "150px", styles: { backgroundColor: "#4f7cff" } },
                { id: "el_ms2", type: "shape", shapeType: "circle", x: 400, y: 200, width: "150px", height: "150px", styles: { backgroundColor: "#4f7cff" } },
            );
            state.selectedIds = ["el_ms1", "el_ms2"];
            renderSlidesFromState();
            const node = id => [...document.querySelectorAll(`[id="${id}"]`)].find(n => !n.closest("#slide-previews"));
            return ["el_ms1", "el_ms2"].map(id => [node(id).classList.contains("group-member-selected"), getComputedStyle(node(id)).backgroundColor]);
        });
        colors.forEach(([selected, color], i) => {
            assert(selected, `shape ${i + 1} is not shown as part of the selection`);
            assert(color === "rgb(79, 124, 255)", `shape ${i + 1} fill while selected: ${color}`);
        });
        await page.close();
    });

    await test("review: the thumbnail shows text typed into the first slide's title", async () => {
        const { page } = await openFreshEditor(context);
        const center = await page.evaluate(() => {
            setCurrentSlideIndex(0);
            Reveal.slide(0);
            const el = state.slides[0].elements.find(e => e.type === "text");
            const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find(n => !n.closest("#slide-previews"));
            const r = node.getBoundingClientRect();
            return [r.x + r.width / 2, r.y + r.height / 2];
        });
        await page.mouse.dblclick(center[0], center[1]);
        await page.waitForTimeout(200);
        await page.keyboard.press("Control+A");
        await page.keyboard.type("Thumbnail check");
        await page.mouse.click(1430, 640);
        await page.waitForTimeout(900);
        const text = await page.evaluate(() => document.querySelector("#slide-previews .slide-preview-card")?.innerText || "");
        assert(text.includes("Thumbnail check"), `first thumbnail text: ${JSON.stringify(text.slice(0, 80))}`);
        await page.close();
    });

    await test("review: thumbnails drawn while the slide rail is hidden are not blank once it is back", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => {
            addSlide();
            const rail = document.getElementById("slide-previews");
            rail.style.display = "none";
            renderSlidePreviews(null, { preserveScroll: true });
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => { document.getElementById("slide-previews").style.display = ""; });
        await page.waitForTimeout(400);
        const scales = await page.evaluate(() => [...document.querySelectorAll("#slide-previews .slide-thumbnail")].map(t => {
            const child = t.firstElementChild;
            return child.getBoundingClientRect().width / t.getBoundingClientRect().width;
        }));
        assert(scales.length >= 2, "no thumbnails");
        scales.forEach((ratio, i) => assert(Math.abs(ratio - 1) < 0.05, `thumbnail ${i + 1} slide fills ${Math.round(ratio * 100)}% of its card`));
        await page.close();
    });

    await test("review: table text stays readable on its cells through every theme change", async () => {
        const { page } = await openFreshEditor(context);
        const problems = await page.evaluate(() => {
            const parse = value => {
                const probe = document.createElement("div");
                probe.style.color = value;
                document.body.appendChild(probe);
                const m = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
                probe.remove();
                return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
            };
            const lum = c => [c.r, c.g, c.b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
            const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
            addSlide();
            addElement("table");
            const out = [];
            for (const themeId of Object.keys(PRESENTATION_THEMES)) {
                changePresentationTheme(themeId);
                const t = state.slides[currentSlideIndex].elements.find(e => e.type === "table").tableData;
                [["header", t.headerTextColor, t.headerFill], ["body", t.textColor, t.bodyFill], ["alt row", t.textColor, t.altFill]].forEach(([part, text, fill]) => {
                    const f = parse(fill);
                    if (f.a < 0.5) return;
                    const ratio = contrast(parse(text), f);
                    if (ratio < 4.5) out.push(`${themeId} ${part}: ${text} on ${fill} (${ratio.toFixed(2)})`);
                });
            }
            return out;
        });
        assert(!problems.length, `unreadable table text: ${problems.join("; ")}`);
        await page.close();
    });

    await test("review: the default subtitle takes the theme's muted colour (readable on Horizon)", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(() => {
            // A slide with the default subtitle as a new deck has it, on the default theme.
            changePresentationTheme("editorial");
            addSlide();
            const id = `el_sub_${Date.now()}`;
            state.slides[currentSlideIndex].elements.push({ id, type: "text", x: 64, y: 404, width: "896px", height: "60px", content: "", placeholder: "Click to add subtitle", styles: { color: "#475569", fontSize: "26px", fontFamily: '"Manrope", sans-serif' } });
            changePresentationTheme("horizon");
            const live = state.slides.flatMap(slide => slide.elements).find(e => e.id === id);
            return { color: live.styles?.color ?? live.color, muted: PRESENTATION_THEMES.horizon.defaultMutedColor };
        });
        assert(String(result.color).toLowerCase() === result.muted.toLowerCase(), `subtitle colour on Horizon: ${result.color}, want ${result.muted}`);
        await page.close();
    });

    await test("review: adding a table row or column grows the table instead of squashing it", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(async () => {
            addSlide();
            addElement("table");
            const table = () => state.slides[currentSlideIndex].elements.find(e => e.type === "table");
            // Several panel builds in a row, as a real selection does; the panel binds its buttons after a tick.
            selectElement(table().id, "replace");
            buildPropertiesPanel();
            buildPropertiesPanel();
            await new Promise(r => setTimeout(r, 150));
            const rowsOf = () => {
                const node = [...document.querySelectorAll(`[id="${table().id}"]`)].find(n => !n.closest("#slide-previews"));
                return [...node.querySelectorAll("tr")].map(tr => Math.round(tr.getBoundingClientRect().height));
            };
            const before = { height: parseFloat(table().height), width: parseFloat(table().width), rows: rowsOf() };
            document.getElementById("prop-table-add-row").click();
            await new Promise(r => setTimeout(r, 200));
            const afterRow = { height: parseFloat(table().height), rows: rowsOf() };
            await new Promise(r => setTimeout(r, 150));
            document.getElementById("prop-table-add-col").click();
            await new Promise(r => setTimeout(r, 200));
            return { before, afterRow, widthAfterCol: parseFloat(table().width), cols: table().tableData.cols };
        });
        const { before, afterRow } = result;
        assert(afterRow.rows.length === before.rows.length + 1, `one Add row click: rows ${before.rows.length} -> ${afterRow.rows.length}`);
        assert(result.cols === 5, `one Add column click: 4 -> ${result.cols} columns`);
        assert(afterRow.height > before.height, `table height went ${before.height} -> ${afterRow.height}`);
        const rowH = before.rows[0];
        assert(afterRow.rows.every(h => Math.abs(h - rowH) <= 2), `row heights before ${before.rows}, after adding a row ${afterRow.rows}`);
        assert(result.widthAfterCol > before.width, `table width went ${before.width} -> ${result.widthAfterCol} after adding a column`);
        await page.close();
    });

    await test("review: the image Crop and Reset buttons have readable labels in light and dark mode", async () => {
        const { page } = await openFreshEditor(context);
        const results = await page.evaluate(async () => {
            const parse = value => value.match(/[\d.]+/g).map(Number);
            const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
            const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
            addSlide();
            const cropId = `el_cropimg_${Date.now()}`;
            state.slides[currentSlideIndex].elements.push({ id: cropId, type: "image", x: 100, y: 150, width: "300px", height: "200px", content: "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", styles: {} });
            renderSlidesFromState();
            selectElement(cropId, "replace");
            const out = [];
            for (const theme of ["light", "dark"]) {
                document.documentElement.dataset.theme = theme;
                buildPropertiesPanel();
                // Tailwind (the runtime build) writes the CSS for newly seen classes a moment later.
                for (let i = 0; i < 40; i++) {
                    await new Promise(r => setTimeout(r, 50));
                    const button = document.getElementById("prop-crop");
                    // ...and its colour transition has finished (the background is opaque again).
                    const bg = button && getComputedStyle(button).backgroundColor;
                    if (bg && !/rgba\(.*,\s*0(\.\d+)?\)$/.test(bg)) break;
                }
                for (const id of ["prop-crop", "prop-crop-reset"]) {
                    const cs = getComputedStyle(document.getElementById(id));
                    out.push([theme, id, contrast(parse(cs.color), parse(cs.backgroundColor)).toFixed(2), cs.color, cs.backgroundColor]);
                }
            }
            document.documentElement.dataset.theme = "light";
            return out;
        });
        const bad = results.filter(r => Number(r[2]) < 4.5);
        assert(!bad.length, `low-contrast buttons: ${bad.map(r => r.join(" ")).join("; ")}`);
        await page.close();
    });

    await test("review: a newly added slide is scrolled into view above the Deck panel", async () => {
        const { page } = await openFreshEditor(context);
        // From the last slide, so each new slide lands at the bottom of the list.
        await page.evaluate(() => { setCurrentSlideIndex(state.slides.length - 1); Reveal.slide(state.slides.length - 1); });
        for (let i = 0; i < 7; i++) {
            await page.getByRole("button", { name: "New Slide" }).first().click();
            await page.waitForTimeout(250);
        }
        await page.waitForTimeout(600);
        const box = await page.evaluate(() => {
            const rail = document.getElementById("slide-previews");
            const card = rail.querySelector(".slide-preview-card.active");
            const r = card.getBoundingClientRect();
            const railRect = rail.getBoundingClientRect();
            return { index: Number(card.dataset.slideIndex), current: currentSlideIndex, top: r.top, bottom: r.bottom, railTop: railRect.top, visibleBottom: railRect.bottom - 72, scrolled: rail.scrollTop };
        });
        assert(box.index === box.current, `active card ${box.index}, current slide ${box.current}`);
        assert(box.top >= box.railTop - 1 && box.bottom <= box.visibleBottom + 1, `new slide card spans ${Math.round(box.top)}-${Math.round(box.bottom)}, visible area ${Math.round(box.railTop)}-${Math.round(box.visibleBottom)} (scrollTop ${box.scrolled})`);
        await page.close();
    });

    await test("review: changing the slide size keeps every object on the slide", async () => {
        const { page } = await openFreshEditor(context);
        const problems = await page.evaluate(() => {
            const ids = Object.keys(PRESENTATION_PAGE_SETUPS);
            changePresentationPageSetup("talk-16-9");
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push(
                { id: "el_ps1", type: "text", x: 48, y: 40, width: "1184px", height: "80px", content: "Wide title", styles: { fontSize: "40px" } },
                { id: "el_ps2", type: "shape", shapeType: "rectangle", x: 1100, y: 500, width: "160px", height: "200px", styles: {} },
            );
            renderSlidesFromState();
            const out = [];
            for (const id of [...ids, ...ids.slice().reverse()]) {
                changePresentationPageSetup(id);
                const { width: W, height: H } = getPresentationPageSetupConfig();
                for (const el of state.slides[currentSlideIndex].elements) {
                    const x = Number(el.x), y = Number(el.y), w = parseFloat(el.width), h = parseFloat(el.height);
                    if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
                    if (x < -0.5 || y < -0.5 || x + w > W + 0.5 || y + h > H + 0.5) {
                        out.push(`${id}: ${el.id || el.type} at ${x},${y} ${w}x${h} on ${W}x${H}`);
                    }
                }
            }
            return out;
        });
        assert(!problems.length, `objects off the slide: ${problems.slice(0, 6).join("; ")}`);
        await page.close();
    });

    await test("review: undoing a slide-size change puts the canvas back to that size", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => changePresentationPageSetup("talk-16-9"));
        await page.waitForTimeout(300);
        await page.evaluate(() => changePresentationPageSetup("standard-4-3"));
        await page.waitForTimeout(300);
        await page.evaluate(() => undo());
        await page.waitForTimeout(500);
        const result = await page.evaluate(() => {
            const config = getPresentationPageSetupConfig();
            const node = document.querySelector(".reveal .slides section.present") || document.querySelector(".presentation-slide.present");
            const r = node.getBoundingClientRect();
            return { id: config.id, want: config.width / config.height, got: r.width / r.height, cssHeight: getComputedStyle(document.documentElement).getPropertyValue("--slide-height").trim(), revealHeight: Reveal.getConfig().height };
        });
        assert(result.id === "talk-16-9", `page setup after undo: ${result.id}`);
        assert(Math.abs(result.got - result.want) < 0.02, `slide aspect after undo ${result.got.toFixed(3)}, want ${result.want.toFixed(3)}`);
        assert(result.cssHeight === "720px" && Number(result.revealHeight) === 720, `canvas height after undo: css ${result.cssHeight}, Reveal ${result.revealHeight}`);
        await page.close();
    });

    await test("review: a molecule on a far-away (hidden) slide still exports as a full-size picture", async () => {
        const { page } = await openFreshEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const water = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sf-mol-")), "water.xyz");
        fs.writeFileSync(water, "3\nwater\nO 0.000 0.000 0.117\nH 0.000 0.757 -0.469\nH 0.000 -0.757 -0.469\n");
        await page.evaluate(() => addSlide());
        const chooser = page.waitForEvent("filechooser");
        await page.locator("button[title='PDB or Trajectory']:visible").first().click();
        await (await chooser).setFiles(water);
        await page.waitForFunction(() => state.slides[currentSlideIndex].elements.some(e => e.type === "molecule"));
        const result = await page.evaluate(async () => {
            const molSlide = currentSlideIndex;
            const el = state.slides[molSlide].elements.find(e => e.type === "molecule");
            const frame = () => document.querySelector(`.slides [id="${el.id}"] .molecule-embed-frame`);
            await requestMoleculeSnapshot(frame(), 15000);
            for (let i = 0; i < 6; i++) addSlide();
            setCurrentSlideIndex(state.slides.length - 1);
            Reveal.slide(state.slides.length - 1);
            await new Promise(r => setTimeout(r, 600));
            // A new viewer built while its slide is hidden (as after reopening a deck on a later slide): a changed
            // file makes the editor build a fresh viewer, which starts at 0 x 0.
            const live = state.slides[molSlide].elements.find(e => e.id === el.id);
            live.content = String(live.content).replace("water", "water (reloaded)");
            renderSlidesFromState();
            await new Promise(r => setTimeout(r, 2500));
            const hiddenWidth = frame()?.getBoundingClientRect().width;
            const exportState = { slides: [{ elements: [JSON.parse(JSON.stringify(live))] }] };
            await replaceMoleculesWithPictures(exportState);
            const picture = exportState.slides[0].elements[0];
            const size = await new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    // Count drawn (non-background) pixels, so a blank picture of the right size also fails.
                    const c = document.createElement("canvas");
                    c.width = img.naturalWidth;
                    c.height = img.naturalHeight;
                    const ctx = c.getContext("2d");
                    ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, c.width, c.height).data;
                    let drawn = 0;
                    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] > 60) drawn++;
                    resolve([img.naturalWidth, img.naturalHeight, drawn]);
                };
                img.onerror = () => resolve([0, 0]);
                img.src = picture.content || "";
            });
            return { hiddenWidth, type: picture.type, size, elWidth: parseFloat(el.width) };
        });
        assert(result.hiddenWidth === 0, `setup: the molecule's slide was not hidden (frame width ${result.hiddenWidth})`);
        assert(result.type === "image", `exported as ${result.type}`);
        assert(result.size[0] >= result.elWidth, `exported picture is ${result.size[0]}x${result.size[1]} for a ${result.elWidth}px-wide molecule`);
        assert(result.size[2] > 200, `exported picture is blank (${result.size[2]} drawn pixels)`);
        await page.close();
    });

    await test("review: HTML embeds export as a picture of themselves (PDF capture and PowerPoint, even on a hidden slide)", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(async () => {
            const html = '<div style="position:fixed;inset:0;background:rgb(250,200,40);display:grid;place-items:center;font:28px sans-serif">Live <b id="n">0</b></div><script>document.getElementById("n").textContent = 7 * 6;</script>';
            addSlide();
            const slideIndex = currentSlideIndex;
            state.slides[slideIndex].elements.push({ id: "el_htmlx", type: "html", x: 200, y: 200, width: "400px", height: "240px", content: html, styles: {} });
            renderSlidesFromState();
            await new Promise(r => setTimeout(r, 1500));
            const host = [...document.querySelectorAll('[id="el_htmlx"]')].find(n => !n.closest("#slide-previews"));
            const yellowShare = async dataUrl => {
                if (!dataUrl) return 0;
                const img = new Image();
                img.src = dataUrl;
                await img.decode();
                const c = document.createElement("canvas");
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext("2d");
                ctx.drawImage(img, 0, 0);
                const d = ctx.getImageData(0, 0, c.width, c.height).data;
                let yellow = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 180 && d[i + 1] < 220 && d[i + 2] < 80) yellow++;
                return yellow / (d.length / 4);
            };
            const restore = await showHtmlEmbedsAsPicturesForCapture(host.closest("section") || host.parentElement);
            const cover = host.querySelector("img");
            const pdfShare = await yellowShare(cover?.src);
            restore();
            const leftOver = !!host.querySelector("img");
            for (let i = 0; i < 6; i++) addSlide();
            setCurrentSlideIndex(state.slides.length - 1);
            Reveal.slide(state.slides.length - 1);
            await new Promise(r => setTimeout(r, 600));
            const exportState = { slides: [{ elements: [JSON.parse(JSON.stringify(state.slides[slideIndex].elements.find(e => e.id === "el_htmlx")))] }] };
            await replaceHtmlEmbedsWithPictures(exportState);
            const picture = exportState.slides[0].elements[0];
            return { pdfShare, leftOver, pptxType: picture.type, pptxShare: await yellowShare(picture.content) };
        });
        assert(result.pdfShare > 0.5, `PDF capture: the embed's picture is ${Math.round(result.pdfShare * 100)}% its colour`);
        assert(!result.leftOver, "the capture picture was left on the slide");
        assert(result.pptxType === "image", `PowerPoint export kept a ${result.pptxType} element (placeholder)`);
        assert(result.pptxShare > 0.5, `PowerPoint picture is ${Math.round(result.pptxShare * 100)}% the embed's colour`);
        await page.close();
    });

    await test("review: an animation added from the picker waits for a click and is listed by its name", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push({ id: "el_anim1", type: "shape", shapeType: "rectangle", x: 300, y: 300, width: "150px", height: "150px", styles: { backgroundColor: "#4f7cff" } });
            renderSlidesFromState();
            selectElement("el_anim1", "replace");
            applyAnimationPreset("el_anim1", "slideInUp");
        });
        await page.waitForTimeout(300);
        const result = await page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === "el_anim1");
            const anim = el.animation?.timelines?.[0]?.animations?.[0];
            return { trigger: anim?.trigger, type: document.querySelector(".sf-anim-item-type")?.textContent, meta: document.querySelector(".sf-anim-item-meta")?.textContent };
        });
        assert(result.trigger === "on-click", `new animation trigger: ${result.trigger}`);
        assert(result.type === "Slide In Up", `listed as ${JSON.stringify(result.type)}`);
        assert(/On click/.test(result.meta || ""), `meta line: ${JSON.stringify(result.meta)}`);
        await page.close();
    });

    await test("review: the presenter view's slide preview has no animation badges", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push({ id: "el_pvb", type: "shape", shapeType: "rectangle", x: 300, y: 300, width: "150px", height: "150px", styles: { backgroundColor: "#4f7cff" } });
            renderSlidesFromState();
            applyAnimationPreset("el_pvb", "fadeIn");
            const node = [...document.querySelectorAll('[id="el_pvb"]')].find(n => !n.closest("#slide-previews"));
            const section = node.closest("section");
            const html = _presenterSectionHtml(section);
            return { inEditor: !!node.querySelector(".anim-badge"), inPresenter: /anim-badge|fa-bolt/.test(html), hasElement: html.includes("el_pvb") };
        });
        assert(result.inEditor, "setup: the editor shows no animation badge");
        assert(result.hasElement, "the element is missing from the presenter preview");
        assert(!result.inPresenter, "the presenter preview carries the animation badge");
        await page.close();
    });

    await test("review: Escape closes the Share dialog", async () => {
        const { page } = await openFreshEditor(context);
        await page.locator('button[title="Share a view-only link"]').click();
        await page.waitForSelector("#share-modal:not(.hidden)");
        await page.waitForTimeout(1200);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        const open = await page.evaluate(() => !document.getElementById("share-modal").classList.contains("hidden"));
        assert(!open, "the Share dialog is still open after Escape");
        await page.close();
    });

    await test("review: SVG export draws the theme's slide background (gradient), not a card colour", async () => {
        const { page } = await openFreshEditor(context);
        const themes = await page.evaluate(() => Object.keys(PRESENTATION_THEMES));
        const bad = [];
        for (const themeId of themes) {
            // The exported SVG and the browser's own drawing of the theme background, side by side on screen.
            const size = await page.evaluate(async themeId => {
                changePresentationTheme(themeId);
                const { width, height } = getPresentationPageSetupConfig();
                const scene = compileSlideForgeRenderScene({ profile: "publication" });
                const { SvgRenderer } = await import("./js/rendering/renderers/SvgRenderer.js");
                const svg = SvgRenderer.renderSlide({ ...scene.slides[currentSlideIndex], layers: [] }, scene);
                document.getElementById("sf-bg-probe")?.remove();
                const probe = document.createElement("div");
                probe.id = "sf-bg-probe";
                probe.style.cssText = "position:fixed;inset:0;z-index:99999;background:#fff";
                const w = 320, h = Math.round((320 * height) / width);
                probe.innerHTML = `<div style="position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform:scale(${w / width});transform-origin:0 0;background:${PRESENTATION_THEMES[themeId].cssVars["--slide-bg"]}"></div><img style="position:absolute;left:${w}px;top:0;width:${width}px;height:${height}px;transform:scale(${w / width});transform-origin:0 0" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
                document.body.appendChild(probe);
                await probe.querySelector("img").decode();
                return { w, h };
            }, themeId);
            const shot = await page.screenshot({ clip: { x: 0, y: 0, width: size.w * 2, height: size.h } });
            const diff = await page.evaluate(async ({ b64, w, h }) => {
                const img = new Image();
                img.src = "data:image/png;base64," + b64;
                await img.decode();
                const c = document.createElement("canvas");
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                const ctx = c.getContext("2d");
                ctx.drawImage(img, 0, 0);
                const scale = img.naturalWidth / (w * 2);
                const left = ctx.getImageData(0, 0, Math.floor(w * scale), Math.floor(h * scale)).data;
                const right = ctx.getImageData(Math.floor(w * scale), 0, Math.floor(w * scale), Math.floor(h * scale)).data;
                let total = 0, far = 0;
                for (let i = 0; i < left.length; i += 4) {
                    const d = Math.max(Math.abs(left[i] - right[i]), Math.abs(left[i + 1] - right[i + 1]), Math.abs(left[i + 2] - right[i + 2]));
                    total += d;
                    if (d > 24) far++;
                }
                return { mean: total / (left.length / 4), far: far / (left.length / 4) };
            }, { b64: shot.toString("base64"), ...size });
            if (diff.mean > 2 || diff.far > 0.02) bad.push(`${themeId}: mean ${diff.mean.toFixed(2)}, ${(diff.far * 100).toFixed(1)}% far off`);
        }
        await page.evaluate(() => document.getElementById("sf-bg-probe")?.remove());
        assert(!bad.length, `SVG background differs from the theme: ${bad.join("; ")}`);
        await page.close();
    });

    await test("missing: the shape picker offers the full shape set, each drawn with its outline in the editor and SVG", async () => {
        const { page } = await openFreshEditor(context);
        await page.locator('button[title="Shapes and Arrows"]').click();
        const offered = await page.evaluate(() => [...document.querySelectorAll("#shape-picker-basic .shape-picker-item span, #shape-picker-arrows .shape-picker-item span")].map(n => n.textContent));
        for (const name of ["Rounded", "Star", "Callout", "Pentagon", "Octagon", "Chevron", "Plus", "Trapezoid", "Right triangle"]) {
            assert(offered.includes(name), `picker lacks ${name}: ${offered.join(", ")}`);
        }
        const icons = await page.evaluate(() => [...document.querySelectorAll("#shape-picker-basic .shape-picker-item")].every(b => b.querySelector("svg polygon, svg rect, svg ellipse")));
        assert(icons, "a picker button has no drawn preview");
        const drawn = await page.evaluate(async () => {
            closeShapePicker();
            addSlide();
            const out = {};
            for (const shape of SHAPE_CATALOG.filter(s => s.group === "basic")) {
                insertShapeFromPicker(shape.type);
                const id = state.selectedIds[0];
                const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
                const node = [...document.querySelectorAll(`[id="${id}"]`)].find(n => !n.closest("#slide-previews"));
                const polygon = node.querySelector(".sf-shape-visual-svg polygon");
                out[shape.type] = {
                    points: polygon ? polygon.getAttribute("points").trim().split(/\s+/).length : 0,
                    radius: getComputedStyle(node).borderRadius,
                    styleRadius: el.styles?.borderRadius,
                };
            }
            const { compileShapeGeometry } = await import("./js/rendering/vector/ShapeCompiler.js");
            out.svgStar = compileShapeGeometry({ shapeType: "star" });
            return out;
        });
        assert(drawn.star.points === 10 && drawn.callout.points === 7 && drawn.octagon.points === 8, `outlines: ${JSON.stringify(drawn)}`);
        assert(drawn["rounded-rectangle"].styleRadius === "18px", `rounded rectangle radius: ${JSON.stringify(drawn["rounded-rectangle"])}`);
        assert(drawn.circle.radius === "50%", `circle radius ${drawn.circle.radius} (an ellipse needs 50%)`);
        assert(drawn.svgStar.primitive === "polygon" && drawn.svgStar.points.length === 10, `SVG export star: ${JSON.stringify(drawn.svgStar)}`);
        await page.close();
    });

    await test("style: a new deck is 16:9 (old decks without a size stay 4:3) and the fitted slide clears the zoom and AI buttons", async () => {
        const { page } = await openFreshEditor(context);
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => {
            const rect = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
            return {
                setup: state.pageSetup,
                legacy: getPresentationPageSetupId({ slides: [] }),
                slide: rect(".reveal"),
                buttons: [rect("#zoom-lens-toggle"), rect(".ai-dock-toggle")],
            };
        });
        assert(result.setup === "talk-16-9", `new deck page setup: ${result.setup}`);
        assert(result.legacy === "standard-4-3", `a deck saved without a size opens as ${result.legacy}`);
        result.buttons.forEach((b, i) => {
            const overlaps = b.left < result.slide.right && b.right > result.slide.left && b.top < result.slide.bottom && b.bottom > result.slide.top;
            assert(!overlaps, `floating button ${i} covers the slide: ${JSON.stringify(b)} vs ${JSON.stringify(result.slide)}`);
        });
        await page.close();
    });

    await test("style: flowchart edge labels sit on a small label background, not a text outline", async () => {
        const { page } = await openFreshEditor(context);
        const svg = await page.evaluate(async () => {
            const { parseMermaidToGraph, graphToSvg } = await import("./js/mermaid/mermaid-graph.js");
            return graphToSvg(parseMermaidToGraph("flowchart TD\n  A[Start] -->|Yes| B[End]"), {});
        });
        assert(/<rect[^>]*class="mermaid-graph-edge-halo"/.test(svg), "no label background behind the edge label");
        assert(!/<text[^>]*mermaid-graph-edge-halo[^>]*stroke-width/.test(svg), "the edge label still has a stroked text halo");
        assert(/>Yes<\/text>/.test(svg), "the edge label text is missing");
        await page.close();
    });

    await test("missing: X, Y, W, H and rotation can be typed in, and Group is only offered for two or more objects", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => {
            addSlide();
            insertShapeFromPicker("rectangle");
            if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click();
        });
        await page.waitForTimeout(400);
        await page.locator('.properties-tab[data-properties-tab="overview"]').click();
        await page.waitForTimeout(300);
        const groupDisabled = await page.locator("#prop-group").isDisabled();
        for (const [id, value] of [["#prop-geom-x", "321"], ["#prop-geom-y", "123"], ["#prop-geom-w", "260"], ["#prop-geom-h", "90"], ["#prop-geom-rot", "15"]]) {
            await page.fill(id, value);
            await page.press(id, "Enter");
            await page.waitForTimeout(250);
        }
        const el = await page.evaluate(() => {
            const e = state.slides[currentSlideIndex].elements.find(item => item.id === state.selectedIds[0]);
            return [e.x, e.y, e.width, e.height, e.rotation];
        });
        assert(groupDisabled, "Group is enabled with one object selected");
        assert(JSON.stringify(el) === JSON.stringify([321, 123, "260px", "90px", 15]), `typed geometry gave ${JSON.stringify(el)}`);
        await page.evaluate(() => { undo(); });
        const afterUndo = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(item => item.type === "shape" && !item.footerRole && item.width === "260px")?.rotation ?? null);
        assert(afterUndo === null || afterUndo === undefined || afterUndo === 0, `undo did not take back the rotation (${afterUndo})`);
        await page.close();
    });

    await test("style: theme tags are not repeated, and an embedded picture is described instead of showing its data address", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(async () => {
            const tagsFor = async themeId => {
                changePresentationTheme(themeId);
                clearSelection();
                buildPropertiesPanel();
                await new Promise(r => setTimeout(r, 50));
                return [...document.querySelectorAll(".sf-theme-intel span")].map(n => n.textContent.trim().toLowerCase());
            };
            const repeats = [];
            for (const themeId of Object.keys(PRESENTATION_THEMES)) {
                const tags = await tagsFor(themeId);
                if (new Set(tags).size !== tags.length) repeats.push(`${themeId}: ${tags.join(", ")}`);
            }
            addSlide();
            const id = `el_img_${Date.now()}`;
            state.slides[currentSlideIndex].elements.push({ id, type: "image", x: 100, y: 100, width: "200px", height: "120px", content: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", styles: {} });
            renderSlidesFromState();
            selectElement(id, "replace");
            buildPropertiesPanel();
            await new Promise(r => setTimeout(r, 50));
            return { repeats, field: document.getElementById("prop-img")?.value, source: document.querySelector(".prop-image-source")?.textContent.trim() };
        });
        assert(!result.repeats.length, `repeated theme tags: ${result.repeats.join("; ")}`);
        assert(result.field === "" && /Embedded picture · WEBP/.test(result.source || ""), `image field ${JSON.stringify(result)}`);
        await page.close();
    });

    await test("style: a new slide after an imported slide has no SlideForge footer and uses that slide's fonts", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(() => {
            const theme = getPresentationTheme();
            addSlide();
            const normal = state.slides[currentSlideIndex];
            const normalResult = { master: normal.masterId, title: normal.elements[0].styles.fontFamily };
            state.slides.splice(currentSlideIndex + 1, 0, {
                id: generateId("slide"), layoutId: "blank-titled", masterId: "none", notes: "", elements: [
                    { id: generateId("el"), type: "text", x: 40, y: 30, width: "800px", height: "60px", content: "Imported title", styles: { fontFamily: '"Arial", sans-serif', fontSize: "40px", color: "#222222" } },
                    { id: generateId("el"), type: "text", x: 40, y: 120, width: "800px", height: "200px", content: "Body", styles: { fontFamily: '"Calibri", sans-serif', fontSize: "20px", color: "#222222" } },
                ],
            });
            setCurrentSlideIndex(currentSlideIndex + 1);
            renderSlidesFromState();
            addSlide();
            const added = state.slides[currentSlideIndex];
            renderSlidesFromState();
            const footers = [...document.querySelectorAll(".slides section.present [data-footer-role], .slides section.present .master-slide-element")].length;
            return { theme: theme.headingFont, normal: normalResult, master: added.masterId, title: added.elements[0].styles.fontFamily, body: added.elements[1].styles.fontFamily, footers };
        });
        assert(result.normal.master === "content" && result.normal.title === result.theme, `a normal new slide changed: ${JSON.stringify(result.normal)}`);
        assert(result.master === "none" && result.footers === 0, `new slide after an imported one: master ${result.master}, ${result.footers} footer parts`);
        assert(/Arial/.test(result.title) && /Calibri/.test(result.body), `new slide fonts: ${result.title} / ${result.body}`);
        await page.close();
    });

    await test("style: a drawing's black strokes turn light when the deck switches to a dark theme", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(async () => {
            changePresentationTheme("editorial");
            const lib = await loadExcalidraw();
            const elements = lib.convertToExcalidrawElements([{ type: "rectangle", x: 0, y: 0, width: 160, height: 90, strokeColor: "#1e1e1e", strokeWidth: 4 }]);
            addSlide();
            const id = `el_draw_${Date.now()}`;
            const picture = await _exportDrawingPicture(lib, elements, {}, "#ffffff");
            state.slides[currentSlideIndex].elements.push({ id, type: "image", x: 200, y: 200, width: "200px", height: "130px", content: picture, excalidraw: { version: 1, elements: JSON.parse(JSON.stringify(elements)), files: {}, appState: { viewBackgroundColor: "#ffffff" } }, styles: {} });
            renderSlidesFromState();
            changePresentationTheme("graphite");
            await window.__drawingRetint;
            const el = state.slides.flatMap(s => s.elements).find(e => e.id === id);
            const img = new Image();
            img.src = el.content;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let light = 0, dark = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] < 200) continue;
                const sum = d[i] + d[i + 1] + d[i + 2];
                if (sum > 600) light++;
                if (sum < 150) dark++;
            }
            return { stroke: el.excalidraw.elements[0].strokeColor, text: PRESENTATION_THEMES.graphite.defaultTextColor, changed: el.content !== picture, light, dark };
        });
        assert(result.stroke.toLowerCase() === result.text.toLowerCase(), `stroke colour after the theme change: ${result.stroke}`);
        assert(result.changed && result.light > 100 && result.dark < result.light / 10, `picture not redrawn light: ${JSON.stringify(result)}`);
        await page.close();
    });

    await test("style: opening the timeline editor refits the slide above it", async () => {
        const { page } = await openFreshEditor(context);
        await page.locator('button[title="Animation Timeline Editor"]').click();
        await page.waitForTimeout(900);
        const r = await page.evaluate(() => {
            const rect = sel => document.querySelector(sel).getBoundingClientRect();
            return { slide: rect(".reveal").bottom, wrapper: rect("#canvas-wrapper").bottom, timeline: rect("#timeline-editor-panel").top, buttons: rect("#zoom-lens-toggle").top };
        });
        await page.evaluate(() => toggleTimelineEditor());
        assert(r.slide <= r.wrapper && r.slide <= r.timeline && r.slide <= r.buttons, `slide bottom ${Math.round(r.slide)} runs past the canvas (${Math.round(r.wrapper)}), timeline (${Math.round(r.timeline)}) or buttons (${Math.round(r.buttons)})`);
        await page.close();
    });

    await test("style: the insert toolbar's buttons sit in captioned groups and the slide starts below the bar", async () => {
        const { page } = await openFreshEditor(context);
        const r = await page.evaluate(() => {
            const bar = document.querySelector("#insert-toolbar-row .toolbar-secondary-bar");
            const groups = [...bar.querySelectorAll(".insert-group")].map(g => ({ caption: getComputedStyle(g, "::before").content.replace(/"/g, ""), buttons: g.querySelectorAll(".insert-tool-btn").length }));
            const loose = [...bar.querySelectorAll(".insert-tool-btn")].filter(b => !b.closest(".insert-group")).length;
            const symbols = bar.querySelector('button[title="Symbols"]');
            return { groups, loose, barBottom: bar.getBoundingClientRect().bottom, slideTop: document.querySelector(".reveal").getBoundingClientRect().top, overflow: bar.scrollWidth > bar.clientWidth + 1, omega: symbols.textContent.trim() };
        });
        assert(r.loose === 0, `${r.loose} insert buttons outside a captioned group`);
        assert(r.groups.length >= 5 && r.groups.every(g => g.caption && g.caption !== "none" && g.buttons > 0), `groups: ${JSON.stringify(r.groups)}`);
        assert(r.slideTop >= r.barBottom, `the slide (top ${Math.round(r.slideTop)}) starts under the insert bar (bottom ${Math.round(r.barBottom)})`);
        assert(!r.overflow, "the insert bar overflows at 1440px");
        assert(r.omega === "Ω", `Symbols button shows ${JSON.stringify(r.omega)}`);
        await page.close();
    });

    await test("style: pie slices start with distinct colours, Shrink Out is listed once, arrows are text symbols, editing tint is light", async () => {
        const { page } = await openFreshEditor(context);
        const r = await page.evaluate(async () => {
            const hue = hex => {
                const [rr, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
                const max = Math.max(rr, g, b), min = Math.min(rr, g, b), d = max - min;
                const h = max === rr ? ((g - b) / d) % 6 : max === g ? (b - rr) / d + 2 : (rr - g) / d + 4;
                return (h * 60 + 360) % 360;
            };
            const clashes = [];
            for (const themeId of Object.keys(PRESENTATION_THEMES)) {
                const colors = chartSeriesColors("pie", 2, PRESENTATION_THEMES[themeId]).backgroundColor;
                const gap = Math.abs(hue(colors[0]) - hue(colors[1]));
                if (Math.min(gap, 360 - gap) < 30) clashes.push(`${themeId}: ${colors.join(" ")}`);
            }
            const exits = getPresetsByCategory("exit").map(p => p.name);
            openSymbolPicker();
            const arrow = [...document.querySelectorAll("#symbol-grid button")].find(b => b.title === "↗").textContent;
            closeSymbolPicker();
            addSlide();
            addElement("text");
            await new Promise(res => setTimeout(res, 200));
            const editing = document.querySelector('.text-element-content[contenteditable="true"]');
            const bg = editing ? getComputedStyle(editing).backgroundColor : "";
            return { clashes, shrinkOut: exits.filter(n => n === "Shrink Out").length, arrow, bg };
        });
        assert(!r.clashes.length, `first two pie colours too alike: ${r.clashes.join("; ")}`);
        assert(r.shrinkOut === 1, `"Shrink Out" listed ${r.shrinkOut} times`);
        assert(r.arrow === "↗\uFE0E", `diagonal arrow shown as ${JSON.stringify(r.arrow)}`);
        const alpha = Number((r.bg.match(/[\d.]+\)$/) || ["1)"])[0].replace(")", ""));
        assert(r.bg && alpha <= 0.05, `edit-mode tint ${r.bg}`);
        await page.close();
    });

    await test("missing: the command palette acts on the selection (\"dup\" duplicates the selected object)", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); clearSelection(); });
        const titles = () => page.evaluate(() => [...document.querySelectorAll("#command-palette-results button span")].map(n => n.textContent));
        await page.evaluate(() => openCommandPalette());
        await page.keyboard.type("dup");
        const without = await titles();
        await page.keyboard.press("Escape");
        await page.evaluate(() => insertShapeFromPicker("star"));
        const before = await page.evaluate(() => state.slides[currentSlideIndex].elements.filter(e => e.shapeType === "star").length);
        await page.evaluate(() => openCommandPalette());
        await page.keyboard.type("dup");
        const withSelection = await titles();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
        const after = await page.evaluate(() => state.slides[currentSlideIndex].elements.filter(e => e.shapeType === "star").length);
        await page.evaluate(() => openCommandPalette());
        await page.keyboard.type("star");
        const shapes = await titles();
        await page.keyboard.press("Escape");
        assert(!without.includes("Duplicate Selection") && without.includes("Duplicate Slide"), `without a selection: ${without.join(", ")}`);
        assert(withSelection[0] === "Duplicate Selection", `with a selection the first result is ${withSelection[0]}`);
        assert(after === before + 1, `duplicating from the palette: ${before} -> ${after} stars`);
        assert(shapes.includes("Add Star"), `"star" finds ${shapes.join(", ")}`);
        await page.close();
    });

    await test("missing: equations, icons and HTML embeds are placed where they cover the least, not at a fixed spot", async () => {
        const { page } = await openFreshEditor(context);
        const r = await page.evaluate(async () => {
            addSlide();
            addChart("bar");
            const overlap = (a, b) => {
                const box = e => ({ x: Number(e.x), y: Number(e.y), w: parseFloat(e.width) || 0, h: parseFloat(e.height) || 60 });
                const p = box(a), q = box(b);
                return Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
            };
            const slide = () => state.slides[currentSlideIndex];
            const chart = slide().elements.find(e => e.type === "chart");
            const equationModal = document.getElementById("equation-input") || document.querySelector("#equation-modal textarea");
            openEquationModal();
            const ta = document.querySelector("#equation-modal textarea");
            ta.value = "E = mc^2";
            ta.dispatchEvent(new Event("input"));
            document.querySelector("#equation-modal").querySelector("button.equation-insert-btn, button[onclick*='insertEquation']")?.click();
            await new Promise(r => setTimeout(r, 300));
            const equation = slide().elements.find(e => e.type === "equation");
            _insertIcon({ class: "fa-solid fa-star" });
            const icon = slide().elements.find(e => e.iconMode);
            return { equation: equation && overlap(equation, chart), icon: icon && overlap(icon, chart), hasEquation: !!equation, iconAt: icon && [icon.x, icon.y] };
        });
        assert(r.hasEquation, "no equation was inserted");
        assert(r.equation === 0, `the new equation covers the chart (${r.equation} px²)`);
        assert(r.icon === 0, `the new icon covers the chart (${r.icon} px², at ${r.iconAt})`);
        await page.close();
    });

    await test("missing: Video URL asks in the app's own dialog, not the browser's prompt box", async () => {
        const { page } = await openFreshEditor(context);
        let nativeDialogs = 0;
        page.on("dialog", () => nativeDialogs++);
        await page.evaluate(() => addSlide());
        await page.locator('button[title="Video URL"]').click();
        await page.waitForSelector(".sf-prompt", { timeout: 3000 });
        const focused = await page.evaluate(() => document.activeElement?.classList.contains("sf-prompt__field"));
        await page.keyboard.type("https://example.com/clip.mp4");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(400);
        const videos = await page.evaluate(() => state.slides[currentSlideIndex].elements.filter(e => e.type === "video").map(e => e.content));
        await page.locator('button[title="Video URL"]').click();
        await page.waitForSelector(".sf-prompt");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => ({ open: !!document.querySelector(".sf-prompt"), count: state.slides[currentSlideIndex].elements.filter(e => e.type === "video").length }));
        assert(nativeDialogs === 0, `${nativeDialogs} browser prompt boxes opened`);
        assert(focused, "the address field does not have focus");
        assert(videos.length === 1 && videos[0] === "https://example.com/clip.mp4", `videos added: ${JSON.stringify(videos)}`);
        assert(!after.open && after.count === 1, `Escape: ${JSON.stringify(after)}`);
        await page.close();
    });

    await test("missing: a PDF note is written in the app's own dialog", async () => {
        const { page } = await openFreshEditor(context);
        let nativeDialogs = 0;
        page.on("dialog", () => nativeDialogs++);
        const id = await page.evaluate(() => {
            addSlide();
            const el = { id: generateId("el"), type: "pdf", content: "/media/assets/missing-for-test.pdf", x: 200, y: 200, width: "500px", height: "300px",
                pdfInteractive: true, pdfEditorMode: "note", pdfAnnotations: [], pdfSelectedAnnotationId: "", styles: { zIndex: 5 } };
            state.slides[currentSlideIndex].elements.push(el);
            renderSlidesFromState();
            return el.id;
        });
        const layer = page.locator(`.slides [id="${id}"] .pdf-annotation-layer`);
        const box = await layer.boundingBox();
        await page.mouse.click(box.x + 80, box.y + 60);
        await page.waitForSelector(".sf-prompt", { timeout: 3000 });
        await page.keyboard.type("Check this figure");
        await page.keyboard.press("Control+Enter");
        await page.waitForTimeout(300);
        const notes = await page.evaluate(id => state.slides[currentSlideIndex].elements.find(e => e.id === id).pdfAnnotations.map(a => [a.type, a.text]), id);
        assert(nativeDialogs === 0, `${nativeDialogs} browser prompt boxes opened`);
        assert(JSON.stringify(notes) === JSON.stringify([["note", "Check this figure"]]), `notes: ${JSON.stringify(notes)}`);
        await page.close();
    });

    await test("missing: a list can reveal its bullets one click at a time while presenting", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => {
            addSlide();
            const body = state.slides[currentSlideIndex].elements.find(e => e.placeholderRole === "content");
            body.content = [{ html: "First", level: 0 }, { html: "detail", level: 1 }, { html: "Second", level: 0 }];
            delete body.textDocument;
            renderSlidesFromState();
            selectElement(body.id, "replace");
            buildPropertiesPanel();
        });
        await page.waitForTimeout(200);
        const optionShown = await page.evaluate(() => !!document.getElementById("prop-reveal-bullets"));
        await page.evaluate(() => { const box = document.getElementById("prop-reveal-bullets"); box.checked = true; box.dispatchEvent(new Event("change")); });
        await page.evaluate(() => { addSlide(); setCurrentSlideIndex(currentSlideIndex - 1); Reveal.slide(currentSlideIndex); });
        const startSlide = await page.evaluate(() => currentSlideIndex);
        await page.evaluate(() => togglePlayMode());
        await page.waitForTimeout(1200);
        const visible = () => page.evaluate(() => [...document.querySelectorAll(".slides section.present .ppt-bullet-row")].map(r => Number(getComputedStyle(r).opacity) > 0.5 ? 1 : 0).join(""));
        const steps = [await visible()];
        for (let i = 0; i < 2; i++) {
            await page.evaluate(() => presentationNextStep());
            await page.waitForTimeout(600);
            steps.push(await visible());
        }
        await page.evaluate(() => presentationPrevStep());
        await page.waitForTimeout(300);
        steps.push(await visible());
        await page.evaluate(() => { presentationNextStep(); presentationNextStep(); });
        await page.waitForTimeout(800);
        const advanced = await page.evaluate(() => currentSlideIndex);
        await page.evaluate(() => togglePlayMode());
        await page.waitForTimeout(800);
        const editorRows = await page.evaluate(() => [...document.querySelectorAll(".slides .ppt-bullet-row")].every(r => Number(getComputedStyle(r).opacity) > 0.5));
        assert(optionShown, "no 'Reveal bullets one by one' option for a list");
        assert(JSON.stringify(steps) === JSON.stringify(["000", "110", "111", "110"]), `bullets shown per step: ${steps.join(" → ")}`);
        assert(advanced === startSlide + 1, `the slide did not advance after the last bullet (${startSlide} → ${advanced})`);
        assert(editorRows, "bullets stay hidden in the editor after presenting");
        await page.close();
    });

    await test("missing: hovering an animation in the picker previews it", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); insertShapeFromPicker("rectangle"); openAnimationPresetSelector(state.selectedIds[0]); });
        await page.waitForTimeout(300);
        const card = page.locator('.preset-card[data-preset-id="slideInUp"]');
        await card.hover();
        await page.waitForTimeout(200);
        const playing = await page.evaluate(() => {
            const box = document.querySelector('.preset-card[data-preset-id="slideInUp"] .preset-preview-box');
            const anim = box.getAnimations()[0];
            const frames = anim?.effect?.getKeyframes() || [];
            return { count: box.getAnimations().length, from: frames[0]?.opacity, to: frames.at(-1)?.opacity, moves: /translate\(0px, 18px\)/.test(frames[0]?.transform || "") };
        });
        await page.mouse.move(5, 5);
        await page.waitForTimeout(200);
        const stopped = await page.evaluate(() => document.querySelector('.preset-card[data-preset-id="slideInUp"] .preset-preview-box').getAnimations().length);
        await page.evaluate(() => closeAnimationPresetSelector());
        assert(playing.count === 1 && Number(playing.from) === 0 && Number(playing.to) === 1 && playing.moves, `preview of Slide In Up: ${JSON.stringify(playing)}`);
        assert(stopped === 0, "the preview keeps playing after the pointer leaves");
        await page.close();
    });

    await test("missing: tidying a slide says what it did and how, and offers Undo", async () => {
        const { page } = await openFreshEditor(context);
        await page.route("**/api/slides/cleanup/", route => route.abort());
        const r = await page.evaluate(async () => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements.push({ id: `el_tidy_${Date.now()}`, type: "shape", shapeType: "rectangle", x: 433, y: 203, width: "150px", height: "150px", styles: {} });
            renderSlidesFromState();
            const before = JSON.stringify(slide.elements.map(e => [e.x, e.y]));
            state.selectedIds = [];
            await aiCleanUpSlide();
            const toast = document.getElementById("sf-cleanup-summary");
            const text = toast?.textContent || "";
            toast?.querySelector("button")?.click();
            await new Promise(res => setTimeout(res, 200));
            const after = JSON.stringify(state.slides[currentSlideIndex].elements.map(e => [e.x, e.y]));
            return { text, restored: before === after, title: document.querySelector('button[onclick="aiCleanUpSlide()"]').getAttribute("aria-label") };
        });
        assert(/Tidied \d+ object/.test(r.text) && /layout rules/.test(r.text) && /Undo/.test(r.text), `summary: ${JSON.stringify(r.text)}`);
        assert(r.restored, "Undo in the summary did not restore the slide");
        assert(!/AI/.test(r.title), `button still called ${r.title}`);
        await page.close();
    });

    await test("missing: the quick-actions panel names what each button does (none claims to generate)", async () => {
        const { page } = await openFreshEditor(context);
        const labels = await page.evaluate(() => [...document.querySelectorAll(".ai-dock-actions button")].map(b => [b.textContent.trim(), b.getAttribute("onclick")]));
        const expect = { "openCommandPalette()": /command/i, "openEquationModal()": /equation/i, "openMermaidDialog()": /flowchart/i, "aiCleanUpSlide()": /tidy/i };
        labels.forEach(([text, action]) => {
            assert(!/generate|explain/i.test(text), `"${text}" promises something it does not do`);
            if (expect[action]) assert(expect[action].test(text), `"${text}" does not say what ${action} does`);
        });
        assert(labels.length === 4, `buttons: ${JSON.stringify(labels)}`);
        await page.close();
    });

    await test("missing: during a show, moving the pointer brings up the presentation menu button; it fades when still", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => togglePlayMode());
        await page.waitForTimeout(1200);
        await page.mouse.move(600, 400);
        await page.mouse.move(640, 420);
        await page.waitForTimeout(400);
        const shown = await page.evaluate(() => { const b = document.getElementById("present-menu-toggle"); const r = b.getBoundingClientRect(); return { w: r.width, op: getComputedStyle(b.closest(".presentation-menu-shell")).opacity }; });
        await page.locator("#present-menu-toggle").click();
        await page.waitForTimeout(200);
        const items = await page.evaluate(() => [...document.querySelectorAll("#present-menu:not(.hidden) .presentation-menu-item span")].map(n => n.textContent));
        await page.locator("#present-menu-toggle").click();
        await page.waitForTimeout(3000);
        const later = await page.evaluate(() => getComputedStyle(document.querySelector(".presentation-menu-shell")).opacity);
        await page.evaluate(() => { if (document.body.classList.contains("play-mode-active")) togglePlayMode(); });
        assert(shown.w > 20 && Number(shown.op) > 0.9, `menu button while the pointer moves: ${JSON.stringify(shown)}`);
        assert(items.some(t => /Exit/.test(t)), `menu items: ${items.join(", ")}`);
        assert(Number(later) < 0.1, `menu button still showing after the pointer stopped (opacity ${later})`);
        await page.close();
    });

    await test("missing: shapes hold text: typed on double-click, styled in Properties, kept in SVG and PowerPoint export", async () => {
        const { page } = await openFreshEditor(context);
        let sent = null;
        await page.route("**/api/presentations/export/pptx/", route => {
            sent = JSON.parse(route.request().postData() || "{}");
            route.fulfill({ status: 500, body: "{}" });
        });
        const center = await page.evaluate(() => {
            addSlide();
            insertShapeFromPicker("rectangle");
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === state.selectedIds[0]);
            el.width = "300px"; el.height = "150px"; el.styles.backgroundColor = "#1d4ed8";
            renderSlidesFromState();
            const n = [...document.querySelectorAll(`[id="${el.id}"]`)].find(x => !x.closest("#slide-previews"));
            const r = n.getBoundingClientRect();
            return [r.x + r.width / 2, r.y + r.height / 2];
        });
        await page.mouse.dblclick(center[0], center[1]);
        await page.waitForTimeout(200);
        await page.keyboard.type("Native state");
        await page.mouse.click(1350, 650);
        await page.waitForTimeout(400);
        const typed = await page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.shapeText);
            const n = el && [...document.querySelectorAll(`[id="${el.id}"]`)].find(x => !x.closest("#slide-previews"));
            const t = n?.querySelector(".sf-shape-text");
            const box = n?.getBoundingClientRect(), tb = t?.querySelector(".sf-shape-text__content")?.getBoundingClientRect();
            return { id: el?.id, text: el?.shapeText, color: t && getComputedStyle(t).color, inside: !!(box && tb && tb.left >= box.left && tb.right <= box.right && tb.top >= box.top && tb.bottom <= box.bottom) };
        });
        assert(typed.text === "Native state", `typed text: ${JSON.stringify(typed)}`);
        assert(typed.color === "rgb(255, 255, 255)" && typed.inside, `shape text on a dark fill: ${JSON.stringify(typed)}`);
        await page.evaluate(id => { selectElement(id, "replace"); if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click(); buildPropertiesPanel(); }, typed.id);
        await page.waitForTimeout(300);
        await page.evaluate(() => { const t = document.querySelector('.properties-tab[data-properties-tab="content"]'); t?.click(); });
        await page.waitForTimeout(200);
        await page.fill("#prop-shape-text-size", "32");
        await page.press("#prop-shape-text-size", "Enter");
        await page.waitForTimeout(250);
        await page.locator('#prop-shape-text-valign button[data-value="bottom"]').click();
        await page.waitForTimeout(250);
        const styled = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            return el.shapeTextStyle;
        }, typed.id);
        assert(styled?.fontSize === "32px" && styled?.verticalAlign === "bottom", `panel styling: ${JSON.stringify(styled)}`);
        const svg = await page.evaluate(async () => {
            const scene = compileSlideForgeRenderScene({ profile: "publication" });
            const { SvgRenderer } = await import("./js/rendering/renderers/SvgRenderer.js");
            return SvgRenderer.renderSlide(scene.slides[currentSlideIndex], scene);
        });
        assert(/<tspan[^>]*>Native state<\/tspan>/.test(svg), "SVG export lacks the shape text");
        await page.evaluate(() => exportPPTX());
        await page.waitForTimeout(800);
        const shape = sent?.state?.slides?.flatMap(s => s.elements).find(e => e.shapeText === "Native state");
        assert(shape?.shapeTextStyle?.color === "#ffffff" && shape.shapeTextStyle.fontSize === "32px", `PowerPoint request: ${JSON.stringify(shape?.shapeTextStyle)}`);
        await page.close();
    });

    await test("review: the exported HTML viewer shows a 16:9 deck whole, not cut to a 4:3 frame", async () => {
        const { page } = await openFreshEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const JSZip = require("jszip");
        const pageSize = await page.evaluate(() => {
            const slide = state.slides[0];
            const title = slide.elements.find(e => e.placeholder === "Click to add title");
            title.content = "A wide title that runs right across the slide";
            delete title.textDocument;
            renderSlidesFromState();
            return getPresentationPageSetupConfig();
        });
        assert(pageSize.width === 1280 && pageSize.height === 720, `setup: new deck is ${JSON.stringify(pageSize)}`);
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 240000 }), page.evaluate(() => exportZip())]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-viewer-"));
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        await Promise.all(Object.values(zip.files).filter(f => !f.dir).map(async f => {
            const target = path.join(dir, f.name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, await f.async("nodebuffer"));
        }));
        const viewer = await context.newPage();
        await viewer.setViewportSize({ width: 1440, height: 900 });
        await viewer.goto("file://" + path.join(dir, "index.html"));
        await viewer.waitForTimeout(2000);
        const frame = await viewer.evaluate(() => {
            const width = getComputedStyle(document.documentElement).getPropertyValue("--slide-width").trim();
            const height = getComputedStyle(document.documentElement).getPropertyValue("--slide-height").trim();
            const r = document.getElementById("slides-container").getBoundingClientRect();
            return { width, height, ratio: r.width / r.height };
        });
        assert(frame.width === "1280px" && frame.height === "720px", `viewer slide size: ${JSON.stringify(frame)}`);
        assert(Math.abs(frame.ratio - 16 / 9) < 0.02, `viewer frame ratio ${frame.ratio.toFixed(3)}, want 16:9`);
        await viewer.close();
        await page.close();
    });

    await test("style: round 3: readable chart text, clear equation preview, true fill swatch, theme in the palette, chart toolbar, thumbnail menu", async () => {
        const { page } = await openFreshEditor(context);
        // Chart text big enough to read when projected.
        const chartId = await page.evaluate(() => { addSlide(); addChart("bar"); return state.selectedIds[0]; });
        const font = await page.evaluate(id => buildChartJsConfig(state.slides[currentSlideIndex].elements.find(e => e.id === id)).options.scales.x.ticks.font.size, chartId);
        assert(font >= 16, `new chart text is ${font}px`);
        // A selected chart offers "Edit data".
        await page.evaluate(id => { selectElement(id, "replace"); updateFloatingToolbars(); }, chartId);
        await page.locator("#floating-chart-toolbar").waitFor({ state: "visible", timeout: 3000 });
        await page.locator("#floating-chart-edit-data").click();
        await page.locator(".chart-editor-grid").waitFor({ state: "visible", timeout: 3000 });
        // "Edit data" puts the caret in the first label (on the next frame).
        await page.waitForFunction(() => document.activeElement?.matches?.(".chart-editor-grid .chart-row-label"), null, { timeout: 3000 });
        // A see-through fill shows its colour in the swatch, not black.
        const swatch = await page.evaluate(() => _normalizeColorForInput("rgba(255, 255, 255, 0.06)", "#000000"));
        assert(swatch === "#ffffff", `swatch for a white tint: ${swatch}`);
        // The equation dialog's preview is drawn in the preview's dark ink at full size.
        await page.evaluate(() => openEquationModal());
        const field = page.locator("#equation-input");
        await field.fill("E = mc^2");
        await page.waitForFunction(() => document.querySelector(".equation-preview .katex"), null, { timeout: 10000 });
        const preview = await page.evaluate(() => { const k = document.querySelector(".equation-preview .katex"); return k && { color: getComputedStyle(k).color, size: parseFloat(getComputedStyle(k).fontSize) }; });
        assert(preview && preview.color !== "rgb(148, 163, 184)" && preview.size > 16, `equation preview: ${JSON.stringify(preview)}`);
        await page.keyboard.press("Escape");
        await page.evaluate(() => (typeof closeEquationModal === "function" ? closeEquationModal() : document.querySelector("#equation-modal [data-close], #equation-modal .equation-secondary-action")?.click()));
        // The command palette finds the themes and slide sizes.
        await page.keyboard.press("Escape");
        await page.mouse.click(5, 500);
        await page.keyboard.press("Control+k");
        await page.keyboard.type("theme sage");
        await page.waitForTimeout(200);
        const found = await page.evaluate(() => commandPaletteResults.map(c => c.title));
        assert(found.includes("Theme: Sage Calm"), `palette for "theme sage": ${JSON.stringify(found)}`);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
        assert(await page.evaluate(() => state.presentationTheme) === "sage", "the palette's theme command did not change the theme");
        await page.keyboard.press("Control+k");
        await page.keyboard.type("slide size");
        await page.waitForTimeout(200);
        const sizes = await page.evaluate(() => commandPaletteResults.map(c => c.title));
        assert(sizes.includes("Slide Size: Classic 4:3") && sizes.includes("Slide Size: Talk 16:9"), `palette for "slide size": ${JSON.stringify(sizes)}`);
        await page.keyboard.press("Escape");
        // Right-clicking a thumbnail opens the slide commands; Move down moves it.
        const before = await page.evaluate(() => state.slides.map(s => s.id));
        await page.locator("#slide-previews > *").nth(0).click({ button: "right" });
        await page.locator("#slide-preview-menu").waitFor({ state: "visible", timeout: 3000 });
        const labels = await page.locator("#slide-preview-menu button").allInnerTexts();
        assert(JSON.stringify(labels.map(l => l.trim())) === JSON.stringify(["New slide after", "Duplicate", "Move up", "Move down", "Delete"]), `menu: ${JSON.stringify(labels)}`);
        await page.locator("#slide-preview-menu button", { hasText: "Move down" }).click();
        const after = await page.evaluate(() => state.slides.map(s => s.id));
        assert(after[0] === before[1] && after[1] === before[0] && !(await page.locator("#slide-preview-menu").count()), `after Move down: ${JSON.stringify({ before, after })}`);
        await page.close();
    });

    await test("review: after a theme change, preset slides (also edited ones) take the new background and their text stays readable", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(async () => {
            changePresentationTheme("graphite");
            insertPresetSlide("talk-key-message");
            insertPresetSlide("lecture-concept");
            // An edited preset slide: one more text box, so it can no longer be rebuilt from its preset.
            const edited = state.slides[currentSlideIndex];
            edited.elements.push({ id: generateId("el"), type: "text", x: 80, y: 600, width: "300px", height: "40px", content: "My note", styles: { color: getPresentationTheme().defaultTextColor, fontSize: "18px", zIndex: 90 } });
            renderSlidesFromState();
            changePresentationTheme("sage");
            renderSlidesFromState();
            const sage = getPresentationTheme("sage");
            const palette = _modernPalette(sage);
            const lum = c => {
                const m = String(c).match(/[\d.]+/g).map(Number);
                const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
            };
            const toRgb = hex => { const h = hex.replace("#", ""); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
            return state.slides.map((slide, index) => {
                const bg = slide.elements.find(e => e.presetBackground);
                const root = document.querySelector(`#slides-container .presentation-slide[data-slide-index="${index}"]`);
                const title = [...root.querySelectorAll(".text-element-content")].find(n => /One Slide|Core Concept|Slide Title|Click to add title/.test(n.innerText || n.dataset.placeholder || ""));
                const footer = slide.elements.find(e => e.footerRole && e.type === "text");
                const titleColor = title && getComputedStyle(title).color;
                const canvas = toRgb(palette.canvas);
                const contrast = titleColor ? (Math.max(lum(titleColor), lum(canvas)) + 0.05) / (Math.min(lum(titleColor), lum(canvas)) + 0.05) : null;
                return { layout: slide.layoutId, bgColor: bg?.styles.backgroundColor, bgOk: !bg || (bg.styles.backgroundColor === palette.canvas && bg.styles.background === palette.canvasBackground), contrast: contrast && Math.round(contrast * 10) / 10, footer: footer?.styles?.color };
            });
        });
        result.forEach(slide => {
            assert(slide.bgOk, `${slide.layout}: background after the theme change is ${slide.bgColor}`);
            assert(slide.contrast === null || slide.contrast >= 4.5, `${slide.layout}: title contrast ${slide.contrast} on the new background`);
        });
        assert(result.some(s => s.layout === "lecture-concept") && result.some(s => s.layout === "talk-key-message"), JSON.stringify(result));
        await page.close();
    });

    await test("review: a list with bullet-by-bullet reveal and a fade comes in with its first bullet, then a bullet per click", async () => {
        const { page } = await openFreshEditor(context);
        const id = await page.evaluate(() => {
            addSlide();
            const body = state.slides[currentSlideIndex].elements.find(e => e.placeholder === "Click to add text");
            body.content = [{ text: "First point", level: 0 }, { text: "Detail of first", level: 1 }, { text: "Second point", level: 0 }, { text: "Third point", level: 0 }];
            delete body.textDocument;
            body.revealBullets = true;
            renderSlidesFromState();
            applyAnimationPreset(body.id, "fadeIn");
            state.selectedIds = [];
            renderSlidesFromState();
            return body.id;
        });
        const visible = () => page.evaluate(id => {
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            const shown = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.5) return false; } return true; };
            return [...node.querySelectorAll(".ppt-bullet-row")].map(r => (shown(r) ? "1" : "0")).join("");
        }, id);
        await page.locator("#btn-present").click();
        await page.waitForTimeout(1500);
        const seq = [await visible()];
        for (let k = 0; k < 3; k++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(900); seq.push(await visible()); }
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(500);
        seq.push(await visible());
        await page.keyboard.press("Escape");
        await page.waitForTimeout(800);
        assert(JSON.stringify(seq) === JSON.stringify(["0000", "1100", "1110", "1111", "1110"]), `bullets shown per click: ${JSON.stringify(seq)}`);
        await page.close();
    });

    await test("qa: slide size 16:9 -> 4:3 -> 16:9 gives the same layout; an object moved in between keeps its move", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { addSlide(); addChart("bar"); addElement("table"); state.selectedIds = []; renderSlidesFromState(); });
        await page.waitForTimeout(500);
        const geo = () => page.evaluate(() => state.slides.flatMap((s, i) => s.elements.map(e => `s${i + 1} ${e.type}${e.footerRole ? ":" + e.footerRole : ""} ${[Math.round(e.x), Math.round(e.y), Math.round(parseFloat(e.width)), Math.round(parseFloat(e.height)) || 0].join(",")}`)));
        const before = await geo();
        await page.evaluate(() => applyPresentationPageSetup("standard-4-3"));
        await page.waitForTimeout(600);
        const narrow = await geo();
        await page.evaluate(() => applyPresentationPageSetup("talk-16-9"));
        await page.waitForTimeout(600);
        const after = await geo();
        assert(JSON.stringify(narrow) !== JSON.stringify(before), "setup: 4:3 did not change the layout");
        const moved = before.filter((line, i) => line !== after[i]).map((line, i) => `${line} -> ${after[before.indexOf(line)]}`);
        assert(!moved.length, `objects not back in place: ${JSON.stringify(moved.slice(0, 4))}`);
        // An object the user moves at 4:3 is scaled from where they put it, not put back.
        const chartX = await page.evaluate(async () => {
            applyPresentationPageSetup("standard-4-3");
            await new Promise(r => setTimeout(r, 300));
            const chart = state.slides[1].elements.find(e => e.type === "chart");
            chart.x += 150;
            renderSlidesFromState();
            const at43 = chart.x;
            applyPresentationPageSetup("talk-16-9");
            await new Promise(r => setTimeout(r, 300));
            return { at43, back: state.slides[1].elements.find(e => e.type === "chart").x };
        });
        const original = Number(before.find(line => line.startsWith("s2 chart")).split(" ")[2].split(",")[0]);
        assert(chartX.back > original + 100, `moved chart was put back: ${JSON.stringify({ original, ...chartX })}`);
        await page.close();
    });

    await test("qa2: timeline: a click opens an animation's settings, playback shows its time, Stop restores the slide, slides are followed", async () => {
        const { page } = await openFreshEditor(context);
        const ids = await page.evaluate(() => {
            addSlide();
            const s = state.slides[currentSlideIndex];
            s.elements = s.elements.filter(e => e.placeholder !== "Click to add text");
            const mk = x => { insertShapeFromPicker("rectangle"); const el = s.elements.find(e => e.id === state.selectedIds[0]); Object.assign(el, { x, y: 300, width: "160px", height: "100px" }); return el.id; };
            const a = mk(200), c = mk(600);
            renderSlidesFromState();
            applyAnimationPreset(a, "fadeIn");
            applyAnimationPreset(c, "slideInUp");
            state.selectedIds = [];
            renderSlidesFromState();
            return { a, c };
        });
        await page.locator("#toggle-timeline-editor").click();
        await page.waitForTimeout(500);
        // A plain click: the inspector opens and no undo step is taken.
        const depth = await page.evaluate(() => undoStack.length);
        const bb = await page.locator(".animation-block").nth(1).boundingBox();
        await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.waitForTimeout(300);
        const clicked = await page.evaluate(() => ({ delayField: !!document.getElementById("prop-anim-delay"), undo: undoStack.length }));
        assert(clicked.delayField && clicked.undo === depth, `click on a block: ${JSON.stringify({ ...clicked, before: depth })}`);
        // The inspector edits the animation.
        await page.locator("#prop-anim-delay").fill("300");
        await page.locator("#prop-anim-delay").press("Tab");
        await page.waitForTimeout(300);
        const delay = await page.evaluate(id => state.slides[currentSlideIndex].elements.find(e => e.id === id).animation.timelines[0].animations[0].delay, ids.c);
        assert(delay === 300, `delay set in the inspector: ${delay}`);
        // Playback shows its time; Stop puts the slide back.
        await page.locator("#timeline-play").click();
        await page.waitForTimeout(400);
        const during = await page.evaluate(() => Number(document.getElementById("timeline-current-time").value));
        await page.waitForTimeout(900);
        await page.locator("#timeline-stop").click();
        await page.waitForTimeout(300);
        const after = await page.evaluate(ids => Object.values(ids).map(id => { const n = document.querySelector(`#slides-container [id="${id}"]`); return { op: getComputedStyle(n).opacity, extra: n.style.transform.replace(/^translate\([^)]*\)\s*/, "") }; }), ids);
        assert(during > 0, `time shown during playback: ${during}`);
        assert(after.every(o => o.op === "1" && !o.extra), `objects after Stop: ${JSON.stringify(after)}`);
        // Another slide: its own (empty) timeline.
        await page.locator("#slide-previews > *").first().click();
        await page.waitForTimeout(500);
        const other = await page.evaluate(() => ({ tracks: document.querySelectorAll(".timeline-track").length, text: document.getElementById("timeline-tracks-list").innerText }));
        assert(other.tracks === 0 && /No animations/.test(other.text), `timeline on a slide without animations: ${JSON.stringify(other)}`);
        await page.locator("#slide-previews > *").nth(1).click();
        await page.waitForTimeout(500);
        assert((await page.evaluate(() => document.querySelectorAll(".timeline-track").length)) === 2, "timeline did not come back for the animated slide");
        await page.close();
    });

    await test("qa2: the Rotation field turns the object, and the turn survives a drag, a nudge and a redraw", async () => {
        const { page } = await openFreshEditor(context);
        const id = await page.evaluate(() => { addSlide(); insertShapeFromPicker("rectangle"); return state.selectedIds[0]; });
        await page.evaluate(() => { if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click(); buildPropertiesPanel(); });
        await page.locator('.properties-tab[data-properties-tab="overview"]').click();
        await page.locator("#prop-geom-rot").fill("45");
        await page.locator("#prop-geom-rot").press("Enter");
        await page.waitForTimeout(300);
        const turn = () => page.evaluate(id => {
            const n = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            const m = getComputedStyle(n).transform.match(/matrix\(([^)]+)\)/);
            const [a, b] = m ? m[1].split(",").map(Number) : [1, 0];
            return Math.round((Math.atan2(b, a) * 180) / Math.PI);
        }, id);
        assert((await turn()) === 45, `drawn turn after the field: ${await turn()}`);
        const box = await page.locator(`#slides-container [id="${id}"]`).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
        const during = await turn();
        await page.mouse.up();
        await page.waitForTimeout(300);
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(200);
        const afterNudge = await turn();
        await page.evaluate(() => renderSlidesFromState());
        assert(during === 45 && afterNudge === 45 && (await turn()) === 45, `turn while dragging ${during}, after a nudge ${afterNudge}, after a redraw ${await turn()}`);
        await page.close();
    });

    await test("qa: rough edges: the Layout tab stays open when slides are added; Ctrl+G groups; a JSON export carries the deck's name", async () => {
        const { page } = await openFreshEditor(context);
        const fs = require("fs");
        // The Properties tab.
        await page.evaluate(() => { state.selectedIds = []; renderSlidesFromState(); if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click(); buildPropertiesPanel(); });
        await page.locator('.properties-tab[data-properties-tab="layout"]').click();
        const tab = () => page.evaluate(() => document.querySelector('.properties-tab[aria-selected="true"]')?.dataset.propertiesTab);
        await page.locator("#properties-content button", { hasText: /^New$/ }).first().click();
        await page.waitForTimeout(600);
        const afterNew = await tab();
        await page.locator(".new-slide-btn").click();
        await page.waitForTimeout(600);
        assert(afterNew === "layout" && (await tab()) === "layout", `tab after adding slides: ${afterNew}, ${await tab()}`);
        // Selecting an object and letting go of it still returns to Base.
        await page.evaluate(() => { insertShapeFromPicker("rectangle"); });
        await page.waitForTimeout(300);
        await page.evaluate(() => { clearSelection(); buildPropertiesPanel(); });
        assert((await tab()) === "overview", `tab after deselecting an object: ${await tab()}`);
        // Ctrl+G / Ctrl+Shift+G.
        const ids = await page.evaluate(() => { const s = state.slides[currentSlideIndex]; const out = []; [[200, 250], [500, 300]].forEach(([x, y]) => { insertShapeFromPicker("rectangle"); const el = s.elements.find(e => e.id === state.selectedIds[0]); Object.assign(el, { x, y }); out.push(el.id); }); renderSlidesFromState(); setSelectedIds(out); return out; });
        const grouped = () => page.evaluate(ids => state.slides[currentSlideIndex].elements.filter(e => ids.includes(e.id)).map(e => e.groupId || null), ids);
        await page.mouse.move(700, 500);
        await page.keyboard.press("Control+g");
        await page.waitForTimeout(250);
        const g = await grouped();
        assert(g[0] && g[0] === g[1], `after Ctrl+G: ${JSON.stringify(g)}`);
        await page.keyboard.press("Control+Shift+G");
        await page.waitForTimeout(250);
        assert((await grouped()).every(v => !v), `after Ctrl+Shift+G: ${JSON.stringify(await grouped())}`);
        // JSON export.
        await page.evaluate(() => setCurrentPresentationTitle("Named deck: results"));
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.evaluate(() => exportPresentationJson())]);
        const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
        assert(exported.title === "Named deck: results" && Array.isArray(exported.slides), `exported JSON title: ${JSON.stringify(exported.title)}`);
        await page.close();
    });

    await test("qa: a picture inserted after an equation is not placed on top of it", async () => {
        const { page } = await openFreshEditor(context);
        const overlap = await page.evaluate(async () => {
            addSlide();
            addEquationElement("K_d = \\frac{[P][L]}{[PL]}");
            await new Promise(r => setTimeout(r, 300));
            const place = _getImageInsertPlacement(640, 400);
            const eq = state.slides[currentSlideIndex].elements.find(e => e.type === "equation");
            const node = [...document.querySelectorAll(`[id="${eq.id}"]`)].find(n => !n.closest("#slide-previews"));
            const a = { x: eq.x, y: eq.y, w: node.offsetWidth, h: node.offsetHeight };
            const w = Math.min(place.x + parseFloat(place.width), a.x + a.w) - Math.max(place.x, a.x);
            const h = Math.min(place.y + parseFloat(place.height), a.y + a.h) - Math.max(place.y, a.y);
            return { covered: w > 0 && h > 0 ? Math.round((100 * w * h) / (a.w * a.h)) : 0, place: [place.x, place.y, place.width, place.height], eq: a };
        });
        assert(overlap.covered === 0, `the picture covers ${overlap.covered}% of the equation: ${JSON.stringify(overlap)}`);
        await page.close();
    });

    await test("qa: PDF export draws text where the editor shows it, on a page the size of the slide", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => {
            const title = state.slides[0].elements.find(e => e.placeholder === "Click to add title");
            title.content = "PDF offset check";
            delete title.textDocument;
            state.selectedIds = [];
            renderSlidesFromState();
        });
        await page.waitForTimeout(400);
        const result = await page.evaluate(() => withUnzoomedSlides(async () => {
            const setup = getExportPageSetup();
            const slide = getActiveExportSlideElement();
            const text = slide.querySelector(".text-element-content");
            const range = document.createRange();
            range.selectNodeContents(text);
            const box = slide.getBoundingClientRect();
            const r = range.getBoundingClientRect();
            const restoreUi = hideExportEditorUi();
            let canvas;
            try { canvas = await captureSlideCanvas(slide, setup, 1); } finally { restoreUi(); }
            const ctx = canvas.getContext("2d");
            const x0 = Math.round(r.left - box.left), x1 = Math.round(r.right - box.left);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const dark = y => { let n = 0; for (let x = x0; x < x1; x += 1) { const i = (y * canvas.width + x) * 4; if (data[i] + data[i + 1] + data[i + 2] < 300) n += 1; } return n; };
            const rows = [];
            const from = Math.max(0, Math.round(r.top - box.top) - 60), to = Math.min(canvas.height, Math.round(r.bottom - box.top) + 60);
            for (let y = from; y < to; y += 1) if (dark(y) > 2) rows.push(y);
            const pdf = createExportPdf(setup);
            return {
                domCentre: (r.top + r.bottom) / 2 - box.top,
                drawnCentre: rows.length ? (rows[0] + rows[rows.length - 1]) / 2 : null,
                pagePt: [Math.round(pdf.internal.pageSize.getWidth() * pdf.internal.scaleFactor), Math.round(pdf.internal.pageSize.getHeight() * pdf.internal.scaleFactor)],
                slide: [setup.width, setup.height],
            };
        }));
        assert(result.drawnCentre !== null, "no title ink found in the capture");
        assert(Math.abs(result.drawnCentre - result.domCentre) <= 5, `title drawn ${Math.round(result.drawnCentre - result.domCentre)}px off: ${JSON.stringify(result)}`);
        assert(result.pagePt[0] === Math.round(result.slide[0] * 0.75) && result.pagePt[1] === Math.round(result.slide[1] * 0.75), `PDF page ${result.pagePt} pt for a ${result.slide} px slide`);
        await page.close();
    });

    if (!FRONTEND_ONLY) {
        await test("qa: Create link makes a local link only; a public tunnel starts when the user asks for it", async () => {
            const { page } = await openFreshEditor(context);
            const posts = [];
            // The desktop app with cloudflared installed, without ever starting a real tunnel.
            await page.route("**/api/share/tunnel/", route => {
                const request = route.request();
                if (request.method() === "POST") posts.push(JSON.parse(request.postData() || "{}").action);
                const running = posts.includes("start");
                route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, installable: false, installing: false, running, url: null, error: "" }) });
            });
            await page.evaluate(async () => { await autosavePresentationNow(); });
            await page.locator("#btn-share").click();
            await page.locator('#share-modal [data-share="create"]').click();
            await page.waitForFunction(() => /\/s\/[\w-]+\/$/.test(document.getElementById("share-link-input")?.value || ""), null, { timeout: 30000 });
            await page.waitForTimeout(600);
            const desktop = await page.locator('#share-modal [data-share="tunnel-start"]').count();
            assert(!posts.includes("start"), `Create link started a tunnel by itself: ${JSON.stringify(posts)}`);
            if (desktop) {
                await page.locator('#share-modal [data-share="tunnel-start"]').click();
                await page.waitForTimeout(400);
                assert(posts.includes("start"), "the button did not start the tunnel");
            }
            await page.locator('#share-modal [data-share="stop"]').click();
            await page.waitForTimeout(400);
            await page.close();
        });
    }

    await test("qa: undoing a theme change brings back the slide background too, not only the text colours", async () => {
        const { page } = await openFreshEditor(context);
        const look = () => page.evaluate(() => {
            const slide = document.querySelector('#slides-container .presentation-slide[data-slide-index="0"]');
            return { theme: state.presentationTheme, applied: document.body.dataset.presentationTheme, bg: getComputedStyle(slide).backgroundImage.match(/rgb\([^)]*\)/g)?.slice(-1)[0] };
        });
        const before = await look();
        await page.evaluate(() => changePresentationTheme("graphite"));
        await page.waitForTimeout(300);
        const changed = await look();
        await page.mouse.click(5, 500);
        await page.keyboard.press("Control+z");
        await page.waitForTimeout(500);
        const undone = await look();
        await page.keyboard.press("Control+y");
        await page.waitForTimeout(500);
        const redone = await look();
        assert(changed.bg !== before.bg && changed.applied === "graphite", `setup: ${JSON.stringify({ before, changed })}`);
        assert(undone.theme === before.theme && undone.applied === before.theme && undone.bg === before.bg, `after undo: ${JSON.stringify(undone)}, before ${JSON.stringify(before)}`);
        assert(redone.applied === "graphite" && redone.bg === changed.bg, `after redo: ${JSON.stringify(redone)}`);
        await page.close();
    });

    await test("review: in the shared/exported viewer a text box shows no hover frame, focus ring or text cursor", async () => {
        const { page } = await openFreshEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const JSZip = require("jszip");
        await page.evaluate(() => {
            const title = state.slides[0].elements.find(e => e.placeholder === "Click to add title");
            title.content = "Shared deck title";
            delete title.textDocument;
            renderSlidesFromState();
        });
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 240000 }), page.evaluate(() => exportZip())]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-viewer-hover-"));
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        await Promise.all(Object.values(zip.files).filter(f => !f.dir).map(async f => {
            const target = path.join(dir, f.name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, await f.async("nodebuffer"));
        }));
        const viewer = await context.newPage();
        await viewer.setViewportSize({ width: 1440, height: 900 });
        await viewer.goto("file://" + path.join(dir, "index.html"));
        await viewer.waitForTimeout(1500);
        const content = viewer.locator(".presentation-slide.is-active .text-element-content", { hasText: "Shared deck title" }).first();
        const box = await content.boundingBox();
        const look = () => content.evaluate(node => {
            const host = node.closest(".canvas-element");
            const cs = getComputedStyle(host);
            return { outline: cs.outlineStyle, shadow: cs.boxShadow, cursor: getComputedStyle(node).cursor, hovered: host.matches(":hover") };
        });
        await viewer.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await viewer.waitForTimeout(250);
        const hover = await look();
        await viewer.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await viewer.waitForTimeout(250);
        const click = await look();
        await viewer.close();
        await page.close();
        for (const [name, seen] of [["hover", hover], ["click", click]]) {
            assert(seen.outline === "none" && seen.shadow === "none" && seen.cursor === "default", `${name}: ${JSON.stringify(seen)}`);
        }
        assert(hover.hovered, "setup: the text box was not under the pointer");
    });

    await test("review: the HTML viewer waits for clicks: preset click animations and bullet-by-bullet reveal", async () => {
        const { page } = await openFreshEditor(context);
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const JSZip = require("jszip");
        const ids = await page.evaluate(() => {
            const slide = state.slides[0];
            slide.elements = slide.elements.filter(e => !e.placeholder);
            addSlide();
            const s = state.slides[currentSlideIndex];
            const body = s.elements.find(e => e.placeholder === "Click to add text");
            body.content = [{ text: "First point", level: 0 }, { text: "Detail of first", level: 1 }, { text: "Second point", level: 0 }];
            delete body.textDocument;
            body.revealBullets = true;
            insertShapeFromPicker("star");
            const star = state.selectedIds[0];
            renderSlidesFromState();
            applyAnimationPreset(star, "fadeIn");
            state.selectedIds = [];
            renderSlidesFromState();
            return { body: body.id, star };
        });
        const [download] = await Promise.all([page.waitForEvent("download", { timeout: 240000 }), page.evaluate(() => exportZip())]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-viewer-anim-"));
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        await Promise.all(Object.values(zip.files).filter(f => !f.dir).map(async f => {
            const target = path.join(dir, f.name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, await f.async("nodebuffer"));
        }));
        const viewer = await context.newPage();
        await viewer.setViewportSize({ width: 1440, height: 900 });
        await viewer.goto("file://" + path.join(dir, "index.html"));
        await viewer.waitForTimeout(1500);
        const look = () => viewer.evaluate(ids => {
            const shown = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.5) return false; } return true; };
            const rows = [...(document.getElementById(ids.body)?.querySelectorAll(".ppt-bullet-row") || [])].map(r => (shown(r) ? "1" : "0")).join("");
            return `${rows}|star=${shown(document.getElementById(ids.star)) ? 1 : 0}`;
        }, ids);
        await viewer.keyboard.press("ArrowRight");
        await viewer.waitForTimeout(900);
        const seq = [await look()];
        for (let k = 0; k < 3; k++) { await viewer.keyboard.press("ArrowRight"); await viewer.waitForTimeout(900); seq.push(await look()); }
        await viewer.close();
        await page.close();
        assert(JSON.stringify(seq) === JSON.stringify(["000|star=0", "110|star=0", "111|star=0", "111|star=1"]), `viewer steps: ${JSON.stringify(seq)}`);
    });

    await test("review: a bullet style set on a new slide's list survives going back into the box and changing the font", async () => {
        const { page } = await openFreshEditor(context);
        const show = async sel => {
            for (const t of ["content", "style", "base"]) {
                await page.evaluate(t => document.querySelector(`.properties-tab[data-properties-tab="${t}"]`)?.click(), t);
                await page.waitForTimeout(120);
                if (await page.locator(sel).isVisible().catch(() => false)) return;
            }
        };
        await page.evaluate(() => { if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click(); });
        await page.mouse.click(700, 870);
        await page.keyboard.press("Control+m");
        await page.waitForTimeout(700);
        const id = await page.evaluate(() => state.slides[currentSlideIndex].elements.find(e => e.placeholder === "Click to add text")?.id);
        const box = page.locator(`#slides-container [id="${id}"] .text-element-content`);
        await box.click();
        await page.waitForTimeout(150);
        await box.click();
        await page.waitForTimeout(150);
        await page.keyboard.type("Alpha");
        await page.keyboard.press("Enter");
        await page.keyboard.type("Beta");
        await page.keyboard.press("Enter");
        await page.keyboard.type("Gamma");
        await page.waitForTimeout(200);
        await page.keyboard.press("Control+A");
        await page.waitForTimeout(200);
        await show("#prop-list-style");
        await page.locator("#prop-list-style").click();
        await page.waitForTimeout(200);
        await page.locator(".sf-select-menu__option", { hasText: "Star" }).first().click();
        await page.waitForTimeout(400);
        // Leave the box, go back into it, then pick a font in Properties.
        await page.mouse.click(700, 870);
        await page.waitForTimeout(300);
        await box.click();
        await page.waitForTimeout(300);
        const drawnOnReentry = await page.evaluate(id => { const n = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews")); return `${n.querySelector("[data-bullet-style]")?.dataset.bulletStyle}|editing=${n.classList.contains("editing-text")}`; }, id);
        await show("#prop-font");
        await page.locator("#prop-font").click();
        await page.locator(".sf-select-menu__option", { hasText: "Lora" }).first().click();
        await page.waitForTimeout(300);
        await page.mouse.click(700, 870);
        await page.waitForTimeout(300);
        const after = await page.evaluate(id => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            return { stored: el.bulletStyle, drawn: node.querySelector("[data-bullet-style]")?.dataset.bulletStyle, font: el.styles.fontFamily };
        }, id);
        assert(drawnOnReentry === "star|editing=true", `bullets drawn when editing again: ${drawnOnReentry}`);
        assert(after.stored === "star" && after.drawn === "star" && /Lora/.test(after.font), `after the font change: ${JSON.stringify(after)}`);
        await page.close();
    });

    await test("review: Properties dropdowns open an in-app list and keep focus after a choice (arrow keys keep working)", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { state.selectedIds = []; renderSlidesFromState(); if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click(); buildPropertiesPanel(); });
        await page.waitForTimeout(400);
        // A click opens the app's own list (the native list lagged in the desktop app).
        const prevented = await page.evaluate(() => {
            const select = document.getElementById("prop-global-theme");
            let defaultPrevented = null;
            const spy = event => { defaultPrevented = event.defaultPrevented; };
            document.addEventListener("mousedown", spy);
            const r = select.getBoundingClientRect();
            select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: r.left + 5, clientY: r.top + 5 }));
            document.removeEventListener("mousedown", spy);
            return { defaultPrevented, menu: document.querySelectorAll(".sf-select-menu__option").length };
        });
        assert(prevented.defaultPrevented === true && prevented.menu === 17, `opening the theme dropdown: ${JSON.stringify(prevented)}`);
        await page.locator(".sf-select-menu__option", { hasText: "Horizon" }).click();
        await page.waitForTimeout(300);
        const picked = await page.evaluate(() => ({ theme: state.presentationTheme, focus: document.activeElement?.id, open: !!document.querySelector(".sf-select-menu") }));
        assert(picked.theme === "horizon" && picked.focus === "prop-global-theme" && !picked.open, `after choosing: ${JSON.stringify(picked)}`);
        // The panel rebuilds on each change; focus stays, so a second arrow press goes on from the first.
        const order = await page.evaluate(() => Object.keys(PRESENTATION_THEMES));
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(250);
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(250);
        const stepped = await page.evaluate(() => ({ theme: state.presentationTheme, focus: document.activeElement?.id }));
        assert(stepped.theme === order[order.indexOf("horizon") + 2] && stepped.focus === "prop-global-theme", `arrow keys: ${JSON.stringify(stepped)}`);
        // Escape closes the list without a change.
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
        const escaped = await page.evaluate(() => ({ theme: state.presentationTheme, open: !!document.querySelector(".sf-select-menu") }));
        assert(escaped.theme === stepped.theme && !escaped.open, `Escape: ${JSON.stringify(escaped)}`);
        await page.close();
    });

    await test("review: round 4: every preset can be picked, previews show the layouts, themes have a gallery, labels read", async () => {
        const { page } = await openFreshEditor(context);
        await page.evaluate(() => { changePresentationTheme("buttercup"); state.selectedIds = []; renderSlidesFromState(); });
        await page.evaluate(() => { if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click(); buildPropertiesPanel(); });
        await page.locator('.properties-tab[data-properties-tab="layout"]').click();
        const layout = await page.evaluate(() => ({
            options: document.querySelectorAll("#properties-content select option[value='section-divider'], #properties-content select option[value='thank-you'], #properties-content select option[value='agenda']").length,
            groups: [...document.querySelectorAll("#properties-content optgroup")].map(g => g.label),
            total: Object.keys(SLIDE_PRESETS).length,
            listed: [...document.querySelectorAll("#properties-content optgroup option")].length,
        }));
        assert(layout.options === 3 && layout.listed === layout.total && layout.groups.includes("Talks") && layout.groups.includes("Narrative"), `layout dropdown: ${JSON.stringify(layout)}`);
        await page.evaluate(() => { document.querySelector("#properties-content details")?.setAttribute("open", ""); });
        await page.selectOption("#preset-category-filter", "all");
        await page.waitForTimeout(300);
        const cards = await page.evaluate(() => {
            const all = [...document.querySelectorAll("#preset-slides-list .preset-card")];
            const table = all.find(c => /Method Table|Option comparison|comparison/i.test(c.getAttribute("onclick") || ""));
            return { count: all.length, withSvg: all.filter(c => c.querySelector(".preset-preview svg rect")).length, tableRects: table?.querySelectorAll("svg rect, svg line").length || 0, total: Object.keys(SLIDE_PRESETS).length };
        });
        assert(cards.count === cards.total && cards.withSvg === cards.total && cards.tableRects > 8, `preset picker: ${JSON.stringify(cards)}`);
        // The theme gallery in Global Settings.
        await page.locator('.properties-tab[data-properties-tab="overview"]').click().catch(() => {});
        await page.waitForTimeout(200);
        const swatches = await page.locator(".sf-theme-swatch").count();
        assert(swatches === 17, `theme gallery swatches: ${swatches}`);
        await page.locator('.sf-theme-swatch[data-theme-id="tidepool"]').click();
        await page.waitForTimeout(300);
        assert(await page.evaluate(() => state.presentationTheme) === "tidepool", "clicking a theme swatch did not apply it");
        // Preset contents: an arrow (not a cross) in Lecture Concept, a labelled placeholder in Talk Title, readable labels.
        const built = await page.evaluate(() => {
            const theme = getPresentationTheme("buttercup");
            const concept = SLIDE_PRESETS["lecture-concept"].build(theme);
            const title = SLIDE_PRESETS["talk-title"].build(theme);
            const keyMessage = SLIDE_PRESETS["talk-key-message"].build(theme);
            const label = keyMessage.find(e => e.type === "text" && /Evidence/.test(String(e.content)));
            const lum = hex => { const h = hex.replace("#", ""); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(parseInt(h.slice(0, 2), 16)) + 0.7152 * f(parseInt(h.slice(2, 4), 16)) + 0.0722 * f(parseInt(h.slice(4, 6), 16)); };
            const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
            const bottom = Math.max(...keyMessage.filter(e => !e.presetBackground && e.type === "shape").map(e => Number(e.y) + parseFloat(e.height)));
            return {
                arrow: concept.some(e => e.shapeType === "arrow-down"),
                crossBars: concept.filter(e => e.type === "shape" && (parseFloat(e.width) <= 6 || parseFloat(e.height) <= 6) && Number(e.y) > 280 && Number(e.y) < 400).length,
                placeholder: title.some(e => e.type === "text" && /Logo or hero image/.test(String(e.content))),
                labelContrast: Math.round(contrast(label.styles.color, "#FFFFFF") * 100) / 100,
                bottom,
            };
        });
        assert(built.arrow && built.crossBars === 0, `Lecture Concept mechanism: ${JSON.stringify(built)}`);
        assert(built.placeholder, "Talk Title has no labelled placeholder");
        assert(built.labelContrast >= 4.5, `Buttercup "Evidence" label contrast ${built.labelContrast}`);
        assert(built.bottom >= 600, `Talk Key Message content ends at y=${built.bottom} of 768`);
        await page.close();
    });

    await test("review: a line chart is drawn full size again after presenting and pressing Escape", async () => {
        const { page } = await openFreshEditor(context);
        const id = await page.evaluate(() => { addSlide(); addChart("line"); const id = state.selectedIds[0]; state.selectedIds = []; renderSlidesFromState(); return id; });
        await page.waitForTimeout(600);
        const size = () => page.evaluate(id => {
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            const canvas = node.querySelector("canvas");
            const style = getComputedStyle(node);
            const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            return { canvas: canvas.clientWidth, box: Math.round(width) };
        }, id);
        await page.locator("#btn-present").click();
        await page.waitForTimeout(1500);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1500);
        const after = await size();
        assert(Math.abs(after.canvas - after.box) <= 2, `line chart after the show: ${after.canvas}px wide in a ${after.box}px box`);
        await page.close();
    });

    await test("review: a preset table on a dark theme has no white box behind its see-through cells", async () => {
        const { page } = await openFreshEditor(context);
        const behind = await page.evaluate(() => {
            changePresentationTheme("horizon");
            insertPresetSlide("comparison-table");
            renderSlidesFromState();
            const el = state.slides[currentSlideIndex].elements.find(e => e.type === "table");
            const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find(x => !x.closest("#slide-previews"));
            const cell = node.querySelectorAll(".table-element-cell")[5];
            for (let n = cell; n && n !== node.parentElement; n = n.parentElement) {
                const parts = (getComputedStyle(n).backgroundColor.match(/[\d.]+/g) || []).map(Number);
                if (parts.length === 3 || parts[3] >= 0.5) return getComputedStyle(n).backgroundColor;
            }
            return null;
        });
        assert(behind === null, `opaque background behind a body cell: ${behind}`);
        await page.close();
    });

    await test("review: changing the slide size rebuilds preset slides with their own text in place, without overlaps", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(async () => {
            changePresentationTheme("horizon");
            insertPresetSlide("talk-key-message");
            insertPresetSlide("poster-conference");
            state.slides.splice(0, 1);
            const posterSlide = state.slides[1];
            // A user's edit in the poster title survives the rebuild.
            const title = posterSlide.elements.find(e => e.type === "text" && /Conference Poster Title/.test(JSON.stringify(e.content)));
            title.content = "Folding kinetics of BPTI";
            delete title.textDocument;
            setCurrentSlideIndex(1);
            renderSlidesFromState();
            const fontOf = text => {
                const el = state.slides[1].elements.find(e => e.type === "text" && JSON.stringify(e.content).includes(text));
                return el ? parseFloat(el.styles.fontSize) : null;
            };
            const before = fontOf("Folding kinetics");
            applyPresentationPageSetup("standard-4-3");
            await new Promise(r => setTimeout(r, 400));
            const talk = state.slides[0].elements.filter(e => e.type === "text" && !e.footerRole).map(e => (Array.isArray(e.content) ? e.content.map(c => c.text).join("/") : String(e.content)).slice(0, 30));
            // Text boxes in the poster at 4:3 must not overlap each other.
            setCurrentSlideIndex(1); Reveal.slide(1); renderSlidesFromState();
            await new Promise(r => setTimeout(r, 300));
            const root = document.querySelector('#slides-container .presentation-slide[data-slide-index="1"]');
            const boxes = [...root.querySelectorAll(".canvas-element")].map(n => ({ n, c: n.querySelector(".text-element-content") })).filter(x => x.c && x.c.innerText.trim())
                // Where the words themselves are drawn (a text box can be taller than its text).
                .map(x => { const range = document.createRange(); range.selectNodeContents(x.c); const r = range.getBoundingClientRect(); return { t: x.c.innerText.trim().slice(0, 24), l: r.left, r: r.right, top: r.top, b: r.bottom }; });
            const overlaps = [];
            boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
                if (a.l < b.r - 1 && b.l < a.r - 1 && a.top < b.b - 1 && b.top < a.b - 1) overlaps.push(`${a.t} / ${b.t}`);
            }));
            const footers = state.slides.map(s => s.elements.filter(e => e.footerRole).length);
            applyPresentationPageSetup("poster-portrait");
            await new Promise(r => setTimeout(r, 400));
            return { talk, overlaps, footers, before, poster: fontOf("Folding kinetics"), kept: !!fontOf("Folding kinetics") };
        });
        assert(result.talk[0] === "TALK" && result.talk[1] === "One Slide, One Message", `talk slide texts after 4:3: ${JSON.stringify(result.talk)}`);
        assert(!result.overlaps.length, `overlapping text in the 4:3 poster: ${JSON.stringify(result.overlaps)}`);
        assert(result.footers.every(n => n > 0), `footers after the rebuild: ${JSON.stringify(result.footers)}`);
        assert(result.kept && result.poster > result.before * 1.2, `poster title text: ${JSON.stringify(result)}`);
        await page.close();
    });

    await test("review: opening the chart editor does not pull the caret back from a dialog opened right after it", async () => {
        const { page } = await openFreshEditor(context);
        const focus = await page.evaluate(async () => {
            addSlide();
            addChart("bar");
            const id = state.selectedIds[0];
            openChartEditor(id);
            openEquationModal();
            document.getElementById("equation-input").focus();
            // Any focus the chart grid takes from here on would swallow what the user types into the dialog.
            const stolen = [];
            const watch = e => { if (e.target.closest?.(".chart-editor-grid")) stolen.push(e.target.className); };
            document.addEventListener("focusin", watch, true);
            await new Promise(resolve => setTimeout(resolve, 150));
            document.removeEventListener("focusin", watch, true);
            closeEquationModal();
            return stolen;
        });
        assert(!focus.length, `the chart grid took the caret from the dialog: ${JSON.stringify(focus)}`);
        await page.close();
    });

    await test("review: a connector attached to a star or circle ends on its outline, not on the corner of its box", async () => {
        const { page } = await openFreshEditor(context);
        const ends = await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            const make = (type, x, y) => {
                insertShapeFromPicker(type);
                const el = slide.elements.find(e => e.id === state.selectedIds[0]);
                Object.assign(el, { x, y, width: "160px", height: "160px" });
                return el;
            };
            const star = make("star", 600, 300);
            const circle = make("circle", 200, 100);
            addConnector("line");
            const c = slide.elements.find(e => e.id === state.selectedIds[0]);
            // Start on the circle's bottom-right corner of its box (45°), end on the star's left middle.
            c.connectorBindings = { start: { id: circle.id, fx: 1, fy: 1 }, end: { id: star.id, fx: 0, fy: 0.5 } };
            renderSlidesFromState();
            const pts = getConnectorPoints(c).map(p => ({ x: c.x + p.x, y: c.y + p.y }));
            // Where the user drops it: the snap preview lands on the outline too.
            const snap = getConnectorSnapTarget({ x: 604, y: 381 }, c.id);
            return { start: pts[0], end: pts[pts.length - 1], snap };
        });
        // Star outline at the centre line: 23.7 % in from the left of its box.
        assert(Math.abs(ends.end.x - 638) <= 1.5 && Math.abs(ends.end.y - 380) <= 1, `end on the star: ${JSON.stringify(ends.end)}`);
        // Circle: centre (280, 180), radius 80, at 45°.
        assert(Math.abs(ends.start.x - (280 + 80 * Math.SQRT1_2)) <= 1.5 && Math.abs(ends.start.y - (180 + 80 * Math.SQRT1_2)) <= 1.5, `start on the circle: ${JSON.stringify(ends.start)}`);
        assert(ends.snap && Math.abs(ends.snap.x - 638) <= 1.5, `snap preview: ${JSON.stringify(ends.snap)}`);
        await page.close();
    });

    await test("review: a table's columns fill its box: a new table shows its last column whole, and resizing keeps it so", async () => {
        const { page } = await openFreshEditor(context);
        const id = await page.evaluate(() => { addSlide(); addElement("table"); return state.selectedIds[0]; });
        const measure = () => page.evaluate(id => {
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            const box = node.getBoundingClientRect();
            const cells = [...node.querySelectorAll("tr:first-child .table-element-cell")].map(c => c.getBoundingClientRect());
            return { boxRight: box.right, lastRight: cells[cells.length - 1].right, firstWidth: cells[0].width, scale: getCanvasScale(), width: state.slides[currentSlideIndex].elements.find(e => e.id === id).width };
        }, id);
        const fresh = await measure();
        assert(fresh.lastRight <= fresh.boxRight + 1, `new table: last column ends ${Math.round(fresh.lastRight - fresh.boxRight)}px past its box`);
        // A narrower box: the columns narrow with it.
        await page.evaluate(id => { updateElementState(id, { width: "380px" }); renderSlidesFromState(); }, id);
        const narrow = await measure();
        assert(narrow.lastRight <= narrow.boxRight + 1 && Math.abs(narrow.firstWidth / narrow.scale - 95) < 3, `380px box: ${JSON.stringify(narrow)}`);
        // The column-width field shows the drawn width and a new value widens the box by the difference.
        await page.evaluate(id => {
            selectElement(id, "replace");
            setSelectedTablePart(id, { type: "col", col: 0 });
            if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click();
            buildPropertiesPanel();
        }, id);
        await page.locator('.properties-tab[data-properties-tab="content"]').click().catch(() => {});
        const field = page.locator("#prop-table-col-width");
        await field.waitFor({ state: "visible" });
        const shown = Number(await field.inputValue());
        assert(Math.abs(shown - 95) <= 1, `column width field shows ${shown}, drawn 95`);
        await field.fill("195");
        await field.press("Enter");
        await page.waitForTimeout(300);
        const wider = await measure();
        assert(Math.abs(parseFloat(wider.width) - 480) <= 2 && wider.lastRight <= wider.boxRight + 1, `after a 195px first column: ${JSON.stringify(wider)}`);
        await page.close();
    });

    await test("review: an equation takes the new theme's text colour when the theme changes", async () => {
        const { page } = await openFreshEditor(context);
        const result = await page.evaluate(() => {
            changePresentationTheme("afterglow");
            addSlide();
            addEquationElement("\\Delta G = \\Delta H - T\\Delta S");
            const id = state.selectedIds[0];
            const before = state.slides[currentSlideIndex].elements.find(e => e.id === id).styles.color;
            changePresentationTheme("sage");
            renderSlidesFromState();
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            return { before, after: el.styles.color, want: getPresentationTheme("sage").defaultTextColor, drawn: getComputedStyle(node.querySelector(".katex") || node).color };
        });
        assert(result.before === "#F5F7FF" || result.before.toLowerCase() === "#f5f7ff", `setup: equation on Afterglow is ${result.before}`);
        assert(result.after === result.want, `equation colour after the theme change: ${JSON.stringify(result)}`);
        await page.close();
    });

    await test("review: in a show, double-clicking a text box, shape text or table selects nothing and shows no text cursor", async () => {
        const { page } = await openFreshEditor(context);
        const ids = await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            insertShapeFromPicker("rectangle");
            const s = slide.elements.find(e => e.id === state.selectedIds[0]);
            Object.assign(s, { x: 120, y: 260, width: "240px", height: "120px", shapeText: "Shape words" });
            addElement("text");
            const t = slide.elements.find(e => e.id === state.selectedIds[0]);
            Object.assign(t, { x: 460, y: 260, content: "Body text box" });
            delete t.textDocument;
            addElement("table");
            const tb = slide.elements.find(e => e.id === state.selectedIds[0]);
            Object.assign(tb, { x: 760, y: 420 });
            tb.tableData.cells[1][0].text = "Cell words";
            renderSlidesFromState();
            return { s: s.id, t: t.id, tb: tb.id };
        });
        await page.evaluate(() => togglePlayMode());
        await page.waitForTimeout(1500);
        const probe = async (id, selector) => {
            const point = await page.evaluate(([id, selector]) => {
                const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
                const target = node.querySelector(selector);
                const r = (target || node).getBoundingClientRect();
                return [r.left + Math.min(30, r.width / 2), r.top + Math.min(r.height / 2, 30)];
            }, [id, selector]);
            await page.mouse.dblclick(point[0], point[1]);
            await page.waitForTimeout(200);
            return page.evaluate(([x, y]) => {
                const under = document.elementFromPoint(x, y);
                const text = String(getSelection());
                getSelection().removeAllRanges();
                return { selected: text, cursor: getComputedStyle(under).cursor, under: under.className };
            }, point);
        };
        for (const [name, id, selector] of [["text box", ids.t, ".text-element-content"], ["shape text", ids.s, ".sf-shape-text__content"], ["table cell", ids.tb, ".table-element-cell"]]) {
            const result = await probe(id, selector);
            assert(result.selected === "" && result.cursor !== "text", `${name} in a show: ${JSON.stringify(result)}`);
        }
        await page.evaluate(() => togglePlayMode());
        await page.close();
    });

    await test("missing: connector ends dropped on shapes attach and follow the shapes when they move", async () => {
        const { page, errors } = await openFreshEditor(context);
        const ids = await page.evaluate(() => {
            addSlide();
            const slide = state.slides[currentSlideIndex];
            slide.elements = slide.elements.filter(e => !e.placeholder);
            const make = (x, y) => {
                insertShapeFromPicker("rectangle");
                const el = slide.elements.find(e => e.id === state.selectedIds[0]);
                Object.assign(el, { x, y, width: "160px", height: "100px" });
                return el.id;
            };
            const a = make(120, 200);
            const b = make(620, 380);
            addConnector("line");
            const c = state.selectedIds[0];
            renderSlidesFromState();
            selectElement(c, "replace");
            return { a, b, c };
        });
        const canvasNode = id => `#slides-container [id="${id}"]`;
        const toScreen = (x, y) => page.evaluate(([x, y]) => {
            const slide = document.querySelector(`#slides-container .presentation-slide[data-slide-index="${currentSlideIndex}"]`);
            const r = slide.getBoundingClientRect();
            const s = getCanvasScale();
            return [r.left + x * s, r.top + y * s];
        }, [x, y]);
        const dragHandle = async (index, x, y) => {
            const box = await page.locator(`${canvasNode(ids.c)} .connector-point-handle[data-index="${index}"]`).boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            const [tx, ty] = await toScreen(x, y);
            await page.mouse.move(tx, ty, { steps: 6 });
            await page.mouse.up();
            await page.waitForTimeout(150);
        };
        // Start over shape A's right side, end near shape B's left middle.
        await dragHandle(0, 270, 240);
        await page.evaluate(id => selectElement(id, "replace"), ids.c);
        await dragHandle(1, 612, 425);
        const ends = () => page.evaluate(id => {
            const c = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            const pts = getConnectorPoints(c).map(p => ({ x: c.x + p.x, y: c.y + p.y }));
            return { start: pts[0], end: pts[pts.length - 1], bindings: c.connectorBindings || null };
        }, ids.c);
        const attached = await ends();
        assert(attached.bindings?.start?.id === ids.a && attached.bindings?.end?.id === ids.b, `bindings: ${JSON.stringify(attached)}`);
        // Near a side's middle the end snaps to it.
        assert(attached.start.x === 280 && attached.start.y === 250 && attached.end.x === 620 && attached.end.y === 430, `ends on the shapes' edges: ${JSON.stringify(attached)}`);

        // Drag shape B down and right with the mouse: the arrow's end goes with it.
        await page.evaluate(() => { state.selectedIds = []; renderSlidesFromState(); });
        const [bx, by] = await toScreen(700, 430);
        const [bx2, by2] = await toScreen(760, 490);
        await page.mouse.move(bx, by);
        await page.mouse.down();
        await page.mouse.move(bx2, by2, { steps: 8 });
        const live = await page.evaluate(id => {
            const node = document.querySelector(`#slides-container [id="${id}"]`);
            return parseFloat(node.getAttribute("data-x"));
        }, ids.c);
        await page.mouse.up();
        await page.waitForTimeout(200);
        const followed = await ends();
        const shapeB = await page.evaluate(id => { const e = state.slides[currentSlideIndex].elements.find(x => x.id === id); return { x: e.x, y: e.y }; }, ids.b);
        assert(shapeB.x > 650, `shape B did not move: ${JSON.stringify(shapeB)}`);
        assert(followed.end.x === shapeB.x && followed.end.y === shapeB.y + 50, `arrow end after the drag: ${JSON.stringify({ followed, shapeB })}`);
        assert(Number.isFinite(live), "connector DOM missing during the drag");

        // Typing a new X for shape A moves the arrow's start too.
        await page.evaluate(id => { updateElementState(id, { x: 60 }); renderSlidesFromState(); }, ids.a);
        const typed = await ends();
        assert(typed.start.x === 220 && typed.start.y === 250, `arrow start after X changed: ${JSON.stringify(typed)}`);

        // Arrow keys move shape A and the arrow's start with it.
        await page.evaluate(id => { selectElement(id, "replace"); nudgeSelectedElements(10, 0); }, ids.a);
        const nudged = await ends();
        assert(nudged.start.x === 230, `arrow start after a nudge: ${JSON.stringify(nudged)}`);
        await page.evaluate(id => { selectElement(id, "replace"); nudgeSelectedElements(-10, 0); }, ids.a);

        // Duplicating both shapes and the arrow: the copy is attached to the copies.
        const copy = await page.evaluate(ids => {
            setSelectedIds([ids.a, ids.b, ids.c]);
            duplicateSelectedElements();
            const slide = state.slides[currentSlideIndex];
            const newIds = [...state.selectedIds];
            const c = slide.elements.find(e => newIds.includes(e.id) && e.type === "connector");
            const result = { bindings: c.connectorBindings, newIds };
            slide.elements = slide.elements.filter(e => !newIds.includes(e.id)); // the copies would cover the original
            return result;
        }, ids);
        assert(copy.newIds.includes(copy.bindings?.start?.id) && copy.newIds.includes(copy.bindings?.end?.id), `duplicate's bindings: ${JSON.stringify(copy)}`);

        // Dragging the connector itself away frees its ends.
        await page.evaluate(id => { selectElement(id, "replace"); renderSlidesFromState(); selectElement(id, "replace"); }, ids.c);
        const mid = await page.evaluate(id => {
            const c = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            const pts = getConnectorPoints(c);
            return { x: c.x + (pts[0].x + pts[1].x) / 2, y: c.y + (pts[0].y + pts[1].y) / 2 };
        }, ids.c);
        const [mx, my] = await toScreen(mid.x, mid.y);
        const [mx2, my2] = await toScreen(mid.x, mid.y + 120);
        await page.mouse.move(mx, my);
        await page.mouse.down();
        await page.mouse.move(mx2, my2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        const freed = await ends();
        assert(!freed.bindings && freed.start.y > 300, `connector after being dragged away: ${JSON.stringify(freed)}`);
        assert(!errors.length, errors.join("; "));
        await page.close();
    });

    await test("missing: tables on a dark theme sit on its card with light text, and follow theme changes", async () => {
        const { page } = await openFreshEditor(context);
        const cellColors = () => page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.type === "table");
            const node = [...document.querySelectorAll(`[id="${el.id}"]`)].find(x => !x.closest("#slide-previews"));
            const cells = node.querySelectorAll(".table-element-cell");
            const body = cells[cells.length - 1];
            // What shows behind the cell's words: the first opaque background up the tree (a white table grid
            // under a see-through cell made light text on white).
            let behind = null;
            for (let n = body; n && n !== node.parentElement; n = n.parentElement) {
                const m = getComputedStyle(n).backgroundColor.match(/rgba?\(([^)]+)\)/);
                const parts = m ? m[1].split(",").map(Number) : [];
                if (parts.length === 3 || parts[3] >= 0.5) { behind = getComputedStyle(n).backgroundColor; break; }
            }
            return { bg: getComputedStyle(body).backgroundColor, behind, color: getComputedStyle(body).color, data: { body: el.tableData.bodyFill, text: el.tableData.textColor } };
        });
        await page.evaluate(() => {
            changePresentationTheme("graphite");
            addSlide();
            addElement("table");
        });
        await page.waitForTimeout(300);
        const dark = await cellColors();
        const graphite = await page.evaluate(() => getPresentationTheme("graphite"));
        // On the dark theme: not a white block, and the words are the theme's light text.
        assert(dark.data.body === graphite.surfaceColor && dark.behind === null, `dark-theme cell fill: ${JSON.stringify(dark)}`);
        assert(dark.data.text === graphite.defaultTextColor, `dark-theme cell text: ${JSON.stringify(dark)}`);
        await page.evaluate(() => { changePresentationTheme("porcelain"); renderSlidesFromState(); });
        await page.waitForTimeout(300);
        const light = await cellColors();
        assert(light.bg === "rgb(255, 255, 255)" && light.color === "rgb(23, 32, 51)", `light-theme cell after the change: ${JSON.stringify(light)}`);
        // A table made while every theme got white tables darkens when the deck moves to a dark theme.
        const old = await page.evaluate(() => {
            const el = state.slides[currentSlideIndex].elements.find(e => e.type === "table");
            Object.assign(el.tableData, { headerFill: "#e2e8f0", bodyFill: "#ffffff", altFill: "#f8fafc", borderColor: "#cbd5e1", textColor: "#172033", headerTextColor: "#172033" });
            changePresentationTheme("chalkboard");
            return { body: el.tableData.bodyFill, text: el.tableData.textColor, want: getPresentationTheme("chalkboard") };
        });
        assert(old.body === old.want.surfaceColor && old.text === old.want.defaultTextColor, `white table on a dark theme change: ${JSON.stringify(old)}`);
        await page.close();
    });

    await test("missing: charts take several series with their own colours, axis titles, and sit on the theme's card", async () => {
        const { page } = await openFreshEditor(context);
        let sent = null;
        await page.route("**/api/presentations/export/pptx/", route => {
            sent = JSON.parse(route.request().postData() || "{}");
            route.fulfill({ status: 500, body: "{}" });
        });
        const id = await page.evaluate(() => {
            changePresentationTheme("graphite");
            addSlide();
            addChart("bar");
            const id = state.selectedIds[0];
            selectElement(id, "replace");
            if (document.getElementById("properties-panel")?.classList.contains("hidden")) document.querySelector('button[title="Show Properties"]')?.click();
            buildPropertiesPanel();
            return id;
        });
        const chartOf = () => page.evaluate(id => state.slides[currentSlideIndex].elements.find(e => e.id === id), id);
        const dark = await chartOf();
        const graphiteCard = await page.evaluate(() => getPresentationTheme("graphite").surfaceColor);
        // A dark theme's chart is not a white card, and its words are light (they sit on the dark slide).
        assert(dark.styles.backgroundColor === graphiteCard, `chart card on a dark theme: ${dark.styles.backgroundColor}`);
        const ink = await page.evaluate(id => ({
            got: buildChartJsConfig(state.slides[currentSlideIndex].elements.find(e => e.id === id)).options.scales.x.ticks.color,
            want: getPresentationTheme("graphite").defaultTextColor,
        }), id);
        assert(ink.got === ink.want, `chart ink on a dark theme: ${JSON.stringify(ink)}`);
        await page.evaluate(() => document.querySelector('.properties-tab[data-properties-tab="content"]')?.click());
        await page.waitForTimeout(200);
        await page.locator("#prop-chart-add-series").click();
        await page.waitForTimeout(300);
        await page.locator('.chart-row-value[data-row="0"][data-series="1"]').fill("7");
        await page.locator('.chart-row-value[data-row="0"][data-series="1"]').press("Tab");
        await page.waitForTimeout(250);
        await page.evaluate(() => {
            const pick = document.querySelectorAll(".chart-series-color")[1];
            pick.value = "#dc2626";
            pick.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.waitForTimeout(300);
        await page.locator('.properties-tab[data-properties-tab="style"]').click();
        await page.locator("#prop-chart-x-title").waitFor({ state: "visible" });
        await page.fill("#prop-chart-x-title", "Month");
        await page.press("#prop-chart-x-title", "Tab");
        await page.selectOption("#prop-chart-legend", "bottom");
        await page.waitForTimeout(300);
        const styled = await chartOf();
        assert(styled.chartData.datasets.length === 2 && styled.chartData.datasets[1].data[0] === 7, `second series: ${JSON.stringify(styled.chartData.datasets.map(d => d.data))}`);
        assert(styled.chartData.datasets[1].backgroundColor === "#dc2626", `second series colour: ${styled.chartData.datasets[1].backgroundColor}`);
        assert(styled.chartStyle.xTitle === "Month" && styled.chartStyle.legend === "bottom", `chart style: ${JSON.stringify(styled.chartStyle)}`);
        const drawn = await page.evaluate(id => {
            const node = [...document.querySelectorAll(`[id="${id}"]`)].find(x => !x.closest("#slide-previews"));
            const chart = Chart.getChart(node.querySelector("canvas"));
            return { series: chart?.data.datasets.length, xTitle: chart?.options.scales.x.title.text, legend: chart?.options.plugins.legend.position };
        }, id);
        assert(drawn.series === 2 && drawn.xTitle === "Month" && drawn.legend === "bottom", `drawn chart: ${JSON.stringify(drawn)}`);
        // A light theme moves the chart to its card and recolours the series the user did not pick.
        const light = await page.evaluate(id => {
            changePresentationTheme("porcelain");
            const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
            return { card: el.styles.backgroundColor, want: getPresentationTheme("porcelain").surfaceColor, first: el.chartData.datasets[0].backgroundColor, accent: getPresentationTheme("porcelain").accentStrong, second: el.chartData.datasets[1].backgroundColor };
        }, id);
        assert(light.card === light.want, `chart card after the theme change: ${JSON.stringify(light)}`);
        assert(light.first === light.accent && light.second === "#dc2626", `series colours after the theme change: ${JSON.stringify(light)}`);
        await page.evaluate(() => exportPPTX());
        await page.waitForTimeout(800);
        const exported = sent?.state?.slides?.flatMap(s => s.elements).find(e => e.id === id);
        assert(exported?.chartData?.datasets?.length === 2 && exported.chartStyle?.xTitle === "Month", `PowerPoint request: ${JSON.stringify(exported?.chartStyle)}`);
        await page.close();
    });

    if (!FRONTEND_ONLY) {
        await test("review: importing a SlideForge JSON adds one project, named apart from a deck with the same name", async () => {
            const { page } = await openEditor(context);
            const fs = require("fs");
            const os = require("os");
            const path = require("path");
            const name = `Review import ${Date.now()}`;
            const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sf-json-")), `${name}.json`);
            const before = await page.evaluate(async name => {
                setCurrentPresentationTitle(name);
                addSlide();
                // A saved deck with that name (a fresh browser has no project record yet).
                if (!currentPresentationId) await createPresentationRecord();
                await autosavePresentationNow();
                const projects = await listSavedProjects();
                return { ids: projects.map(p => p.id), listed: projects.some(p => p.title === name), state: JSON.parse(JSON.stringify(getPersistableState())) };
            }, name);
            assert(before.listed, "setup: the original deck was not saved");
            fs.writeFileSync(file, JSON.stringify({ ...before.state, title: name }));
            const chooser = page.waitForEvent("filechooser");
            await page.evaluate(() => importPresentationJson());
            await (await chooser).setFiles(file);
            await page.waitForFunction(name => currentPresentationTitle.startsWith(name) && currentPresentationTitle !== name, name, { timeout: 15000 });
            await page.waitForTimeout(1500);
            const after = await page.evaluate(async () => (await listSavedProjects()).map(p => ({ id: p.id, title: p.title })));
            const added = after.filter(p => !before.ids.includes(p.id));
            assert(added.length === 1, `projects added by one import: ${JSON.stringify(added)}`);
            assert(added[0].title === `${name} (imported)`, `imported deck named ${JSON.stringify(added[0].title)}`);
            await page.close();
        });

        await test("importing a PowerPoint file makes a new project (the open one is untouched) with text, bullets and a table", async () => {
            const { page, errors } = await openEditor(context);
            const outcome = await page.evaluate(async () => {
                await createNewProject();
                const title = state.slides[0].elements.find(e => e.placeholder === "Click to add title");
                title.content = "Keep this deck";
                delete title.textDocument;
                await autosavePresentationNow();
                const openId = currentPresentationId;
                const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
                const sp = (id, x, y, w, h, body) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
                const run = (text, attrs = "") => `<a:r><a:rPr ${attrs}/><a:t>${text}</a:t></a:r>`;
                const cell = text => `<a:tc><a:txBody><a:bodyPr/><a:p>${run(text)}</a:p></a:txBody></a:tc>`;
                const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>
                    ${sp(2, 914400, 457200, 9144000, 914400, `<a:p>${run("Imported title", 'sz="3000" b="1"')}</a:p>`)}
                    ${sp(3, 914400, 1828800, 9144000, 1828800, `<a:p><a:pPr><a:buChar char="•"/></a:pPr>${run("First", 'sz="1800"')}</a:p><a:p><a:pPr lvl="1"><a:buChar char="•"/></a:pPr>${run("Second", 'sz="1800"')}</a:p>`)}
                    <p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="914400" y="4114800"/><a:ext cx="3657600" cy="914400"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid><a:tr h="457200">${cell("A")}${cell("B")}</a:tr><a:tr h="457200">${cell("1")}${cell("2")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
                </p:spTree></p:cSld></p:sld>`;
                const zip = new JSZip();
                zip.file("ppt/presentation.xml", `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
                zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
                zip.file("ppt/slides/slide1.xml", slide);
                await importPptx(new File([await zip.generateAsync({ type: "blob" })], "Imported deck.pptx"));
                await autosavePresentationNow().catch(() => {});
                const els = state.slides[0].elements;
                const kept = await (await fetch(`/api/presentations/${openId}/`)).json();
                return {
                    newProject: currentPresentationId !== openId,
                    title: document.getElementById("project-title-input").value,
                    page: state.pageSetup,
                    titleSize: els[0].styles.fontSize,
                    bold: els[0].styles.fontWeight,
                    list: els[1].content,
                    table: els[2].tableData.cells.map(row => row.map(c => c.text).join("")).join("|"),
                    keptTitle: JSON.stringify(kept.state.slides[0].elements).includes("Keep this deck"),
                };
            });
            assert(outcome.newProject && outcome.keptTitle, `the open project was overwritten: ${JSON.stringify(outcome)}`);
            // A deck of that name from an earlier run makes it "Imported deck (imported)" (review fix).
            assert(/^Imported deck( \(imported( \d+)?\))?$/.test(outcome.title) && outcome.page === "talk-16-9", JSON.stringify(outcome));
            assert(outcome.titleSize === "40px" && outcome.bold === "700", `title style: ${JSON.stringify(outcome)}`);
            assert(Array.isArray(outcome.list) && outcome.list[1].level === 1 && outcome.table === "AB|12", JSON.stringify(outcome));
            assert(!errors.length, errors.join("; "));
            await page.close();
        });

        await test("review: PowerPoint shape text comes in centred in its shape and in the shape's text colour", async () => {
            const { page } = await openEditor(context);
            const outcome = await page.evaluate(async () => {
                const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
                // An Office-style filled shape: no colour on the runs, text colour from the style's fontRef (lt1).
                const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>
                    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="7315200" y="1828800"/><a:ext cx="2743200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="E06C2F"/></a:solidFill></p:spPr>
                    <p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
                    <p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:p><a:r><a:rPr sz="1800"/><a:t>Text in shape</a:t></a:r></a:p></p:txBody></p:sp>
                </p:spTree></p:cSld></p:sld>`;
                const theme = `<a:theme ${ns} name="T"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`;
                const zip = new JSZip();
                zip.file("ppt/presentation.xml", `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
                zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
                zip.file("ppt/slides/slide1.xml", slide);
                zip.file("ppt/theme/theme1.xml", theme);
                await importPptx(new File([await zip.generateAsync({ type: "blob" })], "Shape text.pptx"));
                const els = state.slides[0].elements;
                const shape = els.find(e => e.type === "shape");
                const texts = els.filter(e => e.type === "text").length;
                return { text: shape?.shapeText, style: shape?.shapeTextStyle, texts };
            });
            // The words are the shape's own text now (they move with it), centred and in the style's white.
            assert(outcome.text === "Text in shape" && outcome.texts === 0, `shape text: ${JSON.stringify(outcome)}`);
            assert(outcome.style?.verticalAlign === "middle" && outcome.style?.textAlign === "center", `alignment: ${JSON.stringify(outcome.style)}`);
            assert(String(outcome.style?.color).toLowerCase() === "#ffffff", `shape text colour ${outcome.style?.color}, want the style's white`);
            await page.close();
        });

        await test("qa2: PowerPoint import keeps style-filled shapes, lines with arrowheads and links", async () => {
            const { page, errors } = await openEditor(context);
            const outcome = await page.evaluate(async () => {
                const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
                // Office's default shape style: the fill and line come from the theme through <p:style>, not spPr.
                const style = `<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>`;
                const shape = (id, prst, x, y, text = "") => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom></p:spPr>${style}<p:txBody><a:bodyPr anchor="ctr"/><a:p>${text ? `<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r>` : ""}</a:p></p:txBody></p:sp>`;
                const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>
                    ${shape(2, "ellipse", 914400, 914400, "Oval")}
                    <p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="4572000" y="914400"/><a:ext cx="1828800" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="1828800" cy="914400"/></a:xfrm></p:grpSpPr>${shape(4, "rect", 0, 0)}</p:grpSp>
                    <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm flipV="1"><a:off x="914400" y="2743200"/><a:ext cx="2743200" cy="914400"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
                    <p:sp><p:nvSpPr><p:cNvPr id="6" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="4572000"/><a:ext cx="5486400" cy="457200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>See </a:t></a:r><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rId9"/></a:rPr><a:t>the paper</a:t></a:r></a:p></p:txBody></p:sp>
                </p:spTree></p:cSld></p:sld>`;
                const theme = `<a:theme ${ns} name="T"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`;
                const zip = new JSZip();
                zip.file("ppt/presentation.xml", `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
                zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
                zip.file("ppt/slides/slide1.xml", slide);
                zip.file("ppt/slides/_rels/slide1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/paper" TargetMode="External"/></Relationships>`);
                zip.file("ppt/theme/theme1.xml", theme);
                await importPptx(new File([await zip.generateAsync({ type: "blob" })], "Style fills.pptx"));
                const els = state.slides[0].elements;
                const shapes = els.filter(e => e.type === "shape").map(e => ({ type: e.shapeType, fill: e.styles.backgroundColor, line: e.styles.borderColor, text: e.shapeText || "" }));
                const line = els.find(e => e.type === "connector");
                const abs = line && line.points.map(p => ({ x: line.x + p.x, y: line.y + p.y }));
                const text = els.find(e => e.type === "text");
                const link = document.querySelector(`#${CSS.escape(text?.id || "none")} a[href]`);
                // A click on the link in the editor does not leave the editor.
                const opened = [];
                const realOpen = window.open;
                window.open = (...args) => (opened.push(args[0]), null);
                link?.click();
                const editing = opened.length;
                // While presenting it opens in a new tab.
                document.body.classList.add("play-mode-active");
                link?.click();
                document.body.classList.remove("play-mode-active");
                window.open = realOpen;
                return { shapes, line: line && { start: line.connectorStart, end: line.connectorEnd, color: line.styles.color, abs }, html: text?.content, href: link?.getAttribute("href"), editing, opened, viewer: sanitizeHtml(text?.content || ""), bold: sanitizeHtml("Plain <b>bold</b> end"), url: location.href };
            });
            assert(outcome.shapes.length === 2, `shapes imported: ${JSON.stringify(outcome.shapes)}`);
            const [oval, box] = outcome.shapes;
            assert(oval.type === "circle" && String(oval.fill).toLowerCase() === "#4f81bd" && oval.text === "Oval", `oval: ${JSON.stringify(oval)}`);
            assert(String(box.fill).toLowerCase() === "#4f81bd" && String(box.line).toLowerCase() === "#28415f", `grouped box: ${JSON.stringify(box)}`);
            assert(outcome.line, "the connector was dropped");
            assert(outcome.line.start === "none" && outcome.line.end === "triangle" && String(outcome.line.color).toLowerCase() === "#c00000", `connector: ${JSON.stringify(outcome.line)}`);
            // flipV: from the bottom-left corner of its box up to the top-right
            const [a, b] = [outcome.line.abs[0], outcome.line.abs.at(-1)];
            assert(a.x < b.x && a.y > b.y, `connector direction: ${JSON.stringify(outcome.line.abs)}`);
            assert(outcome.href === "https://example.org/paper", `link: ${JSON.stringify(outcome)}`);
            assert(outcome.editing === 0 && !/example\.org/.test(outcome.url), `a click in the editor followed the link: ${JSON.stringify(outcome)}`);
            // The shared viewer keeps the link and opens it in a new tab.
            assert(/<a href="https:\/\/example\.org\/paper" target="_blank" rel="noopener noreferrer">the paper<\/a>/.test(outcome.viewer), `viewer html: ${outcome.viewer}`);
            assert(outcome.bold === "Plain <b>bold</b> end", `the viewer dropped the word after plain text: ${outcome.bold}`);
            assert(JSON.stringify(outcome.opened) === '["https://example.org/paper"]', `presenting, the link opened ${JSON.stringify(outcome.opened)}`);
            assert(!errors.length, errors.join("; "));
            await page.close();
        });

        await test("missing: a PowerPoint chart comes in with every series, their colours, its title and axis titles", async () => {
            const { page } = await openEditor(context);
            const chart = await page.evaluate(async () => {
                const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
                const cns = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
                const pts = values => `<c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("")}`;
                const ser = (name, color, values) => `<c:ser><c:idx val="0"/><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:cat><c:strRef><c:strCache>${pts(["WT", "K12A"])}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache>${pts(values)}</c:numCache></c:numRef></c:val></c:ser>`;
                const title = text => `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></c:rich></c:tx></c:title>`;
                const chartXml = `<c:chartSpace ${cns}><c:chart>${title("RMSD by mutant")}<c:plotArea><c:barChart>${ser("Run 1", "2563EB", [2.1, 3.4])}${ser("Run 2", "DC2626", [2.3, 3.1])}</c:barChart><c:catAx>${title("Mutant")}</c:catAx><c:valAx>${title("RMSD")}</c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;
                const slide = `<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>
                    <p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="914400" y="914400"/><a:ext cx="5486400" cy="3657600"/></p:xfrm><a:graphic><a:graphicData><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>
                </p:spTree></p:cSld></p:sld>`;
                const zip = new JSZip();
                zip.file("ppt/presentation.xml", `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
                zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
                zip.file("ppt/slides/slide1.xml", slide);
                zip.file("ppt/slides/_rels/slide1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`);
                zip.file("ppt/charts/chart1.xml", chartXml);
                await importPptx(new File([await zip.generateAsync({ type: "blob" })], "Chart series.pptx"));
                const el = state.slides[0].elements.find(e => e.type === "chart");
                return el && { names: el.chartData.datasets.map(d => d.label), data: el.chartData.datasets.map(d => d.data), colors: el.chartData.datasets.map(d => d.backgroundColor), style: el.chartStyle };
            });
            assert(chart, "no chart imported");
            assert(JSON.stringify(chart.names) === '["Run 1","Run 2"]' && JSON.stringify(chart.data) === "[[2.1,3.4],[2.3,3.1]]", `series: ${JSON.stringify(chart)}`);
            assert(JSON.stringify(chart.colors) === '["#2563EB","#DC2626"]', `series colours: ${JSON.stringify(chart.colors)}`);
            assert(chart.style?.title === "RMSD by mutant" && chart.style.xTitle === "Mutant" && chart.style.yTitle === "RMSD" && chart.style.legend === "bottom", `titles: ${JSON.stringify(chart.style)}`);
            await page.close();
        });

        await test("Share makes a view-only link that follows saved changes, fits a phone and can be stopped", async () => {
            const { page, errors } = await openEditor(context);
            const setTitle = text => page.evaluate(async text => {
                const title = state.slides[0].elements.find(e => e.placeholder === "Click to add title");
                title.content = text;
                delete title.textDocument;
                renderSlidesFromState();
                await autosavePresentationNow();
            }, text);
            await page.evaluate(() => createNewProject());
            await setTitle("Shared lecture one");
            await page.locator("#btn-share").click();
            await page.locator("#share-modal [data-share=create]").click();
            await page.waitForFunction(() => /\/s\/[\w-]+\/$/.test(document.getElementById("share-link-input")?.value || ""), null, { timeout: 30000 });
            const link = await page.locator("#share-link-input").inputValue();
            const local = new URL(new URL(link).pathname, TEST_URL).href; // the desktop app may show its tunnel address

            const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
            const viewer = await phone.newPage();
            await viewer.goto(local, { waitUntil: "networkidle" });
            await viewer.waitForTimeout(600);
            const view = await viewer.evaluate(() => {
                const r = document.getElementById("slides-container").getBoundingClientRect();
                return { text: document.body.innerText, title: document.title, left: r.left, right: r.right, editor: !!document.getElementById("btn-share") };
            });
            assert(view.text.includes("Shared lecture one") && view.title === "Shared lecture one", JSON.stringify(view));
            assert(view.left >= 0 && view.right <= 390, `slide does not fit the phone: ${JSON.stringify(view)}`);
            assert(!view.editor, "the link shows the editor");
            const api = await viewer.request.get(new URL("/api/presentations/", TEST_URL).href);
            assert([401, 403].includes(api.status()), `the API answered a link viewer with ${api.status()}`);

            await setTitle("Shared lecture two");
            await viewer.waitForFunction(async url => (await (await fetch(url, { cache: "no-store" })).text()).includes("Shared lecture two"), local, { timeout: 30000, polling: 1000 });

            await page.locator("#share-modal [data-share=stop]").click();
            await page.waitForFunction(() => document.querySelector("#share-modal [data-share=create]"));
            const gone = await viewer.request.get(local);
            assert(gone.status() === 404, `stopped link answered ${gone.status()}`);
            assert(!errors.length, errors.join("; "));
            await phone.close();
            await page.close();
        });

        await test("a new deck is 'Untitled Presentation' until its title is typed, then takes that title", async () => {
            const { page } = await openEditor(context);
            const names = await page.evaluate(async () => {
                await createNewProject();
                const before = document.getElementById("project-title-input").value;
                const title = state.slides[0].elements.find(e => e.placeholder === "Click to add title");
                title.content = "Cell biology basics";
                delete title.textDocument;
                await autosavePresentationNow();
                return { before, after: document.getElementById("project-title-input").value };
            });
            assert(names.before === "Untitled Presentation" && names.after === "Cell biology basics", JSON.stringify(names));
            await page.close();
        });

        await test("undo does not carry slides from one project into another", async () => {
            const { page } = await openEditor(context);
            const outcome = await page.evaluate(async () => {
                addSlide();
                addElement("text");
                await autosavePresentationNow();
                const projectA = currentPresentationId;
                const slidesA = state.slides.length;
                await createNewProject();
                const slidesB = state.slides.length;
                undo();
                await new Promise(resolve => setTimeout(resolve, 1600));
                return { projectA, slidesA, slidesB, afterUndo: state.slides.length, projectNow: currentPresentationId };
            });
            assert(outcome.projectNow !== outcome.projectA, "still on project A");
            assert(outcome.afterUndo === outcome.slidesB, `undo brought project A's ${outcome.slidesA} slides into the new project`);
            await page.close();
        });

        await test("a slow autosave for project A cannot corrupt project B", async () => {
            const { page } = await openEditor(context);
            const ids = await page.evaluate(async () => {
                const a = currentPresentationId;
                await createNewProject();
                const b = currentPresentationId;
                await loadProjectById(a);
                return { a, b };
            });
            await page.route(`**/api/presentations/${ids.a}/`, async route => {
                if (route.request().method() === "PATCH") await new Promise(resolve => setTimeout(resolve, 1500));
                await route.continue();
            });
            const outcome = await page.evaluate(async ids => {
                addElement("text");
                const pending = autosavePresentationNow().catch(() => "failed");
                await new Promise(resolve => setTimeout(resolve, 100));
                await loadProjectById(ids.b);
                const versionB = currentPresentationAutosaveVersion;
                await pending;
                addElement("text");
                let conflict = false;
                try {
                    await autosavePresentationNow();
                } catch (err) {
                    conflict = err?.status === 409;
                }
                return { versionB, versionAfter: currentPresentationAutosaveVersion, conflict, projectNow: currentPresentationId };
            }, ids);
            assert(outcome.projectNow === ids.b, "project changed unexpectedly");
            assert(!outcome.conflict, "project B's next save hit a version conflict");
            assert(outcome.versionAfter === outcome.versionB + 1, `unexpected version for B: ${JSON.stringify(outcome)}`);
            await page.unroute(`**/api/presentations/${ids.a}/`);
            await page.close();
        });

        await test("edits made right before closing survive even if the final save is blocked", async () => {
            const first = await openEditor(context);
            const marker = `closing-edit-${Date.now()}`;
            await first.page.route("**/api/presentations/*/", route =>
                route.request().method() === "PATCH" ? route.abort() : route.continue(),
            );
            await first.page.evaluate(marker => {
                addSlide();
                const slide = state.slides[currentSlideIndex];
                slide.notes = marker;
                schedulePresentationAutosave();
            }, marker);
            await first.page.close({ runBeforeUnload: true });

            const second = await openEditor(context);
            const restored = await second.page.evaluate(marker => state.slides.some(s => s.notes === marker), marker);
            assert(restored, "the edit made right before closing was lost");
            await second.page.waitForTimeout(1200);
            const hint = await second.page.evaluate(() => document.getElementById("project-save-hint")?.textContent || "");
            assert(/saved|recovered/i.test(hint), `recovered edit was not saved (hint: ${hint})`);
            await second.page.close();
        });
    }

    await browser.close();
    console.log(`\n${results.passed.length} passed, ${results.failed.length} failed`);
    process.exit(results.failed.length ? 1 : 0);
})();
