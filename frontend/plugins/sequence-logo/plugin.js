// Sequence logo plugin: a logo from aligned sequences (FASTA or one per line, all the same length). Each column's
// height is its information content in bits (log2 of the alphabet size minus the column's entropy, optionally minus
// the small-sample correction), shared among its letters by frequency, the most frequent on top. Or plain
// probabilities. Letters are text stretched to their heights.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const CAP_HEIGHT = 0.716; // Arial's capital height, as a share of its font size
    const NUCLEOTIDES = "ACGTU";
    const AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY";
    const NUCLEOTIDE_COLORS = { A: "#109648", C: "#255C99", G: "#F7B32B", T: "#D62839", U: "#D62839" };
    const CHEMISTRY = {};
    [
        ["GSTYC", "#109648"],
        ["NQ", "#8E44AD"],
        ["KRH", "#255C99"],
        ["DE", "#D62839"],
    ].forEach(([letters, color]) => [...letters].forEach(letter => (CHEMISTRY[letter] = color)));

    function readAlignment(text) {
        const lines = String(text ?? "").split(/\r?\n/);
        const sequences = [];
        let current = null;
        const fasta = lines.some(line => line.startsWith(">"));
        lines.forEach(line => {
            if (fasta) {
                if (line.startsWith(">")) {
                    current = [];
                    sequences.push(current);
                } else if (current) {
                    current.push(line.trim());
                }
            } else if (line.trim()) {
                sequences.push([line.trim()]);
            }
        });
        return sequences.map(parts => parts.join("").replace(/\s/g, "").toUpperCase()).filter(Boolean);
    }

    SlideForgePlugins.register({
        id: "sequence-logo",
        version: "1",
        name: "Sequence Logo",
        description: "A sequence logo (bits or probability) from aligned DNA, RNA or protein sequences",
        icon: "fa-solid fa-chart-column",
        insert: { label: "Sequence logo", keywords: "sequence logo motif alignment information content bits pwm binding site dna protein" },
        defaultSize: { width: 480, height: 220 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            sequences: "TATAAAAG\nTATAAATA\nTATATAAG\nTATAAAAC\nTTTAAAAG\nTATAAAGG\nTATAAAAG\nCATAAAAG",
            type: "auto",
            units: "bits",
            correction: true,
            scheme: "classic",
            start: 1,
            axis: true,
            fontSize: 13,
        },
        fields: [
            { key: "sequences", label: "Aligned sequences", type: "textarea", placeholder: "One per line, or FASTA; all the same length (gaps as -)" },
            {
                key: "type",
                label: "Type",
                type: "select",
                options: [
                    { value: "auto", label: "Detect" },
                    { value: "dna", label: "DNA" },
                    { value: "rna", label: "RNA" },
                    { value: "protein", label: "Protein" },
                ],
            },
            {
                key: "units",
                label: "Height",
                type: "select",
                options: [
                    { value: "bits", label: "Information (bits)" },
                    { value: "probability", label: "Probability" },
                ],
            },
            { key: "correction", label: "Correction", checkboxLabel: "Small-sample correction (few sequences)", type: "checkbox" },
            {
                key: "scheme",
                label: "Colours",
                type: "select",
                options: [
                    { value: "classic", label: "Classic (A/C/G/T, or protein chemistry)" },
                    { value: "none", label: "One colour" },
                ],
            },
            { key: "start", label: "First position number", type: "number", step: 1 },
            { key: "axis", label: "Axes", checkboxLabel: "Show the axis and position numbers", type: "checkbox" },
            { key: "fontSize", label: "Axis text size (px)", type: "number", min: 7, max: 28, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                sequences: String(data.sequences ?? "").slice(0, 60000),
                type: ["auto", "dna", "rna", "protein"].includes(data.type) ? data.type : "auto",
                units: data.units === "probability" ? "probability" : "bits",
                correction: data.correction !== false,
                scheme: data.scheme === "none" ? "none" : "classic",
                start: Math.round(number(data.start, 1, -1000000, 1000000)),
                axis: data.axis !== false,
                fontSize: number(data.fontSize, 13, 7, 28),
            };
        },

        render(data, context) {
            const sequences = readAlignment(data.sequences);
            if (sequences.length < 2) throw new Error("Paste at least two aligned sequences");
            const columns = sequences[0].length;
            const uneven = sequences.findIndex(sequence => sequence.length !== columns);
            if (uneven >= 0) throw new Error(`Sequence ${uneven + 1} has ${sequences[uneven].length} letters, the first has ${columns}: they must be aligned to the same length`);
            if (columns > 200) throw new Error("Logos of up to 200 positions can be drawn");
            const letters = sequences.join("").replace(/-/g, "");
            const type =
                data.type !== "auto"
                    ? data.type
                    : [...letters].every(c => NUCLEOTIDES.includes(c) || c === "N")
                      ? letters.includes("U") && !letters.includes("T")
                          ? "rna"
                          : "dna"
                      : "protein";
            const alphabet = type === "protein" ? AMINO_ACIDS : type === "rna" ? "ACGU" : "ACGT";
            const allowed = new RegExp(`^[${alphabet}${type === "protein" ? "BXZ" : "N"}-]+$`);
            sequences.forEach((sequence, index) => {
                if (!allowed.test(sequence)) {
                    const bad = [...sequence].find(c => !allowed.test(c));
                    throw new Error(`Sequence ${index + 1}: “${bad}” is not a ${type === "protein" ? "protein" : type.toUpperCase()} letter`);
                }
            });
            const maxBits = Math.log2(alphabet.length);

            // Per column: each letter's height, smallest first (they are stacked bottom up).
            const stacks = Array.from({ length: columns }, (_, column) => {
                const counts = {};
                let n = 0;
                sequences.forEach(sequence => {
                    const letter = sequence[column];
                    if (alphabet.includes(letter)) {
                        counts[letter] = (counts[letter] || 0) + 1;
                        n++;
                    }
                });
                if (!n) return [];
                const entropy = -Object.values(counts).reduce((sum, count) => sum + (count / n) * Math.log2(count / n), 0);
                const correction = data.correction ? (alphabet.length - 1) / (2 * Math.LN2 * n) : 0;
                const total = data.units === "bits" ? Math.max(0, maxBits - entropy - correction) : 1;
                return Object.entries(counts)
                    .map(([letter, count]) => ({ letter, height: (count / n) * total }))
                    .sort((a, b) => a.height - b.height);
            });

            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;
            const top = data.units === "bits" ? maxBits : 1;
            const ticks = context.niceTicks(0, top, 4).ticks.filter(t => t <= top + 1e-9);
            const tickWidth = data.axis ? Math.max(...ticks.map(t => context.measureText(String(t), { size: size * 0.85, family: FONT }))) : 0;
            const left = data.axis ? size * 1.6 + tickWidth + size * 0.5 : 2;
            const bottom = data.axis ? size * 1.8 : 2;
            const plotTop = size * 0.6;
            const plotWidth = Math.max(20, width - left - 4);
            const plotHeight = Math.max(20, height - plotTop - bottom);
            const columnWidth = plotWidth / columns;
            const y = value => plotTop + plotHeight - (value / top) * plotHeight;
            const color = letter => (data.scheme === "none" ? ink : type === "protein" ? CHEMISTRY[letter] || ink : NUCLEOTIDE_COLORS[letter] || ink);
            const fmt = value => value.toFixed(2);
            const parts = [];
            // Letters: drawn at font size 100 on their baseline, scaled to the column's width and their height.
            stacks.forEach((stack, column) => {
                let base = 0;
                stack.forEach(({ letter, height: bits }) => {
                    const pixels = (bits / top) * plotHeight;
                    base += bits;
                    if (pixels < 0.4) return;
                    const glyphWidth = context.measureText(letter, { size: 100, weight: 700, family: FONT }) || 60;
                    const x = left + column * columnWidth + columnWidth * 0.04;
                    const sx = (columnWidth * 0.92) / glyphWidth;
                    const sy = pixels / (100 * CAP_HEIGHT);
                    parts.push(`<text transform="translate(${fmt(x)} ${fmt(y(base - bits))}) scale(${sx.toFixed(4)} ${sy.toFixed(4)})" font-size="100" font-weight="700" fill="${color(letter)}">${letter}</text>`);
                });
            });
            if (data.axis) {
                parts.push(`<path d="M${fmt(left - 2)} ${fmt(plotTop)}V${fmt(plotTop + plotHeight)}H${fmt(left + plotWidth)}" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
                ticks.forEach(t => {
                    parts.push(`<line x1="${fmt(left - 2 - size * 0.3)}" x2="${fmt(left - 2)}" y1="${fmt(y(t))}" y2="${fmt(y(t))}" stroke="${ink}"/>`);
                    parts.push(`<text x="${fmt(left - size * 0.5)}" y="${fmt(y(t) + size * 0.3)}" font-size="${fmt(size * 0.85)}" text-anchor="end" fill="${ink}">${t}</text>`);
                });
                parts.push(`<text transform="translate(${fmt(size * 0.95)} ${fmt(plotTop + plotHeight / 2)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${data.units === "bits" ? "bits" : "probability"}</text>`);
                // Every position number, or every 5th/10th when the columns are narrow.
                const labelWidth = context.measureText(String(data.start + columns), { size: size * 0.8, family: FONT }) + size * 0.4;
                const every = [1, 2, 5, 10, 20, 50].find(step => step * columnWidth >= labelWidth) || 100;
                for (let column = 0; column < columns; column++) {
                    const position = data.start + column;
                    if (every > 1 && position % every !== 0) continue;
                    parts.push(`<text x="${fmt(left + (column + 0.5) * columnWidth)}" y="${fmt(plotTop + plotHeight + size * 1.15)}" font-size="${fmt(size * 0.8)}" text-anchor="middle" fill="${ink}">${position}</text>`);
                }
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
