// Volcano plot plugin: log2 fold change against −log10 p from a table (label, log2FC, p-value). Points beyond both
// thresholds are coloured up or down; the most significant hits are labelled where their labels do not collide.

(() => {
    const FONT = "Arial, Helvetica, sans-serif";
    const COLORS = { up: "#D55E00", down: "#0072B2", ns: "#9ca3af" };
    const MAX_POINTS = 10000;

    function readRows(rows) {
        const points = [];
        rows.forEach((row, index) => {
            const [label = "", fcText = "", pText = ""] = row;
            const fc = Number(String(fcText).replace(",", "."));
            const p = Number(String(pText).replace(",", "."));
            if (index === 0 && !Number.isFinite(fc)) return; // a header row
            if (!Number.isFinite(fc) || !Number.isFinite(p) || p < 0 || p > 1) {
                throw new Error(`Row ${index + 1}: needs a log2 fold change and a p-value between 0 and 1`);
            }
            points.push({ label, fc, p });
        });
        if (!points.length) throw new Error("Add rows: label, log2 fold change, p-value");
        if (points.length > MAX_POINTS) throw new Error(`Volcano plots of up to ${MAX_POINTS.toLocaleString()} points can be drawn`);
        return points;
    }

    const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    SlideForgePlugins.register({
        id: "volcano",
        version: "1",
        name: "Volcano Plot",
        description: "log2 fold change against −log10 p, with thresholds, up/down colours and labelled top hits",
        icon: "fa-solid fa-volcano",
        insert: { label: "Volcano plot", keywords: "volcano plot differential expression fold change p-value rna-seq proteomics deseq" },
        defaultSize: { width: 480, height: 360 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            data:
                "Gene,log2FC,p\nIL6,4.2,1e-12\nCXCL8,3.6,3e-10\nTNF,2.9,2e-8\nCCL2,2.4,5e-6\nSOCS3,1.8,4e-4\nMYC,1.2,0.02\nSOX2,-3.8,4e-11\nNANOG,-3.1,6e-9\nPOU5F1,-2.6,1e-6\nLIN28A,-1.9,3e-4\nKLF4,-1.1,0.03\nGAPDH,0.1,0.8\nACTB,-0.2,0.6\nTUBB,0.3,0.4\nRPL13,-0.4,0.3\nEEF1A1,0.5,0.2\nHPRT1,-0.1,0.9\nB2M,0.8,0.08\nPGK1,-0.7,0.1\nTBP,0.2,0.7",
            fcThreshold: 1,
            pThreshold: 0.05,
            labels: 8,
            pointSize: 4,
            xLabel: "log₂ fold change",
            yLabel: "−log₁₀ p",
            fontSize: 12,
        },
        fields: [
            { key: "data", label: "Data", type: "table", columns: ["Label", "log2 fold change", "p-value"], rows: 7, hint: "Use adjusted p-values (FDR) if you have them." },
            { key: "fcThreshold", label: "Fold-change threshold (|log2FC|)", type: "number", min: 0, max: 20, step: 0.1 },
            { key: "pThreshold", label: "p-value threshold", type: "number", min: 0, max: 1, step: "any" },
            { key: "labels", label: "Label the top hits", type: "number", min: 0, max: 50, step: 1, hint: "The most significant points past both thresholds; labels that would overlap are left out." },
            { key: "pointSize", label: "Point size (px)", type: "number", min: 1, max: 12, step: 0.5 },
            { key: "xLabel", label: "X axis label", type: "text" },
            { key: "yLabel", label: "Y axis label", type: "text" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 28, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                data: String(data.data ?? ""),
                fcThreshold: number(data.fcThreshold, 1, 0, 20),
                pThreshold: number(data.pThreshold, 0.05, 1e-300, 1),
                labels: Math.round(number(data.labels, 8, 0, 50)),
                pointSize: number(data.pointSize, 4, 1, 12),
                xLabel: String(data.xLabel ?? "").slice(0, 60),
                yLabel: String(data.yLabel ?? "").slice(0, 60),
                fontSize: number(data.fontSize, 12, 8, 28),
            };
        },

        render(data, context) {
            const points = readRows(context.parseTable(data.data));
            // p = 0 has no logarithm: it is drawn just above the most significant finite value.
            const finiteTop = Math.max(1, ...points.filter(pt => pt.p > 0).map(pt => -Math.log10(pt.p)));
            points.forEach(pt => {
                pt.y = pt.p > 0 ? -Math.log10(pt.p) : finiteTop * 1.05;
                pt.kind = pt.p <= data.pThreshold && pt.fc >= data.fcThreshold ? "up" : pt.p <= data.pThreshold && pt.fc <= -data.fcThreshold ? "down" : "ns";
            });
            const counts = { up: 0, down: 0, ns: 0 };
            points.forEach(pt => counts[pt.kind]++);
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;
            const reach = Math.max(data.fcThreshold * 1.2, ...points.map(pt => Math.abs(pt.fc)));
            const xTicks = context.niceTicks(-reach, reach, 6);
            const yTicks = context.niceTicks(0, Math.max(-Math.log10(data.pThreshold) * 1.2, ...points.map(pt => pt.y)), 5);
            const tickWidth = Math.max(...yTicks.ticks.map(t => context.measureText(String(t), { size: size * 0.9, family: FONT })));
            const left = (data.yLabel ? size * 1.6 : 0) + tickWidth + size * 0.7;
            const top = size * 2.2; // the legend sits above the plot
            const bottom = size * 1.8 + (data.xLabel ? size * 1.4 : 0);
            const plotWidth = Math.max(40, width - left - size);
            const plotHeight = Math.max(40, height - top - bottom);
            const x = v => left + ((v - xTicks.min) / (xTicks.max - xTicks.min)) * plotWidth;
            const y = v => top + plotHeight - ((v - yTicks.min) / (yTicks.max - yTicks.min)) * plotHeight;
            const parts = [];
            yTicks.ticks.forEach(t => {
                parts.push(`<line x1="${left}" x2="${left + plotWidth}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${ink}" stroke-opacity="0.1"/>`);
                parts.push(`<text x="${(left - size * 0.4).toFixed(1)}" y="${(y(t) + size * 0.32).toFixed(1)}" font-size="${(size * 0.9).toFixed(1)}" text-anchor="end" fill="${ink}">${t}</text>`);
            });
            xTicks.ticks.forEach(t => {
                parts.push(`<text x="${x(t).toFixed(1)}" y="${(top + plotHeight + size * 1.3).toFixed(1)}" font-size="${(size * 0.9).toFixed(1)}" text-anchor="middle" fill="${ink}">${Number(t.toPrecision(6))}</text>`);
            });
            parts.push(`<path d="M${left} ${top}V${top + plotHeight}H${left + plotWidth}" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
            // Threshold lines
            const dashed = `stroke="${ink}" stroke-opacity="0.55" stroke-dasharray="4 3"`;
            parts.push(`<line x1="${left}" x2="${left + plotWidth}" y1="${y(-Math.log10(data.pThreshold)).toFixed(1)}" y2="${y(-Math.log10(data.pThreshold)).toFixed(1)}" ${dashed}/>`);
            [-data.fcThreshold, data.fcThreshold].forEach(v => parts.push(`<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${top}" y2="${top + plotHeight}" ${dashed}/>`));
            // Points: not significant first, so the coloured ones sit on top.
            ["ns", "down", "up"].forEach(kind => {
                const r = data.pointSize / 2;
                points
                    .filter(pt => pt.kind === kind)
                    .forEach(pt => parts.push(`<circle cx="${x(pt.fc).toFixed(1)}" cy="${y(pt.y).toFixed(1)}" r="${r}" fill="${COLORS[kind]}" fill-opacity="${kind === "ns" ? 0.55 : 0.85}"/>`));
            });
            // Labels for the top hits, each placed beside its point where it collides with nothing placed so far.
            const taken = points.map(pt => ({ x: x(pt.fc) - data.pointSize / 2, y: y(pt.y) - data.pointSize / 2, w: data.pointSize, h: data.pointSize }));
            const plotBox = { x: left, y: top, w: plotWidth, h: plotHeight };
            const hits = points.filter(pt => pt.kind !== "ns" && pt.label).sort((a, b) => b.y - a.y || Math.abs(b.fc) - Math.abs(a.fc)).slice(0, data.labels);
            const labelSize = size * 0.9;
            hits.forEach(pt => {
                const w = context.measureText(pt.label, { size: labelSize, family: FONT });
                const px = x(pt.fc);
                const py = y(pt.y);
                const offset = data.pointSize / 2 + 2;
                const tries = [
                    { x: pt.fc >= 0 ? px + offset : px - offset - w, y: py - labelSize * 0.5 },
                    { x: pt.fc >= 0 ? px - offset - w : px + offset, y: py - labelSize * 0.5 },
                    { x: px - w / 2, y: py - offset - labelSize },
                    { x: px - w / 2, y: py + offset },
                ];
                const spot = tries
                    .map(t => ({ ...t, w, h: labelSize }))
                    .find(box => box.x >= plotBox.x && box.x + box.w <= plotBox.x + plotBox.w && box.y >= plotBox.y - labelSize && box.y + box.h <= plotBox.y + plotBox.h && !taken.some(other => overlaps(box, other)));
                if (!spot) return;
                taken.push(spot);
                parts.push(`<text x="${spot.x.toFixed(1)}" y="${(spot.y + labelSize * 0.82).toFixed(1)}" font-size="${labelSize.toFixed(1)}" fill="${ink}" class="hit">${context.escapeXml(pt.label)}</text>`);
            });
            // Legend with counts
            const items = [
                ["up", `Up ${counts.up}`],
                ["down", `Down ${counts.down}`],
                ["ns", `Not significant ${counts.ns}`],
            ];
            let lx = left;
            items.forEach(([kind, text]) => {
                parts.push(`<circle cx="${(lx + size * 0.4).toFixed(1)}" cy="${(size * 0.9).toFixed(1)}" r="${(size * 0.35).toFixed(1)}" fill="${COLORS[kind]}"/>`);
                parts.push(`<text x="${(lx + size).toFixed(1)}" y="${(size * 1.2).toFixed(1)}" font-size="${(size * 0.9).toFixed(1)}" fill="${ink}">${text}</text>`);
                lx += size * 1.8 + context.measureText(text, { size: size * 0.9, family: FONT });
            });
            if (data.xLabel) parts.push(`<text x="${(left + plotWidth / 2).toFixed(1)}" y="${(top + plotHeight + size * 2.75).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.xLabel)}</text>`);
            if (data.yLabel) parts.push(`<text transform="translate(${(size * 0.95).toFixed(1)} ${(top + plotHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.yLabel)}</text>`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
