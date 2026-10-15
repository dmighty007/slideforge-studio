// Venn plugin: two or three overlapping sets, from region counts (A, B, A&B…, each the count in that region only)
// or from lists of items per set (the counts are worked out). Two sets can be drawn area-proportional (an Euler
// diagram: circle areas and their overlap match the counts); three sets use the classic symmetric layout. Each count
// is written at the most open point of its region.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const COLORS = ["#0072B2", "#E69F00", "#009E73"];

    // Region counts table: "A,12", "A&B,3", "A&B&C,1" (also ∩ or + between names).
    function fromCounts(rows) {
        const names = [];
        const regions = new Map();
        rows.forEach((row, index) => {
            const [regionText = "", countText = ""] = row;
            const blank = String(countText).trim() === "";
            const count = blank ? NaN : Number(String(countText).trim());
            if (index === 0 && !blank && !Number.isFinite(count)) return; // a header row
            if (!regionText.trim()) return;
            // A blank count is missing, not 0 (Number("") is 0).
            if (blank) throw new Error(`Row ${index + 1}: the count for “${regionText.trim()}” is missing`);
            if (!Number.isFinite(count) || count < 0) throw new Error(`Row ${index + 1}: “${countText}” is not a count`);
            const members = regionText.split(/[&∩+]/).map(name => name.trim()).filter(Boolean);
            members.forEach(name => !names.includes(name) && names.push(name));
            const mask = members.reduce((bits, name) => bits | (1 << names.indexOf(name)), 0);
            regions.set(mask, (regions.get(mask) || 0) + count);
        });
        return { names, regions };
    }

    // Lists: one column per set, named in the first row; each cell an item.
    function fromLists(rows) {
        if (rows.length < 2) throw new Error("Put each set's name in the first row and its items in the column below");
        const names = rows[0].map(name => name.trim()).filter(Boolean);
        const sets = names.map((_, column) => new Set(rows.slice(1).map(row => (row[column] ?? "").trim()).filter(Boolean)));
        const items = new Set(sets.flatMap(set => [...set]));
        const regions = new Map();
        items.forEach(item => {
            const mask = sets.reduce((bits, set, i) => (set.has(item) ? bits | (1 << i) : bits), 0);
            regions.set(mask, (regions.get(mask) || 0) + 1);
        });
        return { names, regions };
    }

    // The area two circles share at distance d.
    function overlap(r1, r2, d) {
        if (d >= r1 + r2) return 0;
        if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
        const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
        const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
        const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
        return a + b - c;
    }

    // Circles in unit space: { x, y, r } per set.
    function layout(count, regions, proportional) {
        if (count === 3) {
            // Centres on a triangle with sides 1.2 radii, its centre at the origin.
            const side = 1.2;
            const height = (side * Math.sqrt(3)) / 2;
            return [
                { x: -side / 2, y: -height / 3, r: 1 },
                { x: side / 2, y: -height / 3, r: 1 },
                { x: 0, y: (2 * height) / 3, r: 1 },
            ];
        }
        if (!proportional) return [{ x: -0.6, y: 0, r: 1 }, { x: 0.6, y: 0, r: 1 }];
        const a = (regions.get(1) || 0) + (regions.get(3) || 0);
        const b = (regions.get(2) || 0) + (regions.get(3) || 0);
        const both = regions.get(3) || 0;
        const total = Math.max(a, b) || 1;
        const r1 = Math.sqrt(Math.max(a, total * 0.02) / total);
        const r2 = Math.sqrt(Math.max(b, total * 0.02) / total);
        const target = (both / total) * Math.PI;
        let d;
        if (!both) d = r1 + r2 + 0.15;
        else if (both >= Math.min(a, b)) d = Math.abs(r1 - r2) * 0.98;
        else {
            // The overlap shrinks as the circles move apart: find the distance by halving.
            let lo = Math.abs(r1 - r2);
            let hi = r1 + r2;
            for (let i = 0; i < 60; i++) {
                const mid = (lo + hi) / 2;
                if (overlap(r1, r2, mid) > target) lo = mid;
                else hi = mid;
            }
            d = (lo + hi) / 2;
        }
        return [{ x: 0, y: 0, r: r1 }, { x: d, y: 0, r: r2 }];
    }

    // The point of a region (a mask of the circles it is inside) farthest from every circle's edge.
    function regionAnchor(circles, mask, bounds) {
        let best = null;
        const steps = 90;
        for (let i = 0; i <= steps; i++) {
            for (let j = 0; j <= steps; j++) {
                const x = bounds.x0 + ((bounds.x1 - bounds.x0) * i) / steps;
                const y = bounds.y0 + ((bounds.y1 - bounds.y0) * j) / steps;
                let inside = 0;
                let clearance = Infinity;
                circles.forEach((circle, k) => {
                    const distance = Math.hypot(x - circle.x, y - circle.y);
                    if (distance < circle.r) inside |= 1 << k;
                    clearance = Math.min(clearance, Math.abs(distance - circle.r));
                });
                if (inside === mask && (!best || clearance > best.clearance)) best = { x, y, clearance };
            }
        }
        return best;
    }

    SlideForgePlugins.register({
        id: "venn",
        version: "2",
        name: "Venn Diagram",
        description: "A Venn or Euler diagram of two or three sets, from counts or lists of items",
        icon: "fa-solid fa-circle-half-stroke",
        insert: { category: "Statistics", label: "Venn diagram", keywords: "venn euler diagram sets overlap intersection genes shared unique" },
        defaultSize: { width: 440, height: 320 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            mode: "counts",
            data: "Region,Count\nRNA-seq,420\nProteomics,180\nRNA-seq&Proteomics,95",
            proportional: true,
            totals: true,
            fontSize: 15,
            color: "",
        },
        fields: [
            {
                key: "mode",
                label: "Data",
                type: "select",
                options: [
                    { value: "counts", label: "Counts per region (A, B, A&B…)" },
                    { value: "lists", label: "Lists of items, one column per set" },
                ],
            },
            {
                key: "data",
                label: "Table",
                type: "table",
                rows: 6,
                hint: "Counts: one row per region, its sets joined by & and the count of items in that region only. Lists: set names in the first row, items below.",
            },
            { key: "proportional", label: "Areas", checkboxLabel: "Two sets: circle sizes and overlap match the counts", type: "checkbox" },
            { key: "totals", label: "Totals", checkboxLabel: "Show each set's total next to its name", type: "checkbox" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 36, step: 1 },
            { key: "color", label: "Text colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const fontSize = Number(data.fontSize);
            return {
                mode: data.mode === "lists" ? "lists" : "counts",
                data: String(data.data ?? ""),
                proportional: data.proportional !== false,
                totals: data.totals !== false,
                fontSize: Number.isFinite(fontSize) ? Math.min(36, Math.max(8, fontSize)) : 15,
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            const rows = context.parseTable(data.data);
            const { names, regions } = data.mode === "lists" ? fromLists(rows) : fromCounts(rows);
            if (names.length < 2 || names.length > 3) throw new Error(`A Venn diagram here has two or three sets; the table names ${names.length}`);
            const count = names.length;
            const circles = layout(count, regions, data.proportional);
            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const totals = names.map((_, i) => [...regions.entries()].reduce((sum, [mask, value]) => (mask & (1 << i) ? sum + value : sum), 0));
            const labels = names.map((name, i) => (data.totals ? `${name} (${totals[i]})` : name));

            // Fit the circles into the box, leaving room above (and below, for three sets) for the set names.
            const x0 = Math.min(...circles.map(c => c.x - c.r));
            const x1 = Math.max(...circles.map(c => c.x + c.r));
            const y0 = Math.min(...circles.map(c => c.y - c.r));
            const y1 = Math.max(...circles.map(c => c.y + c.r));
            const top = size * 1.8;
            const bottom = count === 3 ? size * 1.8 : size * 0.6;
            const scale = Math.min((width - size) / (x1 - x0), (height - top - bottom) / (y1 - y0));
            const ox = (width - (x1 - x0) * scale) / 2 - x0 * scale;
            const oy = top + (height - top - bottom - (y1 - y0) * scale) / 2 - y0 * scale;
            const sx = x => ox + x * scale;
            const sy = y => oy + y * scale;
            const fmt = value => value.toFixed(1);
            const parts = circles.map(
                (c, i) => `<circle cx="${fmt(sx(c.x))}" cy="${fmt(sy(c.y))}" r="${fmt(c.r * scale)}" fill="${COLORS[i]}" fill-opacity="0.32" stroke="${COLORS[i]}" stroke-width="2"/>`,
            );

            // Region counts, each at its most open point; regions the layout has no room for are left out.
            const bounds = { x0, x1, y0, y1 };
            for (let mask = 1; mask < 1 << count; mask++) {
                const anchor = regionAnchor(circles, mask, bounds);
                if (!anchor) continue;
                const value = regions.get(mask) || 0;
                parts.push(`<text x="${fmt(sx(anchor.x))}" y="${fmt(sy(anchor.y) + size * 0.35)}" font-size="${size}" font-weight="700" text-anchor="middle" fill="${ink}"${value ? "" : ' opacity="0.45"'}>${value}</text>`);
            }

            // Set names: above the circles (the third set below its circle).
            circles.forEach((c, i) => {
                const below = count === 3 && i === 2;
                const y = below ? sy(c.y + c.r) + size * 1.3 : sy(c.y - c.r) - size * 0.55;
                // Kept inside the box: a name wider than the room left of its centre starts at the edge instead.
                const textWidth = context.measureText(labels[i], { size, weight: 600, family: FONT });
                const x = Math.min(Math.max(sx(c.x), textWidth / 2 + size + 2), width - textWidth / 2 - 2);
                parts.push(`<rect x="${fmt(x - textWidth / 2 - size * 0.9)}" y="${fmt(y - size * 0.72)}" width="${fmt(size * 0.6)}" height="${fmt(size * 0.6)}" rx="2" fill="${COLORS[i]}"/>`);
                parts.push(`<text x="${fmt(x)}" y="${fmt(y)}" font-size="${size}" font-weight="600" text-anchor="middle" fill="${ink}">${context.escapeXml(labels[i])}</text>`);
            });
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
