// Shared scene geometry for the live canvas and the SVG kept with the deck and used by every export.
(() => {
    const api = window.SlideForgeLandscape;
    const palettes = {
        viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
        magma: ["#000004", "#51127c", "#b73779", "#fc8961", "#fcfdbf"],
        "blue-red": ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
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
        const ink = context.textColor || "#172033", background = context.theme?.surfaceColor || "#ffffff";
        const font = data.fontSize, items = [], plot = { x: 66, y: data.title ? 44 : 24, w: width - 172, h: height - (data.title ? 108 : 88) };
        const rect = (x, y, w, h, fill) => items.push({ kind: "rect", x, y, w, h, fill });
        const line = (points, stroke = ink, lineWidth = 1) => items.push({ kind: "path", points, stroke, lineWidth });
        const text = (value, x, y, anchor = "middle", size = font, rotate = 0) => items.push({ kind: "text", value, x, y, anchor, size, fill: ink, rotate });
        rect(0, 0, width, height, background);
        if (data.title) text(data.title, width / 2, 24, "middle", font + 3);
        const xMin = grid.xs[0], xMax = grid.xs.at(-1), yMin = grid.ys[0], yMax = grid.ys.at(-1);
        const px = x => plot.x + (x - xMin) / (xMax - xMin) * plot.w, py = y => plot.y + plot.h - (y - yMin) / (yMax - yMin) * plot.h;
        const faces = [];
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
            const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
            const project = p => {
                const x = (p.x - xMin) / (xMax - xMin) * 2 - 1, y = (p.y - yMin) / (yMax - yMin) * 2 - 1;
                const z = grid.high === grid.low ? 0 : (p.z - grid.low) / (grid.high - grid.low) * data.zScale * 1.5;
                const u = x * Math.cos(yaw) - y * Math.sin(yaw), v = x * Math.sin(yaw) + y * Math.cos(yaw);
                return { ...p, u, v: v * Math.sin(pitch) - z * Math.cos(pitch), depth: v * Math.cos(pitch) + z * Math.sin(pitch) };
            };
            const projected = grid.cells.map(cell => ({ ...cell, vertices: cell.vertices.map(project) }));
            const all = projected.flatMap(c => c.vertices);
            const loX = Math.min(...all.map(p => p.u)), hiX = Math.max(...all.map(p => p.u)), loY = Math.min(...all.map(p => p.v)), hiY = Math.max(...all.map(p => p.v));
            const scale = Math.min(plot.w / Math.max(0.1, hiX - loX), plot.h / Math.max(0.1, hiY - loY)) * 0.88 * camera.zoom;
            const screen = p => ({ ...p, sx: plot.x + plot.w / 2 + (p.u - (loX + hiX) / 2) * scale, sy: plot.y + plot.h / 2 + (p.v - (loY + hiY) / 2) * scale });
            projected.sort((a, b) => b.vertices.reduce((s, p) => s + p.depth, 0) - a.vertices.reduce((s, p) => s + p.depth, 0));
            for (const cell of projected) {
                const vertices = cell.vertices.map(screen), points = vertices.map(p => [p.sx, p.sy]);
                const face = { kind: "polygon", points, vertices, fill: color(data, grid, cell.value) }; faces.push(face); items.push(face);
            }
            const origin = screen(project({ x: xMin, y: yMin, z: grid.low }));
            for (const end of [{ x: xMax, y: yMin, z: grid.low, label: data.xLabel }, { x: xMin, y: yMax, z: grid.low, label: data.yLabel }]) {
                const p = screen(project(end)); line([[origin.sx, origin.sy], [p.sx, p.sy]], ink, 1.5); text(`${end.label} (${format(end.x === xMax ? xMax : yMax)})`, p.sx, p.sy + 18, "middle", font - 2);
            }
            text(`Origin: (${format(xMin)}, ${format(yMin)})`, plot.x, height - 17, "start", font - 2);
        }
        const barX = width - 76, barY = plot.y + 16, barH = Math.max(40, plot.h - 40);
        for (let i = 0; i < 64; i++) rect(barX, barY + barH * i / 64, 14, barH / 64 + 0.2, color(data, grid, grid.colorMax - (grid.colorMax - grid.colorMin) * (i + 0.5) / 64));
        text(format(grid.colorMax), barX + 20, barY + 5, "start", font - 3); text(format(grid.colorMin), barX + 20, barY + barH, "start", font - 3);
        text(data.valueLabel, width - 10, barY + barH / 2, "middle", font - 1, -90);
        if (data.subtractMin) text("Minimum subtracted", plot.x, height - 1, "start", Math.max(9, font - 4));
        return { width, height, items, plot, faces, background, fontFamily: context.fontFamily || "Arial, Helvetica, sans-serif" };
    }
    function svg(scene) {
        const n = v => Number(v.toFixed(2)), points = ps => ps.map(p => p.map(n).join(",")).join(" ");
        const path = ps => ps.map((p, i) => `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`).join("");
        const parts = scene.items.map(p => {
            if (p.kind === "rect") return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${p.fill}"/>`;
            if (p.kind === "polygon") return `<polygon clip-path="url(#landscape-plot)" points="${points(p.points)}" fill="${p.fill}" stroke="${p.fill}" stroke-width="0.3"/>`;
            if (p.kind === "path" || p.kind === "segments") return `<path d="${p.kind === "segments" ? p.segments.map(path).join("") : path(p.points)}" fill="none" stroke="${escape(p.stroke)}" stroke-width="${p.lineWidth}"/>`;
            return `<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="${p.anchor}" font-size="${p.size}" fill="${escape(p.fill)}"${p.rotate ? ` transform="rotate(${p.rotate} ${n(p.x)} ${n(p.y)})"` : ""}>${escape(p.value)}</text>`;
        });
        const p = scene.plot;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="${escape(scene.fontFamily)}"><defs><clipPath id="landscape-plot"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/></clipPath></defs>${parts.join("")}</svg>`;
    }
    function paint(canvas, scene) {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== Math.round(scene.width * ratio) || canvas.height !== Math.round(scene.height * ratio)) { canvas.width = Math.round(scene.width * ratio); canvas.height = Math.round(scene.height * ratio); }
        const c = canvas.getContext("2d"); c.setTransform(ratio, 0, 0, ratio, 0, 0); c.clearRect(0, 0, scene.width, scene.height);
        const path = ps => { ps.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); };
        for (const p of scene.items) {
            c.fillStyle = p.fill || "#000"; c.strokeStyle = p.stroke || p.fill || "#000"; c.lineWidth = p.lineWidth || 0.3;
            if (p.kind === "rect") c.fillRect(p.x, p.y, p.w, p.h);
            else if (p.kind === "polygon") { c.save(); c.beginPath(); c.rect(scene.plot.x, scene.plot.y, scene.plot.w, scene.plot.h); c.clip(); c.beginPath(); path(p.points); c.closePath(); c.fill(); c.stroke(); c.restore(); }
            else if (p.kind === "path" || p.kind === "segments") { c.beginPath(); if (p.kind === "segments") p.segments.forEach(path); else path(p.points); c.stroke(); }
            else { c.save(); c.translate(p.x, p.y); c.rotate(p.rotate * Math.PI / 180); c.font = `${p.size}px ${scene.fontFamily}`; c.textAlign = p.anchor === "middle" ? "center" : p.anchor === "end" ? "right" : "left"; c.fillText(p.value, 0, 0); c.restore(); }
        }
    }
    function pick(scene, grid, data, x, y) {
        if (data.view !== "surface") {
            const p = scene.plot, wx = grid.xs[0] + (x - p.x) / p.w * (grid.xs.at(-1) - grid.xs[0]), wy = grid.ys[0] + (p.y + p.h - y) / p.h * (grid.ys.at(-1) - grid.ys[0]);
            const z = api.sample(grid, wx, wy); return z === null ? null : { x: wx, y: wy, z };
        }
        // Topmost visible mesh triangle, with barycentric interpolation in the orthographic projection.
        for (const face of [...scene.faces].reverse()) for (const ids of [[0, 1, 2], [0, 2, 3]]) {
            const [a, b, c] = ids.map(i => face.vertices[i]);
            const denominator = (b.sy - c.sy) * (a.sx - c.sx) + (c.sx - b.sx) * (a.sy - c.sy);
            if (Math.abs(denominator) < 1e-9) continue;
            const u = ((b.sy - c.sy) * (x - c.sx) + (c.sx - b.sx) * (y - c.sy)) / denominator, v = ((c.sy - a.sy) * (x - c.sx) + (a.sx - c.sx) * (y - c.sy)) / denominator, w = 1 - u - v;
            if (Math.min(u, v, w) >= -1e-7) return { x: a.x * u + b.x * v + c.x * w, y: a.y * u + b.y * v + c.y * w, z: a.z * u + b.z * v + c.z * w };
        }
        return null;
    }
    function mount(host, data, context) {
        const grid = api.model(data, context.parseTable), canvas = document.createElement("canvas"), toolbar = document.createElement("div"), readout = document.createElement("output");
        canvas.className = "landscape-canvas"; canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Landscape. Hover or tap for values. Drag to rotate a surface; use arrow keys to rotate and plus or minus to zoom.");
        toolbar.className = "landscape-toolbar"; readout.className = "landscape-readout"; readout.textContent = "Hover or tap to inspect values";
        host.append(canvas, toolbar, readout);
        let camera = { yaw: data.yaw, pitch: data.pitch, zoom: data.zoom }, current, drag = null, frame = null;
        const options = { signal: context.signal };
        const draw = () => { frame = null; current = scene(data, grid, context, camera); paint(canvas, current); };
        const redraw = () => { if (frame === null) frame = requestAnimationFrame(draw); };
        const button = (label, action) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", action, options); toolbar.append(b); return b; };
        button("Reset view", () => { camera = { yaw: data.yaw, pitch: data.pitch, zoom: data.zoom }; redraw(); });
        if (data.view === "surface" && !context.isPresenting) button("Use view for export", () => context.update(camera));
        const zoom = amount => { camera.zoom = Math.max(0.5, Math.min(2, camera.zoom * amount)); redraw(); };
        if (data.view === "surface") { button("−", () => zoom(0.9)).setAttribute("aria-label", "Zoom out"); button("+", () => zoom(1.1)).setAttribute("aria-label", "Zoom in"); }
        const inspect = event => {
            const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * current.width, y = (event.clientY - rect.top) / rect.height * current.height;
            const p = pick(current, grid, data, x, y);
            readout.textContent = p ? `${data.xLabel}: ${format(p.x)} · ${data.yLabel}: ${format(p.y)} · ${data.valueLabel}: ${format(p.z)} (interpolated${data.subtractMin ? ", minimum subtracted" : ""})` : "No value here (outside the grid or missing samples)";
        };
        canvas.addEventListener("pointerdown", event => { if (event.button !== 0) return; canvas.focus(); canvas.setPointerCapture(event.pointerId); drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: camera.yaw, pitch: camera.pitch }; inspect(event); }, options);
        canvas.addEventListener("pointermove", event => {
            if (drag && drag.id === event.pointerId && data.view === "surface") { const rect = canvas.getBoundingClientRect(); camera.yaw = (drag.yaw + (event.clientX - drag.x) / rect.width * 240) % 360; camera.pitch = Math.max(10, Math.min(80, drag.pitch + (event.clientY - drag.y) / rect.height * 120)); redraw(); }
            else inspect(event);
        }, options);
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, () => { drag = null; }, options);
        canvas.addEventListener("wheel", event => { event.preventDefault(); if (data.view === "surface") zoom(event.deltaY > 0 ? 0.9 : 1.1); }, { ...options, passive: false });
        canvas.addEventListener("keydown", event => {
            if (event.key === "Escape") return; // preserve the show's exit key
            if (data.view === "surface") {
                if (event.key === "ArrowLeft") camera.yaw -= 5;
                else if (event.key === "ArrowRight") camera.yaw += 5;
                else if (event.key === "ArrowUp") camera.pitch = Math.max(10, camera.pitch - 5);
                else if (event.key === "ArrowDown") camera.pitch = Math.min(80, camera.pitch + 5);
                else if (["+", "="].includes(event.key)) zoom(1.1);
                else if (event.key === "-") zoom(0.9);
                else return;
                event.preventDefault(); redraw();
            }
        }, options);
        draw();
        return () => { if (frame !== null) cancelAnimationFrame(frame); drag = null; host.replaceChildren(); };
    }
    Object.assign(api, { scene, svg, paint, pick, mount });
})();
