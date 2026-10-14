// Circuit plugin: a schematic from a short text description. Nodes are placed by hand on a grid ("node a 0 0");
// each part runs in a straight line between two nodes ("R1 a b 10k"), its symbol in the middle and wires to the
// nodes. Junction dots are drawn where three or more connections meet. Resistors in US (zigzag) or IEC (box) style.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    // The kind of a part from its name's prefix (longest first: LED before L).
    const PREFIXES = [
        ["LED", "led"],
        ["SW", "switch"],
        ["W", "wire"],
        ["R", "resistor"],
        ["C", "capacitor"],
        ["L", "inductor"],
        ["V", "voltage"],
        ["B", "battery"],
        ["I", "current"],
        ["D", "diode"],
        ["S", "switch"],
        ["M", "meter"],
        ["A", "ammeter"],
        ["X", "lamp"],
    ];

    function partKind(name) {
        const upper = name.toUpperCase();
        return PREFIXES.find(([prefix]) => upper.startsWith(prefix))?.[1] || null;
    }

    // "10k" → "10 kΩ" for resistors, "1u" → "1 µF" for capacitors… values that already have a unit stay as typed.
    function prettyValue(kind, value) {
        if (!value) return "";
        const match = value.match(/^([0-9.]+)\s*(p|n|u|µ|m|k|K|M|G|meg)?$/);
        if (!match) return value.replace(/ohm/i, "Ω").replace(/\bu(?=[FHAV])/g, "µ");
        const prefix = { u: "µ", meg: "M", K: "k" }[match[2]] ?? (match[2] || "");
        const unit = { resistor: "Ω", capacitor: "F", inductor: "H", voltage: "V", battery: "V", current: "A" }[kind] || "";
        return `${match[1]} ${prefix}${unit}`.trim();
    }

    function readSpec(text) {
        const nodes = new Map();
        const parts = [];
        const grounds = [];
        String(text ?? "")
            .split(/\r?\n/)
            .forEach((raw, index) => {
                const line = raw.replace(/[#;].*$/, "").trim();
                if (!line) return;
                const where = `Line ${index + 1}`;
                const words = line.split(/\s+/);
                const keyword = words[0].toLowerCase();
                if (keyword === "node") {
                    const [, name, xText, yText] = words;
                    const x = Number(xText);
                    const y = Number(yText);
                    if (!name || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${where}: write “node name x y”, e.g. node a 0 0`);
                    nodes.set(name, { name, x, y, links: 0 });
                    return;
                }
                if (keyword === "gnd" || keyword === "ground") {
                    if (!words[1]) throw new Error(`${where}: write “gnd node”`);
                    grounds.push({ node: words[1], where });
                    return;
                }
                const [name, from, to, ...valueWords] = words;
                const kind = partKind(name);
                if (!kind) throw new Error(`${where}: “${name}” does not start with a known part letter (R, C, L, V, B, I, D, LED, SW, W, M, A, X) or node/gnd`);
                if (!from || !to) throw new Error(`${where}: write “${name} node1 node2 value”`);
                parts.push({ name, kind, from, to, value: valueWords.join(" "), where });
            });
        [...parts.flatMap(part => [part.from, part.to].map(node => ({ node, where: part.where }))), ...grounds].forEach(({ node, where }) => {
            if (!nodes.has(node)) throw new Error(`${where}: no node called “${node}” (add “node ${node} x y”)`);
        });
        parts.forEach(part => {
            const a = nodes.get(part.from);
            const b = nodes.get(part.to);
            if (a.x === b.x && a.y === b.y) throw new Error(`${part.where}: ${part.name} joins two nodes at the same place`);
            a.links++;
            b.links++;
        });
        grounds.forEach(ground => nodes.get(ground.node).links++);
        if (!parts.length) throw new Error("Add nodes and parts, e.g. node a 0 0, node b 3 0, R1 a b 10k");
        return { nodes, parts, grounds };
    }

    // A symbol drawn along +x from −half to +half (u: one grid step in px), as SVG markup in local coordinates.
    function symbol(kind, half, u, style, stroke, fill, angle = 0) {
        // Text inside a symbol is turned back upright whatever way the part runs.
        const upright = (x, y) => `transform="rotate(${(-angle).toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})"`;
        const w = stroke;
        const line = (x1, y1, x2, y2) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
        const h = u * 0.22; // half the height of most symbols
        switch (kind) {
            case "resistor": {
                if (style === "iec") return `<rect x="${-half}" y="${-h * 0.75}" width="${2 * half}" height="${h * 1.5}" fill="${fill}"/>`;
                const peaks = 6;
                const step = (2 * half) / (peaks * 2);
                let d = `M${-half} 0`;
                for (let k = 0; k < peaks * 2; k++) d += `L${(-half + step * (k + 0.5)).toFixed(1)} ${k % 2 ? h : -h}`;
                return `<path d="${d}L${half} 0" fill="none"/>`;
            }
            case "capacitor": {
                const gap = u * 0.08;
                return line(-half, 0, -gap, 0) + line(gap, 0, half, 0) + line(-gap, -h * 1.4, -gap, h * 1.4) + line(gap, -h * 1.4, gap, h * 1.4);
            }
            case "inductor": {
                const bumps = 4;
                const r = half / bumps;
                let d = `M${-half} 0`;
                for (let k = 0; k < bumps; k++) d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(-half + 2 * r * (k + 1)).toFixed(1)} 0`;
                return `<path d="${d}" fill="none"/>`;
            }
            case "voltage":
            case "current":
            case "meter":
            case "ammeter":
            case "lamp": {
                const r = Math.min(half, u * 0.3);
                let inside = "";
                if (kind === "voltage") {
                    // + towards the first node, − towards the second.
                    const sign = (x, text) => `<text x="${x.toFixed(1)}" y="${(r * 0.3).toFixed(1)}" font-size="${(r * 0.85).toFixed(1)}" font-weight="700" text-anchor="middle" stroke="none" fill="currentColor" ${upright(x, 0)}>${text}</text>`;
                    inside = sign(-r * 0.45, "+") + sign(r * 0.45, "−");
                }
                if (kind === "current") inside = `<path d="M${(-r * 0.55).toFixed(1)} 0H${(r * 0.45).toFixed(1)}M${(r * 0.15).toFixed(1)} ${(-r * 0.3).toFixed(1)}L${(r * 0.5).toFixed(1)} 0L${(r * 0.15).toFixed(1)} ${(r * 0.3).toFixed(1)}" fill="none"/>`;
                if (kind === "meter" || kind === "ammeter") inside = `<text x="0" y="${(r * 0.38).toFixed(1)}" font-size="${(r * 1.1).toFixed(1)}" text-anchor="middle" stroke="none" fill="currentColor" ${upright(0, 0)}>${kind === "meter" ? "V" : "A"}</text>`;
                if (kind === "lamp") inside = line(-r * 0.7, -r * 0.7, r * 0.7, r * 0.7) + line(-r * 0.7, r * 0.7, r * 0.7, -r * 0.7);
                return line(-half, 0, -r, 0) + line(r, 0, half, 0) + `<circle r="${r.toFixed(1)}" fill="${fill}"/>` + inside;
            }
            case "battery": {
                const gap = u * 0.07;
                return line(-half, 0, -gap, 0) + line(gap, 0, half, 0) + line(-gap, -h * 1.6, -gap, h * 1.6) + `<line x1="${gap}" y1="${(-h * 0.8).toFixed(1)}" x2="${gap}" y2="${(h * 0.8).toFixed(1)}" stroke-width="${(w * 2).toFixed(1)}"/>`;
            }
            case "diode":
            case "led": {
                const s = Math.min(half * 0.6, u * 0.2);
                let extra = "";
                if (kind === "led") {
                    const arrow = (x0, y0) => `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}l${(s * 0.7).toFixed(1)} ${(-s * 0.7).toFixed(1)}m${(-s * 0.35).toFixed(1)} 0h${(s * 0.35).toFixed(1)}v${(s * 0.35).toFixed(1)}" fill="none"/>`;
                    extra = arrow(-s * 0.1, -s * 1.15) + arrow(s * 0.5, -s * 1.15);
                }
                return line(-half, 0, -s, 0) + line(s, 0, half, 0) + `<path d="M${-s} ${-s}L${s} 0L${-s} ${s}Z" fill="${fill}"/>` + line(s, -s, s, s) + extra;
            }
            case "switch": {
                const s = Math.min(half * 0.7, u * 0.3);
                return line(-half, 0, -s, 0) + line(s, 0, half, 0) + `<circle cx="${-s}" r="${(w * 1.4).toFixed(1)}" fill="${fill}"/><circle cx="${s}" r="${(w * 1.4).toFixed(1)}" fill="${fill}"/>` + line(-s, 0, s * 0.85, -s * 0.9);
            }
            default:
                return line(-half, 0, half, 0);
        }
    }

    SlideForgePlugins.register({
        id: "circuit",
        version: "1",
        name: "Circuit",
        description: "A circuit schematic from a short text description of nodes and parts",
        icon: "fa-solid fa-bolt",
        insert: { label: "Circuit diagram", keywords: "circuit schematic resistor capacitor inductor diode led battery electronics netlist" },
        defaultSize: { width: 420, height: 280 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            spec: "# RC low-pass filter\nnode in 0 0\nnode a 3 0\nnode out 5 0\nnode g1 0 3\nnode g2 3 3\nnode g3 5 3\nV1 in g1 5V\nR1 in a 10k\nW1 a out\nC1 a g2 100n\nW2 g1 g2\nW3 g2 g3\ngnd g2",
            style: "us",
            labels: true,
            lineWidth: 2,
            fontSize: 14,
            color: "",
        },
        fields: [
            {
                key: "spec",
                label: "Circuit",
                type: "textarea",
                placeholder: "node a 0 0\nnode b 3 0\nR1 a b 10k",
                hint: "“node name x y” places a node on the grid (y down). Parts: “R1 a b 10k” — R resistor, C capacitor, L inductor, V source (+ at the first node), B battery, I current source, D diode (anode first), LED, SW switch, M voltmeter, A ammeter, X lamp, W wire. “gnd node” adds a ground symbol below a node. # starts a comment.",
            },
            {
                key: "style",
                label: "Resistor symbol",
                type: "select",
                options: [
                    { value: "us", label: "Zigzag (US)" },
                    { value: "iec", label: "Box (IEC)" },
                ],
            },
            { key: "labels", label: "Labels", checkboxLabel: "Show names and values", type: "checkbox" },
            { key: "lineWidth", label: "Line width (px)", type: "number", min: 0.5, max: 6, step: 0.5 },
            { key: "fontSize", label: "Label size (px)", type: "number", min: 8, max: 32, step: 1 },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                spec: String(data.spec ?? "").slice(0, 8000),
                style: data.style === "iec" ? "iec" : "us",
                labels: data.labels !== false,
                lineWidth: number(data.lineWidth, 2, 0.5, 6),
                fontSize: number(data.fontSize, 14, 8, 32),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const { nodes, parts, grounds } = readSpec(data.spec);
            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const fill = context.theme?.surfaceColor || "none";
            const size = data.fontSize;
            const all = [...nodes.values()];
            const minX = Math.min(...all.map(n => n.x));
            const maxX = Math.max(...all.map(n => n.x));
            const minY = Math.min(...all.map(n => n.y));
            const maxY = Math.max(...all.map(n => n.y));
            const groundRoom = grounds.length ? size * 1.6 : 0;
            const gridStep = margin => Math.min((width - 2 * margin) / Math.max(maxX - minX, 1), (height - 2 * margin - groundRoom) / Math.max(maxY - minY, 1));
            // Symbols are sized from the grid step but not beyond the text's scale; the margin leaves room for the
            // symbol and the label beside a part on the outer edge.
            const symbolStep = Math.max(size * 2, Math.min(gridStep(size * 3), size * 5));
            const margin = symbolStep * 0.36 + size * 1.6;
            const gridU = gridStep(margin);
            const offsetX = (width - (maxX - minX) * gridU) / 2;
            const offsetY = (height - groundRoom - (maxY - minY) * gridU) / 2;
            const u = Math.min(gridU, symbolStep);
            const at = node => ({ x: offsetX + (node.x - minX) * gridU, y: offsetY + (node.y - minY) * gridU });
            const markup = [];
            const labels = [];
            parts.forEach(part => {
                const a = at(nodes.get(part.from));
                const b = at(nodes.get(part.to));
                const length = Math.hypot(b.x - a.x, b.y - a.y);
                const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
                const cx = (a.x + b.x) / 2;
                const cy = (a.y + b.y) / 2;
                if (part.kind === "wire") {
                    markup.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" data-part="${context.escapeXml(part.name)}"/>`);
                    return;
                }
                const half = Math.min(length / 2, Math.max(u * 0.45, Math.min(u * 0.7, length * 0.3)));
                markup.push(
                    `<g data-part="${context.escapeXml(part.name)}" data-kind="${part.kind}">` +
                        `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${(cx - ((b.x - a.x) / length) * half).toFixed(1)}" y2="${(cy - ((b.y - a.y) / length) * half).toFixed(1)}"/>` +
                        `<line x1="${(cx + ((b.x - a.x) / length) * half).toFixed(1)}" y1="${(cy + ((b.y - a.y) / length) * half).toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>` +
                        `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${angle.toFixed(2)})">${symbol(part.kind, half, u, data.style, data.lineWidth, fill, angle)}</g>` +
                        "</g>",
                );
                if (data.labels) {
                    // Name and value side by side, beside the symbol: above a horizontal part, right of a vertical one.
                    const text = [part.name, prettyValue(part.kind, part.value)].filter(Boolean).join(" ");
                    const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
                    const clearance = u * 0.32 + size * 0.4;
                    labels.push(
                        vertical
                            ? `<text x="${(cx + clearance).toFixed(1)}" y="${(cy + size * 0.35).toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(text)}</text>`
                            : `<text x="${cx.toFixed(1)}" y="${(cy - clearance).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(text)}</text>`,
                    );
                }
            });
            grounds.forEach(ground => {
                const p = at(nodes.get(ground.node));
                const s = size * 0.8;
                markup.push(
                    `<path d="M${p.x} ${p.y}v${s}M${p.x - s} ${p.y + s}h${2 * s}M${p.x - s * 0.62} ${p.y + s * 1.35}h${s * 1.24}M${p.x - s * 0.25} ${p.y + s * 1.7}h${s * 0.5}" data-ground="${context.escapeXml(ground.node)}"/>`,
                );
            });
            // Junction dots where three or more connections meet.
            const dots = all
                .filter(node => node.links >= 3)
                .map(node => {
                    const p = at(node);
                    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${Math.max(2.5, data.lineWidth * 1.6).toFixed(1)}" fill="${ink}" stroke="none" data-junction="${context.escapeXml(node.name)}"/>`;
                });
            return (
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">` +
                `<g fill="none" stroke="${ink}" stroke-width="${data.lineWidth}" stroke-linecap="round" stroke-linejoin="round" color="${ink}">${markup.join("")}${dots.join("")}</g>` +
                labels.join("") +
                "</svg>"
            );
        },
    });
})();
