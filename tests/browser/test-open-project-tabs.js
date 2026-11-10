// Requires a fresh desktop-configured backend (tools/run-audit-server.py).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(process.env.SLIDEFORGE_TEST_URL || 'http://127.0.0.1:8076/', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => _presentationPersistenceReady && currentAuthUser);
        const first = await page.evaluate(async () => {
            await createNewProject();
            closeStartScreen({ force: true });
            setCurrentPresentationTitle('Project Alpha');
            saveStateToUndo();
            state.slides[0].notes = 'Alpha edits';
            state.slides.push(structuredClone(state.slides[0]));
            state.slides[1].id = generateId('slide');
            currentSlideIndex = 1;
            await autosavePresentationNow();
            return currentPresentationId;
        });
        const second = await page.evaluate(async () => {
            await createNewProject();
            setCurrentPresentationTitle('Project Beta');
            state.slides[0].notes = 'Beta edits';
            await autosavePresentationNow();
            return currentPresentationId;
        });
        assert.equal(await page.locator('#project-tabs [role="tab"]').count(), 2);
        await page.fill('#project-title-input', 'Renamed Beta');
        await page.getByRole('tab', { name: 'Project Alpha', exact: true }).click();
        await page.waitForFunction(id => currentPresentationId === id && !_projectTabBusy, first);
        assert.deepEqual(await page.evaluate(() => ({ notes: state.slides[0].notes, slide: currentSlideIndex, undo: undoStack.length })), { notes: 'Alpha edits', slide: 1, undo: 1 });
        await page.evaluate(() => loadProjectById(currentPresentationId));
        assert.equal(await page.locator('#project-tabs [role="tab"]').count(), 2);
        await page.getByRole('tab', { name: 'Renamed Beta', exact: true }).click();
        await page.waitForFunction(id => currentPresentationId === id && !_projectTabBusy, second);
        assert.equal(await page.evaluate(() => state.slides[0].notes), 'Beta edits');
        assert.equal(await page.evaluate(() => undoStack.length), 0);
        // A close saves pending edits and chooses a neighbouring tab; it does not delete the project.
        await page.evaluate(() => { state.slides[0].notes = 'Saved on close'; });
        await page.getByRole('button', { name: 'Close Renamed Beta', exact: true }).click();
        await page.waitForFunction(id => currentPresentationId === id && !_projectTabBusy, first);
        assert.equal(await page.locator('#project-tabs [role="tab"]').count(), 1);
        assert.equal(await page.evaluate(async id => (await _presentationRequest(`/api/presentations/${id}/`, { method: 'GET' })).state.slides[0].notes, second), 'Saved on close');
        await page.evaluate(id => loadProjectById(id), second);
        assert.equal(await page.locator('#project-tabs [role="tab"]').count(), 2);
        // Failed saves must keep the tab and its edits available.
        await page.route('**/api/presentations/*/', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' }) : route.continue());
        await page.evaluate(() => { state.slides[0].notes = 'Unsaved Beta'; });
        await page.getByRole('button', { name: 'Close Renamed Beta', exact: true }).click();
        await page.waitForFunction(() => !_projectTabBusy);
        assert.equal(await page.evaluate(() => currentPresentationId), second);
        assert.equal(await page.locator('#project-tabs [role="tab"]').count(), 2);
        await page.unroute('**/api/presentations/*/');
        await page.getByRole('button', { name: 'Close Project Alpha', exact: true }).click();
        assert.equal(await page.locator('#project-tabs [role="tab"]').count(), 1);
        // One open project needs no tab strip.
        assert.equal(await page.locator('#project-tabs').isVisible(), false);
        // Ctrl+O opens the project library (on its Projects tab), not the browser's file picker.
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Control+o');
        await page.waitForFunction(() => isStartScreenOpen());
        assert.equal(await page.locator('#sf-tab-projects').getAttribute('aria-selected'), 'true');
        await page.waitForFunction(() => document.activeElement?.id === 'sf-tab-projects');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !isStartScreenOpen());
        await page.evaluate(() => openStartScreen());
        await page.keyboard.press('Control+o');
        assert.equal(await page.locator('#sf-tab-projects').getAttribute('aria-selected'), 'true');
        assert.deepEqual(errors, []);
        console.log('PASS Open project tabs: independent state/history, deduplication, closing, persistence, save failure, hidden for one project, Ctrl+O');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
