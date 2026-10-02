/**
 * importPptx.js
 * Client-side PowerPoint (.pptx) import using JSZip.
 *
 * Brought in, in their stacking order: text boxes (paragraphs, bullet levels, numbering, alignment, font, size,
 * bold/italic/underline and colour per run), pictures, tables, charts (bar, line, pie, doughnut), basic shapes with
 * their fill, groups (flattened), speaker notes and the slide proportions. Placeholders without their own position
 * take it from the slide layout. Not imported: animations, SmartArt, video, theme/master artwork and connectors.
 */

const PPTX_EMU_PER_PX = 9525;

const PPTX_SHAPE_TYPES = {
    rect: "rectangle",
    roundRect: "rectangle",
    ellipse: "circle",
    triangle: "triangle",
    diamond: "diamond",
    hexagon: "hexagon",
    parallelogram: "parallelogram",
    rightArrow: "arrow-right",
    leftArrow: "arrow-left",
    upArrow: "arrow-up",
    downArrow: "arrow-down",
    rtTriangle: "right-triangle",
    trapezoid: "trapezoid",
    pentagon: "pentagon",
    octagon: "octagon",
    star5: "star",
    plus: "plus",
    chevron: "chevron",
    wedgeRectCallout: "callout",
};

function _pptxEscape(text) {
    return String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function _pptxChildren(node, name) {
    return node ? Array.from(node.children).filter(child => child.tagName === name) : [];
}

function _pptxChild(node, name) {
    return _pptxChildren(node, name)[0] || null;
}

function _pptxFirst(node, name) {
    return node ? node.getElementsByTagName(name)[0] || null : null;
}

// "ppt/slides/slide1.xml" + "../media/image1.png" -> "ppt/media/image1.png"
function _pptxResolvePath(basePart, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = basePart.split("/").slice(0, -1);
    target.split("/").forEach(segment => {
        if (segment === "..") parts.pop();
        else if (segment !== ".") parts.push(segment);
    });
    return parts.join("/");
}

// The theme's colour scheme, once the package is read (theme colours below are looked up in it).
let _pptxCurrentThemeColors = {};

// PowerPoint's colour modifiers on a theme or RGB colour: lumMod/lumOff (brightness in HSL), shade (towards
// black) and tint (towards white).
function _pptxModifiedColor(hex, colorNode) {
    let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mod = name => {
        const v = _pptxChild(colorNode, name)?.getAttribute("val");
        return v === undefined || v === null ? null : Number(v) / 100000;
    };
    const shade = mod("a:shade");
    if (shade !== null) [r, g, b] = [r, g, b].map(c => c * shade);
    const tint = mod("a:tint");
    if (tint !== null) [r, g, b] = [r, g, b].map(c => c + (1 - c) * (1 - tint));
    const lumMod = mod("a:lumMod");
    const lumOff = mod("a:lumOff");
    if (lumMod !== null || lumOff !== null) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, sat = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h /= 6;
        }
        l = Math.max(0, Math.min(1, l * (lumMod ?? 1) + (lumOff ?? 0)));
        const hue = (p, q, t) => {
            t = (t + 1) % 1;
            return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
        };
        if (sat === 0) r = g = b = l;
        else {
            const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
            const p = 2 * l - q;
            [r, g, b] = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
        }
    }
    return `#${[r, g, b].map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// A colour element (srgbClr, schemeClr or sysClr) inside `holder`, as #rrggbb. Theme colours (schemeClr) came in
// as nothing, so most shapes of a real deck lost their fill.
function _pptxColorValue(holder, themeColors = _pptxCurrentThemeColors) {
    if (!holder) return null;
    const rgb = _pptxChild(holder, "a:srgbClr");
    const scheme = _pptxChild(holder, "a:schemeClr");
    const sys = _pptxChild(holder, "a:sysClr");
    const node = rgb || scheme || sys;
    let value = rgb?.getAttribute("val") || sys?.getAttribute("lastClr") || null;
    let hex = value && /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : null;
    if (!hex && scheme) hex = themeColors?.[scheme.getAttribute("val")] || null;
    return hex && node ? _pptxModifiedColor(hex, node) : hex;
}

function _pptxColor(node) {
    const fill = node && (node.tagName === "a:solidFill" ? node : _pptxChild(node, "a:solidFill"));
    return fill ? _pptxColorValue(fill) : null;
}

// The fill or line a shape gets from its style (<p:style>): what PowerPoint uses for a shape that was not recoloured.
function _pptxStyleColor(sp, refName) {
    const ref = _pptxChild(_pptxChild(sp, "p:style"), refName);
    if (!ref || Number(ref.getAttribute("idx")) === 0) return null;
    return _pptxColorValue(ref);
}

class PptxPackage {
    constructor(zip) {
        this.zip = zip;
        this.parser = new DOMParser();
        this.cache = new Map();
    }

    async xml(path) {
        if (!this.cache.has(path)) {
            const file = this.zip.file(path);
            this.cache.set(path, file ? this.parser.parseFromString(await file.async("string"), "text/xml") : null);
        }
        return this.cache.get(path);
    }

    // Relationships of a part: id -> { path, type }
    async rels(partPath) {
        const parts = partPath.split("/");
        const relsPath = [...parts.slice(0, -1), "_rels", `${parts.at(-1)}.rels`].join("/");
        const doc = await this.xml(relsPath);
        const map = {};
        if (!doc) return map;
        Array.from(doc.getElementsByTagName("Relationship")).forEach(rel => {
            if (rel.getAttribute("TargetMode") === "External") return;
            map[rel.getAttribute("Id")] = {
                path: _pptxResolvePath(partPath, rel.getAttribute("Target") || ""),
                type: (rel.getAttribute("Type") || "").split("/").pop(),
            };
        });
        return map;
    }

    // The web addresses a part links to (external relationships), by id.
    async links(partPath) {
        const parts = partPath.split("/");
        const doc = await this.xml([...parts.slice(0, -1), "_rels", `${parts.at(-1)}.rels`].join("/"));
        const map = {};
        Array.from(doc?.getElementsByTagName("Relationship") || []).forEach(rel => {
            const target = rel.getAttribute("Target") || "";
            if (rel.getAttribute("TargetMode") === "External" && /^(https?:|mailto:)/i.test(target)) map[rel.getAttribute("Id")] = target;
        });
        return map;
    }
}

// Position and size (EMU) of a shape, picture, graphic frame or group: { x, y, w, h, rot, chX, chY, chW, chH }
function _pptxXfrm(node) {
    const holder = _pptxChild(node, "p:spPr") || _pptxChild(node, "p:grpSpPr") || node;
    const xfrm = _pptxChild(holder, "a:xfrm") || _pptxChild(node, "p:xfrm");
    if (!xfrm) return null;
    const off = _pptxChild(xfrm, "a:off");
    const ext = _pptxChild(xfrm, "a:ext");
    if (!off || !ext) return null;
    const chOff = _pptxChild(xfrm, "a:chOff");
    const chExt = _pptxChild(xfrm, "a:chExt");
    const num = (el, attr) => Number(el?.getAttribute(attr)) || 0;
    return {
        x: num(off, "x"),
        y: num(off, "y"),
        w: num(ext, "cx"),
        h: num(ext, "cy"),
        rot: (Number(xfrm.getAttribute("rot")) || 0) / 60000,
        flipH: xfrm.getAttribute("flipH") === "1",
        flipV: xfrm.getAttribute("flipV") === "1",
        chX: chOff ? num(chOff, "x") : num(off, "x"),
        chY: chOff ? num(chOff, "y") : num(off, "y"),
        chW: chExt ? num(chExt, "cx") : num(ext, "cx"),
        chH: chExt ? num(chExt, "cy") : num(ext, "cy"),
    };
}

function _pptxPlaceholder(sp) {
    const ph = _pptxFirst(_pptxChild(sp, "p:nvSpPr"), "p:ph");
    return ph ? { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") || "" } : null;
}

// Where the layout puts each placeholder, for slide shapes that carry no position of their own.
async function _pptxLayoutPlaceholders(pkg, slidePath) {
    const found = [];
    const rels = await pkg.rels(slidePath);
    const layoutPath = Object.values(rels).find(rel => rel.type === "slideLayout")?.path;
    const parts = [layoutPath];
    if (layoutPath) parts.push(Object.values(await pkg.rels(layoutPath)).find(rel => rel.type === "slideMaster")?.path);
    for (const path of parts.filter(Boolean)) {
        const doc = await pkg.xml(path);
        Array.from(doc?.getElementsByTagName("p:sp") || []).forEach(sp => {
            const ph = _pptxPlaceholder(sp);
            const xfrm = _pptxXfrm(sp);
            if (ph && xfrm) found.push({ ...ph, xfrm });
        });
    }
    return ph => {
        if (!ph) return null;
        const title = type => type === "title" || type === "ctrTitle";
        return (
            found.find(item => item.type === ph.type && item.idx === ph.idx) ||
            found.find(item => ph.idx && item.idx === ph.idx) ||
            found.find(item => item.type === ph.type || (title(item.type) && title(ph.type)))
        )?.xfrm || null;
    };
}

// One paragraph as HTML plus what it says about the whole box (size, colour, font, alignment, bullet).
function _pptxParagraph(p, fontScale, links = {}) {
    const pPr = _pptxChild(p, "a:pPr");
    const level = Number(pPr?.getAttribute("lvl")) || 0;
    const numbered = !!(pPr && _pptxChild(pPr, "a:buAutoNum"));
    const bullet = pPr && _pptxChild(pPr, "a:buNone") ? false : pPr && (_pptxChild(pPr, "a:buChar") || numbered) ? true : null;
    const align = { ctr: "center", r: "right", just: "justify", l: "left" }[pPr?.getAttribute("algn")] || null;
    const runs = [];
    Array.from(p.children).forEach(node => {
        if (node.tagName === "a:br") runs.push({ br: true });
        if (node.tagName !== "a:r" && node.tagName !== "a:fld") return;
        const rPr = _pptxChild(node, "a:rPr");
        const size = Number(rPr?.getAttribute("sz"));
        runs.push({
            text: _pptxFirst(node, "a:t")?.textContent || "",
            size: size ? Math.round((size / 100) * (96 / 72) * fontScale) : null,
            bold: rPr?.getAttribute("b") === "1",
            italic: rPr?.getAttribute("i") === "1",
            underline: !!rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none",
            caps: rPr?.getAttribute("cap") === "all",
            color: _pptxColor(rPr),
            font: _pptxChild(rPr, "a:latin")?.getAttribute("typeface") || null,
            // A linked run (a:hlinkClick) keeps its web address; it came in as plain text.
            link: links[_pptxChild(rPr, "a:hlinkClick")?.getAttribute("r:id")] || null,
        });
    });
    const text = runs.filter(run => !run.br);
    const length = text.reduce((sum, run) => sum + run.text.length, 0);
    // The value most of the text has becomes the box's own style; runs that differ get a span.
    const dominant = key => {
        const weight = new Map();
        text.forEach(run => run[key] != null && run[key] !== false && weight.set(run[key], (weight.get(run[key]) || 0) + Math.max(1, run.text.length)));
        const best = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
        return best && best[1] * 2 >= Math.max(1, length) ? best[0] : null;
    };
    return { level, bullet, numbered, align, runs, length, dominant };
}

function _pptxRunsHtml(runs, box) {
    return runs
        .map(run => {
            if (run.br) return "<br>";
            const styles = [];
            if (run.size && run.size !== box.size) styles.push(`font-size: ${run.size}px`);
            if (run.color && run.color !== box.color) styles.push(`color: ${run.color}`);
            if (run.bold !== box.bold) styles.push(`font-weight: ${run.bold ? 700 : 400}`);
            if (run.italic) styles.push("font-style: italic");
            if (run.underline) styles.push("text-decoration: underline");
            const text = _pptxEscape(run.text);
            const html = styles.length ? `<span style="${styles.join("; ")};">${text}</span>` : text;
            return run.link ? `<a href="${_pptxEscape(run.link)}">${html}</a>` : html;
        })
        .join("");
}

function _pptxTextElement(sp, box, { fontScale, placeholder, zIndex, links }) {
    const txBody = _pptxChild(sp, "p:txBody");
    const paragraphs = _pptxChildren(txBody, "a:p").map(p => _pptxParagraph(p, fontScale, links));
    if (!paragraphs.some(p => p.length)) return null;
    while (paragraphs.length && !paragraphs.at(-1).length) paragraphs.pop();

    const all = { runs: paragraphs.flatMap(p => p.runs.filter(run => !run.br)) };
    const length = all.runs.reduce((sum, run) => sum + run.text.length, 0);
    const pick = key => {
        const weight = new Map();
        all.runs.forEach(run => run[key] != null && run[key] !== false && weight.set(run[key], (weight.get(run[key]) || 0) + Math.max(1, run.text.length)));
        const best = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
        return best && best[1] * 2 >= Math.max(1, length) ? best[0] : null;
    };
    const isTitle = placeholder && /title/i.test(placeholder.type);
    const style = {
        size: pick("size") || (isTitle ? 40 : placeholder ? 24 : 18),
        color: pick("color") || "#172033",
        bold: pick("bold") === true,
        font: pick("font"),
        caps: pick("caps") === true,
    };
    const align = paragraphs.find(p => p.align)?.align || (placeholder?.type === "ctrTitle" || placeholder?.type === "subTitle" ? "center" : "left");

    // A box is a list when its paragraphs carry bullets (or it is a body placeholder that does not switch them off).
    const bodyPlaceholder = placeholder && !isTitle && placeholder.type === "body";
    const filled = paragraphs.filter(p => p.length);
    const listed = filled.filter(p => p.bullet === true || (p.bullet === null && bodyPlaceholder) || p.level > 0);
    const isList = filled.length > 0 && listed.length === filled.length && (filled.length > 1 || filled[0].bullet === true);
    const numbered = isList && filled.every(p => p.numbered);

    let content;
    if (isList) {
        content = filled.map(p => ({ html: _pptxRunsHtml(p.runs, style), level: Math.min(4, p.level) }));
    } else {
        content = paragraphs.map(p => _pptxRunsHtml(p.runs, style)).join("<br>");
    }

    const bodyPr = _pptxChild(txBody, "a:bodyPr");
    const fill = _pptxColor(_pptxChild(sp, "p:spPr"));
    const element = {
        id: generateId("el"),
        type: "text",
        x: box.x,
        y: box.y,
        width: `${Math.max(40, box.w)}px`,
        height: `${Math.max(24, box.h)}px`,
        content,
        autoHeight: false,
        textFitMode: bodyPr && _pptxChild(bodyPr, "a:normAutofit") ? "autofit" : "fixed",
        ...(isList ? { bulletStyle: "default" } : {}),
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: {
            color: style.color,
            fontSize: `${style.size}px`,
            fontFamily: style.font ? `"${style.font.replace(/"/g, "")}", sans-serif` : '"Manrope", sans-serif',
            fontWeight: style.bold ? "700" : "400",
            textAlign: align,
            zIndex,
            ...(style.caps ? { textTransform: "uppercase" } : {}),
            ...(fill ? { backgroundColor: fill } : {}),
        },
    };
    if (numbered && typeof applyTextBulletState === "function") applyTextBulletState(element, "numbered", "decimal");
    return element;
}

function _pptxShapeElement(sp, box, zIndex) {
    const spPr = _pptxChild(sp, "p:spPr");
    const preset = _pptxChild(spPr, "a:prstGeom")?.getAttribute("prst");
    // Its own fill, or none when it says noFill, else its style's.
    const fill = _pptxColor(spPr) || (_pptxChild(spPr, "a:noFill") || _pptxChild(spPr, "a:gradFill") ? null : _pptxStyleColor(sp, "a:fillRef"));
    const line = _pptxChild(spPr, "a:ln");
    const lineColor = line && _pptxChild(line, "a:noFill") ? null : (line && _pptxColor(line)) || _pptxStyleColor(sp, "a:lnRef");
    if (!preset || (!fill && !lineColor)) return null;
    const lineWidth = Math.max(1, Math.round((Number(line?.getAttribute("w")) || 12700) / 12700));
    return {
        id: generateId("el"),
        type: "shape",
        shapeType: PPTX_SHAPE_TYPES[preset] || "rectangle",
        x: box.x,
        y: box.y,
        width: `${Math.max(2, box.w)}px`,
        height: `${Math.max(2, box.h)}px`,
        content: "",
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: {
            backgroundColor: fill || "transparent",
            borderRadius: preset === "ellipse" ? "9999px" : preset === "roundRect" ? "16px" : "0px",
            ...(lineColor ? { borderColor: lineColor, borderWidth: `${lineWidth}px`, borderStyle: "solid" } : {}),
            zIndex,
        },
    };
}

const PPTX_LINE_PRESETS = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/;
// PowerPoint's line ends -> the connector's heads
const PPTX_LINE_ENDS = { triangle: "triangle", stealth: "arrow", arrow: "chevron", diamond: "diamond", oval: "dot" };

function _pptxIsLine(sp) {
    return PPTX_LINE_PRESETS.test(_pptxChild(_pptxChild(sp, "p:spPr"), "a:prstGeom")?.getAttribute("prst") || "");
}

// A line or connector (p:cxnSp): from one corner of its box to the other (the flips say which), with its arrowheads,
// colour and width. They were dropped, so the arrows of a diagram went missing.
function _pptxConnectorElement(node, box, scale, zIndex) {
    const spPr = _pptxChild(node, "p:spPr");
    const line = _pptxChild(spPr, "a:ln");
    if (line && _pptxChild(line, "a:noFill")) return null;
    const color = (line && _pptxColor(line)) || _pptxStyleColor(node, "a:lnRef") || "#172033";
    const start = { x: box.flipH ? box.x + box.w : box.x, y: box.flipV ? box.y + box.h : box.y };
    const end = { x: box.flipH ? box.x : box.x + box.w, y: box.flipV ? box.y : box.y + box.h };
    const preset = _pptxChild(spPr, "a:prstGeom")?.getAttribute("prst") || "line";
    const bent = /^bentConnector/.test(preset) && start.x !== end.x && start.y !== end.y;
    const midX = Math.round((start.x + end.x) / 2);
    const points = bent ? [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end] : [start, end];
    const head = name => PPTX_LINE_ENDS[_pptxChild(line, name)?.getAttribute("type")] || "none";
    const width = Number(line?.getAttribute("w")) || 12700;
    const connector = {
        id: generateId("el"),
        type: "connector",
        connectorType: bent ? "poly" : "line",
        connectorStart: head("a:headEnd"),
        connectorEnd: head("a:tailEnd"),
        connectorHeadWidth: 14,
        connectorHeadLength: 14,
        points: points.map(point => ({ x: point.x - box.x, y: point.y - box.y })),
        x: box.x,
        y: box.y,
        width: `${Math.max(2, box.w)}px`,
        height: `${Math.max(2, box.h)}px`,
        content: "",
        styles: {
            backgroundColor: "transparent",
            color,
            strokeWidth: Math.max(1, Math.round((width / PPTX_EMU_PER_PX) * scale)),
            zIndex,
            borderRadius: "0px",
        },
    };
    if (typeof normalizeConnectorGeometry === "function") normalizeConnectorGeometry(connector, points);
    return connector;
}

async function _pptxPictureElement(pkg, pic, rels, box, zIndex) {
    const embed = _pptxFirst(pic, "a:blip")?.getAttribute("r:embed");
    const path = rels[embed]?.path;
    const file = path && pkg.zip.file(path);
    if (!file) return null;
    const extension = path.split(".").pop().toLowerCase();
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" }[extension];
    if (!mime) return null; // EMF/WMF and the like: browsers cannot show them
    const blob = new Blob([await file.async("arraybuffer")], { type: mime });
    let url = null;
    try {
        // Stored like any inserted picture; a data URL is the fallback when there is no server to store it.
        if (typeof _uploadAssetFile === "function") {
            url = (await _uploadAssetFile(new File([blob], path.split("/").pop(), { type: mime })))?.url || null;
        }
    } catch (_error) {
        url = null;
    }
    if (!url) {
        url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }
    return {
        id: generateId("el"),
        type: "image",
        content: url,
        x: box.x,
        y: box.y,
        width: `${Math.max(8, box.w)}px`,
        height: `${Math.max(8, box.h)}px`,
        lockAspectRatio: true,
        imageAspectRatio: box.w / Math.max(1, box.h),
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: { zIndex, borderRadius: "0px" },
    };
}

function _pptxTableElement(tbl, box, scale, fontScale, zIndex) {
    const colWidths = _pptxChildren(_pptxChild(tbl, "a:tblGrid"), "a:gridCol").map(col => Math.max(36, Math.round(((Number(col.getAttribute("w")) || 0) / PPTX_EMU_PER_PX) * scale)));
    const rows = _pptxChildren(tbl, "a:tr");
    if (!rows.length || !colWidths.length) return null;
    let fontSize = null;
    const cells = rows.map(tr =>
        colWidths.map((_, index) => {
            const tc = _pptxChildren(tr, "a:tc")[index];
            const paragraphs = Array.from(tc?.getElementsByTagName("a:p") || []);
            const size = Number(_pptxFirst(tc, "a:rPr")?.getAttribute("sz"));
            if (size && !fontSize) fontSize = Math.round((size / 100) * (96 / 72) * fontScale);
            return {
                text: paragraphs.map(p => Array.from(p.getElementsByTagName("a:t")).map(t => t.textContent).join("")).join("\n"),
                styles: {},
            };
        }),
    );
    const base = typeof createDefaultTableData === "function" ? createDefaultTableData(rows.length, colWidths.length) : {};
    return {
        id: generateId("el"),
        type: "table",
        x: box.x,
        y: box.y,
        width: `${colWidths.reduce((a, b) => a + b, 0)}px`,
        height: `${Math.max(24, box.h)}px`,
        content: "",
        tableData: {
            ...base,
            rows: rows.length,
            cols: colWidths.length,
            colWidths,
            rowHeights: rows.map(tr => Math.max(24, Math.round(((Number(tr.getAttribute("h")) || 0) / PPTX_EMU_PER_PX) * scale))),
            cells,
            headerRow: _pptxChild(tbl, "a:tblPr")?.getAttribute("firstRow") !== "0",
            selection: null,
        },
        styles: { color: "#172033", fontSize: `${fontSize || 16}px`, fontFamily: '"Manrope", sans-serif', textAlign: "left", zIndex },
    };
}

async function _pptxChartElement(pkg, frame, rels, box, zIndex) {
    const chartRef = _pptxFirst(frame, "c:chart")?.getAttribute("r:id");
    const doc = rels[chartRef] && (await pkg.xml(rels[chartRef].path));
    if (!doc) return null;
    const kinds = [["c:barChart", "bar"], ["c:bar3DChart", "bar"], ["c:lineChart", "line"], ["c:pieChart", "pie"], ["c:pie3DChart", "pie"], ["c:doughnutChart", "doughnut"]];
    const [tag, chartType] = kinds.find(([name]) => doc.getElementsByTagName(name).length) || [];
    if (!tag) return null;
    const seriesNodes = Array.from(doc.getElementsByTagName(tag)[0].getElementsByTagName("c:ser"));
    if (!seriesNodes.length) return null;
    const points = (series, holder) => Array.from(_pptxFirst(series, holder)?.getElementsByTagName("c:pt") || [])
        .sort((a, b) => Number(a.getAttribute("idx")) - Number(b.getAttribute("idx")))
        .map(pt => _pptxFirst(pt, "c:v")?.textContent ?? "");
    const labels = points(seriesNodes[0], "c:cat");
    // Every series, not only the first: a two-series chart came in with half its data.
    const series = seriesNodes
        .map((node, index) => ({
            label: _pptxFirst(_pptxFirst(node, "c:tx"), "c:v")?.textContent || `Series ${index + 1}`,
            values: points(node, "c:val").map(value => Number(value) || 0),
            color: _pptxChild(_pptxChild(_pptxChild(node, "c:spPr"), "a:solidFill"), "a:srgbClr")?.getAttribute("val") || null,
        }))
        .filter(entry => entry.values.length);
    if (!series.length) return null;
    const count = Math.max(...series.map(entry => entry.values.length));
    const round = chartType === "pie" || chartType === "doughnut";
    const titleText = node => Array.from(node?.getElementsByTagName("a:t") || []).map(t => t.textContent).join("").trim();
    const chartTitle = titleText(_pptxChild(_pptxFirst(doc, "c:chart"), "c:title"));
    const axisTitle = axisTag => titleText(_pptxChild(_pptxFirst(doc, axisTag), "c:title"));
    const legend = _pptxFirst(doc, "c:legend");
    const legendPos = { t: "top", b: "bottom", l: "left", r: "right" }[_pptxFirst(legend, "c:legendPos")?.getAttribute("val")] || "top";
    const element = {
        id: generateId("el"),
        type: "chart",
        chartType,
        chartData: {
            labels: Array.from({ length: count }, (_, index) => labels[index] ?? `Item ${index + 1}`),
            datasets: series.map(entry => ({ label: entry.label, data: entry.values, borderWidth: 1 })),
        },
        chartOptions: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: "top" } } },
        chartStyle: {
            legend: legend ? legendPos : "none",
            title: chartTitle,
            xTitle: round ? "" : axisTitle("c:catAx"),
            yTitle: round ? "" : axisTitle("c:valAx"),
            seriesColors: round ? [] : series.map(entry => (entry.color ? `#${entry.color}` : null)),
        },
        x: box.x,
        y: box.y,
        width: `${Math.max(120, box.w)}px`,
        height: `${Math.max(90, box.h)}px`,
        styles: { zIndex, backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px" },
    };
    if (typeof applyChartSeriesColors === "function") applyChartSeriesColors(element);
    return element;
}

async function _pptxSlideNotes(pkg, rels) {
    const notesPath = Object.values(rels).find(rel => rel.type === "notesSlide")?.path;
    const doc = notesPath && (await pkg.xml(notesPath));
    if (!doc) return "";
    const body = Array.from(doc.getElementsByTagName("p:sp")).find(sp => _pptxPlaceholder(sp)?.type === "body");
    return Array.from(body?.getElementsByTagName("a:p") || [])
        .map(p => Array.from(p.getElementsByTagName("a:t")).map(t => t.textContent).join(""))
        .join("\n")
        .trim();
}

// The deck theme's colour scheme (dk1, lt1, accent1… plus the tx1/bg1 aliases), for colours given by scheme name.
async function _pptxThemeColors(pkg) {
    const colors = {};
    const names = Object.keys(pkg.zip.files || {}).filter(name => /^ppt\/theme\/theme\d+\.xml$/.test(name)).sort();
    const doc = names.length ? await pkg.xml(names[0]) : null;
    const scheme = doc && _pptxFirst(doc, "a:clrScheme");
    Array.from(scheme?.children || []).forEach(node => {
        const key = node.tagName.replace(/^a:/, "");
        const rgb = _pptxChild(node, "a:srgbClr")?.getAttribute("val") || _pptxChild(node, "a:sysClr")?.getAttribute("lastClr");
        if (rgb && /^[0-9a-f]{6}$/i.test(rgb)) colors[key] = `#${rgb}`;
    });
    Object.assign(colors, { tx1: colors.dk1, bg1: colors.lt1, tx2: colors.dk2, bg2: colors.lt2 });
    return colors;
}

// Words inside a filled shape: in the shape's text colour (its style's fontRef, white in Office's default shape
// style) unless the runs set one, and placed where PowerPoint draws them (anchor: top, middle or bottom). They
// came in top-aligned and dark on an orange shape.
function _pptxPlaceShapeText(sp, text, box, themeColors) {
    const txBody = _pptxChild(sp, "p:txBody");
    const hasRunColor = Array.from(txBody?.getElementsByTagName("a:rPr") || []).some(rPr => _pptxChild(rPr, "a:solidFill"));
    const fontRef = _pptxFirst(_pptxChild(sp, "p:style"), "a:fontRef");
    const scheme = _pptxChild(fontRef, "a:schemeClr")?.getAttribute("val");
    const srgb = _pptxChild(fontRef, "a:srgbClr")?.getAttribute("val");
    const styleColor = srgb && /^[0-9a-f]{6}$/i.test(srgb) ? `#${srgb}` : scheme ? themeColors?.[scheme] : null;
    if (!hasRunColor && styleColor) text.styles.color = styleColor;

    const anchor = _pptxChild(txBody, "a:bodyPr")?.getAttribute("anchor") || "t";
    if (anchor !== "ctr" && anchor !== "b") return;
    // The text's height, estimated: wrapped lines at about half an em per character, 1.2 line height.
    const size = parseFloat(text.styles.fontSize) || 18;
    const inner = Math.max(20, box.w - 19);
    const lines = _pptxChildren(txBody, "a:p").reduce((sum, p) => {
        const chars = Array.from(p.getElementsByTagName("a:t")).reduce((n, t) => n + (t.textContent || "").length, 0);
        return sum + Math.max(1, Math.ceil((chars * size * 0.52) / inner));
    }, 0);
    const height = Math.min(box.h, Math.round(lines * size * 1.2 + 10));
    text.y = anchor === "ctr" ? Math.round(box.y + (box.h - height) / 2) : box.y + box.h - height;
    text.height = `${height}px`;
}

async function _pptxSlideElements(pkg, slidePath, scale) {
    const doc = await pkg.xml(slidePath);
    const rels = await pkg.rels(slidePath);
    const links = await pkg.links(slidePath);
    const layoutXfrm = await _pptxLayoutPlaceholders(pkg, slidePath);
    const elements = [];
    // EMU in the coordinates of `transform` -> slide pixels
    const toBox = (xfrm, t) => ({
        x: Math.round(((t.ox + (xfrm.x - t.cx) * t.sx) / PPTX_EMU_PER_PX) * scale),
        y: Math.round(((t.oy + (xfrm.y - t.cy) * t.sy) / PPTX_EMU_PER_PX) * scale),
        w: Math.round(((xfrm.w * t.sx) / PPTX_EMU_PER_PX) * scale),
        h: Math.round(((xfrm.h * t.sy) / PPTX_EMU_PER_PX) * scale),
        rot: xfrm.rot || 0,
        flipH: !!xfrm.flipH,
        flipV: !!xfrm.flipV,
    });
    const walk = async (container, t) => {
        for (const node of Array.from(container.children)) {
            const zIndex = elements.length + 1;
            if (node.tagName === "p:grpSp") {
                const g = _pptxXfrm(node);
                if (!g) continue;
                const sx = g.chW ? (g.w / g.chW) * t.sx : t.sx;
                const sy = g.chH ? (g.h / g.chH) * t.sy : t.sy;
                await walk(node, { sx, sy, cx: g.chX, cy: g.chY, ox: t.ox + (g.x - t.cx) * t.sx, oy: t.oy + (g.y - t.cy) * t.sy });
            } else if (node.tagName === "p:cxnSp" || (node.tagName === "p:sp" && _pptxIsLine(node) && !_pptxFirst(node, "a:t"))) {
                const xfrm = _pptxXfrm(node);
                const connector = xfrm && _pptxConnectorElement(node, toBox(xfrm, t), scale, zIndex);
                if (connector) elements.push(connector);
            } else if (node.tagName === "p:sp") {
                const placeholder = _pptxPlaceholder(node);
                if (placeholder && ["sldNum", "dt", "ftr"].includes(placeholder.type) && !_pptxFirst(node, "a:t")) continue;
                const xfrm = _pptxXfrm(node) || layoutXfrm(placeholder);
                if (!xfrm) continue;
                const box = toBox(xfrm, t);
                const text = _pptxTextElement(node, box, { fontScale: scale, placeholder, zIndex, links });
                const shape = text && !_pptxChild(_pptxChild(node, "p:spPr"), "a:prstGeom") ? null : _pptxShapeElement(node, box, zIndex);
                // A filled shape with words in it: the shape, then its text on top (text boxes have no outline).
                if (shape && text) {
                    delete text.styles.backgroundColor;
                    text.styles.zIndex = zIndex + 1;
                    // PowerPoint centres the words of a shape unless the paragraph says otherwise.
                    if (!_pptxFirst(node, "a:pPr")?.getAttribute("algn")) text.styles.textAlign = "center";
                    _pptxPlaceShapeText(node, text, box, pkg.themeColors);
                    if (typeof text.content === "string" && !/<a\s/i.test(text.content)) {
                        // Plain words go into the shape itself, so they move and resize with it; a bulleted list
                        // stays a text box on top (shape text has no bullets).
                        const anchor = _pptxChild(_pptxChild(node, "p:txBody"), "a:bodyPr")?.getAttribute("anchor") || "t";
                        const scratch = document.createElement("div");
                        scratch.innerHTML = text.content.replace(/<br\s*\/?>/gi, "\n");
                        shape.shapeText = scratch.textContent;
                        shape.shapeTextStyle = {
                            color: text.styles.color,
                            fontSize: text.styles.fontSize,
                            fontFamily: text.styles.fontFamily,
                            fontWeight: text.styles.fontWeight,
                            textAlign: text.styles.textAlign,
                            verticalAlign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
                        };
                        elements.push(shape);
                    } else {
                        elements.push(shape, text);
                    }
                } else if (text) elements.push(text);
                else if (shape) elements.push(shape);
            } else if (node.tagName === "p:pic") {
                const xfrm = _pptxXfrm(node);
                const picture = xfrm && (await _pptxPictureElement(pkg, node, rels, toBox(xfrm, t), zIndex));
                if (picture) elements.push(picture);
            } else if (node.tagName === "p:graphicFrame") {
                const xfrm = _pptxXfrm(node);
                if (!xfrm) continue;
                const box = toBox(xfrm, t);
                const tbl = _pptxFirst(node, "a:tbl");
                const made = tbl ? _pptxTableElement(tbl, box, scale, scale, zIndex) : await _pptxChartElement(pkg, node, rels, box, zIndex);
                if (made) elements.push(made);
            }
        }
    };
    const tree = _pptxFirst(doc, "p:spTree");
    if (tree) await walk(tree, { sx: 1, sy: 1, cx: 0, cy: 0, ox: 0, oy: 0 });
    return { elements, notes: await _pptxSlideNotes(pkg, rels), background: _pptxColor(_pptxFirst(_pptxFirst(doc, "p:bg"), "p:bgPr")) };
}

async function importPptx(file) {
    if (!window.JSZip) {
        alert("Cannot import PPTX because JSZip is missing.");
        return;
    }
    try {
        setProjectSaveHint?.("Reading PowerPoint file…", "muted");
        const pkg = new PptxPackage(await JSZip.loadAsync(file));
        const presentation = await pkg.xml("ppt/presentation.xml");
        if (!presentation) throw new Error("This does not look like a PowerPoint file");
        pkg.themeColors = await _pptxThemeColors(pkg);
        _pptxCurrentThemeColors = pkg.themeColors || {};

        // The page setup closest to the deck's proportions; everything is scaled by one factor so nothing is squashed.
        const size = _pptxFirst(presentation, "p:sldSz");
        const sourceW = (Number(size?.getAttribute("cx")) || 9144000) / PPTX_EMU_PER_PX;
        const sourceH = (Number(size?.getAttribute("cy")) || 6858000) / PPTX_EMU_PER_PX;
        const setups = Object.values(window.PRESENTATION_PAGE_SETUPS || {}).filter(setup => ["standard-4-3", "talk-16-9", "lecture-16-10"].includes(setup.id));
        const setup = setups.sort((a, b) => Math.abs(a.width / a.height - sourceW / sourceH) - Math.abs(b.width / b.height - sourceW / sourceH))[0] || { id: "standard-4-3", width: 1024, height: 768 };
        const scale = Math.min(setup.width / sourceW, setup.height / sourceH);

        const rels = await pkg.rels("ppt/presentation.xml");
        const slidePaths = Array.from(_pptxFirst(presentation, "p:sldIdLst")?.getElementsByTagName("p:sldId") || [])
            .map(node => rels[node.getAttribute("r:id")]?.path)
            .filter(Boolean);
        if (!slidePaths.length) throw new Error("No slides found in this file");

        // Into a project of its own, named after the file (never over the project that is open). Created before the
        // slides are read, so the pictures they upload belong to it.
        const importTitle =
            typeof uniqueImportTitle === "function"
                ? await uniqueImportTitle(String(file.name || "Imported presentation").replace(/\.pptx$/i, ""))
                : String(file.name || "Imported presentation").replace(/\.pptx$/i, "");
        if (typeof startNewProjectForImport === "function") await startNewProjectForImport();

        const slides = [];
        for (const [index, slidePath] of slidePaths.entries()) {
            setProjectSaveHint?.(`Importing slide ${index + 1} of ${slidePaths.length}…`, "muted");
            const { elements, notes, background } = await _pptxSlideElements(pkg, slidePath, scale);
            if (background) {
                // A plain background colour comes in as a rectangle behind everything.
                elements.unshift({
                    id: generateId("el"),
                    type: "shape",
                    shapeType: "rectangle",
                    x: 0,
                    y: 0,
                    width: `${setup.width}px`,
                    height: `${setup.height}px`,
                    content: "",
                    styles: { backgroundColor: background, borderRadius: "0px", zIndex: 0 },
                });
            }
            slides.push({
                id: generateId("slide"),
                layoutId: "blank",
                masterId: "none",
                notes,
                presentationTransition: "none",
                elements,
            });
        }

        state.pageSetup = setup.id;
        syncPresentationPageSetup?.(); // the canvas takes the new proportions before the slides are drawn
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
        const summary = [`${slides.length} slides`, count("image") && `${count("image")} pictures`, count("table") && `${count("table")} tables`, count("chart") && `${count("chart")} charts`].filter(Boolean).join(", ");
        setProjectSaveHint?.(`Imported ${summary}`, "success");
        schedulePresentationAutosave?.();
    } catch (err) {
        console.error("PPTX Import Error:", err);
        alert("Failed to import PPTX: " + err.message);
        setProjectSaveHint?.("Import failed", "danger");
    }
}
