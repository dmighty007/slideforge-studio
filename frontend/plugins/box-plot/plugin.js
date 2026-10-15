// Box and violin plots from a table: one column per group (the first row may name the groups). Boxes follow Tukey:
// the box spans the quartiles, whiskers reach the furthest points within 1.5 × IQR, points beyond are outliers.
// Violins are Gaussian kernel density estimates (Silverman's bandwidth), cut at the data's range.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    // Okabe & Ito, a palette readable with colour-vision deficiencies.
    const OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#000000"];

    function readGroups(rows) {
        if (!rows.length) throw new Error("Paste the data: one column per group, the first row may hold their names");
        const columns = Math.max(...rows.map(row => row.length));
        const isNumber = cell => cell !== "" && Number.isFinite(Number(cell.replace(",", ".")));
        const header = rows[0].some(cell => cell !== "" && !isNumber(cell));
        const names = Array.from({ length: columns }, (_, i) => (header ? rows[0][i] || `Group ${i + 1}` : `Group ${i + 1}`));
        const groups = names.map((name, column) => ({
            name,
            values: rows
                .slice(header ? 1 : 0)
                .map(row => row[column] ?? "")
                .filter(cell => cell !== "")
                .map((cell, index) => {
                    const value = Number(cell.replace(",", "."));
                    if (!Number.isFinite(value)) throw new Error(`Column “${name}”, value ${index + 1}: “${cell}” is not a number`);
                    return value;
                })
                .sort((a, b) => a - b),
        }));
        const empty = groups.find(group => !group.values.length);
        if (empty) throw new Error(`Column “${empty.name}” has no values`);
        return groups;
    }

    // Quantiles by linear interpolation (R's type 7, as in Excel's QUARTILE.INC).
    const quantile = (sorted, q) => {
        const position = (sorted.length - 1) * q;
        const low = Math.floor(position);
        return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (position - low);
    };

    function summarise(values) {
        const q1 = quantile(values, 0.25);
        const median = quantile(values, 0.5);
        const q3 = quantile(values, 0.75);
        const iqr = q3 - q1;
        const inside = values.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length - 1));
        return { q1, median, q3, iqr, mean, sd, low: Math.min(...inside), high: Math.max(...inside), outliers: values.filter(v => !inside.includes(v)) };
    }

    // Density at evenly spaced points from the smallest to the largest value.
    function density(values, stats) {
        const n = values.length;
        const spread = Math.min(stats.sd, stats.iqr / 1.34) || stats.sd || Math.abs(stats.mean) * 0.1 || 1;
        const bandwidth = 0.9 * spread * n ** -0.2;
        const min = values[0];
        const max = values.at(-1);
        const steps = 48;
        return Array.from({ length: steps + 1 }, (_, i) => {
            const y = min + ((max - min) * i) / steps;
            const d = values.reduce((sum, v) => sum + Math.exp(-0.5 * ((y - v) / bandwidth) ** 2), 0) / (n * bandwidth * Math.sqrt(2 * Math.PI));
            return { y, d };
        });
    }

    // The same small sideways offset for a point every time it is drawn (no random jitter between redraws).
    const jitter = (index, value) => {
        const seed = Math.sin(index * 12.9898 + value * 78.233) * 43758.5453;
        return seed - Math.floor(seed) - 0.5;
    };

    const numberOrNull = text => {
        const value = Number(String(text ?? "").trim().replace(",", "."));
        return String(text ?? "").trim() !== "" && Number.isFinite(value) ? value : null;
    };

    SlideForgePlugins.register({
        id: "box-plot",
        version: "2",
        name: "Box / Violin Plot",
        description: "Box, violin or box-and-violin plots from columns of numbers",
        icon: "fa-solid fa-chart-simple",
        insert: { fill: true, category: "Statistics", label: "Box / violin plot", keywords: "box plot violin whisker distribution quartile median statistics csv" },
        defaultSize: { width: 440, height: 300 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            data: "Control,Drug A,Drug B\n4.1,5.2,6.8\n3.8,5.9,7.4\n4.6,6.3,6.1\n4.0,5.5,8.2\n3.5,6.8,7.0\n4.4,5.1,7.7\n4.9,6.0,6.6\n3.9,7.9,7.2",
            kind: "box",
            points: "outliers",
            mean: false,
            yLabel: "Response",
            yMin: "",
            yMax: "",
            palette: "okabe",
            fill: "#4f46e5",
            fontSize: 16,
        },
        fields: [
            { key: "data", label: "Data", type: "table", summarize: rows => {
                    const header = rows[0].some(cell => cell !== "" && !Number.isFinite(Number(String(cell).replace(",", "."))));
                    const body = header ? rows.slice(1) : rows;
                    const groups = Math.max(...rows.map(row => row.length));
                    const values = body.flatMap(row => row).filter(cell => String(cell).trim() !== "").length;
                    return `${groups} group${groups === 1 ? "" : "s"}, ${values} values`;
                }, rows: 7, placeholder: "Control,Treated\n4.1,5.2\n3.8,5.9", hint: "One column per group; the first row may name the groups." },
            {
                key: "kind",
                label: "Plot",
                type: "select",
                options: [
                    { value: "box", label: "Box plot" },
                    { value: "violin", label: "Violin plot" },
                    { value: "violin-box", label: "Violin with a box inside" },
                ],
            },
            {
                key: "points",
                label: "Points",
                type: "select",
                options: [
                    { value: "outliers", label: "Outliers only" },
                    { value: "all", label: "All data points" },
                    { value: "none", label: "None" },
                ],
            },
            { key: "mean", label: "Mean", checkboxLabel: "Mark the mean (◆)", type: "checkbox" },
            { key: "yLabel", label: "Y axis label", type: "text" },
            { key: "yMin", label: "Y axis from", type: "text", placeholder: "Automatic" },
            { key: "yMax", label: "Y axis to", type: "text", placeholder: "Automatic" },
            {
                key: "palette",
                label: "Colours",
                type: "select",
                options: [
                    { value: "okabe", label: "One per group (colour-blind safe)" },
                    { value: "single", label: "One colour for all" },
                ],
            },
            { key: "fill", label: "Colour (one for all)", type: "color" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 32, step: 1 },
        ],

        normalize(data) {
            const fontSize = Number(data.fontSize);
            return {
                data: String(data.data ?? ""),
                kind: ["box", "violin", "violin-box"].includes(data.kind) ? data.kind : "box",
                points: ["outliers", "all", "none"].includes(data.points) ? data.points : "outliers",
                mean: Boolean(data.mean),
                yLabel: String(data.yLabel ?? "").slice(0, 80),
                yMin: String(data.yMin ?? "").slice(0, 20),
                yMax: String(data.yMax ?? "").slice(0, 20),
                palette: data.palette === "single" ? "single" : "okabe",
                fill: HEX_COLOR.test(String(data.fill || "")) ? data.fill : "#4f46e5",
                fontSize: Number.isFinite(fontSize) ? Math.min(32, Math.max(8, fontSize)) : 14,
            };
        },

        render(data, context) {
            const groups = readGroups(context.parseTable(data.data)).slice(0, 20);
            groups.forEach(group => (group.stats = summarise(group.values)));
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;
            const all = groups.flatMap(group => group.values);
            const ticks = context.niceTicks(numberOrNull(data.yMin) ?? Math.min(...all), numberOrNull(data.yMax) ?? Math.max(...all), Math.max(3, Math.round(height / 60)));
            const yLow = numberOrNull(data.yMin) ?? ticks.min;
            const yHigh = numberOrNull(data.yMax) ?? ticks.max;
            if (!(yHigh > yLow)) throw new Error("The y axis must end above where it starts");
            const format = value => String(Number(value.toPrecision(6)));
            const tickLabels = ticks.ticks.filter(t => t >= yLow - 1e-9 && t <= yHigh + 1e-9);
            const tickWidth = Math.max(...tickLabels.map(t => context.measureText(format(t), { size, family: FONT })));
            const left = (data.yLabel ? size * 1.6 : 0) + tickWidth + size * 0.8;
            const bottom = size * 2.2;
            const top = size * 0.8;
            const right = size * 0.6;
            const plotWidth = Math.max(40, width - left - right);
            const plotHeight = Math.max(40, height - top - bottom);
            const y = value => top + plotHeight - ((value - yLow) / (yHigh - yLow)) * plotHeight;
            const band = plotWidth / groups.length;
            const parts = [];
            // Grid and axis
            tickLabels.forEach(t => {
                parts.push(`<line x1="${left}" x2="${left + plotWidth}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${ink}" stroke-opacity="0.12"/>`);
                parts.push(`<text x="${(left - size * 0.4).toFixed(1)}" y="${(y(t) + size * 0.3).toFixed(1)}" font-size="${size}" text-anchor="end" fill="${ink}">${format(t)}</text>`);
            });
            parts.push(`<path d="M${left} ${top}V${top + plotHeight}H${left + plotWidth}" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
            if (data.yLabel) {
                parts.push(`<text transform="translate(${(size * 0.95).toFixed(1)} ${(top + plotHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.yLabel)}</text>`);
            }
            // Clip marks to the plot when the axis range is set narrower than the data.
            parts.push(`<clipPath id="plot"><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"/></clipPath><g clip-path="url(#plot)">`);
            groups.forEach((group, index) => {
                const color = data.palette === "single" ? data.fill : OKABE_ITO[index % OKABE_ITO.length];
                const centre = left + band * (index + 0.5);
                const s = group.stats;
                const boxHalf = Math.min(band * 0.28, 40) * (data.kind === "violin-box" ? 0.35 : 1);
                if (data.kind !== "box" && group.values.length > 1) {
                    const curve = density(group.values, s);
                    const peak = Math.max(...curve.map(point => point.d)) || 1;
                    const half = band * 0.42;
                    const side = sign => curve.map(point => `${(centre + sign * (point.d / peak) * half).toFixed(1)} ${y(point.y).toFixed(1)}`);
                    parts.push(`<path d="M${side(1).join("L")}L${side(-1).reverse().join("L")}Z" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5"/>`);
                }
                if (data.kind !== "violin") {
                    parts.push(`<path d="M${centre} ${y(s.low).toFixed(1)}V${y(s.q1).toFixed(1)}M${centre} ${y(s.q3).toFixed(1)}V${y(s.high).toFixed(1)}M${(centre - boxHalf / 2).toFixed(1)} ${y(s.low).toFixed(1)}h${boxHalf.toFixed(1)}M${(centre - boxHalf / 2).toFixed(1)} ${y(s.high).toFixed(1)}h${boxHalf.toFixed(1)}" stroke="${ink}" stroke-width="1.5" fill="none"/>`);
                    parts.push(`<rect x="${(centre - boxHalf).toFixed(1)}" y="${y(s.q3).toFixed(1)}" width="${(2 * boxHalf).toFixed(1)}" height="${Math.max(1, y(s.q1) - y(s.q3)).toFixed(1)}" fill="${color}" fill-opacity="${data.kind === "box" ? 0.55 : 0.9}" stroke="${ink}" stroke-width="1.5"/>`);
                } else {
                    parts.push(`<path d="M${(centre - band * 0.12).toFixed(1)} ${y(s.q1).toFixed(1)}h${(band * 0.24).toFixed(1)}M${(centre - band * 0.12).toFixed(1)} ${y(s.q3).toFixed(1)}h${(band * 0.24).toFixed(1)}" stroke="${ink}" stroke-width="1" stroke-dasharray="3 2"/>`);
                }
                const medianHalf = data.kind === "violin" ? band * 0.12 : boxHalf;
                parts.push(`<path d="M${(centre - medianHalf).toFixed(1)} ${y(s.median).toFixed(1)}h${(2 * medianHalf).toFixed(1)}" stroke="${data.kind === "violin" ? ink : "#ffffff"}" stroke-width="2.5"/>`);
                const shown = data.points === "all" ? group.values : data.points === "outliers" && data.kind !== "violin" ? s.outliers : [];
                shown.forEach((value, i) => {
                    const dx = data.points === "all" ? jitter(i, value) * band * 0.3 : 0;
                    parts.push(`<circle cx="${(centre + dx).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${(size * 0.22).toFixed(1)}" fill="${data.points === "all" ? ink : "none"}" fill-opacity="0.55" stroke="${ink}" stroke-width="1"/>`);
                });
                if (data.mean) {
                    const r = size * 0.32;
                    parts.push(`<path d="M${centre} ${(y(s.mean) - r).toFixed(1)}l${r} ${r}l${-r} ${r}l${-r} ${-r}Z" fill="#ffffff" stroke="${ink}" stroke-width="1.2"/>`);
                }
            });
            parts.push("</g>");
            // Group names, shrunk to fit their band.
            groups.forEach((group, index) => {
                const centre = left + band * (index + 0.5);
                const nameWidth = context.measureText(group.name, { size, family: FONT });
                const fit = Math.max(8, Math.min(size, (size * band * 0.95) / Math.max(1, nameWidth)));
                parts.push(`<text x="${centre.toFixed(1)}" y="${(top + plotHeight + size * 1.4).toFixed(1)}" font-size="${fit.toFixed(1)}" text-anchor="middle" fill="${ink}">${context.escapeXml(group.name)}</text>`);
            });
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
