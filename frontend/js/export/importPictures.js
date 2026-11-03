/**
 * importPictures.js
 * Picture formats PowerPoint decks hold that browsers cannot show, turned into ones they can, for importPptx.js:
 *  - TIFF (pasted from Word, Mac Preview or a scanner) decoded to a bitmap;
 *  - EMF drawings (MathType equations, charts and diagrams pasted from Office or ChemDraw), GDI or EMF+, drawn as SVG;
 *  - WMF drawings (older MathType and Equation Editor equations, Office clip art) drawn as SVG;
 *  - the bitmaps (DIBs) both of those carry.
 * Each returns null for what it cannot read, and the importer leaves the picture out as before.
 */

// A device-independent bitmap (the BITMAPINFO header at `header`, its pixels at `bits`) drawn on a canvas; null when
// it is not one this reads. 1, 4, 8, 16, 24 and 32 bits per pixel, bottom-up or top-down, with or without bit
// fields. GDI draws a DIB opaque, so the canvas is.
function _pptxDibCanvas(view, header, cbBmi, bits, cbBits) {
    if (cbBmi < 40 || cbBits <= 0 || header + cbBmi > view.byteLength || bits + cbBits > view.byteLength) return null;
    const width = view.getInt32(header + 4, true);
    const rawHeight = view.getInt32(header + 8, true);
    const height = Math.abs(rawHeight);
    const bitCount = view.getUint16(header + 14, true);
    const compression = view.getUint32(header + 16, true);
    if (width <= 0 || !height || width * height > 40e6) return null;
    const masks = compression === 3 && bitCount >= 16;
    if (compression !== 0 && !masks) return null;
    if (![1, 4, 8, 16, 24, 32].includes(bitCount)) return null;
    const headerSize = view.getUint32(header, true);
    const paletteStart = header + headerSize + (masks && headerSize === 40 ? 12 : 0);
    const paletteSize = bitCount <= 8 ? view.getUint32(header + 32, true) || 1 << bitCount : 0;
    const palette = [];
    for (let i = 0; i < paletteSize && paletteStart + i * 4 + 3 < view.byteLength; i++) {
        palette.push([view.getUint8(paletteStart + i * 4 + 2), view.getUint8(paletteStart + i * 4 + 1), view.getUint8(paletteStart + i * 4)]);
    }
    // Bit-field masks follow a 40-byte header, or sit inside a larger (V4/V5) one at the same place.
    const channelMasks = masks ? [view.getUint32(header + 40, true), view.getUint32(header + 44, true), view.getUint32(header + 48, true)] : bitCount === 16 ? [0x7c00, 0x03e0, 0x001f] : null;
    const channel = (value, mask) => {
        if (!mask) return 0;
        const shift = 31 - Math.clz32(mask & -mask); // the mask's lowest set bit
        const top = mask >>> shift;
        return Math.round((((value & mask) >>> shift) * 255) / top);
    };
    const stride = Math.ceil((width * bitCount) / 32) * 4;
    if (stride * height > cbBits) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);
    const out = image.data;
    for (let y = 0; y < height; y++) {
        const row = bits + (rawHeight > 0 ? height - 1 - y : y) * stride;
        for (let x = 0; x < width; x++) {
            let r, g, b;
            if (bitCount === 32 || bitCount === 24) {
                const at = row + x * (bitCount / 8);
                if (channelMasks && bitCount === 32) {
                    const value = view.getUint32(at, true);
                    [r, g, b] = channelMasks.map(mask => channel(value, mask));
                } else [b, g, r] = [view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2)];
            } else if (bitCount === 16) {
                const value = view.getUint16(row + x * 2, true);
                [r, g, b] = channelMasks.map(mask => channel(value, mask));
            } else {
                const bitIndex = x * bitCount;
                const byte = view.getUint8(row + (bitIndex >> 3));
                const index = (byte >> (8 - bitCount - (bitIndex & 7))) & ((1 << bitCount) - 1);
                [r, g, b] = palette[index] || [0, 0, 0];
            }
            const at = (y * width + x) * 4;
            out[at] = r;
            out[at + 1] = g;
            out[at + 2] = b;
            out[at + 3] = 255; // the fourth byte of a 32-bit pixel is unused
        }
    }
    context.putImageData(image, 0, 0);
    return canvas;
}

// ---------------------------------------------------------------------------------------------------------------
// TIFF

// LZW as TIFF writes it: codes from 9 to 12 bits, most significant bit first, widening one code early.
function _pptxTiffLzw(input, expected) {
    const out = new Uint8Array(expected);
    let length = 0;
    let table = [];
    let width = 9;
    let previous = null;
    let bitPos = 0;
    const reset = () => {
        table = Array.from({ length: 258 }, (_, i) => (i < 256 ? Uint8Array.of(i) : null));
        width = 9;
        previous = null;
    };
    const read = () => {
        let code = 0;
        for (let i = 0; i < width; i++) {
            const byte = input[bitPos >> 3];
            if (byte === undefined) return 257;
            code = (code << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
            bitPos++;
        }
        return code;
    };
    const write = entry => {
        const room = Math.min(entry.length, expected - length);
        out.set(room < entry.length ? entry.subarray(0, room) : entry, length);
        length += room;
    };
    reset();
    while (length < expected) {
        const code = read();
        if (code === 257) break;
        if (code === 256) {
            reset();
            continue;
        }
        let entry;
        if (code < table.length && table[code]) {
            entry = table[code];
            if (previous) {
                const next = new Uint8Array(previous.length + 1);
                next.set(previous);
                next[previous.length] = entry[0];
                table.push(next);
            }
        } else if (previous) {
            entry = new Uint8Array(previous.length + 1);
            entry.set(previous);
            entry[previous.length] = previous[0];
            table.push(entry);
        } else break;
        write(entry);
        previous = entry;
        if (table.length + 1 >= 1 << width && width < 12) width++;
    }
    return out;
}

function _pptxTiffPackBits(input, expected) {
    const out = new Uint8Array(expected);
    let length = 0;
    for (let i = 0; i < input.length && length < expected; ) {
        const n = (input[i++] << 24) >> 24;
        if (n >= 0) {
            for (let k = 0; k <= n && i < input.length && length < expected; k++) out[length++] = input[i++];
        } else if (n !== -128) {
            const value = input[i++];
            for (let k = 0; k < 1 - n && length < expected; k++) out[length++] = value;
        }
    }
    return out;
}

async function _pptxTiffInflate(input) {
    if (typeof DecompressionStream !== "function") return null;
    const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The first image of a TIFF as a PNG; null for what this does not read (BigTIFF, JPEG-in-TIFF, CCITT fax, planes
// stored apart). Strips or tiles; uncompressed, LZW, PackBits or Deflate; grey, palette, RGB or RGBA; 1 to 16 bits.
async function _pptxTiffBitmap(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 8) return null;
    const order = view.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    if (view.getUint16(2, little) !== 42) return null;
    const ifd = view.getUint32(4, little);
    if (ifd + 2 > view.byteLength) return null;
    const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4 };
    const tags = {};
    const entries = view.getUint16(ifd, little);
    for (let i = 0; i < entries; i++) {
        const at = ifd + 2 + i * 12;
        if (at + 12 > view.byteLength) return null;
        const tag = view.getUint16(at, little);
        const type = view.getUint16(at + 2, little);
        const count = view.getUint32(at + 4, little);
        const size = sizes[type];
        if (!size) continue;
        const start = count * size <= 4 ? at + 8 : view.getUint32(at + 8, little);
        if (start + count * size > view.byteLength) continue;
        const values = [];
        for (let k = 0; k < Math.min(count, 1 << 20); k++) {
            const p = start + k * size;
            values.push(size === 1 ? view.getUint8(p) : size === 2 ? view.getUint16(p, little) : view.getUint32(p, little));
        }
        tags[tag] = values;
    }
    const one = (tag, fallback) => (tags[tag] ? tags[tag][0] : fallback);
    const width = one(256, 0);
    const height = one(257, 0);
    const compression = one(259, 1);
    const photometric = one(262, 1);
    const samples = one(277, 1);
    const bitsPer = one(258, 1);
    const planar = one(284, 1);
    const predictor = one(317, 1);
    if (!width || !height || width * height > 40e6 || planar !== 1) return null;
    if (![1, 5, 8, 32773, 32946].includes(compression) || ![0, 1, 2, 3].includes(photometric)) return null;
    if (![1, 2, 4, 8, 16].includes(bitsPer) || (bitsPer < 8 && samples !== 1)) return null;
    const tiled = Boolean(tags[322]);
    const blockW = tiled ? one(322, 0) : width;
    const blockH = tiled ? one(323, 0) : Math.min(height, one(278, height));
    const offsets = tags[tiled ? 324 : 273] || [];
    const counts = tags[tiled ? 325 : 279] || [];
    if (!blockW || !blockH || !offsets.length) return null;
    const across = Math.ceil(width / blockW);
    const rowBytes = Math.ceil((blockW * samples * bitsPer) / 8);
    const palette = tags[320];
    const alphaAt = photometric === 2 && samples >= 4 ? 3 : photometric < 2 && samples >= 2 ? 1 : -1;
    const premultiplied = (tags[338] || [])[0] === 1;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);
    const out = image.data;
    for (let index = 0; index < offsets.length; index++) {
        const left = tiled ? (index % across) * blockW : 0;
        const top = tiled ? Math.floor(index / across) * blockH : index * blockH;
        if (top >= height) break;
        const rows = Math.min(blockH, tiled ? blockH : height - top);
        const expected = rowBytes * rows;
        const start = offsets[index];
        const length = counts[index] ?? view.byteLength - start;
        if (start >= view.byteLength) continue;
        const raw = new Uint8Array(buffer, start, Math.min(length, view.byteLength - start));
        let data;
        if (compression === 1) data = raw;
        else if (compression === 5) data = _pptxTiffLzw(raw, expected);
        else if (compression === 32773) data = _pptxTiffPackBits(raw, expected);
        else data = await _pptxTiffInflate(raw).catch(() => null);
        if (!data) return null;
        const bytesPer = bitsPer === 16 ? 2 : 1;
        const sample = (row, column, s) => {
            const base = row * rowBytes;
            if (bitsPer >= 8) {
                const at = base + (column * samples + s) * bytesPer;
                return bitsPer === 16 ? data[at + (little ? 1 : 0)] : data[at];
            }
            const bit = column * bitsPer;
            const value = (data[base + (bit >> 3)] >> (8 - bitsPer - (bit & 7))) & ((1 << bitsPer) - 1);
            return photometric === 3 ? value : Math.round((value * 255) / ((1 << bitsPer) - 1));
        };
        if (predictor === 2 && bitsPer === 8) {
            // Horizontal differencing: each sample is stored as the change from the one to its left.
            for (let row = 0; row < rows; row++) {
                const base = row * rowBytes;
                for (let k = samples; k < blockW * samples && base + k < data.length; k++) data[base + k] = (data[base + k] + data[base + k - samples]) & 255;
            }
        }
        for (let row = 0; row < rows; row++) {
            const y = top + row;
            if (y >= height) break;
            for (let column = 0; column < blockW; column++) {
                const x = left + column;
                if (x >= width) break;
                let r, g, b;
                let a = alphaAt >= 0 ? sample(row, column, alphaAt) : 255;
                if (photometric === 2) {
                    r = sample(row, column, 0);
                    g = sample(row, column, 1);
                    b = sample(row, column, 2);
                    if (premultiplied && a > 0 && a < 255) [r, g, b] = [r, g, b].map(v => Math.min(255, Math.round((v * 255) / a)));
                } else if (photometric === 3) {
                    const value = sample(row, column, 0);
                    const n = 1 << bitsPer;
                    if (!palette || palette.length < 3 * n) return null;
                    [r, g, b] = [palette[value] >> 8, palette[n + value] >> 8, palette[2 * n + value] >> 8];
                } else {
                    const grey = sample(row, column, 0);
                    r = g = b = photometric === 0 ? 255 - grey : grey;
                }
                const at = (y * width + x) * 4;
                out[at] = r;
                out[at + 1] = g;
                out[at + 2] = b;
                out[at + 3] = a;
            }
        }
    }
    context.putImageData(image, 0, 0);
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), "image/png"));
}

// ---------------------------------------------------------------------------------------------------------------
// EMF drawings

// The Symbol font's characters as Unicode (Greek, operators, arrows, bracket pieces): an equation drawn in Symbol
// read "a" for alpha in any other font.
const PPTX_SYMBOL_FONT = (() => {
    const map = {};
    const greekUpper = "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ";
    const greekLower = "αβχδεφγηιϕκλμνοπθρστυϖωξψζ";
    for (let i = 0; i < 26; i++) {
        map[0x41 + i] = greekUpper[i];
        map[0x61 + i] = greekLower[i];
    }
    Object.assign(map, {
        0x22: "∀", 0x24: "∃", 0x27: "∋", 0x2a: "∗", 0x2d: "−", 0x40: "≅", 0x5c: "∴", 0x5e: "⊥", 0x60: "‾", 0x7e: "∼",
        0xa0: "€", 0xa1: "ϒ", 0xa2: "′", 0xa3: "≤", 0xa4: "⁄", 0xa5: "∞", 0xa6: "ƒ", 0xa7: "♣", 0xa8: "♦", 0xa9: "♥",
        0xaa: "♠", 0xab: "↔", 0xac: "←", 0xad: "↑", 0xae: "→", 0xaf: "↓", 0xb0: "°", 0xb1: "±", 0xb2: "″", 0xb3: "≥",
        0xb4: "×", 0xb5: "∝", 0xb6: "∂", 0xb7: "•", 0xb8: "÷", 0xb9: "≠", 0xba: "≡", 0xbb: "≈", 0xbc: "…", 0xbd: "⏐",
        0xbe: "⎯", 0xbf: "↵", 0xc0: "ℵ", 0xc1: "ℑ", 0xc2: "ℜ", 0xc3: "℘", 0xc4: "⊗", 0xc5: "⊕", 0xc6: "∅", 0xc7: "∩",
        0xc8: "∪", 0xc9: "⊃", 0xca: "⊇", 0xcb: "⊄", 0xcc: "⊂", 0xcd: "⊆", 0xce: "∈", 0xcf: "∉", 0xd0: "∠", 0xd1: "∇",
        0xd2: "®", 0xd3: "©", 0xd4: "™", 0xd5: "∏", 0xd6: "√", 0xd7: "⋅", 0xd8: "¬", 0xd9: "∧", 0xda: "∨", 0xdb: "⇔",
        0xdc: "⇐", 0xdd: "⇑", 0xde: "⇒", 0xdf: "⇓", 0xe0: "◊", 0xe1: "〈", 0xe2: "®", 0xe3: "©", 0xe4: "™", 0xe5: "∑",
        0xe6: "⎛", 0xe7: "⎜", 0xe8: "⎝", 0xe9: "⎡", 0xea: "⎢", 0xeb: "⎣", 0xec: "⎧", 0xed: "⎨", 0xee: "⎩", 0xef: "⎪",
        0xf1: "〉", 0xf2: "∫", 0xf3: "⌠", 0xf4: "⎮", 0xf5: "⌡", 0xf6: "⎞", 0xf7: "⎟", 0xf8: "⎠", 0xf9: "⎤", 0xfa: "⎥",
        0xfb: "⎦", 0xfc: "⎫", 0xfd: "⎬", 0xfe: "⎭",
    });
    return map;
})();

// MathType's MT Extra: the few characters equations use, as Unicode.
const PPTX_MT_EXTRA_FONT = { 0x26: "⋯", 0x4c: "⋰", 0x4d: "⋱", 0x4e: "⋮", 0x6c: "ℓ", 0x68: "ℏ", 0x41: "↼", 0x42: "⇀", 0x43: "↽", 0x44: "⇁", 0x3a: "∷", 0x24: "∗" };

function _pptxSvgEscape(text) {
    return String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function _pptxSvgNumber(value) {
    return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}

// A metafile string's character codes as Unicode: Symbol and MT Extra drawn with their own tables, and the private-use
// codes (0xF0xx) a symbol font's characters are stored under taken back to the font's own.
function _pptxMetafileChars(codes, font) {
    const face = String(font.face || "");
    const symbol = /^symbol$/i.test(face) || font.charset === 2;
    const mtExtra = /^mt extra/i.test(face);
    return codes.map(code => {
        const low = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
        if (/^symbol$/i.test(face) && PPTX_SYMBOL_FONT[low]) return PPTX_SYMBOL_FONT[low];
        if (mtExtra) return PPTX_MT_EXTRA_FONT[low] || (low >= 0x20 && low < 0x7f && code >= 0xf000 ? "" : String.fromCharCode(low));
        if (code >= 0xf000 && code <= 0xf0ff) return symbol && PPTX_SYMBOL_FONT[low] ? PPTX_SYMBOL_FONT[low] : String.fromCharCode(low);
        return String.fromCharCode(code);
    });
}

// The font a metafile names, with stand-ins for when it is not installed (Symbol's characters are Unicode by now).
function _pptxMetafileFamily(face, symbol) {
    if (symbol) return "'Times New Roman', 'Liberation Serif', serif";
    return `'${String(face).replace(/['"\\<>&]/g, "")}', ${/times|roman|serif|georgia|cambria|garamond|book|mt extra/i.test(face) ? "'Liberation Serif', serif" : /courier|mono|consol/i.test(face) ? "monospace" : "'Liberation Sans', Arial, sans-serif"}`;
}

// A line of GDI text as SVG: `chars` one per code, `advances` each glyph's advance in logical units (or none), `m` the
// logical-to-picture transform, `origin` the reference point in the picture, `align` GDI's TA_ flags. "" when nothing
// in it has a shape.
function _pptxMetafileText(chars, font, advances, m, origin, align, color) {
    const face = String(font.face || "");
    const symbol = /^symbol$/i.test(face) || font.charset === 2;
    const height = Math.abs(font.height || 16);
    const em = font.height < 0 ? height : height / 1.15; // a positive height is the cell, with internal leading
    const angle = ((font.escapement || 0) / 10) * (Math.PI / 180);
    // The baseline's direction and the glyphs' up direction on the device.
    const along = [m[0] * Math.cos(angle) + m[2] * -Math.sin(angle), m[1] * Math.cos(angle) + m[3] * -Math.sin(angle)];
    const across = [m[0] * Math.sin(angle) + m[2] * Math.cos(angle), m[1] * Math.sin(angle) + m[3] * Math.cos(angle)];
    const alongScale = Math.hypot(...along) || 1;
    const acrossScale = Math.hypot(...across) || 1;
    const size = em * acrossScale;
    const rotation = Math.atan2(along[1], along[0]) * (180 / Math.PI);
    const total = advances.reduce((sum, value) => sum + value, 0) * alongScale;
    let startX = 0;
    if ((align & 6) === 6) startX = -total / 2;
    else if (align & 2) startX = -total;
    // Vertical: the reference point is the top of the cell, its baseline, or its bottom.
    let baseline = 0;
    if ((align & 24) === 24) baseline = 0;
    else if (align & 8) baseline = -0.22 * em * acrossScale;
    else baseline = (font.height < 0 ? 0.89 * height : 0.78 * height) * acrossScale;
    const xs = [];
    let run = startX;
    chars.forEach((_, i) => {
        xs.push(run);
        run += advances.length ? advances[i] * alongScale : 0;
    });
    // Spaces as positioned glyphs keep their advance; the drawn string leaves out what has no shape.
    const kept = chars.map((c, i) => [c, xs[i]]).filter(([c]) => c && c !== " " && c !== "\u0000");
    if (!kept.length) return "";
    const family = _pptxMetafileFamily(face, symbol);
    const decoration = [font.underline ? "underline" : "", font.strike ? "line-through" : ""].filter(Boolean).join(" ");
    const positioned = advances.length ? ` x="${kept.map(([, x]) => _pptxSvgNumber(x)).join(" ")}"` : ` x="${_pptxSvgNumber(startX)}"`;
    const content = advances.length ? kept.map(([c]) => c).join("") : chars.join("");
    // Without advances the string's width is unknown here, so centred and right-aligned text is anchored instead.
    const anchor = advances.length || !(align & 2) ? "" : (align & 6) === 6 ? ' text-anchor="middle"' : ' text-anchor="end"';
    return `<text transform="translate(${_pptxSvgNumber(origin[0])} ${_pptxSvgNumber(origin[1])}) rotate(${_pptxSvgNumber(rotation)})"${positioned} y="${_pptxSvgNumber(baseline)}" font-family="${_pptxSvgEscape(family)}" font-size="${_pptxSvgNumber(size)}"${font.weight >= 600 ? ' font-weight="bold"' : ""}${font.italic ? ' font-style="italic"' : ""}${decoration ? ` text-decoration="${decoration}"` : ""}${anchor} fill="${color}" xml:space="preserve">${_pptxSvgEscape(content)}</text>`;
}

// A bitmap (canvas) drawn into the unit square that `t` places in the picture, cropped to the source rectangle.
function _pptxBitmapMarkup(canvas, srcX, srcY, srcW, srcH, t) {
    let source = canvas;
    const sx = Math.max(0, srcX), sy = Math.max(0, srcY);
    const sw = Math.min(canvas.width - sx, srcW || canvas.width), sh = Math.min(canvas.height - sy, srcH || canvas.height);
    if (sw > 0 && sh > 0 && (sx || sy || sw < canvas.width || sh < canvas.height)) {
        source = document.createElement("canvas");
        source.width = sw;
        source.height = sh;
        source.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    return `<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${t.map(_pptxSvgNumber).join(" ")})" href="${source.toDataURL("image/png")}"/>`;
}

// An elliptical arc as Bézier curves: the start point, then three points per curve. Angles (radians) are
// parametric, positive turning from +x towards +y.
function _pptxArcPoints(cx, cy, rx, ry, start, sweep) {
    const n = Math.max(1, Math.min(16, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)));
    const delta = sweep / n;
    const k = (4 / 3) * Math.tan(delta / 4);
    const at = a => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const out = [at(start)];
    for (let i = 0; i < n; i++) {
        const a0 = start + i * delta, a1 = a0 + delta;
        const p0 = at(a0), p1 = at(a1);
        out.push([p0[0] - k * rx * Math.sin(a0), p0[1] + k * ry * Math.cos(a0)], [p1[0] + k * rx * Math.sin(a1), p1[1] - k * ry * Math.cos(a1)], p1);
    }
    return out;
}

function _pptxBase64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

// An EMF drawing as an SVG document, or null when it holds nothing this draws. GDI records: lines, curves, polygons,
// rectangles, ellipses, paths, text (positioned glyph by glyph as the file places them), bitmaps and clipping, under
// the file's mapping mode and world transform. EMF+ records (GDI+, which Office 2007 and later write) are drawn when
// the GDI records are not the drawing:
//  - an "EMF+ dual" file carries a GDI copy of its drawing beside the EMF+ records, and that copy is drawn as before
//    (it is what every player shows); its EMF+ records only when the copy turns out empty;
//  - a metafile inside an EMF+ picture is played as GDI+ plays it, EMF+ first: their GDI copies were seen to leave
//    out what only the EMF+ records draw (a chart's curve);
//  - an "EMF+ only" file's GDI records are only what GetDC hands back to GDI, so its EMF+ records are the drawing
//    (with those GDI records in their places), and the GDI records alone only when the EMF+ ones draw nothing.
function _pptxEmfSvg(buffer, depth = 0) {
    try {
        const view = new DataView(buffer);
        if (view.byteLength < 88 || view.getUint32(0, true) !== 1 || view.getUint32(40, true) !== 0x464d4520) return null;
        const plus = _pptxEmfPlusHeader(view);
        if (!plus) return _pptxEmfDraw(view, false, depth);
        if (plus.dual && !depth) return _pptxEmfDraw(view, false, depth) || _pptxEmfDraw(view, true, depth);
        return _pptxEmfDraw(view, true, depth) || _pptxEmfDraw(view, false, depth);
    } catch {
        return null;
    }
}

// One pass over an EMF: its GDI records, or (`plus`) its EMF+ records and the GDI records GetDC hands back to.
function _pptxEmfDraw(view, plus, depth) {
    const i32 = at => view.getInt32(at, true);
    const u32 = at => view.getUint32(at, true);
    const colour = at => `#${[0, 1, 2].map(k => view.getUint8(at + k).toString(16).padStart(2, "0")).join("")}`;
    // The picture's frame (0.01 mm) in the reference device's pixels, which the drawing is placed in.
    const deviceW = i32(72), deviceH = i32(76), mmW = i32(80), mmH = i32(84);
    const pxPerMmX = deviceW > 0 && mmW > 0 ? deviceW / mmW : 3.7795;
    const pxPerMmY = deviceH > 0 && mmH > 0 ? deviceH / mmH : 3.7795;
    let frame = [(i32(24) / 100) * pxPerMmX, (i32(28) / 100) * pxPerMmY, (i32(32) / 100) * pxPerMmX, (i32(36) / 100) * pxPerMmY];
    if (!(frame[2] > frame[0]) || !(frame[3] > frame[1])) frame = [i32(8), i32(12), i32(16) + 1, i32(20) + 1];
    if (!(frame[2] > frame[0]) || !(frame[3] > frame[1])) return null;

    const stockObjects = {
        0: { kind: "brush", style: 0, color: "#ffffff" },
        1: { kind: "brush", style: 0, color: "#c0c0c0" },
        2: { kind: "brush", style: 0, color: "#808080" },
        3: { kind: "brush", style: 0, color: "#404040" },
        4: { kind: "brush", style: 0, color: "#000000" },
        5: { kind: "brush", style: 1 },
        6: { kind: "pen", style: 0, width: 0, color: "#ffffff" },
        7: { kind: "pen", style: 0, width: 0, color: "#000000" },
        8: { kind: "pen", style: 5 },
        18: { kind: "brush", style: 0, color: "#ffffff" },
        19: { kind: "pen", style: 0, width: 0, color: "#000000" },
    };
    const objects = new Map();
    const fresh = () => ({
        mapMode: 1,
        winOrg: [0, 0], winExt: [1, 1], vpOrg: [0, 0], vpExt: [1, 1],
        world: [1, 0, 0, 1, 0, 0],
        pen: stockObjects[7],
        brush: stockObjects[0],
        font: null,
        textColor: "#000000",
        bkColor: "#ffffff",
        bkMode: 2,
        textAlign: 0,
        fillRule: "evenodd",
        miter: 10,
        clip: null,
        pos: [0, 0],
    });
    let dc = fresh();
    const saved = [];
    const defs = [];
    const body = [];
    let clipCount = 0;
    let drew = false;
    let path = null; // the figure being built between BeginPath and EndPath (device coordinates)
    let lastPath = null;
    const player = plus
        ? _pptxEmfPlusPlayer(view, {
              body,
              defs,
              frame,
              depth,
              drew: () => (drew = true),
              clip: (d, parent, rule) => {
                  const id = `emfclip${++clipCount}`;
                  defs.push(`<clipPath id="${id}"${parent ? ` clip-path="url(#${parent})"` : ""}><path d="${d}"${rule ? ` clip-rule="${rule}"` : ""}/></clipPath>`);
                  return id;
              },
          })
        : null;

    // Logical units to the reference device's pixels: the world transform, then the window-to-viewport mapping.
    const pageScale = () => {
        const unit = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 }[dc.mapMode];
        if (unit) return [unit * pxPerMmX, -unit * pxPerMmY];
        if (dc.mapMode === 7 || dc.mapMode === 8) {
            let sx = dc.vpExt[0] / (dc.winExt[0] || 1);
            let sy = dc.vpExt[1] / (dc.winExt[1] || 1);
            if (dc.mapMode === 7) {
                const s = Math.min(Math.abs(sx), Math.abs(sy));
                sx = Math.sign(sx || 1) * s;
                sy = Math.sign(sy || 1) * s;
            }
            return [sx, sy];
        }
        return [1, 1];
    };
    const matrix = () => {
        const [a, b, c, d, e, f] = dc.world;
        const [sx, sy] = pageScale();
        const ox = dc.vpOrg[0] - dc.winOrg[0] * sx;
        const oy = dc.vpOrg[1] - dc.winOrg[1] * sy;
        return [a * sx, b * sy, c * sx, d * sy, e * sx + ox, f * sy + oy];
    };
    const point = (x, y, m = matrix()) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const pt = p => `${_pptxSvgNumber(p[0])} ${_pptxSvgNumber(p[1])}`;

    const strokeAttrs = () => {
        const pen = dc.pen;
        if (!pen || pen.style === 5) return ' stroke="none"';
        const m = matrix();
        const cosmetic = !pen.geometric || !pen.width;
        const width = cosmetic ? Math.max(1, pen.width ? pen.width * scaleOf(m) : 1) : pen.width * scaleOf(m);
        const dash = { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[pen.style];
        const cap = { 0: "round", 1: "square", 2: "butt" }[pen.cap] || "round";
        const join = { 0: "round", 1: "bevel", 2: "miter" }[pen.join] || "round";
        return ` stroke="${pen.color}" stroke-width="${_pptxSvgNumber(width)}" stroke-linecap="${cap}" stroke-linejoin="${join}"${join === "miter" ? ` stroke-miterlimit="${_pptxSvgNumber(dc.miter)}"` : ""}${dash ? ` stroke-dasharray="${dash.map(n => _pptxSvgNumber(n * width)).join(" ")}"` : ""}`;
    };
    const fillAttrs = () => {
        const brush = dc.brush;
        if (!brush || brush.style === 1) return ' fill="none"';
        // A hatched brush as a pale wash of its colour (the pattern itself is not drawn).
        return ` fill="${brush.color}"${brush.style === 2 ? ' fill-opacity="0.35"' : ""} fill-rule="${dc.fillRule}"`;
    };
    const clipAttr = () => (dc.clip ? ` clip-path="url(#${dc.clip})"` : "");
    // An element with a transform of its own (text, a bitmap) is clipped through a group: a clip path on the element
    // itself is read in its transformed space, which cut equations down to slivers.
    const clipped = markup => (dc.clip ? `<g clip-path="url(#${dc.clip})">${markup}</g>` : markup);
    const emit = (d, { fill = false, stroke = true } = {}) => {
        if (!d) return;
        const attrs = (fill ? fillAttrs() : ' fill="none"') + (stroke ? strokeAttrs() : ' stroke="none"');
        if (/fill="none"/.test(attrs) && /stroke="none"/.test(attrs)) return;
        body.push(`<path d="${d}"${attrs}${clipAttr()}/>`);
        drew = true;
    };
    // Adds to the open path, or draws at once.
    const figure = (d, options) => {
        if (path !== null) path += d;
        else emit(d, options);
    };

    const readPoints = (at, count, small) => {
        const out = [];
        const m = matrix();
        for (let i = 0; i < count; i++) {
            const p = small ? [view.getInt16(at + i * 4, true), view.getInt16(at + i * 4 + 2, true)] : [i32(at + i * 8), i32(at + i * 8 + 4)];
            out.push(point(p[0], p[1], m));
        }
        return out;
    };
    const logicalPos = () => dc.pos;
    const devicePos = () => point(dc.pos[0], dc.pos[1]);
    const lastLogical = (at, count, small) => (small ? [view.getInt16(at + (count - 1) * 4, true), view.getInt16(at + (count - 1) * 4 + 2, true)] : [i32(at + (count - 1) * 8), i32(at + (count - 1) * 8 + 4)]);
    const beziers = pts => {
        let d = "";
        for (let i = 0; i + 2 < pts.length; i += 3) d += ` C${pt(pts[i])} ${pt(pts[i + 1])} ${pt(pts[i + 2])}`;
        return d;
    };
    // An ellipse (or a rectangle's rounded corners) in logical units, as curves through the current transform.
    const ellipsePath = (left, top, right, bottom) => {
        const cx = (left + right) / 2, cy = (top + bottom) / 2, rx = (right - left) / 2, ry = (bottom - top) / 2;
        const k = 0.5523;
        const m = matrix();
        const p = (x, y) => pt(point(x, y, m));
        return `M${p(cx + rx, cy)} C${p(cx + rx, cy + ry * k)} ${p(cx + rx * k, cy + ry)} ${p(cx, cy + ry)} C${p(cx - rx * k, cy + ry)} ${p(cx - rx, cy + ry * k)} ${p(cx - rx, cy)} C${p(cx - rx, cy - ry * k)} ${p(cx - rx * k, cy - ry)} ${p(cx, cy - ry)} C${p(cx + rx * k, cy - ry)} ${p(cx + rx, cy - ry * k)} ${p(cx + rx, cy)} Z`;
    };
    const rectPath = (left, top, right, bottom) => {
        const m = matrix();
        return `M${pt(point(left, top, m))} L${pt(point(right, top, m))} L${pt(point(right, bottom, m))} L${pt(point(left, bottom, m))} Z`;
    };
    const roundRectPath = (left, top, right, bottom, w, h) => {
        const rx = Math.min(Math.abs(w) / 2, (right - left) / 2), ry = Math.min(Math.abs(h) / 2, (bottom - top) / 2);
        if (!(rx > 0) || !(ry > 0)) return rectPath(left, top, right, bottom);
        const k = 0.5523;
        const m = matrix();
        const p = (x, y) => pt(point(x, y, m));
        return `M${p(left + rx, top)} L${p(right - rx, top)} C${p(right - rx + rx * k, top)} ${p(right, top + ry - ry * k)} ${p(right, top + ry)} L${p(right, bottom - ry)} C${p(right, bottom - ry + ry * k)} ${p(right - rx + rx * k, bottom)} ${p(right - rx, bottom)} L${p(left + rx, bottom)} C${p(left + rx - rx * k, bottom)} ${p(left, bottom - ry + ry * k)} ${p(left, bottom - ry)} L${p(left, top + ry)} C${p(left, top + ry - ry * k)} ${p(left + rx - rx * k, top)} ${p(left + rx, top)} Z`;
    };

    // Clipping: a clip path in device units, intersected with the one in force when asked to.
    const setClip = (d, intersect) => {
        const id = `emfclip${++clipCount}`;
        const parent = intersect && dc.clip ? ` clip-path="url(#${dc.clip})"` : "";
        defs.push(`<clipPath id="${id}"${parent}><path d="${d}"/></clipPath>`);
        dc.clip = id;
    };

    const bitmap = (at, offBmi, cbBmi, offBits, cbBits, srcX, srcY, srcW, srcH, destX, destY, destW, destH) => {
        const canvas = _pptxDibCanvas(view, at + offBmi, cbBmi, at + offBits, cbBits);
        if (!canvas) return;
        const m = matrix();
        // The destination rectangle (logical units, either direction) through the current transform.
        const t = [m[0] * destW, m[1] * destW, m[2] * destH, m[3] * destH, ...point(destX, destY, m)];
        body.push(clipped(_pptxBitmapMarkup(canvas, srcX, srcY, srcW, srcH, t)));
        drew = true;
    };

    const text = (at, wide) => {
        const refX = i32(at + 36), refY = i32(at + 40);
        const count = u32(at + 44), offString = u32(at + 48), options = u32(at + 52);
        const offDx = u32(at + 72);
        const m = matrix();
        if (options & 0x2) {
            // ETO_OPAQUE: the text's rectangle filled with the background colour first.
            const l = i32(at + 56), t = i32(at + 60), r = i32(at + 64), b = i32(at + 68);
            if (r > l && b > t) {
                body.push(`<path d="${rectPath(l, t, r, b)}" fill="${dc.bkColor}"${clipAttr()}/>`);
                drew = true;
            }
        }
        if (!count || options & 0x10) return; // ETO_GLYPH_INDEX: glyph numbers of a font this does not have
        if (at + offString + count * (wide ? 2 : 1) > view.byteLength) return;
        const font = dc.font || { height: -16, weight: 400, italic: false, face: "Arial", escapement: 0 };
        const codes = Array.from({ length: count }, (_, i) => (wide ? view.getUint16(at + offString + i * 2, true) : view.getUint8(at + offString + i)));
        const chars = _pptxMetafileChars(codes, font);
        // Each glyph's advance (logical units) along the baseline, as the file gives it.
        const pdy = options & 0x2000;
        const advances = [];
        if (offDx && at + offDx + count * 4 * (pdy ? 2 : 1) <= view.byteLength) {
            for (let i = 0; i < count; i++) advances.push(i32(at + offDx + i * 4 * (pdy ? 2 : 1)));
        }
        const useCurrent = dc.textAlign & 1;
        const origin = useCurrent ? devicePos() : point(refX, refY, m);
        if (useCurrent && advances.length) {
            const angle = ((font.escapement || 0) / 10) * (Math.PI / 180);
            const moved = advances.reduce((sum, value) => sum + value, 0);
            dc.pos = [dc.pos[0] + moved * Math.cos(angle), dc.pos[1] - moved * Math.sin(angle)];
        }
        const markup = _pptxMetafileText(chars, font, advances, m, origin, dc.textAlign, dc.textColor);
        if (!markup) return;
        body.push(clipped(markup));
        drew = true;
    };

    let records = 0;
    for (let at = 0; at + 8 <= view.byteLength; ) {
        const type = u32(at);
        const size = u32(at + 4);
        if (size < 8 || at + size > view.byteLength || ++records > 500000) break;
        if (player) {
            // EMF+ records ride in comments; GDI records count only where GetDC handed drawing back to them.
            if (type === 70 && size >= 16 && u32(at + 12) === 0x2b464d45) player.records(at + 16, Math.min(at + size, at + 12 + u32(at + 8)));
            if (type !== 1 && type !== 14 && !player.gdi) {
                at += size;
                continue;
            }
        }
        switch (type) {
            case 2: case 3: case 4: case 5: case 6: case 85: case 86: case 87: case 88: case 89: {
                // POLYBEZIER, POLYGON, POLYLINE, POLYBEZIERTO, POLYLINETO (32- and 16-bit points)
                const small = type >= 85;
                const kind = small ? type - 83 : type;
                const count = u32(at + 24);
                if (!count || at + 28 + count * (small ? 4 : 8) > at + size) break;
                const pts = readPoints(at + 28, count, small);
                if (kind === 2) figure(`M${pt(pts[0])}${beziers(pts.slice(1))}`);
                else if (kind === 3) figure(`M${pt(pts[0])}${pts.slice(1).map(p => ` L${pt(p)}`).join("")} Z`, { fill: true });
                else if (kind === 4) figure(`M${pt(pts[0])}${pts.slice(1).map(p => ` L${pt(p)}`).join("")}`);
                else {
                    const start = path !== null ? "" : `M${pt(devicePos())}`;
                    figure(`${start}${kind === 5 ? beziers(pts) : pts.map(p => ` L${pt(p)}`).join("")}`);
                    dc.pos = lastLogical(at + 28, count, small);
                }
                break;
            }
            case 7: case 8: case 90: case 91: {
                // POLYPOLYLINE, POLYPOLYGON
                const small = type >= 90;
                const polygon = type === 8 || type === 91;
                const groups = u32(at + 24);
                const total = u32(at + 28);
                const pointsAt = at + 32 + groups * 4;
                if (pointsAt + total * (small ? 4 : 8) > at + size) break;
                const pts = readPoints(pointsAt, total, small);
                let d = "";
                let k = 0;
                for (let g = 0; g < groups; g++) {
                    const n = u32(at + 32 + g * 4);
                    const part = pts.slice(k, k + n);
                    k += n;
                    if (part.length) d += `M${pt(part[0])}${part.slice(1).map(p => ` L${pt(p)}`).join("")}${polygon ? " Z" : ""}`;
                }
                figure(d, { fill: polygon });
                break;
            }
            case 9: dc.winExt = [i32(at + 8), i32(at + 12)]; break;
            case 10: dc.winOrg = [i32(at + 8), i32(at + 12)]; break;
            case 11: dc.vpExt = [i32(at + 8), i32(at + 12)]; break;
            case 12: dc.vpOrg = [i32(at + 8), i32(at + 12)]; break;
            case 14: at = view.byteLength; continue; // EOF
            case 17: dc.mapMode = u32(at + 8); break;
            case 18: dc.bkMode = u32(at + 8); break;
            case 19: dc.fillRule = u32(at + 8) === 2 ? "nonzero" : "evenodd"; break;
            case 22: dc.textAlign = u32(at + 8); break;
            case 24: dc.textColor = colour(at + 8); break;
            case 25: dc.bkColor = colour(at + 8); break;
            case 27: {
                dc.pos = [i32(at + 8), i32(at + 12)];
                if (path !== null) path += `M${pt(devicePos())}`;
                break;
            }
            case 30: {
                // INTERSECTCLIPRECT
                setClip(rectPath(i32(at + 8), i32(at + 12), i32(at + 16), i32(at + 20)), true);
                break;
            }
            case 33: saved.push({ ...dc }); break;
            case 34: {
                const n = i32(at + 8);
                const index = n < 0 ? saved.length + n : n - 1;
                if (index >= 0 && index < saved.length) {
                    dc = saved[index];
                    saved.length = index;
                }
                break;
            }
            case 35: dc.world = [0, 4, 8, 12, 16, 20].map(k => view.getFloat32(at + 8 + k, true)); break;
            case 36: {
                const x = [0, 4, 8, 12, 16, 20].map(k => view.getFloat32(at + 8 + k, true));
                const mode = u32(at + 32);
                const mul = (p, q) => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3], p[4] * q[0] + p[5] * q[2] + q[4], p[4] * q[1] + p[5] * q[3] + q[5]];
                if (mode === 1) dc.world = [1, 0, 0, 1, 0, 0];
                else if (mode === 2) dc.world = mul(x, dc.world);
                else if (mode === 3) dc.world = mul(dc.world, x);
                else if (mode === 4) dc.world = x;
                break;
            }
            case 37: {
                const handle = u32(at + 8);
                const object = handle & 0x80000000 ? stockObjects[handle & 0x7fffffff] : objects.get(handle);
                if (object?.kind === "pen") dc.pen = object;
                else if (object?.kind === "brush") dc.brush = object;
                else if (object?.kind === "font") dc.font = object;
                break;
            }
            case 38: objects.set(u32(at + 8), { kind: "pen", style: u32(at + 12) & 0xf, width: i32(at + 16), color: colour(at + 24), geometric: true, cap: 0, join: 0 }); break;
            case 39: objects.set(u32(at + 8), { kind: "brush", style: u32(at + 12), color: colour(at + 16) }); break;
            case 40: objects.delete(u32(at + 8)); break;
            case 95: {
                const style = u32(at + 28);
                objects.set(u32(at + 8), {
                    kind: "pen",
                    style: style & 0xf,
                    width: u32(at + 32),
                    color: u32(at + 36) === 1 ? "none" : colour(at + 40),
                    geometric: Boolean(style & 0x10000),
                    cap: (style >> 8) & 0xf,
                    join: (style >> 12) & 0xf,
                });
                if (u32(at + 36) === 1) objects.get(u32(at + 8)).style = 5;
                break;
            }
            case 82: {
                const lf = at + 12;
                let face = "";
                for (let i = 0; i < 32; i++) {
                    const c = view.getUint16(lf + 28 + i * 2, true);
                    if (!c) break;
                    face += String.fromCharCode(c);
                }
                objects.set(u32(at + 8), {
                    kind: "font",
                    height: i32(lf),
                    escapement: i32(lf + 8),
                    weight: i32(lf + 16),
                    italic: Boolean(view.getUint8(lf + 20)),
                    underline: Boolean(view.getUint8(lf + 21)),
                    strike: Boolean(view.getUint8(lf + 22)),
                    charset: view.getUint8(lf + 23),
                    face,
                });
                break;
            }
            case 42: figure(ellipsePath(i32(at + 8), i32(at + 12), i32(at + 16), i32(at + 20)), { fill: true }); break;
            case 43: figure(rectPath(i32(at + 8), i32(at + 12), i32(at + 16), i32(at + 20)), { fill: true }); break;
            case 44: figure(roundRectPath(i32(at + 8), i32(at + 12), i32(at + 16), i32(at + 20), i32(at + 24), i32(at + 28)), { fill: true }); break;
            case 54: {
                const to = [i32(at + 8), i32(at + 12)];
                const from = devicePos();
                dc.pos = to;
                figure(`${path !== null ? "" : `M${pt(from)}`} L${pt(devicePos())}`);
                break;
            }
            case 58: dc.miter = view.getFloat32(at + 8, true) || 10; break;
            case 59: path = ""; break;
            case 60: lastPath = path; path = null; break;
            case 61: if (path !== null) path += " Z"; else if (lastPath !== null) lastPath += " Z"; break;
            case 62: case 63: case 64: {
                // FILLPATH, STROKEANDFILLPATH, STROKEPATH
                const d = path !== null ? path : lastPath;
                emit(d, { fill: type !== 64, stroke: type !== 62 });
                path = null;
                lastPath = null;
                break;
            }
            case 67: {
                // SELECTCLIPPATH: COPY and AND; other region operations leave the clip as it is
                const mode = u32(at + 8);
                const d = path !== null ? path : lastPath;
                if (d && (mode === 5 || mode === 1)) setClip(d, mode === 1);
                path = null;
                lastPath = null;
                break;
            }
            case 68: path = null; lastPath = null; break; // ABORTPATH
            case 75: {
                // EXTSELECTCLIPRGN: a region of device rectangles, or none (back to no clip)
                const bytes = u32(at + 8), mode = u32(at + 12);
                if (!bytes) {
                    if (mode === 5) dc.clip = null;
                    break;
                }
                const n = u32(at + 16 + 8);
                if (mode !== 5 && mode !== 1) break;
                let d = "";
                for (let i = 0; i < n && at + 48 + i * 16 + 16 <= at + size; i++) {
                    const [l, t, r, b] = [0, 4, 8, 12].map(k => i32(at + 48 + i * 16 + k));
                    d += `M${l} ${t} L${r} ${t} L${r} ${b} L${l} ${b} Z`;
                }
                if (d) setClip(d, mode === 1);
                break;
            }
            case 76: case 77: {
                // BITBLT, STRETCHBLT: a bitmap, or a rectangle filled with the brush (or black or white)
                const x = i32(at + 24), y = i32(at + 28), w = i32(at + 32), h = i32(at + 36);
                const rop = u32(at + 40);
                const cbBmi = u32(at + 88);
                if (!cbBmi) {
                    const fill = rop === 0x00000042 ? "#000000" : rop === 0x00ff0062 ? "#ffffff" : rop === 0x00f00021 && dc.brush?.style !== 1 ? dc.brush.color : null;
                    if (fill) {
                        body.push(`<path d="${rectPath(x, y, x + w, y + h)}" fill="${fill}"${clipAttr()}/>`);
                        drew = true;
                    }
                } else if (rop === 0x00cc0020) {
                    const srcW = type === 77 ? i32(at + 100) : w, srcH = type === 77 ? i32(at + 104) : h;
                    bitmap(at, u32(at + 84), cbBmi, u32(at + 92), u32(at + 96), i32(at + 44), i32(at + 48), srcW, srcH, x, y, w, h);
                }
                break;
            }
            case 81: {
                // STRETCHDIBITS
                const rop = u32(at + 68);
                if (rop === 0x00cc0020 || rop === 0) {
                    bitmap(at, u32(at + 48), u32(at + 52), u32(at + 56), u32(at + 60), i32(at + 32), i32(at + 36), i32(at + 40), i32(at + 44), i32(at + 24), i32(at + 28), i32(at + 72), i32(at + 76));
                }
                break;
            }
            case 83: case 84: text(at, type === 84); break;
            default: break;
        }
        at += size;
    }
    if (!drew) return null;
    const [x0, y0, x1, y1] = frame;
    const w = x1 - x0, h = y1 - y0;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[x0, y0, w, h].map(_pptxSvgNumber).join(" ")}" width="${_pptxSvgNumber(w)}" height="${_pptxSvgNumber(h)}" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("")}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// EMF+ records

// The EMF+ header an EMF carries in its first comments, or null: { dual } says a GDI copy of the drawing follows.
function _pptxEmfPlusHeader(view) {
    for (let at = 0, n = 0; at + 8 <= view.byteLength && n < 64; n++) {
        const type = view.getUint32(at, true), size = view.getUint32(at + 4, true);
        if (size < 8 || at + size > view.byteLength) break;
        if (type === 70 && size >= 28 && view.getUint32(at + 12, true) === 0x2b464d45 && view.getUint16(at + 16, true) === 0x4001) {
            return { dual: Boolean(view.getUint16(at + 18, true) & 1) };
        }
        at += size;
    }
    return null;
}

// A GDI+ bitmap object's pixels (or its PNG, JPEG, GIF or BMP file) as a data URL with its size; null when it is a
// pixel format this does not read.
function _pptxEmfPlusBitmap(v, end) {
    let width = v.getUint32(8, true), height = v.getUint32(12, true);
    const stride = v.getInt32(16, true), format = v.getUint32(20, true), kind = v.getUint32(24, true);
    if (kind === 1) {
        // A compressed bitmap keeps its file whole, and the size in the object may be left at zero: the file's own
        // header gives it (JPEG's from its frame header).
        const bytes = new Uint8Array(v.buffer, v.byteOffset + 28, Math.max(0, end - 28));
        if (bytes.length < 26) return null;
        const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        let mime = null;
        if (bytes[0] === 0x89 && bytes[1] === 0x50) [mime, width, height] = ["image/png", b.getUint32(16), b.getUint32(20)];
        else if (bytes[0] === 0x47 && bytes[1] === 0x49) [mime, width, height] = ["image/gif", b.getUint16(6, true), b.getUint16(8, true)];
        else if (bytes[0] === 0x42 && bytes[1] === 0x4d) [mime, width, height] = ["image/bmp", b.getInt32(18, true), Math.abs(b.getInt32(22, true))];
        else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            mime = "image/jpeg";
            for (let q = 2, k = 0; q + 9 < bytes.length && k < 1000; k++) {
                if (bytes[q] !== 0xff) break;
                const marker = bytes[q + 1];
                if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                    [height, width] = [b.getUint16(q + 5), b.getUint16(q + 7)];
                    break;
                }
                q += 2 + b.getUint16(q + 2);
            }
        }
        return mime ? { width, height, href: `data:${mime};base64,${_pptxBase64(bytes)}` } : null;
    }
    if (!width || !height || width * height > 40e6) return null;
    let q = 28;
    let palette = null;
    if (format & 0x10000) {
        // Indexed formats carry their colour table first.
        const count = Math.min(256, v.getUint32(q + 4, true));
        palette = Array.from({ length: count }, (_, i) => (q + 12 + i * 4 <= end ? [v.getUint8(q + 10 + i * 4), v.getUint8(q + 9 + i * 4), v.getUint8(q + 8 + i * 4), v.getUint8(q + 11 + i * 4)] : [0, 0, 0, 255]));
        q += 8 + count * 4;
    }
    const rowBytes = Math.abs(stride);
    if (!rowBytes || q + rowBytes * height > end) return null;
    const bits = (format >> 8) & 0xff;
    if (![0x30101, 0x30402, 0x30803, 0x21005, 0x21006, 0x61007, 0x21808, 0x22009, 0x26200a, 0xe200b].includes(format)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);
    const out = image.data;
    for (let y = 0; y < height; y++) {
        const row = q + (stride > 0 ? y : height - 1 - y) * rowBytes;
        for (let x = 0; x < width; x++) {
            let r, g, b, a = 255;
            if (palette) {
                const bit = x * bits;
                const index = (v.getUint8(row + (bit >> 3)) >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
                [r, g, b, a] = palette[index] || [0, 0, 0, 255];
            } else if (bits === 16) {
                const value = v.getUint16(row + x * 2, true);
                if (format === 0x21006) [r, g, b] = [((value >> 11) & 31) * 8.226, ((value >> 5) & 63) * 4.048, (value & 31) * 8.226];
                else [r, g, b] = [((value >> 10) & 31) * 8.226, ((value >> 5) & 31) * 8.226, (value & 31) * 8.226];
                if (format === 0x61007 && !(value & 0x8000)) a = 0;
            } else {
                const at = row + x * (bits / 8);
                [b, g, r] = [v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2)];
                if (format === 0x26200a || format === 0xe200b) a = v.getUint8(at + 3);
                if (format === 0xe200b && a > 0 && a < 255) [r, g, b] = [r, g, b].map(c => Math.min(255, Math.round((c * 255) / a)));
            }
            const o = (y * width + x) * 4;
            out[o] = r;
            out[o + 1] = g;
            out[o + 2] = b;
            out[o + 3] = a;
        }
    }
    context.putImageData(image, 0, 0);
    return { width, height, href: canvas.toDataURL("image/png") };
}

// Plays the EMF+ (GDI+) records of an EMF into `out` ({ body, defs, clip(d, parent, rule), frame, depth, drew() }),
// in the reference device's pixels like the GDI records. `records(start, end)` takes the records of one comment;
// `gdi` is set while a GetDC record hands drawing back to the GDI records that follow it.
function _pptxEmfPlusPlayer(view, out) {
    const I = [1, 0, 0, 1, 0, 0];
    const mul = (p, q) => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3], p[4] * q[0] + p[5] * q[2] + q[4], p[4] * q[1] + p[5] * q[3] + q[5]];
    const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
    const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const n = _pptxSvgNumber;
    const pt = p => `${n(p[0])} ${n(p[1])}`;
    const hex = c => Math.round(c).toString(16).padStart(2, "0");
    const argb = (v, at) => ({ kind: "solid", color: `#${hex(v.getUint8(at + 2))}${hex(v.getUint8(at + 1))}${hex(v.getUint8(at))}`, alpha: v.getUint8(at + 3) / 255 });
    const argbValue = value => ({ kind: "solid", color: `#${hex((value >> 16) & 255)}${hex((value >> 8) & 255)}${hex(value & 255)}`, alpha: (value >>> 24) / 255 });
    const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true), i32 = at => view.getInt32(at, true), f32 = at => view.getFloat32(at, true);

    let dpi = [96, 96];
    let st = { world: I, base: I, unit: 1, scale: 1, clip: null };
    const stack = [];
    const objects = new Map();
    let pending = null;
    let gradients = 0;
    const player = { gdi: false };

    // Page units to the device: pixels (and the display) as they are, the rest through the file's resolution.
    const unitFactor = (unit, axis) => ({ 3: dpi[axis] / 72, 4: dpi[axis], 5: dpi[axis] / 300, 6: dpi[axis] / 25.4 })[unit] || 1;
    const matrix = () => mul(mul(st.world, st.base), [unitFactor(st.unit, 0) * st.scale, 0, 0, unitFactor(st.unit, 1) * st.scale, 0, 0]);
    // A length in `unit` (a font's or a pen's) in world units. GDI+ leaves the page scale out of this: ChemDraw
    // draws at a page scale of 0.16 with its fonts in pixels, and they come out the size of world units.
    const toWorld = (value, unit) => (unit === 0 ? value : (value * unitFactor(unit, 0)) / unitFactor(st.unit, 0));

    // Points as records store them: floats, 16-bit integers (C), or each relative to the one before in 7 or 15 bits (P).
    const readPoints = (v, at, end, count, flags) => {
        if (!(count >= 0) || count > 1e6) return null;
        const pts = [];
        if (flags & 0x800) {
            let q = at, x = 0, y = 0;
            const read = () => {
                if (q >= end) throw new RangeError("short");
                const b = v.getUint8(q);
                if (b & 0x80) {
                    let value = ((b & 0x7f) << 8) | v.getUint8(q + 1);
                    if (value & 0x4000) value -= 0x8000;
                    q += 2;
                    return value;
                }
                q += 1;
                return b & 0x40 ? (b & 0x7f) - 0x80 : b & 0x7f;
            };
            for (let i = 0; i < count; i++) {
                x += read();
                y += read();
                pts.push([x, y]);
            }
            return { pts, after: q };
        }
        const small = flags & 0x4000;
        const step = small ? 4 : 8;
        if (at + count * step > end) return null;
        for (let i = 0; i < count; i++) pts.push(small ? [v.getInt16(at + i * 4, true), v.getInt16(at + i * 4 + 2, true)] : [v.getFloat32(at + i * 8, true), v.getFloat32(at + i * 8 + 4, true)]);
        return { pts, after: at + count * step };
    };
    const readRect = (at, small) => (small ? [0, 2, 4, 6].map(k => view.getInt16(at + k, true)) : [0, 4, 8, 12].map(k => f32(at + k)));
    const rectD = (r, m) => `M${pt(apply(m, [r[0], r[1]]))} L${pt(apply(m, [r[0] + r[2], r[1]]))} L${pt(apply(m, [r[0] + r[2], r[1] + r[3]]))} L${pt(apply(m, [r[0], r[1] + r[3]]))} Z`;
    const curveD = (pts, m) => {
        let d = `M${pt(apply(m, pts[0]))}`;
        for (let i = 1; i + 2 < pts.length; i += 3) d += ` C${pt(apply(m, pts[i]))} ${pt(apply(m, pts[i + 1]))} ${pt(apply(m, pts[i + 2]))}`;
        return d;
    };
    const linesD = (pts, m, close) => `M${pt(apply(m, pts[0]))}${pts.slice(1).map(p => ` L${pt(apply(m, p))}`).join("")}${close ? " Z" : ""}`;
    // GDI+ angles are degrees clockwise from +x, measured on the ellipse's own (stretched) circle.
    const arcPts = (r, startDeg, sweepDeg) => {
        const rx = r[2] / 2, ry = r[3] / 2;
        const param = a => Math.atan2(rx * Math.sin(a), ry * Math.cos(a));
        const a0 = (startDeg * Math.PI) / 180, sw = (sweepDeg * Math.PI) / 180;
        const t0 = param(a0);
        let delta = param(a0 + sw) - t0;
        if (Math.abs(sw) >= 2 * Math.PI - 1e-6) delta = Math.sign(sw) * 2 * Math.PI;
        else {
            while (sw > 0 && delta < 0) delta += 2 * Math.PI;
            while (sw < 0 && delta > 0) delta -= 2 * Math.PI;
        }
        return _pptxArcPoints(r[0] + rx, r[1] + ry, rx, ry, t0, delta);
    };
    // A cardinal spline (GDI+ curves) as Bézier points: the start, then three a segment.
    const splinePts = (pts, tension, closed) => {
        const k = 0.3 * tension;
        const count = pts.length;
        const get = i => (closed ? pts[(i + count) % count] : pts[Math.max(0, Math.min(count - 1, i))]);
        const out = [pts[0]];
        const segments = closed ? count : count - 1;
        for (let i = 0; i < segments; i++) {
            const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
            out.push([p1[0] + k * (p2[0] - p0[0]), p1[1] + k * (p2[1] - p0[1])], [p2[0] - k * (p3[0] - p1[0]), p2[1] - k * (p3[1] - p1[1])], p2);
        }
        return out;
    };

    // ----- objects
    const parseBrush = (v, at, end) => {
        const type = v.getUint32(at + 4, true);
        const p = at + 8;
        if (type === 0) return argb(v, p);
        if (type === 1) return { ...argb(v, p + 4), hatch: true }; // a hatch as a pale wash of its colour
        if (type === 3) {
            // A path gradient as the mean of its centre and first surrounding colours.
            const centre = argb(v, p + 8);
            const surround = v.getUint32(p + 20, true) ? argb(v, p + 24) : centre;
            const mix = k => Math.round((parseInt(centre.color.slice(k, k + 2), 16) + parseInt(surround.color.slice(k, k + 2), 16)) / 2);
            return { kind: "solid", color: `#${hex(mix(1))}${hex(mix(3))}${hex(mix(5))}`, alpha: (centre.alpha + surround.alpha) / 2 };
        }
        if (type === 4) {
            const flags = v.getUint32(p, true);
            const rect = [0, 4, 8, 12].map(k => v.getFloat32(p + 8 + k, true));
            const startColour = argb(v, p + 24), endColour = argb(v, p + 28);
            let q = p + 40;
            let transform = null;
            if (flags & 0x2) {
                transform = [0, 4, 8, 12, 16, 20].map(k => v.getFloat32(q + k, true));
                q += 24;
            }
            let stops = [[0, startColour], [1, endColour]];
            if (flags & 0x4 && q + 4 <= end) {
                const count = Math.min(64, v.getUint32(q, true));
                if (q + 4 + count * 8 <= end) stops = Array.from({ length: count }, (_, i) => [v.getFloat32(q + 4 + i * 4, true), argb(v, q + 4 + count * 4 + i * 4)]);
            } else if (flags & 0x8 && q + 4 <= end) {
                const count = Math.min(64, v.getUint32(q, true));
                if (q + 4 + count * 8 <= end) {
                    const lerp = (f, k) => Math.round(parseInt(startColour.color.slice(k, k + 2), 16) * (1 - f) + parseInt(endColour.color.slice(k, k + 2), 16) * f);
                    stops = Array.from({ length: count }, (_, i) => {
                        const f = v.getFloat32(q + 4 + count * 4 + i * 4, true);
                        return [v.getFloat32(q + 4 + i * 4, true), { color: `#${hex(lerp(f, 1))}${hex(lerp(f, 3))}${hex(lerp(f, 5))}`, alpha: startColour.alpha * (1 - f) + endColour.alpha * f }];
                    });
                }
            }
            return { kind: "linear", rect, transform, stops, alpha: Math.max(startColour.alpha, endColour.alpha) };
        }
        return { kind: "solid", color: "#808080", alpha: 1 }; // a texture, drawn grey
    };
    const parsePen = (v, at, end) => {
        const flags = v.getUint32(at + 8, true);
        const pen = { kind: "pen", unit: v.getUint32(at + 12, true), width: v.getFloat32(at + 16, true), cap: 0, join: 0, miter: 10, style: 0, dashes: null };
        let q = at + 20;
        if (flags & 0x1) q += 24;
        if (flags & 0x2) (pen.cap = v.getInt32(q, true)), (q += 4);
        if (flags & 0x4) q += 4;
        if (flags & 0x8) (pen.join = v.getInt32(q, true)), (q += 4);
        if (flags & 0x10) (pen.miter = v.getFloat32(q, true)), (q += 4);
        if (flags & 0x20) (pen.style = v.getInt32(q, true)), (q += 4);
        if (flags & 0x40) q += 4;
        if (flags & 0x80) q += 4;
        if (flags & 0x100) {
            const count = Math.min(64, v.getUint32(q, true));
            pen.dashes = Array.from({ length: count }, (_, i) => v.getFloat32(q + 4 + i * 4, true));
            q += 4 + count * 4;
        }
        if (flags & 0x200) q += 4;
        if (flags & 0x400) q += 4 + v.getUint32(q, true) * 4;
        if (flags & 0x800) q += 4 + v.getUint32(q, true);
        if (flags & 0x1000) q += 4 + v.getUint32(q, true);
        pen.brush = q + 12 <= end ? parseBrush(v, q, end) : { kind: "solid", color: "#000000", alpha: 1 };
        return pen;
    };
    const parsePath = (v, at, end) => {
        const count = v.getUint32(at + 4, true), flags = v.getUint32(at + 8, true);
        const read = readPoints(v, at + 12, end, count, flags);
        if (!read) return null;
        const types = [];
        let q = read.after;
        if (flags & 0x1000) {
            // Run-length coded types: a run's length (and a Bézier bit), then the type
            while (types.length < count && q + 2 <= end) {
                const run = v.getUint8(q) & 0x3f, type = v.getUint8(q + 1);
                for (let k = 0; k < run && types.length < count; k++) types.push(type);
                q += 2;
            }
        } else for (let i = 0; i < count && q + i < end; i++) types.push(v.getUint8(q + i));
        return { kind: "path", pts: read.pts, types };
    };
    const pathD = (path, m) => {
        const { pts, types } = path;
        let d = "";
        for (let i = 0; i < pts.length; ) {
            const type = (types[i] || 0) & 7;
            let last = i;
            if (type === 0 || !d) d += `${d ? " " : ""}M${pt(apply(m, pts[i]))}`;
            else if (type === 3 && i + 2 < pts.length) {
                d += ` C${pt(apply(m, pts[i]))} ${pt(apply(m, pts[i + 1]))} ${pt(apply(m, pts[i + 2]))}`;
                last = i + 2;
            } else d += ` L${pt(apply(m, pts[i]))}`;
            if ((types[last] || 0) & 0x80) d += " Z";
            i = last + 1;
        }
        return d;
    };
    // A region as a path (device units), or "all" for the infinite region. Unions and intersections with the
    // infinite region are read; other combinations take their first part.
    const parseRegionNode = (v, q, end, depth) => {
        if (q + 4 > end || depth > 32) return { node: null, after: end };
        const type = v.getUint32(q, true);
        if (type === 0x10000000) return { node: { rect: [0, 4, 8, 12].map(k => v.getFloat32(q + 4 + k, true)) }, after: q + 20 };
        if (type === 0x10000001) {
            const size = v.getUint32(q + 4, true);
            return { node: { path: parsePath(v, q + 8, Math.min(end, q + 8 + size)) }, after: q + 8 + size };
        }
        if (type === 0x10000002) return { node: { empty: true }, after: q + 4 };
        if (type === 0x10000003) return { node: { all: true }, after: q + 4 };
        const left = parseRegionNode(v, q + 4, end, depth + 1);
        const right = parseRegionNode(v, left.after, end, depth + 1);
        return { node: { op: type, left: left.node, right: right.node }, after: right.after };
    };
    const regionD = (node, m) => {
        if (!node) return "";
        if (node.all) return "all";
        if (node.empty) return "";
        if (node.rect) return rectD(node.rect, m);
        if (node.path) return pathD(node.path, m);
        const a = regionD(node.left, m), b = regionD(node.right, m);
        if (node.op === 1) return a === "all" ? b : a; // intersect
        if (node.op === 2) return a === "all" || b === "all" ? "all" : `${a} ${b}`; // union
        return a;
    };
    const parseImage = (v, end) => {
        const type = v.getUint32(4, true);
        if (type === 1) return { kind: "image", lazy: () => _pptxEmfPlusBitmap(v, end) };
        if (type === 2 && out.depth < 3) {
            const kind = v.getUint32(8, true), size = Math.min(v.getUint32(12, true), end - 16);
            return {
                kind: "image",
                metafile: true,
                lazy: () => {
                    const data = new Uint8Array(v.buffer, v.byteOffset + 16, size).slice().buffer;
                    const svg = kind <= 2 ? _pptxWmfSvg(data, out.depth + 1) : _pptxEmfSvg(data, out.depth + 1);
                    if (!svg) return null;
                    const box = /viewBox="[^ ]+ [^ ]+ ([^ ]+) ([^"]+)"/.exec(svg);
                    return { width: Number(box[1]), height: Number(box[2]), href: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
                },
            };
        }
        return null;
    };
    const parseObject = (type, v) => {
        const end = v.byteLength;
        if (type === 1) return parseBrush(v, 0, end);
        if (type === 2) return parsePen(v, 0, end);
        if (type === 3) return parsePath(v, 0, end);
        if (type === 4) return { kind: "region", node: parseRegionNode(v, 8, end, 0).node };
        if (type === 5) return parseImage(v, end);
        if (type === 6) {
            const length = Math.min(v.getUint32(20, true), (end - 24) >> 1);
            const face = String.fromCharCode(...Array.from({ length }, (_, i) => v.getUint16(24 + i * 2, true)));
            const style = v.getInt32(12, true);
            return { kind: "font", size: v.getFloat32(4, true), unit: v.getUint32(8, true), bold: Boolean(style & 1), italic: Boolean(style & 2), underline: Boolean(style & 4), strike: Boolean(style & 8), face };
        }
        if (type === 7) return { kind: "format", flags: v.getUint32(4, true), align: v.getUint32(12, true), lineAlign: v.getUint32(16, true) };
        return null;
    };
    const finishPending = () => {
        if (!pending) return;
        const bytes = new Uint8Array(pending.size);
        let k = 0;
        for (const part of pending.parts) {
            bytes.set(part.subarray(0, Math.min(part.length, bytes.length - k)), k);
            k += part.length;
        }
        const object = parseObject(pending.type, new DataView(bytes.buffer));
        if (object) objects.set(pending.id, object);
        else objects.delete(pending.id);
        pending = null;
    };
    // An object larger than a record goes in pieces, each marked as continued and giving the whole size.
    const objectRecord = (flags, p, e) => {
        const id = flags & 0xff, type = (flags >> 8) & 0x7f;
        if (flags & 0x8000) {
            if (!pending || pending.id !== id) {
                finishPending();
                pending = { id, type, size: Math.min(u32(p), 256e6), parts: [], have: 0 };
            }
            const part = new Uint8Array(view.buffer, view.byteOffset + p + 4, e - p - 4);
            pending.parts.push(part);
            pending.have += part.length;
            if (pending.have >= pending.size) finishPending();
            return;
        }
        if (pending && pending.id === id) {
            pending.parts.push(new Uint8Array(view.buffer, view.byteOffset + p, e - p));
            finishPending();
            return;
        }
        finishPending();
        const object = parseObject(type, new DataView(view.buffer, view.byteOffset + p, e - p));
        if (object) objects.set(id, object);
        else objects.delete(id);
    };

    // ----- drawing
    const push = markup => {
        out.body.push(st.clip ? `<g clip-path="url(#${st.clip})">${markup}</g>` : markup);
        out.drew();
    };
    const brushOf = (flags, value) => (flags & 0x8000 ? argbValue(value) : objects.get(value));
    // Paint for a fill or stroke; `gm` places a gradient's world coordinates where the shape is drawn.
    const paint = (brush, gm, what) => {
        if (!brush || !(brush.alpha > 0)) return null;
        if (brush.kind === "linear") {
            const id = `emfgrad${++gradients}`;
            const [x, y, w] = brush.rect;
            const g = brush.transform ? mul(brush.transform, gm) : gm;
            const stops = brush.stops.map(([offset, c]) => `<stop offset="${n(Math.max(0, Math.min(1, offset)))}" stop-color="${c.color}"${c.alpha < 1 ? ` stop-opacity="${n(c.alpha)}"` : ""}/>`).join("");
            out.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x)}" y1="${n(y)}" x2="${n(x + w)}" y2="${n(y)}" gradientTransform="matrix(${g.map(n).join(" ")})">${stops}</linearGradient>`);
            return ` ${what}="url(#${id})"`;
        }
        if (brush.kind !== "solid") return null;
        const alpha = brush.alpha * (brush.hatch ? 0.35 : 1);
        return ` ${what}="${brush.color}"${alpha < 1 ? ` ${what}-opacity="${n(alpha)}"` : ""}`;
    };
    const strokeOf = (pen, m) => {
        if (!pen || pen.kind !== "pen") return null;
        const colour = paint(pen.brush, m, "stroke");
        if (!colour) return null;
        const width = pen.width > 0 ? toWorld(pen.width, pen.unit) * scaleOf(m) : 1;
        const unit = Math.max(width, 1);
        const dash = pen.style === 5 && pen.dashes?.length ? pen.dashes : { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[pen.style];
        const cap = { 1: "square", 2: "round" }[pen.cap] || "butt";
        const join = { 1: "bevel", 2: "round" }[pen.join] || "miter";
        return `${colour} stroke-width="${n(width)}" stroke-linecap="${cap}" stroke-linejoin="${join}"${join === "miter" ? ` stroke-miterlimit="${n(Math.max(1, pen.miter))}"` : ""}${dash ? ` stroke-dasharray="${dash.map(k => n(Math.max(0.01, k) * unit)).join(" ")}"` : ""}`;
    };
    const fill = (d, brush, m, rule = "evenodd") => {
        const colour = d && paint(brush, m, "fill");
        if (colour) push(`<path d="${d}"${colour} fill-rule="${rule}" stroke="none"/>`);
    };
    const stroke = (d, pen, m) => {
        const attrs = d && strokeOf(pen, m);
        if (attrs) push(`<path d="${d}" fill="none"${attrs}/>`);
    };
    const image = (object, src, corners) => {
        if (!object || object.kind !== "image") return;
        if (object.done === undefined) object.done = object.lazy() || null;
        const picture = object.done;
        if (!picture) return;
        const m = matrix();
        const [a, b, c] = corners.map(p => apply(m, p));
        const t = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]];
        const whole = object.metafile || (src[2] <= 0 || src[3] <= 0) || (Math.abs(src[0]) < 0.5 && Math.abs(src[1]) < 0.5 && Math.abs(src[2] - picture.width) < 0.5 && Math.abs(src[3] - picture.height) < 0.5);
        const inner = whole
            ? `<image width="1" height="1" preserveAspectRatio="none" href="${picture.href}"/>`
            : `<svg width="1" height="1" viewBox="${src.map(n).join(" ")}" preserveAspectRatio="none"><image width="${picture.width}" height="${picture.height}" href="${picture.href}"/></svg>`;
        push(`<g transform="matrix(${t.map(n).join(" ")})">${inner}</g>`);
    };
    let measurer = null;
    const measure = (s, font) => {
        if (!measurer) measurer = document.createElement("canvas").getContext("2d");
        measurer.font = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}100px ${_pptxMetafileFamily(font.face, false)}`;
        return measurer.measureText(s).width / 100;
    };
    const textAttrs = (font, size) => {
        const symbol = /^symbol$/i.test(font.face);
        const decoration = [font.underline ? "underline" : "", font.strike ? "line-through" : ""].filter(Boolean).join(" ");
        return ` font-family="${_pptxSvgEscape(_pptxMetafileFamily(font.face, symbol))}" font-size="${n(size)}"${font.bold ? ' font-weight="bold"' : ""}${font.italic ? ' font-style="italic"' : ""}${decoration ? ` text-decoration="${decoration}"` : ""}`;
    };
    const unicode = (codes, font) => _pptxMetafileChars(codes, { face: font.face, charset: /^symbol$/i.test(font.face) ? 2 : 0 }).join("");
    // DrawString: text laid out in a rectangle as GDI+ does it, line by line, wrapped at spaces to the width (unless
    // the format says not to), aligned by the string format, with GDI+'s sixth-of-an-em margin at the sides.
    const drawString = (font, brush, format, rect, string) => {
        if (!font || font.kind !== "font") return;
        const m = matrix();
        const colour = paint(brush, I, "fill");
        if (!colour) return;
        const size = toWorld(font.size, font.unit);
        if (!(size > 0)) return;
        const pad = size / 6;
        const lines = [];
        const wrap = rect[2] > 0 && !(format?.flags & 0x1000);
        for (const paragraph of string.split(/\r\n|\n|\r/)) {
            if (!wrap) {
                lines.push(paragraph);
                continue;
            }
            let line = "";
            for (const word of paragraph.split(/(?<= )/)) {
                if (line && measure(line + word.trimEnd(), font) * size > rect[2] - 2 * pad) {
                    lines.push(line.trimEnd());
                    line = word;
                } else line += word;
            }
            lines.push(line.trimEnd());
        }
        const lineHeight = size * 1.15;
        const total = lines.length * lineHeight;
        const lineAlign = format?.lineAlign || 0, align = format?.align || 0;
        let top = rect[1];
        if (rect[3] > 0 && lineAlign === 1) top += (rect[3] - total) / 2;
        else if (rect[3] > 0 && lineAlign === 2) top += rect[3] - total;
        const x = align === 1 ? rect[0] + rect[2] / 2 : align === 2 ? rect[0] + rect[2] - pad : rect[0] + pad;
        const anchor = align === 1 ? ' text-anchor="middle"' : align === 2 ? ' text-anchor="end"' : "";
        const markup = lines
            .map((line, i) => (line.trim() ? `<text x="${n(x)}" y="${n(top + i * lineHeight + 0.9 * size)}"${anchor}${textAttrs(font, size)}${colour} xml:space="preserve">${_pptxSvgEscape(line)}</text>` : ""))
            .join("");
        if (markup) push(`<g transform="matrix(${m.map(n).join(" ")})">${markup}</g>`);
    };

    const clipTo = (d, combine) => {
        if (d === "all") {
            if (combine === 0) st.clip = null;
            return;
        }
        if (combine === 0) st.clip = out.clip(d || "M0 0 Z", null);
        else if (combine === 1) st.clip = out.clip(d || "M0 0 Z", st.clip);
        else if (combine === 4 && d) {
            const [x0, y0, x1, y1] = out.frame;
            const w = x1 - x0, h = y1 - y0;
            st.clip = out.clip(`M${n(x0 - 10 * w)} ${n(y0 - 10 * h)} L${n(x1 + 10 * w)} ${n(y0 - 10 * h)} L${n(x1 + 10 * w)} ${n(y1 + 10 * h)} L${n(x0 - 10 * w)} ${n(y1 + 10 * h)} Z ${d}`, st.clip, "evenodd");
        }
        // union, exclusive-or and complement leave the clip as it is
    };

    const record = (type, flags, p, e) => {
        switch (type) {
            case 0x4001: dpi = [u32(p + 8) || 96, u32(p + 12) || 96]; break;
            case 0x4004: player.gdi = true; break;
            case 0x4008: objectRecord(flags, p, e); break;
            case 0x4009: {
                const brush = argbValue(u32(p));
                const [x0, y0, x1, y1] = out.frame;
                if (brush.alpha > 0) push(`<path d="M${n(x0)} ${n(y0)} L${n(x1)} ${n(y0)} L${n(x1)} ${n(y1)} L${n(x0)} ${n(y1)} Z"${paint(brush, I, "fill")}/>`);
                break;
            }
            case 0x400a: case 0x400b: {
                // FillRects, DrawRects
                const filled = type === 0x400a;
                const q = filled ? p + 4 : p;
                const count = u32(q), step = flags & 0x4000 ? 8 : 16;
                if (count > 1e5 || q + 4 + count * step > e) break;
                const m = matrix();
                const d = Array.from({ length: count }, (_, i) => rectD(readRect(q + 4 + i * step, flags & 0x4000), m)).join(" ");
                if (filled) fill(d, brushOf(flags, u32(p)), m);
                else stroke(d, objects.get(flags & 0xff), m);
                break;
            }
            case 0x400c: {
                const read = readPoints(view, p + 8, e, u32(p + 4), flags);
                if (read?.pts.length) fill(linesD(read.pts, matrix(), true), brushOf(flags, u32(p)), matrix(), flags & 0x2000 ? "nonzero" : "evenodd");
                break;
            }
            case 0x400d: case 0x4019: {
                // DrawLines, DrawBeziers
                const read = readPoints(view, p + 4, e, u32(p), flags);
                if (!read?.pts.length) break;
                const m = matrix();
                stroke(type === 0x400d ? linesD(read.pts, m, flags & 0x2000) : curveD(read.pts, m), objects.get(flags & 0xff), m);
                break;
            }
            case 0x400e: case 0x400f: {
                const filled = type === 0x400e;
                const r = readRect(filled ? p + 4 : p, flags & 0x4000);
                const m = matrix();
                const d = `${curveD(arcPts(r, 0, 360), m)} Z`;
                if (filled) fill(d, brushOf(flags, u32(p)), m);
                else stroke(d, objects.get(flags & 0xff), m);
                break;
            }
            case 0x4010: case 0x4011: case 0x4012: {
                // FillPie, DrawPie, DrawArc
                const filled = type === 0x4010;
                const q = filled ? p + 4 : p;
                const r = readRect(q + 8, flags & 0x4000);
                const m = matrix();
                let d = curveD(arcPts(r, f32(q), f32(q + 4)), m);
                if (type !== 0x4012) d += ` L${pt(apply(m, [r[0] + r[2] / 2, r[1] + r[3] / 2]))} Z`;
                if (filled) fill(d, brushOf(flags, u32(p)), m);
                else stroke(d, objects.get(flags & 0xff), m);
                break;
            }
            case 0x4013: {
                const region = objects.get(flags & 0xff);
                if (region?.kind !== "region") break;
                const m = matrix();
                let d = regionD(region.node, m);
                if (d === "all") {
                    const [x0, y0, x1, y1] = out.frame;
                    d = `M${n(x0)} ${n(y0)} L${n(x1)} ${n(y0)} L${n(x1)} ${n(y1)} L${n(x0)} ${n(y1)} Z`;
                }
                fill(d, brushOf(flags, u32(p)), m);
                break;
            }
            case 0x4014: case 0x4015: {
                const path = objects.get(flags & 0xff);
                if (path?.kind !== "path" || !path.pts.length) break;
                const m = matrix();
                if (type === 0x4014) fill(pathD(path, m), brushOf(flags, u32(p)), m);
                else stroke(pathD(path, m), objects.get(u32(p)), m);
                break;
            }
            case 0x4016: case 0x4017: case 0x4018: {
                // FillClosedCurve, DrawClosedCurve, DrawCurve: cardinal splines
                const filled = type === 0x4016;
                let q = filled ? p + 4 : p;
                const tension = f32(q);
                let offset = 0, segments = 0;
                if (type === 0x4018) {
                    offset = u32(q + 4);
                    segments = u32(q + 8);
                    q += 8;
                }
                const read = readPoints(view, q + 8, e, u32(q + 4), flags);
                if (!read || read.pts.length < 2) break;
                let bez = splinePts(read.pts, tension, type !== 0x4018);
                if (type === 0x4018 && segments) bez = bez.slice(offset * 3, (offset + segments) * 3 + 1);
                if (bez.length < 4) break;
                const m = matrix();
                const d = curveD(bez, m) + (type !== 0x4018 ? " Z" : "");
                if (filled) fill(d, brushOf(flags, u32(p)), m, flags & 0x2000 ? "nonzero" : "evenodd");
                else stroke(d, objects.get(flags & 0xff), m);
                break;
            }
            case 0x401a: {
                const r = readRect(p + 24, flags & 0x4000);
                image(objects.get(flags & 0xff), [0, 4, 8, 12].map(k => f32(p + 8 + k)), [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]]]);
                break;
            }
            case 0x401b: {
                const read = readPoints(view, p + 28, e, Math.min(3, u32(p + 24)), flags);
                if (read?.pts.length === 3) image(objects.get(flags & 0xff), [0, 4, 8, 12].map(k => f32(p + 8 + k)), read.pts);
                break;
            }
            case 0x401c: {
                const length = Math.min(u32(p + 8), (e - p - 28) >> 1);
                const codes = Array.from({ length: Math.max(0, length) }, (_, i) => u16(p + 28 + i * 2));
                const font = objects.get(flags & 0xff);
                if (font?.kind === "font") drawString(font, brushOf(flags, u32(p)), objects.get(u32(p + 4)), [0, 4, 8, 12].map(k => f32(p + 12 + k)), unicode(codes, font));
                break;
            }
            case 0x4036: {
                // DrawDriverString: characters (when the cmap flag says they are not glyph numbers) at their own points
                const font = objects.get(flags & 0xff);
                const options = u32(p + 4), hasMatrix = u32(p + 8), count = u32(p + 12);
                if (font?.kind !== "font" || !(options & 1) || !count || p + 16 + count * 10 > e) break;
                const codes = Array.from({ length: count }, (_, i) => u16(p + 16 + i * 2));
                const at = p + 16 + count * 2;
                const positions = Array.from({ length: count }, (_, i) => [f32(at + i * 8), f32(at + i * 8 + 4)]);
                const colour = paint(brushOf(flags, u32(p)), I, "fill");
                const size = toWorld(font.size, font.unit);
                if (!colour || !(size > 0)) break;
                let m = matrix();
                if (hasMatrix && at + count * 8 + 24 <= e) m = mul([0, 4, 8, 12, 16, 20].map(k => f32(at + count * 8 + k)), m);
                const chars = _pptxMetafileChars(codes, { face: font.face, charset: /^symbol$/i.test(font.face) ? 2 : 0 });
                const kept = chars.map((c, i) => [c, positions[i]]).filter(([c]) => c && c !== " " && c !== "\u0000");
                if (!kept.length) break;
                // With realized advances only the first point is given; the font's own advances place the rest.
                const placed = options & 4 ? `x="${n(positions[0][0])}" y="${n(positions[0][1])}"` : `x="${kept.map(([, q]) => n(q[0])).join(" ")}" y="${kept.map(([, q]) => n(q[1])).join(" ")}"`;
                const content = options & 4 ? chars.join("") : kept.map(([c]) => c).join("");
                push(`<text transform="matrix(${m.map(n).join(" ")})" ${placed}${textAttrs(font, size)}${colour} xml:space="preserve">${_pptxSvgEscape(content)}</text>`);
                break;
            }
            case 0x4025: stack.push({ index: u32(p), state: { ...st } }); break;
            case 0x4026: case 0x4029: {
                const index = u32(p);
                for (let k = stack.length - 1; k >= 0; k--) {
                    if (stack[k].index === index) {
                        st = stack[k].state;
                        stack.length = k;
                        break;
                    }
                }
                break;
            }
            case 0x4027: {
                // BeginContainer: the source rectangle mapped onto the destination (in the given unit), on top of
                // the transform in force
                const dest = [0, 4, 8, 12].map(k => f32(p + k)), src = [0, 4, 8, 12].map(k => f32(p + 16 + k));
                stack.push({ index: u32(p + 32), state: { ...st } });
                const unit = toWorld(1, flags & 0xff);
                const sx = src[2] ? (dest[2] * unit) / src[2] : 1, sy = src[3] ? (dest[3] * unit) / src[3] : 1;
                st.base = mul(mul([sx, 0, 0, sy, dest[0] * unit - src[0] * sx, dest[1] * unit - src[1] * sy], st.world), st.base);
                st.world = I;
                break;
            }
            case 0x4028: {
                stack.push({ index: u32(p), state: { ...st } });
                st.base = mul(st.world, st.base);
                st.world = I;
                break;
            }
            case 0x402a: st.world = [0, 4, 8, 12, 16, 20].map(k => f32(p + k)); break;
            case 0x402b: st.world = I; break;
            case 0x402c: case 0x402d: case 0x402e: case 0x402f: {
                let x;
                if (type === 0x402c) x = [0, 4, 8, 12, 16, 20].map(k => f32(p + k));
                else if (type === 0x402d) x = [1, 0, 0, 1, f32(p), f32(p + 4)];
                else if (type === 0x402e) x = [f32(p), 0, 0, f32(p + 4), 0, 0];
                else {
                    const a = (f32(p) * Math.PI) / 180;
                    x = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
                }
                st.world = flags & 0x2000 ? mul(st.world, x) : mul(x, st.world);
                break;
            }
            case 0x4030: {
                st.unit = flags & 0xff;
                st.scale = f32(p) || 1;
                break;
            }
            case 0x4031: st.clip = null; break;
            case 0x4032: clipTo(rectD([0, 4, 8, 12].map(k => f32(p + k)), matrix()), (flags >> 8) & 0xf); break;
            case 0x4033: {
                const path = objects.get(flags & 0xff);
                if (path?.kind === "path") clipTo(pathD(path, matrix()), (flags >> 8) & 0xf);
                break;
            }
            case 0x4034: {
                const region = objects.get(flags & 0xff);
                if (region?.kind === "region") clipTo(regionD(region.node, matrix()), (flags >> 8) & 0xf);
                break;
            }
            default: break;
        }
    };

    player.records = (start, end) => {
        for (let at = start, count = 0; at + 12 <= end && count < 1e6; count++) {
            const type = u16(at), flags = u16(at + 2), size = u32(at + 4), dataSize = u32(at + 8);
            if (size < 12 || at + size > end) break;
            if (type !== 0x4008) finishPending();
            if (type !== 0x4004) player.gdi = false;
            try {
                record(type, flags, at + 12, at + 12 + Math.min(dataSize, size - 12));
            } catch {
                // a malformed record is left out
            }
            at += size;
        }
    };
    player.finish = finishPending;
    return player;
}

// ---------------------------------------------------------------------------------------------------------------
// WMF drawings

// The Windows code page of each font character set, for the bytes of a WMF string.
const PPTX_CHARSET_ENCODINGS = { 0: "windows-1252", 1: "windows-1252", 77: "macintosh", 128: "shift_jis", 129: "euc-kr", 134: "gbk", 136: "big5", 161: "windows-1253", 162: "windows-1254", 163: "windows-1258", 177: "windows-1255", 178: "windows-1256", 186: "windows-1257", 204: "windows-1251", 222: "windows-874", 238: "windows-1250" };
const _pptxDecoders = {};

// The characters of an ANSI string in the font's code page, one per byte where the code page has one byte a
// character (else fewer, and the caller drops the per-byte advances).
function _pptxAnsiChars(bytes, charset) {
    const label = PPTX_CHARSET_ENCODINGS[charset] || "windows-1252";
    if (_pptxDecoders[label] === undefined) {
        try {
            _pptxDecoders[label] = new TextDecoder(label);
        } catch {
            _pptxDecoders[label] = null;
        }
    }
    const decoder = _pptxDecoders[label];
    if (!decoder) return Array.from(bytes, b => String.fromCharCode(b));
    if ([128, 129, 134, 136].includes(charset)) return Array.from(decoder.decode(bytes));
    return Array.from(bytes, b => decoder.decode(Uint8Array.of(b)));
}

// The size of the BITMAPINFO (header, bit masks and colour table) of a DIB stored in a record; null when it is not a
// DIB `_pptxDibCanvas` reads.
function _pptxDibInfoSize(view, dib, end) {
    if (dib + 40 > end) return null;
    const headerSize = view.getUint32(dib, true);
    if (headerSize < 40 || headerSize > 124) return null;
    const bitCount = view.getUint16(dib + 14, true);
    const compression = view.getUint32(dib + 16, true);
    const used = view.getUint32(dib + 32, true);
    const entries = bitCount <= 8 ? used || 1 << bitCount : used;
    const size = headerSize + (compression === 3 && headerSize === 40 ? 12 : 0) + entries * 4;
    return dib + size < end ? size : null;
}

// A Windows Metafile (the 16-bit format MathType, Equation Editor and older Office save) as an SVG document, or null
// when it holds nothing this draws. With or without the placeable header. The picture is the first window the file
// sets (a player maps that onto the frame), else the placeable bounds; the drawing is placed in it in logical units.
// Viewport records are left out: players set the viewport to the frame themselves, and files rarely change it.
function _pptxWmfSvg(buffer, depth = 0) {
    try {
        return _pptxWmfDraw(new DataView(buffer), depth);
    } catch {
        return null;
    }
}

function _pptxWmfDraw(view) {
    const length = view.byteLength;
    if (length < 18) return null;
    const u16 = at => view.getUint16(at, true);
    const i16 = at => view.getInt16(at, true);
    const u32 = at => view.getUint32(at, true);
    const colour = at => `#${[0, 1, 2].map(k => view.getUint8(at + k).toString(16).padStart(2, "0")).join("")}`;
    let start = 0, bounds = null, inch = 0;
    if (u32(0) === 0x9ac6cdd7) {
        if (length < 40) return null;
        bounds = [i16(6), i16(8), i16(10), i16(12)];
        inch = u16(14);
        start = 22;
        // GDI+ pads the placeable header it keeps inside EMF+ to 24 bytes.
        if (u16(22) === 0 && u16(26) === 9 && (u16(24) === 1 || u16(24) === 2)) start = 24;
    }
    if ((u16(start) !== 1 && u16(start) !== 2) || u16(start + 2) !== 9) return null;
    const first = start + 18;
    let org = null, ext = null;
    for (let at = first, n = 0; at + 6 <= length && n < 200000; n++) {
        const size = u32(at) * 2, fn = u16(at + 4);
        if (size < 6 || at + size > length || !fn) break;
        if (fn === 0x020b && !org) org = [i16(at + 8), i16(at + 6)];
        else if (fn === 0x020c && !ext) ext = [i16(at + 8), i16(at + 6)];
        if (org && ext) break;
        at += size;
    }
    if (!ext || !ext[0] || !ext[1]) {
        if (!bounds || bounds[2] === bounds[0] || bounds[3] === bounds[1]) return null;
        ext = [bounds[2] - bounds[0], bounds[3] - bounds[1]];
        org = org || [bounds[0], bounds[1]];
    }
    org = org || [0, 0];
    const W = Math.abs(ext[0]), H = Math.abs(ext[1]);
    // One device pixel in the picture's units, for hairlines: from the placeable header's size in inches (at 96 dpi),
    // else taking the units as twips, as MathType writes them.
    const inches = bounds && inch ? Math.abs(bounds[2] - bounds[0]) / inch : W / 1440;
    const hair = inches > 0 ? W / (inches * 96) : W / 1000;

    const objects = [];
    const addObject = object => {
        let index = objects.indexOf(null);
        if (index < 0) index = objects.length;
        if (index > 65535) return;
        objects[index] = object; // the lowest free slot, as GDI numbers them
    };
    const fresh = () => ({
        mapMode: 1,
        winOrg: org.slice(), winExt: ext.slice(),
        pen: { kind: "pen", style: 0, width: 0, color: "#000000" },
        brush: { kind: "brush", style: 0, color: "#ffffff" },
        font: null,
        textColor: "#000000", bkColor: "#ffffff", bkMode: 2, textAlign: 0,
        fillRule: "evenodd", rop2: 13, clip: null, pos: [0, 0],
    });
    let dc = fresh();
    const saved = [];
    const defs = [];
    const body = [];
    let clipCount = 0;
    let drew = false;

    // Logical units to the picture: the window maps onto the frame. MM_TEXT and the fixed (metric and English) modes
    // keep the scale the frame set; the fixed modes run y upwards.
    const matrix = () => {
        let sx = W / ext[0], sy = H / ext[1];
        if (dc.mapMode === 7 || dc.mapMode === 8) {
            sx = W / (dc.winExt[0] || ext[0]);
            sy = H / (dc.winExt[1] || ext[1]);
            if (dc.mapMode === 7) {
                const s = Math.min(Math.abs(sx), Math.abs(sy));
                sx = Math.sign(sx) * s;
                sy = Math.sign(sy) * s;
            }
        } else if (dc.mapMode >= 2 && dc.mapMode <= 6) sy = -Math.abs(sy);
        return [sx, 0, 0, sy, -dc.winOrg[0] * sx, -dc.winOrg[1] * sy];
    };
    const point = (x, y, m = matrix()) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const pt = p => `${_pptxSvgNumber(p[0])} ${_pptxSvgNumber(p[1])}`;
    const rectPath = (left, top, right, bottom) => {
        const m = matrix();
        return `M${pt(point(left, top, m))} L${pt(point(right, top, m))} L${pt(point(right, bottom, m))} L${pt(point(left, bottom, m))} Z`;
    };
    const ellipseD = (l, t, r, b, m = matrix()) => {
        const [x0, y0] = point(l, t, m), [x1, y1] = point(r, b, m);
        const pts = _pptxArcPoints((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 2 * Math.PI);
        return `M${pt(pts[0])}${curves(pts.slice(1))} Z`;
    };
    const curves = pts => {
        let d = "";
        for (let i = 0; i + 2 < pts.length; i += 3) d += ` C${pt(pts[i])} ${pt(pts[i + 1])} ${pt(pts[i + 2])}`;
        return d;
    };

    // R2_NOP draws nothing; other mixes are drawn as plain copies.
    const strokeAttrs = () => {
        const pen = dc.pen;
        if (!pen || pen.style === 5 || dc.rop2 === 11) return ' stroke="none"';
        const m = matrix();
        const width = Math.max(hair, Math.abs(pen.width * m[0]));
        // GDI draws the dash styles only on pens one pixel wide.
        const dash = pen.width <= 1 ? { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[pen.style] : null;
        const cap = { 0: "round", 1: "square", 2: "butt" }[(pen.style >> 8) & 0xf] || "round";
        const join = { 0: "round", 1: "bevel", 2: "miter" }[(pen.style >> 12) & 0xf] || "round";
        return ` stroke="${pen.color}" stroke-width="${_pptxSvgNumber(width)}" stroke-linecap="${cap}" stroke-linejoin="${join}"${dash ? ` stroke-dasharray="${dash.map(n => _pptxSvgNumber(n * Math.max(width, hair * 2))).join(" ")}"` : ""}`;
    };
    const fillAttrs = () => {
        const brush = dc.brush;
        if (!brush || brush.style === 1 || dc.rop2 === 11) return ' fill="none"';
        return ` fill="${brush.color}"${brush.style === 2 ? ' fill-opacity="0.35"' : ""} fill-rule="${dc.fillRule}"`;
    };
    const clipAttr = () => (dc.clip ? ` clip-path="url(#${dc.clip})"` : "");
    const clipped = markup => (dc.clip ? `<g clip-path="url(#${dc.clip})">${markup}</g>` : markup);
    const emit = (d, fill) => {
        if (!d) return;
        const attrs = (fill ? fillAttrs() : ' fill="none"') + strokeAttrs();
        if (/fill="none"/.test(attrs) && /stroke="none"/.test(attrs)) return;
        body.push(`<path d="${d}"${attrs}${clipAttr()}/>`);
        drew = true;
    };
    const setClip = (d, intersect, rule) => {
        const id = `wmfclip${++clipCount}`;
        const parent = intersect && dc.clip ? ` clip-path="url(#${dc.clip})"` : "";
        defs.push(`<clipPath id="${id}"${parent}><path d="${d}"${rule ? ` clip-rule="${rule}"` : ""}/></clipPath>`);
        dc.clip = id;
    };
    const readPoints = (at, count, end) => {
        if (at + count * 4 > end) return null;
        const m = matrix();
        return Array.from({ length: count }, (_, i) => point(i16(at + i * 4), i16(at + i * 4 + 2), m));
    };
    const regionPath = region => {
        const m = matrix();
        return region.rects.map(([l, t, r, b]) => `M${pt(point(l, t, m))} L${pt(point(r, t, m))} L${pt(point(r, b, m))} L${pt(point(l, b, m))} Z`).join("");
    };

    const blit = (rop, dib, end, srcX, srcY, srcW, srcH, x, y, w, h) => {
        if (rop !== 0x00cc0020) return; // SRCCOPY; masks and mixes are left out
        const cbBmi = _pptxDibInfoSize(view, dib, end);
        if (!cbBmi) return;
        const canvas = _pptxDibCanvas(view, dib, cbBmi, dib + cbBmi, end - dib - cbBmi);
        if (!canvas) return;
        const m = matrix();
        const t = [m[0] * w, m[1] * w, m[2] * h, m[3] * h, ...point(x, y, m)];
        body.push(clipped(_pptxBitmapMarkup(canvas, srcX, srcY, srcW, srcH, t)));
        drew = true;
    };
    const patBlt = (rop, x, y, w, h) => {
        const fill = rop === 0x00000042 ? "#000000" : rop === 0x00ff0062 ? "#ffffff" : rop === 0x00f00021 && dc.brush?.style !== 1 ? dc.brush.color : null;
        if (!fill) return;
        body.push(`<path d="${rectPath(x, y, x + w, y + h)}" fill="${fill}"${clipAttr()}/>`);
        drew = true;
    };

    const text = (x, y, stringAt, count, dxAt, end, options, rect) => {
        if (options & 0x2 && rect) {
            // ETO_OPAQUE: the rectangle filled with the background colour first.
            body.push(`<path d="${rectPath(...rect)}" fill="${dc.bkColor}"${clipAttr()}/>`);
            drew = true;
        }
        if (count <= 0 || stringAt + count > end) return;
        const font = dc.font || { height: -16 * hair, weight: 400, face: "Arial", escapement: 0, charset: 0 };
        const bytes = new Uint8Array(view.buffer, view.byteOffset + stringAt, count);
        const face = String(font.face || "");
        const symbolic = font.charset === 2 || /^(symbol|mt extra)/i.test(face);
        // A symbol font's bytes are its own characters, read as EMF stores them (under 0xF000).
        const chars = symbolic ? _pptxMetafileChars(Array.from(bytes, b => 0xf000 + b), font) : _pptxAnsiChars(bytes, font.charset);
        let advances = [];
        if (dxAt && dxAt + count * 2 <= end) advances = Array.from({ length: count }, (_, i) => i16(dxAt + i * 2));
        if (chars.length !== count) advances = [];
        const m = matrix();
        const useCurrent = dc.textAlign & 1;
        const origin = useCurrent ? point(dc.pos[0], dc.pos[1], m) : point(x, y, m);
        if (useCurrent && advances.length) {
            const angle = ((font.escapement || 0) / 10) * (Math.PI / 180);
            const moved = advances.reduce((sum, value) => sum + value, 0);
            dc.pos = [dc.pos[0] + moved * Math.cos(angle), dc.pos[1] - moved * Math.sin(angle)];
        }
        const markup = _pptxMetafileText(chars, font, advances, m, origin, dc.textAlign, dc.textColor);
        if (!markup) return;
        body.push(clipped(markup));
        drew = true;
    };

    // ARC, PIE and CHORD: the ellipse's bounds, then the radial points it starts and ends at, drawn anticlockwise on
    // the page as GDI does by default.
    const arc = (p, kind) => {
        const m = matrix();
        const [x0, y0] = point(i16(p + 14), i16(p + 12), m), [x1, y1] = point(i16(p + 10), i16(p + 8), m);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
        if (!rx || !ry) return;
        const s = point(i16(p + 6), i16(p + 4), m), e = point(i16(p + 2), i16(p), m);
        const a0 = Math.atan2((s[1] - cy) / ry, (s[0] - cx) / rx), a1 = Math.atan2((e[1] - cy) / ry, (e[0] - cx) / rx);
        let sweep = a1 - a0;
        if (sweep >= -1e-9) sweep -= 2 * Math.PI;
        const pts = _pptxArcPoints(cx, cy, rx, ry, a0, sweep);
        let d = `M${pt(pts[0])}${curves(pts.slice(1))}`;
        if (kind === "pie") d += ` L${_pptxSvgNumber(cx)} ${_pptxSvgNumber(cy)} Z`;
        else if (kind === "chord") d += " Z";
        emit(d, kind !== "arc");
    };

    let records = 0;
    for (let at = first; at + 6 <= length; ) {
        const size = u32(at) * 2, fn = u16(at + 4);
        if (size < 6 || at + size > length || ++records > 500000 || fn === 0) break;
        const p = at + 6, end = at + size;
        switch (fn) {
            case 0x0103: dc.mapMode = u16(p); break;
            case 0x020b: dc.winOrg = [i16(p + 2), i16(p)]; break;
            case 0x020c: dc.winExt = [i16(p + 2), i16(p)]; break;
            case 0x020f: dc.winOrg = [dc.winOrg[0] + i16(p + 2), dc.winOrg[1] + i16(p)]; break;
            case 0x0410: {
                // SCALEWINDOWEXT
                const yDen = i16(p), yNum = i16(p + 2), xDen = i16(p + 4), xNum = i16(p + 6);
                if (xDen && yDen) dc.winExt = [(dc.winExt[0] * xNum) / xDen, (dc.winExt[1] * yNum) / yDen];
                break;
            }
            case 0x0201: dc.bkColor = colour(p); break;
            case 0x0102: dc.bkMode = u16(p); break;
            case 0x0104: dc.rop2 = u16(p); break;
            case 0x0106: dc.fillRule = u16(p) === 2 ? "nonzero" : "evenodd"; break;
            case 0x0209: dc.textColor = colour(p); break;
            case 0x012e: dc.textAlign = u16(p); break;
            case 0x001e: saved.push({ ...dc }); break;
            case 0x0127: {
                const n = i16(p);
                const index = n < 0 ? saved.length + n : n - 1;
                if (index >= 0 && index < saved.length) {
                    dc = saved[index];
                    saved.length = index;
                }
                break;
            }
            case 0x02fa: addObject({ kind: "pen", style: u16(p), width: Math.abs(i16(p + 2)), color: colour(p + 6) }); break;
            case 0x02fc: {
                const style = u16(p);
                // A pattern brush (style 3) without its bitmap is shown in its colour as a plain fill.
                addObject({ kind: "brush", style: style === 3 ? 0 : style, color: colour(p + 2) });
                break;
            }
            case 0x0142: {
                // DIBCREATEPATTERNBRUSH: drawn as the pattern's average colour.
                let color = "#808080";
                const cbBmi = _pptxDibInfoSize(view, p + 4, end);
                const canvas = cbBmi && _pptxDibCanvas(view, p + 4, cbBmi, p + 4 + cbBmi, end - p - 4 - cbBmi);
                if (canvas && canvas.width * canvas.height <= 65536) {
                    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
                    const sum = [0, 0, 0];
                    for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += data[i + k];
                    const n = data.length / 4;
                    color = `#${sum.map(v => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
                }
                addObject({ kind: "brush", style: 0, color });
                break;
            }
            case 0x02fb: {
                let face = "";
                for (let i = 0; i < 32 && p + 18 + i < end; i++) {
                    const c = view.getUint8(p + 18 + i);
                    if (!c) break;
                    face += String.fromCharCode(c);
                }
                addObject({
                    kind: "font",
                    height: i16(p),
                    escapement: i16(p + 4),
                    weight: i16(p + 8),
                    italic: Boolean(view.getUint8(p + 10)),
                    underline: Boolean(view.getUint8(p + 11)),
                    strike: Boolean(view.getUint8(p + 12)),
                    charset: view.getUint8(p + 13),
                    face,
                });
                break;
            }
            case 0x06ff: {
                // CREATEREGION: bands of rectangles (scans), each a top and bottom and runs of left and right.
                const rects = [];
                const scans = i16(p + 10);
                let q = p + 22;
                for (let s = 0; s < scans && q + 6 <= end; s++) {
                    const count = u16(q), top = i16(q + 2), bottom = i16(q + 4);
                    for (let k = 0; k + 1 < count && q + 6 + k * 2 + 4 <= end; k += 2) rects.push([i16(q + 6 + k * 2), top, i16(q + 8 + k * 2), bottom]);
                    q += 8 + count * 2;
                }
                if (!rects.length && scans === 0) rects.push([i16(p + 14), i16(p + 16), i16(p + 18), i16(p + 20)]);
                addObject({ kind: "region", rects });
                break;
            }
            case 0x00f7: case 0x01f9: addObject({ kind: "other" }); break; // palettes and old pattern brushes
            case 0x012d: {
                const object = objects[u16(p)];
                if (object?.kind === "pen") dc.pen = object;
                else if (object?.kind === "brush") dc.brush = object;
                else if (object?.kind === "font") dc.font = object;
                else if (object?.kind === "region") setClip(regionPath(object), false);
                break;
            }
            case 0x01f0: if (u16(p) < objects.length) objects[u16(p)] = null; break;
            case 0x012c: {
                // SELECTCLIPREGION: a region, or (anything else) back to no clip
                const object = objects[u16(p)];
                if (object?.kind === "region" && object.rects.length) setClip(regionPath(object), false);
                else dc.clip = null;
                break;
            }
            case 0x0416: setClip(rectPath(i16(p + 6), i16(p + 4), i16(p + 2), i16(p)), true); break;
            case 0x0415: {
                // EXCLUDECLIPRECT: everything but the rectangle, as a hole in a sheet much larger than the picture
                const big = `M${-10 * W} ${-10 * H} L${11 * W} ${-10 * H} L${11 * W} ${11 * H} L${-10 * W} ${11 * H} Z `;
                setClip(big + rectPath(i16(p + 6), i16(p + 4), i16(p + 2), i16(p)), true, "evenodd");
                break;
            }
            case 0x0214: dc.pos = [i16(p + 2), i16(p)]; break;
            case 0x0213: {
                const from = point(dc.pos[0], dc.pos[1]);
                dc.pos = [i16(p + 2), i16(p)];
                emit(`M${pt(from)} L${pt(point(dc.pos[0], dc.pos[1]))}`, false);
                break;
            }
            case 0x0325: case 0x0324: {
                const pts = readPoints(p + 2, Math.max(0, i16(p)), end);
                if (pts && pts.length) emit(`M${pt(pts[0])}${pts.slice(1).map(q => ` L${pt(q)}`).join("")}${fn === 0x0324 ? " Z" : ""}`, fn === 0x0324);
                break;
            }
            case 0x0538: {
                const groups = u16(p);
                if (p + 2 + groups * 2 > end) break;
                const counts = Array.from({ length: groups }, (_, g) => u16(p + 2 + g * 2));
                const pts = readPoints(p + 2 + groups * 2, counts.reduce((a, b) => a + b, 0), end);
                if (!pts) break;
                let d = "", k = 0;
                for (const n of counts) {
                    const part = pts.slice(k, k + n);
                    k += n;
                    if (part.length) d += `M${pt(part[0])}${part.slice(1).map(q => ` L${pt(q)}`).join("")} Z`;
                }
                emit(d, true);
                break;
            }
            case 0x041b: emit(rectPath(i16(p + 6), i16(p + 4), i16(p + 2), i16(p)), true); break;
            case 0x061c: {
                // ROUNDRECT: corners as quarter ellipses
                const m = matrix();
                const [l, t] = point(i16(p + 10), i16(p + 8), m), [r, b] = point(i16(p + 6), i16(p + 4), m);
                const [L, R, T, B] = [Math.min(l, r), Math.max(l, r), Math.min(t, b), Math.max(t, b)];
                const rx = Math.min(Math.abs(i16(p + 2) * m[0]) / 2, (R - L) / 2), ry = Math.min(Math.abs(i16(p) * m[3]) / 2, (B - T) / 2);
                if (!(rx > 0) || !(ry > 0)) {
                    emit(`M${L} ${T} L${R} ${T} L${R} ${B} L${L} ${B} Z`, true);
                    break;
                }
                const corner = (cx, cy, a) => curves(_pptxArcPoints(cx, cy, rx, ry, a, Math.PI / 2).slice(1));
                const n = _pptxSvgNumber;
                emit(`M${n(L + rx)} ${n(T)} L${n(R - rx)} ${n(T)}${corner(R - rx, T + ry, -Math.PI / 2)} L${n(R)} ${n(B - ry)}${corner(R - rx, B - ry, 0)} L${n(L + rx)} ${n(B)}${corner(L + rx, B - ry, Math.PI / 2)} L${n(L)} ${n(T + ry)}${corner(L + rx, T + ry, Math.PI)} Z`, true);
                break;
            }
            case 0x0418: emit(ellipseD(i16(p + 6), i16(p + 4), i16(p + 2), i16(p)), true); break;
            case 0x0817: arc(p, "arc"); break;
            case 0x081a: arc(p, "pie"); break;
            case 0x0830: arc(p, "chord"); break;
            case 0x0521: {
                // TEXTOUT: the string (padded to a whole word), then y and x
                const count = i16(p);
                const after = p + 2 + ((count + 1) & ~1);
                if (after + 4 <= end) text(i16(after + 2), i16(after), p + 2, count, 0, end, 0, null);
                break;
            }
            case 0x0a32: {
                // EXTTEXTOUT: y, x, length, options, the clipping or opaque rectangle when an option asks for it, the
                // string (padded to a whole word), then each character's advance when the record is long enough
                const y = i16(p), x = i16(p + 2), count = i16(p + 4), options = u16(p + 6);
                let q = p + 8;
                let rect = null;
                if (options & 0x6) {
                    rect = [i16(q), i16(q + 2), i16(q + 4), i16(q + 6)];
                    q += 8;
                }
                const dxAt = q + ((count + 1) & ~1);
                text(x, y, q, count, dxAt + count * 2 <= end ? dxAt : 0, end, options, rect);
                break;
            }
            case 0x061d: patBlt(u32(p), i16(p + 10), i16(p + 8), i16(p + 6), i16(p + 4)); break;
            case 0x0940: {
                // DIBBITBLT: without a bitmap (a record of 12 words) it fills like PATBLT
                if (size === 24) patBlt(u32(p), i16(p + 16), i16(p + 14), i16(p + 12), i16(p + 10));
                else blit(u32(p), p + 16, end, i16(p + 6), i16(p + 4), i16(p + 10), i16(p + 8), i16(p + 14), i16(p + 12), i16(p + 10), i16(p + 8));
                break;
            }
            case 0x0b41: {
                // DIBSTRETCHBLT
                if (size === 28) patBlt(u32(p), i16(p + 20), i16(p + 18), i16(p + 16), i16(p + 14));
                else blit(u32(p), p + 20, end, i16(p + 10), i16(p + 8), i16(p + 6), i16(p + 4), i16(p + 18), i16(p + 16), i16(p + 14), i16(p + 12));
                break;
            }
            case 0x0f43: {
                // STRETCHDIB (palette-index colour tables are not read)
                if (u16(p + 4) === 0) blit(u32(p), p + 22, end, i16(p + 12), i16(p + 10), i16(p + 8), i16(p + 6), i16(p + 20), i16(p + 18), i16(p + 16), i16(p + 14));
                break;
            }
            case 0x0228: case 0x012b: {
                // FILLREGION (region, brush) and PAINTREGION (region, the current brush)
                const region = objects[u16(p)];
                const brush = fn === 0x0228 ? objects[u16(p + 2)] : dc.brush;
                if (region?.kind === "region" && brush?.kind === "brush" && brush.style !== 1 && region.rects.length) {
                    body.push(`<path d="${regionPath(region)}" fill="${brush.color}"${clipAttr()}/>`);
                    drew = true;
                }
                break;
            }
            default: break; // ESCAPE (MathType keeps its equation there), palettes, viewport and the rest
        }
        at += size;
    }
    if (!drew) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${_pptxSvgNumber(W)} ${_pptxSvgNumber(H)}" width="${_pptxSvgNumber(W)}" height="${_pptxSvgNumber(H)}" preserveAspectRatio="none">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("")}</svg>`;
}

window._pptxDibCanvas = _pptxDibCanvas;
window._pptxTiffBitmap = _pptxTiffBitmap;
window._pptxEmfSvg = _pptxEmfSvg;
window._pptxWmfSvg = _pptxWmfSvg;
