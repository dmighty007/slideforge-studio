// Browser smoke checks for the built MkDocs site. Serve the build locally first.
const { chromium } = require("playwright");
const assert = require("assert/strict"), fs = require("fs"), path = require("path");
const BASE_URL = process.env.DOCS_TEST_URL || "http://127.0.0.1:8095/";
const OUT = path.resolve(process.env.DOCS_TEST_OUTPUT || "output/docs-refresh");
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const results = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
        const page = await context.newPage(), errors = [], external = [], externalAssets = [];
        page.on("pageerror", e => errors.push(e.message));
        page.on("request", r => {
            if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== new URL(BASE_URL).origin) {
                external.push(r.url());
                if (["font", "image", "stylesheet", "script"].includes(r.resourceType())) externalAssets.push(r.url());
            }
        });
        const pages = ["", "install/", "getting-started/", "features/", "guides/scientific-objects/", "guides/presenting/", "guides/import-export/", "showcase/"];
        async function ready(route) {
            const response = await page.goto(new URL(route, BASE_URL).href, { waitUntil: "networkidle" });
            assert.equal(response.status(), 200);
            await page.evaluate(async () => {
                document.querySelectorAll("main img").forEach(image => { image.loading = "eager"; });
                await document.fonts.ready;
                await Promise.all([...document.querySelectorAll("main img")].map(image => image.decode()));
            });
            assert.equal(await page.locator("main h1").count(), 1, "Each page needs one real heading");
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Horizontal page overflow: " + route);
            const text = await page.locator("main").textContent();
            assert(!/\]\([^)]*\.md\)/.test(text), "Unrendered Markdown links: " + route);
        }
        for (const route of pages) {
            await ready(route);
            results.push({ page: route || "/", viewport: "desktop", images: await page.locator("main img").count() });
        }
        await ready("");
        assert(await page.evaluate(() => document.fonts.check('700 24px "Space Grotesk"') && document.fonts.check('400 16px "DM Sans"')));
        await page.screenshot({ path: path.join(OUT, "home-desktop.png"), fullPage: true });
        await page.locator('label[title="Dark mode"]').click();
        await page.waitForFunction(() => document.body.getAttribute("data-md-color-scheme") === "slate");
        await page.screenshot({ path: path.join(OUT, "home-dark.png"), fullPage: true });
        await page.locator('label[title="Light mode"]').click();
        await page.waitForFunction(() => document.body.getAttribute("data-md-color-scheme") === "default");
        // Exercise real navigation, including instant navigation's document replacement.
        await page.locator(".sf-path").first().click();
        await page.waitForURL("**/install/");
        assert((await page.locator("main h1").textContent()).includes("Install"));
        await page.goto(new URL("features/", BASE_URL).href);
        await page.screenshot({ path: path.join(OUT, "capabilities-desktop.png"), fullPage: true });

        await page.setViewportSize({ width: 390, height: 844 });
        for (const route of pages) {
            await ready(route);
            results.push({ page: route || "/", viewport: "mobile" });
        }
        await ready("");
        await page.screenshot({ path: path.join(OUT, "home-mobile.png"), fullPage: true });
        await page.locator('.md-header label[for="__drawer"]').click();
        await page.waitForFunction(() => document.getElementById("__drawer").checked);
        await page.screenshot({ path: path.join(OUT, "mobile-navigation.png") });
        await page.keyboard.press("Escape");

        // Follow document-local links and images, including raw HTML links MkDocs doesn't validate.
        await page.goto(BASE_URL);
        const targets = await page.evaluate(() => [...document.querySelectorAll("main a[href], main img[src]")].map(el => el.href || el.src).filter(url => /^https?:/.test(url)));
        const local = [...new Set(targets.filter(target => new URL(target).origin === new URL(BASE_URL).origin).map(target => { const u = new URL(target); u.hash = ""; return u.href; }))];
        for (const target of local) assert((await context.request.get(target)).ok(), "Broken local home target: " + target);
        assert.deepEqual(errors, [], "Unexpected browser error");
        assert.deepEqual(externalAssets, [], "Documentation must not depend on external visual assets");
        fs.writeFileSync(path.join(OUT, "validation.json"), JSON.stringify({ results, localTargetsChecked: local.length, browserErrors: errors, externalRequests: external }, null, 2));
        console.log("PASS docs: desktop/mobile pages, images, typography, dark mode, instant navigation, mobile drawer, local links; no external visual assets", results.length);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
