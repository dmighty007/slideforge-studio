// Shared scene geometry for the live canvas and the SVG kept with the deck and used by every export.
(() => {
    const api = window.SlideForgeLandscape;
    const palettes = {
        viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
        magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
        "blue-red": ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
        rainbow: ["#4542b8", "#258ad8", "#31c9bd", "#66ce59", "#e8df49", "#f69a36", "#d93c40"],
    };
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
    // Readout values: five significant figures. Labels: three, with a real minus sign.
    const format = value => Number(value.toPrecision(5)).toString();
    const short = value => Number(value.toPrecision(3)).toString().replace("-", "−");
    const hexRgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
    function color(data, grid, z) {
        const t = grid.colorMax === grid.colorMin ? 0.5 : Math.max(0, Math.min(1, (z - grid.colorMin) / (grid.colorMax - grid.colorMin)));
        const stops = palettes[data.palette], p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p));
        const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
        return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * (p - i)).toString(16).padStart(2, "0")).join("");
    }
    // 256 palette colors as bytes, for bitmaps.
    function lut(data) {
        const stops = palettes[data.palette], table = new Uint8ClampedArray(256 * 3);
        for (let k = 0; k < 256; k++) {
            const p = k / 255 * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
            for (let c = 0; c < 3; c++) table[k * 3 + c] = a[c] + (b[c] - a[c]) * (p - i);
        }
        return table;
    }
    // Round tick values inside [lo, hi] (1, 2, 2.5 or 5 × 10^n apart), and the decimals they need.
    function ticks(lo, hi, count = 5) {
        if (!(hi > lo)) return { values: [lo], decimals: 2 };
        const raw = (hi - lo) / count, magnitude = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 2.5, 5, 10].map(f => f * magnitude).find(s => s >= raw * 0.999);
        const values = [];
        for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && values.length < 30; k++) values.push(Math.abs(k * step) < step * 1e-9 ? 0 : k * step);
        const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (Number.isInteger(Math.round(step / magnitude * 10) / 10) ? 0 : 1));
        return { values: values.length ? values : [lo, hi], decimals: values.length ? decimals : 3 };
    }
    const tickText = (value, decimals) => value.toFixed(Math.min(10, decimals)).replace("-", "−");

    // The heatmap as one bitmap: no seams between cells, and the same piecewise-linear field as contours and hover.
    const bitmaps = new WeakMap();
    function heatmap(data, grid, width, height) {
        const w = Math.max(1, Math.round(Math.min(width, 720))), h = Math.max(1, Math.round(Math.min(height, 720)));
        const key = `${w}x${h}:${data.shading}:${data.palette}:${grid.colorMin}:${grid.colorMax}`;
        const cached = bitmaps.get(grid);
        if (cached?.key === key) return cached.canvas;
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const g = canvas.getContext("2d"), image = g.createImageData(w, h), pixels = image.data, table = lut(data);
        const { xs, ys, values } = grid, span = grid.colorMax - grid.colorMin;
        const locate = (axis, count, at) => {
            const out = new Array(count); let i = 0;
            for (let k = 0; k < count; k++) {
                const v = at(k);
                while (i < axis.length - 2 && v > axis[i + 1]) i++;
                out[k] = { i, t: Math.max(0, Math.min(1, (v - axis[i]) / (axis[i + 1] - axis[i]))) };
            }
            return out;
        };
        const columns = locate(xs, w, k => xs[0] + (k + 0.5) / w * (xs.at(-1) - xs[0]));
        // Rows run bottom to top in data and top to bottom in the image.
        const rows = locate(ys, h, k => ys[0] + (k + 0.5) / h * (ys.at(-1) - ys[0]));
        for (let r = 0; r < h; r++) {
            const { i: j, t: v } = rows[r], row = (h - 1 - r) * w;
            for (let c = 0; c < w; c++) {
                const { i, t: u } = columns[c];
                const z0 = values[j][i], z1 = values[j][i + 1], z2 = values[j + 1][i], z3 = values[j + 1][i + 1];
                if (!(Number.isFinite(z0) && Number.isFinite(z1) && Number.isFinite(z2) && Number.isFinite(z3))) continue;
                const z = data.shading === "cells" ? (z0 + z1 + z2 + z3) / 4
                    : v <= u ? z0 * (1 - u) + z1 * (u - v) + z3 * v : z0 * (1 - v) + z3 * u + z2 * (v - u);
                const k = Math.round((span ? Math.max(0, Math.min(1, (z - grid.colorMin) / span)) : 0.5) * 255) * 3, at = (row + c) * 4;
                pixels[at] = table[k]; pixels[at + 1] = table[k + 1]; pixels[at + 2] = table[k + 2]; pixels[at + 3] = 255;
            }
        }
        g.putImageData(image, 0, 0);
        bitmaps.set(grid, { key, canvas });
        return canvas;
    }
    function colorBar(data, grid) {
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 256;
        const g = canvas.getContext("2d"), image = g.createImageData(1, 256), table = lut(data);
        for (let k = 0; k < 256; k++) { const from = (255 - k) * 3; image.data.set([table[from], table[from + 1], table[from + 2], 255], k * 4); }
        g.putImageData(image, 0, 0);
        return canvas;
    }

    function scene(data, grid, context, camera = data) {
        const width = Math.max(320, context.width || 640), height = Math.max(260, context.height || 420);
        const ink = data.stage === "slate" ? "#f1f5f9" : context.textColor || "#172033", background = data.stage === "slate" ? "#454b57" : context.theme?.surfaceColor || "#ffffff";
        const fontFamily = context.fontFamily || "Arial, Helvetica, sans-serif";
        const font = data.fontSize, small = Math.max(9, font - 2), pad = 10, items = [];
        const measure = (value, size) => context.measureText ? context.measureText(value, { size }) : String(value).length * size * 0.56;
        const rect = (x, y, w, h, fill) => items.push({ kind: "rect", x, y, w, h, fill });
        const line = (points, stroke = ink, lineWidth = 1, opacity = 1, clip = false) => items.push({ kind: "path", points, stroke, lineWidth, opacity, clip });
        const text = (value, x, y, anchor = "middle", size = font, rotate = 0) => items.push({ kind: "text", value, x, y, anchor, size, fill: ink, rotate });
        rect(0, 0, width, height, background);
        const surfaces = grid.surfaces || [grid], surface = data.view === "surface";

        // Bands measured from what they hold, so the plot takes all the rest of the box.
        let top = pad;
        if (data.title) { text(data.title, width / 2, top + font + 2, "middle", font + 3); top += font + 3 + 8; }
        const notes = [...(surfaces.length > 1 ? ["Shared height and color scales"] : []), ...(data.subtractMin ? ["Minimum subtracted"] : [])];
        if (notes.length) { text(notes.join(" · "), width / 2, top + small, "middle", small); top += small + 8; }
        const barTicks = ticks(grid.colorMin, grid.colorMax, 5);
        const barLabels = barTicks.values.map(v => tickText(v, barTicks.decimals));
        const barLabelWidth = Math.max(...barLabels.map(v => measure(v, small)));
        // The color bar block: bar, ticks and labels, then the rotated value label.
        // Hidden, it takes no room: the plot (and a crop) use that space.
        const showBar = data.colorBar !== false, gap = showBar ? 14 : 0;
        const barWidth = 12, barBlock = showBar ? barWidth + 6 + barLabelWidth + 8 + font : 0, right = barBlock + pad + gap;
        let barX = width - pad - barBlock;

        const xMin = grid.xs[0], xMax = grid.xs.at(-1), yMin = grid.ys[0], yMax = grid.ys.at(-1);
        const faces = [], planes = [];
        let plot, crop = null;
        if (!surface) {
            const xTicks = ticks(xMin, xMax, Math.max(2, Math.min(7, Math.floor(width / 110)))), yTicks = ticks(yMin, yMax, Math.max(2, Math.min(7, Math.floor(height / 70))));
            const yLabelWidth = Math.max(...yTicks.values.map(v => measure(tickText(v, yTicks.decimals), small)));
            const left = pad + font + 8 + yLabelWidth + 6, bottom = pad + font + 6 + small + 8;
            plot = { x: left, y: top + 4, w: Math.max(40, width - left - right), h: Math.max(40, height - top - 4 - bottom) };
            const px = x => plot.x + (x - xMin) / (xMax - xMin) * plot.w, py = y => plot.y + plot.h - (y - yMin) / (yMax - yMin) * plot.h;
            rect(plot.x, plot.y, plot.w, plot.h, data.stage === "slate" ? "#3a404b" : "#f1f5f9");
            if (data.view !== "contours") items.push({ kind: "image", x: plot.x, y: plot.y, w: plot.w, h: plot.h, canvas: heatmap(data, grid, plot.w * 1.5, plot.h * 1.5), smooth: data.shading !== "cells" });
            if (data.view !== "heatmap" && grid.high > grid.low) {
                const levels = Array.from({ length: data.levels }, (_, i) => grid.colorMin + (i + 1) * (grid.colorMax - grid.colorMin) / (data.levels + 1));
                for (const contour of api.contours(grid, levels)) {
                    // One path per level keeps the saved SVG compact, including disconnected branches.
                    const segments = contour.segments.map(pair => pair.map(p => [px(p.x), py(p.y)]));
                    const lines = data.view === "contours";
                    items.push({ kind: "segments", segments, stroke: lines ? color(data, grid, contour.level) : "#ffffff", lineWidth: lines ? 1.6 : 0.8, opacity: lines ? 1 : 0.6 });
                }
            }
            line([[plot.x, plot.y], [plot.x + plot.w, plot.y], [plot.x + plot.w, plot.y + plot.h], [plot.x, plot.y + plot.h], [plot.x, plot.y]], ink, 0.8, 0.7);
            for (const x of xTicks.values) { line([[px(x), plot.y + plot.h], [px(x), plot.y + plot.h + 4]], ink, 0.8); text(tickText(x, xTicks.decimals), px(x), plot.y + plot.h + 6 + small, "middle", small); }
            for (const y of yTicks.values) { line([[plot.x - 4, py(y)], [plot.x, py(y)]], ink, 0.8); text(tickText(y, yTicks.decimals), plot.x - 7, py(y) + small * 0.35, "end", small); }
            text(data.xLabel, plot.x + plot.w / 2, height - pad);
            text(data.yLabel, pad + font * 0.8, plot.y + plot.h / 2, "middle", font, -90);
        } else {
            const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
            const zLow = data.zeroPlane ? Math.min(0, grid.low) : grid.low, zHigh = data.zeroPlane ? Math.max(0, grid.high) : grid.high;
            const zSpan = zHigh - zLow || 1, heightScale = data.zScale * 1.8 / zSpan;
            const worldZ = z => (z - (zLow + zHigh) / 2) * heightScale;
            const bottom = worldZ(zLow), roof = worldZ(zHigh), zLowText = () => short(zLow), zHighText = () => short(zHigh);
            const world = (p, index) => ({ ...p, wx: (p.x - xMin) / (xMax - xMin) * 2 - 1 + (index - (surfaces.length - 1) / 2) * 2.8, wy: (p.y - yMin) / (yMax - yMin) * 2 - 1, wz: worldZ(p.z) });
            const project = p => {
                const u = p.wx * Math.cos(yaw) - p.wy * Math.sin(yaw), v = p.wx * Math.sin(yaw) + p.wy * Math.cos(yaw);
                return { ...p, u, v: -v * Math.sin(pitch) - p.wz * Math.cos(pitch), depth: v * Math.cos(pitch) - p.wz * Math.sin(pitch) };
            };
            const cages = surfaces.map((_s, index) => {
                const center = (index - (surfaces.length - 1) / 2) * 2.8;
                return [[-1, -1, bottom], [1, -1, bottom], [1, 1, bottom], [-1, 1, bottom], [-1, -1, roof], [1, -1, roof], [1, 1, roof], [-1, 1, roof]].map(([x, y, z]) => project({ wx: x + center, wy: y, wz: z }));
            });
            const all = cages.flat();
            const loX = Math.min(...all.map(p => p.u)), hiX = Math.max(...all.map(p => p.u)), loY = Math.min(...all.map(p => p.v)), hiY = Math.max(...all.map(p => p.v));
            const spanX = Math.max(0.1, hiX - loX), spanY = Math.max(0.1, hiY - loY);
            // Room around the box for its axis labels, and under it for the surfaces' names.
            // Sideways the labels need their width (the value name sits beside the upright axis).
            const labelWidth = data.axesBox ? Math.max(...[data.valueLabel, data.yLabel, data.xLabel].map(v => measure(v, Math.max(10, font - 1))), ...[zLowText(), zHighText()].map(v => measure(v, small))) : 0;
            const marginX = data.axesBox ? Math.max(font * 2.6, labelWidth + font * 1.6) : 8, margin = data.axesBox ? font * 2.6 : 8, names = surfaces.length > 1 ? font + 10 : 0;
            plot = { x: pad, y: top, w: Math.max(40, barX - gap - pad), h: Math.max(40, height - top - pad) };
            const fit = Math.max(1, Math.min((plot.w - 2 * marginX) / spanX, (plot.h - 2 * margin - names) / spanY)), scale = fit * camera.zoom;
            // When the height limits the drawing, the drawing and its color bar are centred together: no wide empty
            // band between them. The plot area (where the surface may be panned) still spans the box.
            const drawnW = Math.min(plot.w, spanX * fit + 2 * marginX), slack = plot.w - drawnW;
            barX -= slack / 2;
            const centerX = plot.x + drawnW / 2 + slack / 2 + (camera.panX || 0) * plot.w, centerY = plot.y + margin + (plot.h - 2 * margin - names) / 2 + (camera.panY || 0) * plot.h;
            const screen = p => ({ ...p, sx: centerX + (p.u - (loX + hiX) / 2) * scale, sy: centerY + (p.v - (loY + hiY) / 2) * scale });
            // The box that holds this picture exactly, at its present size on screen (zoom folded in, pan dropped).
            const contentW = spanX * scale + 2 * marginX, contentH = spanY * scale + 2 * margin + names;
            // Never below the smallest box the scene draws (320 × 260): a smaller crop is centred in it instead.
            const cropW = contentW + pad + right, cropH = top + contentH + pad, growW = Math.max(0, 320 - cropW), growH = Math.max(0, 260 - cropH);
            crop = { width: Math.round(cropW + growW), height: Math.round(cropH + growH), dx: Math.round(centerX - contentW / 2 - pad - growW / 2), dy: Math.round(centerY - margin - (spanY * scale) / 2 - top - growH / 2) };
            const normal = (s, i, j) => {
                const z = s.values[j][i];
                const left = i > 0 && Number.isFinite(s.values[j][i - 1]) ? i - 1 : i, rightI = i + 1 < s.xs.length && Number.isFinite(s.values[j][i + 1]) ? i + 1 : i;
                const down = j > 0 && Number.isFinite(s.values[j - 1][i]) ? j - 1 : j, up = j + 1 < s.ys.length && Number.isFinite(s.values[j + 1][i]) ? j + 1 : j;
                const dx = left === rightI ? 0 : (s.values[j][rightI] - s.values[j][left]) / (s.xs[rightI] - s.xs[left]) * (xMax - xMin) / 2 * heightScale;
                const dy = down === up ? 0 : (s.values[up][i] - s.values[down][i]) / (s.ys[up] - s.ys[down]) * (yMax - yMin) / 2 * heightScale;
                const length = Math.hypot(dx, dy, 1);
                return Number.isFinite(z) ? [-dx / length, -dy / length, 1 / length] : [0, 0, 1];
            };
            const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
            const projected = [];
            surfaces.forEach((s, index) => {
                const cage = cages[index].map(screen);
                // Clipped like the surface: zoomed in, the box must not run over the color bar or the title.
                if (data.axesBox) for (const [a, b] of edges) line([[cage[a].sx, cage[a].sy], [cage[b].sx, cage[b].sy]], "#94a3b8", 0.8, 1, true);
                if (data.zeroPlane && zLow <= 0 && zHigh >= 0) {
                    const vertices = [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]].map(([x, y]) => screen(project(world({ x, y, z: 0 }, index))));
                    const plane = { kind: "plane", points: vertices.map(p => [p.sx, p.sy]), vertices, fill: "#94a3b8" }; planes.push(plane); items.push(plane);
                }
                for (const cell of s.cells) {
                    const indices = [[0, 0], [1, 0], [1, 1], [0, 1]];
                    const vertices = cell.vertices.map((p, k) => screen(project({ ...world(p, index), normal: normal(s, cell.i + indices[k][0], cell.j + indices[k][1]), color: color(data, grid, p.z) })));
                    projected.push({ vertices, value: cell.value, label: s.label || "", surface: index });
                }
            });
            projected.sort((a, b) => b.vertices.reduce((s, p) => s + p.depth, 0) - a.vertices.reduce((s, p) => s + p.depth, 0));
            for (const cell of projected) {
                const points = cell.vertices.map(p => [p.sx, p.sy]);
                const face = { kind: "polygon", points, vertices: cell.vertices, fill: color(data, grid, cell.value), label: cell.label, surface: cell.surface }; faces.push(face); items.push(face);
            }
            if (data.axesBox) {
                // Axes on the box's outer edges: the front-most x and y edges, the left-most upright. Labels sit
                // outside the box, pushed away from its middle, so they never land on the surface.
                const cage = cages[0].map(screen), mid = (a, b) => ({ sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 });
                const centroid = { sx: cage.reduce((s, p) => s + p.sx, 0) / 8, sy: cage.reduce((s, p) => s + p.sy, 0) / 8 };
                const lowest = pairs => pairs.reduce((best, pair) => mid(cage[pair[0]], cage[pair[1]]).sy > mid(cage[best[0]], cage[best[1]]).sy ? pair : best);
                const leftmost = pairs => pairs.reduce((best, pair) => mid(cage[pair[0]], cage[pair[1]]).sx < mid(cage[best[0]], cage[best[1]]).sx ? pair : best);
                // Labels already placed, as boxes: a value that would overlap one is left out (the color bar gives
                // the value scale too), and a name moves further out until it is clear.
                const placed = [];
                const boxOf = (value, x, y, anchor, size) => { const w = measure(value, size), left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2; return { left: left - 2, right: left + w + 2, top: y - size, bottom: y + 3 }; };
                const clear = b => placed.every(o => b.right < o.left || b.left > o.right || b.bottom < o.top || b.top > o.bottom);
                const inside = b => b.left >= plot.x && b.right <= plot.x + plot.w && b.top >= plot.y && b.bottom <= plot.y + plot.h;
                const label = (value, x, y, anchor, size) => { const b = boxOf(value, x, y, anchor, size); if (!clear(b) || !inside(b)) return false; placed.push(b); text(value, x, y, anchor, size); return true; };
                const axis = ([a, b], from, to, name) => {
                    const A = cage[a], B = cage[b], M = mid(A, B);
                    let dx = M.sx - centroid.sx, dy = M.sy - centroid.sy; const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
                    const anchor = dx > 0.35 ? "start" : dx < -0.35 ? "end" : "middle";
                    line([[A.sx, A.sy], [B.sx, B.sy]], ink, 1, 0.8, true);
                    // Each value sits a little along its own edge, so values of axes that meet at a corner part.
                    for (const [P, Q, value] of [[A, B, from], [B, A, to]]) {
                        label(value, P.sx + (Q.sx - P.sx) * 0.07 + dx * small * 0.9, P.sy + (Q.sy - P.sy) * 0.07 + dy * small * 0.9 + small * 0.35, anchor, small);
                    }
                    const size = Math.max(10, font - 1);
                    for (const out of [1.5, 2.2, 3, 3.8]) if (label(name, M.sx + dx * font * out, M.sy + dy * font * out + font * 0.35, anchor, size)) break;
                };
                axis(lowest([[0, 1], [3, 2]]), short(xMin), short(xMax), data.xLabel);
                // Beside other boxes the y axis goes on the outer (left) side, away from the next box.
                axis((surfaces.length > 1 ? leftmost : lowest)([[0, 3], [1, 2]]), short(yMin), short(yMax), data.yLabel);
                axis(leftmost([[0, 4], [1, 5], [2, 6], [3, 7]]), short(zLow), short(zHigh), data.valueLabel);
            }
            // The surfaces' names share one line under the lowest box.
            const namesY = Math.min(height - pad, Math.max(...all.map(p => screen(p).sy)) + (data.axesBox ? font * 2.4 : font + 4));
            surfaces.forEach((s, index) => {
                if (!s.label || surfaces.length < 2) return;
                const cage = cages[index].map(screen);
                text(s.label, cage.slice(0, 4).reduce((sum, p) => sum + p.sx, 0) / 4, namesY, "middle", font);
            });
        }
        const barY = surface ? plot.y + 4 : plot.y, barH = Math.max(40, (surface ? plot.h - 8 : plot.h));
        if (showBar) {
            items.push({ kind: "image", x: barX, y: barY, w: barWidth, h: barH, canvas: colorBar(data, grid), smooth: true });
            line([[barX, barY], [barX + barWidth, barY], [barX + barWidth, barY + barH], [barX, barY + barH], [barX, barY]], ink, 0.8, 0.6);
            const span = grid.colorMax - grid.colorMin;
            barTicks.values.forEach((value, k) => {
                const y = barY + barH * (span ? 1 - (value - grid.colorMin) / span : 0.5);
                line([[barX + barWidth, y], [barX + barWidth + 4, y]], ink, 0.8);
                text(barLabels[k], barX + barWidth + 6, y + small * 0.35, "start", small);
            });
            text(data.valueLabel, barX + barBlock, barY + barH / 2, "middle", font - 1, -90);
        }
        return { width, height, items, plot, faces, planes, background, camera, crop, lighting: data.lighting, fontFamily };
    }
    function svg(scene) {
        const n = v => Number(v.toFixed(2)), points = ps => ps.map(p => p.map(n).join(",")).join(" ");
        const path = ps => ps.map((p, i) => `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`).join("");
        const parts = scene.items.map(p => {
            if (p.kind === "rect") return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${p.fill}"/>`;
            if (p.kind === "image") return `<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" href="${p.canvas.toDataURL("image/png")}"/>`;
            if (p.kind === "polygon" || p.kind === "plane") return `<polygon clip-path="url(#landscape-plot)" points="${points(p.points)}" fill="${p.fill}"${p.kind === "plane" ? ' fill-opacity="0.13"' : ` stroke="${p.fill}" stroke-width="0.3"`}/>`;
            if (p.kind === "path" || p.kind === "segments") return `<path${p.clip ? ' clip-path="url(#landscape-plot)"' : ""} d="${p.kind === "segments" ? p.segments.map(path).join("") : path(p.points)}" fill="none" stroke="${escape(p.stroke)}" stroke-width="${p.lineWidth}"${p.opacity < 1 ? ` stroke-opacity="${p.opacity}"` : ""}/>`;
            return `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="${p.anchor}" font-size="${p.size}" fill="${escape(p.fill)}"${p.rotate ? ` transform="rotate(${p.rotate} ${n(p.x)} ${n(p.y)})"` : ""}>${escape(p.value)}</text>`;
        });
        const p = scene.plot;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="${escape(scene.fontFamily)}"><defs><clipPath id="landscape-plot"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/></clipPath></defs>${parts.join("")}</svg>`;
    }
    function paint(canvas, scene, mesh = null) {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== Math.round(scene.width * ratio) || canvas.height !== Math.round(scene.height * ratio)) { canvas.width = Math.round(scene.width * ratio); canvas.height = Math.round(scene.height * ratio); }
        const c = canvas.getContext("2d"); c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, scene.width, scene.height);
        const path = ps => { ps.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); };
        let meshPainted = false;
        for (const p of scene.items) {
            if (mesh && p.kind === "plane") continue;
            if (mesh && p.kind === "polygon") { if (!meshPainted) { c.drawImage(mesh, 0, 0, scene.width, scene.height); meshPainted = true; } continue; }
            c.fillStyle = p.fill || "#000"; c.strokeStyle = p.stroke || p.fill || "#000"; c.lineWidth = p.lineWidth || 0.3;
            if (p.kind === "rect") c.fillRect(p.x, p.y, p.w, p.h);
            else if (p.kind === "image") { c.save(); c.imageSmoothingEnabled = p.smooth !== false; c.drawImage(p.canvas, p.x, p.y, p.w, p.h); c.restore(); }
            else if (p.kind === "polygon" || p.kind === "plane") { c.save(); c.globalAlpha = p.kind === "plane" ? 0.13 : 1; c.beginPath(); c.rect(scene.plot.x, scene.plot.y, scene.plot.w, scene.plot.h); c.clip(); c.beginPath(); path(p.points); c.closePath(); c.fill(); if (p.kind !== "plane") c.stroke(); c.restore(); }
            else if (p.kind === "path" || p.kind === "segments") { c.save(); c.globalAlpha = p.opacity ?? 1; if (p.clip) { c.beginPath(); c.rect(scene.plot.x, scene.plot.y, scene.plot.w, scene.plot.h); c.clip(); } c.beginPath(); if (p.kind === "segments") p.segments.forEach(path); else path(p.points); c.stroke(); c.restore(); }
            else { c.save(); c.translate(p.x, p.y); c.rotate(p.rotate * Math.PI / 180); c.font = `${p.size}px ${scene.fontFamily}`; c.textAlign = p.anchor === "middle" ? "center" : p.anchor === "end" ? "right" : "left"; c.fillText(p.value, 0, 0); c.restore(); }
        }
    }
    function pick(scene, grid, data, x, y) {
        if (data.view !== "surface") {
            const p = scene.plot, wx = grid.xs[0] + (x - p.x) / p.w * (grid.xs.at(-1) - grid.xs[0]), wy = grid.ys[0] + (p.y + p.h - y) / p.h * (grid.ys.at(-1) - grid.ys[0]);
            const z = api.sample(grid, wx, wy); return z === null ? null : { x: wx, y: wy, z };
        }
        // Match the depth-tested geometry, not the painter order of average face depths.
        let nearest = null, depth = Infinity;
        if (x < scene.plot.x || x > scene.plot.x + scene.plot.w || y < scene.plot.y || y > scene.plot.y + scene.plot.h) return null;
        for (const face of scene.faces) for (const ids of [[0, 1, 2], [0, 2, 3]]) {
            const [a, b, c] = ids.map(i => face.vertices[i]);
            const denominator = (b.sy - c.sy) * (a.sx - c.sx) + (c.sx - b.sx) * (a.sy - c.sy);
            if (Math.abs(denominator) < 1e-9) continue;
            const u = ((b.sy - c.sy) * (x - c.sx) + (c.sx - b.sx) * (y - c.sy)) / denominator, v = ((c.sy - a.sy) * (x - c.sx) + (a.sx - c.sx) * (y - c.sy)) / denominator, w = 1 - u - v;
            const d = a.depth * u + b.depth * v + c.depth * w;
            if (Math.min(u, v, w) >= -1e-7 && d < depth) { depth = d; nearest = { x: a.x * u + b.x * v + c.x * w, y: a.y * u + b.y * v + c.y * w, z: a.z * u + b.z * v + c.z * w, label: face.label, surface: face.surface }; }
        }
        return nearest;
    }
    function mount(host, data, context) {
        const grid = api.dataset(data, context.parseTable), canvas = document.createElement("canvas"), toolbar = document.createElement("div"), readout = document.createElement("output");
        const gpuCanvas = document.createElement("canvas"), surface = data.view === "surface", renderer = surface ? api.createSurfaceRenderer(gpuCanvas) : null;
        canvas.className = "landscape-canvas"; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Landscape. Hover or tap for values. Drag to orbit, shift or right-drag to pan. Pinch or wheel to zoom. Arrow keys rotate; plus and minus zoom.");
        toolbar.className = "landscape-toolbar"; toolbar.setAttribute("role", "toolbar"); toolbar.setAttribute("aria-label", "Landscape view");
        readout.className = "landscape-readout"; readout.textContent = surface ? "Drag to orbit · Shift-drag to pan · Wheel to zoom" : "Hover or tap to inspect values";
        host.append(canvas, toolbar, readout);
        const initial = () => ({ yaw: data.yaw, pitch: data.pitch, zoom: data.zoom, panX: data.panX || 0, panY: data.panY || 0 });
        let camera = initial(), current, drag = null, frame = null, gesture = null;
        const touches = new Map();
        const options = { signal: context.signal };
        const draw = () => { frame = null; current = scene(data, grid, context, camera); const gpu = renderer?.render(current); canvas.dataset.engine = gpu ? "webgl" : "canvas"; paint(canvas, current, gpu ? gpuCanvas : null); };
        const redraw = () => { if (frame === null) frame = requestAnimationFrame(draw); };
        // Icon buttons; the accessible name says what each does, and shows as its tooltip.
        const button = (label, icon, action) => {
            const b = document.createElement("button"); b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
            const i = document.createElement("i"); i.className = `fa-solid ${icon}`; i.setAttribute("aria-hidden", "true"); b.append(i);
            b.addEventListener("click", action, options); toolbar.append(b); return b;
        };
        const zoom = amount => { camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * amount)); redraw(); };
        if (surface) {
            button("Zoom out", "fa-minus", () => zoom(0.9));
            button("Zoom in", "fa-plus", () => zoom(1.1));
            button("Fit surface to the box", "fa-expand", () => { camera = { ...camera, zoom: 1, panX: 0, panY: 0 }; redraw(); });
        }
        button("Reset view", "fa-rotate-left", () => { camera = initial(); redraw(); });
        if (surface && !context.isPresenting) {
            button("Use view for export", "fa-camera", () => context.update(camera));
            // The element's box shrinks (or grows) to the drawing as now shown: no empty margins around the surface.
            if (typeof context.resize === "function") button("Crop box to content", "fa-crop-simple", () => {
                const crop = (current || scene(data, grid, context, camera)).crop;
                if (crop) context.resize(crop, { yaw: camera.yaw, pitch: camera.pitch, zoom: 1, panX: 0, panY: 0 });
            });
        }
        const place = event => {
            const box = host.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
            const w = readout.offsetWidth, h = readout.offsetHeight;
            readout.style.left = `${Math.max(4, Math.min(box.width - w - 4, x + 14))}px`;
            readout.style.top = `${y + 18 + h > box.height - 4 ? Math.max(4, y - h - 10) : y + 18}px`;
            readout.classList.add("is-visible");
        };
        const inspect = event => {
            const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * current.width, y = (event.clientY - rect.top) / rect.height * current.height;
            const p = pick(current, grid, data, x, y);
            readout.textContent = p ? `${p.label ? p.label + " · " : ""}${data.xLabel}: ${format(p.x)} · ${data.yLabel}: ${format(p.y)} · ${data.valueLabel}: ${format(p.z)} (interpolated${data.subtractMin ? ", minimum subtracted" : ""})`
                : surface ? "Drag to orbit · Shift-drag to pan · Wheel to zoom" : "No value here (outside the grid or missing samples)";
            place(event);
        };
        const pinch = () => { const [a, b] = [...touches.values()]; return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
        canvas.addEventListener("contextmenu", event => event.preventDefault(), options);
        canvas.addEventListener("pointerleave", () => readout.classList.remove("is-visible"), options);
        canvas.addEventListener("pointerdown", event => {
            if (![0, 2].includes(event.button)) return;
            event.preventDefault(); canvas.focus(); canvas.setPointerCapture(event.pointerId);
            if (event.pointerType === "touch") { touches.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (touches.size === 2) { gesture = { ...pinch(), ...camera }; drag = null; return; } }
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...camera, pan: event.shiftKey || event.button === 2 }; inspect(event);
        }, options);
        canvas.addEventListener("pointermove", event => {
            if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (gesture && touches.size === 2 && surface) { const p = pinch(), r = canvas.getBoundingClientRect(); camera.zoom = Math.max(0.25, Math.min(4, gesture.zoom * p.distance / Math.max(1, gesture.distance))); camera.panX = Math.max(-1, Math.min(1, gesture.panX + (p.x - gesture.x) / r.width)); camera.panY = Math.max(-1, Math.min(1, gesture.panY + (p.y - gesture.y) / r.height)); redraw(); }
            else if (drag && drag.id === event.pointerId && surface) {
                const rect = canvas.getBoundingClientRect();
                readout.classList.remove("is-visible");
                if (drag.pan) { camera.panX = Math.max(-1, Math.min(1, drag.panX + (event.clientX - drag.x) / rect.width)); camera.panY = Math.max(-1, Math.min(1, drag.panY + (event.clientY - drag.y) / rect.height)); }
                else { camera.yaw = (drag.yaw + (event.clientX - drag.x) / rect.width * 240) % 360; camera.pitch = Math.max(-85, Math.min(85, drag.pitch + (event.clientY - drag.y) / rect.height * 120)); }
                redraw();
            }
            else inspect(event);
        }, options);
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, event => { touches.delete(event.pointerId); gesture = null; drag = null; }, options);
        canvas.addEventListener("wheel", event => { event.preventDefault(); if (surface) zoom(event.deltaY > 0 ? 0.9 : 1.1); }, { ...options, passive: false });
        canvas.addEventListener("keydown", event => {
            if (event.key === "Escape") return; // preserve the show's exit key
            if (surface) {
                if (event.key === "ArrowLeft") camera.yaw -= 5;
                else if (event.key === "ArrowRight") camera.yaw += 5;
                else if (event.key === "ArrowUp") camera.pitch = Math.max(-85, camera.pitch - 5);
                else if (event.key === "ArrowDown") camera.pitch = Math.min(85, camera.pitch + 5);
                else if (["+", "="].includes(event.key)) zoom(1.1);
                else if (event.key === "-") zoom(0.9);
                else return;
                event.preventDefault(); redraw();
            }
        }, options);
        draw();
        return () => { if (frame !== null) cancelAnimationFrame(frame); drag = null; touches.clear(); renderer?.dispose(); host.replaceChildren(); };
    }
    Object.assign(api, { scene, svg, paint, pick, mount, ticks });
})();
