// Start screen: recent presentations, new / themed decks, open, delete, search, keyboard.
// Usage: SLIDEFORGE_TEST_URL=<launch URL> node tests/browser/test-start-screen.js
// Needs the saving API and a signed-in session (the desktop app always has one); use a fresh data directory.
const { chromium } = require("playwright");

const TEST_URL = process.env.SLIDEFORGE_TEST_URL || "http://127.0.0.1:8076/";
const results = { passed: [], failed: [] };

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function test(name, fn) {
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
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ...(process.env.SLIDEFORGE_STORAGE_STATE ? { storageState: process.env.SLIDEFORGE_STORAGE_STATE } : {}),
    });
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => {
        errors.push(`unexpected dialog: ${dialog.message()}`);
        dialog.dismiss();
    });
    page.on("request", request => {
        if (request.method() !== "GET" && request.url().includes("/api/presentations")) writes.push(request.method());
    });
    await page.goto(TEST_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#start-screen:not([hidden])", { timeout: 10000 });
    await page.waitForTimeout(1500);
    const listed = () => page.evaluate(() => [...document.querySelectorAll(".sf-card .sf-card__title")].map(el => el.textContent));

    await test("opens on launch and creates nothing until the user chooses", async () => {
        await page.waitForTimeout(2000); // longer than the autosave debounce
        assert(writes.length === 0, `launch wrote to the server: ${writes.join(",")}`);
        assert(await page.evaluate(() => currentPresentationId === null), "a project was opened without being chosen");
        assert(await page.locator("#sf-start-close").isHidden(), "'Back to editor' shown with no project open");
        await page.keyboard.press("Escape");
        assert(await page.evaluate(() => isStartScreenOpen()), "Escape closed the screen with no project open");
    });

    await test("New presentation creates a project and shows the editor", async () => {
        await page.locator("#sf-start-new").click();
        await page.waitForFunction(() => !isStartScreenOpen() && currentPresentationId);
        assert(writes.filter(m => m === "POST").length === 1, `expected one created project, saw ${writes.join(",")}`);
    });

    await test("a theme tile creates a project in that theme", async () => {
        await page.evaluate(() => openStartScreen());
        await page.waitForSelector(".sf-card");
        const first = await page.evaluate(() => currentPresentationId);
        await page.locator(".sf-theme", { hasText: "Graphite" }).click();
        await page.waitForFunction(id => !isStartScreenOpen() && currentPresentationId && currentPresentationId !== id, first);
        assert((await page.evaluate(() => state.presentationTheme)) === "graphite", "theme was not applied");
        await page.waitForTimeout(800);
    });

    await test("the screen grows with a large or maximised window, and a long recent list keeps full-size cards", async () => {
        await page.evaluate(() => openStartScreen());
        await page.waitForSelector(".sf-card");
        const original = page.viewportSize();
        const fill = {};
        // Large and very large monitors: the panel fills the window with a slim margin on every side.
        for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]]) {
            await page.setViewportSize({ width: w, height: h });
            await page.waitForTimeout(300);
            fill[w] = await page.evaluate(async () => {
                const panel = document.querySelector(".sf-start__panel");
                await Promise.all(panel.getAnimations().map(a => a.finished.catch(() => {})));
                const r = panel.getBoundingClientRect();
                return Math.max(r.left, innerWidth - r.right, r.top, innerHeight - r.bottom);
            });
        }
        // Hundreds of decks: rows stay as tall as their cards (they were squeezed into thin lines).
        const heights = await page.evaluate(() => {
            const grid = document.querySelector(".sf-recent__grid");
            const card = grid.querySelector(".sf-card");
            for (let i = 0; i < 300; i += 1) grid.appendChild(card.cloneNode(true));
            const cards = [...grid.querySelectorAll(".sf-card")];
            const result = { first: Math.round(cards[0].getBoundingClientRect().height), last: Math.round(cards[cards.length - 1].getBoundingClientRect().height) };
            cards.slice(1).forEach(c => c.remove());
            return result;
        });
        await page.setViewportSize(original);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !isStartScreenOpen());
        assert(heights.first > 150 && heights.last > 150, `card heights with 300 decks: ${JSON.stringify(heights)}`);
        assert(Object.values(fill).every(margin => margin <= 24), `largest margin around the panel (px): ${JSON.stringify(fill)}`);
        // Mid-size windows fill too (a 1440px window had 80px each side).
        const mid = {};
        await page.evaluate(() => openStartScreen());
        for (const [w, h] of [[1440, 900], [1600, 900]]) {
            await page.setViewportSize({ width: w, height: h });
            await page.waitForTimeout(300);
            // Measured once the panel's opening animation (a slight scale-up) is over; mid-animation it read 50px.
            mid[w] = await page.evaluate(async () => {
                const panel = document.querySelector(".sf-start__panel");
                await Promise.all(panel.getAnimations().map(a => a.finished.catch(() => {})));
                const r = panel.getBoundingClientRect();
                return Math.round(Math.max(r.left, innerWidth - r.right));
            });
        }
        await page.setViewportSize(original);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !isStartScreenOpen());
        assert(Object.values(mid).every(margin => margin <= 44), `side margins at mid sizes (px): ${JSON.stringify(mid)}`);
    });

    await test("More themes shows every theme as a tile", async () => {
        await page.evaluate(() => openStartScreen());
        await page.waitForSelector(".sf-theme");
        const before = await page.locator(".sf-theme").count();
        await page.locator(".sf-more-themes").click();
        const after = await page.locator(".sf-theme").count();
        const total = await page.evaluate(() => Object.keys(PRESENTATION_THEMES).length);
        assert(before === 6 && after === total && !(await page.locator(".sf-more-themes").count()), `tiles ${before} -> ${after} of ${total}`);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !isStartScreenOpen());
    });

    await test("recent list shows both decks, marks the open one, and Escape returns to the editor", async () => {
        await page.evaluate(() => openStartScreen());
        await page.waitForFunction(() => document.querySelectorAll(".sf-card").length === 2);
        assert((await page.locator(".sf-card--current").count()) === 1, "open deck is not marked");
        assert(await page.locator("#sf-start-close").isVisible(), "'Back to editor' missing with a project open");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !isStartScreenOpen());
    });

    await test("clicking a recent deck opens it", async () => {
        const before = await page.evaluate(() => currentPresentationId);
        await page.evaluate(() => openStartScreen());
        await page.waitForFunction(() => document.querySelectorAll(".sf-card").length === 2);
        await page.locator(".sf-card:not(.sf-card--current)").click();
        await page.waitForFunction(id => !isStartScreenOpen() && currentPresentationId !== id, before);
    });

    await test("search filters the list", async () => {
        await page.evaluate(() => {
            setCurrentPresentationTitle("Quarterly results");
            return autosavePresentationNow();
        });
        await page.evaluate(() => openStartScreen());
        await page.waitForFunction(() => document.querySelectorAll(".sf-card").length === 2);
        await page.locator("#sf-start-search").fill("quarterly");
        const shown = await listed();
        assert(shown.length === 1 && shown[0] === "Quarterly results", `unexpected results: ${shown}`);
        await page.locator("#sf-start-search").fill("zzz-no-match");
        assert((await page.locator(".sf-recent__message").count()) === 1, "no 'no match' message");
        await page.locator("#sf-start-search").fill("");
    });

    await test("Delete key on a card asks first and does not touch the editor behind", async () => {
        const elementsBefore = await page.evaluate(() => {
            const slide = state.slides[currentSlideIndex];
            if (slide.elements[0]) selectElement(slide.elements[0].id);
            return slide.elements.length;
        });
        await page.locator(".sf-card").first().focus();
        await page.keyboard.press("Delete");
        assert((await page.locator(".sf-card__confirm").count()) === 1, "no confirmation shown");
        await page.locator(".sf-card__confirm .sf-cancel").click();
        const elementsAfter = await page.evaluate(() => state.slides[currentSlideIndex].elements.length);
        assert(elementsAfter === elementsBefore, "the editor handled the Delete key behind the start screen");
        assert((await listed()).length === 2, "cancel deleted the deck");
    });

    await test("deleting another deck removes it from the list and the server", async () => {
        const other = page.locator(".sf-card:not(.sf-card--current)");
        const title = await other.locator(".sf-card__title").textContent();
        await other.hover();
        await other.locator(".sf-card__delete").click();
        await page.locator(".sf-card__confirm .sf-danger").click();
        await page.waitForFunction(t => ![...document.querySelectorAll(".sf-card__title")].some(el => el.textContent === t), title);
        const remaining = await page.evaluate(async () => (await (await fetch("/api/presentations/")).json()).presentations.length);
        assert(remaining === 1, `server still has ${remaining} decks`);
    });

    await test("deleting the open deck keeps the start screen up with nothing open", async () => {
        const current = page.locator(".sf-card--current");
        await current.hover();
        await current.locator(".sf-card__delete").click();
        await page.locator(".sf-card__confirm .sf-danger").click();
        await page.waitForSelector(".sf-recent__empty");
        assert(await page.evaluate(() => currentPresentationId === null && isStartScreenOpen()), "state after deleting the open deck");
        assert(await page.locator("#sf-start-close").isHidden(), "'Back to editor' offered with no deck open");
    });

    await test("no page errors or dialogs", async () => {
        assert(!errors.length, errors.join(" | "));
    });

    await browser.close();
    console.log(`\n${results.passed.length} passed, ${results.failed.length} failed`);
    process.exit(results.failed.length ? 1 : 0);
})();
