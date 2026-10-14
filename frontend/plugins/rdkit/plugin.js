// RDKit plugin: publication-quality 2D depictions from SMILES with RDKit (vendor/RDKit_minimal.js and .wasm, BSD
// licence, loaded the first time a structure is drawn): substructure highlighting from a SMARTS pattern, R/S and
// E/Z labels, and an optional property card (formula, molar mass, logP, TPSA, H-bond donors and acceptors,
// rotatable bonds). RDKit runs in a worker (worker.js): the page's security policy does not allow it to run here.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

    let worker = null;
    let nextId = 1;
    const pending = new Map();

    function startWorker(context) {
        if (worker) return worker;
        worker = new Worker(new URL("worker.js", context.baseUrl).href);
        worker.onmessage = event => {
            const { id, error, ...result } = event.data || {};
            const waiting = pending.get(id);
            if (!waiting) return;
            pending.delete(id);
            clearTimeout(waiting.timer);
            if (error) waiting.reject(new Error(error));
            else waiting.resolve(result);
        };
        worker.onerror = event => {
            // The worker itself failed (RDKit or its WebAssembly could not load): fail what waits, start afresh next time.
            event.preventDefault?.();
            const message = `RDKit could not start: ${event.message || "the worker failed"}`;
            pending.forEach(waiting => {
                clearTimeout(waiting.timer);
                waiting.reject(new Error(message));
            });
            pending.clear();
            worker.terminate();
            worker = null;
        };
        return worker;
    }

    function askWorker(context, message) {
        const target = startWorker(context);
        const id = nextId++;
        return new Promise((resolve, reject) => {
            // The first drawing loads RDKit (about 7 MB); later ones take milliseconds.
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("RDKit took too long to answer"));
            }, 60000);
            pending.set(id, { resolve, reject, timer });
            target.postMessage({ id, ...message });
        });
    }

    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const subscriptDigits = text => String(text).replace(/\d/g, digit => SUBSCRIPTS[Number(digit)]);
    const fixed = (value, digits) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "–");

    // The drawing cropped to what RDKit drew (it centres the molecule in a fixed canvas).
    function cropped(svgText, ink) {
        const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
        const svg = doc.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== "svg") throw new Error("RDKit returned no drawing");
        // RDKit draws R/S and E/Z labels in black whatever the options say; on a dark slide they vanished.
        svg.querySelectorAll("[class*='CIP_Code'], [class*='note']").forEach(node => {
            node.setAttribute("fill", ink);
            node.setAttribute("fill-opacity", "0.8");
        });
        svg.querySelectorAll("rect").forEach(rect => {
            // The canvas background (transparent anyway) would make the crop the whole canvas.
            if (rect.getAttribute("width") === svg.getAttribute("width") || /background/.test(rect.getAttribute("class") || "")) rect.remove();
        });
        const probe = document.importNode(svg, true);
        probe.setAttribute("style", "position:fixed;left:-10000px;top:0;visibility:hidden;");
        document.body.appendChild(probe);
        try {
            const box = probe.getBBox();
            const pad = 6;
            return { svg, x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
        } finally {
            probe.remove();
        }
    }

    SlideForgePlugins.register({
        id: "rdkit",
        version: "1",
        name: "Structure (RDKit)",
        description: "A publication-quality structure from SMILES, with substructure highlights, R/S labels and properties",
        icon: "fa-solid fa-atom",
        insert: { label: "Structure (RDKit, with properties)", keywords: "rdkit smiles smarts structure molecule highlight stereo cip logp tpsa properties lipinski chemistry" },
        defaultSize: { width: 320, height: 240 },
        defaultData: {
            smiles: "CC(C)C[C@H](C)C(=O)O",
            highlight: "C(=O)[OH]",
            highlightColor: "#fbbf24",
            stereo: true,
            atomColors: true,
            color: "",
            bondWidth: 2,
            card: "none",
            fontSize: 14,
        },
        fields: [
            { key: "smiles", label: "SMILES", type: "text", primary: true, placeholder: "e.g. CC(=O)Oc1ccccc1C(=O)O", hint: "Press Enter to redraw. The first drawing loads RDKit (a few seconds)." },
            { key: "highlight", label: "Highlight (SMARTS)", type: "text", placeholder: "e.g. c1ccccc1 or C(=O)[OH]", hint: "Every match is highlighted. Leave empty for none." },
            { key: "highlightColor", label: "Highlight colour", type: "color" },
            { key: "stereo", label: "Stereo", checkboxLabel: "Label stereocentres (R/S, E/Z)", type: "checkbox" },
            { key: "atomColors", label: "Atom colours", checkboxLabel: "Colour heteroatoms by element", type: "checkbox" },
            { key: "color", label: "Bond colour", type: "color", allowAuto: true },
            { key: "bondWidth", label: "Bond width", type: "number", min: 0.5, max: 6, step: 0.5 },
            {
                key: "card",
                label: "Property card",
                type: "select",
                options: [
                    { value: "none", label: "None" },
                    { value: "right", label: "Beside the structure" },
                    { value: "below", label: "Below the structure" },
                ],
            },
            { key: "fontSize", label: "Card text size (px)", type: "number", min: 8, max: 32, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                smiles: String(data.smiles ?? "").trim().slice(0, 2000),
                highlight: String(data.highlight ?? "").trim().slice(0, 500),
                highlightColor: HEX_COLOR.test(String(data.highlightColor || "")) ? data.highlightColor : "#fbbf24",
                stereo: data.stereo !== false,
                atomColors: data.atomColors !== false,
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                bondWidth: number(data.bondWidth, 2, 0.5, 6),
                card: ["none", "right", "below"].includes(data.card) ? data.card : "none",
                fontSize: number(data.fontSize, 14, 8, 32),
            };
        },

        async render(data, context) {
            if (!data.smiles) throw new Error("Type a SMILES string");
            const ink = HEX_COLOR.test(data.color) ? data.color : HEX_COLOR.test(context.textColor) ? context.textColor : "#111827";
            const inkRgb = rgb(ink);
            // Carbon and hydrogen in the ink colour; with atom colours off, every element.
            const palette = {};
            (data.atomColors ? [0, 1, 6] : Array.from({ length: 119 }, (_, z) => z)).forEach(z => (palette[z] = inkRgb));
            const result = await askWorker(context, {
                smiles: data.smiles,
                options: {
                    highlight: data.highlight,
                    draw: {
                        // A fixed bond length keeps structures and the card's text in proportion (RDKit
                        // would otherwise scale every molecule to fill the canvas). Larger ones still shrink to fit.
                        width: 1200,
                        height: 900,
                        fixedBondLength: 30,
                        addStereoAnnotation: data.stereo,
                        clearBackground: false,
                        backgroundColour: [1, 1, 1, 0],
                        atomColourPalette: palette,
                        bondLineWidth: data.bondWidth,
                        highlightColour: [...rgb(data.highlightColor), 0.6],
                        fillHighlights: true,
                        highlightRadius: 0.35,
                    },
                },
            });
            const drawing = cropped(result.svg, ink);
            const size = data.fontSize;
            const p = result.properties || {};
            const lines =
                data.card === "none"
                    ? []
                    : [
                          ["Formula", subscriptDigits(p.formula || "–")],
                          ["Molar mass", `${fixed(p.weight, 2)} g/mol`],
                          ["cLogP", fixed(p.logP, 2)],
                          ["TPSA", `${fixed(p.tpsa, 1)} Å²`],
                          ["H-bond donors / acceptors", `${p.hbd ?? "–"} / ${p.hba ?? "–"}`],
                          ["Rotatable bonds", String(p.rotatable ?? "–")],
                      ];
            const nameWidth = Math.max(0, ...lines.map(([name]) => context.measureText(name, { size: size * 0.85, family: FONT })));
            const valueWidth = Math.max(0, ...lines.map(([, value]) => context.measureText(value, { size, family: FONT, weight: 700 })));
            const lineHeight = size * 1.45;
            const cardWidth = lines.length ? nameWidth + size + valueWidth + size * 1.4 : 0;
            const cardHeight = lines.length ? lines.length * lineHeight + size * 0.8 : 0;
            const side = data.card === "right";
            const gap = lines.length ? size : 0;
            const width = side ? drawing.width + gap + cardWidth : Math.max(drawing.width, cardWidth);
            const height = side ? Math.max(drawing.height, cardHeight) : drawing.height + gap + cardHeight;
            const molX = side ? 0 : (width - drawing.width) / 2;
            const molY = side ? (height - drawing.height) / 2 : 0;
            // RDKit's own <svg> (with its namespaces) placed as a nested drawing, cropped by its viewBox.
            const nested = drawing.svg;
            nested.setAttribute("x", molX.toFixed(1));
            nested.setAttribute("y", molY.toFixed(1));
            nested.setAttribute("width", drawing.width.toFixed(1));
            nested.setAttribute("height", drawing.height.toFixed(1));
            nested.setAttribute("viewBox", `${drawing.x.toFixed(1)} ${drawing.y.toFixed(1)} ${drawing.width.toFixed(1)} ${drawing.height.toFixed(1)}`);
            const parts = [new XMLSerializer().serializeToString(nested)];
            if (lines.length) {
                const cardX = side ? drawing.width + gap : (width - cardWidth) / 2;
                const cardY = side ? (height - cardHeight) / 2 : drawing.height + gap;
                parts.push(`<rect x="${cardX.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardWidth.toFixed(1)}" height="${cardHeight.toFixed(1)}" rx="${(size * 0.5).toFixed(1)}" fill="${ink}" fill-opacity="0.06" stroke="${ink}" stroke-opacity="0.25"/>`);
                lines.forEach(([name, value], index) => {
                    const y = cardY + size * 0.4 + lineHeight * (index + 0.72);
                    parts.push(`<text x="${(cardX + size * 0.7).toFixed(1)}" y="${y.toFixed(1)}" font-size="${(size * 0.85).toFixed(1)}" fill="${ink}" fill-opacity="0.75">${context.escapeXml(name)}</text>`);
                    parts.push(`<text x="${(cardX + cardWidth - size * 0.7).toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-weight="700" text-anchor="end" fill="${ink}">${context.escapeXml(value)}</text>`);
                });
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
