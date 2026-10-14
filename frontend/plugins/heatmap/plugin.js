// Heatmap plugin: a matrix (first row: column names, first column: row names) as coloured cells, with optional
// z-scoring of rows or columns, hierarchical clustering (average linkage, Euclidean or correlation distance) that
// reorders rows and/or columns with dendrograms, values in the cells and a colour bar.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    // A copy of the colour bar plugin's table (plugins stay self-contained).
    const COLORMAPS = {
        viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
        magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
        plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
        inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
        cividis: ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#fee838"],
        coolwarm: ["#3b4cc0", "#6282ea", "#8db0fe", "#b8d0f9", "#dddcdc", "#f5c4ad", "#f49a7b", "#de604d", "#b40426"],
        rdbu: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"],
        greys: ["#ffffff", "#d9d9d9", "#bdbdbd", "#969696", "#636363", "#252525", "#000000"],
    };
    const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    function colorAt(name, t) {
        const stops = COLORMAPS[name] || COLORMAPS.viridis;
        const position = Math.min(1, Math.max(0, t)) * (stops.length - 1);
        const index = Math.min(stops.length - 2, Math.floor(position));
        const f = position - index;
        const [a, b] = [toRgb(stops[index]), toRgb(stops[index + 1])];
        return `#${a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, "0")).join("")}`;
    }
    // Black or white text, whichever reads better on a cell colour.
    const textOn = hex => {
        const [r, g, b] = toRgb(hex).map(v => v / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "#111111" : "#ffffff";
    };

    function readMatrix(rows) {
        if (rows.length < 2) throw new Error("Paste a matrix: column names in the first row, row names in the first column");
        const columns = rows[0].slice(1);
        if (!columns.length) throw new Error("The matrix needs at least one column of values");
        const names = [];
        const values = rows.slice(1).map((row, r) => {
            names.push(row[0] || `Row ${r + 1}`);
            return columns.map((_, c) => {
                const cell = String(row[c + 1] ?? "").trim();
                if (cell === "" || /^(na|nan)$/i.test(cell)) return NaN;
                const value = Number(cell.replace(",", "."));
                if (!Number.isFinite(value)) throw new Error(`Row “${names[r]}”, column “${columns[c] || c + 1}”: “${cell}” is not a number`);
                return value;
            });
        });
        return { rowNames: names, columnNames: columns.map((name, i) => name || `Col ${i + 1}`), values };
    }

    // Each row (or column) rescaled to mean 0, standard deviation 1 (sample SD; a constant row becomes 0).
    function zScore(values, byRows) {
        const out = values.map(row => row.slice());
        const lines = byRows ? values.length : values[0].length;
        for (let i = 0; i < lines; i++) {
            const cells = byRows ? values[i] : values.map(row => row[i]);
            const present = cells.filter(Number.isFinite);
            const mean = present.reduce((s, v) => s + v, 0) / (present.length || 1);
            const sd = Math.sqrt(present.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, present.length - 1));
            cells.forEach((v, j) => {
                const z = Number.isFinite(v) ? (sd > 0 ? (v - mean) / sd : 0) : NaN;
                if (byRows) out[i][j] = z;
                else out[j][i] = z;
            });
        }
        return out;
    }

    // Distance between two vectors, over the positions both have a value.
    function distance(a, b, metric) {
        const pairs = a.map((v, i) => [v, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
        if (!pairs.length) return 0;
        if (metric === "correlation") {
            const n = pairs.length;
            const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
            const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
            let sab = 0, saa = 0, sbb = 0;
            pairs.forEach(([x, y]) => {
                sab += (x - ma) * (y - mb);
                saa += (x - ma) ** 2;
                sbb += (y - mb) ** 2;
            });
            return saa > 0 && sbb > 0 ? 1 - sab / Math.sqrt(saa * sbb) : 1;
        }
        return Math.sqrt(pairs.reduce((s, [x, y]) => s + (x - y) ** 2, 0));
    }

    // Average-linkage (UPGMA) clustering. Returns the leaf order and the merges for a dendrogram:
    // { order, root } with nodes { leaf } or { left, right, height }.
    function cluster(vectors, metric) {
        const n = vectors.length;
        let nodes = vectors.map((_, i) => ({ leaf: i, size: 1, height: 0, first: i }));
        const d = vectors.map((a, i) => vectors.map((b, j) => (i === j ? 0 : distance(a, b, metric))));
        let active = nodes.map((_, i) => i);
        const dist = d.map(row => row.slice());
        const all = nodes.slice();
        while (active.length > 1) {
            let best = null;
            for (let x = 0; x < active.length; x++) {
                for (let y = x + 1; y < active.length; y++) {
                    const value = dist[active[x]][active[y]];
                    if (!best || value < best.value - 1e-12) best = { x, y, value };
                }
            }
            const a = active[best.x];
            const b = active[best.y];
            const [left, right] = all[a].first <= all[b].first ? [all[a], all[b]] : [all[b], all[a]];
            const merged = { left, right, height: best.value, size: left.size + right.size, first: Math.min(left.first, right.first) };
            const index = all.length;
            all.push(merged);
            dist[index] = [];
            active.forEach(other => {
                if (other === a || other === b) return;
                const value = (dist[a][other] * all[a].size + dist[b][other] * all[b].size) / (all[a].size + all[b].size);
                dist[index][other] = value;
                dist[other][index] = value;
            });
            active = active.filter(i => i !== a && i !== b).concat(index);
        }
        const root = all[active[0]];
        const order = [];
        const walk = node => (node.leaf !== undefined ? order.push(node.leaf) : (walk(node.left), walk(node.right)));
        walk(root);
        return { order, root, n };
    }

    // A dendrogram as path data. Leaves sit at `positionOf(leafIndex)`; heights grow away from the matrix.
    function dendrogramPath(root, positionOf, toDepth, horizontal) {
        const commands = [];
        const place = node => {
            if (node.leaf !== undefined) return { at: positionOf(node.leaf), depth: toDepth(0) };
            const l = place(node.left);
            const r = place(node.right);
            const depth = toDepth(node.height);
            if (horizontal) commands.push(`M${l.depth} ${l.at}H${depth}V${r.at}H${r.depth}`);
            else commands.push(`M${l.at} ${l.depth}V${depth}H${r.at}V${r.depth}`);
            return { at: (l.at + r.at) / 2, depth };
        };
        place(root);
        return commands.join("");
    }

    SlideForgePlugins.register({
        id: "heatmap",
        version: "1",
        name: "Heatmap",
        description: "A heatmap of a matrix, with z-scoring, clustering, dendrograms and a colour bar",
        icon: "fa-solid fa-table-cells",
        insert: { label: "Heatmap", keywords: "heatmap matrix expression cluster dendrogram z-score correlation colour scale" },
        defaultSize: { width: 520, height: 340 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            data: "Gene,Ctrl 1,Ctrl 2,Ctrl 3,Treat 1,Treat 2,Treat 3\nIL6,2.1,2.4,1.9,7.8,8.2,7.5\nTNF,3.0,2.7,3.2,6.9,7.4,7.1\nCXCL8,1.8,2.2,2.0,6.5,6.1,6.8\nGAPDH,9.1,9.0,9.2,9.1,8.9,9.0\nACTB,8.8,8.9,8.7,8.8,9.0,8.9\nSOX2,6.2,6.5,6.0,2.1,1.8,2.4\nNANOG,5.9,6.1,5.7,1.9,2.2,1.7",
            zscore: "rows",
            clusterRows: true,
            clusterColumns: false,
            metric: "euclidean",
            dendrograms: true,
            colormap: "coolwarm",
            range: "centred",
            centre: 0,
            values: false,
            decimals: 1,
            legendLabel: "z-score",
            fontSize: 12,
            color: "",
        },
        fields: [
            { key: "data", label: "Matrix", type: "table", rows: 7, hint: "First row: column names. First column: row names. Empty cells or NA are left grey." },
            {
                key: "zscore",
                label: "Scale",
                type: "select",
                options: [
                    { value: "none", label: "Values as given" },
                    { value: "rows", label: "z-score each row" },
                    { value: "columns", label: "z-score each column" },
                ],
            },
            { key: "clusterRows", label: "Cluster", checkboxLabel: "Cluster rows", type: "checkbox" },
            { key: "clusterColumns", label: "Cluster columns", checkboxLabel: "Cluster columns", type: "checkbox" },
            {
                key: "metric",
                label: "Distance",
                type: "select",
                options: [
                    { value: "euclidean", label: "Euclidean" },
                    { value: "correlation", label: "Correlation (1 − r)" },
                ],
                hint: "Average linkage.",
            },
            { key: "dendrograms", label: "Dendrograms", checkboxLabel: "Draw dendrograms", type: "checkbox" },
            {
                key: "colormap",
                label: "Colours",
                type: "select",
                options: [
                    { value: "viridis", label: "Viridis" },
                    { value: "magma", label: "Magma" },
                    { value: "coolwarm", label: "Coolwarm (diverging)" },
                    { value: "rdbu", label: "RdBu (diverging)" },
                    { value: "greys", label: "Greys" },
                ],
            },
            {
                key: "range",
                label: "Colour range",
                type: "select",
                options: [
                    { value: "data", label: "Smallest to largest value" },
                    { value: "centred", label: "Even around the centre value" },
                ],
            },
            { key: "centre", label: "Centre value", type: "number", step: "any", hint: "For diverging colours: this value gets the middle colour." },
            { key: "values", label: "Values", checkboxLabel: "Write the values in the cells", type: "checkbox" },
            { key: "decimals", label: "Decimals", type: "number", min: 0, max: 4, step: 1 },
            { key: "legendLabel", label: "Colour bar label", type: "text" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 6, max: 28, step: 1 },
            { key: "color", label: "Text colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min = -1e12, max = 1e12) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                data: String(data.data ?? ""),
                zscore: ["none", "rows", "columns"].includes(data.zscore) ? data.zscore : "none",
                clusterRows: Boolean(data.clusterRows),
                clusterColumns: Boolean(data.clusterColumns),
                metric: data.metric === "correlation" ? "correlation" : "euclidean",
                dendrograms: data.dendrograms !== false,
                colormap: Object.hasOwn(COLORMAPS, data.colormap) ? data.colormap : "viridis",
                range: data.range === "centred" ? "centred" : "data",
                centre: number(data.centre, 0),
                values: Boolean(data.values),
                decimals: Math.round(number(data.decimals, 1, 0, 4)),
                legendLabel: String(data.legendLabel ?? "").slice(0, 60),
                fontSize: number(data.fontSize, 12, 6, 28),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const matrix = readMatrix(context.parseTable(data.data));
            if (matrix.values.length > 200 || matrix.columnNames.length > 200) throw new Error("Heatmaps of up to 200 × 200 cells can be drawn");
            let values = matrix.values;
            if (data.zscore === "rows") values = zScore(values, true);
            if (data.zscore === "columns") values = zScore(values, false);
            const rowTree = data.clusterRows && values.length > 2 ? cluster(values, data.metric) : null;
            const columnVectors = matrix.columnNames.map((_, c) => values.map(row => row[c]));
            const columnTree = data.clusterColumns && columnVectors.length > 2 ? cluster(columnVectors, data.metric) : null;
            const rowOrder = rowTree ? rowTree.order : values.map((_, i) => i);
            const columnOrder = columnTree ? columnTree.order : matrix.columnNames.map((_, i) => i);

            const finite = values.flat().filter(Number.isFinite);
            if (!finite.length) throw new Error("The matrix has no numbers");
            let low = Math.min(...finite);
            let high = Math.max(...finite);
            if (data.range === "centred") {
                const reach = Math.max(Math.abs(high - data.centre), Math.abs(low - data.centre)) || 1;
                low = data.centre - reach;
                high = data.centre + reach;
            } else if (low === high) {
                low -= 1;
                high += 1;
            }
            const t = value => (value - low) / (high - low);

            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const rowLabelWidth = Math.max(...matrix.rowNames.map(name => context.measureText(name, { size, family: FONT }))) + size * 0.5;
            const columnLabelWidth = Math.max(...matrix.columnNames.map(name => context.measureText(name, { size, family: FONT })));
            const legendWidth = size * 1.2 + context.measureText(String(Number(high.toPrecision(3))), { size: size * 0.85, family: FONT }) + size * (data.legendLabel ? 2 : 0.8);
            const rowDendro = rowTree && data.dendrograms ? Math.min(width * 0.15, 60) : 0;
            const columnDendro = columnTree && data.dendrograms ? Math.min(height * 0.15, 50) : 0;
            const gridLeft = rowDendro;
            const gridWidth = Math.max(20, width - rowDendro - rowLabelWidth - legendWidth - size);
            const cellWidth = gridWidth / matrix.columnNames.length;
            // Column names stand upright when they do not fit across their cells.
            const turned = columnLabelWidth > cellWidth * 0.95;
            const columnLabelHeight = turned ? columnLabelWidth + size * 0.5 : size * 1.6;
            const gridTop = columnDendro + 2;
            const gridHeight = Math.max(20, height - gridTop - columnLabelHeight);
            const cellHeight = gridHeight / values.length;
            const parts = [];
            rowOrder.forEach((r, i) => {
                columnOrder.forEach((c, j) => {
                    const value = values[r][c];
                    const fill = Number.isFinite(value) ? colorAt(data.colormap, t(value)) : "#9ca3af";
                    const x = gridLeft + j * cellWidth;
                    const y = gridTop + i * cellHeight;
                    parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(cellWidth + 0.3).toFixed(2)}" height="${(cellHeight + 0.3).toFixed(2)}" fill="${fill}"/>`);
                    if (data.values && Number.isFinite(value) && cellHeight > size * 0.9) {
                        parts.push(`<text x="${(x + cellWidth / 2).toFixed(1)}" y="${(y + cellHeight / 2 + size * 0.33).toFixed(1)}" font-size="${(size * 0.85).toFixed(1)}" text-anchor="middle" fill="${textOn(fill)}">${value.toFixed(data.decimals)}</text>`);
                    }
                });
                parts.push(`<text x="${(gridLeft + gridWidth + size * 0.35).toFixed(1)}" y="${(gridTop + (i + 0.5) * cellHeight + size * 0.33).toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(matrix.rowNames[r])}</text>`);
            });
            columnOrder.forEach((c, j) => {
                const x = gridLeft + (j + 0.5) * cellWidth;
                const y = gridTop + gridHeight + size * 0.4;
                parts.push(
                    turned
                        ? `<text transform="translate(${(x + size * 0.33).toFixed(1)} ${y.toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="end" fill="${ink}">${context.escapeXml(matrix.columnNames[c])}</text>`
                        : `<text x="${x.toFixed(1)}" y="${(y + size * 0.85).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(matrix.columnNames[c])}</text>`,
                );
            });
            if (rowDendro) {
                const rank = new Map(rowOrder.map((r, i) => [r, i]));
                const maxHeight = rowTree.root.height || 1;
                const path = dendrogramPath(rowTree.root, leaf => gridTop + (rank.get(leaf) + 0.5) * cellHeight, h => rowDendro - 2 - (h / maxHeight) * (rowDendro - 4), true);
                parts.push(`<path d="${path}" fill="none" stroke="${ink}" stroke-width="1"/>`);
            }
            if (columnDendro) {
                const rank = new Map(columnOrder.map((c, j) => [c, j]));
                const maxHeight = columnTree.root.height || 1;
                const path = dendrogramPath(columnTree.root, leaf => gridLeft + (rank.get(leaf) + 0.5) * cellWidth, h => columnDendro - (h / maxHeight) * (columnDendro - 2), false);
                parts.push(`<path d="${path}" fill="none" stroke="${ink}" stroke-width="1"/>`);
            }
            // Colour bar
            const barX = width - legendWidth + size * (data.legendLabel ? 1.4 : 0.2);
            const barTop = gridTop;
            const barHeight = Math.min(gridHeight, Math.max(60, gridHeight * 0.8));
            const stops = Array.from({ length: 17 }, (_, i) => `<stop offset="${((i / 16) * 100).toFixed(2)}%" stop-color="${colorAt(data.colormap, i / 16)}"/>`).join("");
            parts.push(`<defs><linearGradient id="legend" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient></defs>`);
            parts.push(`<rect x="${barX.toFixed(1)}" y="${barTop.toFixed(1)}" width="${(size * 0.9).toFixed(1)}" height="${barHeight.toFixed(1)}" fill="url(#legend)"/>`);
            context
                .niceTicks(low, high, 4)
                .ticks.filter(v => v >= low - 1e-9 && v <= high + 1e-9)
                .forEach(v => {
                    const y = barTop + barHeight - ((v - low) / (high - low)) * barHeight;
                    parts.push(`<text x="${(barX + size * 1.15).toFixed(1)}" y="${(y + size * 0.3).toFixed(1)}" font-size="${(size * 0.85).toFixed(1)}" fill="${ink}">${Number(v.toPrecision(4))}</text>`);
                });
            if (data.legendLabel) {
                parts.push(`<text transform="translate(${(barX - size * 0.4).toFixed(1)} ${(barTop + barHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.legendLabel)}</text>`);
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
