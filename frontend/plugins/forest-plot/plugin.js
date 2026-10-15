// Forest plot plugin: estimates with confidence intervals, one study or subgroup per row, from a table
// (label, estimate, lower, upper, optional weight). The last row can be the pooled estimate, drawn as a diamond.
// Ratios (odds, hazard, risk) use a log scale around 1; differences a linear scale around 0.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";

    function readRows(rows) {
        const number = cell => {
            const value = Number(String(cell ?? "").trim().replace(",", "."));
            return String(cell ?? "").trim() !== "" && Number.isFinite(value) ? value : null;
        };
        const items = [];
        rows.forEach((row, index) => {
            const [label = "", estimateText, lowerText, upperText, weightText] = row;
            const estimate = number(estimateText);
            if (index === 0 && estimate === null) return; // a header row
            const lower = number(lowerText);
            const upper = number(upperText);
            if (estimate === null || lower === null || upper === null) {
                throw new Error(`Row ${index + 1}: needs an estimate, a lower and an upper limit`);
            }
            if (lower > estimate || upper < estimate) throw new Error(`Row ${index + 1}: the estimate must lie between its lower and upper limits`);
            items.push({ label, estimate, lower, upper, weight: number(weightText) });
        });
        if (!items.length) throw new Error("Add rows: label, estimate, lower, upper (and a weight if you have one)");
        return items;
    }

    // Ticks for a log axis: 1, 2, 5 × 10^n (thinned to about `count`), or round values on a linear one.
    function logTicks(min, max, count) {
        const candidates = [];
        for (let power = Math.floor(Math.log10(min)) - 1; power <= Math.ceil(Math.log10(max)) + 1; power++) {
            [1, 2, 5].forEach(f => candidates.push(Number((f * 10 ** power).toPrecision(6))));
        }
        let ticks = candidates.filter(t => t >= min * 0.999 && t <= max * 1.001);
        while (ticks.length > count + 1) ticks = ticks.filter((_, i) => i % 2 === 0 || ticks[i] === 1);
        return ticks;
    }

    SlideForgePlugins.register({
        id: "forest-plot",
        version: "2",
        name: "Forest Plot",
        description: "Estimates with confidence intervals per study or subgroup, with a pooled diamond",
        icon: "fa-solid fa-bars-staggered",
        insert: { category: "Statistics", label: "Forest plot", keywords: "forest plot meta-analysis odds ratio hazard ratio confidence interval subgroup effect size" },
        defaultSize: { width: 620, height: 260 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            data: "Study,Estimate,Lower,Upper,Weight\nAdams 2018,0.82,0.61,1.10,18\nBaker 2019,0.67,0.48,0.94,22\nChen 2020,0.91,0.72,1.15,30\nDiaz 2021,0.58,0.36,0.93,12\nEvans 2022,0.75,0.55,1.02,18\nOverall,0.76,0.66,0.87,",
            scale: "log",
            nullValue: 1,
            pooledLast: true,
            showValues: true,
            decimals: 2,
            xLabel: "Hazard ratio (95% CI)",
            leftNote: "Favours treatment",
            rightNote: "Favours control",
            color: "",
            fontSize: 13,
        },
        fields: [
            { key: "data", label: "Rows", type: "table", columns: ["Label", "Estimate", "Lower", "Upper", "Weight (optional)"], rows: 7 },
            {
                key: "scale",
                label: "Scale",
                type: "select",
                options: [
                    { value: "log", label: "Log (ratios: OR, HR, RR)" },
                    { value: "linear", label: "Linear (differences)" },
                ],
            },
            { key: "nullValue", label: "No-effect line at", type: "number", step: "any", hint: "1 for ratios, 0 for differences." },
            { key: "pooledLast", label: "Pooled estimate", checkboxLabel: "Draw the last row as a diamond", type: "checkbox" },
            { key: "showValues", label: "Values", checkboxLabel: "Show “estimate [lower, upper]” on the right", type: "checkbox" },
            { key: "decimals", label: "Decimals", type: "number", min: 0, max: 4, step: 1 },
            { key: "xLabel", label: "Axis label", type: "text" },
            { key: "leftNote", label: "Left of the line", type: "text", placeholder: "e.g. Favours treatment" },
            { key: "rightNote", label: "Right of the line", type: "text", placeholder: "e.g. Favours control" },
            { key: "color", label: "Marker colour", type: "color", allowAuto: true },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 28, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            const scale = data.scale === "linear" ? "linear" : "log";
            return {
                data: String(data.data ?? ""),
                scale,
                nullValue: number(data.nullValue, scale === "log" ? 1 : 0, -1e9, 1e9),
                pooledLast: data.pooledLast !== false,
                showValues: data.showValues !== false,
                decimals: Math.round(number(data.decimals, 2, 0, 4)),
                xLabel: String(data.xLabel ?? "").slice(0, 80),
                leftNote: String(data.leftNote ?? "").slice(0, 60),
                rightNote: String(data.rightNote ?? "").slice(0, 60),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                fontSize: number(data.fontSize, 13, 8, 28),
            };
        },

        render(data, context) {
            const rows = readRows(context.parseTable(data.data)).slice(0, 60);
            const log = data.scale === "log";
            if (log && (rows.some(row => row.lower <= 0) || data.nullValue <= 0)) {
                throw new Error("A log scale needs positive values (ratios). Choose the linear scale for differences.");
            }
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const marker = HEX_COLOR.test(data.color) ? data.color : ink;
            const size = data.fontSize;
            const fixed = value => value.toFixed(data.decimals);
            const values = rows.map(row => `${fixed(row.estimate)} [${fixed(row.lower)}, ${fixed(row.upper)}]`);
            const labelWidth = Math.max(...rows.map((row, i) => context.measureText(row.label, { size, family: FONT, weight: data.pooledLast && i === rows.length - 1 ? 700 : 400 })));
            const valueWidth = data.showValues ? Math.max(...values.map(text => context.measureText(text, { size, family: FONT }))) : 0;
            const gap = size;
            const plotLeft = labelWidth + gap;
            const plotRight = width - (data.showValues ? valueWidth + gap : size * 0.5);
            if (plotRight - plotLeft < 40) throw new Error("The box is too narrow for these labels; widen it or shorten the labels");
            const axisHeight = size * 1.6 + (data.xLabel ? size * 1.4 : 0) + (data.leftNote || data.rightNote ? size * 1.3 : 0);
            const rowHeight = Math.max(size * 1.2, (height - axisHeight - size * 0.5) / rows.length);
            const transform = value => (log ? Math.log(value) : value);
            let low = Math.min(data.nullValue, ...rows.map(row => row.lower));
            let high = Math.max(data.nullValue, ...rows.map(row => row.upper));
            // Every value the same (all 1 on a ratio scale): widen the range, or the axis has zero width and every
            // coordinate came out NaN.
            if (!(high > low)) {
                if (log) {
                    low /= 2;
                    high *= 2;
                } else {
                    const pad = Math.abs(low) * 0.5 || 1;
                    low -= pad;
                    high += pad;
                }
            }
            let ticks;
            if (log) {
                ticks = logTicks(low, high, 6);
                if (ticks.length < 4) {
                    // A narrow range (0.36–1.15) gets only 0.5 and 1 from 1-2-5 steps: finer round values inside it.
                    ticks = context.niceTicks(low, high, 5).ticks.filter(t => t >= low && t <= high);
                } else {
                    low = Math.min(low, ticks[0]);
                    high = Math.max(high, ticks.at(-1));
                }
                const pad = (Math.log(high) - Math.log(low)) * 0.05;
                low = Math.exp(Math.log(low) - pad);
                high = Math.exp(Math.log(high) + pad);
            } else {
                const nice = context.niceTicks(low, high, 5);
                ticks = nice.ticks;
                low = nice.min;
                high = nice.max;
            }
            const x = value => plotLeft + ((transform(value) - transform(low)) / (transform(high) - transform(low))) * (plotRight - plotLeft);
            const rowY = index => size * 0.5 + rowHeight * (index + 0.5);
            const axisY = size * 0.5 + rowHeight * rows.length + size * 0.3;
            const weights = rows.map(row => row.weight).filter(weight => weight !== null && weight > 0);
            const maxWeight = weights.length ? Math.max(...weights) : null;
            const parts = [];
            // No-effect line
            parts.push(`<line x1="${x(data.nullValue).toFixed(1)}" x2="${x(data.nullValue).toFixed(1)}" y1="${(size * 0.3).toFixed(1)}" y2="${axisY.toFixed(1)}" stroke="${ink}" stroke-width="1.2" stroke-dasharray="4 3"/>`);
            rows.forEach((row, index) => {
                const yy = rowY(index);
                const pooled = data.pooledLast && index === rows.length - 1 && rows.length > 1;
                parts.push(`<text x="0" y="${(yy + size * 0.35).toFixed(1)}" font-size="${size}"${pooled ? ' font-weight="700"' : ""} fill="${ink}">${context.escapeXml(row.label)}</text>`);
                if (data.showValues) {
                    parts.push(`<text x="${width}" y="${(yy + size * 0.35).toFixed(1)}" font-size="${size}" text-anchor="end"${pooled ? ' font-weight="700"' : ""} fill="${ink}">${values[index]}</text>`);
                }
                if (pooled) {
                    const h = Math.min(rowHeight * 0.36, size * 0.6);
                    parts.push(`<path d="M${x(row.lower).toFixed(1)} ${yy}L${x(row.estimate).toFixed(1)} ${(yy - h).toFixed(1)}L${x(row.upper).toFixed(1)} ${yy}L${x(row.estimate).toFixed(1)} ${(yy + h).toFixed(1)}Z" fill="${marker}" stroke="${marker}"/>`);
                } else {
                    parts.push(`<line x1="${x(row.lower).toFixed(1)}" x2="${x(row.upper).toFixed(1)}" y1="${yy}" y2="${yy}" stroke="${ink}" stroke-width="1.4"/>`);
                    // Squares sized by weight (area proportional), or all alike without weights.
                    const half = maxWeight && row.weight ? Math.max(2.5, Math.sqrt(row.weight / maxWeight) * Math.min(rowHeight * 0.32, size * 0.6)) : size * 0.32;
                    parts.push(`<rect x="${(x(row.estimate) - half).toFixed(1)}" y="${(yy - half).toFixed(1)}" width="${(2 * half).toFixed(1)}" height="${(2 * half).toFixed(1)}" fill="${marker}"/>`);
                }
            });
            // Axis
            parts.push(`<line x1="${plotLeft}" x2="${plotRight}" y1="${axisY.toFixed(1)}" y2="${axisY.toFixed(1)}" stroke="${ink}" stroke-width="1.2"/>`);
            ticks
                .filter(t => t >= low && t <= high)
                .forEach(t => {
                    parts.push(`<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${axisY.toFixed(1)}" y2="${(axisY + size * 0.35).toFixed(1)}" stroke="${ink}"/>`);
                    parts.push(`<text x="${x(t).toFixed(1)}" y="${(axisY + size * 1.3).toFixed(1)}" font-size="${(size * 0.85).toFixed(1)}" text-anchor="middle" fill="${ink}">${Number(t.toPrecision(6))}</text>`);
                });
            let below = axisY + size * 1.3;
            if (data.xLabel) {
                below += size * 1.4;
                parts.push(`<text x="${((plotLeft + plotRight) / 2).toFixed(1)}" y="${below.toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.xLabel)}</text>`);
            }
            if (data.leftNote || data.rightNote) {
                below += size * 1.3;
                const nullX = x(data.nullValue);
                if (data.leftNote) parts.push(`<text x="${(nullX - size * 0.5).toFixed(1)}" y="${below.toFixed(1)}" font-size="${(size * 0.85).toFixed(1)}" font-style="italic" text-anchor="end" fill="${ink}">← ${context.escapeXml(data.leftNote)}</text>`);
                if (data.rightNote) parts.push(`<text x="${(nullX + size * 0.5).toFixed(1)}" y="${below.toFixed(1)}" font-size="${(size * 0.85).toFixed(1)}" font-style="italic" fill="${ink}">${context.escapeXml(data.rightNote)} →</text>`);
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${Math.max(height, below + size * 0.4).toFixed(1)}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
