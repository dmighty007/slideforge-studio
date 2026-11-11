// Critical asynchronous regressions. Run against a disposable app/database.
const { chromium } = require("playwright");
const assert = require("assert/strict");
const url = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8089/";
(async () => {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const failures = [];
    async function test(name, run) {
        if (process.env.ASYNC_TEST_FILTER && !name.includes(process.env.ASYNC_TEST_FILTER)) return;
        const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("dialog", dialog => dialog.dismiss());
        await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { window.openStartScreen = () => false; }));
        try {
            await page.goto(url, { waitUntil: "networkidle" });
            await page.waitForFunction(() => typeof renderSlidesFromState === "function" && !isPresentationHydrating());
            await run(page, errors);
            assert.deepEqual(errors, [], "Unexpected browser errors");
            console.log("PASS", name);
        } catch (error) { failures.push(name); console.error("FAIL", name, error.message); }
        finally { await context.close(); }
    }
    try {
        await test("Typing immediately after entering a text box keeps its first character", async page => {
            await page.evaluate(() => {
                addSlide();
                const body = state.slides[currentSlideIndex].elements.find(el => el.placeholderRole === "content");
                window.immediateTextId = body.id;
                window.immediateTextFrames = [];
                window.immediateTextRAF = window.requestAnimationFrame;
                // Simulate a busy frame: pointer and keyboard events can arrive before
                // the caret's deferred work gets its next animation frame.
                window.requestAnimationFrame = callback => { immediateTextFrames.push(callback); return 0; };
                const node = document.getElementById(body.id), rect = node.getBoundingClientRect();
                node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: rect.x + 10, clientY: rect.y + 10 }));
            });
            try {
                const focused = await page.evaluate(() => document.getElementById(immediateTextId).querySelector(".text-element-content") === document.activeElement);
                assert.equal(focused, true, "The text box must accept keys before the next animation frame");
                await page.keyboard.type("Alpha");
                const typed = await page.evaluate(() => {
                    window.requestAnimationFrame = immediateTextRAF;
                    immediateTextFrames.splice(0).forEach(callback => callback(performance.now()));
                    return document.getElementById(immediateTextId).querySelector(".text-element-content").textContent;
                });
                assert(typed.includes("Alpha"), `Typed text was lost: ${typed}`);
                await page.keyboard.type(" Beta");
                const continued = await page.evaluate(() => document.getElementById(immediateTextId).querySelector(".text-element-content").textContent);
                assert(continued.includes("Alpha Beta"), `A late caret callback moved the next word: ${continued}`);
            } finally {
                await page.evaluate(() => { window.requestAnimationFrame = immediateTextRAF; });
            }
        });
        await test("Redraw respects text replaced by a command while its old editor is focused", async page => {
            const result = await page.evaluate(() => {
                addElement("text");
                const id = state.selectedIds[0];
                const before = document.getElementById(id).querySelector(".text-element-content");
                const focused = document.activeElement === before;
                const element = state.slides[currentSlideIndex].elements.find(el => el.id === id);
                element.content = "Replacement text";
                element.textDocument = createTextDocumentFromLegacyContent(element.content);
                renderSlidesFromState();
                return { focused, model: state.slides[currentSlideIndex].elements.find(el => el.id === id).content,
                    drawn: document.getElementById(id).textContent };
            });
            assert.equal(result.focused, true);
            assert.equal(result.model, "Replacement text");
            assert(result.drawn.includes("Replacement text"), `Stale text drawn: ${result.drawn}`);
        });
        await test("A failed Mermaid render does not poison later valid renders", async page => {
            const result = await page.evaluate(async () => {
                const engine = await import("/js/mermaid/mermaid-engine.js");
                let rejected = false;
                try { await engine.renderMermaid("sequenceDiagram\nthis is invalid"); } catch (_) { rejected = true; }
                try {
                    const result = await engine.renderMermaid("sequenceDiagram\nAlice->>Bob: corrected");
                    return { rejected, valid: result.svg.includes("<svg") };
                } catch (error) { return { rejected, valid: false, error: error.message }; }
            });
            assert(result.rejected && result.valid, JSON.stringify(result));
        });
        await test("Closing a Mermaid dialog during rendering leaves no rejected callback", async (page, errors) => {
            await page.evaluate(async () => {
                const engine = await import("/js/mermaid/mermaid-engine.js"), mermaid = await engine.loadMermaid();
                const original = mermaid.render.bind(mermaid);
                mermaid.render = (...args) => new Promise((resolve, reject) => {
                    window.releaseDiagram = () => original(...args).then(resolve, reject).finally(() => { window.diagramReleased = true; });
                });
                state.slides = [{ id: "async-diagram-slide", layoutId: "blank", masterId: "none", elements: [{
                    id: "async-diagram", type: "mermaid", mermaidSource: "sequenceDiagram\nAlice->>Bob: held", style: {}, theme: "default",
                }] }];
                setCurrentSlideIndex(0);
                openMermaidDialog("async-diagram");
            });
            await page.waitForFunction(() => typeof releaseDiagram === "function");
            await page.evaluate(() => { closeMermaidDialog(); releaseDiagram(); });
            await page.waitForFunction(() => window.diagramReleased);
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
            assert.deepEqual(errors, []);
        });
        await test("A pending diagram render cannot overwrite later manual SVG edits", async page => {
            await page.evaluate(async () => {
                const engine = await import("/js/mermaid/mermaid-engine.js"), mermaid = await engine.loadMermaid();
                const original = mermaid.render.bind(mermaid);
                mermaid.render = (...args) => new Promise((resolve, reject) => {
                    window.releaseDiagram = () => original(...args).then(resolve, reject);
                });
                const host = document.createElement("div"); host.id = "manual-render-test"; document.body.append(host);
                window.manualDiagram = { id: "manual-render-test", mermaidSource: "sequenceDiagram\nA->>B: old", theme: "default", style: {} };
                renderMermaidElement(host, manualDiagram, { updateState: false });
            });
            await page.waitForFunction(() => typeof releaseDiagram === "function");
            await page.evaluate(() => {
                Object.assign(manualDiagram, { svgManualEdits: true, svgContent: '<svg xmlns="http://www.w3.org/2000/svg"><text>Keep manual edit</text></svg>' });
                renderMermaidElement(document.getElementById("manual-render-test"), manualDiagram, { force: true, updateState: false });
            });
            await page.evaluate(() => releaseDiagram());
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
            assert((await page.locator("#manual-render-test").textContent()).includes("Keep manual edit"));
        });
        await test("Rebuilding video properties retires its previous dashboard loop", async page => {
            const result = await page.evaluate(() => {
                const original = window.requestAnimationFrame, callbacks = [];
                const video = document.createElement("div"); video.id = "async-video";
                video.innerHTML = "<video></video>"; document.body.append(video);
                const panel = document.createElement("div"); document.body.append(panel);
                const data = { id: "async-video", type: "video", content: "/media/async.mp4", videoType: "local" };
                let oldCount, liveCount;
                try {
                    window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
                    buildVideoPanel(panel, data); bindVideoPanel(data, fn => fn());
                    const old = callbacks.shift();
                    panel.replaceChildren();
                    buildVideoPanel(panel, data); bindVideoPanel(data, fn => fn());
                    callbacks.length = 0;
                    old(); oldCount = callbacks.length;
                    // The old callback must not reschedule just because a new panel uses the same id.
                    panel.replaceChildren();
                    buildVideoPanel(panel, data); bindVideoPanel(data, fn => fn());
                    const live = callbacks.pop(); callbacks.length = 0;
                    live(); liveCount = callbacks.length;
                } finally { window.requestAnimationFrame = original; panel.remove(); video.remove(); }
                return { oldCount, liveCount };
            });
            assert.deepEqual(result, { oldCount: 0, liveCount: 1 });
        });
        await test("A late project open cannot replace the most recent choice", async page => {
            const pending = new Map();
            await page.route("**/api/presentations/async-*/", route => {
                if (route.request().method() !== "GET") return route.fulfill({ status: 200, json: {} });
                pending.set(new URL(route.request().url()).pathname.split("/").at(-2), route);
            });
            await page.evaluate(() => {
                currentAuthUser = { id: "audit", username: "audit" };
                _presentationPersistenceEnabled = false;
                window.openA = loadProjectById("async-A");
                window.openB = loadProjectById("async-B");
            });
            for (let attempt = 0; pending.size < 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
            assert.equal(pending.size, 2, "Both opens must reach the API");
            const respond = id => pending.get(id).fulfill({ json: {
                id, title: id, autosaveVersion: 1,
                state: { presentationTheme: "blank", slides: [{ id: id + "-slide", layoutId: "blank", masterId: "none", elements: [] }] },
            } });
            await respond("async-B");
            await page.waitForFunction(() => currentPresentationId === "async-B" && !isPresentationHydrating());
            await respond("async-A");
            const result = await page.evaluate(async () => ({ a: await openA, b: await openB, id: currentPresentationId, slide: state.slides[0].id }));
            assert.deepEqual(result, { a: false, b: true, id: "async-B", slide: "async-B-slide" });
            pending.clear();
            await page.evaluate(() => {
                // Start another pair of network loads. B is now current and cached;
                // opening it again correctly returns without an API request.
                clearProjectTabs();
                currentPresentationId = null;
                window.openA = loadProjectById("async-A");
                window.openB = loadProjectById("async-B");
            });
            for (let attempt = 0; pending.size < 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
            assert.equal(pending.size, 2);
            await respond("async-A");
            assert.equal(await page.evaluate(() => openA), false);
            assert(await page.evaluate(() => isPresentationHydrating()), "Stale completion cleared the newer load's hydration");
            await respond("async-B");
            assert.equal(await page.evaluate(() => openB), true);
            assert.equal(await page.evaluate(() => currentPresentationId), "async-B");
        });
        await test("Inline-media optimization cannot overwrite an object in a different project", async page => {
            const result = await page.evaluate(async () => {
                const original = _uploadAssetFile;
                _backendApiAvailable = true;
                const content = "data:audio/wav;base64,AAAA";
                state = { ...buildDefaultPresentationState(), slides: [{ id: "source-slide", elements: [{ id: "source-audio", type: "audio", content }] }] };
                let release, started;
                const waiting = new Promise(resolve => { started = resolve; });
                _uploadAssetFile = () => { started(); return new Promise(resolve => { release = resolve; }); };
                try {
                    const pending = migrateInlineVideoAssets();
                    await waiting;
                    state = { ...buildDefaultPresentationState(), slides: [{ id: "other-slide", elements: [{ id: "other-audio", type: "audio", content: "/media/keep.wav" }] }] };
                    release({ url: "/media/old-project.wav" });
                    const changed = await pending;
                    return { changed, content: state.slides[0].elements[0].content };
                } finally { _uploadAssetFile = original; }
            });
            assert.deepEqual(result, { changed: false, content: "/media/keep.wav" });
        });
        await test("Inline-media optimization follows IDs after reorder and respects source replacements", async page => {
            const result = await page.evaluate(async () => {
                const original = _uploadAssetFile;
                _backendApiAvailable = true;
                _presentationPersistenceEnabled = false;
                const content = "data:audio/wav;base64,AAAA";
                async function scenario(replace) {
                    state = { ...buildDefaultPresentationState(), slides: [{ id: "migration-slide", layoutId: "blank", masterId: "none", elements: [
                        { id: "migrate-audio", type: "audio", content },
                        { id: "keep-audio", type: "audio", content: "/media/keep.wav" },
                    ] }] };
                    let release, started;
                    const waiting = new Promise(resolve => { started = resolve; });
                    _uploadAssetFile = () => { started(); return new Promise(resolve => { release = resolve; }); };
                    const pending = migrateInlineVideoAssets();
                    await waiting;
                    state.slides[0].elements.reverse();
                    normalizeStateIds();
                    if (replace) state.slides[0].elements.find(el => el.id === "migrate-audio").content = "/media/replaced.wav";
                    release({ url: "/media/optimized.wav" });
                    const changed = await pending;
                    return { changed, sources: Object.fromEntries(state.slides[0].elements.map(el => [el.id, el.content])) };
                }
                try { return { reordered: await scenario(false), replaced: await scenario(true) }; }
                finally { _uploadAssetFile = original; }
            });
            assert.deepEqual(result, {
                reordered: { changed: true, sources: { "migrate-audio": "/media/optimized.wav", "keep-audio": "/media/keep.wav" } },
                replaced: { changed: false, sources: { "migrate-audio": "/media/replaced.wav", "keep-audio": "/media/keep.wav" } },
            });
        });
        await test("A late project creation response cannot adopt a different project", async page => {
            let pending;
            await page.route("**/api/presentations/", route => {
                if (route.request().method() === "POST") { pending = route; return; }
                return route.continue();
            });
            await page.evaluate(() => {
                currentPresentationId = null; _presentationPersistenceEnabled = false;
                window.creation = createPresentationRecord();
            });
            for (let i = 0; !pending && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
            assert(pending, "Creation must reach the API");
            await page.evaluate(() => adoptPresentationRecord("async-current", "Current project", 7));
            await pending.fulfill({ json: { id: "async-old-create", title: "Old project", autosaveVersion: 1 } });
            const result = await page.evaluate(async () => ({ ignored: await creation === null, id: currentPresentationId, version: currentPresentationAutosaveVersion }));
            assert.deepEqual(result, { ignored: true, id: "async-current", version: 7 });
        });
        await test("Exported viewer media synchronization also respects manual pause", async page => {
            const script = await page.evaluate(() => generateViewerJs());
            const viewer = await page.context().newPage();
            try {
                await viewer.setContent('<div id="viewer-stage" style="width:100vw;height:100vh"><div id="slides-container"></div></div>');
                await viewer.addScriptTag({ content: script });
                const result = await viewer.evaluate(async () => {
                    let calls = 0, paused = true;
                    document.hasFocus = () => true;
                    Object.defineProperty(HTMLMediaElement.prototype, "paused", { get: () => paused });
                    HTMLMediaElement.prototype.play = function() { calls++; paused = false; return Promise.resolve(); };
                    HTMLMediaElement.prototype.pause = function() { paused = true; };
                    initViewer({ slides: [{ id: "viewer-pause", elements: [{
                        id: "viewer-video", type: "video", videoType: "local", content: "", autoplay: true,
                        x: 0, y: 0, width: 300, height: 200, styles: {},
                    }] }] });
                    const video = document.querySelector("video");
                    if (!video) throw Error("Viewer did not create the video");
                    video.pause();
                    window.dispatchEvent(new Event("focus"));
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    return { calls, paused };
                });
                assert.deepEqual(result, { calls: 1, paused: true });
            } finally { await viewer.close(); }
        });
        await test("Media synchronization does not undo a manual video pause", async page => {
            const result = await page.evaluate(() => {
                const container = document.getElementById("slides-container");
                const original = container.innerHTML, focus = document.hasFocus, indices = getActiveSlideMediaIndex;
                const section = document.createElement("section"), video = document.createElement("video");
                section.append(video); container.replaceChildren(section);
                let calls = 0, paused = true;
                video.autoplay = true;
                Object.defineProperty(video, "paused", { get: () => paused });
                video.play = () => { calls++; paused = false; return Promise.resolve(); };
                video.pause = () => { paused = true; };
                try {
                    document.hasFocus = () => true;
                    getActiveSlideMediaIndex = () => 0;
                    syncActiveSlideMedia();
                    video.pause();
                    syncActiveSlideMedia();
                    return { calls, paused };
                } finally { document.hasFocus = focus; getActiveSlideMediaIndex = indices; container.innerHTML = original; }
            });
            assert.deepEqual(result, { calls: 1, paused: true });
        });
    } finally { await browser.close(); }
    if (failures.length) throw Error(failures.length + " asynchronous regressions failed");
})().catch(error => { console.error(error); process.exitCode = 1; });
