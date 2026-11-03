/**
 * importPptx.js
 * Client-side PowerPoint (.pptx) import using JSZip.
 *
 * Brought in, in their stacking order: text boxes (paragraphs, bullet levels, numbering, alignment, font, size,
 * bold/italic/underline and colour per run), pictures, tables, charts (bar, line, pie, doughnut), basic shapes with
 * their fill, groups (flattened), speaker notes and the slide proportions. Placeholders without their own position
 * take it from the slide layout; text without its own font, size or colour takes the layout's, the master's and the
 * theme's, and a slide without its own background takes its layout's or master's. Pictures keep their cropping and
 * transparency; freeform shapes, arcs and gradient fills are drawn as SVG pictures; rotated groups turn their contents.
 * Builds (entrance and exit effects, paragraph by paragraph for lists) become SlideForge animations in click order.
 * Not imported: SmartArt, video, motion paths and emphasis effects, and shapes drawn on the master or layout.
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
    notchedRightArrow: "arrow-right",
    leftArrow: "arrow-left",
    upArrow: "arrow-up",
    downArrow: "arrow-down",
    rtTriangle: "right-triangle",
    trapezoid: "trapezoid",
    pentagon: "pentagon",
    octagon: "octagon",
    star5: "star",
    star6: "star",
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
// The theme's shape fill styles (<a:fillStyleLst>), which a shape's <a:fillRef idx> picks from.
let _pptxCurrentFillStyles = [];
// The theme's line styles (<a:lnStyleLst>), which a shape's <a:lnRef idx> picks its width from.
let _pptxCurrentLineStyles = [];

// A line's width in EMU: its own, else its style's (lnRef picks a theme line style: an arrow in the theme's 3 pt
// line came in at 1 pt), else PowerPoint's 1 pt.
function _pptxLineWidthEmu(sp, line) {
    const own = Number(line?.getAttribute("w"));
    if (own) return own;
    const index = Number(_pptxChild(_pptxChild(sp, "p:style"), "a:lnRef")?.getAttribute("idx")) || 0;
    return Number(_pptxCurrentLineStyles[index - 1]?.getAttribute?.("w")) || 12700;
}

// PowerPoint's colour modifiers on a theme or RGB colour, applied in the order they are written, as PowerPoint
// does. shade (towards black) and tint (towards white) work on linear light, not on the stored sRGB values: done on
// sRGB, a theme gradient's "shade 51%" came out near black where PowerPoint shows a deep red. sat/hue/lum and their
// Mod/Off forms work in HSL; satMod (130% on most theme gradients) was ignored and those fills came out dull.
function _pptxModifiedColor(hex, colorNode) {
    let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const toSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
    const clamp = c => Math.max(0, Math.min(1, c));
    const toHsl = () => {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
        }
        return [h, s, l];
    };
    const fromHsl = (h, s, l) => {
        const hue = (p, q, t) => {
            t = ((t % 1) + 1) % 1;
            return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
        };
        if (s === 0) return [l, l, l];
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
    };
    const inHsl = change => {
        const [h, s, l] = change(toHsl());
        [r, g, b] = fromHsl(((h % 1) + 1) % 1, clamp(s), clamp(l));
    };
    for (const node of Array.from(colorNode?.children || [])) {
        const raw = node.getAttribute("val");
        const v = raw === null ? null : Number(raw) / 100000;
        switch (node.tagName) {
            case "a:shade":
                if (v !== null) [r, g, b] = [r, g, b].map(c => toSrgb(toLinear(c) * v));
                break;
            case "a:tint":
                if (v !== null) [r, g, b] = [r, g, b].map(c => toSrgb(toLinear(c) * v + (1 - v)));
                break;
            case "a:lumMod":
                if (v !== null) inHsl(([h, s, l]) => [h, s, l * v]);
                break;
            case "a:lumOff":
                if (v !== null) inHsl(([h, s, l]) => [h, s, l + v]);
                break;
            case "a:lum":
                if (v !== null) inHsl(([h, s]) => [h, s, v]);
                break;
            case "a:satMod":
                if (v !== null) inHsl(([h, s, l]) => [h, s * v, l]);
                break;
            case "a:satOff":
                if (v !== null) inHsl(([h, s, l]) => [h, s + v, l]);
                break;
            case "a:sat":
                if (v !== null) inHsl(([h, , l]) => [h, v, l]);
                break;
            // Hue in 60000ths of a degree; hueMod as a factor.
            case "a:hueMod":
                if (v !== null) inHsl(([h, s, l]) => [h * v, s, l]);
                break;
            case "a:hueOff":
                if (raw !== null) inHsl(([h, s, l]) => [h + Number(raw) / 60000 / 360, s, l]);
                break;
            case "a:hue":
                if (raw !== null) inHsl(([, s, l]) => [Number(raw) / 60000 / 360, s, l]);
                break;
            case "a:gray":
                r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                break;
            case "a:inv":
                [r, g, b] = [1 - r, 1 - g, 1 - b];
                break;
            case "a:comp":
                inHsl(([h, s, l]) => [h + 0.5, s, l]);
                break;
            default:
                break; // alpha and friends are read by _pptxFillAlpha
        }
        [r, g, b] = [r, g, b].map(clamp);
    }
    return `#${[r, g, b].map(c => Math.round(clamp(c) * 255).toString(16).padStart(2, "0")).join("")}`;
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

// The fill a shape's style picks from the theme: { color, gradient? }. The bare style colour stood in for it, so a
// text box whose style is the theme's light grey gradient of the text colour came in solid black, hiding its words.
function _pptxStyleFill(sp) {
    const ref = _pptxChild(_pptxChild(sp, "p:style"), "a:fillRef");
    const index = Number(ref?.getAttribute("idx")) || 0;
    if (!ref || index === 0) return null;
    const color = _pptxColorValue(ref);
    const style = _pptxCurrentFillStyles[index - 1];
    if (style?.tagName === "a:noFill") return null;
    const found = style && _pptxFillBackground(style, null, _pptxCurrentThemeColors, color);
    return found?.color ? found : color ? { color } : null; // a picture fill style: its colour
}

// The fonts a presentation carries (<p:embeddedFontLst>): [{ family, style, path }], style regular | bold | italic |
// boldItalic, path the .fntdata part (Embedded OpenType, usually MicroType Express compressed).
async function _pptxEmbeddedFonts(pkg) {
    const presentation = await pkg.xml("ppt/presentation.xml");
    const list = _pptxFirst(presentation, "p:embeddedFontLst");
    if (!list) return [];
    const rels = await pkg.rels("ppt/presentation.xml");
    const found = [];
    _pptxChildren(list, "p:embeddedFont").forEach(entry => {
        const family = _pptxChild(entry, "p:font")?.getAttribute("typeface")?.trim();
        if (!family) return;
        ["regular", "bold", "italic", "boldItalic"].forEach(style => {
            const path = rels[_pptxChild(entry, `p:${style}`)?.getAttribute("r:id")]?.path;
            const file = path && pkg.zip.file(path);
            if (file) found.push({ family, style, path, file });
        });
    });
    return found.slice(0, 60);
}

// Sends each carried font whose family this computer lacks to the user's fonts (js/ui/fonts.js, font_files.py).
// Quiet on failure (no server, a font that cannot be read): the font offer after the import lists what is missing.
async function _pptxInstallEmbeddedFonts(embedded) {
    const missing = new Map();
    for (const { family } of embedded) {
        if (!missing.has(family)) missing.set(family, typeof sfFontAvailable === "function" ? !(await sfFontAvailable(family)) : true);
    }
    const added = new Set();
    for (const font of embedded) {
        if (!missing.get(font.family)) continue;
        try {
            const blob = await font.file.async("blob");
            await window.sfUploadFontFile(new File([blob], font.path.split("/").pop() || "font.fntdata"), { family: font.family, style: font.style });
            added.add(font.family);
        } catch (error) {
            console.warn(`Embedded font ${font.family} (${font.style}) was not added:`, error?.message || error);
        }
    }
    await Promise.all([...added].map(family => document.fonts.load(`16px "${family}"`).catch(() => {})));
    return [...added];
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
            // A link to another slide of the deck ("Place in This Document"): that slide, by the id it is given here
            // (slideIds, set before any slide is read). It was dropped, and the words lost their link.
            else if (/\/slide$/.test(rel.getAttribute("Type") || "") && rel.getAttribute("TargetMode") !== "External") {
                const slideId = this.slideIds?.get(_pptxResolvePath(partPath, target));
                if (slideId) map[rel.getAttribute("Id")] = `#slide:${slideId}`;
            }
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

// A size in pixels to 1/100 px. Whole pixels made 18 pt text 26 px instead of 25.6 on a 1024 px slide, so lines
// wrapped a word earlier than in PowerPoint.
function _pptxPx(value) {
    return Math.round(value * 100) / 100;
}

// An outer shadow (<a:outerShdw blurRad dist dir>) as a CSS text-shadow: titles of many templates have one.
function _pptxTextShadow(shadow, scale) {
    if (!shadow) return null;
    const emu = name => (Number(shadow.getAttribute(name)) || 0) / PPTX_EMU_PER_PX * scale;
    const angle = ((Number(shadow.getAttribute("dir")) || 0) / 60000) * (Math.PI / 180);
    const dist = emu("dist");
    const color = _pptxColorValue(shadow) || "#000000";
    const alpha = _pptxFillAlpha(shadow);
    const round = value => Math.round(value * 10) / 10;
    return `${round(dist * Math.cos(angle))}px ${round(dist * Math.sin(angle))}px ${round(emu("blurRad"))}px ${alpha < 1 ? _pptxRgba(color, alpha) : color}`;
}

// A shape's or picture's glow as a CSS box-shadow: PowerPoint's halo fades out over its radius.
function _pptxShapeGlow(node, scale) {
    const spPr = _pptxChild(node, "p:spPr");
    const glow = _pptxChild(_pptxChild(spPr, "a:effectLst"), "a:glow");
    if (!glow) return null;
    const radius = ((Number(glow.getAttribute("rad")) || 0) / PPTX_EMU_PER_PX) * scale;
    if (!(radius > 0.5)) return null;
    const color = _pptxColorValue(glow) || "#ffff00";
    const alpha = _pptxFillAlpha(glow);
    const round = value => Math.round(value * 10) / 10;
    // PowerPoint's halo stays strong for most of its radius and softens at the edge: mostly spread, some blur.
    return `0 0 ${round(radius * 0.6)}px ${round(radius * 0.7)}px ${alpha < 1 ? _pptxRgba(color, alpha) : color}`;
}

// PowerPoint's automatic numbering (<a:buAutoNum type="alphaLcParenBoth">) as the label it shows for number n:
// arabic, letters or Roman numerals, upper or lower case, followed by a period, a bracket, both brackets, a dash or
// nothing. Every numbered list came in as "1.", "2.": "(a)" lost its letter and its brackets.
function _pptxNumberLabel(n, scheme = "arabicPeriod") {
    const match = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(Period|ParenR|ParenBoth|Plain|Minus)?$/.exec(String(scheme || ""));
    const [kind, punctuation] = match ? [match[1], match[2] || "Plain"] : ["arabic", "Period"];
    const count = Math.max(1, Math.floor(n) || 1);
    let label = String(count);
    if (kind === "alphaLc" || kind === "alphaUc") {
        // PowerPoint's letters after z repeat the letter: aa, bb, ... (27 = aa, 28 = bb).
        const letter = String.fromCharCode(97 + ((count - 1) % 26));
        label = letter.repeat(Math.floor((count - 1) / 26) + 1);
        if (kind === "alphaUc") label = label.toUpperCase();
    } else if (kind === "romanLc" || kind === "romanUc") {
        const numerals = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
        let rest = Math.min(count, 3999);
        label = "";
        numerals.forEach(([value, text]) => {
            while (rest >= value) {
                label += text;
                rest -= value;
            }
        });
        if (kind === "romanUc") label = label.toUpperCase();
    }
    return { Period: `${label}.`, ParenR: `${label})`, ParenBoth: `(${label})`, Minus: `${label} -`, Plain: label }[punctuation];
}

// The editor's own numbered-list styles for the schemes that end in a period ("1.", "a.", "i."), which its lists
// draw themselves; the others ("(a)", "1)") are written out with each paragraph.
const PPTX_LIST_NUMBER_STYLES = { arabicPeriod: "decimal", alphaLcPeriod: "lower-alpha", alphaUcPeriod: "upper-alpha", romanLcPeriod: "lower-roman", romanUcPeriod: "upper-roman" };

// Where a click on linked words goes: a web or mail address, another slide of the deck (#slide:<id>), or the next,
// previous, first or last slide (PowerPoint's "jump" actions, ppaction://hlinkshowjump?jump=nextslide).
const PPTX_SLIDE_JUMPS = { nextslide: "next", previousslide: "previous", firstslide: "first", lastslide: "last" };
function _pptxClickLink(hlinkClick, links = {}) {
    if (!hlinkClick) return null;
    const jump = /^ppaction:\/\/hlinkshowjump\?jump=(\w+)/i.exec(hlinkClick.getAttribute("action") || "")?.[1]?.toLowerCase();
    if (jump) return PPTX_SLIDE_JUMPS[jump] ? `#slide:${PPTX_SLIDE_JUMPS[jump]}` : null;
    return links[hlinkClick.getAttribute("r:id")] || null;
}

// One paragraph as HTML plus what it says about the whole box (size, colour, font, alignment, bullet).
// lineReduction: normAutofit's lnSpcReduction (in thousandths of a percent), what PowerPoint took off the line
// spacing to fit the text in its box.
function _pptxParagraph(p, fontScale, links = {}, lineReduction = 0) {
    const pPr = _pptxChild(p, "a:pPr");
    const level = Number(pPr?.getAttribute("lvl")) || 0;
    const autoNum = pPr && _pptxChild(pPr, "a:buAutoNum");
    const numbered = !!autoNum;
    const numberScheme = autoNum?.getAttribute("type") || "arabicPeriod";
    const numberStart = Math.max(1, Number(autoNum?.getAttribute("startAt")) || 1);
    const bullet = pPr && _pptxChild(pPr, "a:buNone") ? false : pPr && (_pptxChild(pPr, "a:buChar") || numbered) ? true : null;
    const align = { ctr: "center", r: "right", just: "justify", l: "left" }[pPr?.getAttribute("algn")] || null;
    // The bullet's own character ("Ø" in Wingdings is an arrowhead), for boxes that mix bulleted and plain paragraphs.
    const buChar = pPr && _pptxChild(pPr, "a:buChar");
    const glyph = buChar ? _pptxBulletGlyph(buChar.getAttribute("char"), _pptxChild(pPr, "a:buFont")?.getAttribute("typeface")) : numbered ? _pptxNumberLabel(numberStart, numberScheme) : "•";
    // Line spacing: a percentage of single spacing (PowerPoint's single line is about 1.2 times the font size).
    const lnPct = Number(_pptxChild(_pptxChild(pPr, "a:lnSpc"), "a:spcPct")?.getAttribute("val"));
    // A box shrunk to fit (lnSpcReduction) has its lines that many percentage points closer: 150% spacing less 10%
    // is 140%. The lines came in further apart than PowerPoint draws them and wrapped onto another line.
    const reducedPct = (lnPct > 0 ? lnPct : 100000) - lineReduction;
    const exactLines = Number(_pptxChild(_pptxChild(pPr, "a:lnSpc"), "a:spcPts")?.getAttribute("val")) > 0;
    let lineHeight = lnPct > 0 || (lineReduction > 0 && !exactLines) ? Math.round(1.2 * (Math.max(20000, reducedPct) / 100000) * 100) / 100 : null;
    // Or exactly so many points from line to line (spcPts): a title's 78.4 pt lines for 80 pt text came in 1.2 apart,
    // and the second line sat a quarter of a line too low. As a multiple of the paragraph's largest text, below.
    const lnPts = Number(_pptxChild(_pptxChild(pPr, "a:lnSpc"), "a:spcPts")?.getAttribute("val"));
    // The size an empty paragraph (a blank line) has: its end mark's, not the box's.
    const endSize = Number(_pptxChild(p, "a:endParaRPr")?.getAttribute("sz"));
    // Space before and after the paragraph, in points (spcPts is in hundredths of a point).
    // Or as a percentage of a line (spcPct: 20% of a 24 pt line), measured on the paragraph's largest text. That
    // was read as no space, and paragraphs came in closer together than in PowerPoint.
    const spacing = name => {
        const holder = _pptxChild(pPr, name);
        const points = Number(_pptxChild(holder, "a:spcPts")?.getAttribute("val"));
        if (points) return points / 100;
        const percent = Number(_pptxChild(holder, "a:spcPct")?.getAttribute("val"));
        if (!(percent > 0)) return 0;
        const largestPx = Math.max(0, ...runs.filter(run => !run.br).map(run => run.size || 0), endSize ? (endSize / 100) * (96 / 72) * fontScale : 0);
        const largestPt = largestPx / ((96 / 72) * fontScale) || 18;
        return (percent / 100000) * 1.2 * largestPt;
    };
    const runs = [];
    Array.from(p.children).forEach(node => {
        // A line break has a size of its own (its rPr), which sets the height of the line it ends: a title slide
        // spaced its address down with breaks of 20 and 28 pt, and it came in a line and a half too high.
        if (node.tagName === "a:br") {
            const brSize = Number((_pptxChild(node, "a:rPr") || _pptxChild(pPr, "a:defRPr"))?.getAttribute("sz"));
            runs.push({ br: true, size: brSize ? _pptxPx((brSize / 100) * (96 / 72) * fontScale) : null });
        }
        if (node.tagName !== "a:r" && node.tagName !== "a:fld") return;
        const own = _pptxChild(node, "a:rPr");
        const rPr = (_pptxChild(pPr, "a:defRPr") || own)?.cloneNode(true);
        if (rPr && own) {
            Array.from(own.attributes).forEach(a => rPr.setAttribute(a.name, a.value));
            Array.from(own.children).forEach(child => {
                _pptxChildren(rPr, child.tagName).forEach(old => old.remove());
                rPr.appendChild(child.cloneNode(true));
            });
        }
        const size = Number(rPr?.getAttribute("sz"));
        const runGradient = _pptxChild(rPr, "a:gradFill") ? _pptxFillBackground(_pptxChild(rPr, "a:gradFill"), null, _pptxCurrentThemeColors) : null;
        runs.push({
            text: _pptxSymbolFontText(_pptxFirst(node, "a:t")?.textContent || "", rPr),
            size: size ? _pptxPx((size / 100) * (96 / 72) * fontScale) : null,
            // Superscript and subscript (baseline="30000" / "-25000"): chemical formulas and units lost them.
            baseline: Number(rPr?.getAttribute("baseline")) || 0,
            shadow: _pptxTextShadow(_pptxChild(_pptxChild(rPr, "a:effectLst"), "a:outerShdw"), fontScale),
            bold: rPr?.getAttribute("b") === "1",
            italic: rPr?.getAttribute("i") === "1",
            underline: !!rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none",
            caps: rPr?.getAttribute("cap") === "all",
            // A highlighter colour behind the words (<a:highlight>): a yellow-marked title came in unmarked.
            highlight: _pptxColorValue(_pptxChild(rPr, "a:highlight")) || null,
            color: _pptxColor(rPr) || runGradient?.color || null,
            // Letters filled with a gradient (WordArt's yellow-to-orange "Thank you"): they came in black.
            gradient: runGradient?.gradient || null,
            // A run set in Wingdings or Symbol is translated to Unicode (_pptxSymbolFontText): drawn in the box's font.
            font: /^(wingdings|symbol)$/i.test(_pptxChild(rPr, "a:latin")?.getAttribute("typeface") || "") ? null : _pptxChild(rPr, "a:latin")?.getAttribute("typeface") || null,
            // Letter spacing (spc, in hundredths of a point; negative tightens): titles set tight came in loose.
            spacing: rPr?.hasAttribute("spc") ? Math.round((Number(rPr.getAttribute("spc")) / 100) * (96 / 72) * fontScale * 100) / 100 : null,
            // A linked run (a:hlinkClick) keeps its web address; it came in as plain text.
            link: _pptxClickLink(_pptxChild(rPr, "a:hlinkClick"), links),
        });
    });
    const text = runs.filter(run => !run.br);
    const length = text.reduce((sum, run) => sum + run.text.length, 0);
    if (!lineHeight && lnPts > 0) {
        const largest = Math.max(0, ...text.map(run => run.size || 0), endSize ? _pptxPx((endSize / 100) * (96 / 72) * fontScale) : 0);
        if (largest > 0) lineHeight = Math.round(((lnPts / 100) * (96 / 72) * fontScale / largest) * 100) / 100;
    }
    // The value most of the text has becomes the box's own style; runs that differ get a span.
    const dominant = key => {
        const weight = new Map();
        text.forEach(run => run[key] != null && run[key] !== false && weight.set(run[key], (weight.get(run[key]) || 0) + Math.max(1, run.text.length)));
        const best = [...weight.entries()].sort((a, b) => b[1] - a[1])[0];
        return best && best[1] * 2 >= Math.max(1, length) ? best[0] : null;
    };
    return {
        level,
        bullet,
        numbered,
        numberScheme,
        numberStart,
        align,
        runs,
        length,
        dominant,
        glyph,
        lineHeight,
        marginLeft: pPr?.hasAttribute("marL") ? Number(pPr.getAttribute("marL")) / PPTX_EMU_PER_PX * fontScale : null,
        indent: pPr?.hasAttribute("indent") ? Number(pPr.getAttribute("indent")) / PPTX_EMU_PER_PX * fontScale : null,
        spaceBefore: spacing("a:spcBef") * (96 / 72) * fontScale,
        spaceAfter: spacing("a:spcAft") * (96 / 72) * fontScale,
        spaceAroundPx: (spacing("a:spcBef") + spacing("a:spcAft")) * (96 / 72) * fontScale,
        endSize: endSize ? _pptxPx((endSize / 100) * (96 / 72) * fontScale) : null,
    };
}

// Bullet characters of symbol fonts (Wingdings, Symbol) as the Unicode characters they show.
const PPTX_SYMBOL_BULLETS = { "Ø": "➢", "§": "▪", "ü": "✓", "þ": "☑", "q": "❑", "o": "□", "p": "□", "r": "❒", "u": "◆", "w": "⬥", "v": "❖", "n": "■", "l": "●", "m": "○", "ð": "⇨", "à": "➔", "è": "➔", "Ü": "➤", "·": "•", "-": "–" };

// Wingdings characters (codes 0x20-0xFF) as Unicode characters fonts have. Unicode's exact equivalents of its
// arrows and hands (U+1F8xx, U+2B8x) are in few fonts and showed as empty boxes, so close, common ones stand in.
const PPTX_WINGDINGS = (() => {
    const map = {
        0x21: "✎", 0x22: "✂", 0x23: "✁", 0x24: "👓", 0x25: "🔔", 0x26: "📖", 0x27: "🕯", 0x28: "☎", 0x29: "✆", 0x2a: "✉",
        0x2b: "✉", 0x2c: "📪", 0x2d: "📫", 0x2e: "📬", 0x2f: "📭", 0x30: "📁", 0x31: "📂", 0x32: "📄", 0x33: "📄", 0x34: "📄",
        0x35: "🗄", 0x36: "⌛", 0x37: "⌨", 0x38: "🖱", 0x39: "🖲", 0x3a: "🖥", 0x3b: "🖴", 0x3c: "💾", 0x3d: "💾", 0x3e: "✇",
        0x3f: "✍", 0x40: "✍", 0x41: "✌", 0x42: "👌", 0x43: "👍", 0x44: "👎", 0x45: "☜", 0x46: "☞", 0x47: "☝", 0x48: "☟",
        0x49: "✋", 0x4a: "☺", 0x4b: "😐", 0x4c: "☹", 0x4d: "💣", 0x4e: "☠", 0x4f: "⚐", 0x50: "⚑", 0x51: "✈", 0x52: "☼",
        0x53: "💧", 0x54: "❄", 0x55: "✝", 0x56: "✞", 0x57: "✟", 0x58: "✠", 0x59: "✡", 0x5a: "☪", 0x5b: "☯", 0x5c: "ॐ",
        0x5d: "☸", 0x6a: "&", 0x6b: "&", 0x6c: "●", 0x6d: "○", 0x6e: "■", 0x6f: "□", 0x70: "□", 0x71: "❑", 0x72: "❒",
        0x73: "⬧", 0x74: "⧫", 0x75: "◆", 0x76: "❖", 0x77: "⬥", 0x78: "⌧", 0x79: "⍓", 0x7a: "⌘", 0x7b: "❀", 0x7c: "✿",
        0x7d: "❝", 0x7e: "❞", 0x80: "⓪", 0x8b: "⓿", 0x96: "❧", 0x97: "☙", 0x98: "☙", 0x99: "❧", 0x9a: "❦", 0x9b: "❦",
        0x9c: "❦", 0x9d: "❦", 0x9e: "·", 0x9f: "•", 0xa0: "▪", 0xa1: "○", 0xa2: "⭕", 0xa3: "◯", 0xa4: "◉", 0xa5: "◎",
        0xa6: "◯", 0xa7: "▪", 0xa8: "◻", 0xa9: "⯅", 0xaa: "✦", 0xab: "★", 0xac: "✶", 0xad: "✴", 0xae: "✹", 0xaf: "✵",
        0xb0: "⌖", 0xb1: "⌖", 0xb2: "⟡", 0xb3: "⌑", 0xb4: "⍰", 0xb5: "✪", 0xb6: "✰", 0xd5: "⌫", 0xd6: "⌦", 0xd7: "◀",
        0xd8: "▶", 0xd9: "▲", 0xda: "▼", 0xdb: "◀", 0xdc: "▶", 0xdd: "▲", 0xde: "▼", 0xdf: "⬅", 0xe0: "➡", 0xe1: "⬆",
        0xe2: "⬇", 0xe3: "⬉", 0xe4: "⬈", 0xe5: "⬋", 0xe6: "⬊", 0xe7: "⬅", 0xe8: "➔", 0xe9: "⬆", 0xea: "⬇", 0xeb: "⬉",
        0xec: "⬈", 0xed: "⬋", 0xee: "⬊", 0xef: "⇦", 0xf0: "⇨", 0xf1: "⇧", 0xf2: "⇩", 0xf3: "⬄", 0xf4: "⇳", 0xf5: "⬁",
        0xf6: "⬀", 0xf7: "⬃", 0xf8: "⬂", 0xf9: "▭", 0xfa: "▫", 0xfb: "✗", 0xfc: "✓", 0xfd: "☒", 0xfe: "☑",
    };
    "♈♉♊♋♌♍♎♏♐♑♒♓".split("").forEach((sign, i) => (map[0x5e + i] = sign));
    "①②③④⑤⑥⑦⑧⑨⑩".split("").forEach((digit, i) => (map[0x81 + i] = digit));
    "❶❷❸❹❺❻❼❽❾❿".split("").forEach((digit, i) => (map[0x8c + i] = digit));
    "🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛".match(/\p{Extended_Pictographic}/gu).forEach((clock, i) => (map[0xb7 + i] = clock));
    "↰↱↲↳↴↵↶↷".split("").forEach((arrow, i) => (map[0xc3 + i] = arrow));
    return map;
})();

// Text set in a symbol font (Wingdings, Symbol) as the Unicode characters it shows: a run says so with <a:sym>
// (then only its symbol characters, stored as U+F020-F0FF, are the font's) or with <a:latin> (all of it). Without
// the font the browser drew an empty box for "" (Wingdings' arrow, U+F0E8).
function _pptxSymbolFontText(text, rPr) {
    if (!text) return text;
    const sym = _pptxChild(rPr, "a:sym")?.getAttribute("typeface") || "";
    const latin = _pptxChild(rPr, "a:latin")?.getAttribute("typeface") || "";
    const tableFor = face => (/^wingdings$/i.test(face) ? PPTX_WINGDINGS : /^symbol$/i.test(face) && typeof PPTX_SYMBOL_FONT !== "undefined" ? PPTX_SYMBOL_FONT : null);
    const symTable = tableFor(sym);
    const latinTable = tableFor(latin);
    if (!symTable && !latinTable && !/[-]/.test(text)) return text;
    return Array.from(text, char => {
        const code = char.codePointAt(0);
        const isPrivate = code >= 0xf020 && code <= 0xf0ff;
        const low = isPrivate ? code - 0xf000 : code;
        const table = isPrivate ? symTable || latinTable || PPTX_WINGDINGS : latinTable;
        return (table && low <= 0xff && table[low]) || char;
    }).join("");
}

function _pptxBulletGlyph(char, font) {
    const value = String(char || "•");
    const code = value.codePointAt(0) || 0;
    // Wingdings characters are often stored in the private use area (U+F0xx): the low byte is the symbol.
    const plain = code >= 0xf000 && code <= 0xf0ff ? String.fromCharCode(code - 0xf000) : value;
    if (/wingdings|symbol|webdings/i.test(font || "") || plain !== value) return PPTX_SYMBOL_BULLETS[plain] || "•";
    return value;
}

function _pptxRunsHtml(runs, box) {
    return runs
        .map(run => {
            if (run.br) return run.size && run.size !== box.size ? `<span style="font-size: ${run.size}px;">\u200b</span><br>` : "<br>";
            const styles = [];
            if (run.size && run.size !== box.size) styles.push(`font-size: ${run.size}px`);
            if (run.font && run.font !== box.font && !run.font.startsWith("+")) styles.push(`font-family: ${_pptxEscape(_pptxFontStack(run.font))}`);
            if (run.color && run.color !== box.color) styles.push(`color: ${run.color}`);
            if (run.bold !== box.bold) styles.push(`font-weight: ${run.bold ? 700 : 400}`);
            if (run.italic) styles.push("font-style: italic");
            if (run.underline) styles.push("text-decoration: underline");
            if (run.highlight) styles.push(`background-color: ${run.highlight}`);
            else if (run.gradient) styles.push(`background-image: ${run.gradient}`, "-webkit-background-clip: text", "background-clip: text", "-webkit-text-fill-color: transparent");
            const text = _pptxEscape(run.text);
            let html = styles.length ? `<span style="${styles.join("; ")};">${text}</span>` : text;
            if (run.baseline) html = run.baseline > 0 ? `<sup>${html}</sup>` : `<sub>${html}</sub>`;
            return run.link ? `<a href="${_pptxEscape(run.link)}">${html}</a>` : html;
        })
        .join("");
}

// Text boxes whose paragraphs set no alignment, neither themselves nor through the deck's text styles.
const _pptxUnalignedText = new WeakSet();

function _pptxTextElement(sp, box, { fontScale, placeholder, zIndex, links, design = null }) {
    const txBody = _pptxChild(sp, "p:txBody");
    const sourceBodyPr = _pptxChild(txBody, "a:bodyPr");
    // Anchoring, margins and wrapping the box does not set come from its layout and master placeholder: titles
    // anchored in the middle of their box came in at its top.
    const bodyPr = _pptxBodyProperties(design, placeholder, sp);
    // Vertical text (<a:bodyPr vert="vert270">: a label up the side of a poster's figure): its lines run along the
    // box's height, a quarter turn from the box. The words come in as a box turned that way, as wide as the shape is
    // tall, about the same centre. They came in horizontal, across the narrow box.
    const vertical = bodyPr?.getAttribute("vert");
    const verticalTurn = vertical === "vert" || vertical === "eaVert" || vertical === "mongolianVert" ? 90 : vertical === "vert270" ? 270 : 0;
    if (verticalTurn) {
        box = { ...box, x: box.x + (box.w - box.h) / 2, y: box.y + (box.h - box.w) / 2, w: box.h, h: box.w };
    }
    const autofit = _pptxChild(sourceBodyPr, "a:normAutofit");
    const textScale = autofit?.hasAttribute("fontScale") ? Number(autofit.getAttribute("fontScale")) / 100000 : 1;
    const paragraphs = _pptxChildren(txBody, "a:p").map(p => {
        const copy = p.cloneNode(true);
        const own = _pptxChild(copy, "a:pPr");
        const level = Number(own?.getAttribute("lvl")) || 0;
        const inherited = _pptxParagraphDefaults(design, placeholder, sp, level);
        if (own) {
            Array.from(own.attributes).forEach(a => inherited.setAttribute(a.name, a.value));
            const bulletTags = ["a:buNone", "a:buChar", "a:buAutoNum"];
            Array.from(own.children).forEach(child => {
                (bulletTags.includes(child.tagName) ? bulletTags : [child.tagName]).forEach(tag => _pptxChildren(inherited, tag).forEach(n => n.remove()));
                inherited.appendChild(child.cloneNode(true));
            });
            own.remove();
        }
        copy.insertBefore(inherited, copy.firstChild);
        return _pptxParagraph(copy, fontScale * textScale, links, Number(autofit?.getAttribute("lnSpcReduction")) || 0);
    });
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
    // What the text does not set itself comes from the deck's layout, master and theme.
    const inherited = design ? _pptxTextDefaults(design, placeholder) : {};
    const inheritedSize = inherited.size ? _pptxPx(inherited.size * (96 / 72) * fontScale * textScale) : null;
    // Runs that set no colour take the shape style's text colour (<p:style><a:fontRef>, white on Office's filled
    // shapes and title bars), else the inherited one, before the box's colour is chosen from them: a title bar's
    // white words came in black, and in a title whose purple phrase was the longer part, the rest turned purple.
    const fontRef = _pptxFirst(_pptxChild(sp, "p:style"), "a:fontRef");
    const defaultColor = (fontRef && _pptxColorValue(fontRef)) || inherited.color || null;
    if (defaultColor) paragraphs.forEach(p => p.runs.forEach(run => {
        if (!run.br && !run.color) run.color = defaultColor;
    }));
    const style = {
        // PowerPoint's own defaults are in points, like everything else here (18 came in as 18 px, 13.5 pt).
        size: pick("size") || inheritedSize || _pptxPx((isTitle ? 44 : 18) * (96 / 72) * fontScale * textScale),
        color: pick("color") || inherited.color || "#172033",
        bold: pick("bold") === true || (pick("bold") == null && inherited.bold === true),
        font: _pptxFontName(pick("font"), design?.theme) || inherited.font || null,
        caps: pick("caps") === true,
        spacing: pick("spacing"),
    };
    const align = paragraphs.find(p => p.align)?.align || (placeholder?.type === "ctrTitle" || placeholder?.type === "subTitle" ? "center" : "left");

    // A box is a list when its paragraphs carry bullets (or it is a body placeholder that does not switch them off).
    const bodyPlaceholder = placeholder && !isTitle && placeholder.type === "body";
    const filled = paragraphs.filter(p => p.length);
    const listed = filled.filter(p => p.bullet === true || (p.bullet === null && bodyPlaceholder));
    const isList = filled.length > 0 && listed.length === filled.length && (filled.length > 1 || filled[0].bullet === true);
    const numbered = isList && filled.every(p => p.numbered);
    // A numbered list the editor's lists can draw: one scheme ending in a period, starting at 1. Others ("(a)", "1)",
    // a list starting at 4) are written out paragraph by paragraph.
    const listNumberStyle = numbered && filled.every(p => PPTX_LIST_NUMBER_STYLES[p.numberScheme] && p.numberScheme === filled[0].numberScheme && p.numberStart === 1) ? PPTX_LIST_NUMBER_STYLES[filled[0].numberScheme] : null;
    const preciseParagraphs = paragraphs.some(p => p.marginLeft !== null || p.indent !== null || p.align || p.spaceAroundPx || (p.bullet && !p.numbered && p.glyph !== "•") || (p.numbered && !listNumberStyle));

    let content;
    if (isList && !preciseParagraphs) {
        content = filled.map(p => ({ html: _pptxRunsHtml(p.runs, style), level: Math.min(4, p.level) }));
    } else {
        // Plain paragraphs, with the bullet character in front of those that have one (a box that mixes a heading
        // line with bullets lost them all), and blank lines at their own size (one at 18 pt pushed 16 pt text down).
        content = paragraphs
            .map(p => {
                if (!p.length) return p.endSize && p.endSize !== style.size ? `<span style="font-size: ${p.endSize}px;">\u200b</span>` : "";
                const bulleted = p.bullet === true || (p.bullet === null && bodyPlaceholder);
                const indent = p.level ? "\u00a0\u00a0\u00a0\u00a0".repeat(p.level) : "";
                return (bulleted ? `${indent}${_pptxEscape(p.glyph)}\u00a0\u00a0` : "") + _pptxRunsHtml(p.runs, style);
            })
            .join("<br>");
    }
    if (preciseParagraphs) {
        // Each list level counts on its own; a paragraph at a level above (or a differently numbered or plain one at
        // the same level) starts it again, from its startAt.
        const counters = [];
        const nextNumber = p => {
            const level = Math.min(8, p.level || 0);
            counters.length = Math.min(counters.length, level + 1);
            const current = counters[level];
            counters[level] = current && current.scheme === p.numberScheme ? { scheme: p.numberScheme, n: current.n + 1 } : { scheme: p.numberScheme, n: p.numberStart };
            return _pptxNumberLabel(counters[level].n, p.numberScheme);
        };
        content = paragraphs.map(p => {
            // An empty paragraph has no bullet in PowerPoint (a blank line between two bullets showed a third).
            const bulleted = p.length > 0 && (p.bullet === true || (p.bullet === null && bodyPlaceholder));
            const margin = p.marginLeft ?? (bulleted ? 24 * fontScale : 0);
            const indent = p.indent ?? (bulleted ? -18 * fontScale : 0);
            if (p.length && !p.numbered) counters.length = Math.min(counters.length, Math.min(8, p.level || 0));
            const marker = bulleted ? `${_pptxEscape(p.numbered ? nextNumber(p) : p.glyph)}&#160;` : "";
            // A paragraph whose words are all smaller than the box's is as tall as its largest words: an 11 pt line
            // (a gap under a heading) in 24 pt text kept the 24 pt line height, and the bullets below came in low.
            const largest = Math.max(0, ...p.runs.filter(run => !run.br && run.text).map(run => run.size || style.size || 0));
            const ownSize = largest > 0 && style.size && largest < style.size ? `;font-size:${largest}px` : "";
            const css = `margin:0;margin-left:${margin}px;text-indent:${indent}px;margin-top:${p.spaceBefore}px;margin-bottom:${p.spaceAfter}px;line-height:${p.lineHeight || 1.2};text-align:${p.align || align}${ownSize}`;
            // An empty paragraph is as tall as its end mark's size (two 32 pt blank lines spaced a title slide's
            // address down; at the box's size they came in short and it overlapped the picture above).
            const blank = p.endSize && p.endSize !== style.size ? `<span style="font-size: ${p.endSize}px;">\u200b</span><br>` : "<br>";
            return `<p style="${css}">${marker}${_pptxRunsHtml(p.runs, style) || blank}</p>`;
        }).join("");
    }
    const lineHeight = paragraphs.find(p => p.lineHeight)?.lineHeight || null;
    // A list's gap between paragraphs: their own space before and after (SlideForge's lists add 0.35 em otherwise,
    // which made imported lists taller than their boxes).
    const listGap = isList ? Math.round((filled.slice(1).reduce((sum, p) => sum + p.spaceAroundPx, 0) / Math.max(1, filled.length - 1) / style.size) * 100) / 100 : null;

    const shadow = pick("shadow");
    const fill = _pptxColor(_pptxChild(sp, "p:spPr"));
    // A box smaller than the editor's smallest (40 x 24) grows about where its words are anchored: centred words
    // stay centred on the box, right-aligned ones on its right edge. It grew to the right and down only, and the
    // letters of a row of 33 px residue boxes each sat on the next box's border.
    const width = Math.max(40, box.w);
    const height = Math.max(24, box.h);
    const anchor = bodyPr?.getAttribute("anchor");
    const x = align === "center" ? box.x - (width - box.w) / 2 : align === "right" ? box.x - (width - box.w) : box.x;
    const y = anchor === "ctr" ? box.y - (height - box.h) / 2 : anchor === "b" ? box.y - (height - box.h) : box.y;
    const element = {
        id: generateId("el"),
        type: "text",
        x: Math.round(x),
        y: Math.round(y),
        width: `${width}px`,
        height: `${height}px`,
        content,
        autoHeight: false,
        // "Shrink text on overflow" (normAutofit): shrunk to fit its box, as PowerPoint, WPS and LibreOffice draw it.
        // Without a stored scale, titles too long for their box came in wrapped onto two lines.
        // When PowerPoint stored the scale it fitted the text at (fontScale, lnSpcReduction), that scale is already
        // applied above and the box keeps it: shrinking it again made a title whose 150% line spacing runs past its
        // box half its size.
        textFitMode: autofit && !autofit.hasAttribute("fontScale") && !autofit.hasAttribute("lnSpcReduction") ? "autofit" : "fixed",
        ...(isList && !preciseParagraphs ? { bulletStyle: "default" } : {}),
        // PowerPoint never mirrors words: a vertical flip turns them a half turn instead. A text box turned 180° and
        // flipped vertically reads upright, and it came in upside down.
        ...((box.rot + verticalTurn + (box.flipV ? 180 : 0)) % 360 ? { rotation: (box.rot + verticalTurn + (box.flipV ? 180 : 0)) % 360 } : {}),
        styles: {
            padding: ["tIns", "rIns", "bIns", "lIns"].map((name, i) => `${(Number(bodyPr?.getAttribute(name) ?? [45720, 91440, 45720, 91440][i]) / PPTX_EMU_PER_PX) * fontScale}px`).join(" "),
            minWidth: "0px",
            minHeight: "0px",
            boxSizing: "border-box",
            "--pptx-text-anchor": ({ ctr: "center", b: "end" }[bodyPr?.getAttribute("anchor")] || "start"),
            ...(bodyPr?.getAttribute("wrap") === "none" ? { "--pptx-nowrap": "1" } : {}),
            color: style.color,
            fontSize: `${style.size}px`,
            fontFamily: style.font ? _pptxFontStack(style.font) : '"Manrope", sans-serif',
            fontWeight: style.bold ? "700" : "400",
            textAlign: align,
            zIndex,
            ...(style.caps ? { textTransform: "uppercase" } : {}),
            ...(style.spacing ? { letterSpacing: `${style.spacing}px` } : {}),
            ...(lineHeight ? { lineHeight: String(lineHeight) } : {}),
            ...(listGap !== null ? { "--bullet-gap": `${listGap}em` } : {}),
            ...(fill ? { backgroundColor: fill } : {}),
            ...(shadow ? { textShadow: shadow } : {}),
        },
    };
    if (!paragraphs.some(p => p.align)) _pptxUnalignedText.add(element);
    if (numbered && !preciseParagraphs && typeof applyTextBulletState === "function") applyTextBulletState(element, "numbered", listNumberStyle || "decimal");
    return element;
}

function _pptxShapeElement(sp, box, zIndex) {
    const spPr = _pptxChild(sp, "p:spPr");
    const preset = _pptxChild(spPr, "a:prstGeom")?.getAttribute("prst");
    // Its own fill, or none when it says noFill, else its style's.
    // A gradient fill as a CSS gradient (shapes with one were dropped: the first of four step circles went missing).
    const ownFill = _pptxColor(spPr) || _pptxChild(spPr, "a:gradFill") || _pptxChild(spPr, "a:noFill") || _pptxChild(spPr, "a:blipFill");
    const gradient = _pptxChild(spPr, "a:gradFill") ? _pptxFillBackground(_pptxChild(spPr, "a:gradFill"), null, _pptxCurrentThemeColors) : ownFill ? null : _pptxStyleFill(sp);
    const fill = _pptxColor(spPr) || gradient?.color || null;
    const line = _pptxChild(spPr, "a:ln");
    const lineColor = line && _pptxChild(line, "a:noFill") ? null : (line && _pptxColor(line)) || _pptxStyleColor(sp, "a:lnRef");
    if (!preset || (!fill && !lineColor)) return null;
    const alpha = _pptxFillAlpha(_pptxChild(spPr, "a:solidFill"));
    const lineWidth = Math.max(1, Math.round(_pptxLineWidthEmu(sp, line) / 12700));
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
            backgroundColor: fill && alpha < 1 ? _pptxRgba(fill, alpha) : fill || "transparent",
            // A CSS gradient paints the whole box: only boxes that are their own outline can take one (a turned
            // trapezoid with a gradient came in as a square). Other shapes take the gradient's first colour.
            ...(gradient?.gradient && ["rect", "roundRect", "ellipse"].includes(preset) ? { background: gradient.gradient } : {}),
            borderRadius: preset === "ellipse" ? "9999px" : preset === "roundRect" ? "16px" : "0px",
            ...(lineColor ? { borderColor: lineColor, borderWidth: `${lineWidth}px`, borderStyle: _pptxBorderStyle(line) } : {}),
            zIndex,
        },
    };
}

// A dashed or dotted outline (<a:prstDash>) as a CSS border style: a dashed ellipse came in solid.
function _pptxBorderStyle(line) {
    const dash = _pptxChild(line, "a:prstDash")?.getAttribute("val") || "solid";
    return dash === "solid" ? "solid" : /dot/i.test(dash) && !/dash/i.test(dash) ? "dotted" : "dashed";
}

// The opacity a colour element carries (<a:alpha val="40000"/> is 40 %).
function _pptxFillAlpha(holder) {
    const color = holder && (_pptxChild(holder, "a:srgbClr") || _pptxChild(holder, "a:schemeClr") || _pptxChild(holder, "a:sysClr"));
    const alpha = Number(_pptxChild(color, "a:alpha")?.getAttribute("val"));
    return alpha >= 0 && _pptxChild(color, "a:alpha") ? Math.max(0, Math.min(1, alpha / 100000)) : 1;
}

function _pptxRgba(hex, alpha) {
    const value = parseInt(String(hex).slice(1), 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.round(alpha * 1000) / 1000})`;
}

// Presets drawn as SVG instead of a SlideForge shape: a rectangle stood in for them (an arc became a filled box, a
// donut ringing a picture a solid square that hid it, a brace an empty box).
// Whether a preset shape is drawn as a picture of its outline rather than made one of the editor's own shapes:
// every preset the editor has no exact shape for (a lightning bolt, a heart, a cloud, a can, brackets, flowchart
// symbols came in as rectangles), and the ones it has when adjusted or mirrored (a fatter arrow, an arrow pointing
// left). Rectangles, rounded rectangles and ellipses stay the editor's: their boxes draw them exactly.
const PPTX_EDITOR_EXACT_PRESETS = new Set(["rect", "roundRect", "ellipse", "triangle", "diamond", "hexagon", "parallelogram", "rightArrow", "leftArrow", "upArrow", "downArrow", "rtTriangle", "trapezoid", "pentagon", "octagon", "star5", "plus", "chevron", "wedgeRectCallout"]);
function _pptxDrawsPreset(spPr, box = null) {
    const geometry = _pptxChild(spPr, "a:prstGeom");
    const kind = geometry?.getAttribute("prst");
    if (!kind) return false;
    if (PPTX_DRAWN_PRESETS.has(kind)) return true;
    if (typeof PPTX_PRESET_SHAPES === "undefined" || !Object.prototype.hasOwnProperty.call(PPTX_PRESET_SHAPES, kind)) return false;
    if (kind === "rect" || kind === "roundRect" || kind === "ellipse") return false;
    if (!PPTX_EDITOR_EXACT_PRESETS.has(kind)) return true;
    const adjusted = _pptxChildren(_pptxChild(geometry, "a:avLst"), "a:gd").length > 0;
    return adjusted || !!(box && (box.flipH || box.flipV));
}

const PPTX_DRAWN_PRESETS = new Set(["moon", "curvedDownArrow", "curvedUpArrow", "curvedLeftArrow", "curvedRightArrow", "arc", "blockArc", "circularArrow", "leftCircularArrow", "leftRightArrow", "upDownArrow", "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5", "donut", "leftBrace", "rightBrace"]);

// PowerPoint's dash styles as SVG dash patterns, in line widths.
const PPTX_DASHES = { dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };

// The outline of a freeform shape (<a:custGeom>) or an arc preset as SVG path data, in box pixels.
// An SVG path (M, L, C, A and Z commands) with each point moved by map, for a quarter turn or a mirror: the axes of
// each arc swap, and a mirror (flips true) reverses its sweep.
function _pptxTransformPath(d, map, flips) {
    const tokens = String(d || "").match(/[MLCAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    const out = [];
    let command = "";
    for (let i = 0; i < tokens.length; ) {
        if (/^[MLCAZ]$/i.test(tokens[i])) {
            command = tokens[i++].toUpperCase();
            out.push(command);
            if (command === "Z") continue;
        }
        if (command === "A") {
            const [rx, ry, rotation, large, sweep, x, y] = tokens.slice(i, i + 7).map(Number);
            i += 7;
            const [nx, ny] = map(x, y);
            out.push(ry, rx, rotation, large, flips ? 1 - sweep : sweep, nx, ny);
        } else if (command === "M" || command === "L" || command === "C") {
            const [nx, ny] = map(Number(tokens[i]), Number(tokens[i + 1]));
            i += 2;
            out.push(nx, ny);
        } else i++;
    }
    return out.join(" ");
}

// DrawingML's arcTo as an SVG arc: from the current point along the ellipse wR x hR, starting at the angle stAng and
// turning swAng (radians, clockwise). The angles are visual (the direction from the ellipse's centre), not the
// ellipse's parameter; the two differ on an ellipse except at multiples of 90°, and a crescent's inner arc missed its
// end by a tenth of the shape. Returns { step, end }.
// sx, sy: the path's scale to the box. The conversion is made in the path's own units, where the angles are meant,
// and the arc scaled after (an axis-aligned ellipse stays one, with the same parameter, under the scaling).
function _pptxArcStep(current, wR, hR, stAng, swAng, sx = 1, sy = 1) {
    if (!(wR > 0) || !(hR > 0) || !(sx > 0) || !(sy > 0)) return { step: `L ${current[0]} ${current[1]}`, end: current };
    current = [current[0] / sx, current[1] / sy];
    const param = angle => Math.atan2(wR * Math.sin(angle), hR * Math.cos(angle));
    const start = param(stAng);
    let sweep = param(stAng + swAng) - start;
    if (swAng > 0 && sweep < 0) sweep += 2 * Math.PI;
    if (swAng < 0 && sweep > 0) sweep -= 2 * Math.PI;
    if (Math.abs(swAng) >= 2 * Math.PI - 1e-9) sweep = Math.sign(swAng) * (2 * Math.PI - 1e-6); // a whole ellipse: SVG needs it a hair short
    const cx = current[0] - wR * Math.cos(start);
    const cy = current[1] - hR * Math.sin(start);
    const end = [(cx + wR * Math.cos(start + sweep)) * sx, (cy + hR * Math.sin(start + sweep)) * sy];
    return { step: `A ${wR * sx} ${hR * sy} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end[0]} ${end[1]}`, end };
}

function _pptxGeometryPaths(spPr, boxW, boxH) {
    const custom = _pptxChild(spPr, "a:custGeom");
    const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
    if (!custom) {
        const preset = _pptxChild(spPr, "a:prstGeom");
        const kind = preset?.getAttribute("prst");
        // Every PowerPoint preset, by its own formulas (pptxPresetShapes.js, from ECMA-376's definitions): adjusted
        // shapes, darker and lighter parts, holes. The hand-drawn ones below remain for when that file is missing.
        const generic = typeof pptxPresetPaths === "function" ? pptxPresetPaths(kind, boxW, boxH, typeof pptxPresetAdjustments === "function" ? pptxPresetAdjustments(preset) : {}) : null;
        if (generic) return generic;
        const adjust = name => {
            const gd = Array.from(preset?.getElementsByTagName("a:gd") || []).find(node => node.getAttribute("name") === name);
            const match = /^val\s+(-?\d+)/.exec(gd?.getAttribute("fmla") || "");
            return match ? Number(match[1]) : null;
        };
        const rx = boxW / 2;
        const ry = boxH / 2;
        const point = deg => [rx + rx * Math.cos((deg * Math.PI) / 180), ry + ry * Math.sin((deg * Math.PI) / 180)];
        if (/^(line|straightConnector1)$/.test(kind || "")) return [{ d: `M 0 0 L ${boxW} ${boxH}`, fill: false, stroke: true }];
        if (/^bentConnector/.test(kind || "")) return [{ d: `M 0 0 L ${boxW / 2} 0 L ${boxW / 2} ${boxH} L ${boxW} ${boxH}`, fill: false, stroke: true }];
        // Curved connectors as PowerPoint draws them: curvedConnector2 is one bend (it came in as an S); the S of
        // curvedConnector3 turns at adj1 of the width.
        if (kind === "curvedConnector2") return [{ d: `M 0 0 C ${boxW / 2} 0, ${boxW} ${boxH / 2}, ${boxW} ${boxH}`, fill: false, stroke: true }];
        if (kind === "curvedConnector3") {
            const x2 = (boxW * (adjust("adj1") ?? 50000)) / 100000;
            return [{ d: `M 0 0 C ${x2 / 2} 0, ${x2} ${boxH / 4}, ${x2} ${boxH / 2} C ${x2} ${(boxH * 3) / 4}, ${(boxW + x2) / 2} ${boxH}, ${boxW} ${boxH}`, fill: false, stroke: true }];
        }
        if (/^curvedConnector/.test(kind || "")) return [{ d: `M 0 0 C ${boxW / 2} 0, ${boxW / 2} ${boxH}, ${boxW} ${boxH}`, fill: false, stroke: true }];
        // A band arching over the box with the head at its right foot (PowerPoint's default proportions: band a
        // quarter of the shorter side, head half of it wide and a quarter long). It came in as a slanted rectangle.
        // curvedLeftArrow and curvedRightArrow are curvedDownArrow turned on its side: the band bulges right (left)
        // and the head points left (right) at the bottom. They came in as a plain rectangle.
        if (kind === "curvedLeftArrow" || kind === "curvedRightArrow") {
            const turned = spPr.cloneNode(true);
            _pptxChild(turned, "a:prstGeom").setAttribute("prst", "curvedDownArrow");
            const left = kind === "curvedLeftArrow";
            // Drawn in a box with width and height swapped, then turned a quarter clockwise (left) or mirrored
            // across the diagonal (right).
            const map = left ? (x, y) => [boxW - y, x] : (x, y) => [y, x];
            return _pptxGeometryPaths(turned, boxH, boxW).map(path => ({ ...path, d: _pptxTransformPath(path.d, map, !left) }));
        }
        if (kind === "curvedDownArrow" || kind === "curvedUpArrow") {
            const ss = Math.min(boxW, boxH);
            const th = (ss * (adjust("adj1") ?? 25000)) / 100000;
            const aw = (ss * (adjust("adj2") ?? 50000)) / 100000;
            const ah = (ss * (adjust("adj3") ?? 25000)) / 100000;
            const xr = boxW - aw / 2; // the head's centre line
            const outerRx = (xr + th / 2) / 2;
            const innerRx = Math.max(1, (xr - th / 2 - th) / 2);
            const outerRy = Math.max(1, boxH - ah);
            const innerRy = Math.max(1, outerRy - th);
            const up = kind === "curvedUpArrow"; // the same arrow upside down
            const y = value => (up ? boxH - value : value);
            const [outerSweep, innerSweep] = up ? [0, 1] : [1, 0];
            const base = boxH - ah;
            const d = `M 0 ${y(boxH)} A ${outerRx} ${outerRy} 0 0 ${outerSweep} ${xr + th / 2} ${y(base)} L ${xr + aw / 2} ${y(base)} L ${xr} ${y(boxH)} ` +
                `L ${xr - aw / 2} ${y(base)} L ${xr - th / 2} ${y(base)} A ${innerRx} ${innerRy} 0 0 ${innerSweep} ${th} ${y(boxH)} Z`;
            return [{ d, fill: true, stroke: true }];
        }
        if (kind === "arc") {
            const start = (adjust("adj1") ?? 16200000) / 60000;
            const end = (adjust("adj2") ?? 0) / 60000;
            const sweep = (((end - start) % 360) + 360) % 360 || 360;
            const [x1, y1] = point(start);
            const [x2, y2] = point(start + sweep);
            return [{ d: `M ${x1} ${y1} A ${rx} ${ry} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`, fill: false, stroke: true }];
        }
        if (kind === "leftRightArrow" || kind === "upDownArrow") {
            // A two-headed block arrow (the links of a SmartArt cycle; they came in as plain bars). adj1: the shaft's
            // thickness, of the box's height (width); adj2: each head's length, of the shorter side.
            const across = kind === "leftRightArrow";
            const long = across ? boxW : boxH;
            const wide = across ? boxH : boxW;
            const shaft = (wide * Math.max(0, Math.min(100000, adjust("adj1") ?? 50000))) / 200000;
            const headLen = Math.min(long / 2, (Math.min(boxW, boxH) * Math.max(0, adjust("adj2") ?? 50000)) / 100000);
            const c = wide / 2;
            const pts = [[0, c], [headLen, 0], [headLen, c - shaft], [long - headLen, c - shaft], [long - headLen, 0], [long, c], [long - headLen, wide], [long - headLen, c + shaft], [headLen, c + shaft], [headLen, wide]];
            const d = pts.map(([u, v], i) => `${i ? "L" : "M"} ${across ? u : v} ${across ? v : u}`).join(" ") + " Z";
            return [{ d, fill: true, stroke: true }];
        }
        if (kind === "blockArc") {
            // A thick arc: a band adj3 (of the shorter side) wide, clockwise from adj1 to adj2.
            const band = Math.min(rx, ry, (Math.min(boxW, boxH) * Math.max(0, adjust("adj3") ?? 25000)) / 100000);
            const start = (adjust("adj1") ?? 10800000) / 60000;
            const end = (adjust("adj2") ?? 0) / 60000;
            const sweep = (((end - start) % 360) + 360) % 360 || 360;
            const on = (ax, ay, deg) => `${rx + ax * Math.cos((deg * Math.PI) / 180)} ${ry + ay * Math.sin((deg * Math.PI) / 180)}`;
            const large = sweep > 180 ? 1 : 0;
            const [ix, iy] = [rx - band, ry - band];
            const d = `M ${on(rx, ry, start)} A ${rx} ${ry} 0 ${large} 1 ${on(rx, ry, start + sweep)} L ${on(ix, iy, start + sweep)} A ${ix} ${iy} 0 ${large} 0 ${on(ix, iy, start)} Z`;
            return [{ d, fill: true, stroke: true }];
        }
        if (kind === "circularArrow" || kind === "leftCircularArrow") {
            // One outline, filled and outlined like any shape: a band along an ellipse from adj4 to adj3 (degrees
            // clockwise from 3 o'clock), then a head adj5 of the shorter side either side of the band's middle,
            // its tip adj2 further round. It came in as a stroked arc with a small marker head off its end.
            const ss = Math.min(boxW, boxH);
            const headHalf = (ss * Math.max(0, Math.min(25000, adjust("adj5") ?? 12500))) / 100000;
            const band = (ss * Math.max(0, Math.min(2 * Math.max(0, Math.min(25000, adjust("adj5") ?? 12500)), adjust("adj1") ?? 12500))) / 100000;
            // leftCircularArrow runs the other way: anticlockwise from adj4 to adj3, its head there.
            const left = kind === "leftCircularArrow";
            const start = (adjust("adj4") ?? 10800000) / 60000;
            const end = (adjust("adj3") ?? (left ? 1142319 : 20457681)) / 60000;
            const head = Math.abs(adjust("adj2") ?? 1142319) / 60000;
            const sweep = ((((left ? start - end : end - start) % 360) + 360) % 360) || 360;
            const midX = rx - headHalf;
            const midY = ry - headHalf;
            // The point where a ray at `deg` from the centre meets the ellipse with half-axes (ax, ay).
            const at = (ax, ay, deg) => {
                const t = (deg * Math.PI) / 180;
                const r = (ax * ay) / Math.hypot(ay * Math.cos(t), ax * Math.sin(t)) || 0;
                return `${rx + r * Math.cos(t)} ${ry + r * Math.sin(t)}`;
            };
            const outer = [midX + band / 2, midY + band / 2];
            const inner = [Math.max(0, midX - band / 2), Math.max(0, midY - band / 2)];
            const large = sweep > 180 ? 1 : 0;
            const way = left ? 0 : 1; // the arcs' sweep flag, clockwise for circularArrow
            const d = [
                `M ${at(...outer, start)}`,
                `A ${outer[0]} ${outer[1]} 0 ${large} ${way} ${at(...outer, end)}`,
                `L ${at(midX + headHalf, midY + headHalf, end)}`,
                `L ${at(midX, midY, left ? end - head : end + head)}`,
                `L ${at(Math.max(0, midX - headHalf), Math.max(0, midY - headHalf), end)}`,
                `L ${at(...inner, end)}`,
                `A ${inner[0]} ${inner[1]} 0 ${large} ${1 - way} ${at(...inner, start)}`,
                "Z",
            ].join(" ");
            return [{ d, fill: true, stroke: true }];
        }
        if (kind === "donut") {
            // A ring: the outer ellipse with the inner one cut out (adj: the ring's thickness, of the shorter side).
            const ring = Math.min(rx, ry, Math.min(boxW, boxH) * ((adjust("adj") ?? 25000) / 100000));
            const ellipse = (erx, ery) => `M ${rx - erx} ${ry} A ${erx} ${ery} 0 1 0 ${rx + erx} ${ry} A ${erx} ${ery} 0 1 0 ${rx - erx} ${ry} Z`;
            return [{ d: `${ellipse(rx, ry)} ${ring < Math.min(rx, ry) ? ellipse(rx - ring, ry - ring) : ""}`, fill: true, stroke: true, evenodd: true }];
        }
        if (kind === "moon") {
            // A crescent: half an ellipse the box's width, less an inner elliptical arc (adj: the crescent's
            // thickness, of the shorter side), by PowerPoint's own formulas. Turned, it draws a curved arrow's shaft;
            // it came in as a rectangle, a straight bar.
            const a = Math.max(0, Math.min(87500, adjust("adj") ?? 50000));
            const ss = Math.min(boxW, boxH);
            const g0 = (ss * a) / 100000;
            const g1 = ss - g0;
            if (!(ss > 0) || !(g1 > 0)) return [];
            const g0w = (g0 * boxW) / ss;
            const g5 = (2 * ss * ss) / g1 - (g0 * g0) / g1;
            const g6w = ((g5 - g0) * boxW) / ss;
            const hd2 = boxH / 2;
            const dy1 = ((g5 / 2 - g0) * hd2) / ss;
            const g18w = (g6w - g0w) / 2;
            const dx2 = -(g0w + g18w - boxW);
            const stAng1 = Math.atan2(-hd2, dx2);
            const swAng1 = Math.atan2(hd2, dx2) - 2 * Math.PI - stAng1;
            let current = [boxW, boxH];
            const arc = (wR, hR, stAng, swAng) => {
                const { step, end } = _pptxArcStep(current, wR, hR, stAng, swAng);
                current = end;
                return step;
            };
            const d = `M ${boxW} ${boxH} ${arc(boxW, hd2, Math.PI / 2, Math.PI)} ${arc(g18w, dy1, stAng1, swAng1)} Z`;
            return [{ d, fill: true, stroke: true }];
        }
        if (kind === "rightBrace" || kind === "leftBrace") {
            // The curly outline only (PowerPoint's brace fill is the sliver behind it, rarely set). adj1: the curls'
            // height, of the shorter side; adj2: where the point is, down the height.
            const mid = boxH * Math.max(0, Math.min(1, (adjust("adj2") ?? 50000) / 100000));
            const curl = Math.min(Math.min(boxW, boxH) * ((adjust("adj1") ?? 8333) / 100000), mid / 2, (boxH - mid) / 2);
            const left = kind === "leftBrace";
            const x = value => (left ? boxW - value : value);
            const cw = left ? 0 : 1; // sweep flags mirror with the shape
            const hw = boxW / 2;
            const d = [
                `M ${x(0)} 0`,
                `A ${hw} ${curl} 0 0 ${cw} ${x(hw)} ${curl}`,
                `L ${x(hw)} ${mid - curl}`,
                `A ${hw} ${curl} 0 0 ${1 - cw} ${x(boxW)} ${mid}`,
                `A ${hw} ${curl} 0 0 ${1 - cw} ${x(hw)} ${mid + curl}`,
                `L ${x(hw)} ${boxH - curl}`,
                `A ${hw} ${curl} 0 0 ${cw} ${x(0)} ${boxH}`,
            ].join(" ");
            return [{ d, fill: false, stroke: true }];
        }
        return [];
    }
    return Array.from(custom.getElementsByTagName("a:path")).map(path => {
        const pathW = num(path.getAttribute("w")) || boxW;
        const pathH = num(path.getAttribute("h")) || boxH;
        const sx = boxW / Math.max(1, pathW);
        const sy = boxH / Math.max(1, pathH);
        const pt = node => [num(node.getAttribute("x")) * sx, num(node.getAttribute("y")) * sy];
        const parts = [];
        let current = [0, 0];
        let start = [0, 0];
        Array.from(path.children).forEach(command => {
            const points = Array.from(command.getElementsByTagName("a:pt")).map(pt);
            if (command.tagName === "a:moveTo" && points[0]) {
                current = start = points[0];
                parts.push(`M ${current[0]} ${current[1]}`);
            } else if (command.tagName === "a:lnTo" && points[0]) {
                current = points[0];
                parts.push(`L ${current[0]} ${current[1]}`);
            } else if (command.tagName === "a:cubicBezTo" && points.length === 3) {
                parts.push(`C ${points.map(p => p.join(" ")).join(", ")}`);
                current = points[2];
            } else if (command.tagName === "a:quadBezTo" && points.length === 2) {
                parts.push(`Q ${points.map(p => p.join(" ")).join(", ")}`);
                current = points[1];
            } else if (command.tagName === "a:arcTo") {
                const wR = num(command.getAttribute("wR"));
                const hR = num(command.getAttribute("hR"));
                const stAng = (num(command.getAttribute("stAng")) / 60000) * (Math.PI / 180);
                const swAng = (num(command.getAttribute("swAng")) / 60000) * (Math.PI / 180);
                const { step, end } = _pptxArcStep(current, wR, hR, stAng, swAng, sx, sy);
                parts.push(step);
                current = end;
            } else if (command.tagName === "a:close") {
                parts.push("Z");
                current = start;
            }
        });
        return { d: parts.join(" "), fill: path.getAttribute("fill") !== "none", stroke: path.getAttribute("stroke") !== "0" };
    });
}

// A freeform shape or an arc as an SVG picture, with its fill, outline (colour, width, dashes, arrowheads),
// transparency and flips. Freeforms were dropped: the dashed outlines and curved arrows of a diagram went missing.
function _pptxDrawingElement(sp, box, scale, zIndex) {
    const spPr = _pptxChild(sp, "p:spPr");
    const paths = _pptxGeometryPaths(spPr, Math.max(1, box.w), Math.max(1, box.h)).filter(path => path.d);
    if (!paths.length) return null;
    const ownFill = _pptxColor(spPr) || _pptxChild(spPr, "a:gradFill") || _pptxChild(spPr, "a:noFill") || _pptxChild(spPr, "a:blipFill");
    const gradient = _pptxChild(spPr, "a:gradFill") ? _pptxFillBackground(_pptxChild(spPr, "a:gradFill"), null, _pptxCurrentThemeColors) : ownFill ? null : _pptxStyleFill(sp);
    const fill = _pptxColor(spPr) || gradient?.color || null;
    const fillAlpha = _pptxFillAlpha(_pptxChild(spPr, "a:solidFill"));
    const line = _pptxChild(spPr, "a:ln");
    const lineColor = line && _pptxChild(line, "a:noFill") ? null : (line && _pptxColor(line)) || _pptxStyleColor(sp, "a:lnRef");
    const lineAlpha = _pptxFillAlpha(_pptxChild(line, "a:solidFill"));
    const lineWidth = Math.max(0.75, (_pptxLineWidthEmu(sp, line) / PPTX_EMU_PER_PX) * scale);
    if (!fill && !lineColor) return null;
    const dash = PPTX_DASHES[_pptxChild(line, "a:prstDash")?.getAttribute("val")];
    const pad = Math.ceil(lineWidth * 6 + 2); // room for a large line end
    const width = Math.max(1, box.w) + pad * 2;
    const height = Math.max(1, box.h) + pad * 2;
    const flip = box.flipH || box.flipV ? ` transform="translate(${box.flipH ? box.w : 0} ${box.flipV ? box.h : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})"` : "";
    const strokeColor = lineColor || fill;
    // Line ends as PowerPoint draws them: their length and width are small, medium or large multiples of the line's
    // width (len, w); a stealth head has a notch; an "arrow" head is two strokes as thick as the line.
    const PPTX_HEAD_SIZES = { sm: 2, med: 3, lg: 5 };
    const marker = (id, end, reverse) => {
        const type = end?.getAttribute("type");
        if (!type || type === "none") return "";
        const len = PPTX_HEAD_SIZES[end.getAttribute("len")] || PPTX_HEAD_SIZES.med;
        // An open head is drawn a little wider than a filled one (as LibreOffice reads PowerPoint's sizes).
        const wide = (PPTX_HEAD_SIZES[end.getAttribute("w")] || PPTX_HEAD_SIZES.med) + (type === "arrow" ? 0.5 : 0);
        const shape =
            type === "oval" ? '<circle cx="5" cy="5" r="4.5"/>'
            : type === "diamond" ? '<path d="M 0 5 L 5 0 L 10 5 L 5 10 Z"/>'
            : type === "arrow" ? `<path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="${strokeColor}" stroke-width="${10 / Math.min(len, wide)}" stroke-linejoin="miter"/>`
            : type === "stealth" ? '<path d="M 0 0 L 10 5 L 0 10 L 3 5 Z"/>'
            : '<path d="M 0 0 L 10 5 L 0 10 Z"/>';
        const refX = type === "oval" || type === "diamond" ? 5 : type === "stealth" ? 7 : 8;
        return `<marker id="${id}" viewBox="0 0 10 10" preserveAspectRatio="none" refX="${refX}" refY="5" markerWidth="${len}" markerHeight="${wide}" orient="${reverse ? "auto-start-reverse" : "auto"}" fill="${strokeColor}">${shape}</marker>`;
    };
    const markers = { start: _pptxChild(line, "a:headEnd"), end: _pptxChild(line, "a:tailEnd") };
    const hasEnd = end => !!end && !["", "none"].includes(end.getAttribute("type") || "");
    // A gradient fill as an SVG gradient (it took only its first colour), turning with the shape.
    const gradientDef = gradient?.stops?.length
        ? gradient.radial
            ? `<radialGradient id="g">${gradient.stops.map(stop => `<stop offset="${stop.pos}%" stop-color="${stop.color}"/>`).join("")}</radialGradient>`
            : `<linearGradient id="g" gradientTransform="rotate(${gradient.angle || 0} 0.5 0.5)">${gradient.stops.map(stop => `<stop offset="${stop.pos}%" stop-color="${stop.color}"/>`).join("")}</linearGradient>`
        : "";
    const fillPaint = gradientDef && !_pptxColor(spPr) ? "url(#g)" : fill;
    const defs = [marker("s", markers.start, true), marker("e", markers.end, false), gradientDef].join("");
    const body = paths
        .map(path => {
            const stroke = path.stroke && lineColor ? ` stroke="${lineColor}" stroke-width="${lineWidth}"${lineAlpha < 1 ? ` stroke-opacity="${lineAlpha}"` : ""}${dash ? ` stroke-dasharray="${dash.map(v => v * lineWidth).join(" ")}"` : ""} stroke-linecap="round" stroke-linejoin="round"` : ' stroke="none"';
            const fillAttr = path.fill && fill ? ` fill="${fillPaint}"${fillAlpha < 1 ? ` fill-opacity="${fillAlpha}"` : ""}${path.evenodd ? ' fill-rule="evenodd"' : ""}` : ' fill="none"';
            const ends = `${hasEnd(markers.start) ? ' marker-start="url(#s)"' : ""}${hasEnd(markers.end) ? ' marker-end="url(#e)"' : ""}`;
            // A preset's darker or lighter part (a can's top, a ribbon's folds): its fill under a veil of black or
            // white, as PowerPoint shades it (darken about 60%, darkenLess 80%, lighten 140%, lightenLess 120%).
            const veil = { darken: ["#000000", 0.4], darkenLess: ["#000000", 0.2], lighten: ["#ffffff", 0.4], lightenLess: ["#ffffff", 0.2] }[path.shade];
            const shade = veil && path.fill && fill ? `<path d="${path.d}" fill="${veil[0]}" fill-opacity="${veil[1] * (fillAlpha < 1 ? fillAlpha : 1)}"${path.evenodd ? ' fill-rule="evenodd"' : ""} stroke="none"/>` : "";
            if (shade && path.stroke && lineColor) return `<path d="${path.d}"${fillAttr} stroke="none"/>${shade}<path d="${path.d}" fill="none"${stroke}${ends}/>`;
            return `<path d="${path.d}"${fillAttr}${stroke}${ends}/>${shade}`;
        })
        .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${-pad} ${-pad} ${width} ${height}"><defs>${defs}</defs><g${flip}>${body}</g></svg>`;
    return {
        id: generateId("el"),
        type: "image",
        content: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        x: box.x - pad,
        y: box.y - pad,
        width: `${width}px`,
        height: `${height}px`,
        lockAspectRatio: false,
        imageAspectRatio: width / height,
        cropTransform: { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 },
        heightSetManually: true,
        importedDrawing: true,
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: { zIndex, borderRadius: "0px" },
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
    const width = _pptxLineWidthEmu(node, line);
    const strokeWidth = Math.max(1, Math.round((width / PPTX_EMU_PER_PX) * scale * 10) / 10);
    // Arrowheads as PowerPoint sizes them: a multiple of the line's width (small, medium, large). A fixed 14 px
    // head dwarfed the hairline arrows of a diagram.
    const headSize = (name, attr) => ({ sm: 2, med: 3, lg: 5 }[_pptxChild(line, name)?.getAttribute(attr)] || 3) * Math.max(2, strokeWidth);
    const dash = PPTX_DASHES[_pptxChild(line, "a:prstDash")?.getAttribute("val")];
    const connector = {
        id: generateId("el"),
        type: "connector",
        connectorType: bent ? "poly" : "line",
        connectorStart: head("a:headEnd"),
        connectorEnd: head("a:tailEnd"),
        connectorHeadWidth: Math.round(Math.max(6, headSize("a:tailEnd", "w"), headSize("a:headEnd", "w"))),
        connectorHeadLength: Math.round(Math.max(6, headSize("a:tailEnd", "len"), headSize("a:headEnd", "len"))),
        ...(dash ? { connectorDash: dash.map(value => value * strokeWidth) } : {}),
        points: points.map(point => ({ x: point.x - box.x, y: point.y - box.y })),
        x: box.x,
        y: box.y,
        width: `${Math.max(2, box.w)}px`,
        height: `${Math.max(2, box.h)}px`,
        content: "",
        styles: {
            backgroundColor: "transparent",
            color,
            strokeWidth,
            zIndex,
            borderRadius: "0px",
        },
    };
    if (typeof normalizeConnectorGeometry === "function") normalizeConnectorGeometry(connector, points);
    return connector;
}

// Whether the browser can draw a picture file: PowerPoint shows nothing for an empty or damaged one (a deck saved
// by another program had 20 pictures pointing to a 0-byte file, and a truncated background drew its top rows).
async function _pptxPictureReadable(blob) {
    if (!blob.size) return false;
    if (blob.type === "image/svg+xml" || typeof createImageBitmap !== "function") return true;
    try {
        const bitmap = await createImageBitmap(blob);
        bitmap.close?.();
        return true;
    } catch (_error) {
        // A second opinion from an <img>: createImageBitmap gave up on a valid 99 MB animated GIF that an image
        // shows. A damaged file (cut short, wrong header) fails both.
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000))]);
            return image.naturalWidth > 0;
        } catch (_secondError) {
            return false;
        } finally {
            URL.revokeObjectURL(url);
        }
    }
}

// A movie embedded in the file (<a:videoFile> or <p14:media> pointing into ppt/media/) as a video object. Movies
// came in as their poster picture only. Formats a browser cannot play (WMV, AVI) keep the picture.
const PPTX_VIDEO_TYPES = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg" };
async function _pptxVideoElement(pkg, pic, rels, box, zIndex) {
    const nvPr = _pptxFirst(_pptxChild(pic, "p:nvPicPr"), "p:nvPr");
    const refs = [_pptxFirst(nvPr, "p14:media"), _pptxFirst(nvPr, "a:videoFile")].filter(Boolean);
    const path = refs.map(ref => rels[ref.getAttribute("r:embed") || ref.getAttribute("r:link")]?.path).find(Boolean);
    const file = path && pkg.zip.file(path);
    const mime = path && PPTX_VIDEO_TYPES[path.split(".").pop().toLowerCase()];
    if (!file || !mime) return null;
    if (!pkg.pictureUrls) pkg.pictureUrls = new Map();
    if (!pkg.pictureUrls.has(path)) {
        pkg.pictureUrls.set(
            path,
            (async () => {
                const blob = new Blob([await file.async("arraybuffer")], { type: mime });
                if (!blob.size) return null;
                try {
                    const url = typeof _uploadAssetFile === "function" ? (await _uploadAssetFile(new File([blob], path.split("/").pop(), { type: mime })))?.url : null;
                    if (url) return url;
                } catch (_error) {}
                // No server to store it: kept in the deck itself (a blob: address would not survive a reload).
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
            })(),
        );
    }
    const url = await pkg.pictureUrls.get(path);
    if (!url) return null;
    return {
        id: generateId("el"),
        type: "video",
        content: url,
        videoType: "local",
        localMimeType: mime,
        x: box.x,
        y: box.y,
        width: `${Math.max(40, box.w)}px`,
        height: `${Math.max(24, box.h)}px`,
        muted: false,
        autoplay: false,
        loop: false,
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: { zIndex, borderRadius: "0px" },
        animation: null,
    };
}

// A sound on the slide (a picture whose nvPr holds an a:audioFile, its file embedded through p14:media) as an
// audio element: it was left out. Formats browsers cannot play (WMA, MIDI) stay out. PowerPoint's "Hide during
// show" (showWhenStopped="0") hides it while presenting; started with or after the slide's opening (not on a click)
// it plays by itself.
const PPTX_AUDIO_TYPES = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac" };
async function _pptxAudioElement(pkg, pic, rels, box, zIndex, slideDoc) {
    const nvPr = _pptxFirst(_pptxChild(pic, "p:nvPicPr"), "p:nvPr");
    const audioFile = _pptxFirst(nvPr, "a:audioFile");
    if (!audioFile) return null;
    const refs = [_pptxFirst(nvPr, "p14:media"), audioFile].filter(Boolean);
    const path = refs.map(ref => rels[ref.getAttribute("r:embed") || ref.getAttribute("r:link")]?.path).find(Boolean);
    const file = path && pkg.zip.file(path);
    const mime = path && PPTX_AUDIO_TYPES[path.split(".").pop().toLowerCase()];
    if (!file || !mime) return null;
    if (!pkg.pictureUrls) pkg.pictureUrls = new Map();
    if (!pkg.pictureUrls.has(path)) {
        pkg.pictureUrls.set(
            path,
            (async () => {
                const blob = new Blob([await file.async("arraybuffer")], { type: mime });
                if (!blob.size) return null;
                try {
                    const stored = typeof _uploadAssetFile === "function" ? await _uploadAssetFile(new File([blob], path.split("/").pop(), { type: mime })) : null;
                    if (stored?.url) return { url: stored.url, webm: stored.webmUrl || "" };
                } catch (_error) {}
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ url: String(reader.result), webm: "" });
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
            })(),
        );
    }
    const stored = await pkg.pictureUrls.get(path);
    if (!stored?.url) return null;
    // How the slide's timing plays it: its media node (hidden when stopped?) and the effect that starts it.
    const id = _pptxFirst(pic, "p:cNvPr")?.getAttribute("id");
    const aimsHere = node => Array.from(node.getElementsByTagName("p:spTgt")).some(target => target.getAttribute("spid") === id);
    const mediaNode = Array.from(slideDoc?.getElementsByTagName("p:cMediaNode") || []).find(aimsHere);
    const hidden = mediaNode?.getAttribute("showWhenStopped") === "0";
    // Plays by itself when the effect that starts it comes with or after the previous one, and no click comes before
    // it on the slide (PowerPoint's "Start: Automatically").
    let autoplay = false;
    let clicked = false;
    for (const effect of Array.from(slideDoc?.getElementsByTagName("p:cTn") || []).filter(node => node.getAttribute("presetClass"))) {
        const nodeType = effect.getAttribute("nodeType");
        const starts = Array.from(effect.getElementsByTagName("p:cmd")).some(command => /^playFrom/.test(command.getAttribute("cmd") || "") && aimsHere(command));
        if (starts) {
            autoplay = !clicked && (nodeType === "afterEffect" || nodeType === "withEffect");
            break;
        }
        if (nodeType === "clickEffect") clicked = true;
    }
    return {
        id: generateId("el"),
        type: "audio",
        content: stored.url,
        ...(stored.webm ? { audioWebm: stored.webm } : {}),
        audioName: _pptxFirst(pic, "p:cNvPr")?.getAttribute("name") || path.split("/").pop().replace(/\.[^.]+$/, ""),
        localMimeType: mime,
        x: box.x,
        y: box.y,
        width: `${Math.max(44, box.w)}px`,
        height: `${Math.max(44, box.h)}px`,
        autoplay,
        loop: _pptxChild(mediaNode, "p:cTn")?.getAttribute("repeatCount") === "indefinite",
        hideWhilePresenting: hidden && autoplay,
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: { zIndex, borderRadius: "999px" },
        animation: null,
    };
}

// The slide's size in editor pixels at the import's scale.
async function _pptxPageSize(pkg, scale) {
    const size = _pptxFirst(await pkg.xml("ppt/presentation.xml"), "p:sldSz");
    return {
        w: Math.round(((Number(size?.getAttribute("cx")) || 9144000) / PPTX_EMU_PER_PX) * scale),
        h: Math.round(((Number(size?.getAttribute("cy")) || 6858000) / PPTX_EMU_PER_PX) * scale),
    };
}

// Runs of drawn shapes (SVG pictures of freeforms and the like), in stacking order, as one picture each; what lies
// between them (photos, text, plain shapes, anything animated or from another part) stays as it is, so the stacking
// order is kept. minRun: the shortest run flattened. region "page": the picture covers the slide (a layout's artwork);
// "bounds": just the run's own area (a figure pasted on a slide as thousands of freeforms).
async function _pptxFlattenDrawings(elements, page, { minRun = 2, region = "page" } = {}) {
    const out = [];
    let run = [];
    const flush = async () => {
        if (run.length < minRun) {
            out.push(...run);
        } else {
            const area = region === "page" ? { x: 0, y: 0, w: page.w, h: page.h } : _pptxDrawingBounds(run, page);
            const url = area && (await _pptxRasterizeDrawings(run, area).catch(() => null));
            if (url) {
                out.push({
                    id: generateId("el"),
                    type: "image",
                    content: url,
                    x: area.x,
                    y: area.y,
                    width: `${area.w}px`,
                    height: `${area.h}px`,
                    lockAspectRatio: false,
                    imageAspectRatio: area.w / area.h,
                    cropTransform: { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 },
                    heightSetManually: true,
                    importedDrawing: true,
                    styles: { zIndex: run[0].styles?.zIndex ?? 1, borderRadius: "0px" },
                });
            } else {
                out.push(...run);
            }
        }
        run = [];
    };
    const joins = element => element.type === "image" && element.importedDrawing && !element.animation && !element.importedFrom;
    for (const element of elements) {
        if (joins(element)) run.push(element);
        else {
            await flush();
            out.push(element);
        }
    }
    await flush();
    return out;
}

// The area a run of drawings covers (turned ones by their turned corners), kept on the slide.
function _pptxDrawingBounds(drawings, page) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    drawings.forEach(el => {
        const w = parseFloat(el.width) || 0;
        const h = parseFloat(el.height) || 0;
        const a = ((el.rotation || 0) * Math.PI) / 180;
        const [cx, cy] = [el.x + w / 2, el.y + h / 2];
        [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].forEach(([dx, dy]) => {
            const px = cx + dx * Math.cos(a) - dy * Math.sin(a);
            const py = cy + dx * Math.sin(a) + dy * Math.cos(a);
            [x0, y0, x1, y1] = [Math.min(x0, px), Math.min(y0, py), Math.max(x1, px), Math.max(y1, py)];
        });
    });
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(page.w, Math.ceil(x1));
    y1 = Math.min(page.h, Math.ceil(y1));
    return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// Drawn shapes painted into one PNG at twice the size of `area` (slide pixels), stored like any picture.
async function _pptxRasterizeDrawings(drawings, area) {
    const k = Math.min(2, 4096 / Math.max(area.w, area.h));
    // Each drawing's own SVG (made by _pptxDrawingElement) goes into one document as a nested <svg> at its place,
    // its ids made unique (arrowheads, gradients). As nested <image>s, each was a document of its own, and a figure
    // of 5,886 of them took minutes and then crashed the page.
    const items = drawings.map((el, n) => {
        const w = parseFloat(el.width) || 0;
        const h = parseFloat(el.height) || 0;
        let markup = "";
        try {
            markup = decodeURIComponent(String(el.content).replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
        } catch (_error) {
            return "";
        }
        const open = /^<svg\b([^>]*)>/.exec(markup);
        if (!open) return "";
        const viewBox = /viewBox="([^"]*)"/.exec(open[1])?.[1] || `0 0 ${w} ${h}`;
        const body = markup
            .slice(open[0].length, markup.lastIndexOf("</svg>"))
            .replace(/\bid="([^"]+)"/g, `id="d${n}-$1"`)
            .replace(/url\(#([^)]+)\)/g, `url(#d${n}-$1)`);
        const svg = `<svg x="${el.x}" y="${el.y}" width="${w}" height="${h}" viewBox="${viewBox}" preserveAspectRatio="none" overflow="visible">${body}</svg>`;
        return el.rotation ? `<g transform="rotate(${el.rotation} ${el.x + w / 2} ${el.y + h / 2})">${svg}</g>` : svg;
    });
    const [pw, ph] = [Math.round(area.w * k), Math.round(area.h * k)];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" viewBox="${area.x} ${area.y} ${area.w} ${area.h}">${items.join("")}</svg>`;
    const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = pw;
        canvas.height = ph;
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        if (!blob) return null;
        try {
            const url = typeof _uploadAssetFile === "function" ? (await _uploadAssetFile(new File([blob], "slide-artwork.png", { type: "image/png" })))?.url : null;
            if (url) return url;
        } catch (_error) {}
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    } finally {
        URL.revokeObjectURL(source);
    }
}

// A picture file of the package stored for the deck: its address, or null when the browser cannot draw it.
// What PowerPoint does to a picture's pixels: greyscale (<a:grayscl>), a duotone recolouring (<a:duotone>, dark to
// the first colour, light to the second), a colour made transparent (<a:clrChange>), and a soft edge (the shape's
// <a:softEdge rad>, a fade to transparent at the border). null when there is nothing to do. A logo set to greyscale
// came in blue, and a background recoloured grey came in as its black original under dark text.
function _pptxPictureEffects(blip, effectHolder, extentEmu, colors = _pptxCurrentThemeColors) {
    if (!blip) return null;
    const effects = {};
    const colorOf = node => {
        const holder = node.ownerDocument.createElement("a:holder");
        holder.appendChild(node.cloneNode(true));
        return _pptxColorValue(holder, colors);
    };
    if (_pptxChild(blip, "a:grayscl")) effects.grayscale = true;
    const duotone = _pptxChild(blip, "a:duotone");
    if (duotone) {
        const pair = Array.from(duotone.children).map(colorOf).filter(Boolean);
        if (pair.length === 2) effects.duotone = pair;
    }
    const change = _pptxChild(blip, "a:clrChange");
    if (change) {
        const from = colorOf(_pptxChild(change, "a:clrFrom")?.firstElementChild || change);
        const toAlpha = _pptxFillAlpha(_pptxChild(change, "a:clrTo"));
        if (from && toAlpha < 1) effects.transparentColor = from;
    }
    const soft = _pptxFirst(_pptxChild(effectHolder, "a:effectLst"), "a:softEdge");
    const radius = Number(soft?.getAttribute("rad")) || 0;
    if (radius > 0 && extentEmu?.cx > 0 && extentEmu?.cy > 0) effects.softEdge = { x: radius / extentEmu.cx, y: radius / extentEmu.cy };
    return Object.keys(effects).length ? effects : null;
}

// The picture with its effects drawn into it, as a PNG (shown the same in the editor and every export). An animated
// GIF is left as it is: drawing it would keep only its first frame.
async function _pptxBakePictureEffects(blob, effects) {
    if (!effects || blob.type === "image/gif" || typeof createImageBitmap !== "function") return blob;
    try {
        const bitmap = await createImageBitmap(blob);
        const shrink = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * shrink));
        const h = Math.max(1, Math.round(bitmap.height * shrink));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const image = ctx.getImageData(0, 0, w, h);
        const data = image.data;
        const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
        const [dark, light] = effects.duotone ? effects.duotone.map(rgb) : [];
        const clear = effects.transparentColor ? rgb(effects.transparentColor) : null;
        const fadeX = effects.softEdge ? Math.max(1, effects.softEdge.x * w) : 0;
        const fadeY = effects.softEdge ? Math.max(1, effects.softEdge.y * h) : 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                let r = data[i], g = data[i + 1], b = data[i + 2];
                if (clear && Math.abs(r - clear[0]) <= 3 && Math.abs(g - clear[1]) <= 3 && Math.abs(b - clear[2]) <= 3) data[i + 3] = 0;
                if (effects.grayscale || dark) {
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    if (dark) {
                        const t = lum / 255;
                        [r, g, b] = [0, 1, 2].map(k => dark[k] + (light[k] - dark[k]) * t);
                    } else r = g = b = lum;
                    data[i] = r;
                    data[i + 1] = g;
                    data[i + 2] = b;
                }
                if (fadeX) {
                    const edge = Math.min(Math.min(x + 0.5, w - x - 0.5) / fadeX, Math.min(y + 0.5, h - y - 0.5) / fadeY, 1);
                    data[i + 3] *= edge * edge * (3 - 2 * edge);
                }
            }
        }
        ctx.putImageData(image, 0, 0);
        if (effects.clip) {
            // The outline is in a 1000 x 1000 box; the picture is placed in that box by its crop (percentages of
            // the box), so box point u lands on picture pixel (u / 10 - left) / width * w.
            const { paths, crop } = effects.clip;
            const width = crop?.widthPercent || 100, height = crop?.heightPercent || 100;
            ctx.globalCompositeOperation = "destination-in";
            ctx.setTransform((w * 0.1) / width, 0, 0, (h * 0.1) / height, (-(crop?.leftPercent || 0) / width) * w, (-(crop?.topPercent || 0) / height) * h);
            ctx.fill(new Path2D(paths.join(" ")));
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = "source-over";
        }
        // Mirrored (its own flip, or a flipped group's): the whole picture, cut-out included, as PowerPoint draws it.
        let result = canvas;
        if (effects.flipH || effects.flipV) {
            result = document.createElement("canvas");
            result.width = w;
            result.height = h;
            const mirror = result.getContext("2d");
            mirror.translate(effects.flipH ? w : 0, effects.flipV ? h : 0);
            mirror.scale(effects.flipH ? -1 : 1, effects.flipV ? -1 : 1);
            mirror.drawImage(canvas, 0, 0);
        }
        const baked = await new Promise(resolve => result.toBlob(resolve, "image/png"));
        return baked || blob;
    } catch (_error) {
        return blob; // the picture as it is rather than none
    }
}

// Picture files by extension. EMF and TIFF are listed so they can be turned into pictures browsers show
// (_pptxBrowserPicture).
const PPTX_PICTURE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", emf: "image/x-emf", wmf: "image/x-wmf", tif: "image/tiff", tiff: "image/tiff" };

// EMF records that only set up drawing state (mapping, transforms, objects, clipping, comments): a metafile made of
// these and one bitmap is a picture saved as EMF, which PowerPoint does for pasted pictures.
const PPTX_EMF_STATE_RECORDS = new Set([1, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 28, 30, 33, 34, 35, 36, 37, 40, 48, 70, 75, 98, 115]);

// The bitmap inside an EMF that holds one picture and no drawing, as a PNG; null for anything else (a chart or
// diagram drawn in EMF). Browsers cannot show EMF, so such pictures were dropped from the slide.
async function _pptxEmfBitmap(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 88 || view.getUint32(0, true) !== 1 || view.getUint32(40, true) !== 0x464d4520) return null;
    let picture = null;
    for (let offset = 0; offset + 8 <= view.byteLength; ) {
        const type = view.getUint32(offset, true);
        const size = view.getUint32(offset + 4, true);
        if (size < 8 || offset + size > view.byteLength) return null;
        if (type === 70 && size >= 16 && view.getUint32(offset + 12, true) === 0x2b464d45) return null; // EMF+ drawing
        if (type === 81) {
            if (picture || size < 80) return null; // EMR_STRETCHDIBITS; two pictures make a drawing
            const field = index => view.getInt32(offset + index, true);
            picture = { offset, xSrc: field(32), ySrc: field(36), cxSrc: field(40), cySrc: field(44), offBmi: field(48), cbBmi: field(52), offBits: field(56), cbBits: field(60) };
        } else if (!PPTX_EMF_STATE_RECORDS.has(type)) return null;
        if (type === 14) break;
        offset += size;
    }
    if (!picture || picture.cbBmi < 40 || picture.cbBits <= 0) return null;
    const header = picture.offset + picture.offBmi;
    const bits = picture.offset + picture.offBits;
    if (header + picture.cbBmi > view.byteLength || bits + picture.cbBits > view.byteLength) return null;
    // JPEG and PNG inside a DIB are the files themselves.
    const compression = view.getUint32(header + 16, true);
    if (compression === 4 || compression === 5) return new Blob([new Uint8Array(buffer, bits, picture.cbBits)], { type: compression === 4 ? "image/jpeg" : "image/png" });
    const canvas = typeof _pptxDibCanvas === "function" ? _pptxDibCanvas(view, header, picture.cbBmi, bits, picture.cbBits) : null;
    if (!canvas) return null;
    const { width, height } = canvas;
    // The part of the bitmap the record draws (usually all of it).
    let source = canvas;
    const sx = Math.max(0, picture.xSrc), sw = Math.min(width - sx, picture.cxSrc || width);
    const sy = Math.max(0, picture.ySrc), sh = Math.min(height - sy, picture.cySrc || height);
    if (sw > 0 && sh > 0 && (sx || sy || sw < width || sh < height)) {
        source = document.createElement("canvas");
        source.width = sw;
        source.height = sh;
        source.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    return new Promise(resolve => source.toBlob(blob => resolve(blob), "image/png"));
}

// An EMF or TIFF picture as one browsers show: an EMF that only wraps a bitmap as that bitmap, an EMF drawing
// (MathType equations, pasted charts and structures) as SVG, a TIFF as PNG. null when it cannot be read, as for EMF+
// alone. Other pictures are returned as they are.
async function _pptxBrowserPicture(buffer, mime) {
    if (mime === "image/x-emf") {
        const bitmap = await _pptxEmfBitmap(buffer).catch(() => null);
        if (bitmap) return bitmap;
        let svg = null;
        try {
            svg = typeof _pptxEmfSvg === "function" ? _pptxEmfSvg(buffer) : null;
        } catch (_error) {}
        return svg ? new Blob([svg], { type: "image/svg+xml" }) : null;
    }
    if (mime === "image/x-wmf") {
        // Windows Metafile (MathType equation previews, older charts): drawn as SVG (importPictures.js).
        let svg = null;
        try {
            svg = typeof _pptxWmfSvg === "function" ? _pptxWmfSvg(buffer) : null;
        } catch (_error) {}
        return svg ? new Blob([svg], { type: "image/svg+xml" }) : null;
    }
    if (mime === "image/tiff") return typeof _pptxTiffBitmap === "function" ? _pptxTiffBitmap(buffer).catch(() => null) : null;
    return new Blob([buffer], { type: mime });
}

const PPTX_PICTURE_EXTENSIONS = { "image/jpeg": ".jpg", "image/png": ".png", "image/svg+xml": ".svg" };

async function _pptxStorePicture(file, path, mime, effects = null) {
    if (mime === "image/x-emf" || mime === "image/x-wmf" || mime === "image/tiff") {
        const picture = await _pptxBrowserPicture(await file.async("arraybuffer"), mime);
        if (!picture) return null; // EMF+ alone, or a TIFF this does not read
        return _pptxStorePicture({ async: async () => picture.arrayBuffer() }, path.replace(/\.[^./]+$/, PPTX_PICTURE_EXTENSIONS[picture.type] || ".png"), picture.type, effects);
    }
    let blob = new Blob([await file.async("arraybuffer")], { type: mime });
    // An empty or damaged file shows nothing in PowerPoint; here it showed a broken-picture frame.
    if (!(await _pptxPictureReadable(blob))) return null;
    if (effects) {
        blob = await _pptxBakePictureEffects(blob, effects);
        if (blob.type === "image/png" && mime !== "image/png") {
            mime = "image/png";
            path = path.replace(/\.[^./]+$/, ".png");
        }
    }
    try {
        // Stored like any inserted picture; a data URL is the fallback when there is no server to store it. SVG stays
        // a data URL: the server stores no SVG (served from the app, one could run script), and asking failed loudly.
        if (typeof _uploadAssetFile === "function" && mime !== "image/svg+xml") {
            const url = (await _uploadAssetFile(new File([blob], path.split("/").pop(), { type: mime })))?.url;
            if (url) return url;
        }
    } catch (_error) {}
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// The outline of a preset shape a picture is cut to, as a path in a 1000 x 1000 box (the picture's box), drawn at
// the box's own proportions (cx, cy in EMU) so corner sizes, taken from the shorter side, come out as in
// PowerPoint. null for a rectangle and for shapes drawn another way (an ellipse or rounded rectangle uses
// borderRadius).
function _pptxPresetOutline(preset, cx, cy) {
    const kind = preset?.getAttribute("prst");
    if (!kind || !(cx > 0) || !(cy > 0)) return null;
    const adjust = (name, fallback) => {
        const gd = Array.from(preset.getElementsByTagName("a:gd")).find(node => node.getAttribute("name") === name);
        const match = /^val\s+(-?\d+)/.exec(gd?.getAttribute("fmla") || "");
        return match ? Number(match[1]) : fallback;
    };
    const w = cx, h = cy, ss = Math.min(w, h);
    const clampAdj = (value, max = 50000) => Math.max(0, Math.min(max, value));
    const corner = (name, fallback) => (ss * clampAdj(adjust(name, fallback))) / 100000;
    const X = x => Math.round((x / w) * 10000) / 10;
    const Y = y => Math.round((y / h) * 10000) / 10;
    const polygon = points => `M ${points.map(([x, y]) => `${X(x)} ${Y(y)}`).join(" L ")} Z`;
    // Rounded corners as quarter arcs: [x, y, radius, which corner].
    const rounded = radii => {
        const [tl, tr, br, bl] = radii;
        const arc = (r, x, y) => (r > 0 ? ` A ${X(r) || 0.1} ${Y(r) || 0.1} 0 0 1 ${X(x)} ${Y(y)}` : ` L ${X(x)} ${Y(y)}`);
        return `M ${X(tl)} 0 L ${X(w - tr)} 0${arc(tr, w, tr)} L ${X(w)} ${Y(h - br)}${arc(br, w - br, h)} L ${X(bl)} ${Y(h)}${arc(bl, 0, h - bl)} L 0 ${Y(tl)}${arc(tl, tl, 0)} Z`;
    };
    switch (kind) {
        case "snip1Rect": {
            const d = corner("adj", 16667);
            return polygon([[0, 0], [w - d, 0], [w, d], [w, h], [0, h]]);
        }
        case "snip2SameRect": {
            const top = corner("adj1", 16667), bottom = corner("adj2", 0);
            return polygon([[top, 0], [w - top, 0], [w, top], [w, h - bottom], [w - bottom, h], [bottom, h], [0, h - bottom], [0, top]]);
        }
        case "snip2DiagRect": {
            const a = corner("adj1", 0), b = corner("adj2", 16667);
            return polygon([[a, 0], [w - b, 0], [w, b], [w, h - a], [w - a, h], [b, h], [0, h - b], [0, a]]);
        }
        case "snipRoundRect": {
            const r = corner("adj1", 16667), d = corner("adj2", 16667);
            return `M ${X(r)} 0 L ${X(w - d)} 0 L ${X(w)} ${Y(d)} L ${X(w)} ${Y(h)} L 0 ${Y(h)} L 0 ${Y(r)}` + (r > 0 ? ` A ${X(r)} ${Y(r)} 0 0 1 ${X(r)} 0 Z` : " Z");
        }
        case "round1Rect":
            return rounded([0, corner("adj", 16667), 0, 0]);
        case "round2SameRect": {
            const top = corner("adj1", 16667), bottom = corner("adj2", 0);
            return rounded([top, top, bottom, bottom]);
        }
        case "round2DiagRect": {
            const a = corner("adj1", 16667), b = corner("adj2", 0);
            return rounded([a, b, a, b]);
        }
        case "triangle": {
            const apex = (w * clampAdj(adjust("adj", 50000), 100000)) / 100000;
            return polygon([[apex, 0], [w, h], [0, h]]);
        }
        case "rtTriangle":
            return polygon([[0, 0], [w, h], [0, h]]);
        case "diamond":
            return polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
        case "parallelogram": {
            const d = (ss * clampAdj(adjust("adj", 25000), (100000 * w) / ss)) / 100000;
            return polygon([[d, 0], [w, 0], [w - d, h], [0, h]]);
        }
        case "trapezoid": {
            const d = (ss * clampAdj(adjust("adj", 25000), (50000 * w) / ss)) / 100000;
            return polygon([[d, 0], [w - d, 0], [w, h], [0, h]]);
        }
        case "pentagon": // PowerPoint's arrow-ended "pentagon" (homePlate is the same shape)
        case "homePlate": {
            const d = (ss * clampAdj(adjust("adj", 50000), (100000 * w) / ss)) / 100000;
            return polygon([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]);
        }
        case "hexagon": {
            const d = (ss * clampAdj(adjust("adj", 25000), (50000 * w) / ss)) / 100000;
            return polygon([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]);
        }
        case "octagon": {
            const d = corner("adj", 29289);
            return polygon([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]);
        }
        default:
            return null;
    }
}

// A picture's own outline (its a:ln, or its style's line): a border in the outline's colour, as wide as PowerPoint
// draws it at this slide's scale. A framed figure came in without its frame.
function _pptxPictureOutline(pic, spPr, ext, box) {
    const line = _pptxChild(spPr, "a:ln");
    if (line && _pptxChild(line, "a:noFill")) return {};
    const color = (line && _pptxColor(line)) || (_pptxChild(_pptxChild(pic, "p:style"), "a:lnRef") ? _pptxStyleColor(pic, "a:lnRef") : null);
    if (!color) return {};
    const scale = box.w / Math.max(1, (Number(ext?.getAttribute("cx")) || box.w * 9525) / 9525);
    // An outline without a width and without a style is PowerPoint's thinnest default, 0.75 pt.
    const emu = Number(line?.getAttribute("w")) || (_pptxChild(pic, "p:style") ? _pptxLineWidthEmu(pic, line) : 9525);
    const width = Math.max(1, Math.round((emu / 12700) * (96 / 72) * scale * 10) / 10);
    return { borderColor: color, borderWidth: `${width}px`, borderStyle: _pptxBorderStyle(line) };
}

// The file a picture shows: its own (r:embed), else the SVG of an SVG-only picture (<asvg:svgBlip> in the blip's
// extensions, with no PNG copy). Graphs pasted as SVG came in missing.
function _pptxBlipEmbed(blip) {
    if (!blip) return null;
    const own = blip.getAttribute("r:embed");
    if (own) return own;
    const svg = Array.from(blip.getElementsByTagName("*")).find(node => node.localName === "svgBlip");
    return svg?.getAttribute("r:embed") || null;
}

async function _pptxPictureElement(pkg, pic, rels, box, zIndex, pictureFill = null) {
    const blip = _pptxFirst(pictureFill || pic, "a:blip");
    const embed = _pptxBlipEmbed(blip);
    const crop = _pptxCrop(pictureFill || _pptxChild(pic, "p:blipFill"));
    // A picture fitted inside its box with room around it (negative crop values: PptxGenJS's "contain") covers only
    // part of the box. The editor's crops only zoom in (the picture at least fills its box), and these came in
    // stretched over the whole box. The box becomes the part the picture covers, uncropped on that side.
    if (crop) {
        box = { ...box };
        if (crop.widthPercent < 100) {
            box.x = Math.round(box.x + (box.w * crop.leftPercent) / 100);
            box.w = Math.max(1, Math.round((box.w * crop.widthPercent) / 100));
            crop.widthPercent = 100;
            crop.leftPercent = 0;
        }
        if (crop.heightPercent < 100) {
            box.y = Math.round(box.y + (box.h * crop.topPercent) / 100);
            box.h = Math.max(1, Math.round((box.h * crop.heightPercent) / 100));
            crop.heightPercent = 100;
            crop.topPercent = 0;
        }
    }
    const opacity = Math.max(0, Math.min(1, (Number(_pptxChild(blip, "a:alphaModFix")?.getAttribute("amt")) || 100000) / 100000));
    const path = rels[embed]?.path;
    const file = path && pkg.zip.file(path);
    if (!file) return null;
    const extension = path.split(".").pop().toLowerCase();
    const mime = PPTX_PICTURE_TYPES[extension];
    if (!mime) return null; // WMF and the like: browsers cannot show them (an EMF holding one bitmap is unwrapped)
    // Each media file is read and stored once per import: a master's logo is on every slide, and a picture used
    // on several slides was uploaded again for each.
    const spPr = _pptxChild(pic, "p:spPr");
    const ext = _pptxFirst(_pptxChild(spPr, "a:xfrm"), "a:ext");
    let effects = _pptxPictureEffects(blip, spPr, ext && { cx: Number(ext.getAttribute("cx")), cy: Number(ext.getAttribute("cy")) });
    // A mirrored picture (flipH/flipV, its own or a flipped group's, see toBox): the editor shows pictures unmirrored,
    // so the mirror is drawn into the picture, and its crop mirrors with it. Mirrored pictures came in unmirrored.
    if (box.flipH || box.flipV) {
        effects = { ...(effects || {}), flipH: !!box.flipH, flipV: !!box.flipV };
        if (crop) {
            if (box.flipH) crop.leftPercent = Math.round((100 - crop.leftPercent - crop.widthPercent) * 10000) / 10000;
            if (box.flipV) crop.topPercent = Math.round((100 - crop.topPercent - crop.heightPercent) * 10000) / 10000;
        }
    }
    // A picture cut to a freeform outline (a circle drawn as a path, a page with a curved edge): the outline is
    // drawn into the picture. It came in as the whole rectangle.
    if (_pptxChild(spPr, "a:custGeom")) {
        const paths = _pptxGeometryPaths(spPr, 1000, 1000).filter(path => path.d && path.fill).map(path => path.d);
        if (paths.length) effects = { ...(effects || {}), clip: { paths, crop: crop || null } };
    } else {
        // A picture in a snipped or part-rounded rectangle, a triangle, a hexagon...: the shape is cut out of it.
        // PowerPoint shows only the shape, and the cut-off corners (a label such as "(b)") showed.
        const outline = _pptxPresetOutline(_pptxChild(spPr, "a:prstGeom"), Number(ext?.getAttribute("cx")) || box.w, Number(ext?.getAttribute("cy")) || box.h);
        if (outline) effects = { ...(effects || {}), clip: { paths: [outline], crop: crop || null } };
    }
    const key = effects ? `${path}#${JSON.stringify(effects)}` : path;
    if (!pkg.pictureUrls) pkg.pictureUrls = new Map();
    if (!pkg.pictureUrls.has(key)) pkg.pictureUrls.set(key, _pptxStorePicture(file, path, mime, effects));
    const url = await pkg.pictureUrls.get(key);
    if (!url) return null;
    // A picture in a circle or rounded rectangle (its shape's geometry): the photos of a team came in square.
    const geometry = _pptxChild(spPr, "a:prstGeom")?.getAttribute("prst");
    let borderRadius = "0px";
    if (geometry === "ellipse" || geometry === "flowChartConnector") borderRadius = "50%";
    else if (geometry === "roundRect") {
        const adj = Number(_pptxFirst(_pptxChild(_pptxChild(spPr, "a:prstGeom"), "a:avLst"), "a:gd")?.getAttribute("fmla")?.replace(/^val\s+/, "")) || 16667;
        borderRadius = `${Math.round((Math.min(box.w, box.h) * adj) / 100000)}px`;
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
        // PowerPoint stretches a picture to its box. Without a crop SlideForge fills the box by trimming the picture
        // (object-fit: cover) and resets the box's height to the picture's own shape when it loads: the whole
        // crop draws it stretched, as a cropped one is, and keeps the box.
        cropTransform: crop || { widthPercent: 100, heightPercent: 100, leftPercent: 0, topPercent: 0 },
        heightSetManually: true,
        ...(box.rot ? { rotation: box.rot } : {}),
        styles: { zIndex, borderRadius, ...(opacity < 1 ? { opacity: String(opacity) } : {}), ..._pptxPictureOutline(pic, spPr, ext, box) },
    };
}

// A picture's cropping (<a:srcRect l t r b>, in thousandths of a percent of the picture) as SlideForge's
// cropTransform: the whole picture's size and offset as percentages of the box. Cropped pictures came in whole,
// squeezed into their box or spilling over the text next to them.
function _pptxCrop(blipFill) {
    const rect = _pptxChild(blipFill, "a:srcRect");
    const fill = _pptxChild(_pptxChild(blipFill, "a:stretch"), "a:fillRect");
    if (!rect && !fill) return null;
    const part = (node, name) => (Number(node?.getAttribute(name)) || 0) / 100000;
    const [l, t, r, b] = ["l", "t", "r", "b"].map(name => part(rect, name));
    const [dl, dt, dr, db] = ["l", "t", "r", "b"].map(name => part(fill, name));
    if (![l, t, r, b, dl, dt, dr, db].some(Boolean)) return null;
    const visibleX = 1 - l - r, visibleY = 1 - t - b;
    if (visibleX <= 0.001 || visibleY <= 0.001) return null;
    const widthPercent = 100 * (1 - dl - dr) / visibleX;
    const heightPercent = 100 * (1 - dt - db) / visibleY;
    const round = value => Math.round(value * 10000) / 10000;
    return { widthPercent: round(widthPercent), heightPercent: round(heightPercent), leftPercent: round(100 * dl - l * widthPercent), topPercent: round(100 * dt - t * heightPercent) };

}

// PowerPoint's built-in table styles are not written into the file (ppt/tableStyles.xml names them only), so a
// table in the default "Medium Style 2 - Accent 1" came in without its coloured header and banded rows. The Medium
// Style 2 family (PowerPoint's default and the commonly used one), as PowerPoint defines it: header and first/last
// column in the accent with white bold text, rows banded in 40% and 20% tints of it, white lines between cells.
const PPTX_BUILTIN_TABLE_STYLES = {
    "{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}": "dk1",
    "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}": "accent1",
    "{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}": "accent2",
    "{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}": "accent3",
    "{00A15C55-8517-42AA-B614-E9B94910E393}": "accent4",
    "{7DF18680-E054-41AD-8BC1-D1AEF772440D}": "accent5",
    "{93296810-A885-4BE3-A3E7-6D5BEEA58F35}": "accent6",
};

function _pptxBuiltinTableStyle(styleId) {
    const accent = PPTX_BUILTIN_TABLE_STYLES[styleId];
    if (!accent) return null;
    const fill = mods => `<a:fill><a:solidFill><a:schemeClr val="${accent}">${mods}</a:schemeClr></a:solidFill></a:fill>`;
    const line = (side, w) => `<a:${side}><a:ln w="${w}" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:${side}>`;
    const strong = `<a:tcTxStyle b="on"><a:schemeClr val="lt1"/></a:tcTxStyle>`;
    const xml = `<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" styleId="${styleId}">
        <a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${["left", "right", "top", "bottom", "insideH", "insideV"].map(side => line(side, 12700)).join("")}</a:tcBdr>${fill('<a:tint val="20000"/>')}</a:tcStyle></a:wholeTbl>
        <a:band1H><a:tcStyle><a:tcBdr/>${fill('<a:tint val="40000"/>')}</a:tcStyle></a:band1H>
        <a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H>
        <a:band1V><a:tcStyle><a:tcBdr/>${fill('<a:tint val="40000"/>')}</a:tcStyle></a:band1V>
        <a:band2V><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2V>
        <a:lastCol>${strong}<a:tcStyle><a:tcBdr/>${fill("")}</a:tcStyle></a:lastCol>
        <a:firstCol>${strong}<a:tcStyle><a:tcBdr/>${fill("")}</a:tcStyle></a:firstCol>
        <a:lastRow>${strong}<a:tcStyle><a:tcBdr>${line("top", 38100)}</a:tcBdr>${fill("")}</a:tcStyle></a:lastRow>
        <a:firstRow>${strong}<a:tcStyle><a:tcBdr>${line("bottom", 38100)}</a:tcBdr>${fill("")}</a:tcStyle></a:firstRow>
    </a:tblStyle>`;
    return new DOMParser().parseFromString(xml, "text/xml").documentElement;
}

// Characters raised or lowered (baseline) in a table cell, which holds plain text: as Unicode superscript and
// subscript characters when each has one ("10<sup>-4</sup>" came in as "10-4"); otherwise left as they are.
const PPTX_SUPERSCRIPTS = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const PPTX_SUBSCRIPTS = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎" };

function _pptxCellRunText(run) {
    const text = Array.from(run.getElementsByTagName("a:t")).map(t => t.textContent).join("");
    const baseline = Number(_pptxChild(run, "a:rPr")?.getAttribute("baseline")) || 0;
    const table = baseline > 0 ? PPTX_SUPERSCRIPTS : baseline < 0 ? PPTX_SUBSCRIPTS : null;
    if (!table || ![...text].every(ch => table[ch])) return text;
    return [...text].map(ch => table[ch]).join("");
}

// A table with its cells' fills, text colours, weights, sizes and alignment: from the cells themselves, else from
// the table style it names (ppt/tableStyles.xml: whole table, banded rows and columns, first and last row and
// column). Tables came in grey and white in Manrope whatever the deck had.
function _pptxTableElement(tbl, box, scale, fontScale, zIndex, tableStyles = null, colors = _pptxCurrentThemeColors, links = {}) {
    const colWidths = _pptxChildren(_pptxChild(tbl, "a:tblGrid"), "a:gridCol").map(col => Math.max(36, Math.round(((Number(col.getAttribute("w")) || 0) / PPTX_EMU_PER_PX) * scale)));
    const rows = _pptxChildren(tbl, "a:tr");
    if (!rows.length || !colWidths.length) return null;
    const tblPr = _pptxChild(tbl, "a:tblPr");
    const flag = name => tblPr?.getAttribute(name) === "1" || tblPr?.getAttribute(name) === "true";
    const styleId = _pptxChild(tblPr, "a:tableStyleId")?.textContent?.trim();
    const style = styleId && (Array.from(tableStyles?.getElementsByTagName("a:tblStyle") || []).find(node => node.getAttribute("styleId") === styleId) || _pptxBuiltinTableStyle(styleId));
    const part = name => _pptxChild(style, name);
    const fillOf = holder => {
        if (!holder) return undefined;
        if (_pptxChild(holder, "a:noFill")) return "transparent";
        const solid = _pptxChild(holder, "a:solidFill");
        return solid ? _pptxColorValue(solid, colors) || undefined : undefined;
    };
    // The style's parts that apply to a cell, weakest first.
    const regions = (r, c) => {
        const header = flag("firstRow") ? 1 : 0;
        const list = ["a:wholeTbl"];
        if (flag("bandRow") && r >= header) list.push((r - header) % 2 === 0 ? "a:band1H" : "a:band2H");
        if (flag("bandCol")) list.push((c - (flag("firstCol") ? 1 : 0)) % 2 === 0 ? "a:band1V" : "a:band2V");
        if (flag("firstCol") && c === 0) list.push("a:firstCol");
        if (flag("lastCol") && c === colWidths.length - 1) list.push("a:lastCol");
        if (flag("lastRow") && r === rows.length - 1) list.push("a:lastRow");
        if (flag("firstRow") && r === 0) list.push("a:firstRow");
        return list.map(part).filter(Boolean);
    };
    const px = emu => (emu / PPTX_EMU_PER_PX) * scale;
    let fontSize = null;
    let fontFamily = null;
    let borderColor = null;
    let borderWidth = null;
    let padding = null;
    // Merged cells: the first cell of a merge says how many columns (gridSpan) and rows (rowSpan) it covers; the
    // cells under it (hMerge, vMerge) keep their place in the grid. Merged blocks came in as separate cells.
    const merges = [];
    rows.forEach((tr, r) =>
        _pptxChildren(tr, "a:tc").forEach((tc, c) => {
            const colSpan = Math.max(1, Number(tc.getAttribute("gridSpan")) || 1);
            const rowSpan = Math.max(1, Number(tc.getAttribute("rowSpan")) || 1);
            if ((colSpan > 1 || rowSpan > 1) && tc.getAttribute("hMerge") !== "1" && tc.getAttribute("vMerge") !== "1") merges.push({ row: r, col: c, rowSpan, colSpan });
        }),
    );
    const cells = rows.map((tr, r) =>
        colWidths.map((_, c) => {
            const tc = _pptxChildren(tr, "a:tc")[c];
            const paragraphs = Array.from(tc?.getElementsByTagName("a:p") || []);
            const styles = {};
            regions(r, c).forEach(region => {
                const fill = fillOf(_pptxChild(_pptxChild(region, "a:tcStyle"), "a:fill"));
                if (fill) styles.backgroundColor = fill;
                const text = _pptxChild(region, "a:tcTxStyle");
                const color = text && _pptxColorValue(text, colors);
                if (color) styles.color = color;
                if (text?.getAttribute("b") === "on") styles.fontWeight = "700";
                if (text?.getAttribute("b") === "off") styles.fontWeight = "400";
            });
            const tcPr = _pptxChild(tc, "a:tcPr");
            const ownFill = fillOf(tcPr);
            if (ownFill) styles.backgroundColor = ownFill;
            // One padding for all sides here: the smaller of PowerPoint's (0.1" left and right, 0.05" top and
            // bottom by default), so text that fits a column in PowerPoint is not pushed onto a second line.
            if (tcPr && padding === null) padding = px(Math.min(Number(tcPr.getAttribute("marL") ?? 91440), Number(tcPr.getAttribute("marT") ?? 45720)));
            const edge = _pptxChild(tcPr, "a:lnB") || _pptxChild(tcPr, "a:lnL");
            if (edge && borderColor === null) {
                borderColor = _pptxChild(edge, "a:noFill") ? "transparent" : _pptxColorValue(_pptxChild(edge, "a:solidFill"), colors);
                borderWidth = Math.max(0, Math.round(px(Number(edge.getAttribute("w")) || 12700) * 10) / 10);
            }
            const rPr = _pptxFirst(tc, "a:rPr");
            const size = Number(rPr?.getAttribute("sz"));
            const cellSize = size ? _pptxPx((size / 100) * (96 / 72) * fontScale) : null;
            if (cellSize && !fontSize) fontSize = cellSize;
            if (cellSize && cellSize !== fontSize) styles.fontSize = `${cellSize}px`;
            const font = _pptxChild(rPr, "a:latin")?.getAttribute("typeface");
            if (font && !font.startsWith("+") && !fontFamily) fontFamily = _pptxFontStack(font);
            if (rPr?.getAttribute("b") === "1") styles.fontWeight = "700";
            if (rPr?.getAttribute("b") === "0") styles.fontWeight = "400";
            if (rPr?.getAttribute("i") === "1") styles.fontStyle = "italic";
            const runColor = _pptxColorValue(_pptxChild(rPr, "a:solidFill"), colors);
            if (runColor) styles.color = runColor;
            const align = { ctr: "center", r: "right", just: "justify" }[_pptxFirst(tc, "a:pPr")?.getAttribute("algn")];
            if (align) styles.textAlign = align;
            const anchor = { ctr: "middle", b: "bottom" }[tcPr?.getAttribute("anchor")];
            if (anchor) styles.verticalAlign = anchor;
            if (!styles.fontWeight) styles.fontWeight = "400";
            if (!styles.backgroundColor) styles.backgroundColor = "transparent";
            if (!styles.color) styles.color = colors?.tx1 || "#000000";
            // A cell's link (a contents table whose entries go to their slides): the first linked words in it. Cells
            // hold plain text, so the cell itself becomes the link. They came in unlinked.
            const cellLink = Array.from(tc?.getElementsByTagName("a:hlinkClick") || []).map(node => _pptxClickLink(node, links)).find(Boolean);
            return {
                text: paragraphs.map(p => Array.from(p.children).filter(n => n.tagName === "a:r" || n.tagName === "a:fld").map(_pptxCellRunText).join("")).join("\n"),
                styles,
                ...(cellLink ? { link: cellLink } : {}),
            };
        }),
    );
    // The style's lines between cells when the cells set none.
    if (borderColor === null && style) {
        const ln = _pptxFirst(_pptxChild(_pptxChild(part("a:wholeTbl"), "a:tcStyle"), "a:tcBdr"), "a:ln");
        if (ln) {
            borderColor = _pptxChild(ln, "a:noFill") ? "transparent" : _pptxColorValue(_pptxChild(ln, "a:solidFill"), colors);
            borderWidth = Math.max(0, Math.round(px(Number(ln.getAttribute("w")) || 12700) * 10) / 10);
        }
    }
    const base = typeof createDefaultTableData === "function" ? createDefaultTableData(rows.length, colWidths.length) : {};
    const family = fontFamily || '"Manrope", sans-serif';
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
            ...(merges.length ? { merges } : {}),
            headerRow: flag("firstRow"),
            zebra: false,
            // PowerPoint's line spacing in cells (the page's 1.5 made rows taller and the last one fell outside).
            lineHeight: 1.2,
            fontFamily: family,
            fontSize: `${fontSize || 16}px`,
            ...(borderColor ? { borderColor, borderWidth: borderColor === "transparent" ? 0 : borderWidth } : {}),
            ...(padding !== null ? { cellPadding: Math.max(2, Math.round(padding)) } : {}),
            selection: null,
        },
        styles: { color: colors?.tx1 || "#172033", fontSize: `${fontSize || 16}px`, fontFamily: family, textAlign: "left", zIndex },
    };
}

async function _pptxChartElement(pkg, frame, rels, box, zIndex) {
    const chartRef = _pptxFirst(frame, "c:chart")?.getAttribute("r:id");
    const doc = rels[chartRef] && (await pkg.xml(rels[chartRef].path));
    if (!doc) return null;
    const kinds = [["c:barChart", "bar"], ["c:bar3DChart", "bar"], ["c:lineChart", "line"], ["c:pieChart", "pie"], ["c:pie3DChart", "pie"], ["c:doughnutChart", "doughnut"], ["c:scatterChart", "scatter"]];
    const [tag, chartType] = kinds.find(([name]) => doc.getElementsByTagName(name).length) || [];
    if (!tag) return null;
    const plot = doc.getElementsByTagName(tag)[0];
    const seriesNodes = Array.from(plot.getElementsByTagName("c:ser"));
    if (!seriesNodes.length) return null;
    const scatter = chartType === "scatter";
    const points = (series, holder) => {
        const cells = Array.from(_pptxFirst(series, holder)?.getElementsByTagName("c:pt") || []);
        const out = [];
        cells.forEach(pt => {
            out[Number(pt.getAttribute("idx")) || 0] = _pptxFirst(pt, "c:v")?.textContent ?? "";
        });
        return out;
    };
    const lineHidden = node => Boolean(_pptxChild(_pptxChild(_pptxChild(node, "c:spPr"), "a:ln"), "a:noFill"));
    const scatterStyle = _pptxChild(plot, "c:scatterStyle")?.getAttribute("val") || "lineMarker";
    // Every series, not only the first: a two-series chart came in with half its data.
    let series = seriesNodes
        .map((node, index) => {
            const entry = {
                label: _pptxFirst(_pptxFirst(node, "c:tx"), "c:v")?.textContent || `Series ${index + 1}`,
                color: _pptxChild(_pptxChild(_pptxChild(node, "c:spPr"), "a:solidFill"), "a:srgbClr")?.getAttribute("val") || null,
            };
            if (!scatter) return { ...entry, values: Array.from(points(node, "c:val"), value => Number(value) || 0) };
            // A scatter series is (x, y) pairs; x that are not numbers count 1, 2, 3… as in PowerPoint.
            const xs = Array.from(points(node, "c:xVal"));
            const ys = Array.from(points(node, "c:yVal"));
            const numericX = xs.length && xs.every(value => value === undefined || value === "" || Number.isFinite(Number(value)));
            const pairs = ys
                .map((y, i) => [numericX ? Number(xs[i]) : i + 1, y === undefined || y === "" ? NaN : Number(y)])
                .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
            const symbol = _pptxChild(_pptxChild(node, "c:marker"), "c:symbol")?.getAttribute("val");
            const markerColor = _pptxChild(_pptxChild(_pptxChild(_pptxChild(node, "c:marker"), "c:spPr"), "a:solidFill"), "a:srgbClr")?.getAttribute("val");
            return {
                ...entry,
                color: entry.color || markerColor || null,
                pairs,
                showLine: scatterStyle !== "marker" && !lineHidden(node),
                noMarker: symbol === "none",
            };
        })
        .filter(entry => (scatter ? entry.pairs.length : entry.values.length));
    if (!series.length) return null;
    // Scatter points go in the chart's table as rows of x (the label column) and one y per series.
    let labels;
    if (scatter) {
        // Series that share their x (one column of x in the sheet) share the rows. Otherwise each series has rows of
        // its own, the others empty there: merging rows by x lost every point but one where x repeats (a cluster
        // of points at x = 0 came in as two).
        const xsOf = entry => entry.pairs.map(([x]) => x).join(",");
        if (series.every(entry => xsOf(entry) === xsOf(series[0]))) {
            labels = series[0].pairs.map(([x]) => String(x));
            series = series.map(entry => ({ ...entry, values: entry.pairs.map(([, y]) => y) }));
        } else {
            labels = series.flatMap(entry => entry.pairs.map(([x]) => String(x)));
            let row = 0;
            const total = labels.length;
            series = series.map(entry => {
                const values = Array(total).fill(null);
                entry.pairs.forEach(([, y]) => (values[row++] = y));
                return { ...entry, values };
            });
        }
    } else {
        labels = points(seriesNodes[0], "c:cat");
    }
    const count = Math.max(...series.map(entry => entry.values.length));
    const round = chartType === "pie" || chartType === "doughnut";
    const horizontal = chartType === "bar" && _pptxChild(plot, "c:barDir")?.getAttribute("val") === "bar";
    const grouping = _pptxChild(plot, "c:grouping")?.getAttribute("val") || "";
    const stacked = chartType === "bar" && (grouping === "stacked" || grouping === "percentStacked");
    if (chartType === "bar" && grouping === "percentStacked") {
        // Each category's bars as shares of its total.
        for (let i = 0; i < count; i++) {
            const total = series.reduce((sum, entry) => sum + Math.abs(entry.values[i] || 0), 0);
            series.forEach(entry => {
                entry.values[i] = total ? Math.round(((entry.values[i] || 0) / total) * 10000) / 100 : 0;
            });
        }
    }
    const titleText = node => Array.from(node?.getElementsByTagName("a:t") || []).map(t => t.textContent).join("").trim();
    const chartTitle = titleText(_pptxChild(_pptxFirst(doc, "c:chart"), "c:title"));
    const plotArea = _pptxFirst(doc, "c:plotArea");
    const axes = Array.from(plotArea?.children || []).filter(node => /^c:(catAx|valAx|dateAx)$/.test(node.tagName));
    // Which side of the chart an axis is drawn on says whether it is Chart.js's x or y.
    const axisKey = axis => {
        const pos = _pptxChild(axis, "c:axPos")?.getAttribute("val");
        if (pos === "b" || pos === "t") return "x";
        if (pos === "l" || pos === "r") return "y";
        const valueAxis = axis.tagName === "c:valAx";
        return valueAxis === horizontal ? "x" : "y";
    };
    const scales = {};
    const titles = { x: "", y: "" };
    if (!round) {
        axes.forEach(axis => {
            const key = axisKey(axis);
            if (!titles[key]) titles[key] = titleText(_pptxChild(axis, "c:title"));
            if (axis.tagName !== "c:valAx") return;
            const scaling = _pptxChild(axis, "c:scaling");
            const bound = name => {
                const value = Number(_pptxChild(scaling, name)?.getAttribute("val"));
                return Number.isFinite(value) && _pptxChild(scaling, name) ? value : null;
            };
            const min = bound("c:min");
            const max = bound("c:max");
            if (min !== null || max !== null) scales[key] = { ...(scales[key] || {}), ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) };
            // A logarithmic axis (probabilities from 1e-14 to 1 sat in a line along zero on a linear one).
            if (_pptxChild(scaling, "c:logBase")) scales[key] = { ...(scales[key] || {}), type: "logarithmic" };
        });
        if (stacked) ["x", "y"].forEach(key => (scales[key] = { ...(scales[key] || {}), stacked: true }));
        if (grouping === "percentStacked" && chartType === "bar") {
            const key = horizontal ? "x" : "y";
            scales[key] = { min: 0, max: 100, ...scales[key] };
            if (scales[key].max <= 1) scales[key].max = 100; // PowerPoint's percent axis runs 0–1
        }
    }
    // Numbers on the bars or points, as the chart shows them (on the plot or on every series, not switched off).
    const showsValues = node => {
        const labels = _pptxChild(node, "c:dLbls");
        return Boolean(labels) && _pptxChild(labels, "c:delete")?.getAttribute("val") !== "1" && ["1", "true"].includes(_pptxChild(labels, "c:showVal")?.getAttribute("val"));
    };
    const valueLabels = !round && (showsValues(plot) || seriesNodes.every(showsValues));
    const legend = _pptxFirst(doc, "c:legend");
    const legendPos = { t: "top", b: "bottom", l: "left", r: "right" }[_pptxFirst(legend, "c:legendPos")?.getAttribute("val")] || "top";
    const element = {
        id: generateId("el"),
        type: "chart",
        chartType,
        chartData: {
            labels: Array.from({ length: count }, (_, index) => labels[index] ?? `Item ${index + 1}`),
            datasets: series.map(entry => ({
                label: entry.label,
                data: entry.values,
                borderWidth: 1,
                ...(scatter ? { showLine: entry.showLine, ...(entry.noMarker ? { pointRadius: 0 } : {}) } : {}),
            })),
        },
        chartOptions: {
            responsive: true,
            maintainAspectRatio: false,
            ...(horizontal ? { indexAxis: "y" } : {}),
            plugins: { legend: { display: true, position: "top" } },
            ...(Object.keys(scales).length ? { scales } : {}),
        },
        chartStyle: {
            legend: legend ? legendPos : "none",
            title: chartTitle,
            xTitle: titles.x,
            yTitle: titles.y,
            seriesColors: round ? [] : series.map(entry => (entry.color ? `#${entry.color}` : null)),
            ...(valueLabels ? { valueLabels: true } : {}),
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

// The deck theme's colour scheme (dk1, lt1, accent1…) with the master's colour map on top (tx1, bg1, tx2, bg2…: a dark
// design maps text to light 1), its heading and body fonts, and its background fill styles (for <p:bgRef>).
async function _pptxTheme(pkg, themePath = null, clrMap = null) {
    const colors = {};
    const names = Object.keys(pkg.zip.files || {}).filter(name => /^ppt\/theme\/theme\d+\.xml$/.test(name)).sort();
    const doc = await pkg.xml(themePath || names[0] || "");
    const scheme = doc && _pptxFirst(doc, "a:clrScheme");
    Array.from(scheme?.children || []).forEach(node => {
        const key = node.tagName.replace(/^a:/, "");
        const rgb = _pptxChild(node, "a:srgbClr")?.getAttribute("val") || _pptxChild(node, "a:sysClr")?.getAttribute("lastClr");
        if (rgb && /^[0-9a-f]{6}$/i.test(rgb)) colors[key] = `#${rgb}`;
    });
    const map = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2", ...(clrMap || {}) };
    Object.entries(map).forEach(([alias, name]) => {
        if (colors[name]) colors[alias] = colors[name];
    });
    const font = name => _pptxFirst(_pptxFirst(doc, name), "a:latin")?.getAttribute("typeface") || null;
    return {
        colors,
        fonts: { major: font("a:majorFont"), minor: font("a:minorFont") },
        bgFillStyles: Array.from(_pptxFirst(doc, "a:bgFillStyleLst")?.children || []),
        fillStyles: Array.from(_pptxFirst(doc, "a:fillStyleLst")?.children || []),
        lineStyles: Array.from(_pptxFirst(doc, "a:lnStyleLst")?.children || []),
    };
}

async function _pptxThemeColors(pkg) {
    return (await _pptxTheme(pkg)).colors;
}

// A slide's design: its layout and master, and the master's theme. Text without its own font, size or colour takes
// them from here, and a slide without its own background takes the layout's or the master's. They used to come from
// SlideForge's own default theme: a navy deck in Georgia came in white, in Manrope, with dark text.
async function _pptxSlideDesign(pkg, slidePath) {
    const slideRels = await pkg.rels(slidePath);
    const layoutPath = Object.values(slideRels).find(rel => rel.type === "slideLayout")?.path || null;
    const masterPath = layoutPath ? Object.values(await pkg.rels(layoutPath)).find(rel => rel.type === "slideMaster")?.path || null : null;
    const themePath = masterPath ? Object.values(await pkg.rels(masterPath)).find(rel => rel.type === "theme")?.path || null : null;
    const layout = layoutPath ? await pkg.xml(layoutPath) : null;
    const master = masterPath ? await pkg.xml(masterPath) : null;
    const clrMapNode = master && _pptxFirst(master, "p:clrMap");
    const clrMap = clrMapNode ? Object.fromEntries(Array.from(clrMapNode.attributes).map(attr => [attr.name, attr.value])) : null;
    const theme = await _pptxTheme(pkg, themePath, clrMap);
    // The presentation's default text style: what text outside placeholders (text boxes, shapes) starts from.
    const presentation = await pkg.xml("ppt/presentation.xml");
    return { slidePath, layoutPath, masterPath, layout, master, theme, presentation };
}

// A font name as a CSS font list, with the generic family it belongs to behind it: a serif such as Georgia fell back
// to a sans-serif where it is not installed.
// Fonts with the same letter widths, for a deck's font that is not installed: its lines then break where the
// author's did. "Adobe Times" fell back to the browser's serif (Noto Serif here: wider, and every line wrapped
// differently); Times New Roman or one of its metric clones is what it looks like.
const PPTX_FONT_SUBSTITUTES = [
    [/^(adobe )?times( new roman)?( ps)?( mt)?$|^nimbus roman|^tinos$|^liberation serif$|^tex gyre termes$/i, ["Times New Roman", "Tinos", "Liberation Serif", "Nimbus Roman", "Times"]],
    [/^(arial|helvetica)( neue)?( mt)?$|^nimbus sans|^arimo$|^liberation sans$/i, ["Arial", "Arimo", "Liberation Sans", "Helvetica", "Nimbus Sans"]],
    [/^calibri$/i, ["Calibri", "Carlito"]],
    [/^cambria$/i, ["Cambria", "Caladea"]],
    [/^courier( new)?$|^cousine$|^liberation mono$/i, ["Courier New", "Cousine", "Liberation Mono", "Courier"]],
    [/^georgia$/i, ["Georgia", "Gelasio"]],
];

function _pptxFontStack(name) {
    // Only characters font names use: the stack goes into style attributes, where ";" or "}" would end the declaration.
    const font = String(name || "").replace(/["';{}<>\\]/g, "").trim();
    const generic = /mono|courier|consolas|menlo/i.test(font)
        ? "monospace"
        : /georgia|times|cambria|garamond|palatino|baskerville|book antiqua|constantia|didot|bodoni|serif$|minion|charter|merriweather|playfair|lora|libre baskerville/i.test(font) && !/sans/i.test(font)
          ? "serif"
          : "sans-serif";
    const substitutes = (PPTX_FONT_SUBSTITUTES.find(([pattern]) => pattern.test(font))?.[1] || []).filter(other => other.toLowerCase() !== font.toLowerCase());
    return [font, ...substitutes].map(family => `"${family}"`).join(", ") + `, ${generic}`;
}

// "+mj-lt" / "+mn-lt" (the theme's heading / body font) as the font's name.
function _pptxFontName(typeface, theme) {
    if (!typeface) return null;
    if (/^\+mj/.test(typeface)) return theme?.fonts?.major || null;
    if (/^\+mn/.test(typeface)) return theme?.fonts?.minor || null;
    return typeface;
}

// The same placeholder in a layout or master: by type and index, by index, then by type alone.
function _pptxPlaceholderMatch(doc, placeholder) {
    if (!doc || !placeholder) return null;
    const isTitle = type => type === "title" || type === "ctrTitle";
    const shapes = Array.from(doc.getElementsByTagName("p:sp")).map(n => ({ n, ph: _pptxPlaceholder(n) })).filter(item => item.ph);
    return (
        shapes.find(item => item.ph.type === placeholder.type && item.ph.idx === placeholder.idx) ||
        shapes.find(item => placeholder.idx && item.ph.idx === placeholder.idx) ||
        shapes.find(item => item.ph.type === placeholder.type || (isTitle(item.ph.type) && isTitle(placeholder.type)))
    )?.n || null;
}

// A placeholder's fill, outline and outline shape, from the slide, else its layout's placeholder, else its
// master's: { fill, gradient, line, lineWidth, rounded }. A title bar filled blue on the master (<p:spPr/> on the
// slide) came in as white words on white, and the footer strip's black and blue were lost.
function _pptxPlaceholderLook(design, placeholder, sp) {
    const chain = [sp, _pptxPlaceholderMatch(design?.layout, placeholder), _pptxPlaceholderMatch(design?.master, placeholder)]
        .filter(Boolean)
        .map(node => _pptxChild(node, "p:spPr"))
        .filter(Boolean);
    const look = {};
    const fillTags = ["a:solidFill", "a:gradFill", "a:noFill", "a:blipFill", "a:pattFill", "a:grpFill"];
    const fillOwner = chain.find(spPr => fillTags.some(tag => _pptxChild(spPr, tag)));
    if (fillOwner && !_pptxChild(fillOwner, "a:noFill")) {
        if (_pptxChild(fillOwner, "a:gradFill")) {
            const found = _pptxFillBackground(_pptxChild(fillOwner, "a:gradFill"), null, _pptxCurrentThemeColors);
            if (found?.color) look.fill = found.color;
            if (found?.gradient) look.gradient = found.gradient;
        } else {
            look.fill = _pptxColor(fillOwner);
        }
    }
    const lineOwner = chain.find(spPr => _pptxChild(spPr, "a:ln") && Array.from(_pptxChild(spPr, "a:ln").children).some(c => /Fill$/.test(c.tagName)));
    const ln = lineOwner && _pptxChild(lineOwner, "a:ln");
    if (ln && !_pptxChild(ln, "a:noFill")) {
        look.line = _pptxColor(ln);
        look.lineWidth = Number(chain.map(spPr => _pptxChild(spPr, "a:ln")?.getAttribute("w")).find(Boolean)) || 12700;
    }
    const geometry = chain.map(spPr => _pptxChild(spPr, "a:prstGeom")?.getAttribute("prst")).find(Boolean);
    look.rounded = geometry === "roundRect";
    return look;
}

// A text box's <a:bodyPr> with what its master and layout placeholders set underneath its own attributes.
function _pptxBodyProperties(design, placeholder, sp) {
    const own = _pptxChild(_pptxChild(sp, "p:txBody"), "a:bodyPr");
    if (!placeholder || !design) return own;
    const isTitle = type => type === "title" || type === "ctrTitle";
    const match = doc => {
        const shapes = Array.from(doc?.getElementsByTagName("p:sp") || []).map(n => ({ n, ph: _pptxPlaceholder(n) })).filter(item => item.ph);
        return (
            shapes.find(item => item.ph.type === placeholder.type && item.ph.idx === placeholder.idx) ||
            shapes.find(item => placeholder.idx && item.ph.idx === placeholder.idx) ||
            shapes.find(item => item.ph.type === placeholder.type || (isTitle(item.ph.type) && isTitle(placeholder.type)))
        )?.n;
    };
    const merged = sp.ownerDocument.createElement("a:bodyPr");
    [match(design.master), match(design.layout)].forEach(node => {
        const source = _pptxChild(_pptxChild(node, "p:txBody"), "a:bodyPr");
        Array.from(source?.attributes || []).forEach(a => merged.setAttribute(a.name, a.value));
    });
    Array.from(own?.attributes || []).forEach(a => merged.setAttribute(a.name, a.value));
    Array.from(own?.children || []).forEach(child => merged.appendChild(child.cloneNode(true)));
    return merged;
}

// The master text style a box starts from: titles the title style, slide number, date, footer and header the
// "other" style (no bullets: the body style gave slide numbers a bullet, "• 7"), other placeholders the body style.
function _pptxMasterTextStyle(placeholder) {
    if (!placeholder || ["sldNum", "dt", "ftr", "hdr"].includes(placeholder.type)) return "p:otherStyle";
    return placeholder.type === "title" || placeholder.type === "ctrTitle" ? "p:titleStyle" : "p:bodyStyle";
}

function _pptxParagraphDefaults(design, placeholder, sp, level) {
    const result = sp.ownerDocument.createElement("a:pPr");
    // The same placeholder in the layout and master: by type and index, by index, then by type alone (a slide
    // number is idx 12 on a layout and idx 4 on its master). Without the last, a slide number lost the master's
    // right alignment, its size and its grey.
    const isTitle = type => type === "title" || type === "ctrTitle";
    const match = doc => {
        if (!placeholder) return null;
        const shapes = Array.from(doc?.getElementsByTagName("p:sp") || []).map(n => ({ n, ph: _pptxPlaceholder(n) })).filter(item => item.ph);
        return (
            shapes.find(item => item.ph.type === placeholder.type && item.ph.idx === placeholder.idx) ||
            shapes.find(item => placeholder.idx && item.ph.idx === placeholder.idx) ||
            shapes.find(item => item.ph.type === placeholder.type || (isTitle(item.ph.type) && isTitle(placeholder.type)))
        )?.n;
    };
    const name = `a:lvl${level + 1}pPr`;
    const kind = _pptxMasterTextStyle(placeholder);
    const sources = [
        // Text outside placeholders starts from the presentation's default style (see _pptxTextDefaults).
        !placeholder ? _pptxChild(_pptxFirst(design?.presentation, "p:defaultTextStyle"), name) || _pptxChild(_pptxChild(_pptxFirst(design?.master, "p:txStyles"), kind), name)
            : _pptxChild(_pptxChild(_pptxFirst(design?.master, "p:txStyles"), kind), name),
        ...[match(design?.master), match(design?.layout), sp].map(n => _pptxChild(_pptxChild(_pptxChild(n, "p:txBody"), "a:lstStyle"), name)),
    ];
    // A shape style's text colour (<p:style><a:fontRef>: white on Office's filled shapes) wins over the deck's,
    // master's and layout's default text colours; only the shape's own list style comes before it. The deck's black
    // default text colour came through on a black title bar's white "TDDFT", hiding it.
    const styleColor = _pptxFirst(_pptxChild(sp, "p:style"), "a:fontRef")?.firstElementChild;
    const ownStyle = sources.at(-1);
    sources.filter(Boolean).forEach(source => {
        if (styleColor && source !== ownStyle) {
            source = source.cloneNode(true);
            _pptxChildren(_pptxChild(source, "a:defRPr"), "a:solidFill").forEach(n => n.remove());
            _pptxChildren(_pptxChild(source, "a:defRPr"), "a:gradFill").forEach(n => n.remove());
        }
        Array.from(source.attributes).forEach(a => result.setAttribute(a.name, a.value));
        Array.from(source.children).forEach(child => {
            const tags = ["a:buNone", "a:buChar", "a:buAutoNum"];
            (tags.includes(child.tagName) ? tags : [child.tagName]).forEach(tag => _pptxChildren(result, tag).forEach(n => n.remove()));
            result.appendChild(child.cloneNode(true));
        });
    });
    return result;
}

// The first-level run properties a placeholder (or a plain text box) inherits: the layout's placeholder, the
// master's, then the master's text styles (title, body or other). Size in points, colour, font, bold.
function _pptxTextDefaults(design, placeholder) {
    const defaults = {};
    const take = defRPr => {
        if (!defRPr) return;
        const size = Number(defRPr.getAttribute("sz"));
        if (size && defaults.size == null) defaults.size = size / 100;
        if (defaults.bold == null && defRPr.getAttribute("b") != null) defaults.bold = defRPr.getAttribute("b") === "1";
        const color = _pptxColor(defRPr);
        if (color && !defaults.color) defaults.color = color;
        const font = _pptxChild(defRPr, "a:latin")?.getAttribute("typeface");
        if (font && !defaults.font) defaults.font = font;
    };
    const isTitle = type => type === "title" || type === "ctrTitle";
    const placeholderIn = doc => {
        if (!doc || !placeholder) return null;
        const shapes = Array.from(doc.getElementsByTagName("p:sp")).map(sp => ({ sp, ph: _pptxPlaceholder(sp) })).filter(item => item.ph);
        return (
            shapes.find(item => item.ph.type === placeholder.type && item.ph.idx === placeholder.idx) ||
            shapes.find(item => placeholder.idx && item.ph.idx === placeholder.idx) ||
            shapes.find(item => item.ph.type === placeholder.type || (isTitle(item.ph.type) && isTitle(placeholder.type)))
        )?.sp || null;
    };
    const lvl1 = sp => _pptxFirst(_pptxFirst(_pptxChild(sp, "p:txBody"), "a:lstStyle"), "a:lvl1pPr");
    [placeholderIn(design?.layout), placeholderIn(design?.master)].forEach(sp => sp && take(_pptxChild(lvl1(sp), "a:defRPr")));
    const styles = design?.master && _pptxFirst(design.master, "p:txStyles");
    const styleName = _pptxMasterTextStyle(placeholder);
    // Text boxes and shapes take the presentation's default text style (as PowerPoint and LibreOffice do), not the
    // master's "other" style: a master scaled for 4:3 said 13.5 pt there, and a text box's 18 pt words came in small.
    if (!placeholder) take(_pptxChild(_pptxFirst(_pptxFirst(design?.presentation, "p:defaultTextStyle"), "a:lvl1pPr"), "a:defRPr"));
    take(_pptxChild(_pptxFirst(_pptxFirst(styles, styleName), "a:lvl1pPr"), "a:defRPr"));
    // Headings in the theme's heading font, the rest in its body font, unless a style names another.
    defaults.font = _pptxFontName(defaults.font || (placeholder && isTitle(placeholder.type) ? "+mj-lt" : "+mn-lt"), design?.theme);
    return defaults;
}

// A fill (solid, gradient or picture) as a background: { color } | { color, gradient } | { picture: { part, embed } }.
// phColor stands in for "phClr" (the colour a <p:bgRef> gives the theme's background style).
function _pptxFillBackground(fillHolder, part, colors, phColor = null) {
    if (!fillHolder) return null;
    const palette = phColor ? { ...colors, phClr: phColor } : colors;
    const solid = fillHolder.tagName === "a:solidFill" ? fillHolder : _pptxChild(fillHolder, "a:solidFill");
    if (solid) {
        const color = _pptxColorValue(solid, palette);
        return color ? { color } : null;
    }
    const gradient = fillHolder.tagName === "a:gradFill" ? fillHolder : _pptxChild(fillHolder, "a:gradFill");
    if (gradient) {
        const stops = _pptxChildren(_pptxChild(gradient, "a:gsLst"), "a:gs")
            // Each stop's own transparency too: a magnifier's glass (white at 12% to 3%) came in solid white and hid
            // the figures under it.
            .map(gs => {
                const color = _pptxColorValue(gs, palette);
                const alpha = _pptxFillAlpha(gs);
                return { pos: (Number(gs.getAttribute("pos")) || 0) / 1000, color: color && alpha < 1 && /^#[0-9a-f]{6}$/i.test(color) ? _pptxRgba(color, alpha) : color };
            })
            .filter(stop => stop.color)
            .sort((a, b) => a.pos - b.pos);
        if (!stops.length) return null;
        const list = stops.map(stop => `${stop.color} ${Math.round(stop.pos)}%`).join(", ");
        const linear = _pptxChild(gradient, "a:lin");
        const css = linear || !_pptxChild(gradient, "a:path")
            ? `linear-gradient(${Math.round((Number(linear?.getAttribute("ang")) || 0) / 60000 + 90)}deg, ${list})`
            : `radial-gradient(circle at center, ${list})`;
        // stops and angle (degrees, clockwise from left-to-right) for drawn shapes' SVG gradients.
        const angle = (Number(linear?.getAttribute("ang")) || 0) / 60000;
        return { color: stops[0].color, gradient: css, stops, angle, radial: !(linear || !_pptxChild(gradient, "a:path")) };
    }
    const blip = fillHolder.tagName === "a:blipFill" ? fillHolder : _pptxChild(fillHolder, "a:blipFill");
    const blipNode = blip && _pptxFirst(blip, "a:blip");
    const embed = _pptxBlipEmbed(blipNode);
    return embed ? { picture: { part, embed, blip: blipNode } } : null;
}

// The background a slide shows: its own, else its layout's, else its master's (<p:bgPr> or a theme style by <p:bgRef>).
function _pptxDesignBackground(design, slideDoc) {
    const parts = [[slideDoc, design?.slidePath], [design?.layout, design?.layoutPath], [design?.master, design?.masterPath]];
    for (const [doc, part] of parts) {
        const bg = doc && _pptxFirst(_pptxFirst(doc, "p:cSld"), "p:bg");
        if (!bg) continue;
        const bgPr = _pptxChild(bg, "p:bgPr");
        if (bgPr) {
            if (_pptxChild(bgPr, "a:noFill")) return null;
            const found = _pptxFillBackground(bgPr, part, design?.theme?.colors || _pptxCurrentThemeColors);
            if (found) return found;
        }
        const ref = _pptxChild(bg, "p:bgRef");
        if (ref) {
            const index = Number(ref.getAttribute("idx")) || 0;
            const style = index >= 1001 ? design?.theme?.bgFillStyles?.[index - 1001] : null;
            const phColor = _pptxColorValue(ref, design?.theme?.colors || _pptxCurrentThemeColors);
            const found = style ? _pptxFillBackground(style, part, design.theme.colors, phColor) : phColor ? { color: phColor } : null;
            if (found) return found;
        }
    }
    return null;
}

// A picture background's file, uploaded like an inserted picture (a data URL when there is no server).
async function _pptxBackgroundPicture(pkg, picture) {
    const rels = await pkg.rels(picture.part);
    const path = rels[picture.embed]?.path;
    const file = path && pkg.zip.file(path);
    if (!file) return null;
    const extension = path.split(".").pop().toLowerCase();
    let mime = PPTX_PICTURE_TYPES[extension];
    if (!mime) return null;
    let blob = new Blob([await file.async("arraybuffer")], { type: mime });
    if (mime === "image/x-emf" || mime === "image/x-wmf" || mime === "image/tiff") {
        blob = await _pptxBrowserPicture(await blob.arrayBuffer(), mime);
        if (!blob) return null;
        mime = blob.type;
    }
    if (!(await _pptxPictureReadable(blob))) return null;
    // A recoloured background (duotone, greyscale): drawn recoloured, as PowerPoint shows it.
    const effects = _pptxPictureEffects(picture.blip, null, null);
    let name = path.split("/").pop();
    if (/\.(emf|tiff?)$/i.test(name)) name = name.replace(/\.[^.]+$/, PPTX_PICTURE_EXTENSIONS[mime] || ".png");
    if (effects) {
        blob = await _pptxBakePictureEffects(blob, effects);
        if (blob.type === "image/png") name = name.replace(/\.[^.]+$/, ".png");
    }
    try {
        const uploaded = typeof _uploadAssetFile === "function" ? await _uploadAssetFile(new File([blob], name, { type: blob.type || mime })) : null;
        if (uploaded?.url) return uploaded.url;
    } catch (_error) {}
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Words inside a filled shape: in the shape's text colour (its style's fontRef, white in Office's default shape
// style) unless the runs set one, and placed where PowerPoint draws them (anchor: top, middle or bottom). They
// came in top-aligned and dark on an orange shape.
function _pptxPlaceShapeText(sp, text, box, themeColors) {
    // PowerPoint centres the words of a shape when nothing (paragraph, master or presentation text styles) says
    // otherwise.
    if (_pptxUnalignedText.has(text)) text.styles.textAlign = "center";


}

// PowerPoint's entrance effects (presetID) as SlideForge's; anything else fades in. Appear (1) is a very short fade.
const PPTX_ENTRANCES = { 1: ["fade-in", 100], 10: ["fade-in", 0], 2: ["slide-up", 0], 12: ["slide-up", 0], 22: ["wipe-in", 0], 53: ["zoom-in", 0], 23: ["zoom-in", 0], 21: ["wipe-in", 0], 16: ["wipe-in", 0] };
// Fly-in directions (presetSubtype): from the bottom, left, top, right.
const PPTX_FLY_FROM = { 4: "slide-up", 8: "slide-right", 1: "slide-down", 2: "slide-left" };

// The slide's builds (<p:timing>, its main sequence) as SlideForge animations on the elements made from each target:
// one click per PowerPoint click, "with previous" in the same click, "after previous" in it with a delay, effects
// before the first click when the slide opens. Paragraph-by-paragraph builds of a list reveal it bullet by bullet;
// exits fade the element out on their click. Builds were dropped: every object was on the slide from the start.
function _pptxApplyBuilds(doc, byShapeId) {
    const timing = _pptxFirst(doc, "p:timing");
    const mainSeq = timing && Array.from(timing.getElementsByTagName("p:cTn")).find(node => node.getAttribute("nodeType") === "mainSeq");
    if (!mainSeq) return;
    const steps = _pptxChildren(_pptxChild(mainSeq, "p:childTnLst"), "p:par");
    let click = 0;
    const entrances = new Map(); // element -> its first entrance
    const exits = new Map(); // element -> its exit
    const paragraphBuilds = new Map(); // element -> [click of each paragraph]
    steps.forEach(step => {
        const effects = Array.from(step.getElementsByTagName("p:cTn")).filter(node => node.getAttribute("presetClass"));
        if (!effects.length) return;
        const onClick = effects[0].getAttribute("nodeType") === "clickEffect";
        if (onClick) click += 1;
        let elapsed = 0;
        effects.forEach(effect => {
            const nodeType = effect.getAttribute("nodeType");
            const target = _pptxFirst(effect, "p:spTgt");
            const made = target && byShapeId.get(target.getAttribute("spid"));
            const duration = Math.max(...Array.from(effect.getElementsByTagName("p:cTn")).map(node => Number(node.getAttribute("dur")) || 0), 0);
            const delay = Number(_pptxFirst(_pptxChild(effect, "p:stCondLst"), "p:cond")?.getAttribute("delay")) || 0;
            if (nodeType === "afterEffect") elapsed += 1;
            if (!made?.length) return;
            const presetClass = effect.getAttribute("presetClass");
            const clickGroup = `pptx-${click}-${target.getAttribute("spid")}`;
            const timing = { trigger: click ? "on-click" : "on-slide", order: click, delayMs: delay + (nodeType === "afterEffect" ? elapsed * 100 : 0), durationMs: duration };
            const paragraph = _pptxFirst(target, "p:pRg");
            made.forEach(element => {
                if (presetClass === "exit") {
                    if (!exits.has(element)) exits.set(element, { ...timing, clickGroup });
                } else if (presetClass === "entr") {
                    if (paragraph && element.type === "text") {
                        if (!paragraphBuilds.has(element)) paragraphBuilds.set(element, []);
                        paragraphBuilds.get(element).push(timing);
                    }
                    if (!entrances.has(element)) {
                        const id = Number(effect.getAttribute("presetID"));
                        const [mapped, fixed] = PPTX_ENTRANCES[id] || ["fade-in", 0];
                        const effectName = id === 2 ? PPTX_FLY_FROM[Number(effect.getAttribute("presetSubtype"))] || mapped : mapped;
                        entrances.set(element, { ...timing, effect: effectName, durationMs: fixed || Math.max(100, timing.durationMs || 500) });
                    }
                }
            });
        });
    });
    entrances.forEach((entrance, element) => {
        // A list built paragraph by paragraph shows one bullet per click (SlideForge reveals bullets before the other
        // builds of the slide); any other text box appears whole on its first paragraph's click.
        const paragraphs = paragraphBuilds.get(element);
        const steppable = Array.isArray(element.content) || /<p\b/.test(String(element.content || ""));
        if (paragraphs && steppable && paragraphs.length > 1 && entrance.trigger === "on-click") {
            element.revealBullets = true;
            return;
        }
        if (exits.has(element)) return; // both: an advanced timeline below
        element.animation = {
            effect: entrance.effect,
            trigger: entrance.trigger,
            order: entrance.order,
            durationMs: entrance.durationMs,
            delayMs: entrance.delayMs,
            easing: "ease-out",
        };
    });
    exits.forEach((exit, element) => {
        // SlideForge's basic builds are entrances only: an exit is an advanced timeline (fade out on its click),
        // after the element's entrance when it has one.
        const make = (type, overrides) =>
            typeof createAnimation === "function"
                ? createAnimation(type, overrides)
                : { id: generateId("anim"), type, duration: overrides.duration, delay: overrides.delay, trigger: overrides.trigger, easing: "easeOut", keyframes: [], startOpacity: overrides.startOpacity, endOpacity: overrides.endOpacity };
        const entrance = entrances.get(element);
        const animations = [];
        let start = 0;
        if (entrance && !element.revealBullets) {
            animations.push({ ...make("fadeIn", { duration: entrance.durationMs, delay: entrance.delayMs, trigger: entrance.trigger, startOpacity: 0, endOpacity: 1 }), startTime: 0 });
            start = entrance.durationMs + entrance.delayMs;
        }
        const duration = Math.max(100, exit.durationMs || 100);
        // Everything one PowerPoint exit removes (a group's objects) goes on the same click.
        animations.push({ ...make("fadeOut", { duration, delay: exit.delayMs, trigger: exit.trigger, startOpacity: 1, endOpacity: 0 }), startTime: start, clickGroup: exit.clickGroup });
        element.animation = {
            timelines: [{ elementId: element.id, animations, totalDuration: start + duration + exit.delayMs }],
            autoAnimate: false,
            laggedStart: false,
            laggedStartDelay: 50,
        };
    });
}

// PowerPoint's slide transitions as the nearest of SlideForge's (fade, diffuse, slide, convex, concave, zoom): every
// imported slide came in with none. Newer ones (p14:, in mc:AlternateContent) fall back to their older choice.
const PPTX_TRANSITIONS = {
    fade: "fade", flash: "fade", morph: "fade",
    dissolve: "diffuse", randomBar: "diffuse", checker: "diffuse", blinds: "diffuse", comb: "diffuse", strips: "diffuse",
    vortex: "diffuse", shred: "diffuse", honeycomb: "diffuse", glitter: "diffuse", ripple: "diffuse",
    push: "slide", cover: "slide", pull: "slide", wipe: "slide", split: "slide", reveal: "slide", pan: "slide",
    circle: "slide", diamond: "slide", plus: "slide", wedge: "slide", wheel: "slide", wheelReverse: "slide",
    zoom: "zoom", newsflash: "zoom", flythrough: "zoom", warp: "zoom",
    flip: "convex", gallery: "convex", cube: "convex", box: "convex", prism: "convex", conveyor: "convex", ferris: "convex",
    switch: "convex", doors: "concave", window: "concave",
};
function _pptxTransition(doc) {
    for (const transition of Array.from(doc?.getElementsByTagName("p:transition") || [])) {
        for (const effect of Array.from(transition.children)) {
            const name = effect.tagName.replace(/^[\w]+:/, "");
            if (PPTX_TRANSITIONS[name]) return PPTX_TRANSITIONS[name];
        }
    }
    return "none"; // no effect (a transition element can hold only timing or a sound)
}

// A SmartArt diagram's drawing (the shapes PowerPoint last laid it out as, in ppt/diagrams/drawingN.xml), read as
// slide shapes: its tree, relationships and extent (EMU, in the frame's coordinates). Diagrams came in as nothing.
// The drawing is found through the diagram data's dataModelExt, or is the slide's only one.
async function _pptxSmartArtDrawing(pkg, frame, rels) {
    const ids = _pptxFirst(frame, "dgm:relIds");
    const dataPath = rels[ids?.getAttribute("r:dm")]?.path;
    const dataDoc = dataPath && (await pkg.xml(dataPath));
    const extId = dataDoc && _pptxFirst(dataDoc, "dsp:dataModelExt")?.getAttribute("relId");
    const drawings = Object.values(rels).filter(rel => rel.type === "diagramDrawing");
    const path = rels[extId]?.type === "diagramDrawing" ? rels[extId].path : drawings.length === 1 ? drawings[0].path : null;
    const file = path && pkg.zip.file(path);
    if (!file) return null;
    if (!pkg.smartArt) pkg.smartArt = new Map();
    if (!pkg.smartArt.has(path)) {
        // dsp: shapes are p: shapes in another namespace.
        const source = (await file.async("string")).replace(/(<\/?)dsp:/g, "$1p:").replace(/xmlns:dsp=/g, "xmlns:p=");
        const doc = pkg.parser.parseFromString(source, "text/xml");
        const tree = _pptxFirst(doc, "p:spTree");
        if (!tree || doc.getElementsByTagName("parsererror").length) {
            pkg.smartArt.set(path, null);
        } else {
            const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
            // Words drawn in a box of their own (txXfrm), not the shape's (beside a circle, below an icon): a
            // borderless shape of their own on top.
            Array.from(tree.getElementsByTagName("p:sp")).forEach(sp => {
                const txXfrm = _pptxChild(sp, "p:txXfrm");
                const shapeXfrm = _pptxChild(_pptxChild(sp, "p:spPr"), "a:xfrm");
                if (!txXfrm) return;
                txXfrm.remove();
                const txBody = _pptxChild(sp, "p:txBody");
                const same = ["x", "y", "cx", "cy"].every(attr => {
                    const pick = el => _pptxChild(el, "a:off")?.getAttribute(attr) ?? _pptxChild(el, "a:ext")?.getAttribute(attr);
                    return pick(txXfrm) === pick(shapeXfrm);
                });
                if (same || !txBody || !_pptxFirst(txBody, "a:t")) return;
                const words = sp.cloneNode(false);
                Array.from(sp.children).forEach(child => {
                    if (child.tagName !== "p:spPr") words.appendChild(child.cloneNode(true));
                });
                const spPr = doc.createElementNS(sp.namespaceURI, "p:spPr");
                const box = doc.createElementNS(ns, "a:xfrm");
                if (txXfrm.getAttribute("rot")) box.setAttribute("rot", txXfrm.getAttribute("rot"));
                Array.from(txXfrm.children).forEach(child => box.appendChild(child.cloneNode(true)));
                const geom = doc.createElementNS(ns, "a:prstGeom");
                geom.setAttribute("prst", "rect");
                const line = doc.createElementNS(ns, "a:ln");
                [box, geom, doc.createElementNS(ns, "a:noFill"), line].forEach(child => spPr.appendChild(child));
                line.appendChild(doc.createElementNS(ns, "a:noFill"));
                words.insertBefore(spPr, words.firstChild);
                txBody.remove();
                sp.after(words);
            });
            // Its extent: the drawing's group box, or the union of its shapes.
            const group = _pptxXfrm(tree);
            let bounds = group && group.w && group.h ? { x: group.x, y: group.y, w: group.w, h: group.h } : null;
            if (!bounds) {
                const boxes = Array.from(tree.children).map(_pptxXfrm).filter(Boolean);
                if (boxes.length) {
                    const x = Math.min(...boxes.map(b => b.x));
                    const y = Math.min(...boxes.map(b => b.y));
                    bounds = { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
                }
            }
            pkg.smartArt.set(path, { tree, rels: await pkg.rels(path), bounds: bounds || { x: 0, y: 0, w: 0, h: 0 } });
        }
    }
    return pkg.smartArt.get(path);
}

async function _pptxSlideElements(pkg, slidePath, scale, design = null) {
    const doc = await pkg.xml(slidePath);
    const rels = await pkg.rels(slidePath);
    const links = await pkg.links(slidePath);
    const layoutXfrm = await _pptxLayoutPlaceholders(pkg, slidePath);
    const elements = [];
    // The part being walked: the slide, or its master or layout (their artwork, behind the slide's own objects).
    let part = { rels, links, inherited: false };
    // Which elements each PowerPoint shape id became (a group's id stands for everything in it): builds target ids.
    const byShapeId = new Map();
    const owners = [];
    const groupLinks = []; // the click actions of the groups being walked (a group's action is its contents')
    const register = (node, ...made) => {
        // A glow round a shape or picture (<a:effectLst><a:glow>): a soft halo in its colour. Labels framed in a
        // blue glow came in without it. Words with no box of their own keep none (PowerPoint lights their letters).
        const glow = _pptxShapeGlow(node, scale);
        if (glow) {
            const target = made.find(el => el && (el.type !== "text" || (el.styles?.backgroundColor && el.styles.backgroundColor !== "transparent")));
            if (target) target.styles = { ...target.styles, boxShadow: glow };
        }
        // A click action on the shape, picture or group itself (Insert > Action: "go to the next slide", a link
        // to a slide or a web page): on everything made from it, followed while presenting. Only the links on its
        // words came in.
        const clickLink = _pptxClickLink(_pptxChild(_pptxFirst(node, "p:cNvPr"), "a:hlinkClick"), part.links) || groupLinks.at(-1) || null;
        if (clickLink) made.forEach(el => el && !el.clickLink && (el.clickLink = clickLink));
        // The builds are the slide's; a layout's or a SmartArt drawing's shape ids can repeat the slide's.
        if (part.inherited || part.quiet) return;
        const id = _pptxFirst(node, "p:cNvPr")?.getAttribute("id");
        [id, ...owners].filter(Boolean).forEach(key => {
            if (!byShapeId.has(key)) byShapeId.set(key, []);
            byShapeId.get(key).push(...made);
        });
    };
    // EMU in the coordinates of `transform` -> slide pixels
    const rawBox = (xfrm, t) => ({
        x: Math.round(((t.ox + (xfrm.x - t.cx) * t.sx) / PPTX_EMU_PER_PX) * scale),
        y: Math.round(((t.oy + (xfrm.y - t.cy) * t.sy) / PPTX_EMU_PER_PX) * scale),
        w: Math.round(((xfrm.w * t.sx) / PPTX_EMU_PER_PX) * scale),
        h: Math.round(((xfrm.h * t.sy) / PPTX_EMU_PER_PX) * scale),
        rot: xfrm.rot || 0,
        flipH: !!xfrm.flipH,
        flipV: !!xfrm.flipV,
    });
    // A rotated group turns everything in it about its centre: each child's centre moves and its rotation adds up
    // (innermost group first). Their contents came in unturned.
    const toBox = (xfrm, t) => {
        const box = rawBox(xfrm, t);
        (t.turns || []).forEach(turn => {
            if (turn.mirror) {
                // A flipped group mirrors its contents about its centre: each child's place, its own flip and the
                // direction of its turn. Mirrored groups came in unmirrored.
                if (turn.flipH) {
                    box.x = Math.round(2 * turn.cx - box.x - box.w);
                    box.flipH = !box.flipH;
                    box.rot = (360 - box.rot) % 360;
                }
                if (turn.flipV) {
                    box.y = Math.round(2 * turn.cy - box.y - box.h);
                    box.flipV = !box.flipV;
                    box.rot = (360 - box.rot) % 360;
                }
                return;
            }
            const angle = (turn.deg * Math.PI) / 180;
            const cx = box.x + box.w / 2 - turn.cx;
            const cy = box.y + box.h / 2 - turn.cy;
            box.x = Math.round(turn.cx + cx * Math.cos(angle) - cy * Math.sin(angle) - box.w / 2);
            box.y = Math.round(turn.cy + cx * Math.sin(angle) + cy * Math.cos(angle) - box.h / 2);
            box.rot = (((box.rot + turn.deg) % 360) + 360) % 360;
        });
        return box;
    };
    const walk = async (container, t) => {
        for (let node of Array.from(container.children)) {
            const zIndex = elements.length + 1;
            // "Fill like my group" (<a:grpFill/>): the group's fill in its place. Two arrows drawn in a brown group came
            // in orange (their style's colour).
            if ((node.tagName === "p:sp" || node.tagName === "p:cxnSp") && t.groupFill && _pptxChild(_pptxChild(node, "p:spPr"), "a:grpFill")) {
                node = node.cloneNode(true);
                const spPr = _pptxChild(node, "p:spPr");
                const own = _pptxChild(spPr, "a:grpFill");
                spPr.replaceChild(t.groupFill.cloneNode(true), own);
            }
            // Hidden in PowerPoint (the selection pane's eye): not shown there, so not brought in.
            if (node.tagName !== "mc:AlternateContent" && _pptxFirst(node, "p:cNvPr")?.getAttribute("hidden") === "1") continue;
            // A master's or layout's placeholders are templates ("Click to edit Master title style"), not artwork.
            if (part.inherited && ["p:sp", "p:pic", "p:graphicFrame"].includes(node.tagName) && _pptxFirst(_pptxChild(node, node.tagName === "p:sp" ? "p:nvSpPr" : node.tagName === "p:pic" ? "p:nvPicPr" : "p:nvGraphicFramePr"), "p:ph")) continue;
            if (node.tagName === "mc:AlternateContent") {
                // Content for newer PowerPoint (an equation, an ink drawing) and the picture of it older readers show.
                const fallback = _pptxChild(node, "mc:Fallback");
                if (fallback) await walk(fallback, t);
            } else if (node.tagName === "p:grpSp") {
                const g = _pptxXfrm(node);
                if (!g) continue;
                const sx = g.chW ? (g.w / g.chW) * t.sx : t.sx;
                const sy = g.chH ? (g.h / g.chH) * t.sy : t.sy;
                const frame = rawBox(g, t);
                // The group's own mirror first, then its turn, then the groups around it (DrawingML flips before it rotates).
                const centre = { cx: frame.x + frame.w / 2, cy: frame.y + frame.h / 2 };
                const turns = [
                    ...(g.flipH || g.flipV ? [{ mirror: true, flipH: !!g.flipH, flipV: !!g.flipV, ...centre }] : []),
                    ...(g.rot ? [{ deg: g.rot, ...centre }] : []),
                    ...(t.turns || []),
                ];
                const id = _pptxFirst(node, "p:cNvPr")?.getAttribute("id");
                if (id) owners.push(id);
                groupLinks.push(_pptxClickLink(_pptxChild(_pptxFirst(node, "p:cNvPr"), "a:hlinkClick"), part.links) || groupLinks.at(-1) || null);
                // The group's own fill, for children that fill like their group (a group that does so itself passes on its own group's).
                const groupSpPr = _pptxChild(node, "p:grpSpPr");
                // A group filled with a picture (a texture tiled across the whole group) is left out: PowerPoint shows each
                // child its own part of that one picture, and stretching the whole picture into each child drew a
                // poster's small blue box as a block over its neighbours.
                const ownGroupFill = ["a:solidFill", "a:gradFill", "a:noFill", "a:pattFill", "a:blipFill"].map(tag => _pptxChild(groupSpPr, tag)).find(Boolean);
                const groupFill = ownGroupFill ? (ownGroupFill.tagName === "a:blipFill" ? null : ownGroupFill) : t.groupFill || null;
                await walk(node, { sx, sy, cx: g.chX, cy: g.chY, ox: t.ox + (g.x - t.cx) * t.sx, oy: t.oy + (g.y - t.cy) * t.sy, turns, fs: t.fs, groupFill });
                groupLinks.pop();
                if (id) owners.pop();
            } else if (node.tagName === "p:cxnSp" || (node.tagName === "p:sp" && _pptxIsLine(node) && !_pptxFirst(node, "a:t"))) {
                const xfrm = _pptxXfrm(node);
                const box = xfrm && toBox(xfrm, t);
                // A connector in a turned group (or turned itself) is drawn as a picture, which can turn.
                const curved = /^curvedConnector/.test(_pptxChild(_pptxChild(node, "p:spPr"), "a:prstGeom")?.getAttribute("prst") || "");
                const connector = box && (box.rot || curved ? _pptxDrawingElement(node, box, scale, zIndex) || _pptxConnectorElement(node, box, scale, zIndex) : _pptxConnectorElement(node, box, scale, zIndex));
                if (connector) {
                    elements.push(connector);
                    register(node, connector);
                }
            } else if (node.tagName === "p:sp") {
                const placeholder = _pptxPlaceholder(node);
                if (placeholder && ["sldNum", "dt", "ftr"].includes(placeholder.type) && !_pptxFirst(node, "a:t")) continue;
                const xfrm = _pptxXfrm(node) || layoutXfrm(placeholder);
                if (!xfrm) continue;
                const box = toBox(xfrm, t);
                const text = _pptxTextElement(node, box, { fontScale: scale * (t.fs || 1), placeholder, zIndex, links: part.links, design });
                const spPr = _pptxChild(node, "p:spPr");
                // Pictures can be stored as shape fills rather than p:pic (slide 34 of PreSynopsis).
                const pictureFill = _pptxChild(spPr, "a:blipFill");
                if (pictureFill) {
                    // A text box filled with a picture: PowerPoint's stand-in for an equation, the picture sized to the
                    // equation by its fill rectangle (<a:fillRect r="-4700"/>: 4.7% wider than the box). The equation
                    // itself overflows its box, never cut; the picture was clipped to the box and lost "→ N)".
                    let fillBox = box;
                    let fillUsed = pictureFill;
                    const fillRect = _pptxFirst(_pptxChild(pictureFill, "a:stretch"), "a:fillRect");
                    if (fillRect && _pptxFirst(node, "p:cNvSpPr")?.getAttribute("txBox") === "1") {
                        const inset = side => (Number(fillRect.getAttribute(side)) || 0) / 100000;
                        const [l, t, r, b] = ["l", "t", "r", "b"].map(inset);
                        if ((l || t || r || b) && l + r < 0.9 && t + b < 0.9) {
                            fillBox = { ...box, x: Math.round(box.x + box.w * l), y: Math.round(box.y + box.h * t), w: Math.max(1, Math.round(box.w * (1 - l - r))), h: Math.max(1, Math.round(box.h * (1 - t - b))) };
                            // The box is the fill rectangle now: the picture fills it (no zoom from the insets).
                            fillUsed = pictureFill.cloneNode(true);
                            ["l", "t", "r", "b"].forEach(side => _pptxFirst(_pptxChild(fillUsed, "a:stretch"), "a:fillRect")?.removeAttribute(side));
                        }
                    }
                    const picture = await _pptxPictureElement(pkg, node, part.rels, fillBox, zIndex, fillUsed);
                    if (picture) {
                        const made = [picture, text].filter(Boolean);
                        if (text) text.styles.zIndex = zIndex + 1;
                        elements.push(...made);
                        register(node, ...made);
                        continue;
                    }
                }
                const drawn = _pptxChild(spPr, "a:custGeom") || _pptxDrawsPreset(spPr, box);
                if (drawn) {
                    // A freeform or an arc: its picture, then its words on top.
                    const drawing = _pptxDrawingElement(node, box, scale, zIndex);
                    if (text) {
                        delete text.styles.backgroundColor;
                        text.styles.zIndex = zIndex + 1;
                    }
                    const made = [drawing, text].filter(Boolean);
                    elements.push(...made);
                    if (made.length) register(node, ...made);
                    continue;
                }
                let shape = text && !_pptxChild(spPr, "a:prstGeom") ? null : _pptxShapeElement(node, box, zIndex);
                // An empty placeholder whose layout or master fills it (a blank title bar): the bar, without words.
                if (!text && !shape && placeholder && design && !_pptxChild(spPr, "a:prstGeom")) {
                    const look = _pptxPlaceholderLook(design, placeholder, node);
                    if (look.fill || look.line) {
                        shape = {
                            id: generateId("el"),
                            type: "shape",
                            shapeType: "rectangle",
                            x: box.x,
                            y: box.y,
                            width: `${Math.max(2, box.w)}px`,
                            height: `${Math.max(2, box.h)}px`,
                            content: "",
                            ...(box.rot ? { rotation: box.rot } : {}),
                            styles: {
                                backgroundColor: look.fill || "transparent",
                                ...(look.gradient ? { background: look.gradient } : {}),
                                borderRadius: look.rounded ? `${Math.round(Math.min(box.w, box.h) * 0.1)}px` : "0px",
                                ...(look.line ? { borderColor: look.line, borderWidth: `${Math.max(1, Math.round((look.lineWidth / 12700) * (96 / 72) * scale))}px`, borderStyle: "solid" } : {}),
                                zIndex,
                            },
                        };
                    }
                }
                // A placeholder's own outline and fill (its shape is the layout's rectangle, so it makes no shape of its
                // own): on the text box. A title framed in a blue line came in without the frame.
                if (text && !_pptxChild(spPr, "a:prstGeom")) {
                    // A placeholder with no fill or outline of its own takes its layout's or master's.
                    const look = placeholder && design ? _pptxPlaceholderLook(design, placeholder, node) : null;
                    const ln = _pptxChild(spPr, "a:ln");
                    const lnColor = (ln && !_pptxChild(ln, "a:noFill") ? _pptxColor(ln) : null) || look?.line || null;
                    if (lnColor) {
                        text.styles.borderColor = lnColor;
                        text.styles.borderStyle = "solid";
                        text.styles.borderWidth = `${Math.max(1, Math.round(((Number(ln?.getAttribute("w")) || look?.lineWidth || 12700) / 12700) * (96 / 72) * scale))}px`;
                    }
                    const ownFill = _pptxChild(spPr, "a:noFill") ? null : _pptxColor(spPr) || look?.fill || null;
                    if (ownFill) text.styles.backgroundColor = ownFill;
                    if (look?.gradient && !_pptxColor(spPr)) text.styles.background = look.gradient;
                    if (look?.rounded && (ownFill || lnColor)) text.styles.borderRadius = `${Math.round(Math.min(box.w, box.h) * 0.1)}px`;
                }
                // A text box stays a text box, its fill and outline on the box itself: as a shape with words in it,
                // its text had a shape's wider margins and wrapped onto a line more (a title lost its last words).
                if (text && shape && _pptxFirst(node, "p:cNvSpPr")?.getAttribute("txBox") === "1") {
                    const keep = ["backgroundColor", "background", "borderColor", "borderWidth", "borderStyle"];
                    keep.forEach(name => {
                        if (shape.styles[name] && shape.styles[name] !== "transparent") text.styles[name] = shape.styles[name];
                    });
                    elements.push(text);
                    register(node, text);
                    continue;
                }
                // A filled shape with words in it: the shape, then its text on top (text boxes have no outline).
                if (shape && text) {
                    delete text.styles.backgroundColor;
                    text.styles.zIndex = zIndex + 1;
                    // PowerPoint centres the words of a shape unless the paragraph says otherwise.

                    _pptxPlaceShapeText(node, text, box, pkg.themeColors);
                    if (typeof text.content === "string" && !/<(?:a|span|p|sub|sup)\b/i.test(text.content) && !text.styles.textShadow) {
                        // Plain words go into the shape itself, so they move and resize with it; a bulleted list
                        // stays a text box on top (shape text has no bullets).
                        const anchor = _pptxChild(_pptxChild(node, "p:txBody"), "a:bodyPr")?.getAttribute("anchor") || "t";
                        const inertDoc = document.implementation.createHTMLDocument("");
                        const scratch = inertDoc.createElement("div");
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
                        register(node, shape);
                    } else {
                        elements.push(shape, text);
                        register(node, shape, text);
                    }
                } else if (text) {
                    elements.push(text);
                    register(node, text);
                } else if (shape) {
                    elements.push(shape);
                    register(node, shape);
                }
            } else if (node.tagName === "p:pic") {
                const xfrm = _pptxXfrm(node);
                // A sound stored in the file plays here (an audio element); others keep their speaker picture.
                const audio = xfrm && (await _pptxAudioElement(pkg, node, part.rels, toBox(xfrm, t), zIndex, doc));
                if (audio) {
                    elements.push(audio);
                    register(node, audio);
                    continue;
                }
                // A movie stored in the file plays here; a linked one (outside the file) keeps its poster picture.
                const video = xfrm && (await _pptxVideoElement(pkg, node, part.rels, toBox(xfrm, t), zIndex));
                if (video) {
                    elements.push(video);
                    register(node, video);
                    continue;
                }
                const picture = xfrm && (await _pptxPictureElement(pkg, node, part.rels, toBox(xfrm, t), zIndex));
                if (picture) {
                    elements.push(picture);
                    register(node, picture);
                }
            } else if (node.tagName === "p:graphicFrame") {
                const xfrm = _pptxXfrm(node);
                if (!xfrm) continue;
                const smartArt = _pptxFirst(node, "dgm:relIds") && (await _pptxSmartArtDrawing(pkg, node, part.rels));
                if (smartArt) {
                    // SmartArt: the shapes PowerPoint last drew it with, fitted into its frame (a stale drawing can
                    // be larger than the frame it was resized into), as one build target.
                    const { tree, rels: drawingRels, bounds } = smartArt;
                    const k = bounds.w && bounds.h ? Math.min(1, xfrm.w / bounds.w, xfrm.h / bounds.h) : 1;
                    const cx = k < 1 ? bounds.x : 0;
                    const cy = k < 1 ? bounds.y : 0;
                    const dx = k < 1 ? (xfrm.w - bounds.w * k) / 2 : 0;
                    const dy = k < 1 ? (xfrm.h - bounds.h * k) / 2 : 0;
                    const turns = xfrm.rot ? [{ deg: xfrm.rot, ...(f => ({ cx: f.x + f.w / 2, cy: f.y + f.h / 2 }))(rawBox(xfrm, t)) }, ...(t.turns || [])] : t.turns || [];
                    const saved = part;
                    const before = elements.length;
                    part = { ...saved, rels: drawingRels, quiet: true };
                    await walk(tree, { sx: t.sx * k, sy: t.sy * k, cx, cy, ox: t.ox + (xfrm.x + dx - t.cx) * t.sx, oy: t.oy + (xfrm.y + dy - t.cy) * t.sy, turns, fs: (t.fs || 1) * k });
                    part = saved;
                    if (elements.length > before) register(node, ...elements.slice(before));
                    continue;
                }
                // An embedded object (a ChemDraw drawing, an Origin graph, a MathType equation): the picture PowerPoint
                // shows of it, in its frame. These came in as nothing.
                if (/\/ole$/.test(_pptxFirst(node, "a:graphicData")?.getAttribute("uri") || "")) {
                    const preview = _pptxFirst(node, "p:pic");
                    if (preview) {
                        const before = elements.length;
                        await walk({ children: [preview] }, t);
                        // Builds name the frame; its picture usually has the same id and is registered already.
                        const frameId = _pptxFirst(node, "p:cNvPr")?.getAttribute("id");
                        if (elements.length > before && frameId !== _pptxFirst(preview, "p:cNvPr")?.getAttribute("id")) register(node, ...elements.slice(before));
                    }
                    continue;
                }
                const box = toBox(xfrm, t);
                const tbl = _pptxFirst(node, "a:tbl");
                const made = tbl ? _pptxTableElement(tbl, box, scale, scale, zIndex, await pkg.xml("ppt/tableStyles.xml"), design?.theme?.colors || _pptxCurrentThemeColors, part.links) : await _pptxChartElement(pkg, node, part.rels, box, zIndex);
                // Table text without a font of its own in the theme's body font (it came in as Manrope).
                const bodyFont = tbl && design?.theme?.fonts?.minor;
                if (made && bodyFont && /Manrope/.test(made.tableData.fontFamily)) {
                    const family = _pptxFontStack(bodyFont);
                    made.styles.fontFamily = family;
                    made.tableData.fontFamily = family;
                }
                if (made) {
                    elements.push(made);
                    register(node, made);
                }
            }
        }
    };
    // The master's and the layout's own artwork (logos, bars, rules, footer text), behind the slide's objects: none
    // of it came in. "Hide background graphics" (showMasterSp="0") on the slide hides both; on the layout, the
    // master's. Locked, as on a PowerPoint slide, where it cannot be selected.
    // Read once per master or layout for the whole import, then copied onto each slide that uses it; runs of drawn
    // shapes become one picture (a template's doodles were 350 objects on every slide, 21,000 in a deck, and the
    // editor ran out of memory drawing them). Not clickable, like a PowerPoint slide's background graphics.
    if (design) {
        const showLayout = doc?.documentElement?.getAttribute("showMasterSp") !== "0";
        const showMaster = showLayout && design.layout?.documentElement?.getAttribute("showMasterSp") !== "0";
        if (!pkg.inheritedArt) pkg.inheritedArt = new Map();
        for (const [show, partPath, partDoc, from] of [
            [showMaster, design.masterPath, design.master, "master"],
            [showLayout, design.layoutPath, design.layout, "layout"],
        ]) {
            const partTree = show && partDoc && _pptxFirst(partDoc, "p:spTree");
            if (!partTree) continue;
            const key = `${partPath}@${scale}`;
            if (!pkg.inheritedArt.has(key)) {
                part = { rels: await pkg.rels(partPath), links: await pkg.links(partPath), inherited: true };
                const before = elements.length;
                await walk(partTree, { sx: 1, sy: 1, cx: 0, cy: 0, ox: 0, oy: 0 });
                part = { rels, links, inherited: false };
                const made = elements.splice(before);
                pkg.inheritedArt.set(key, await _pptxFlattenDrawings(made, await _pptxPageSize(pkg, scale)));
            }
            pkg.inheritedArt.get(key).forEach(template => {
                const element = JSON.parse(JSON.stringify(template));
                element.id = generateId("el");
                element.locked = true;
                element.backgroundRole = "preset";
                element.importedFrom = from;
                element.styles = { ...(element.styles || {}), zIndex: elements.length + 1 };
                elements.push(element);
            });
        }
        part = { rels, links, inherited: false };
    }
    const tree = _pptxFirst(doc, "p:spTree");
    if (tree) await walk(tree, { sx: 1, sy: 1, cx: 0, cy: 0, ox: 0, oy: 0 });
    _pptxApplyBuilds(doc, byShapeId);
    // A vector figure pasted as freeforms (a plot of thousands of segments) becomes one picture: 5,886 objects on one
    // slide, ~20,000 in a deck, and the editor ran out of memory drawing them. Runs under 25 stay editable drawings.
    const kept = await _pptxFlattenDrawings(elements, await _pptxPageSize(pkg, scale), { minRun: 25, region: "bounds" });
    return {
        elements: kept,
        notes: await _pptxSlideNotes(pkg, rels),
        background: design ? _pptxDesignBackground(design, doc) : _pptxFillBackground(_pptxFirst(_pptxFirst(doc, "p:bg"), "p:bgPr"), slidePath, _pptxCurrentThemeColors),
    };
}

async function importPptx(file) {
    if (!window.JSZip) {
        alert("Cannot import PPTX because JSZip is missing.");
        return;
    }
    const busy = sfBusyStart({ title: `Importing ${file.name || "PowerPoint file"}`, detail: "Reading the file…", progress: 0, delay: 0 });
    try {
        setProjectSaveHint?.("Reading PowerPoint file…", "muted");
        const pkg = new PptxPackage(await JSZip.loadAsync(file));
        const presentation = await pkg.xml("ppt/presentation.xml");
        if (!presentation) throw new Error("This does not look like a PowerPoint file");
        pkg.themeColors = await _pptxThemeColors(pkg);
        _pptxCurrentThemeColors = pkg.themeColors || {};
        _pptxCurrentFillStyles = [];
        _pptxCurrentLineStyles = [];

        // The page setup closest to the deck's proportions; everything is scaled by one factor so nothing is squashed.
        const size = _pptxFirst(presentation, "p:sldSz");
        const sourceW = (Number(size?.getAttribute("cx")) || 9144000) / PPTX_EMU_PER_PX;
        const sourceH = (Number(size?.getAttribute("cy")) || 6858000) / PPTX_EMU_PER_PX;
        // Portrait decks (A0 posters, handouts) take a portrait page: fitted into 4:3 they came in a third of the size.
        // Ratios are compared on a log scale, so a tall page is as near as a wide one of the same proportion.
        const setups = Object.values(window.PRESENTATION_PAGE_SETUPS || {}).filter(setup => ["standard-4-3", "talk-16-9", "lecture-16-10", "poster-portrait", "paper-letter"].includes(setup.id));
        const misfit = setup => Math.abs(Math.log(setup.width / setup.height / (sourceW / sourceH)));
        const setup = setups.sort((a, b) => misfit(a) - misfit(b))[0] || { id: "standard-4-3", width: 1024, height: 768 };
        const scale = Math.min(setup.width / sourceW, setup.height / sourceH);

        const rels = await pkg.rels("ppt/presentation.xml");
        const slidePaths = Array.from(_pptxFirst(presentation, "p:sldIdLst")?.getElementsByTagName("p:sldId") || [])
            .map(node => rels[node.getAttribute("r:id")]?.path)
            .filter(Boolean);
        if (!slidePaths.length) throw new Error("No slides found in this file");
        // Every slide's id before any is read, so a link on one slide to another can name it (PptxPackage.links).
        pkg.slideIds = new Map(slidePaths.map(path => [path, generateId("slide")]));

        // Into a project of its own, named after the file (never over the project that is open). Created before the
        // slides are read, so the pictures they upload belong to it.
        const importTitle =
            typeof uniqueImportTitle === "function"
                ? await uniqueImportTitle(String(file.name || "Imported presentation").replace(/\.pptx$/i, ""))
                : String(file.name || "Imported presentation").replace(/\.pptx$/i, "");
        busy.update({ detail: "Saving the open project…", progress: 0.03 });
        if (typeof startNewProjectForImport === "function") await startNewProjectForImport();

        // The slides take nearly all the time: 5% to 95% of the bar, one step per slide.
        const slides = [];
        for (const [index, slidePath] of slidePaths.entries()) {
            setProjectSaveHint?.(`Importing slide ${index + 1} of ${slidePaths.length}…`, "muted");
            busy.update({ detail: `Slide ${index + 1} of ${slidePaths.length}`, progress: 0.05 + (0.9 * index) / slidePaths.length });
            await sfBusyYield();
            const design = await _pptxSlideDesign(pkg, slidePath);
            _pptxCurrentThemeColors = design.theme.colors;
            _pptxCurrentFillStyles = design.theme.fillStyles || [];
            _pptxCurrentLineStyles = design.theme.lineStyles || [];
            pkg.themeColors = design.theme.colors;
            const { elements, notes, background } = await _pptxSlideElements(pkg, slidePath, scale, design);
            let slideBackground = null;
            if (background?.picture) {
                // A picture background stays the slide's background (cover).
                const url = await _pptxBackgroundPicture(pkg, background.picture);
                if (url) slideBackground = { type: "image", content: url, fit: "cover" };
            } else if (background?.color) {
                // A colour or gradient background comes in as a rectangle behind everything.
                elements.unshift({
                    id: generateId("el"),
                    type: "shape",
                    shapeType: "rectangle",
                    x: 0,
                    y: 0,
                    width: `${setup.width}px`,
                    height: `${setup.height}px`,
                    content: "",
                    importedBackground: true,
                    styles: {
                        backgroundColor: background.color,
                        ...(background.gradient ? { background: background.gradient } : {}),
                        borderRadius: "0px",
                        zIndex: 0,
                    },
                });
            }
            // Hidden in PowerPoint (<p:sld show="0">): hidden when presenting here too.
            const slideDoc = await pkg.xml(slidePath);
            const hidden = slideDoc?.documentElement?.getAttribute("show") === "0";
            slides.push({
                id: pkg.slideIds.get(slidePath) || generateId("slide"),
                layoutId: "blank",
                masterId: "none",
                notes,
                presentationTransition: _pptxTransition(slideDoc),
                ...(slideBackground ? { background: slideBackground } : {}),
                ...(hidden ? { hidden: true } : {}),
                elements,
            });
        }

        // The fonts the file carries (saved with "Embed fonts"): added to this user's fonts, so its text is drawn in
        // them here too. Only families this computer lacks (an embedded font can hold just the characters the deck uses).
        const embedded = await _pptxEmbeddedFonts(pkg);
        if (embedded.length && typeof window.sfUploadFontFile === "function") {
            busy.update({ detail: "Adding the fonts it carries…", progress: 0.95 });
            await sfBusyPaint();
            await _pptxInstallEmbeddedFonts(embedded);
        }

        busy.update({ detail: "Drawing the slides…", progress: 0.96 });
        await sfBusyPaint();
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
        const hiddenSlides = slides.filter(slide => slide.hidden).length;
        const summary = [`${slides.length} slides`, count("image") && `${count("image")} pictures`, count("table") && `${count("table")} tables`, count("chart") && `${count("chart")} charts`, hiddenSlides && `${hiddenSlides} hidden when presenting`].filter(Boolean).join(", ");
        setProjectSaveHint?.(`Imported ${summary}`, "success");
        busy.update({ detail: `Imported ${summary}`, progress: 1 });
        schedulePresentationAutosave?.();
        // Fonts the deck uses that this computer lacks: offered for download from Google Fonts (js/ui/fonts.js).
        setTimeout(() => window.sfOfferMissingFonts?.({ auto: true }), 800);
    } catch (err) {
        console.error("PPTX Import Error:", err);
        busy.done(); // gone before the alert, which blocks the page
        alert("Failed to import PPTX: " + err.message);
        setProjectSaveHint?.("Import failed", "danger");
    } finally {
        busy.done();
    }
}
