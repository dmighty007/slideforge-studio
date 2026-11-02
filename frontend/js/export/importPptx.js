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

// One paragraph as HTML plus what it says about the whole box (size, colour, font, alignment, bullet).
function _pptxParagraph(p, fontScale, links = {}) {
    const pPr = _pptxChild(p, "a:pPr");
    const level = Number(pPr?.getAttribute("lvl")) || 0;
    const numbered = !!(pPr && _pptxChild(pPr, "a:buAutoNum"));
    const bullet = pPr && _pptxChild(pPr, "a:buNone") ? false : pPr && (_pptxChild(pPr, "a:buChar") || numbered) ? true : null;
    const align = { ctr: "center", r: "right", just: "justify", l: "left" }[pPr?.getAttribute("algn")] || null;
    // The bullet's own character ("Ø" in Wingdings is an arrowhead), for boxes that mix bulleted and plain paragraphs.
    const buChar = pPr && _pptxChild(pPr, "a:buChar");
    const glyph = buChar ? _pptxBulletGlyph(buChar.getAttribute("char"), _pptxChild(pPr, "a:buFont")?.getAttribute("typeface")) : numbered ? "1." : "•";
    // Line spacing: a percentage of single spacing (PowerPoint's single line is about 1.2 times the font size).
    const lnPct = Number(_pptxChild(_pptxChild(pPr, "a:lnSpc"), "a:spcPct")?.getAttribute("val"));
    let lineHeight = lnPct > 0 ? Math.round(1.2 * (lnPct / 100000) * 100) / 100 : null;
    // Or exactly so many points from line to line (spcPts): a title's 78.4 pt lines for 80 pt text came in 1.2 apart,
    // and the second line sat a quarter of a line too low. As a multiple of the paragraph's largest text, below.
    const lnPts = Number(_pptxChild(_pptxChild(pPr, "a:lnSpc"), "a:spcPts")?.getAttribute("val"));
    // The size an empty paragraph (a blank line) has: its end mark's, not the box's.
    const endSize = Number(_pptxChild(p, "a:endParaRPr")?.getAttribute("sz"));
    // Space before and after the paragraph, in points (spcPts is in hundredths of a point).
    const spacing = name => (Number(_pptxChild(_pptxChild(pPr, name), "a:spcPts")?.getAttribute("val")) || 0) / 100;
    const spaceAround = spacing("a:spcBef") + spacing("a:spcAft");
    const runs = [];
    Array.from(p.children).forEach(node => {
        if (node.tagName === "a:br") runs.push({ br: true });
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
        runs.push({
            text: _pptxFirst(node, "a:t")?.textContent || "",
            size: size ? _pptxPx((size / 100) * (96 / 72) * fontScale) : null,
            // Superscript and subscript (baseline="30000" / "-25000"): chemical formulas and units lost them.
            baseline: Number(rPr?.getAttribute("baseline")) || 0,
            shadow: _pptxTextShadow(_pptxChild(_pptxChild(rPr, "a:effectLst"), "a:outerShdw"), fontScale),
            bold: rPr?.getAttribute("b") === "1",
            italic: rPr?.getAttribute("i") === "1",
            underline: !!rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none",
            caps: rPr?.getAttribute("cap") === "all",
            color: _pptxColor(rPr),
            font: _pptxChild(rPr, "a:latin")?.getAttribute("typeface") || null,
            // Letter spacing (spc, in hundredths of a point; negative tightens): titles set tight came in loose.
            spacing: rPr?.hasAttribute("spc") ? Math.round((Number(rPr.getAttribute("spc")) / 100) * (96 / 72) * fontScale * 100) / 100 : null,
            // A linked run (a:hlinkClick) keeps its web address; it came in as plain text.
            link: links[_pptxChild(rPr, "a:hlinkClick")?.getAttribute("r:id")] || null,
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
        spaceAroundPx: spaceAround * (96 / 72) * fontScale,
        endSize: endSize ? _pptxPx((endSize / 100) * (96 / 72) * fontScale) : null,
    };
}

// Bullet characters of symbol fonts (Wingdings, Symbol) as the Unicode characters they show.
const PPTX_SYMBOL_BULLETS = { "Ø": "➢", "§": "▪", "ü": "✓", "þ": "☑", "q": "❑", "o": "□", "p": "□", "r": "❒", "u": "◆", "w": "⬥", "v": "❖", "n": "■", "l": "●", "m": "○", "ð": "⇨", "à": "➔", "è": "➔", "Ü": "➤", "·": "•", "-": "–" };

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
            if (run.br) return "<br>";
            const styles = [];
            if (run.size && run.size !== box.size) styles.push(`font-size: ${run.size}px`);
            if (run.font && run.font !== box.font && !run.font.startsWith("+")) styles.push(`font-family: ${_pptxEscape(_pptxFontStack(run.font))}`);
            if (run.color && run.color !== box.color) styles.push(`color: ${run.color}`);
            if (run.bold !== box.bold) styles.push(`font-weight: ${run.bold ? 700 : 400}`);
            if (run.italic) styles.push("font-style: italic");
            if (run.underline) styles.push("text-decoration: underline");
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
        return _pptxParagraph(copy, fontScale * textScale, links);
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
    const style = {
        size: pick("size") || inheritedSize || (isTitle ? 40 : placeholder ? 24 : 18),
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
    const preciseParagraphs = paragraphs.some(p => p.marginLeft !== null || p.indent !== null || p.align || p.spaceAroundPx || (p.bullet && p.glyph !== "•"));

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
        let ordinal = 0;
        content = paragraphs.map(p => {
            // An empty paragraph has no bullet in PowerPoint (a blank line between two bullets showed a third).
            const bulleted = p.length > 0 && (p.bullet === true || (p.bullet === null && bodyPlaceholder));
            const margin = p.marginLeft ?? (bulleted ? 24 * fontScale : 0);
            const indent = p.indent ?? (bulleted ? -18 * fontScale : 0);
            const marker = bulleted ? `${_pptxEscape(p.numbered ? `${++ordinal}.` : p.glyph)}&#160;` : "";
            const css = `margin:0;margin-left:${margin}px;text-indent:${indent}px;margin-top:${p.spaceBefore}px;margin-bottom:${p.spaceAfter}px;line-height:${p.lineHeight || 1.2};text-align:${p.align || align}`;
            return `<p style="${css}">${marker}${_pptxRunsHtml(p.runs, style) || "<br>"}</p>`;
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
        textFitMode: autofit ? "autofit" : "fixed",
        ...(isList && !preciseParagraphs ? { bulletStyle: "default" } : {}),
        ...(box.rot ? { rotation: box.rot } : {}),
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
    if (numbered && !preciseParagraphs && typeof applyTextBulletState === "function") applyTextBulletState(element, "numbered", "decimal");
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
const PPTX_DRAWN_PRESETS = new Set(["arc", "blockArc", "circularArrow", "leftCircularArrow", "leftRightArrow", "upDownArrow", "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5", "donut", "leftBrace", "rightBrace"]);

// PowerPoint's dash styles as SVG dash patterns, in line widths.
const PPTX_DASHES = { dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };

// The outline of a freeform shape (<a:custGeom>) or an arc preset as SVG path data, in box pixels.
function _pptxGeometryPaths(spPr, boxW, boxH) {
    const custom = _pptxChild(spPr, "a:custGeom");
    const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
    if (!custom) {
        const preset = _pptxChild(spPr, "a:prstGeom");
        const kind = preset?.getAttribute("prst");
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
                const wR = num(command.getAttribute("wR")) * sx;
                const hR = num(command.getAttribute("hR")) * sy;
                const stAng = (num(command.getAttribute("stAng")) / 60000) * (Math.PI / 180);
                const swAng = (num(command.getAttribute("swAng")) / 60000) * (Math.PI / 180);
                const cx = current[0] - wR * Math.cos(stAng);
                const cy = current[1] - hR * Math.sin(stAng);
                const end = [cx + wR * Math.cos(stAng + swAng), cy + hR * Math.sin(stAng + swAng)];
                parts.push(`A ${wR} ${hR} 0 ${Math.abs(swAng) > Math.PI ? 1 : 0} ${swAng > 0 ? 1 : 0} ${end[0]} ${end[1]}`);
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
    const lineWidth = Math.max(0.75, ((Number(line?.getAttribute("w")) || 12700) / PPTX_EMU_PER_PX) * scale);
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
            return `<path d="${path.d}"${fillAttr}${stroke}${ends}/>`;
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
    const width = Number(line?.getAttribute("w")) || 12700;
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
async function _pptxStorePicture(file, path, mime) {
    const blob = new Blob([await file.async("arraybuffer")], { type: mime });
    // An empty or damaged file shows nothing in PowerPoint; here it showed a broken-picture frame.
    if (!(await _pptxPictureReadable(blob))) return null;
    try {
        // Stored like any inserted picture; a data URL is the fallback when there is no server to store it.
        if (typeof _uploadAssetFile === "function") {
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

async function _pptxPictureElement(pkg, pic, rels, box, zIndex, pictureFill = null) {
    const blip = _pptxFirst(pictureFill || pic, "a:blip");
    const embed = blip?.getAttribute("r:embed");
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
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" }[extension];
    if (!mime) return null; // EMF/WMF and the like: browsers cannot show them
    // Each media file is read and stored once per import: a master's logo is on every slide, and a picture used
    // on several slides was uploaded again for each.
    if (!pkg.pictureUrls) pkg.pictureUrls = new Map();
    if (!pkg.pictureUrls.has(path)) pkg.pictureUrls.set(path, _pptxStorePicture(file, path, mime));
    const url = await pkg.pictureUrls.get(path);
    if (!url) return null;
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
        styles: { zIndex, borderRadius: "0px", ...(opacity < 1 ? { opacity: String(opacity) } : {}) },
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

// A table with its cells' fills, text colours, weights, sizes and alignment: from the cells themselves, else from
// the table style it names (ppt/tableStyles.xml: whole table, banded rows and columns, first and last row and
// column). Tables came in grey and white in Manrope whatever the deck had.
function _pptxTableElement(tbl, box, scale, fontScale, zIndex, tableStyles = null, colors = _pptxCurrentThemeColors) {
    const colWidths = _pptxChildren(_pptxChild(tbl, "a:tblGrid"), "a:gridCol").map(col => Math.max(36, Math.round(((Number(col.getAttribute("w")) || 0) / PPTX_EMU_PER_PX) * scale)));
    const rows = _pptxChildren(tbl, "a:tr");
    if (!rows.length || !colWidths.length) return null;
    const tblPr = _pptxChild(tbl, "a:tblPr");
    const flag = name => tblPr?.getAttribute(name) === "1" || tblPr?.getAttribute(name) === "true";
    const styleId = _pptxChild(tblPr, "a:tableStyleId")?.textContent?.trim();
    const style = styleId && Array.from(tableStyles?.getElementsByTagName("a:tblStyle") || []).find(node => node.getAttribute("styleId") === styleId);
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
            if (!styles.fontWeight) styles.fontWeight = "400";
            if (!styles.backgroundColor) styles.backgroundColor = "transparent";
            if (!styles.color) styles.color = colors?.tx1 || "#000000";
            return {
                text: paragraphs.map(p => Array.from(p.getElementsByTagName("a:t")).map(t => t.textContent).join("")).join("\n"),
                styles,
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
            headerRow: flag("firstRow"),
            zebra: false,
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
    return { slidePath, layoutPath, masterPath, layout, master, theme };
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

function _pptxParagraphDefaults(design, placeholder, sp, level) {
    const result = sp.ownerDocument.createElement("a:pPr");
    const match = doc => {
        const shapes = Array.from(doc?.getElementsByTagName("p:sp") || []);
        return shapes.find(n => {
            const ph = _pptxPlaceholder(n);
            return ph && placeholder && ph.idx === placeholder.idx && (ph.type === placeholder.type || placeholder.idx);
        });
    };
    const name = `a:lvl${level + 1}pPr`;
    const kind = !placeholder ? "p:otherStyle" : /title/i.test(placeholder.type) ? "p:titleStyle" : "p:bodyStyle";
    const sources = [
        _pptxChild(_pptxChild(_pptxFirst(design?.master, "p:txStyles"), kind), name),
        ...[match(design?.master), match(design?.layout), sp].map(n => _pptxChild(_pptxChild(_pptxChild(n, "p:txBody"), "a:lstStyle"), name)),
    ];
    sources.filter(Boolean).forEach(source => {
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
    const styleName = !placeholder ? "p:otherStyle" : isTitle(placeholder.type) ? "p:titleStyle" : "p:bodyStyle";
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
    const embed = blip && _pptxFirst(blip, "a:blip")?.getAttribute("r:embed");
    return embed ? { picture: { part, embed } } : null;
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
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" }[extension];
    if (!mime) return null;
    const blob = new Blob([await file.async("arraybuffer")], { type: mime });
    if (!(await _pptxPictureReadable(blob))) return null;
    try {
        const uploaded = typeof _uploadAssetFile === "function" ? await _uploadAssetFile(new File([blob], path.split("/").pop(), { type: mime })) : null;
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
    const txBody = _pptxChild(sp, "p:txBody");
    const hasRunColor = Array.from(txBody?.getElementsByTagName("a:rPr") || []).some(rPr => _pptxChild(rPr, "a:solidFill"));
    const fontRef = _pptxFirst(_pptxChild(sp, "p:style"), "a:fontRef");
    const scheme = _pptxChild(fontRef, "a:schemeClr")?.getAttribute("val");
    const srgb = _pptxChild(fontRef, "a:srgbClr")?.getAttribute("val");
    const styleColor = srgb && /^[0-9a-f]{6}$/i.test(srgb) ? `#${srgb}` : scheme ? themeColors?.[scheme] : null;
    if (!hasRunColor && styleColor) text.styles.color = styleColor;
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
    const register = (node, ...made) => {
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
        for (const node of Array.from(container.children)) {
            const zIndex = elements.length + 1;
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
                const turns = g.rot ? [{ deg: g.rot, cx: frame.x + frame.w / 2, cy: frame.y + frame.h / 2 }, ...(t.turns || [])] : t.turns || [];
                const id = _pptxFirst(node, "p:cNvPr")?.getAttribute("id");
                if (id) owners.push(id);
                await walk(node, { sx, sy, cx: g.chX, cy: g.chY, ox: t.ox + (g.x - t.cx) * t.sx, oy: t.oy + (g.y - t.cy) * t.sy, turns, fs: t.fs });
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
                    const picture = await _pptxPictureElement(pkg, node, part.rels, box, zIndex, pictureFill);
                    if (picture) {
                        const made = [picture, text].filter(Boolean);
                        if (text) text.styles.zIndex = zIndex + 1;
                        elements.push(...made);
                        register(node, ...made);
                        continue;
                    }
                }
                const drawn = _pptxChild(spPr, "a:custGeom") || PPTX_DRAWN_PRESETS.has(_pptxChild(spPr, "a:prstGeom")?.getAttribute("prst"));
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
                const shape = text && !_pptxChild(spPr, "a:prstGeom") ? null : _pptxShapeElement(node, box, zIndex);
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
                const box = toBox(xfrm, t);
                const tbl = _pptxFirst(node, "a:tbl");
                const made = tbl ? _pptxTableElement(tbl, box, scale, scale, zIndex, await pkg.xml("ppt/tableStyles.xml"), design?.theme?.colors || _pptxCurrentThemeColors) : await _pptxChartElement(pkg, node, part.rels, box, zIndex);
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
                id: generateId("slide"),
                layoutId: "blank",
                masterId: "none",
                notes,
                presentationTransition: _pptxTransition(slideDoc),
                ...(slideBackground ? { background: slideBackground } : {}),
                ...(hidden ? { hidden: true } : {}),
                elements,
            });
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
