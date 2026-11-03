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
            const weight = run.bold ? 700 : run.weight || 400;
            if (weight !== box.weight) styles.push(`font-weight: ${weight}`);
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
        // The weight most of the text has: 700 for bold, 600 for medium faces, 300 for light ones.
        weight: _keynoteDominant(runs, run => (run.bold ? 700 : run.weight || 400)) || 400,
        font: _keynoteDominant(runs, run => run.font || null),
    };
    const filled = paragraphs.filter(p => p.runs.length);
    const bulleted = filled.filter(p => p.bullet !== "none");
    // Laid out paragraph by paragraph when the box needs what a SlideForge list cannot hold: space between
    // paragraphs, a bullet of its own (an orange arrow), or a heading line above bullets (all lost: the list came in
    // packed together, with no bullets at all).
    // Keynote leaves out space before a box's first paragraph and after its last: only space between paragraphs
    // counts (a one-line name with space after it overflowed its box, and "shrink to fit" made it tiny).
    const lastIndex = paragraphs.length - 1;
    const precise =
        paragraphs.some((p, i) => (i > 0 && p.spaceBefore) || (i < lastIndex && p.spaceAfter)) ||
        bulleted.some(p => (p.glyph && p.glyph !== "•") || p.glyphColor) ||
        (bulleted.length > 0 && bulleted.length < filled.length);
    const isList = !precise && filled.length > 0 && bulleted.length === filled.length;
    const numbered = isList && filled.every(p => p.bullet === "number");
    // Keynote's relative line spacing, when it opens lines up. Tighter than 1 is left out: the letters then reach
    // past their lines, the box always measured as overflowing, and "shrink to fit" took a title down to 30 px.
    const lineHeight = (p) => (p.lineSpacing > 1 ? Math.round(p.lineSpacing * 1.2 * 100) / 100 : 1.2);
    let ordinal = 0;
    const content = precise
        ? paragraphs
              .map((p, index) => {
                  const size = (_keynoteDominant(p.runs, run => run.size) || sizePt || 24) * scale;
                  const css = [`margin:0`, `line-height:${lineHeight(p)}`, `text-align:${p.align || "left"}`];
                  // Space before the box's first paragraph is not drawn in Keynote (it pushed a title down and out).
                  if (p.spaceBefore && index > 0) css.push(`margin-top:${Math.round(p.spaceBefore * scale * 10) / 10}px`);
                  if (p.spaceAfter && index < lastIndex) css.push(`margin-bottom:${Math.round(p.spaceAfter * scale * 10) / 10}px`);
                  let marker = "";
                  if (p.bullet !== "none" && p.runs.length) {
                      // The label at its indent, the text (and its wrapped lines) at the text indent after it.
                      const label = (p.labelIndent ?? 0) * scale;
                      const gap = Math.max(size * 0.6, (p.textIndent ?? 0.8) * size);
                      // A hanging indent, as PowerPoint lists come in: the paragraph starts at the text indent, its
                      // first line pulled back to the label (the editor keeps margins, not inline-block widths).
                      css.push(`margin-left:${Math.round((label + gap) * 10) / 10}px`, `text-indent:${-Math.round(gap * 10) / 10}px`);
                      const glyph = p.bullet === "number" ? `${++ordinal}.` : p.glyph || "•";
                      marker = `${p.glyphColor ? `<span style="color:${p.glyphColor};">` : ""}${_pptxEscape(glyph)}${p.glyphColor ? "</span>" : ""}\u00a0\u00a0`;
                  }
                  // Line breaks inside the paragraph become paragraphs of their own here: the editor splits them so,
                  // copying the first line's style (the bullet's pulled-back indent, its space before), and the
                  // line under a list heading came in pulled left with a gap above it. Space before goes above the
                  // first line, space after below the last; the pulled-back indent is the first line's alone.
                  const lines = [[]];
                  p.runs.forEach(run => {
                      String(run.text)
                          .split("\n")
                          .forEach((piece, i) => {
                              if (i) lines.push([]);
                              if (piece) lines[lines.length - 1].push({ ...run, text: piece });
                          });
                  });
                  const last = lines.length - 1;
                  return lines
                      .map((line, i) => {
                          const own = css.filter(
                              rule =>
                                  !(i > 0 && (rule.startsWith("margin-top") || rule.startsWith("text-indent"))) &&
                                  !(i < last && rule.startsWith("margin-bottom")),
                          );
                          return `<p style="${own.join(";")}">${i === 0 ? marker : ""}${_keynoteRunsHtml(line, box, scale) || "<br>"}</p>`;
                      })
                      .join("");
              })
              .join("")
        : isList
          ? filled.map(p => ({ html: _keynoteRunsHtml(p.runs, box, scale), level: Math.min(4, p.level || 0) }))
          : paragraphs.map(p => _keynoteRunsHtml(p.runs, box, scale)).join("<br>");
    const b = _keynoteBox(el, scale);
    // A box shorter than its words grows the way its alignment points: a bottom-aligned title in a 1 pt box sits
    // on that box's bottom edge in Keynote, and came in hanging down over the text below it.
    const needed = Math.round(paragraphs.reduce((sum, p, i) => sum + Math.max(...p.runs.map(run => Number(run.size) || 0), sizePt || 24) * lineHeight(p) + (i ? p.spaceBefore || 0 : 0) + (i < lastIndex ? p.spaceAfter || 0 : 0), 0) * scale);
    if (needed > b.h && (el.verticalAlign === "bottom" || el.verticalAlign === "middle")) {
        b.y -= el.verticalAlign === "bottom" ? needed - b.h : Math.round((needed - b.h) / 2);
        b.h = needed;
    }
    const element = {
        id: generateId("el"),
        type: "text",
        x: b.x,
        y: b.y,
        width: `${Math.max(40, b.w)}px`,
        height: `${Math.max(24, b.h)}px`,
        content,
        autoHeight: false,
        // "Shrink text to fit" in Keynote.
        textFitMode: el.shrinkToFit ? "autofit" : "fixed",
        ...(isList ? { bulletStyle: "default" } : {}),
        ...(b.rot ? { rotation: b.rot } : {}),
        ...(el.fromMaster ? { importedFromMaster: true } : {}),
        styles: {
            color: box.color,
            fontSize: `${box.size}px`,
            fontFamily: box.font ? _pptxFontStack(box.font) : KEYNOTE_DEFAULT_FONT,
            fontWeight: String(box.weight),
            textAlign: filled[0]?.align || "left",
            ...(!precise && filled[0]?.lineSpacing > 1 ? { lineHeight: String(lineHeight(filled[0])) } : {}),
            // Keynote's vertical alignment (titles are often at the bottom of their box): it started at the top.
            ...(el.verticalAlign === "middle" || el.verticalAlign === "bottom" ? { "--pptx-text-anchor": el.verticalAlign === "middle" ? "center" : "end" } : {}),
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
        // Keynote's picture opacity (a map's states faded to a tint came in solid white).
        styles: { zIndex, borderRadius: "0px", ...(el.opacity != null && el.opacity < 1 ? { opacity: String(el.opacity) } : {}) },
    };
}

// Keynote's line ends, drawn at the end of the line as SVG markers (in line widths).
const KEYNOTE_LINE_ENDS = {
    arrow: '<path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="context-stroke" stroke-width="1.6"/>',
    triangle: '<path d="M 0 0 L 10 5 L 0 10 Z"/>',
    circle: '<circle cx="5" cy="5" r="4"/>',
    "open-circle": '<circle cx="5" cy="5" r="3.6" fill="none" stroke="context-stroke" stroke-width="1.2"/>',
    square: '<rect x="1" y="1" width="8" height="8"/>',
    "open-square": '<rect x="1.6" y="1.6" width="6.8" height="6.8" fill="none" stroke="context-stroke" stroke-width="1.2"/>',
    diamond: '<path d="M 0 5 L 5 0 L 10 5 L 5 10 Z"/>',
    "open-diamond": '<path d="M 0.8 5 L 5 0.8 L 9.2 5 L 5 9.2 Z" fill="none" stroke="context-stroke" stroke-width="1.2"/>',
    bar: '<rect x="4.4" y="0" width="1.2" height="10"/>',
};

// A Keynote shape or line (its outline as SVG path data in points, with its fill, stroke and line ends) as a
// picture of it, as PowerPoint freeforms come in. They were left out: bars, rules and boxes behind captions.
function _keynoteShapeElement(el, scale, zIndex) {
    if (!el.path) return null;
    const stroke = el.stroke;
    const fill = el.fill || {};
    const strokeWidth = stroke ? Math.max(0.25, Number(stroke.width) || 1) : 0;
    const pad = Math.ceil(strokeWidth * 4 + 2);
    const w = Math.max(1, el.width);
    const h = Math.max(1, el.height);
    const gradient = fill.gradient?.stops?.length ? fill.gradient : null;
    const stops = gradient ? gradient.stops.map(stop => `<stop offset="${Number(stop.pos) || 0}%" stop-color="${_pptxEscape(stop.color)}"/>`).join("") : "";
    const gradientDef = gradient
        ? gradient.radial
            ? `<radialGradient id="g">${stops}</radialGradient>`
            : `<linearGradient id="g" gradientTransform="rotate(${Number(gradient.angle) || 0} 0.5 0.5)">${stops}</linearGradient>`
        : "";
    const paint = gradient ? "url(#g)" : fill.color ? _pptxEscape(fill.color) : "none";
    const strokeColor = stroke ? _pptxEscape(stroke.color || "#000000") : "none";
    const marker = (id, kind, reverse) =>
        KEYNOTE_LINE_ENDS[kind]
            ? `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="${reverse ? "auto-start-reverse" : "auto"}" fill="${strokeColor}" stroke="${strokeColor}">${KEYNOTE_LINE_ENDS[kind].replace(/context-stroke/g, strokeColor)}</marker>`
            : "";
    const defs = gradientDef + marker("s", el.headEnd, true) + marker("e", el.tailEnd, false);
    const strokeAttrs = stroke
        ? ` stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="${stroke.cap || "butt"}" stroke-linejoin="${stroke.join || "miter"}"${Array.isArray(stroke.dash) && stroke.dash.length ? ` stroke-dasharray="${stroke.dash.join(" ")}"` : ""}`
        : ' stroke="none"';
    const ends = `${KEYNOTE_LINE_ENDS[el.headEnd] ? ' marker-start="url(#s)"' : ""}${KEYNOTE_LINE_ENDS[el.tailEnd] ? ' marker-end="url(#e)"' : ""}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(w + pad * 2) * scale}" height="${(h + pad * 2) * scale}" viewBox="${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}"><defs>${defs}</defs><path d="${_pptxEscape(el.path)}" fill="${paint}"${strokeAttrs}${ends}${el.opacity != null && el.opacity < 1 ? ` opacity="${Number(el.opacity)}"` : ""}/></svg>`;
    const b = _keynoteBox({ ...el, x: el.x - pad, y: el.y - pad, width: w + pad * 2, height: h + pad * 2 }, scale);
    return {
        id: generateId("el"),
        type: "image",
        content: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        x: b.x,
        y: b.y,
        width: `${Math.max(1, b.w)}px`,
        height: `${Math.max(1, b.h)}px`,
        lockAspectRatio: false,
        imageAspectRatio: b.w / Math.max(1, b.h),
        cropTransform: { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 },
        heightSetManually: true,
        importedDrawing: true,
        ...(b.rot ? { rotation: b.rot } : {}),
        styles: { zIndex, borderRadius: "0px" },
    };
}

// Keynote's transitions as the nearest of SlideForge's (they all came in as none). By name, so newer effects find
// their family; anything unrecognised fades.
// A Keynote table (from the server's TST reader): its columns and rows at the deck's scale, each cell with its text,
// fill, font, colour and alignment. Tables were left out of the slide. Merged cells are not kept: the text stays in
// the first cell of the merge.
function _keynoteTableElement(el, scale, zIndex) {
    const rows = Array.isArray(el.rows) ? el.rows.length : 0;
    const cols = Array.isArray(el.columns) ? el.columns.length : 0;
    if (!rows || !cols || !Array.isArray(el.cells)) return null;
    const box = _keynoteBox(el, scale);
    const colWidths = el.columns.map(width => Math.max(36, Math.round(width * scale)));
    const rowHeights = el.rows.map(height => Math.max(24, Math.round(height * scale)));
    const all = el.cells.flat().filter(Boolean);
    const sizes = all.map(cell => cell.size).filter(Boolean);
    const baseSize = sizes.length ? Math.round(sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] * scale) : 16;
    const fonts = all.map(cell => cell.font).filter(Boolean);
    const baseFont = fonts.length ? _pptxFontStack(fonts[0]) : KEYNOTE_DEFAULT_FONT;
    const padding = all.find(cell => cell.padding)?.padding;
    const cells = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
            const cell = el.cells[r]?.[c] || {};
            const styles = {};
            if (cell.fill) styles.backgroundColor = cell.fill;
            if (cell.color) styles.color = _keynoteColor(cell);
            if (cell.size && Math.round(cell.size * scale) !== baseSize) styles.fontSize = `${Math.round(cell.size * scale)}px`;
            if (cell.font) styles.fontFamily = _pptxFontStack(cell.font);
            styles.fontWeight = cell.bold ? "700" : String(cell.weight || 400);
            if (cell.italic) styles.fontStyle = "italic";
            if (cell.align) styles.textAlign = cell.align;
            if (cell.valign) styles.verticalAlign = cell.valign;
            if (!styles.backgroundColor) styles.backgroundColor = "transparent";
            return { text: String(cell.text || ""), styles };
        }),
    );
    const base = typeof createDefaultTableData === "function" ? createDefaultTableData(rows, cols) : {};
    return {
        id: generateId("el"),
        type: "table",
        x: box.x,
        y: box.y,
        width: `${colWidths.reduce((a, b) => a + b, 0)}px`,
        height: `${rowHeights.reduce((a, b) => a + b, 0)}px`,
        content: "",
        ...(box.rot ? { rotation: box.rot } : {}),
        tableData: {
            ...base,
            rows,
            cols,
            colWidths,
            rowHeights,
            cells,
            headerRow: (Number(el.headerRows) || 0) > 0,
            zebra: false,
            lineHeight: 1.2,
            fontFamily: baseFont,
            fontSize: `${baseSize}px`,
            ...(padding ? { cellPadding: Math.max(2, Math.round(padding * scale)) } : {}),
            selection: null,
        },
        styles: { color: "#172033", fontSize: `${baseSize}px`, fontFamily: baseFont, textAlign: "left", zIndex },
    };
}

function _keynoteTransition(transition) {
    const effect = String(transition?.effect || "").toLowerCase();
    if (!effect || effect === "none") return "none";
    if (/dissolve|fade|blur|shimmer|sparkle|confetti|mosaic|droplet|clothesline/.test(effect)) return /mosaic|confetti|shimmer|sparkle/.test(effect) ? "diffuse" : "fade";
    if (/cube|revolve|flip|swing|swap|reflection|doorway|page|twist|twirl|perspective|object|switch|fall|flop/.test(effect)) return "convex";
    if (/scale|zoom|grid|iris|anagram|magic/.test(effect)) return "zoom";
    if (/push|move|wipe|reveal|slide|cover|drop|blinds|color-planes|pivot/.test(effect)) return "slide";
    return "fade";
}

// A Keynote build in as a SlideForge entrance: its effect by name, on its click (0: when the slide opens).
function _keynoteEntrance(build) {
    const effect = String(build?.effect || "").toLowerCase();
    const name = /wipe|reveal/.test(effect) ? "wipe-in" : /scale|zoom|pop|grow|bounce/.test(effect) ? "zoom-in" : /move|fly|push|slide|drop/.test(effect) ? "slide-up" : "fade-in";
    const order = Math.max(0, Number(build.order) || 0);
    return {
        effect: name,
        trigger: order ? "on-click" : "on-slide",
        order,
        durationMs: /appear/.test(effect) ? 100 : Math.max(100, Math.round((Number(build.duration) || 1) * 1000)),
        delayMs: Math.max(0, Math.round((Number(build.delay) || 0) * 1000)),
        easing: "ease-out",
    };
}

// A Keynote sound: hidden while presenting when it plays by itself (Keynote never shows a sound's icon in a show);
// one started by a click keeps its player, so it can be clicked.
function _keynoteAudioElement(el, scale, zIndex) {
    const b = _keynoteBox(el, scale);
    return {
        id: generateId("el"),
        type: "audio",
        content: el.src,
        audioName: el.name || "Audio",
        localMimeType: el.contentType || "",
        ...(el.webmUrl ? { audioWebm: el.webmUrl } : {}),
        x: b.x,
        y: b.y,
        width: `${Math.max(44, b.w)}px`,
        height: `${Math.max(44, b.h)}px`,
        autoplay: !!el.autoplay,
        loop: !!el.loop,
        hideWhilePresenting: !!el.autoplay && !el.clickToPlay,
        ...(b.rot ? { rotation: b.rot } : {}),
        styles: { zIndex, borderRadius: "999px" },
        animation: null,
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
        const makers = { text: _keynoteTextElement, image: _keynotePictureElement, video: _keynoteVideoElement, audio: _keynoteAudioElement, shape: _keynoteShapeElement, table: _keynoteTableElement };
        const slides = deck.slides.map(source => {
            const elements = (source.elements || [])
                .map((el, index) => {
                    const made = makers[el.kind]?.(el, scale, index + 1);
                    if (made && el.build) made.animation = _keynoteEntrance(el.build);
                    if (made && el.fromMaster && el.kind === "shape") {
                        // A master's bars and rules, as on a Keynote slide: behind the slide's objects, not selectable.
                        made.locked = true;
                        made.backgroundRole = "preset";
                    }
                    return made;
                })
                .filter(Boolean);
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
                presentationTransition: _keynoteTransition(source.transition),
                ...(picture ? { background: { type: "image", content: picture, fit } } : {}),
                ...(source.hidden ? { hidden: true } : {}), // skipped in Keynote: hidden when presenting here too
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
            count("audio") && `${count("audio")} sounds`,
            skippedSlides && `${skippedSlides} hidden when presenting`,
        ]
            .filter(Boolean)
            .join(", ");
        setProjectSaveHint?.(`Imported ${summary}${_keynoteSkippedSummary(deck.skipped)}`, "success");
        busy.update({ detail: `Imported ${summary}`, progress: 1 });
        schedulePresentationAutosave?.();
        // Fonts the deck uses that this computer lacks: offered for download from Google Fonts (js/ui/fonts.js).
        setTimeout(() => window.sfOfferMissingFonts?.({ auto: true }), 800);
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
