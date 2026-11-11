// Disposable desktop backend required. Timings are measurements, not machine-specific pass thresholds.
// Usage: SLIDEFORGE_TEST_URL=http://127.0.0.1:8076/ node tests/browser/test-performance-soak.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const summarize = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return { median: +median.toFixed(2), p95: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(2), max: +sorted.at(-1).toFixed(2) };
};
(async () => {
    const browser = await chromium.launch();
    const results = { engine: browser.version(), viewport: '1440x1000', host: { platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length }, samples: [], errors: [] };
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.on('pageerror', error => results.errors.push(error.message));
        await page.goto(process.env.SLIDEFORGE_TEST_URL || 'http://127.0.0.1:8076/', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => _presentationPersistenceReady && currentAuthUser);
        await page.evaluate(async () => {
            await createNewProject(); closeStartScreen({ force: true });
            // Keep network writes out of rendering measurements. Saving is covered by the tab soak below.
            _presentationPersistenceEnabled = false; clearTimeout(_autosaveTimer);
        });
        const cdp = await page.context().newCDPSession(page);
        const resources = () => page.evaluate(() => ({
            charts: Object.values(Chart.instances).length,
            detachedCharts: Object.values(Chart.instances).filter(c => !c.canvas.isConnected).length,
            thumbnails: document.querySelectorAll('#slide-previews .slide-thumbnail > div').length,
            loadedEmbeds: document.querySelectorAll('#slides-container .html-embed-frame[srcdoc]').length,
            animatedBackgrounds: document.querySelectorAll('#slides-container [data-animating="true"]').length,
        }));
        const heap = async () => {
            await cdp.send('HeapProfiler.collectGarbage');
            return (await cdp.send('Runtime.getHeapUsage')).usedSize;
        };
        for (const kind of ['text', 'mixed']) {
            for (const count of [10, 50, 100, 200]) {
                const cold = await page.evaluate(({ kind, count }) => {
                    state = { ...buildDefaultPresentationState(), presentationTheme: 'blank', slides: Array.from({ length: count }, (_, i) => ({
                        id: `soak-${kind}-${i}`, layoutId: 'blank', masterId: 'none',
                        background: kind === 'mixed' ? { type: 'three', style: 'orbital' } : null,
                        elements: [
                            ...Array.from({ length: 5 }, (_, j) => ({ id: `soak-text-${i}-${j}`, type: 'text', content: `Slide ${i + 1}, text ${j + 1}`, x: 30, y: 30 + j * 65, width: 500, height: 55, styles: { fontSize: '24px' } })),
                            ...(kind === 'mixed' ? [
                                { id: `soak-chart-${i}`, type: 'chart', x: 550, y: 20, width: 350, height: 250, chartType: 'bar', chartData: { labels: ['A', 'B', 'C'], datasets: [{ label: 'Series', data: [2, 5, 3] }] }, styles: {} },
                                { id: `soak-html-${i}`, type: 'html', x: 550, y: 300, width: 350, height: 200, content: '<div>Animated embed</div><script>setInterval(()=>document.body.dataset.tick=String(Date.now()),16)</script>', styles: {} },
                            ] : []),
                        ],
                    })) };
                    undoStack = []; redoStack = []; setCurrentSlideIndex(0); Reveal.slide(0);
                    const start = performance.now(); renderSlidesFromState();
                    return performance.now() - start;
                }, { kind, count });
                await page.waitForTimeout(350);
                const timings = await page.evaluate(async () => {
                    const edit = [], navigation = [], frame = [], rebuiltSlides = [];
                    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
                    for (let i = 0; i < 20; i++) {
                        state.slides[currentSlideIndex].elements[0].x = 30 + i;
                        const before = [...document.querySelectorAll('#slides-container > section')];
                        const start = performance.now(); renderSlidesFromState(); edit.push(performance.now() - start);
                        const after = [...document.querySelectorAll('#slides-container > section')];
                        rebuiltSlides.push(after.filter((node, index) => node !== before[index]).length);
                        await nextFrame(); await nextFrame(); frame.push(performance.now() - start);
                    }
                    for (let i = 1; i <= 20; i++) {
                        const index = (i * 7) % state.slides.length;
                        const start = performance.now(); Reveal.slide(index); syncActiveSlideMedia();
                        await nextFrame(); await nextFrame(); navigation.push(performance.now() - start);
                    }
                    return { edit, navigation, frame, rebuiltSlides };
                });
                const current = await resources();
                assert.equal(current.detachedCharts, 0);
                assert(current.thumbnails < 15, `Thumbnail count grew with deck: ${JSON.stringify(current)}`);
                assert(current.loadedEmbeds <= 1);
                assert(current.animatedBackgrounds <= 1);
                const sample = { kind, slides: count, coldRenderMs: +cold.toFixed(2), editMs: summarize(timings.edit), rebuiltSlides: { firstEdit: timings.rebuiltSlides[0], median: summarize(timings.rebuiltSlides).median, max: Math.max(...timings.rebuiltSlides) }, editToFrameMs: summarize(timings.frame), navigationToFrameMs: summarize(timings.navigation), heapMiB: +((await heap()) / 1048576).toFixed(2), resources: current };
                results.samples.push({ ...sample, timingSamples: timings }); console.log(JSON.stringify(sample));
            }
        }
        // Same-size, repeated redraws should not retain old canvases or embed documents.
        await page.waitForTimeout(500);
        const heapBefore = await heap();
        const domBefore = await cdp.send('Memory.getDOMCounters');
        const batches = [];
        for (let batch = 0; batch < 5; batch++) {
            const duration = await page.evaluate(async () => {
                const start = performance.now();
                for (let i = 0; i < 40; i++) {
                    state.slides[currentSlideIndex].elements[0].x = 30 + i;
                    renderSlidesFromState();
                    await new Promise(resolve => requestAnimationFrame(resolve));
                }
                return performance.now() - start;
            });
            await page.waitForTimeout(150);
            const resourceCounts = await resources();
            assert.equal(resourceCounts.detachedCharts, 0);
            batches.push({ redraws: (batch + 1) * 40, durationMs: +duration.toFixed(2), heapMiB: +((await heap()) / 1048576).toFixed(2), resources: resourceCounts });
        }
        const growthMiB = +(((await heap()) - heapBefore) / 1048576).toFixed(2);
        results.redrawSoak = { batches, retainedHeapGrowthMiB: growthMiB, domBefore, domAfter: await cdp.send('Memory.getDOMCounters') };
        assert(growthMiB < 40, `Excessive retained heap after 200 redraws: ${growthMiB} MiB`);
        // Exercise real saves and in-memory restores across multiple open project tabs.
        results.tabs = await page.evaluate(async () => {
            _presentationPersistenceEnabled = true;
            const ids = [], errors = [], times = [];
            for (let i = 0; i < 6; i++) {
                await createNewProject();
                state.slides = Array.from({ length: 10 }, (_, j) => ({ id: generateId('soak-tab-slide'), layoutId: 'blank', masterId: 'none', elements: [{ id: generateId('soak-tab-text'), type: 'text', x: 20, y: 20, width: 500, height: 80, content: `Project ${i}, slide ${j}`, styles: {} }] }));
                setCurrentPresentationTitle(`Soak project ${i}`); renderSlidesFromState(); await autosavePresentationNow();
                ids.push(currentPresentationId);
            }
            for (let cycle = 0; cycle < 10; cycle++) {
                for (let i = 0; i < ids.length; i++) {
                    const start = performance.now();
                    await activateProjectTab(ids[i]);
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    times.push(performance.now() - start);
                    if (currentPresentationId !== ids[i] || !state.slides[0].elements[0].content.includes(`Project ${i},`)) errors.push(`Wrong state at cycle ${cycle}, tab ${i}`);
                    state.slides[0].notes = `Cycle ${cycle}`;
                }
            }
            await autosavePresentationNow();
            for (let i = 0; i < ids.length; i++) {
                const saved = await _presentationRequest(`/api/presentations/${ids[i]}/`, { method: 'GET' });
                if (saved.state.slides.length !== 10 || saved.state.slides[0].notes !== 'Cycle 9' || !saved.state.slides[0].elements[0].content.includes(`Project ${i},`)) errors.push(`Saved state differs for tab ${i}`);
            }
            const tabs = _openProjectTabs.size;
            for (const id of [..._openProjectTabs.keys()]) {
                if (id !== String(currentPresentationId)) await closeProjectTab(id);
            }
            return { switches: times.length, times, errors, tabs, remainingTabs: _openProjectTabs.size };
        });
        assert.deepEqual(results.tabs.errors, []);
        assert.equal(results.tabs.remainingTabs, 1, 'Closing tabs releases their cached sessions');
        results.tabs.switchMs = summarize(results.tabs.times); delete results.tabs.times;
        assert.equal((await resources()).detachedCharts, 0);
        assert.deepEqual(results.errors, []);
        console.log('PASS Performance scaling, 200-redraw resource soak, 60 saved project-tab switches');
    } finally {
        const output = process.env.SLIDEFORGE_PERF_OUTPUT;
        if (output) fs.writeFileSync(output, JSON.stringify(results, null, 2));
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
