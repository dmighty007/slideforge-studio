// The show recorder and timer (frontend/js/core/commands/show-recorder.js).
// Usage: node tests/browser/test-show-recorder.js (against a server on SLIDEFORGE_TEST_URL, default port 8076).
// Chromium runs with a fake microphone and screen, and answers the sharing prompts itself.
const { chromium } = require("playwright");

const TEST_URL = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/";
const TEST_FILTERS = (process.env.SLIDEFORGE_TEST_FILTER || "").split("||").filter(Boolean);
const results = { passed: [], failed: [] };

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function openEditor(context) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
            window.openStartScreen = () => false;
        });
    });
    await page.goto(TEST_URL, { waitUntil: "networkidle" });
    if (page.url() !== TEST_URL) await page.goto(TEST_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof renderSlidesFromState === "function" && document.querySelector(".presentation-slide"));
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => typeof isPresentationHydrating !== "function" || !isPresentationHydrating());
    await page.evaluate(async () => {
        await createNewProject();
        addSlide();
        addSlide();
        renderSlidesFromState();
        window.switchSlide(0);
        try {
            localStorage.removeItem("slideforge_show_timer");
        } catch (_error) {}
    });
    await page.waitForTimeout(300);
    return { page, errors };
}

async function test(name, fn) {
    if (TEST_FILTERS.length && !TEST_FILTERS.some(filter => name.includes(filter))) return;
    try {
        await fn();
        results.passed.push(name);
        console.log(`PASS ${name}`);
    } catch (error) {
        results.failed.push(name);
        console.log(`FAIL ${name}\n  ${error.stack || error.message}`);
    }
}

const playing = page => page.evaluate(() => document.body.classList.contains("play-mode-active"));
const recState = page => page.evaluate(() => showRecorderState());

// From the editor's Record button to a running recording: the setup dialog, the browser's sharing prompt (answered
// by Chromium's flags), the start click when the prompt used up the click, and the 3-2-1 (skipped by a click).
async function startRecordingFromEditor(page, { audioOnly = false } = {}) {
    await page.locator("#btn-record").click();
    await page.waitForSelector("#sf-rec-setup:not(.hidden)");
    await page.waitForFunction(() => document.querySelector("#sf-rec-setup [data-rec-meter]"));
    if (audioOnly) {
        await page.locator('#sf-rec-setup [data-rec="prepare"]').click();
        await page.waitForSelector('#sf-rec-setup [data-rec="audio-only"]');
        await page.locator('#sf-rec-setup [data-rec="audio-only"]').click();
    } else {
        await page.locator('#sf-rec-setup [data-rec="prepare"]').click();
    }
    await page.waitForFunction(() => ["ready", "countdown"].includes(showRecorderState()) || document.querySelector('#sf-rec-setup [data-rec="begin"]'));
    if (await page.locator('#sf-rec-setup:not(.hidden) [data-rec="begin"]').count()) {
        await page.locator('#sf-rec-setup [data-rec="begin"]').click();
    }
    await page.waitForSelector("#sf-rec-countdown");
    await page.locator("#sf-rec-countdown").click();
    await page.waitForFunction(() => showRecorderState() === "recording");
}

(async () => {
    const browser = await chromium.launch({
        headless: true,
        args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--auto-select-desktop-capture-source=SlideForge",
            "--autoplay-policy=no-user-gesture-required",
        ],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    await context.grantPermissions(["microphone"], { origin: new URL(TEST_URL).origin });

    await test("Show timer: counts the talk and the slide, pauses, resets, and warns as a talk length runs out", async () => {
        const { page, errors } = await openEditor(context);
        const out = await page.evaluate(() => {
            let now = 0;
            const timer = new ShowTimer(() => now);
            timer.start(0);
            now = 5000;
            const a = timer.snapshot();
            timer.markSlide(1);
            now = 7000;
            const b = timer.snapshot();
            timer.markSlide(1); // a build step on the same slide
            timer.pause();
            now = 60000;
            const c = timer.snapshot();
            timer.resume();
            now = 61000;
            const d = timer.snapshot();
            timer.reset();
            now = 62000;
            const e = timer.snapshot();
            timer.setTarget(10); // 10 min: warn for the last 2 min
            now = 62000 + 7.9 * 60000;
            const normal = timer.snapshot();
            now = 62000 + 8.1 * 60000;
            const warn = timer.snapshot();
            now = 62000 + 10.5 * 60000;
            const over = timer.snapshot();
            return { a, b, c, d, e, normal, warn, over, fmt: [formatShowTime(65000), formatShowTime(-30000), formatShowTime(3723000)] };
        });
        assert(out.a.totalMs === 5000 && out.a.slideMs === 5000, `start: ${JSON.stringify(out.a)}`);
        assert(out.b.totalMs === 7000 && out.b.slideMs === 2000, `a new slide starts its own count: ${JSON.stringify(out.b)}`);
        assert(out.c.totalMs === 7000 && !out.c.running, `paused time must not count: ${JSON.stringify(out.c)}`);
        assert(out.d.totalMs === 8000 && out.d.slideMs === 3000, `resume: ${JSON.stringify(out.d)}`);
        assert(out.e.totalMs === 1000 && out.e.running, `reset keeps running: ${JSON.stringify(out.e)}`);
        assert(out.normal.phase === "normal" && out.warn.phase === "warn" && out.over.phase === "over", `phases: ${out.normal.phase}/${out.warn.phase}/${out.over.phase}`);
        assert(out.over.remainingMs < 0, "over time is negative remaining time");
        assert(JSON.stringify(out.fmt) === JSON.stringify(["01:05", "00:30", "1:02:03"]), `format: ${out.fmt}`);
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show timer: T shows and hides it, Shift+T pauses it, the slide count restarts on a new slide, a talk length counts down", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => togglePlayMode());
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        await page.waitForTimeout(500);
        const hudShown = () => page.evaluate(() => {
            const timer = document.querySelector("#sf-show-hud [data-hud-timer]");
            return !!timer && !timer.hidden && getComputedStyle(document.getElementById("sf-show-hud")).display !== "none";
        });
        assert(!(await hudShown()), "the timer is off until asked for");
        await page.keyboard.press("t");
        assert(await hudShown(), "T did not show the timer");
        assert(JSON.parse(await page.evaluate(() => localStorage.getItem("slideforge_show_timer"))).visible === true, "the choice is not remembered");
        await page.waitForTimeout(1300);
        const slideBefore = await page.locator("[data-hud-slide]").textContent();
        assert(slideBefore === "00:01", `slide time ${slideBefore}`);
        const index = await page.evaluate(() => currentSlideIndex);
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(i => currentSlideIndex !== i, index);
        await page.waitForTimeout(300);
        assert((await page.locator("[data-hud-slide]").textContent()) === "00:00", "the slide count did not restart");
        assert((await page.locator("[data-hud-total]").textContent()) !== "00:00", "the total restarted with the slide");

        await page.keyboard.press("Shift+T");
        const frozen = await page.locator("[data-hud-total]").textContent();
        await page.waitForTimeout(1200);
        assert((await page.locator("[data-hud-total]").textContent()) === frozen, "the paused timer kept counting");
        assert(await page.evaluate(() => !showTimer.running), "Shift+T did not pause");
        await page.keyboard.press("Shift+T");
        assert(await page.evaluate(() => showTimer.running), "Shift+T did not resume");

        // A one-minute talk: amber for the last 30 s, red and "+" once over.
        await page.evaluate(() => {
            setShowTargetMinutes(1);
            showTimer.totalBase = 40000;
        });
        await page.waitForTimeout(350);
        assert((await page.locator("[data-hud-timer]").getAttribute("data-phase")) === "warn", "not amber in the last 30 s");
        assert((await page.locator("[data-hud-total-label]").textContent()) === "Left", "the countdown is not labelled");
        await page.evaluate(() => { showTimer.totalBase = 70000; });
        await page.waitForTimeout(350);
        assert((await page.locator("[data-hud-timer]").getAttribute("data-phase")) === "over", "not red once over");
        assert((await page.locator("[data-hud-total]").textContent()).startsWith("+"), "over time has no +");
        const saved = await page.evaluate(() => getPersistableState().showSettings);
        assert(saved?.targetMinutes === 1, `talk length not saved with the deck: ${JSON.stringify(saved)}`);

        // Clicking the timer's buttons does not move the slides.
        const slide = await page.evaluate(() => currentSlideIndex);
        await page.mouse.move(60, 30);
        await page.locator('[data-hud="timer-reset"]').click();
        assert((await page.evaluate(() => currentSlideIndex)) === slide, "clicking the timer moved to the next slide");

        await page.keyboard.press("t");
        assert(!(await hudShown()), "T did not hide the timer");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: records the show with pause and resume, Shift+R stops it while the show goes on, and the file has a length", async () => {
        const { page, errors } = await openEditor(context);
        await startRecordingFromEditor(page);
        assert(await playing(page), "recording did not start the show");
        assert(await page.evaluate(() => currentSlideIndex === 0), "the show did not start on the first slide");
        assert(await page.locator("#sf-show-hud [data-hud-rec]").isVisible(), "no REC badge");
        await page.waitForTimeout(1200);
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("r");
        assert((await recState(page)) === "paused", "R did not pause");
        assert((await page.locator("[data-hud-rec-label]").textContent()) === "PAUSED", "the badge does not say paused");
        const pausedAt = await page.locator("[data-hud-rec-time]").textContent();
        await page.waitForTimeout(1300);
        assert((await page.locator("[data-hud-rec-time]").textContent()) === pausedAt, "paused time was counted");
        await page.keyboard.press("r");
        assert((await recState(page)) === "recording", "R did not resume");
        await page.waitForTimeout(1200);
        await page.keyboard.press("Shift+R");
        await page.waitForSelector("#sf-rec-save:not(.hidden) video");
        assert(await playing(page), "stopping the recording ended the show");
        const info = await page.evaluate(async () => {
            const pending = getPendingShowRecording();
            const video = document.querySelector("#sf-rec-save video");
            if (!(video.duration > 0)) await new Promise(resolve => { video.onloadedmetadata = resolve; setTimeout(resolve, 4000); });
            return { size: pending.blob.size, type: pending.blob.type, durationMs: pending.durationMs, videoDuration: video.duration, width: video.videoWidth, inStage: !!video.closest("#canvas-wrapper") };
        });
        assert(info.size > 10000 && /^video\/webm/.test(info.type), `recording: ${JSON.stringify(info)}`);
        assert(info.durationMs > 2000 && info.durationMs < 4500, `the pause was counted in the length: ${info.durationMs} ms`);
        assert(Number.isFinite(info.videoDuration) && info.videoDuration > 1.5, `the file has no usable length: ${info.videoDuration}`);
        assert(info.width > 0, "no picture in the recording");
        assert(info.inStage, "the save dialog is not shown inside the fullscreen stage");
        // Keys typed while the dialog is open do not move the slides.
        const slide = await page.evaluate(() => currentSlideIndex);
        await page.keyboard.press("ArrowRight");
        assert((await page.evaluate(() => currentSlideIndex)) === slide, "a key in the save dialog moved the slides");
        const download = page.waitForEvent("download");
        await page.locator('#sf-rec-save [data-rec-save="save"]').click();
        const file = await download;
        assert(/ – recording \d{4}-\d\d-\d\d \d\d-\d\d\.webm$/.test(file.suggestedFilename()), `file name: ${file.suggestedFilename()}`);
        await page.locator('#sf-rec-save [data-rec-save="discard"]').click(); // "Done" once saved
        assert(await page.evaluate(() => getPendingShowRecording() === null), "the saved recording was kept");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: Esc ends the show and the recording, and the editor offers the file; Discard asks twice", async () => {
        const { page, errors } = await openEditor(context);
        await startRecordingFromEditor(page);
        await page.waitForTimeout(1200);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        await page.waitForSelector("#sf-rec-save:not(.hidden)");
        assert(await page.evaluate(() => document.getElementById("sf-rec-save").parentElement === document.body), "the save dialog is not in the editor");
        assert(await page.evaluate(() => !isShowRecording() && !!getPendingShowRecording()), "the recording was not kept");
        const tracks = await page.evaluate(() => showRecorderState());
        assert(tracks === "idle", `recorder state ${tracks}`);
        const discard = page.locator('#sf-rec-save [data-rec-save="discard"]');
        await discard.click();
        assert(await page.evaluate(() => !!getPendingShowRecording()), "one click discarded the recording");
        await discard.click();
        assert(await page.evaluate(() => getPendingShowRecording() === null), "the second click did not discard");
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: when screen sharing is refused it offers to record the sound only", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => {
            navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
        });
        await startRecordingFromEditor(page, { audioOnly: true });
        assert(await page.locator("[data-hud-rec-label]").textContent() === "REC (sound)", "the badge does not say sound only");
        await page.waitForTimeout(1200);
        await page.keyboard.press("Shift+R");
        await page.waitForSelector("#sf-rec-save:not(.hidden) audio");
        const pending = await page.evaluate(() => ({ ext: getPendingShowRecording().ext, type: getPendingShowRecording().blob.type, size: getPendingShowRecording().blob.size }));
        assert(pending.ext === "weba" && /^audio\/webm/.test(pending.type) && pending.size > 1000, `sound recording: ${JSON.stringify(pending)}`);
        await page.locator('#sf-rec-save [data-rec-save="close"]').click();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        // An unsaved recording is offered again before a new one starts.
        await page.locator("#btn-record").click();
        await page.waitForSelector("#sf-rec-save:not(.hidden)");
        assert(await page.locator("#sf-rec-save .share-title").textContent().then(t => /not saved/.test(t)), "the unsaved recording was not offered first");
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: R during a show opens the setup over the slides; typing in it does not move slides, Esc closes it only", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => togglePlayMode());
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        await page.waitForTimeout(400);
        await page.keyboard.press("r");
        await page.waitForSelector("#sf-rec-setup:not(.hidden)");
        assert(await page.evaluate(() => !!document.getElementById("sf-rec-setup").closest("#canvas-wrapper")), "the setup is not inside the stage");
        assert(await page.evaluate(() => !document.querySelector('input[name="sf-rec-from"]')), "'Start from' is offered during a show");
        const slide = await page.evaluate(() => currentSlideIndex);
        await page.locator("#sf-rec-setup [data-rec-target]").fill("12");
        await page.locator("#sf-rec-setup [data-rec-target]").press("ArrowRight");
        await page.locator("#sf-rec-setup [data-rec-target]").press("Tab");
        assert((await page.evaluate(() => currentSlideIndex)) === slide, "typing in the dialog moved the slides");
        assert(await page.evaluate(() => state.showSettings?.targetMinutes === 12), "the talk length was not taken");
        await page.keyboard.press("Escape");
        await page.waitForSelector("#sf-rec-setup.hidden", { state: "attached" });
        assert(await playing(page), "Esc in the dialog ended the show");
        assert((await recState(page)) === "idle", "closing the setup left the recorder busy");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: the presenter view shows the timer and pauses it and the recording", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => togglePlayMode());
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        const popupPromise = context.waitForEvent("page");
        await page.evaluate(() => openPresenterView());
        const popup = await popupPromise;
        await popup.waitForSelector("#presenter-slide-timer");
        await popup.waitForFunction(() => document.getElementById("presenter-timer").textContent !== "");
        await page.evaluate(() => setShowTargetMinutes(20));
        await page.evaluate(() => _syncPresenterTimer());
        await popup.waitForFunction(() => document.getElementById("presenter-timer-label").textContent === "Time left");
        await popup.locator("#presenter-timer-toggle").click();
        await page.waitForFunction(() => !showTimer.running);
        await popup.waitForFunction(() => document.getElementById("presenter-timer-toggle").textContent === "Resume Timer");
        assert(await popup.locator("#presenter-rec").isHidden(), "REC shows while not recording");
        await popup.close();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show timer: the presenter view's 'This slide' restarts on a new slide, as the show's does", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => togglePlayMode());
        await page.waitForFunction(() => document.body.classList.contains("play-mode-active"));
        const popupPromise = context.waitForEvent("page");
        await page.evaluate(() => openPresenterView());
        const popup = await popupPromise;
        await popup.waitForSelector("#presenter-current section");
        // Both clocks read together; the presenter window runs its own copy between messages.
        const drift = async () => {
            const [main, presenter] = await Promise.all([
                page.evaluate(() => ({ at: Date.now(), ...showTimer.snapshot() })),
                popup.evaluate(() => { const now = Date.now(), passed = clock.running ? now - clock.at : 0; return { at: now, totalMs: clock.totalMs + passed, slideMs: clock.slideMs + passed }; }),
            ]);
            const gap = presenter.at - main.at;
            return { total: Math.abs(presenter.totalMs - main.totalMs - gap), slide: Math.abs(presenter.slideMs - main.slideMs - gap), mainSlide: main.slideMs };
        };
        await page.waitForTimeout(1500);
        for (const [label, move] of [
            ["a key in the show", () => page.keyboard.press("ArrowRight")],
            ["Next in the presenter view", () => popup.locator('[data-action="next"]').click()],
            ["Previous while the timer is paused", async () => { await page.keyboard.press("Shift+T"); await page.waitForTimeout(300); await popup.locator('[data-action="prev"]').click(); }],
        ]) {
            await page.waitForTimeout(1200);
            await move();
            await page.waitForTimeout(400);
            const d = await drift();
            assert(d.mainSlide < 1000 && d.slide < 250 && d.total < 250, `after ${label} the presenter's clock differs: ${JSON.stringify(d)}`);
        }
        await popup.close();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: skipping the countdown waits for fullscreen setup before recording or navigating", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => {
            const target = _getPresentationFullscreenTarget();
            const request = target.requestFullscreen.bind(target);
            target.requestFullscreen = (...args) => request(...args).then(() => new Promise(resolve => {
                window.releaseRecorderFullscreen = resolve;
            }));
        });
        await page.locator("#btn-record").click();
        await page.waitForSelector("#sf-rec-setup:not(.hidden)");
        await page.locator('#sf-rec-setup [data-rec="prepare"]').click();
        await page.waitForFunction(() => ["ready", "countdown"].includes(showRecorderState()) || document.querySelector('#sf-rec-setup [data-rec="begin"]'));
        if (await page.locator('#sf-rec-setup:not(.hidden) [data-rec="begin"]').count()) await page.locator('#sf-rec-setup [data-rec="begin"]').click();
        await page.waitForFunction(() => typeof releaseRecorderFullscreen === "function");
        await page.locator("#sf-rec-countdown").click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert(await recState(page) === "countdown", "Recording started before fullscreen/slide setup finished");
        await page.evaluate(() => releaseRecorderFullscreen());
        await page.waitForFunction(() => showRecorderState() === "recording");
        await page.evaluate(() => {
            window.recorderStartupKeys = [];
            document.addEventListener("keydown", event => recorderStartupKeys.push({ key: event.key, target: event.target?.id, owns: showRecorderOwnsKey(event), index: currentSlideIndex }), true);
        });
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => currentSlideIndex === 1 && Reveal.getIndices().h === 1).catch(async error => {
            console.error("Recorder startup diagnostics", await page.evaluate(() => ({
                index: currentSlideIndex, reveal: Reveal.getIndices(), focused: document.hasFocus(),
                active: document.activeElement?.outerHTML?.slice(0, 400), keys: recorderStartupKeys,
                fragments: [...Reveal.getCurrentSlide().querySelectorAll(".fragment")].map(n => n.className),
                entering: _playModeEntering, state: showRecorderState(), dialog: isShowRecorderDialogOpen(),
            })));
            throw error;
        });
        await page.waitForTimeout(250);
        assert(await page.evaluate(() => currentSlideIndex === 1), "Late presentation setup reset the navigation");
        await page.keyboard.press("Shift+R");
        await page.waitForSelector("#sf-rec-save:not(.hidden)");
        await page.locator('#sf-rec-save [data-rec-save="close"]').click();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await test("Show recorder: a slide's own sound is recorded when the browser shares no tab audio", async () => {
        const { page, errors } = await openEditor(context);
        await page.evaluate(() => {
            // The desktop app and Firefox give the screen without its sound.
            const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getDisplayMedia = async options => {
                const stream = await original(options);
                stream.getAudioTracks().forEach(track => { track.stop(); stream.removeTrack(track); });
                return stream;
            };
            // A loud 440 Hz tone that plays by itself on slide 2.
            const rate = 22050;
            const samples = rate * 2;
            const buffer = new ArrayBuffer(44 + samples * 2);
            const view = new DataView(buffer);
            const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
            text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVEfmt ");
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
            view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
            text(36, "data"); view.setUint32(40, samples * 2, true);
            for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 20000, true);
            const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
            state.slides[1].elements.push({ id: "tone", type: "audio", content: url, audioName: "tone.wav", localMimeType: "audio/wav", autoplay: true, loop: true, hideWhilePresenting: false, x: 40, y: 40, width: 320, height: 80 });
            normalizeStateIds();
            renderSlidesFromState();
        });
        await page.locator("#btn-record").click();
        await page.waitForSelector("#sf-rec-setup:not(.hidden)");
        await page.locator('#sf-rec-setup [data-rec-opt="mic"]').uncheck(); // the slide's sound alone
        await page.locator('#sf-rec-setup [data-rec="prepare"]').click();
        await page.waitForFunction(() => ["ready", "countdown"].includes(showRecorderState()) || document.querySelector('#sf-rec-setup [data-rec="begin"]'));
        if (await page.locator('#sf-rec-setup:not(.hidden) [data-rec="begin"]').count()) await page.locator('#sf-rec-setup [data-rec="begin"]').click();
        await page.waitForSelector("#sf-rec-countdown");
        await page.locator("#sf-rec-countdown").click();
        await page.waitForFunction(() => showRecorderState() === "recording");
        assert(await page.evaluate(() => !_rec.tabAudio), "the test needs a screen without sound");
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(() => [...document.querySelectorAll("#slides-container audio")].some(a => !a.paused)).catch(async error => {
            console.error("Audio autoplay diagnostics", await page.evaluate(() => ({
                focused: document.hasFocus(), visibility: document.visibilityState,
                presenting: document.body.classList.contains("play-mode-active"),
                index: currentSlideIndex, reveal: Reveal.getIndices(),
                audio: [...document.querySelectorAll("#slides-container audio")].map(a => ({
                    paused: a.paused, src: a.currentSrc, ready: a.readyState,
                    autoplay: a.dataset.sfAutoplay, started: a.dataset.started, error: a.error?.message,
                })),
            })));
            throw error;
        });
        await page.waitForTimeout(2000);
        await page.keyboard.press("Shift+R");
        await page.waitForSelector("#sf-rec-save:not(.hidden)");
        const level = await page.evaluate(async () => {
            const blob = getPendingShowRecording().blob;
            const audio = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
            const data = audio.getChannelData(0);
            let peak = 0;
            for (const value of data) peak = Math.max(peak, Math.abs(value));
            return peak;
        });
        assert(level > 0.1, `the slide's sound is not in the recording (peak ${level.toFixed(3)})`);
        await page.locator('#sf-rec-save [data-rec-save="close"]').click();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.body.classList.contains("play-mode-active"));
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await browser.close();

    // Real tab capture (no fake screen): Chromium shares this tab itself, so Element Capture can be checked.
    const tabBrowser = await chromium.launch({
        headless: true,
        channel: "chromium",
        args: ["--auto-accept-this-tab-capture", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    const tabContext = await tabBrowser.newContext({ viewport: { width: 1280, height: 800 } });
    await tabContext.grantPermissions(["microphone"], { origin: new URL(TEST_URL).origin });

    await test("Show recorder: with Element Capture the video holds the slides, not the timer or the menus", async () => {
        const { page, errors } = await openEditor(tabContext);
        // A colour no slide uses, on the timer and the menu button, to look for in the video.
        await page.addStyleTag({ content: ".sf-show-hud__timer, .sf-show-hud__rec, .presentation-menu-toggle { background: rgb(255, 0, 255) !important; opacity: 1 !important; }" });
        await page.evaluate(() => localStorage.setItem("slideforge_show_timer", JSON.stringify({ visible: true })));
        await page.evaluate(() => { _showUi.timerVisible = true; });
        await startRecordingFromEditor(page);
        assert(await page.evaluate(() => _rec.stageOnly), "Element Capture was not applied");
        await page.mouse.move(400, 300);
        await page.waitForTimeout(800);
        const frame = await page.evaluate(async () => {
            const video = document.createElement("video");
            video.muted = true;
            video.srcObject = new MediaStream(_rec.display.getVideoTracks());
            await video.play();
            await new Promise(resolve => setTimeout(resolve, 600));
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let magenta = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] > 230 && data[i + 1] < 40 && data[i + 2] > 230) magenta += 1;
            const hud = document.querySelector("#sf-show-hud [data-hud-timer]");
            return { magenta, width: canvas.width, hudVisible: !!hud && !hud.hidden && hud.getBoundingClientRect().width > 0 };
        });
        assert(frame.hudVisible, "the timer is not on screen (nothing to keep out)");
        assert(frame.width > 0, "no picture captured");
        assert(frame.magenta === 0, `${frame.magenta} pixels of the timer or menu are in the video`);
        await page.keyboard.press("Escape");
        await page.waitForSelector("#sf-rec-save:not(.hidden)");
        assert(!errors.length, errors.join("\n"));
        await page.close();
    });

    await tabBrowser.close();
    console.log(`\n${results.passed.length} passed, ${results.failed.length} failed`);
    process.exitCode = results.failed.length ? 1 : 0;
})();
