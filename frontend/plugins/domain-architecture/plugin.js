// Domain architecture plugin: a protein drawn as a line from 1 to its length, with domains (boxes, rounded boxes or
// ovals) from a table, sites (phosphorylation, mutations…) as lollipops with labels, and a ruler in residues.
// Domain names go inside a domain when they fit, otherwise above or below it.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442"];
    const NAMED_COLORS = { red: "#D55E00", orange: "#E69F00", yellow: "#F0E442", green: "#009E73", blue: "#0072B2", purple: "#CC79A7", pink: "#CC79A7", sky: "#56B4E9", grey: "#9ca3af", gray: "#9ca3af" };
    const isWhole = cell => /^\s*\d+\s*$/.test(String(cell ?? ""));

    // Dark text on light fills, white text on dark ones.
    function textOn(hex) {
        const value = parseInt(hex.slice(1), 16);
        const [r, g, b] = [16, 8, 0].map(shift => ((value >> shift) & 255) / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111827" : "#ffffff";
    }

    function readDomains(rows, length) {
        const domains = [];
        rows.forEach((row, index) => {
            const [name = "", startText = "", endText = "", colorText = "", shapeText = ""] = row;
            if (index === 0 && !isWhole(startText)) return;
            if (!isWhole(startText) || !isWhole(endText)) throw new Error(`Domains, row ${index + 1}: start and end must be whole numbers`);
            const start = Number(startText);
            const end = Number(endText);
            if (start < 1 || end > length || end < start) throw new Error(`Domains, row ${index + 1}: positions must be from 1 to ${length}, start before end`);
            const named = NAMED_COLORS[colorText.trim().toLowerCase()];
            const color = HEX_COLOR.test(colorText.trim()) ? colorText.trim() : named || OKABE_ITO[domains.length % OKABE_ITO.length];
            const shape = ["box", "rounded", "oval"].includes(shapeText.trim().toLowerCase()) ? shapeText.trim().toLowerCase() : "rounded";
            domains.push({ name: name.slice(0, 40), start, end, color, shape });
        });
        return domains;
    }

    function readSites(rows, length) {
        const sites = [];
        rows.forEach((row, index) => {
            const [positionText = "", label = ""] = row;
            if (index === 0 && !isWhole(positionText)) return;
            if (!isWhole(positionText)) throw new Error(`Sites, row ${index + 1}: the position must be a whole number`);
            const position = Number(positionText);
            if (position < 1 || position > length) throw new Error(`Sites, row ${index + 1}: the position must be from 1 to ${length}`);
            sites.push({ position, label: label.slice(0, 30) });
        });
        return sites.sort((a, b) => a.position - b.position);
    }

    SlideForgePlugins.register({
        id: "domain-architecture",
        version: "1",
        name: "Domain Architecture",
        description: "A protein's domains, sites and length as a diagram",
        icon: "fa-solid fa-bars-progress",
        insert: { category: "Biology", label: "Protein domain architecture", keywords: "protein domain architecture pfam motif site mutation phosphorylation lollipop residue" },
        defaultSize: { width: 600, height: 170 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            name: "p53 (human)",
            length: 393,
            domains: "Name,Start,End,Colour,Shape\nTAD,1,61,,rounded\nDNA-binding,94,292,,rounded\nTet,325,356,,oval\nReg,363,393,,box",
            sites: "Position,Label\n15,S15\n175,R175H\n248,R248Q\n273,R273H",
            ruler: true,
            fontSize: 16,
            color: "",
        },
        fields: [
            { key: "name", label: "Protein name", type: "text" },
            { key: "length", label: "Length (residues)", type: "number", min: 2, max: 100000, step: 1 },
            { key: "domains", label: "Domains", type: "table", columns: ["Name", "Start", "End", "Colour", "Shape (box, rounded, oval)"], rows: 5 },
            { key: "sites", label: "Sites", type: "table", columns: ["Position", "Label"], rows: 4, hint: "Mutations, modifications or motifs, drawn as lollipops." },
            { key: "ruler", label: "Ruler", checkboxLabel: "Show a ruler in residues", type: "checkbox" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 7, max: 30, step: 1 },
            { key: "color", label: "Line and text colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                name: String(data.name ?? "").slice(0, 60),
                length: Math.round(number(data.length, 393, 2, 100000)),
                domains: String(data.domains ?? ""),
                sites: String(data.sites ?? ""),
                ruler: data.ruler !== false,
                fontSize: number(data.fontSize, 13, 7, 30),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const { width, height } = context;
            const length = data.length;
            const domains = readDomains(context.parseTable(data.domains), length).slice(0, 60);
            const sites = readSites(context.parseTable(data.sites), length).slice(0, 80);
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const style = { size, family: FONT };
            const fmt = value => value.toFixed(1);
            const nameWidth = data.name ? context.measureText(data.name, { ...style, weight: 700 }) + size : 0;
            const left = Math.max(size * 0.5, nameWidth);
            const right = size * 1.2;
            const scale = (width - left - right) / Math.max(1, length - 1);
            const x = position => left + (position - 1) * scale;
            const siteRoom = sites.length ? size * 4.4 : 0;
            const domainHeight = Math.max(12, Math.min(size * 2.2, height * 0.28));
            const outside = domains.filter(domain => context.measureText(domain.name, style) > (domain.end - domain.start) * scale - size * 0.6);
            // Allocate every collision row before positioning the protein and ruler.
            const labelRows = new Map();
            let lastEnd = -Infinity;
            let labelRow = 0;
            outside.forEach(domain => {
                const textWidth = context.measureText(domain.name, style);
                const centre = Math.min(Math.max((x(domain.start) + x(domain.end)) / 2, textWidth / 2), width - textWidth / 2);
                labelRow = centre - textWidth / 2 < lastEnd + size * 0.4 ? labelRow + 1 : 0;
                lastEnd = centre + textWidth / 2;
                labelRows.set(domain, labelRow);
            });
            const outsideRoom = outside.length ? size * (1.4 + Math.max(...labelRows.values()) * 1.1) : 0;
            const rulerRoom = data.ruler ? size * 2 : 0;
            const used = siteRoom + domainHeight + outsideRoom + rulerRoom;
            const layoutHeight = Math.max(height, used + size);
            const midY = (layoutHeight - used) / 2 + siteRoom + domainHeight / 2;
            const parts = [];
            if (data.name) parts.push(`<text x="0" y="${fmt(midY + size * 0.35)}" font-size="${size}" font-weight="700" fill="${ink}">${context.escapeXml(data.name)}</text>`);
            parts.push(`<line x1="${fmt(x(1))}" x2="${fmt(x(length))}" y1="${fmt(midY)}" y2="${fmt(midY)}" stroke="${ink}" stroke-opacity="0.55" stroke-width="${fmt(Math.max(3, domainHeight * 0.18))}" stroke-linecap="round"/>`);

            // Names that do not fit inside go below their domain, alternating rows when neighbours would touch.
            domains.forEach(domain => {
                const x0 = x(domain.start);
                const x1 = x(domain.end);
                const w = Math.max(2, x1 - x0);
                const top = midY - domainHeight / 2;
                const rx = domain.shape === "oval" ? w / 2 : domain.shape === "rounded" ? Math.min(domainHeight / 3, w / 2) : 0;
                const ry = domain.shape === "oval" ? domainHeight / 2 : rx;
                parts.push(`<rect x="${fmt(x0)}" y="${fmt(top)}" width="${fmt(w)}" height="${fmt(domainHeight)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${domain.color}" stroke="${ink}" stroke-opacity="0.4" stroke-width="1"/>`);
                if (!domain.name) return;
                const textWidth = context.measureText(domain.name, style);
                if (!outside.includes(domain)) {
                    parts.push(`<text x="${fmt(x0 + w / 2)}" y="${fmt(midY + size * 0.35)}" font-size="${size}" font-weight="600" text-anchor="middle" fill="${textOn(domain.color)}">${context.escapeXml(domain.name)}</text>`);
                } else {
                    const centre = Math.min(Math.max(x0 + w / 2, textWidth / 2), width - textWidth / 2);
                    const row = labelRows.get(domain);
                    parts.push(`<text x="${fmt(centre)}" y="${fmt(midY + domainHeight / 2 + size * (1.1 + row * 1.1))}" font-size="${fmt(size * 0.9)}" text-anchor="middle" fill="${ink}">${context.escapeXml(domain.name)}</text>`);
                }
            });

            // Sites: a stick up from the protein, a dot, and the label; a label that would touch one already placed
            // goes up a row (up to three rows).
            const rowEnds = [-Infinity, -Infinity, -Infinity];
            sites.forEach(site => {
                const sx = x(site.position);
                const labelWidth = context.measureText(site.label, { size: size * 0.85, family: FONT });
                const free = rowEnds.findIndex(end => sx - labelWidth / 2 >= end + size * 0.3);
                const level = free >= 0 ? free : rowEnds.indexOf(Math.min(...rowEnds));
                rowEnds[level] = sx + labelWidth / 2;
                const tip = midY - domainHeight / 2 - size * (0.9 + level * 1.15);
                parts.push(`<line x1="${fmt(sx)}" x2="${fmt(sx)}" y1="${fmt(midY - domainHeight / 2)}" y2="${fmt(tip)}" stroke="${ink}" stroke-width="1.2"/>`);
                parts.push(`<circle cx="${fmt(sx)}" cy="${fmt(tip)}" r="${fmt(size * 0.28)}" fill="${ink}"/>`);
                if (site.label) parts.push(`<text x="${fmt(sx)}" y="${fmt(tip - size * 0.5)}" font-size="${fmt(size * 0.85)}" text-anchor="middle" fill="${ink}">${context.escapeXml(site.label)}</text>`);
            });

            if (data.ruler) {
                const rulerY = midY + domainHeight / 2 + outsideRoom + size * 0.6;
                const step = context.niceTicks(0, length, Math.max(3, Math.round((width - left) / 80))).step;
                parts.push(`<line x1="${fmt(x(1))}" x2="${fmt(x(length))}" y1="${fmt(rulerY)}" y2="${fmt(rulerY)}" stroke="${ink}" stroke-opacity="0.6"/>`);
                const marks = [1];
                for (let value = step; value < length; value += step) marks.push(value);
                if (length - marks.at(-1) > step * 0.4) marks.push(length);
                else marks[marks.length - 1] = length;
                marks.forEach(value => {
                    parts.push(`<line x1="${fmt(x(value))}" x2="${fmt(x(value))}" y1="${fmt(rulerY)}" y2="${fmt(rulerY + size * 0.35)}" stroke="${ink}" stroke-opacity="0.6"/>`);
                    parts.push(`<text x="${fmt(x(value))}" y="${fmt(rulerY + size * 1.3)}" font-size="${fmt(size * 0.75)}" text-anchor="middle" fill="${ink}" opacity="0.75">${value}</text>`);
                });
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${layoutHeight}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
