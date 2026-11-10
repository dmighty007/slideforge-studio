// Isolated browser coverage for the project library using the real UI and styles.
const { chromium } = require('playwright');
const fs = require('fs');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ reducedMotion: 'reduce' });
        await page.route('http://projects.test/**', route => route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }));
        await page.goto('http://projects.test/');
        await page.addStyleTag({ content: '* { box-sizing: border-box; } body { margin: 0; }' });
        await page.addStyleTag({ content: fs.readFileSync('frontend/css/start-screen.css', 'utf8') });
        await page.evaluate(() => {
            window.PRESENTATION_THEMES = { blank: { label: 'Blank' } };
            window.currentPresentationId = 'a';
            window._backendApiAvailable = true;
            window.currentAuthUser = { id: 1 };
            window.closeEditorDialogs = () => {};
            window.projects = [
                { id: 'a', title: 'Zebra', updatedAt: '2026-11-10', slideCount: 2 },
                { id: 'b', title: 'Alpha', updatedAt: '2026-11-09', slideCount: 1 },
            ];
            window._presentationRequest = async (url, options) => {
                if (window.failRequest) throw new Error('Offline');
                if (options.method === 'DELETE') window.projects = window.projects.filter(p => !url.includes(p.id + '/'));
                return { presentations: window.projects.slice() };
            };
            window.loadProjectById = async id => { window.currentPresentationId = id; return true; };
        });
        await page.addScriptTag({ content: fs.readFileSync('frontend/js/ui/start-screen.js', 'utf8') });
        await page.evaluate(() => openProjectsTab());
        await page.waitForSelector('.sf-card');
        assert.equal(await page.locator('#sf-tab-projects').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('.sf-start__create').isVisible(), false);
        const titles = () => page.locator('.sf-card__title').allTextContents();
        assert.deepEqual(await titles(), ['Zebra', 'Alpha']);
        await page.selectOption('#sf-project-sort', 'title');
        assert.deepEqual(await titles(), ['Alpha', 'Zebra']);
        await page.fill('#sf-start-search', 'zeb');
        assert.deepEqual(await titles(), ['Zebra']);
        assert.equal(await page.locator('#sf-project-count').textContent(), '1 of 2 projects');
        await page.fill('#sf-start-search', 'missing');
        assert.match(await page.locator('#sf-start-recent').textContent(), /No presentations match/);
        await page.fill('#sf-start-search', '');
        await page.locator('#sf-tab-projects').focus();
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.locator('#sf-tab-home').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('.sf-start__create').isVisible(), true);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('#start-screen button, #start-screen input, #start-screen select, #start-screen [tabindex]')].filter(node => !node.disabled && node.tabIndex >= 0 && node.offsetParent !== null).at(-1)), true);
        await page.locator('[aria-label="Delete Alpha"]').click();
        await page.locator('.sf-danger').click();
        await page.waitForFunction(() => document.querySelectorAll('.sf-card').length === 1);
        assert.deepEqual(await titles(), ['Zebra']);
        await page.evaluate(() => { window.failRequest = true; });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.waitForSelector('.sf-recent__message');
        assert.match(await page.locator('#sf-start-recent').textContent(), /could not be loaded/);
        await page.evaluate(() => { window.failRequest = false; });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.waitForSelector('.sf-card');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.querySelector('.sf-start__panel').scrollWidth > document.querySelector('.sf-start__panel').clientWidth), false);
        await page.locator('.sf-card').click();
        await page.waitForFunction(() => !isStartScreenOpen());
        console.log('PASS Projects tab: navigation, sorting, search, deletion, load recovery, mobile layout, opening');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
