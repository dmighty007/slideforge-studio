// Gel plugin: a gel electrophoresis schematic. A ladder lane (DNA in bp or protein in kDa) and sample lanes from a
// table (lane, band size, intensity). Bands sit where they would run: distance from the wells falls with the
// logarithm of size, scaled so the ladder spans the gel. Ethidium-style (light bands on dark) or stained (dark on
// light).

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const LADDERS = {
        "1kb": { unit: "bp", sizes: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500] },
        "100bp": { unit: "bp", sizes: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100] },
        protein: { unit: "kDa", sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10] },
    };

    const number = cell => {
        const value = Number(String(cell ?? "").trim().replace(",", "."));
        return String(cell ?? "").trim() !== "" && Number.isFinite(value) ? value : null;
    };

    function readSamples(rows) {
        const lanes = [];
        rows.forEach((row, index) => {
            const [lane = "", sizeText = "", intensityText = ""] = row;
            const size = number(sizeText);
            if (index === 0 && size === null) return; // a header row
            if (size === null || size <= 0) throw new Error(`Row ${index + 1}: “${sizeText}” is not a band size`);
            let intensity = number(intensityText);
            if (intensity === null) intensity = 1;
            if (intensity > 1) intensity /= 100; // 0–100 % as well as 0–1
            const name = lane.trim() || `Lane ${lanes.length + 1}`;
            let entry = lanes.find(item => item.name === name);
            if (!entry) lanes.push((entry = { name, bands: [] }));
            entry.bands.push({ size, intensity: Math.max(0.05, Math.min(1, intensity)) });
        });
        return lanes;
    }

    SlideForgePlugins.register({
        id: "gel",
        version: "1",
        name: "Gel Electrophoresis",
        description: "A gel schematic: ladder and sample lanes with bands placed by size",
        icon: "fa-solid fa-grip-lines-vertical",
        insert: { category: "Biology", label: "Gel electrophoresis", keywords: "gel electrophoresis agarose sds page ladder band pcr western blot dna protein lane" },
        defaultSize: { width: 420, height: 300 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            ladder: "1kb",
            customLadder: "",
            unit: "",
            samples: "Lane,Size,Intensity\nUncut,5200,1\nEcoRI,3100,0.9\nEcoRI,2100,0.6\nPCR,750,1\nNo template,,",
            style: "dark",
            ladderLabels: true,
            fontSize: 16,
        },
        fields: [
            {
                key: "ladder",
                label: "Ladder",
                type: "select",
                options: [
                    { value: "1kb", label: "1 kb DNA ladder (10 000–500 bp)" },
                    { value: "100bp", label: "100 bp DNA ladder (1517–100 bp)" },
                    { value: "protein", label: "Protein ladder (250–10 kDa)" },
                    { value: "custom", label: "My own sizes" },
                ],
            },
            { key: "customLadder", label: "Ladder sizes (own)", type: "text", placeholder: "e.g. 3000, 2000, 1000, 500", hint: "For “My own sizes”: largest to smallest, separated by commas." },
            { key: "unit", label: "Unit (own ladder)", type: "text", placeholder: "bp" },
            { key: "samples", label: "Bands", type: "table", columns: ["Lane", "Size", "Intensity (0–1)"], rows: 6, hint: "One row per band; rows with the same lane name share a lane. A lane with no size stays empty." },
            {
                key: "style",
                label: "Look",
                type: "select",
                options: [
                    { value: "dark", label: "Fluorescent (light bands on a dark gel)" },
                    { value: "light", label: "Stained (dark bands on a light gel)" },
                ],
            },
            { key: "ladderLabels", label: "Ladder sizes", checkboxLabel: "Label the ladder bands", type: "checkbox" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 28, step: 1 },
        ],

        normalize(data) {
            const fontSize = Number(data.fontSize);
            return {
                ladder: Object.hasOwn(LADDERS, data.ladder) || data.ladder === "custom" ? data.ladder : "1kb",
                customLadder: String(data.customLadder ?? "").slice(0, 400),
                unit: String(data.unit ?? "").trim().slice(0, 12),
                samples: String(data.samples ?? ""),
                style: data.style === "light" ? "light" : "dark",
                ladderLabels: data.ladderLabels !== false,
                fontSize: Number.isFinite(fontSize) ? Math.min(28, Math.max(8, fontSize)) : 13,
            };
        },

        render(data, context) {
            const { width, height } = context;
            let ladder;
            if (data.ladder === "custom") {
                const sizes = data.customLadder
                    .split(/[,;\s]+/)
                    .filter(Boolean)
                    .map(Number);
                if (sizes.length < 2 || sizes.some(size => !Number.isFinite(size) || size <= 0)) throw new Error("Type at least two ladder sizes, separated by commas");
                ladder = { unit: data.unit || "bp", sizes: sizes.sort((a, b) => b - a) };
            } else {
                ladder = LADDERS[data.ladder];
            }
            // Lanes in the order they appear; a lane listed with no size is an empty lane.
            const lanes = [];
            context.parseTable(data.samples).forEach((row, index) => {
                const [lane = "", sizeText = ""] = row;
                if (index === 0 && number(sizeText) === null && /lane/i.test(lane)) return;
                const name = lane.trim() || `Lane ${lanes.length + 1}`;
                if (!lanes.some(item => item.name === name)) lanes.push({ name, bands: [] });
            });
            // Rows with a blank size only make an empty lane; any other size must be a number (readSamples says which).
            const sampleRows = context.parseTable(data.samples).filter((row, index) => String(row[1] ?? "").trim() !== "" || (index === 0 && /lane/i.test(row[0] || "")));
            readSamples(sampleRows).forEach(entry => {
                const lane = lanes.find(item => item.name === entry.name);
                if (lane) lane.bands.push(...entry.bands);
            });
            const dark = data.style === "dark";
            const ink = context.textColor || "#111827";
            const gelFill = dark ? "#121417" : "#eef2f7";
            const bandColor = dark ? "#f4f0ff" : "#1e3a8a";
            const size = data.fontSize;
            const labelWidth = data.ladderLabels
                ? Math.max(...ladder.sizes.map(s => context.measureText(String(s), { size: size * 0.8, family: FONT }))) + size * 0.6
                : size * 0.3;
            const unitWidth = context.measureText(ladder.unit, { size: size * 0.8, family: FONT });
            const left = Math.max(labelWidth, unitWidth + size * 0.4);
            const longest = Math.max(context.measureText("M", { size, family: FONT }), ...lanes.map(lane => context.measureText(lane.name, { size, family: FONT })));
            const laneCount = lanes.length + 1;
            const gelWidth = Math.max(40, width - left - size * 0.3);
            const laneWidth = gelWidth / laneCount;
            // Lane names above the gel; turned when they do not fit their lane.
            const turn = longest > laneWidth * 0.95;
            const header = turn ? Math.min(longest, height * 0.35) * 0.75 + size : size * 1.6;
            const top = header;
            const gelHeight = Math.max(40, height - top - size * 0.4);
            const wellTop = top + gelHeight * 0.04;
            const wellHeight = Math.max(3, gelHeight * 0.03);
            const runTop = wellTop + wellHeight + gelHeight * 0.05;
            const runBottom = top + gelHeight * 0.95;
            const biggest = Math.max(ladder.sizes[0], ...lanes.flatMap(lane => lane.bands.map(band => band.size)));
            const smallest = Math.min(ladder.sizes.at(-1), ...lanes.flatMap(lane => lane.bands.map(band => band.size)));
            const logHigh = Math.log10(biggest * 1.1);
            const logLow = Math.log10(smallest / 1.15);
            const yOf = bandSize => runTop + ((logHigh - Math.log10(bandSize)) / (logHigh - logLow)) * (runBottom - runTop);
            const parts = [];
            parts.push(`<rect x="${left}" y="${top}" width="${gelWidth}" height="${gelHeight}" rx="${Math.min(8, gelWidth * 0.02)}" fill="${gelFill}" stroke="${ink}" stroke-opacity="0.25"/>`);
            parts.push(`<defs><filter id="glow" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="${(laneWidth * 0.015 + 0.6).toFixed(2)}"/></filter></defs>`);
            const allLanes = [{ name: ladder.unit === "kDa" ? "Marker" : "Ladder", bands: ladder.sizes.map(s => ({ size: s, intensity: 0.75 })), ladder: true }, ...lanes];
            allLanes.forEach((lane, index) => {
                const x = left + laneWidth * index;
                const bandX = x + laneWidth * 0.14;
                const bandWidth = laneWidth * 0.72;
                parts.push(`<rect x="${bandX.toFixed(1)}" y="${wellTop.toFixed(1)}" width="${bandWidth.toFixed(1)}" height="${wellHeight.toFixed(1)}" fill="${dark ? "#000000" : "#cbd5e1"}" stroke="${dark ? "#3f444d" : "#94a3b8"}" stroke-width="0.8"/>`);
                lane.bands.forEach(band => {
                    const yy = yOf(band.size);
                    const thickness = Math.max(2, gelHeight * 0.016);
                    parts.push(`<rect x="${bandX.toFixed(1)}" y="${(yy - thickness / 2).toFixed(1)}" width="${bandWidth.toFixed(1)}" height="${thickness.toFixed(1)}" rx="${(thickness / 2).toFixed(1)}" fill="${bandColor}" fill-opacity="${band.intensity.toFixed(2)}"${dark ? ' filter="url(#glow)"' : ""}/>`);
                });
                const cx = x + laneWidth / 2;
                const name = context.escapeXml(lane.name);
                if (turn) parts.push(`<text transform="translate(${cx.toFixed(1)} ${(top - size * 0.4).toFixed(1)}) rotate(-45)" font-size="${size}" fill="${ink}">${name}</text>`);
                else parts.push(`<text x="${cx.toFixed(1)}" y="${(top - size * 0.5).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${name}</text>`);
            });
            if (data.ladderLabels) {
                ladder.sizes.forEach(s => {
                    parts.push(`<text x="${(left - size * 0.3).toFixed(1)}" y="${(yOf(s) + size * 0.28).toFixed(1)}" font-size="${(size * 0.8).toFixed(1)}" text-anchor="end" fill="${ink}">${s}</text>`);
                });
            }
            parts.push(`<text x="${(left - size * 0.3).toFixed(1)}" y="${(wellTop + wellHeight).toFixed(1)}" font-size="${(size * 0.8).toFixed(1)}" font-weight="700" text-anchor="end" fill="${ink}">${context.escapeXml(ladder.unit)}</text>`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
