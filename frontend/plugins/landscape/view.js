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
    const format = value => Number(value.toPrecision(5)).toString();
    function color(data, grid, z) {
        const t = grid.colorMax === grid.colorMin ? 0.5 : Math.max(0, Math.min(1, (z - grid.colorMin) / (grid.colorMax - grid.colorMin)));
        const stops = palettes[data.palette], p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p));
        const rgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
        const a = rgb(stops[i]), b = rgb(stops[i + 1]);
        return "#" + a.map((v, k) => Math.round(v + (b[k] - v) * (p - i)).toString(16).padStart(2, "0")).join("");
    }
    function scene(data, grid, context, camera = data) {
        const width = Math.max(320, context.width || 640), height = Math.max(260, context.height || 420);
        const ink = data.stage === "slate" ? "#f1f5f9" : context.textColor || "#172033", background = data.stage === "slate" ? "#454b57" : context.theme?.surfaceColor || "#ffffff";
        const font = data.fontSize, items = [], plot = { x: 66, y: data.title ? 44 : 24, w: width - 172, h: height - (data.title ? 108 : 88) };
        const rect = (x, y, w, h, fill) => items.push({ kind: "rect", x, y, w, h, fill });
        const line = (points, stroke = ink, lineWidth = 1) => items.push({ kind: "path", points, stroke, lineWidth });
        const text = (value, x, y, anchor = "middle", size = font, rotate = 0) => items.push({ kind: "text", value, x, y, anchor, size, fill: ink, rotate });
        rect(0, 0, width, height, background);
        if (data.title) text(data.title, width / 2, 24, "middle", font + 3);
        const xMin = grid.xs[0], xMax = grid.xs.at(-1), yMin = grid.ys[0], yMax = grid.ys.at(-1);
        const px = x => plot.x + (x - xMin) / (xMax - xMin) * plot.w, py = y => plot.y + plot.h - (y - yMin) / (yMax - yMin) * plot.h;
        const faces = [], planes = [];
        if (data.view !== "surface") {
            rect(plot.x, plot.y, plot.w, plot.h, data.palette === "magma" ? "#eee9f1" : "#f1f5f9");
            if (data.view !== "contours") for (const cell of grid.cells) {
                const a = cell.vertices[0], c = cell.vertices[2];
                rect(px(a.x), py(c.y), px(c.x) - px(a.x) + 0.1, py(a.y) - py(c.y) + 0.1, color(data, grid, cell.value));
            }
            if (data.view !== "heatmap" && grid.high > grid.low) {
                const levels = Array.from({ length: data.levels }, (_, i) => grid.colorMin + (i + 1) * (grid.colorMax - grid.colorMin) / (data.levels + 1));
                for (const contour of api.contours(grid, levels)) {
                    // One path per level keeps the saved SVG compact, including disconnected branches.
                    const segments = contour.segments.map(pair => pair.map(p => [px(p.x), py(p.y)]));
                    items.push({ kind: "segments", segments, stroke: data.view === "contours" ? color(data, grid, contour.level) : ink, lineWidth: data.view === "contours" ? 1.6 : 0.9 });
                }
            }
            line([[plot.x, plot.y], [plot.x, plot.y + plot.h], [plot.x + plot.w, plot.y + plot.h]]);
            for (let i = 0; i <= 4; i++) {
                const x = xMin + i * (xMax - xMin) / 4, y = yMin + i * (yMax - yMin) / 4;
                line([[px(x), py(yMin)], [px(x), py(yMin) + 4]]); text(format(x), px(x), py(yMin) + font + 7, "middle", font - 2);
                line([[px(xMin) - 4, py(y)], [px(xMin), py(y)]]); text(format(y), px(xMin) - 7, py(y) + 4, "end", font - 2);
            }
            text(data.xLabel, plot.x + plot.w / 2, height - 15);
            text(data.yLabel, 16, plot.y + plot.h / 2, "middle", font, -90);
        } else {
            const surfaces = grid.surfaces || [grid];
            const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
            const zLow = data.zeroPlane ? Math.min(0, grid.low) : grid.low, zHigh = data.zeroPlane ? Math.max(0, grid.high) : grid.high;
            const zSpan = zHigh - zLow || 1, heightScale = data.zScale * 1.8 / zSpan;
            const worldZ = z => (z - (zLow + zHigh) / 2) * heightScale;
            const bottom = worldZ(zLow), top = worldZ(zHigh);
            const world = (p, index) => ({ ...p, wx: (p.x - xMin) / (xMax - xMin) * 2 - 1 + (index - (surfaces.length - 1) / 2) * 2.8, wy: (p.y - yMin) / (yMax - yMin) * 2 - 1, wz: worldZ(p.z) });
            const project = p => {
                const u = p.wx * Math.cos(yaw) - p.wy * Math.sin(yaw), v = p.wx * Math.sin(yaw) + p.wy * Math.cos(yaw);
                return { ...p, u, v: -v * Math.sin(pitch) - p.wz * Math.cos(pitch), depth: v * Math.cos(pitch) - p.wz * Math.sin(pitch) };
            };
            const cages = surfaces.map((_s, index) => {
                const center = (index - (surfaces.length - 1) / 2) * 2.8;
                return [[-1, -1, bottom], [1, -1, bottom], [1, 1, bottom], [-1, 1, bottom], [-1, -1, top], [1, -1, top], [1, 1, top], [-1, 1, top]].map(([x, y, z]) => project({ wx: x + center, wy: y, wz: z }));
            });
            const all = cages.flat();
            const loX = Math.min(...all.map(p => p.u)), hiX = Math.max(...all.map(p => p.u)), loY = Math.min(...all.map(p => p.v)), hiY = Math.max(...all.map(p => p.v));
            const scale = Math.min(plot.w / Math.max(0.1, hiX - loX), plot.h / Math.max(0.1, hiY - loY)) * 0.88 * camera.zoom;
            const screen = p => ({ ...p, sx: plot.x + plot.w / 2 + (p.u - (loX + hiX) / 2) * scale + (camera.panX || 0) * plot.w, sy: plot.y + plot.h / 2 + (p.v - (loY + hiY) / 2) * scale + (camera.panY || 0) * plot.h });
            const normal = (s, i, j) => {
                const z = s.values[j][i];
                const left = i > 0 && Number.isFinite(s.values[j][i - 1]) ? i - 1 : i, right = i + 1 < s.xs.length && Number.isFinite(s.values[j][i + 1]) ? i + 1 : i;
                const down = j > 0 && Number.isFinite(s.values[j - 1][i]) ? j - 1 : j, up = j + 1 < s.ys.length && Number.isFinite(s.values[j + 1][i]) ? j + 1 : j;
                const dx = left === right ? 0 : (s.values[j][right] - s.values[j][left]) / (s.xs[right] - s.xs[left]) * (xMax - xMin) / 2 * heightScale;
                const dy = down === up ? 0 : (s.values[up][i] - s.values[down][i]) / (s.ys[up] - s.ys[down]) * (yMax - yMin) / 2 * heightScale;
                const length = Math.hypot(dx, dy, 1);
                return Number.isFinite(z) ? [-dx / length, -dy / length, 1 / length] : [0, 0, 1];
            };
            const projected = [];
            surfaces.forEach((s, index) => {
                const cage = cages[index].map(screen);
                if (data.axesBox) {
                    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) line([[cage[a].sx, cage[a].sy], [cage[b].sx, cage[b].sy]], "#94a3b8", 0.8);
                }
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
            surfaces.forEach((s, index) => {
                const cage = cages[index].map(screen), origin = cage[0];
                if (data.axesBox && index === 0) {
                    for (const [end, label] of [[cage[1], `${data.xLabel}: ${format(xMin)}…${format(xMax)}`], [cage[3], `${data.yLabel}: ${format(yMin)}…${format(yMax)}`], [cage[4], `${format(zLow)}…${format(zHigh)}`]]) {
                        line([[origin.sx, origin.sy], [end.sx, end.sy]], ink, 1); text(label, end.sx, end.sy + 15, "middle", Math.max(9, font - 3));
                    }
                }
                if (s.label) { const p = screen(project({ wx: (index - (surfaces.length - 1) / 2) * 2.8, wy: 0, wz: bottom })); text(s.label, p.sx, Math.min(height - 15, p.sy + 34), "middle", font); }
            });
            text(surfaces.length > 1 ? "Shared height and color scales" : "Drag: orbit · Shift/right-drag: pan · Wheel: zoom", plot.x, height - 15, "start", Math.max(9, font - 3));
        }
        const barX = width - 76, barY = plot.y + 16, barH = Math.max(40, plot.h - 40);
        for (let i = 0; i < 64; i++) rect(barX, barY + barH * i / 64, 14, barH / 64 + 0.2, color(data, grid, grid.colorMax - (grid.colorMax - grid.colorMin) * (i + 0.5) / 64));
        text(format(grid.colorMax), barX + 20, barY + 5, "start", font - 3); text(format(grid.colorMin), barX + 20, barY + barH, "start", font - 3);
        text(data.valueLabel, width - 10, barY + barH / 2, "middle", font - 1, -90);
        if (data.subtractMin) text("Minimum subtracted", plot.x, height - 1, "start", Math.max(9, font - 4));
        return { width, height, items, plot, faces, planes, background, camera, lighting: data.lighting, fontFamily: context.fontFamily || "Arial, Helvetica, sans-serif" };
    }
    function svg(scene) {
        const n = v => Number(v.toFixed(2)), points = ps => ps.map(p => p.map(n).join(",")).join(" ");
        const path = ps => ps.map((p, i) => `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`).join("");
        const parts = scene.items.map(p => {
            if (p.kind === "rect") return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${p.fill}"/>`;
            if (p.kind === "polygon" || p.kind === "plane") return `<polygon clip-path="url(#landscape-plot)" points="${points(p.points)}" fill="${p.fill}"${p.kind === "plane" ? ' fill-opacity="0.13"' : ` stroke="${p.fill}" stroke-width="0.3"`}/>`;
            if (p.kind === "path" || p.kind === "segments") return `<path d="${p.kind === "segments" ? p.segments.map(path).join("") : path(p.points)}" fill="none" stroke="${escape(p.stroke)}" stroke-width="${p.lineWidth}"/>`;
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
            else if (p.kind === "polygon" || p.kind === "plane") { c.save(); c.globalAlpha = p.kind === "plane" ? 0.13 : 1; c.beginPath(); c.rect(scene.plot.x, scene.plot.y, scene.plot.w, scene.plot.h); c.clip(); c.beginPath(); path(p.points); c.closePath(); c.fill(); if (p.kind !== "plane") c.stroke(); c.restore(); }
            else if (p.kind === "path" || p.kind === "segments") { c.beginPath(); if (p.kind === "segments") p.segments.forEach(path); else path(p.points); c.stroke(); }
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
        const gpuCanvas = document.createElement("canvas"), renderer = data.view === "surface" ? api.createSurfaceRenderer(gpuCanvas) : null;
        canvas.className = "landscape-canvas"; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Landscape. Hover or tap for values. Drag to orbit, shift or right-drag to pan. Pinch or wheel to zoom. Arrow keys rotate; plus and minus zoom.");
        toolbar.className = "landscape-toolbar"; readout.className = "landscape-readout"; readout.textContent = "Hover or tap to inspect values";
        host.append(canvas, toolbar, readout);
        const initial = () => ({ yaw: data.yaw, pitch: data.pitch, zoom: data.zoom, panX: data.panX || 0, panY: data.panY || 0 });
        let camera = initial(), current, drag = null, frame = null, gesture = null;
        const touches = new Map();
        const options = { signal: context.signal };
        const draw = () => { frame = null; current = scene(data, grid, context, camera); const gpu = renderer?.render(current); canvas.dataset.engine = gpu ? "webgl" : "canvas"; paint(canvas, current, gpu ? gpuCanvas : null); };
        const redraw = () => { if (frame === null) frame = requestAnimationFrame(draw); };
        const button = (label, action) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", action, options); toolbar.append(b); return b; };
        button("Reset view", () => { camera = initial(); redraw(); });
        if (data.view === "surface" && !context.isPresenting) button("Use view for export", () => context.update(camera));
        const zoom = amount => { camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * amount)); redraw(); };
        if (data.view === "surface") { button("−", () => zoom(0.9)).setAttribute("aria-label", "Zoom out"); button("+", () => zoom(1.1)).setAttribute("aria-label", "Zoom in"); }
        const inspect = event => {
            const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * current.width, y = (event.clientY - rect.top) / rect.height * current.height;
            const p = pick(current, grid, data, x, y);
            readout.textContent = p ? `${p.label ? p.label + " · " : ""}${data.xLabel}: ${format(p.x)} · ${data.yLabel}: ${format(p.y)} · ${data.valueLabel}: ${format(p.z)} (interpolated${data.subtractMin ? ", minimum subtracted" : ""})` : "No value here (outside the grid or missing samples)";
        };
        const pinch = () => { const [a, b] = [...touches.values()]; return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
        canvas.addEventListener("contextmenu", event => event.preventDefault(), options);
        canvas.addEventListener("pointerdown", event => {
            if (![0, 2].includes(event.button)) return;
            event.preventDefault(); canvas.focus(); canvas.setPointerCapture(event.pointerId);
            if (event.pointerType === "touch") { touches.set(event.pointerId, { x: event.clientX, y: event.clientY }); if (touches.size === 2) { gesture = { ...pinch(), ...camera }; drag = null; return; } }
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ...camera, pan: event.shiftKey || event.button === 2 }; inspect(event);
        }, options);
        canvas.addEventListener("pointermove", event => {
            if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (gesture && touches.size === 2 && data.view === "surface") { const p = pinch(), r = canvas.getBoundingClientRect(); camera.zoom = Math.max(0.25, Math.min(4, gesture.zoom * p.distance / Math.max(1, gesture.distance))); camera.panX = Math.max(-1, Math.min(1, gesture.panX + (p.x - gesture.x) / r.width)); camera.panY = Math.max(-1, Math.min(1, gesture.panY + (p.y - gesture.y) / r.height)); redraw(); }
            else if (drag && drag.id === event.pointerId && data.view === "surface") {
                const rect = canvas.getBoundingClientRect();
                if (drag.pan) { camera.panX = Math.max(-1, Math.min(1, drag.panX + (event.clientX - drag.x) / rect.width)); camera.panY = Math.max(-1, Math.min(1, drag.panY + (event.clientY - drag.y) / rect.height)); }
                else { camera.yaw = (drag.yaw + (event.clientX - drag.x) / rect.width * 240) % 360; camera.pitch = Math.max(-85, Math.min(85, drag.pitch + (event.clientY - drag.y) / rect.height * 120)); }
                redraw();
            }
            else inspect(event);
        }, options);
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, event => { touches.delete(event.pointerId); gesture = null; drag = null; }, options);
        canvas.addEventListener("wheel", event => { event.preventDefault(); if (data.view === "surface") zoom(event.deltaY > 0 ? 0.9 : 1.1); }, { ...options, passive: false });
        canvas.addEventListener("keydown", event => {
            if (event.key === "Escape") return; // preserve the show's exit key
            if (data.view === "surface") {
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
    Object.assign(api, { scene, svg, paint, pick, mount });
})();
