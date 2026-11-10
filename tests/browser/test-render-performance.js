// Requires a disposable desktop-configured backend (tools/run-audit-server.py).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.goto(process.env.SLIDEFORGE_TEST_URL || 'http://127.0.0.1:8076/', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => _presentationPersistenceReady && currentAuthUser);
        await page.evaluate(async () => {
            await createNewProject();
            closeStartScreen({ force: true });
            state.slides = Array.from({ length: 40 }, (_, i) => ({
                id: `perf-slide-${i}`, layoutId: 'blank', masterId: 'none',
                elements: [
                    { id: `perf-html-${i}`, type: 'html', x: 10, y: 10, width: 200, height: 150,
                      content: '<script>window.perfRunning=true</script><div>Embed</div>', styles: {} },
                    { id: `perf-chart-${i}`, type: 'chart', x: 220, y: 10, width: 200, height: 150, styles: {} },
                ],
            }));
            setCurrentSlideIndex(0);
            renderSlidesFromState();
            window.focus();
            syncActiveSlideMedia();
        });
        await page.waitForFunction(() => document.querySelector('#perf-html-0 iframe').hasAttribute('srcdoc'));
        assert.equal(await page.locator('#slides-container iframe[srcdoc]').count(), 1);
        await page.waitForFunction(() => document.querySelectorAll('#slide-previews .slide-thumbnail > div').length > 0);
        assert((await page.locator('#slide-previews .slide-thumbnail > div').count()) < 15, 'Only nearby thumbnails should render');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#slide-previews iframe')].some(f => f.sandbox.contains('allow-scripts'))), false);
        await page.evaluate(() => { Reveal.slide(20); syncActiveSlideMedia(); });
        await page.waitForFunction(() => document.querySelector('#perf-html-20 iframe').hasAttribute('srcdoc'));
        assert.equal(await page.locator('#perf-html-0 iframe[srcdoc]').count(), 0);
        assert.equal(await page.locator('#slides-container iframe[srcdoc]').count(), 1);
        await page.evaluate(() => { for (let i = 0; i < 5; i++) renderSlidesFromState(); });
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => Object.values(Chart.instances).filter(chart => !chart.canvas.isConnected).length), 0, 'Discarded charts must leave the Chart.js registry');
        assert.equal(await page.evaluate(() => Object.values(Chart.instances).every(chart => chart.options.animation === false)), true);
        // Deferring must not blank what other views show of a slide not opened yet.
        const deferred = await page.evaluate(async () => {
            const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
            const molecule = typeof createMoleculeElementData === 'function' ? createMoleculeElementData() : {};
            state.slides = [0, 1, 2].map(i => ({
                id: `defer-slide-${i}`, layoutId: 'blank', masterId: 'none',
                elements: i === 0 ? [] : [
                    { id: `defer-html-${i}`, type: 'html', x: 10, y: 10, width: 200, height: 150, content: `<p>Embed ${i}</p>`, styles: {} },
                    { id: `defer-mol-${i}`, type: 'molecule', x: 300, y: 10, width: 300, height: 220, styles: {}, ...molecule },
                ],
            }));
            setCurrentSlideIndex(0);
            renderSlidesFromState();
            Reveal.slide(0);
            syncActiveSlideMedia();
            await sleep(300);
            const live = document.querySelector('#slides-container #defer-html-1 iframe');
            const copy = new DOMParser().parseFromString(_presenterSectionHtml(live.closest('section'), { arrivalOf: 1 }), 'text/html');
            // The presenter's next slide: its embeds keep their content, the editor's frames stay unloaded.
            const presenter = {
                editorFrameLoaded: live.hasAttribute('srcdoc'),
                html: (copy.querySelector('.html-embed-frame')?.getAttribute('srcdoc') || '').includes('Embed 1'),
                molecule: !!copy.querySelector('.molecule-embed-frame')?.getAttribute('srcdoc'),
            };
            // The rail: a molecule on a slide not opened yet still gets its picture.
            let picture = null;
            for (let tries = 0; tries < 40 && !picture; tries++) { await sleep(250); picture = moleculeThumbnail('defer-mol-1'); }
            await sleep(500);
            const card = document.querySelectorAll('#slide-previews .slide-thumbnail')[1];
            // Presenting with the presenter view: the audience window has no focus, its embeds must still load.
            const realFocus = Document.prototype.hasFocus;
            Document.prototype.hasFocus = () => false;
            Reveal.slide(2);
            syncActiveSlideMedia();
            const unfocusedLoads = document.querySelector('#slides-container #defer-html-2 iframe').hasAttribute('srcdoc');
            Document.prototype.hasFocus = realFocus;
            return { presenter, picture: !!picture, thumbnailShowsPicture: !!card?.querySelector('img'), unfocusedLoads };
        });
        assert.deepEqual(deferred.presenter, { editorFrameLoaded: false, html: true, molecule: true }, 'presenter next slide');
        assert.equal(deferred.picture, true, 'A molecule on an unopened slide gets its thumbnail picture');
        assert.equal(deferred.thumbnailShowsPicture, true, 'The rail shows that picture, not the atom icon');
        assert.equal(deferred.unfocusedLoads, true, 'Embeds load on the slide shown even when the window has no focus');
        console.log('PASS Deferred embeds, bounded thumbnails, inactive HTML suspension, chart cleanup, presenter preview, molecule thumbnails, unfocused window');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
