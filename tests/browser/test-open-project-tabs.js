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
        // One open project needs no tab strip (Ctrl+W closes it).
        assert.equal(await page.locator('#project-tabs').isVisible(), false);
        // Ctrl+O opens the project library (on its Projects tab), not the browser's file picker.
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Control+o');
        await page.waitForFunction(() => isStartScreenOpen());
        assert.equal(await page.locator('#sf-tab-projects').getAttribute('aria-selected'), 'true');
        await page.waitForFunction(() => document.activeElement?.id === 'sf-tab-projects');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !isStartScreenOpen());
        // Importing the same file again updates its already-opened tab in place instead of spawning a new tab.
        const reimportResult = await page.evaluate(async () => {
            const makePptx = async (slideText) => {
                const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
                const zip = new JSZip();
                zip.file("ppt/presentation.xml", `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
                zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
                zip.file("ppt/slides/slide1.xml", `<p:sld ${ns}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="6000000" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2400"/><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
                return new File([await zip.generateAsync({ type: "blob" })], "SameDeck.pptx");
            };
            await importPptx(await makePptx("Version One"));
            const firstImportId = currentPresentationId;
            const tabCountAfterFirst = document.querySelectorAll('#project-tabs [role="tab"]').length;

            // Re-import the exact same file name with updated slide text
            await importPptx(await makePptx("Version Two"));
            const secondImportId = currentPresentationId;
            const tabCountAfterSecond = document.querySelectorAll('#project-tabs [role="tab"]').length;
            const currentText = state.slides[0]?.elements?.map(el => el.content || "").join(" ");
            return {
                firstImportId,
                secondImportId,
                title: currentPresentationTitle,
                tabCountAfterFirst,
                tabCountAfterSecond,
                currentText,
            };
        });
        assert.equal(reimportResult.secondImportId, reimportResult.firstImportId);
        assert.equal(reimportResult.title, 'SameDeck');
        assert.equal(reimportResult.tabCountAfterSecond, reimportResult.tabCountAfterFirst);
        assert.match(reimportResult.currentText, /Version Two/);
        // Ctrl+W closes the open project like its tab's ×, and moves to the neighbouring tab.
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Control+w');
        await page.waitForFunction(() => !_projectTabBusy && _openProjectTabs.size === 1);
        assert.equal(await page.evaluate(() => currentPresentationTitle), 'Renamed Beta');
        assert.equal(await page.locator('#project-tabs').isVisible(), false);
        // Ctrl+W on the only project saves it (an edit still being typed in the title field too), keeps it, and goes
        // to the home screen with nothing open.
        const lastId = await page.evaluate(() => currentPresentationId);
        await page.evaluate(() => { state.slides[0].notes = 'Saved on last close'; });
        await page.fill('#project-title-input', 'Typed Then Closed');
        await page.keyboard.press('Control+w');
        await page.waitForFunction(() => isStartScreenOpen() && !_projectTabBusy);
        assert.deepEqual(await page.evaluate(() => ({ id: currentPresentationId, tabs: _openProjectTabs.size, stored: localStorage.getItem(PRESENTATION_STORAGE_KEY) })), { id: null, tabs: 0, stored: null });
        assert.equal(await page.locator('#project-tabs').isVisible(), false);
        const saved = await page.evaluate(async id => _presentationRequest(`/api/presentations/${id}/`, { method: 'GET' }), lastId);
        assert.deepEqual({ notes: saved.state.slides[0].notes, title: saved.title }, { notes: 'Saved on last close', title: 'Typed Then Closed' });
        // Nothing to go back to: Escape keeps the home screen, and no project is created behind it.
        const projectCount = await page.evaluate(async () => (await listSavedProjects()).length);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
        assert.equal(await page.evaluate(() => isStartScreenOpen()), true);
        assert.equal(await page.evaluate(async () => (await listSavedProjects()).length), projectCount);
        // Ctrl+W on the home screen does nothing; opening a project from the library brings it back.
        await page.keyboard.press('Control+w');
        assert.equal(await page.evaluate(() => isStartScreenOpen()), true);
        await page.evaluate(id => loadProjectById(id), lastId);
        assert.equal(await page.evaluate(() => _openProjectTabs.size), 1);
        await page.evaluate(() => openStartScreen());
        await page.keyboard.press('Control+o');
        assert.equal(await page.locator('#sf-tab-projects').getAttribute('aria-selected'), 'true');
        assert.deepEqual(errors, []);
        console.log('PASS Open project tabs: independent state/history, deduplication, closing, persistence, save failure, Ctrl+W closes the project (the last one goes home), Ctrl+O');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
