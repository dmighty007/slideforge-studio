// Sequence plugin: a DNA, RNA or protein sequence in blocks of ten with position numbers, coloured by residue, with
// highlighted regions (motifs, mutations, domains) from a small table.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const MONO = "Courier New, Courier, monospace";
    const NUCLEOTIDE_COLORS = { A: "#2e9e44", C: "#1f6fd1", G: "#e07b00", T: "#d63a3a", U: "#d63a3a" };
    const CLUSTAL = {};
    [
        ["AILMFWV", "#2f6fd6"],
        ["KR", "#d63a3a"],
        ["DE", "#b23bc4"],
        ["NQST", "#2e9e44"],
        ["C", "#e0699b"],
        ["G", "#e07b00"],
        ["P", "#b89a00"],
        ["HY", "#119aa3"],
    ].forEach(([letters, color]) => [...letters].forEach(letter => (CLUSTAL[letter] = color)));
    const KYTE_DOOLITTLE = { I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8, W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5 };
    const NUCLEOTIDES = /^[ACGTURYKMSWBDHVN-]+$/;
    const AMINO_ACIDS = /^[ACDEFGHIKLMNPQRSTVWYBXZJUO*-]+$/;
    const NAMED_COLORS = { red: "#ef4444", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", grey: "#9ca3af", gray: "#9ca3af" };

    // FASTA or plain text → { title, residues }. Only the first record of a multi-record FASTA is shown.
    function readSequence(text) {
        const lines = String(text ?? "").split(/\r?\n/);
        let title = "";
        const body = [];
        for (const line of lines) {
            if (line.startsWith(">")) {
                if (title || body.length) break;
                title = line.slice(1).trim();
            } else if (!line.startsWith(";")) {
                body.push(line);
            }
        }
        return { title, residues: body.join("").replace(/[\s\d]/g, "").toUpperCase() };
    }

    function detectType(residues) {
        if (!residues) return "dna";
        const nucleotideShare = [...residues].filter(c => "ACGTUN-".includes(c)).length / residues.length;
        if (nucleotideShare >= 0.9 && NUCLEOTIDES.test(residues)) return residues.includes("U") && !residues.includes("T") ? "rna" : "dna";
        return "protein";
    }

    function hydrophobicityColor(letter) {
        const value = KYTE_DOOLITTLE[letter];
        if (value === undefined) return null;
        // -4.5 (blue, water-loving) … +4.5 (red, water-fearing)
        const t = (value + 4.5) / 9;
        const mix = (a, b) => Math.round(a + (b - a) * t);
        return `rgb(${mix(37, 214)}, ${mix(99, 58)}, ${mix(235, 58)})`;
    }

    function residueColor(letter, type, scheme) {
        if (scheme === "none") return null;
        if (type !== "protein") return NUCLEOTIDE_COLORS[letter] || null;
        return scheme === "hydrophobicity" ? hydrophobicityColor(letter) : CLUSTAL[letter] || null;
    }

    function readHighlights(rows, length) {
        const regions = [];
        rows.forEach((row, index) => {
            const [startText = "", endText = "", colorText = "", label = ""] = row;
            const start = Number(startText);
            const end = Number(endText || startText);
            if (index === 0 && !Number.isFinite(start)) return; // a header row
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > length) {
                throw new Error(`Highlights, row ${index + 1}: positions must be whole numbers from 1 to ${length}, start before end`);
            }
            const named = NAMED_COLORS[colorText.toLowerCase()];
            const color = HEX_COLOR.test(colorText) ? colorText : named || "#facc15";
            regions.push({ start, end, color, label: label.slice(0, 40) });
        });
        return regions;
    }

    SlideForgePlugins.register({
        id: "sequence",
        version: "2",
        name: "Sequence",
        description: "A DNA, RNA or protein sequence with numbering, residue colours and highlighted regions",
        icon: "fa-solid fa-dna",
        insert: { category: "Biology", label: "Sequence (DNA, RNA, protein)", keywords: "sequence dna rna protein fasta residue motif mutation nucleotide amino acid" },
        defaultSize: { width: 560, height: 200 },
        askOnInsert: false,
        defaultData: {
            sequence: ">Human insulin B chain\nFVNQHLCGSHLVEALYLVCGERGFFYTPKT",
            type: "auto",
            scheme: "clustal",
            colorMode: "letters",
            perLine: 50,
            numbering: true,
            title: true,
            highlights: "Start,End,Colour,Label\n7,7,yellow,Cys\n19,19,yellow,Cys\n24,26,#93c5fd,FFY",
            fontSize: 16,
            color: "",
        },
        fields: [
            { key: "sequence", label: "Sequence (plain or FASTA)", type: "textarea", placeholder: ">name\nATGGCC…" },
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
                key: "scheme",
                label: "Protein colours",
                type: "select",
                options: [
                    { value: "clustal", label: "By residue class (Clustal)" },
                    { value: "hydrophobicity", label: "Hydrophobicity (Kyte–Doolittle)" },
                    { value: "none", label: "None" },
                ],
                hint: "DNA and RNA use A/C/G/T colours unless this is None.",
            },
            {
                key: "colorMode",
                label: "Colour",
                type: "select",
                options: [
                    { value: "letters", label: "The letters" },
                    { value: "boxes", label: "Boxes behind the letters" },
                ],
            },
            { key: "perLine", label: "Residues per line", type: "number", min: 10, max: 150, step: 10 },
            { key: "numbering", label: "Numbering", checkboxLabel: "Position numbers at line starts", type: "checkbox" },
            { key: "title", label: "Title", checkboxLabel: "Show the FASTA name", type: "checkbox" },
            { key: "highlights", label: "Highlights", type: "table", columns: ["Start", "End", "Colour", "Label"], rows: 4, placeholder: "12,14,#fde68a,motif" },
            { key: "fontSize", label: "Letter size (px)", type: "number", min: 8, max: 40, step: 1 },
            { key: "color", label: "Text colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                sequence: String(data.sequence ?? "").slice(0, 50000),
                type: ["auto", "dna", "rna", "protein"].includes(data.type) ? data.type : "auto",
                scheme: ["clustal", "hydrophobicity", "none"].includes(data.scheme) ? data.scheme : "clustal",
                colorMode: data.colorMode === "boxes" ? "boxes" : "letters",
                perLine: Math.round(number(data.perLine, 50, 10, 150) / 10) * 10,
                numbering: data.numbering !== false,
                title: data.title !== false,
                highlights: String(data.highlights ?? ""),
                fontSize: number(data.fontSize, 16, 8, 40),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const { title, residues } = readSequence(data.sequence);
            if (!residues) throw new Error("Paste a sequence (plain letters or FASTA)");
            if (residues.length > 20000) throw new Error("Sequences of up to 20,000 residues can be shown");
            const type = data.type === "auto" ? detectType(residues) : data.type;
            const allowed = type === "protein" ? AMINO_ACIDS : NUCLEOTIDES;
            if (!allowed.test(residues)) {
                const index = [...residues].findIndex(c => !allowed.test(c));
                throw new Error(`“${residues[index]}” at position ${index + 1} is not a ${type === "protein" ? "protein" : type.toUpperCase()} letter`);
            }
            const regions = readHighlights(context.parseTable(data.highlights), residues.length);
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const charWidth = context.measureText("M", { size, family: MONO, weight: 700 });
            const blockGap = charWidth * 0.6;
            const columnX = column => column * charWidth + Math.floor(column / 10) * blockGap;
            const numberWidth = data.numbering ? context.measureText(String(residues.length), { size: size * 0.8, family: MONO }) + charWidth : 0;
            const labelRoom = regions.some(region => region.label) ? size * 0.85 : 0;
            const rowHeight = size * 1.45 + labelRoom;
            const titleHeight = data.title && title ? size * 1.6 : 0;
            const rows = Math.ceil(residues.length / data.perLine);
            const lineWidth = columnX(Math.min(data.perLine, residues.length) - 1) + charWidth;
            const width = numberWidth + lineWidth + 4;
            const height = titleHeight + rows * rowHeight + 4;
            const parts = [];
            if (titleHeight) parts.push(`<text x="0" y="${size * 1.1}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700" fill="${ink}">${context.escapeXml(title)}</text>`);
            const cellTop = row => titleHeight + row * rowHeight + labelRoom;
            const cellX = index => numberWidth + columnX(index % data.perLine);

            // Highlights: a lightly tinted, outlined box over each stretch of a region on each line, its label above the first
            // stretch. A strong fill hid letters of the same colour (blue residues in a blue box on a dark theme).
            regions.forEach(region => {
                let first = true;
                for (let index = region.start - 1; index < region.end; ) {
                    const row = Math.floor(index / data.perLine);
                    const rowEnd = Math.min(region.end - 1, (row + 1) * data.perLine - 1);
                    const x0 = cellX(index) - 1;
                    const x1 = cellX(rowEnd) + charWidth + 1;
                    parts.push(`<rect x="${x0.toFixed(1)}" y="${(cellTop(row) + size * 0.12).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(size * 1.22).toFixed(1)}" rx="3" fill="${region.color}" fill-opacity="0.22" stroke="${region.color}" stroke-width="1.5"/>`);
                    if (first && region.label) {
                        parts.push(`<text x="${x0.toFixed(1)}" y="${(cellTop(row) - 1).toFixed(1)}" font-family="Arial, Helvetica, sans-serif" font-size="${(size * 0.7).toFixed(1)}" font-weight="600" fill="${ink}">${context.escapeXml(region.label)}</text>`);
                    }
                    first = false;
                    index = rowEnd + 1;
                }
            });

            const letters = [];
            for (let row = 0; row < rows; row++) {
                const baseline = cellTop(row) + size * 1.0;
                if (data.numbering) {
                    parts.push(`<text x="${(numberWidth - charWidth * 0.6).toFixed(1)}" y="${baseline.toFixed(1)}" font-family="${MONO}" font-size="${(size * 0.8).toFixed(1)}" text-anchor="end" fill="${ink}" opacity="0.6">${row * data.perLine + 1}</text>`);
                }
                for (let index = row * data.perLine; index < Math.min(residues.length, (row + 1) * data.perLine); index++) {
                    const letter = residues[index];
                    const color = residueColor(letter, type, data.scheme);
                    const x = cellX(index);
                    if (color && data.colorMode === "boxes") {
                        parts.push(`<rect x="${x.toFixed(1)}" y="${(cellTop(row) + size * 0.18).toFixed(1)}" width="${charWidth.toFixed(1)}" height="${(size * 1.1).toFixed(1)}" fill="${color}" opacity="0.35"/>`);
                    }
                    letters.push(`<tspan x="${(x + charWidth / 2).toFixed(1)}" y="${baseline.toFixed(1)}"${color && data.colorMode === "letters" ? ` fill="${color}"` : ""}>${letter}</tspan>`);
                }
            }
            parts.push(`<text font-family="${MONO}" font-size="${size}" font-weight="700" text-anchor="middle" fill="${ink}">${letters.join("")}</text>`);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}">${parts.join("")}</svg>`;
        },
    });
})();
