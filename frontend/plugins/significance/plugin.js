// Significance brackets plugin: brackets between groups of a chart with stars, "n.s." or p-values. The groups are
// spread evenly across the object's box, so the box goes over the chart's plot area, as wide as its bars.
// Comparisons are a table: from group, to group, label (a p-value can be turned into stars).

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    // "0.003", "p = 0.003", "p<0.001", "1e-4" → the number; anything else (stars, "n.s.", words) → null.
    function pValue(label) {
        const match = String(label).trim().match(/^(?:p\s*)?([<=≤]\s*)?(\d*\.?\d+(?:e-?\d+)?)$/i);
        if (!match) return null;
        const value = Number(match[2]);
        if (!Number.isFinite(value) || value < 0 || value > 1) return null;
        // "p < 0.001" is below the bound itself: it earns the stars of anything smaller.
        return (match[1] || "").includes("<") ? value * 0.999 : value;
    }

    function starsFor(p) {
        if (p < 0.0001) return "****";
        if (p < 0.001) return "***";
        if (p < 0.01) return "**";
        if (p < 0.05) return "*";
        return "n.s.";
    }

    // Rows of the table as comparisons; a first row whose groups are not numbers is a header and is skipped.
    function readComparisons(rows, groups) {
        const comparisons = [];
        rows.forEach((row, index) => {
            const [fromText = "", toText = "", label = ""] = row;
            const from = Number(fromText);
            const to = Number(toText);
            if (index === 0 && !Number.isFinite(from) && !Number.isFinite(to)) return;
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1 || from > groups || to > groups || from === to) {
                throw new Error(`Row ${index + 1}: the groups must be two different whole numbers from 1 to ${groups}`);
            }
            comparisons.push({ from: Math.min(from, to), to: Math.max(from, to), label });
        });
        return comparisons;
    }

    // Short brackets sit lowest; each goes on the lowest level where it does not touch another bracket.
    function stack(comparisons) {
        const levels = [];
        return [...comparisons]
            .sort((a, b) => a.to - a.from - (b.to - b.from) || a.from - b.from)
            .map(item => {
                let level = 0;
                while ((levels[level] || []).some(other => item.from <= other.to && other.from <= item.to)) level++;
                (levels[level] = levels[level] || []).push(item);
                return { ...item, level };
            });
    }

    SlideForgePlugins.register({
        id: "significance",
        version: "1",
        name: "Significance Brackets",
        description: "Brackets with stars or p-values between groups of a chart",
        icon: "fa-solid fa-asterisk",
        insert: { category: "Statistics", label: "Significance brackets", keywords: "significance p-value stars bracket statistics t-test anova chart" },
        defaultSize: { width: 360, height: 120 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            groups: 3,
            comparisons: "1,2,0.004\n2,3,n.s.\n1,3,<0.0001",
            stars: true,
            color: "",
            lineWidth: 2,
            fontSize: 18,
            tip: 8,
        },
        fields: [
            { key: "groups", label: "Groups in the chart", type: "number", min: 2, max: 30, step: 1, hint: "Spread evenly across the box: put it over the plot area, as wide as the bars." },
            {
                key: "comparisons",
                label: "Comparisons",
                type: "table",
                columns: ["From group", "To group", "Label or p-value"],
                rows: 5,
                placeholder: "1,2,**\n1,3,0.01",
            },
            { key: "stars", label: "p-values", checkboxLabel: "Show p-values as stars (* < 0.05, ** < 0.01, *** < 0.001, **** < 0.0001)", type: "checkbox" },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
            { key: "lineWidth", label: "Line width (px)", type: "number", min: 0.5, max: 8, step: 0.5 },
            { key: "fontSize", label: "Label size (px)", type: "number", min: 8, max: 48, step: 1 },
            { key: "tip", label: "Bracket ends (px)", type: "number", min: 0, max: 40, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                groups: Math.round(number(data.groups, 3, 2, 30)),
                comparisons: String(data.comparisons ?? ""),
                stars: data.stars !== false,
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                lineWidth: number(data.lineWidth, 2, 0.5, 8),
                fontSize: number(data.fontSize, 18, 8, 48),
                tip: number(data.tip, 8, 0, 40),
            };
        },

        render(data, context) {
            const { width, height } = context;
            const comparisons = readComparisons(context.parseTable(data.comparisons), data.groups);
            if (!comparisons.length) throw new Error("Add a comparison: from group, to group, label (e.g. 1,2,**)");
            const placed = stack(comparisons);
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const levelCount = Math.max(...placed.map(item => item.level)) + 1;
            const pad = data.lineWidth;
            // Each level needs room for its label above the line; shrink the spacing to fit the box if needed.
            const wanted = data.fontSize * 1.25 + data.tip;
            const levelHeight = Math.max(6, Math.min(wanted, (height - 2 * pad - data.tip) / levelCount));
            const fontSize = Math.min(data.fontSize, levelHeight * 0.8);
            const centre = group => ((group - 0.5) * width) / data.groups;
            const parts = placed.map(item => {
                const lineY = height - pad - data.tip - item.level * levelHeight;
                const x0 = centre(item.from) + 2;
                const x1 = centre(item.to) - 2;
                const p = pValue(item.label);
                const label = p !== null && data.stars ? starsFor(p) : item.label;
                const isStars = /^\*+$/.test(label);
                return (
                    `<path d="M${x0} ${lineY + data.tip}V${lineY}H${x1}V${lineY + data.tip}" fill="none" stroke="${ink}" stroke-width="${data.lineWidth}" stroke-linejoin="miter"/>` +
                    (label
                        ? `<text x="${(x0 + x1) / 2}" y="${lineY - (isStars ? fontSize * 0.05 : fontSize * 0.25)}" font-family="Arial, Helvetica, sans-serif" font-size="${isStars ? fontSize * 1.15 : fontSize}" font-weight="${isStars ? 700 : 400}" fill="${ink}" text-anchor="middle">${escapeXml(label)}</text>`
                        : "")
                );
            });
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
        },
    });
})();
