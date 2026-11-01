/**
 * Keynote (.key) import. The server reads the file (backend/slideforge/bridge/keynote) and stores its pictures and
 * movies; this turns the plain deck it returns into slides, as importPptx.js does for PowerPoint.
 * Uses _pptxEscape and _pptxFontStack from importPptx.js (loaded before this file).
 */

const KEYNOTE_DEFAULT_FONT = '"Manrope", sans-serif';

function _keynoteColor(run) {
    if (!run.color) return null;
    if (run.opacity == null || run.opacity >= 1) return run.color;
    const value = parseInt(run.color.slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${run.opacity})`;
}

// The value most of the text has (by length), or null when no value covers half of it.
function _keynoteDominant(runs, read) {
    const weight = new Map();
    let total = 0;
    runs.forEach(run => {
        const length = Math.max(1, run.text.length);
        total += length;
        const value = read(run);
        if (value != null) weight.set(value, (weight.get(value) || 0) + length);
    });
    const best = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] * 2 >= Math.max(1, total) ? best[0] : null;
}

function _keynoteRunsHtml(runs, box, scale) {
    return runs
        .map(run => {
            const styles = [];
            const size = run.size ? Math.round(run.size * scale) : null;
            const color = _keynoteColor(run);
            if (size && size !== box.size) styles.push(`font-size: ${size}px`);
            if (color && color !== box.color) styles.push(`color: ${color}`);
            if (!!run.bold !== box.bold) styles.push(`font-weight: ${run.bold ? 700 : 400}`);
            if (run.font && run.font !== box.font) styles.push(`font-family: ${_pptxFontStack(run.font).replace(/"/g, "'")}`);
            if (run.italic) styles.push("font-style: italic");
            const lines = [run.underline && "underline", run.strike && "line-through"].filter(Boolean);
            if (lines.length) styles.push(`text-decoration: ${lines.join(" ")}`);
            const text = _pptxEscape(run.text).replace(/\n/g, "<br>");
            return styles.length ? `<span style="${styles.join("; ")};">${text}</span>` : text;
        })
        .join("");
}

function _keynoteBox(el, scale) {
    return {
        x: Math.round(el.x * scale),
        y: Math.round(el.y * scale),
        w: Math.round(el.width * scale),
        h: Math.round(el.height * scale),
        rot: el.rotation || 0,
    };
}

function _keynoteTextElement(el, scale, zIndex) {
    const paragraphs = el.paragraphs || [];
    const runs = paragraphs.flatMap(p => p.runs);
    if (!runs.some(run => run.text.trim())) return null;
    const isTitle = el.placeholder === "title";
    const sizePt = _keynoteDominant(runs, run => run.size);
    const box = {
        size: sizePt ? Math.round(sizePt * scale) : Math.round((isTitle ? 64 : 36) * scale),
        color: _keynoteDominant(runs, _keynoteColor) || "#172033",
        bold: _keynoteDominant(runs, run => !!run.bold) === true,
        font: _keynoteDominant(runs, run => run.font || null),
    };
    const filled = paragraphs.filter(p => p.runs.length);
    const isList = filled.length > 0 && filled.every(p => p.bullet !== "none");
    const numbered = isList && filled.every(p => p.bullet === "number");
    const content = isList
        ? filled.map(p => ({ html: _keynoteRunsHtml(p.runs, box, scale), level: Math.min(4, p.level || 0) }))
        : paragraphs.map(p => _keynoteRunsHtml(p.runs, box, scale)).join("<br>");
    const b = _keynoteBox(el, scale);
    const element = {
        id: generateId("el"),
        type: "text",
        x: b.x,
        y: b.y,
        width: `${Math.max(40, b.w)}px`,
        height: `${Math.max(24, b.h)}px`,
        content,
        autoHeight: false,
        // "Shrink text to fit" in Keynote. Its vertical alignment (top, middle, bottom) has no equivalent in
        // SlideForge text boxes yet: the text starts at the top.
        textFitMode: el.shrinkToFit ? "autofit" : "fixed",
        ...(isList ? { bulletStyle: "default" } : {}),
        ...(b.rot ? { rotation: b.rot } : {}),
        ...(el.fromMaster ? { importedFromMaster: true } : {}),
        styles: {
            color: box.color,
            fontSize: `${box.size}px`,
            fontFamily: box.font ? _pptxFontStack(box.font) : KEYNOTE_DEFAULT_FONT,
            fontWeight: box.bold ? "700" : "400",
            textAlign: filled[0]?.align || "left",
            zIndex,
        },
    };
    if (numbered && typeof applyTextBulletState === "function") applyTextBulletState(element, "numbered", "decimal");
    return element;
}

function _keynotePictureElement(el, scale, zIndex) {
    const b = _keynoteBox(el, scale);
    return {
        id: generateId("el"),
        type: "image",
        content: el.src,
        x: b.x,
        y: b.y,
        width: `${Math.max(8, b.w)}px`,
        height: `${Math.max(8, b.h)}px`,
        lockAspectRatio: true,
        imageAspectRatio: b.w / Math.max(1, b.h),
        // Stretched to its box as in Keynote (without a crop SlideForge trims the picture and resets the box's height).
        cropTransform: el.crop ? { ...el.crop } : { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 },
        heightSetManually: true,
        ...(b.rot ? { rotation: b.rot } : {}),
        styles: { zIndex, borderRadius: "0px" },
    };
}

function _keynoteVideoElement(el, scale, zIndex) {
    const b = _keynoteBox(el, scale);
    return {
        id: generateId("el"),
        type: "video",
        content: el.src,
        videoType: "local",
        localMimeType: el.contentType || "video/mp4",
        ...(el.webmUrl ? { videoWebm: el.webmUrl } : {}),
        x: b.x,
        y: b.y,
        width: `${Math.max(40, b.w)}px`,
        height: `${Math.max(24, b.h)}px`,
        muted: false,
        autoplay: !!el.autoplay,
        loop: !!el.loop,
        ...(b.rot ? { rotation: b.rot } : {}),
        styles: { zIndex, borderRadius: "0px" },
        animation: null,
    };
}

function _keynoteColorPicture(color) {
    try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 4;
        const context = canvas.getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, 4, 4);
        return canvas.toDataURL("image/png");
    } catch (_error) {
        return null;
    }
}

// What did not come in, for the message after the import ("2 shapes, 1 table left out").
function _keynoteSkippedSummary(skipped) {
    const parts = Object.entries(skipped || {}).map(([what, count]) => `${count} ${what}`);
    return parts.length ? ` (left out: ${parts.join(", ")})` : "";
}

// The upload, with progress: fetch() cannot report how much of a large file has been sent. Resolves to
// { ok, status, deck } like the fetch it replaces.
function _keynoteUpload(form, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/presentations/import/keynote/");
        xhr.withCredentials = true;
        const csrfToken = typeof _getCsrfToken === "function" ? _getCsrfToken() : "";
        if (csrfToken) xhr.setRequestHeader("X-CSRFToken", csrfToken);
        xhr.upload.onprogress = event => {
            if (event.lengthComputable) onProgress(event.loaded / event.total, false);
        };
        xhr.upload.onload = () => onProgress(1, true); // sent; the server is reading it now
        xhr.onload = () => {
            let deck = {};
            try {
                deck = JSON.parse(xhr.responseText);
            } catch (_error) {}
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, deck });
        };
        xhr.onerror = () => reject(new Error("the upload failed (is the server running?)"));
        xhr.send(form);
    });
}

async function importKeynote(file) {
    const busy = sfBusyStart({ title: `Importing ${file.name || "Keynote file"}`, detail: "Preparing…", progress: 0, delay: 0 });
    try {
        setProjectSaveHint?.("Reading Keynote file…", "muted");
        const importTitle =
            typeof uniqueImportTitle === "function"
                ? await uniqueImportTitle(String(file.name || "Imported presentation").replace(/\.key$/i, ""))
                : String(file.name || "Imported presentation").replace(/\.key$/i, "");
        // Its own project first, so the pictures the server stores belong to it.
        busy.update({ detail: "Saving the open project…" });
        if (typeof startNewProjectForImport === "function") await startNewProjectForImport();

        const form = new FormData();
        form.append("file", file, file.name || "presentation.key");
        if (typeof currentPresentationId !== "undefined" && currentPresentationId) form.append("presentationId", currentPresentationId);
        // Upload is the first 60% of the bar; the server's conversion has no progress to report, so the bar runs.
        const megabytes = (file.size || 0) / (1024 * 1024);
        const response = await _keynoteUpload(form, (sent, finished) => {
            if (finished) busy.update({ detail: "Converting the slides…", progress: null });
            else busy.update({ detail: `Uploading ${(sent * megabytes).toFixed(1)} of ${megabytes.toFixed(1)} MB`, progress: 0.6 * sent });
        });
        const deck = response.deck || {};
        if (!response.ok) throw new Error(deck.error || `the server answered ${response.status}`);
        if (!Array.isArray(deck.slides) || !deck.slides.length) throw new Error("No slides found in this file");

        // The page setup closest to the deck's proportions, one scale for everything (as for PowerPoint).
        const sourceW = Number(deck.width) || 1920;
        const sourceH = Number(deck.height) || 1080;
        const setups = Object.values(window.PRESENTATION_PAGE_SETUPS || {}).filter(setup => ["standard-4-3", "talk-16-9", "lecture-16-10"].includes(setup.id));
        const setup = setups.sort((a, b) => Math.abs(a.width / a.height - sourceW / sourceH) - Math.abs(b.width / b.height - sourceW / sourceH))[0] || { id: "talk-16-9", width: 1280, height: 720 };
        const scale = Math.min(setup.width / sourceW, setup.height / sourceH);

        busy.update({ detail: `Drawing ${deck.slides.length} slides…`, progress: 0.95 });
        await sfBusyPaint();
        const makers = { text: _keynoteTextElement, image: _keynotePictureElement, video: _keynoteVideoElement };
        const slides = deck.slides.map(source => {
            const elements = (source.elements || []).map((el, index) => makers[el.kind]?.(el, scale, index + 1)).filter(Boolean);
            const background = source.background || {};
            // The slide's own background, never an object on it: a full-slide rectangle took the drags meant for
            // the text boxes and pictures above it. A colour becomes a tiny picture of that colour (slide
            // backgrounds are pictures, videos or 3D scenes in SlideForge), stretched over the slide.
            const picture = background.src || (background.color && _keynoteColorPicture(background.color));
            const fit = background.src ? { stretch: "fill", tile: "cover" }[background.fit] || background.fit || "cover" : "fill";
            return {
                id: generateId("slide"),
                layoutId: "blank",
                masterId: "none",
                notes: source.notes || "",
                presentationTransition: "none",
                ...(picture ? { background: { type: "image", content: picture, fit } } : {}),
                ...(source.hidden ? { importedSkipped: true } : {}),
                elements,
            };
        });

        state.pageSetup = setup.id;
        syncPresentationPageSetup?.();
        state.slides = slides;
        setCurrentPresentationTitle?.(importTitle);
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
        const kinds = slides.flatMap(slide => slide.elements.map(el => el.type));
        const count = type => kinds.filter(kind => kind === type).length;
        const skippedSlides = deck.slides.filter(slide => slide.hidden).length;
        const summary = [
            `${slides.length} slides`,
            count("image") && `${count("image")} pictures`,
            count("video") && `${count("video")} movies`,
            skippedSlides && `${skippedSlides} skipped in Keynote, shown here`,
        ]
            .filter(Boolean)
            .join(", ");
        setProjectSaveHint?.(`Imported ${summary}${_keynoteSkippedSummary(deck.skipped)}`, "success");
        busy.update({ detail: `Imported ${summary}`, progress: 1 });
        schedulePresentationAutosave?.();
    } catch (err) {
        console.error("Keynote import error:", err);
        busy.done(); // gone before the alert, which blocks the page
        alert("Failed to import the Keynote file: " + err.message);
        setProjectSaveHint?.("Import failed", "danger");
    } finally {
        busy.done();
    }
}

function triggerImportKeynote() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".key,application/vnd.apple.keynote,application/x-iwork-keynote-sffkey";
    input.onchange = e => {
        const file = e.target.files[0];
        if (file) importKeynote(file);
    };
    input.click();
}

window.importKeynote = importKeynote;
window.triggerImportKeynote = triggerImportKeynote;
