/**
 * A PDF opened as slides, to present it here: a talk exported from Beamer, PowerPoint or Keynote, or any document.
 * The server draws each page as a picture (studio/views.py, import_pdf_view); each becomes the background of a
 * slide of its own, so the show, presenter view, notes, the laser pointer and drawing on slides all work, and
 * objects can be added over a page. Links in the PDF (to a web page, or another page) stay clickable while
 * presenting. The text is part of the pictures: it cannot be edited.
 * Uses _keynoteUpload from importKeynote.js (loaded before this file).
 */

// The page setups a PDF's pages may get: the one closest to the first page's proportions (Beamer's 4:3, 16:9 and
// 16:10 match exactly; a portrait document gets the paper or poster page).
const PDF_SLIDES_PAGE_SETUPS = ["talk-16-9", "lecture-16-10", "standard-4-3", "paper-letter", "poster-portrait"];

function _pdfSlidesPageSetup(width, height) {
    const ratio = width / Math.max(1, height);
    const setups = Object.values(window.PRESENTATION_PAGE_SETUPS || {}).filter(setup => PDF_SLIDES_PAGE_SETUPS.includes(setup.id));
    return setups.sort((a, b) => Math.abs(Math.log(a.width / a.height / ratio)) - Math.abs(Math.log(b.width / b.height / ratio)))[0] || { id: "talk-16-9", width: 1280, height: 720 };
}

// An invisible box over a link on the page, which a click while presenting follows (element.clickLink).
const PDF_LINK_PICTURE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')}`;

function _pdfLinkElement(link, href, place, zIndex) {
    const width = Math.max(4, link.width * place.scale);
    const height = Math.max(4, link.height * place.scale);
    return {
        id: generateId("el"),
        type: "image",
        content: PDF_LINK_PICTURE,
        x: Math.round(place.left + link.x * place.scale),
        y: Math.round(place.top + link.y * place.scale),
        width: `${Math.round(width)}px`,
        height: `${Math.round(height)}px`,
        lockAspectRatio: false,
        imageAspectRatio: width / height,
        cropTransform: { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 },
        heightSetManually: true,
        clickLink: href,
        styles: { zIndex, borderRadius: "0px" },
    };
}

async function importPdfSlides(file) {
    const name = String(file.name || "Imported PDF").replace(/\.pdf$/i, "");
    const busy = sfBusyStart({ title: `Opening ${file.name || "PDF"} as slides`, detail: "Preparing…", progress: 0, delay: 0 });
    try {
        setProjectSaveHint?.("Reading PDF…", "muted");
        // Its own project first, so the pictures the server stores belong to it.
        busy.update({ detail: "Saving the open project…" });
        if (typeof startNewProjectForImport === "function") await startNewProjectForImport();

        const form = new FormData();
        form.append("file", file, file.name || "slides.pdf");
        if (typeof currentPresentationId !== "undefined" && currentPresentationId) form.append("presentationId", currentPresentationId);
        const megabytes = (file.size || 0) / (1024 * 1024);
        const response = await _keynoteUpload(
            form,
            (sent, finished) => {
                if (finished) busy.update({ detail: "Drawing the pages…", progress: null });
                else busy.update({ detail: `Uploading ${(sent * megabytes).toFixed(1)} of ${megabytes.toFixed(1)} MB`, progress: 0.6 * sent });
            },
            "/api/presentations/import/pdf/",
        );
        const result = response.deck || {};
        if (!response.ok) throw new Error(result.error || `the server answered ${response.status}`);
        const pages = Array.isArray(result.pages) ? result.pages : [];
        if (!pages.length) throw new Error("No pages found in this PDF");

        const setup = _pdfSlidesPageSetup(Number(pages[0].width) || 4, Number(pages[0].height) || 3);
        const slideIds = pages.map(() => generateId("slide"));
        let links = 0;
        const slides = pages.map((page, index) => {
            const pw = Math.max(1, Number(page.width) || setup.width);
            const ph = Math.max(1, Number(page.height) || setup.height);
            // Where the page lies on the slide: fitted inside it, centred ("contain"), as the background is drawn.
            const scale = Math.min(setup.width / pw, setup.height / ph);
            const place = { scale, left: (setup.width - pw * scale) / 2, top: (setup.height - ph * scale) / 2 };
            const elements = (page.links || [])
                .map(link => {
                    const href = link.href || (link.page && slideIds[link.page - 1] ? `#slide:${slideIds[link.page - 1]}` : null);
                    return href && typeof isSafeClickLink === "function" && isSafeClickLink(href) ? _pdfLinkElement(link, href, place, 0) : null;
                })
                .filter(Boolean)
                .map((el, i) => ({ ...el, styles: { ...el.styles, zIndex: i + 1 } }));
            links += elements.length;
            return {
                id: slideIds[index],
                layoutId: "blank",
                masterId: "none",
                notes: "",
                background: { type: "image", content: page.src, mimeType: page.contentType || "", fit: "contain" },
                elements,
            };
        });

        busy.update({ detail: `Making ${slides.length} slides…`, progress: 0.95 });
        await sfBusyPaint();
        state.pageSetup = setup.id;
        syncPresentationPageSetup?.();
        state.slides = slides;
        const title = typeof uniqueImportTitle === "function" ? await uniqueImportTitle(name) : name;
        setCurrentPresentationTitle?.(title);
        resetUndoHistory?.();
        setCurrentSlideIndex?.(0);
        clearSelection?.();
        renderSlidesFromState?.();
        updateSlideCounter?.();
        if (typeof Reveal !== "undefined" && typeof Reveal.slide === "function") Reveal.slide(0);
        requestAnimationFrame(() => {
            if (typeof Reveal !== "undefined" && Reveal.layout) Reveal.layout();
            if (typeof zoomMode !== "undefined") zoomMode = "fit";
            if (typeof calculateFitZoom === "function" && typeof stateZoom !== "undefined") stateZoom = calculateFitZoom();
            if (typeof applyZoom === "function") applyZoom();
        });
        const summary = `${slides.length} ${slides.length === 1 ? "slide" : "slides"}${links ? `, ${links} ${links === 1 ? "link" : "links"}` : ""}`;
        setProjectSaveHint?.(`Opened ${summary} from the PDF`, "success");
        busy.update({ detail: `Opened ${summary}`, progress: 1 });
        schedulePresentationAutosave?.();
    } catch (err) {
        console.error("PDF import error:", err);
        busy.done(); // gone before the alert, which blocks the page
        alert("Failed to open the PDF as slides: " + err.message);
        setProjectSaveHint?.("Import failed", "danger");
    } finally {
        busy.done();
    }
}

function triggerImportPdfSlides() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.onchange = e => {
        const file = e.target.files[0];
        if (file) importPdfSlides(file);
    };
    input.click();
}

window.importPdfSlides = importPdfSlides;
window.triggerImportPdfSlides = triggerImportPdfSlides;
