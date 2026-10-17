// Plasmid map plugin: a circular map from a feature table (name, start, end, strand, colour, type) and restriction
// sites (name, position). Features are arcs, with an arrowhead for their strand; a feature may run across the origin
// (start after end). Labels sit outside the circle, pushed apart so they do not overlap, with leader lines.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const TYPE_COLORS = {
        gene: "#0072B2",
        cds: "#0072B2",
        promoter: "#009E73",
        origin: "#E69F00",
        ori: "#E69F00",
        terminator: "#D55E00",
        marker: "#CC79A7",
        resistance: "#CC79A7",
    };
    const NAMED_COLORS = { red: "#D55E00", orange: "#E69F00", yellow: "#F0E442", green: "#009E73", blue: "#0072B2", purple: "#CC79A7", pink: "#CC79A7", grey: "#9ca3af", gray: "#9ca3af", black: "#111827" };

    const isNumberCell = cell => /^\s*\d+\s*$/.test(String(cell ?? ""));

    function readStrand(text) {
        const value = String(text ?? "").trim().toLowerCase();
        if (["+", "1", "+1", "forward", "fwd", ">"].includes(value)) return 1;
        if (["-", "−", "-1", "reverse", "rev", "<"].includes(value)) return -1;
        return 0;
    }

    function readColor(text, type, index) {
        const value = String(text ?? "").trim();
        if (HEX_COLOR.test(value)) return value;
        if (NAMED_COLORS[value.toLowerCase()]) return NAMED_COLORS[value.toLowerCase()];
        return TYPE_COLORS[String(type ?? "").trim().toLowerCase()] || ["#0072B2", "#009E73", "#E69F00", "#CC79A7", "#56B4E9", "#D55E00"][index % 6];
    }

    function readFeatures(rows, length) {
        const features = [];
        rows.forEach((row, index) => {
            const [name = "", startText = "", endText = "", strandText = "", colorText = "", type = ""] = row;
            if (index === 0 && !isNumberCell(startText)) return; // a header row
            if (!isNumberCell(startText) || !isNumberCell(endText)) throw new Error(`Features, row ${index + 1}: start and end must be whole numbers`);
            const start = Number(startText);
            const end = Number(endText);
            if (start < 1 || end < 1 || start > length || end > length) throw new Error(`Features, row ${index + 1}: positions must be from 1 to ${length}`);
            features.push({ name: name.slice(0, 40), start, end, strand: readStrand(strandText), color: readColor(colorText, type, features.length) });
        });
        return features;
    }

    function readSites(rows, length) {
        const sites = [];
        rows.forEach((row, index) => {
            const [name = "", positionText = ""] = row;
            if (index === 0 && !isNumberCell(positionText)) return;
            if (!isNumberCell(positionText)) throw new Error(`Sites, row ${index + 1}: the position must be a whole number`);
            const position = Number(positionText);
            if (position < 1 || position > length) throw new Error(`Sites, row ${index + 1}: the position must be from 1 to ${length}`);
            sites.push({ name: name.slice(0, 30), position });
        });
        return sites;
    }

    // Moves labels on one side apart vertically. Dense labels may extend below bottom; the viewBox includes them.
    function spread(labels, gap, top, bottom) {
        labels.sort((a, b) => a.y - b.y);
        for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
        const overflow = labels.length ? labels.at(-1).y - bottom : 0;
        if (overflow > 0) {
            labels.at(-1).y -= overflow;
            for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
        }
        if (labels.length && labels[0].y < top) {
            const shift = top - labels[0].y;
            labels.forEach(label => (label.y += shift));
        }
    }

    SlideForgePlugins.register({
        id: "plasmid-map",
        // 2: overlapping features on their own rings.
        version: "2",
        name: "Plasmid Map",
        description: "A circular plasmid map with features, strands and restriction sites",
        icon: "fa-solid fa-circle-notch",
        insert: { fill: true, category: "Biology", label: "Plasmid map", keywords: "plasmid map vector circular genbank feature restriction site cloning dna" },
        defaultSize: { width: 460, height: 380 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            name: "pUC19",
            length: 2686,
            features: "Name,Start,End,Strand,Colour,Type\nlacZα,146,469,-,,gene\nlac promoter,514,544,+,,promoter\nAmpR,1626,2486,-,,resistance\nori,867,1455,-,,origin",
            sites: "Name,Position\nEcoRI,396\nHindIII,447\nAatII,2617",
            ticks: true,
            fontSize: 16,
            color: "",
        },
        fields: [
            { key: "name", label: "Plasmid name", type: "text" },
            { key: "length", label: "Length (bp)", type: "number", min: 10, max: 10000000, step: 1 },
            { key: "features", label: "Features", type: "table", columns: ["Name", "Start", "End", "Strand (+/−)", "Colour", "Type"], rows: 6, hint: "A feature may cross the origin (start after end). Type (gene, promoter, origin, terminator, resistance) picks a colour when none is given." },
            { key: "sites", label: "Restriction sites", type: "table", columns: ["Name", "Position"], rows: 4 },
            { key: "ticks", label: "Scale", checkboxLabel: "Length ticks inside the circle", type: "checkbox" },
            { key: "fontSize", label: "Label size (px)", type: "number", min: 7, max: 30, step: 1 },
            { key: "color", label: "Text and backbone colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                name: String(data.name ?? "").slice(0, 60),
                length: Math.round(number(data.length, 2686, 10, 10000000)),
                features: String(data.features ?? ""),
                sites: String(data.sites ?? ""),
                ticks: data.ticks !== false,
                fontSize: number(data.fontSize, 13, 7, 30),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const { width, height } = context;
            const length = data.length;
            const features = readFeatures(context.parseTable(data.features), length).slice(0, 80);
            const sites = readSites(context.parseTable(data.sites), length).slice(0, 80);
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const style = { size, family: FONT };
            const labelTexts = [...features.map(f => f.name), ...sites.map(s => `${s.name} (${s.position})`)];
            const labelWidth = Math.max(0, ...labelTexts.map(text => context.measureText(text, style)));
            const pad = size * 0.6;
            const radius = Math.max(30, Math.min(width / 2 - labelWidth - size * 2.2 - pad, height / 2 - size * 1.8 - pad));
            const band = Math.max(6, Math.min(radius * 0.12, size * 1.1));
            const cx = width / 2;
            const cy = height / 2;
            const angle = position => ((position - 1) / length) * 2 * Math.PI - Math.PI / 2;
            const point = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
            const fmt = value => value.toFixed(1);
            const parts = [];
            parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(radius)}" fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="2"/>`);

            // Overlapping features on rings inside the backbone, the longest on it: a transposon drawn over the genes
            // it carries hid them (Tn1999 and blaOXA-48 on pOXA-48).
            const covers = feature => {
                const span = ((feature.end - feature.start + length) % length) + 1;
                return [feature.start, feature.start + span];
            };
            const overlaps = (p, q) => {
                const [p0, p1] = covers(p);
                const [q0, q1] = covers(q);
                return [-length, 0, length].some(shift => p0 < q1 + shift && q0 + shift < p1);
            };
            const rings = [];
            [...features].sort((p, q) => (covers(q)[1] - covers(q)[0]) - (covers(p)[1] - covers(p)[0])).forEach(feature => {
                let ring = rings.findIndex(placed => placed.every(other => !overlaps(feature, other)));
                if (ring < 0 || ring > 3) ring = Math.min(3, rings.length);
                (rings[ring] = rings[ring] || []).push(feature);
                feature.ring = ring;
            });
            const ringStep = band * 1.3;
            const innerRings = Math.max(0, rings.length - 1) * ringStep;

            if (data.ticks) {
                const step = context.niceTicks(0, length, 8).step;
                for (let value = step; value < length; value += step) {
                    const a = angle(value + 1);
                    const [x0, y0] = point(a, radius - innerRings - band * 0.6);
                    const [x1, y1] = point(a, radius - innerRings - band * 0.6 - size * 0.45);
                    const [tx, ty] = point(a, radius - innerRings - band * 0.6 - size * 1.4);
                    parts.push(`<line x1="${fmt(x0)}" y1="${fmt(y0)}" x2="${fmt(x1)}" y2="${fmt(y1)}" stroke="${ink}" stroke-opacity="0.5"/>`);
                    parts.push(`<text x="${fmt(tx)}" y="${fmt(ty + size * 0.3)}" font-size="${fmt(size * 0.7)}" text-anchor="middle" fill="${ink}" opacity="0.6">${value}</text>`);
                }
            }

            // Features: a band along the circle, with an arrowhead at its 3′ end for a strand.
            const labels = [];
            features.forEach(feature => {
                const span = ((feature.end - feature.start + length) % length) + 1;
                const a0 = angle(feature.start);
                const sweep = (span / length) * 2 * Math.PI;
                const a1 = a0 + sweep;
                const centre = radius - (feature.ring || 0) * ringStep;
                const inner = centre - band / 2;
                const outer = centre + band / 2;
                const head = feature.strand ? Math.min(sweep * 0.45, (band * 0.9) / centre) : 0;
                const large = sweep - head > Math.PI ? 1 : 0;
                let d;
                if (feature.strand === 1) {
                    const b = a1 - head;
                    d = `M${point(a0, outer).map(fmt).join(" ")}A${fmt(outer)} ${fmt(outer)} 0 ${large} 1 ${point(b, outer).map(fmt).join(" ")}L${point(a1, centre).map(fmt).join(" ")}L${point(b, inner).map(fmt).join(" ")}A${fmt(inner)} ${fmt(inner)} 0 ${large} 0 ${point(a0, inner).map(fmt).join(" ")}Z`;
                } else if (feature.strand === -1) {
                    const b = a0 + head;
                    d = `M${point(a0, centre).map(fmt).join(" ")}L${point(b, outer).map(fmt).join(" ")}A${fmt(outer)} ${fmt(outer)} 0 ${large} 1 ${point(a1, outer).map(fmt).join(" ")}L${point(a1, inner).map(fmt).join(" ")}A${fmt(inner)} ${fmt(inner)} 0 ${large} 0 ${point(b, inner).map(fmt).join(" ")}Z`;
                } else {
                    const big = sweep > Math.PI ? 1 : 0;
                    d = `M${point(a0, outer).map(fmt).join(" ")}A${fmt(outer)} ${fmt(outer)} 0 ${big} 1 ${point(a1, outer).map(fmt).join(" ")}L${point(a1, inner).map(fmt).join(" ")}A${fmt(inner)} ${fmt(inner)} 0 ${big} 0 ${point(a0, inner).map(fmt).join(" ")}Z`;
                }
                parts.push(`<path d="${d}" fill="${feature.color}" stroke="${ink}" stroke-opacity="0.35" stroke-width="0.8"/>`);
                if (feature.name) labels.push({ text: feature.name, a: a0 + sweep / 2, from: outer, weight: 700 });
            });

            // Restriction sites: a tick across the circle.
            sites.forEach(site => {
                const a = angle(site.position);
                const [x0, y0] = point(a, radius - band * 0.75);
                const [x1, y1] = point(a, radius + band * 0.75);
                parts.push(`<line x1="${fmt(x0)}" y1="${fmt(y0)}" x2="${fmt(x1)}" y2="${fmt(y1)}" stroke="${ink}" stroke-width="1.6"/>`);
                labels.push({ text: `${site.name} (${site.position})`, a, from: radius + band * 0.75, weight: 400 });
            });

            // Labels outside, each side pushed apart so none overlap, with a leader line to its feature or site.
            const labelRadius = radius + band / 2 + size * 1.4;
            labels.forEach(label => {
                label.right = Math.cos(label.a) >= 0;
                label.y = cy + labelRadius * Math.sin(label.a);
            });
            const gap = size * 1.25;
            [true, false].forEach(right => spread(labels.filter(label => label.right === right), gap, size, height - size * 0.4));
            labels.forEach(label => {
                const dy = label.y - cy;
                const dx = Math.sqrt(Math.max(0, labelRadius * labelRadius - dy * dy));
                const x = cx + (label.right ? 1 : -1) * Math.max(dx, size * 0.6);
                const [ax, ay] = point(label.a, label.from);
                const textX = x + (label.right ? size * 0.3 : -size * 0.3);
                parts.push(`<path d="M${fmt(ax)} ${fmt(ay)}L${fmt(x)} ${fmt(label.y)}" fill="none" stroke="${ink}" stroke-opacity="0.45" stroke-width="0.8"/>`);
                parts.push(`<text x="${fmt(textX)}" y="${fmt(label.y + size * 0.35)}" font-size="${size}" font-weight="${label.weight}" text-anchor="${label.right ? "start" : "end"}" fill="${ink}">${context.escapeXml(label.text)}</text>`);
            });

            if (data.name) parts.push(`<text x="${fmt(cx)}" y="${fmt(cy - size * 0.1)}" font-size="${fmt(size * 1.35)}" font-weight="700" text-anchor="middle" fill="${ink}">${context.escapeXml(data.name)}</text>`);
            parts.push(`<text x="${fmt(cx)}" y="${fmt(cy + size * 1.2)}" font-size="${size}" text-anchor="middle" fill="${ink}" opacity="0.75">${length.toLocaleString("en-US")} bp</text>`);
            const layoutHeight = Math.max(height, ...labels.map(label => label.y + size));
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${layoutHeight}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
