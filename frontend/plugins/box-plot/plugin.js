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


    // ── Tests for the comparisons (two-sided). Checked against SciPy 1.18 (ttest_ind equal_var=False, mannwhitneyu).

    // ln Γ(x), Lanczos approximation.
    function logGamma(x) {
        const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
        let y = x;
        const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
        let ser = 1.000000000190015;
        c.forEach(coefficient => (ser += coefficient / ++y));
        return -tmp + Math.log((2.5066282746310005 * ser) / x);
    }

    // Regularised incomplete beta I_x(a, b), by its continued fraction.
    function incompleteBeta(x, a, b) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
        const fraction = (x, a, b) => {
            const tiny = 1e-300;
            let c = 1;
            let d = 1 - ((a + b) * x) / (a + 1);
            d = 1 / (Math.abs(d) < tiny ? tiny : d);
            let h = d;
            for (let m = 1; m <= 300; m++) {
                const m2 = 2 * m;
                for (const aa of [(m * (b - m) * x) / ((a + m2 - 1) * (a + m2)), (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))]) {
                    d = 1 + aa * d;
                    d = 1 / (Math.abs(d) < tiny ? tiny : d);
                    c = 1 + aa / c;
                    if (Math.abs(c) < tiny) c = tiny;
                    h *= d * c;
                }
                if (Math.abs(d * c - 1) < 1e-14) break;
            }
            return h;
        };
        return x < (a + 1) / (a + b + 2) ? (front * fraction(x, a, b)) / a : 1 - (front * fraction(1 - x, b, a)) / b;
    }

    // Upper tail of the standard normal distribution, 2·Q(|z|) = erfc(|z|/√2) (relative error under 1.2e-7).
    function twoSidedNormal(z) {
        const x = Math.abs(z) / Math.SQRT2;
        const t = 1 / (1 + 0.5 * x);
        const erfc =
            t *
            Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
        return Math.min(1, erfc);
    }

    const variance = values => {
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        return { mean, variance: values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1) };
    };

    // Welch's t-test: unequal variances, Welch–Satterthwaite degrees of freedom.
    function welchTest(a, b) {
        if (a.length < 2 || b.length < 2) return null;
        const one = variance(a);
        const two = variance(b);
        const se2 = one.variance / a.length + two.variance / b.length;
        if (!(se2 > 0)) return one.mean === two.mean ? 1 : 0;
        const t = (one.mean - two.mean) / Math.sqrt(se2);
        const df = se2 ** 2 / ((one.variance / a.length) ** 2 / (a.length - 1) + (two.variance / b.length) ** 2 / (b.length - 1));
        return Math.min(1, incompleteBeta(df / (df + t * t), df / 2, 0.5));
    }

    // Mann–Whitney U. Exact when a group has at most 8 values and there are no ties (as SciPy chooses), else the
    // normal approximation with the tie and continuity corrections.
    function mannWhitney(a, b) {
        const n1 = a.length;
        const n2 = b.length;
        const all = [...a.map(v => ({ v, first: true })), ...b.map(v => ({ v, first: false }))].sort((p, q) => p.v - q.v);
        let rankSum = 0;
        let tieTerm = 0;
        for (let i = 0; i < all.length; ) {
            let j = i;
            while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
            const rank = (i + j) / 2 + 1;
            const count = j - i + 1;
            tieTerm += count ** 3 - count;
            for (let k = i; k <= j; k++) if (all[k].first) rankSum += rank;
            i = j + 1;
        }
        const u1 = rankSum - (n1 * (n1 + 1)) / 2;
        const u = Math.max(u1, n1 * n2 - u1);
        if (Math.min(n1, n2) <= 8 && tieTerm === 0) {
            // The number of orderings with each U: the coefficients of the Gaussian binomial [n1 + n2, m]_q.
            const m = Math.min(n1, n2);
            const n = Math.max(n1, n2);
            let poly = [1];
            for (let i = 1; i <= m; i++) {
                const next = new Array(poly.length + n + i).fill(0);
                poly.forEach((value, k) => {
                    next[k] += value;
                    next[k + n + i] -= value;
                });
                // Divide by (1 − q^i): a running sum with stride i.
                for (let k = i; k < next.length; k++) next[k] += next[k - i];
                poly = next.slice(0, m * n + 1);
            }
            const total = poly.reduce((sum, value) => sum + value, 0);
            const atLeast = poly.slice(Math.ceil(u - 1e-9)).reduce((sum, value) => sum + value, 0);
            return Math.min(1, (2 * atLeast) / total);
        }
        const count = n1 + n2;
        const sigma = Math.sqrt(((n1 * n2) / 12) * (count + 1 - tieTerm / (count * (count - 1))));
        if (!(sigma > 0)) return 1;
        return twoSidedNormal((u - (n1 * n2) / 2 - 0.5) / sigma);
    }

    const TESTS = { welch: { name: "Welch's t-test", run: welchTest }, "mann-whitney": { name: "Mann–Whitney U test", run: mannWhitney } };

    // "0.003", "p = 0.003", "p<0.001", "1e-4" → the number; anything else (stars, "n.s.", words) → null.
    function pValue(label) {
        const match = String(label).trim().match(/^(?:p\s*)?([<=≤]\s*)?(\d*\.?\d+(?:e-?\d+)?)$/i);
        if (!match) return null;
        const value = Number(match[2]);
        if (!Number.isFinite(value) || value < 0 || value > 1) return null;
        return (match[1] || "").includes("<") ? value * 0.999 : value;
    }

    function starsFor(p) {
        if (p < 0.0001) return "****";
        if (p < 0.001) return "***";
        if (p < 0.01) return "**";
        if (p < 0.05) return "*";
        return "n.s.";
    }

    const formatP = p => (p < 0.0001 ? "p < 0.0001" : `p = ${Number(p.toPrecision(2))}`);

    // The comparisons table: groups by number (1 = first) or by name; an empty label means "compute the p-value".
    function readComparisons(rows, groups) {
        const find = text => {
            const value = String(text ?? "").trim();
            if (/^\d+$/.test(value)) return Number(value) >= 1 && Number(value) <= groups.length ? Number(value) - 1 : -1;
            return groups.findIndex(group => group.name.trim().toLowerCase() === value.toLowerCase());
        };
        const comparisons = [];
        rows.forEach((row, index) => {
            const [fromText = "", toText = "", label = ""] = row;
            if (!String(fromText).trim() && !String(toText).trim()) return;
            const from = find(fromText);
            const to = find(toText);
            // A header row ("From group, To group, …") is skipped.
            if (index === 0 && from < 0 && to < 0 && !/^\d+$/.test(String(fromText).trim())) return;
            if (from < 0 || to < 0 || from === to) {
                throw new Error(`Comparison ${index + 1}: name two different groups, by number (1 to ${groups.length}) or by name`);
            }
            comparisons.push({ from: Math.min(from, to), to: Math.max(from, to), label: String(label).trim() });
        });
        return comparisons;
    }

    // What each comparison shows, and the p-values computed for those with no label of their own.
    function comparisonLabels(comparisons, groups, data) {
        const test = TESTS[data.test] || TESTS.welch;
        return comparisons.map(item => {
            if (item.label) {
                const p = pValue(item.label);
                return { ...item, text: p !== null && data.pShow === "stars" ? starsFor(p) : item.label, computed: null };
            }
            const p = test.run(groups[item.from].values, groups[item.to].values);
            if (p === null) return { ...item, text: "n < 2", computed: null };
            return { ...item, text: data.pShow === "stars" ? starsFor(p) : formatP(p), computed: p };
        });
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
        id: "box-plot",
        version: "3",
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
            comparisons: "",
            test: "welch",
            pShow: "stars",
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
            { key: "mean", advanced: true, label: "Mean", checkboxLabel: "Mark the mean (◆)", type: "checkbox" },
            { key: "yLabel", label: "Y axis label", type: "text" },
            { key: "yMin", advanced: true, label: "Y axis from", type: "text", placeholder: "Automatic" },
            { key: "yMax", advanced: true, label: "Y axis to", type: "text", placeholder: "Automatic" },
            {
                key: "palette", advanced: true,
                label: "Colours",
                type: "select",
                options: [
                    { value: "okabe", label: "One per group (colour-blind safe)" },
                    { value: "single", label: "One colour for all" },
                ],
            },
            { key: "fill", advanced: true, label: "Colour (one for all)", type: "color" },
            {
                key: "comparisons", section: "Comparisons",
                label: "Pairs to compare",
                type: "table",
                columns: ["From group", "To group", "p-value or label"],
                rows: 5,
                placeholder: "Control,Drug A\nControl,Drug B,**",
                hint: "Groups by name or number. Leave the label empty to compute the p-value with the test below; brackets sit above the plot and follow it.",
            },
            {
                key: "test", section: "Comparisons",
                label: "Test (empty labels)",
                type: "select",
                options: [
                    { value: "welch", label: "Welch's t-test (two-sided)" },
                    { value: "mann-whitney", label: "Mann–Whitney U test (two-sided)" },
                ],
            },
            {
                key: "pShow", section: "Comparisons",
                label: "p-values",
                type: "select",
                options: [
                    { value: "stars", label: "Stars (* < 0.05, ** < 0.01, *** < 0.001, **** < 0.0001)" },
                    { value: "p", label: "Numbers (p = 0.0057)" },
                ],
            },
            { key: "fontSize", advanced: true, label: "Text size (px)", type: "number", min: 8, max: 32, step: 1 },
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
                comparisons: String(data.comparisons ?? ""),
                test: data.test === "mann-whitney" ? "mann-whitney" : "welch",
                pShow: data.pShow === "p" ? "p" : "stars",
                fontSize: Number.isFinite(fontSize) ? Math.min(32, Math.max(8, fontSize)) : 14,
            };
        },

        // The p-values the chosen test gave, so they can be read and quoted.
        status(data) {
            if (!String(data.comparisons || "").trim() || typeof parsePluginTable !== "function") return "";
            try {
                const groups = readGroups(parsePluginTable(data.data)).slice(0, 20);
                const shown = comparisonLabels(readComparisons(parsePluginTable(data.comparisons), groups), groups, data).filter(item => item.computed !== null);
                if (!shown.length) return "";
                const test = (TESTS[data.test] || TESTS.welch).name;
                return `${test}: ${shown.map(item => `${groups[item.from].name} vs ${groups[item.to].name} ${formatP(item.computed)}`).join("; ")}`;
            } catch (_error) {
                return "";
            }
        },

        render(data, context) {
            const groups = readGroups(context.parseTable(data.data)).slice(0, 20);
            const comparisons = stack(comparisonLabels(readComparisons(context.parseTable(data.comparisons), groups), groups, data));
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
            // Brackets get a band above the plot, a level per row of brackets that would otherwise touch.
            const levels = comparisons.length ? Math.max(...comparisons.map(item => item.level)) + 1 : 0;
            const tip = size * 0.4;
            const levelHeight = size * 1.35 + tip;
            const top = size * 0.8 + levels * levelHeight;
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
            comparisons.forEach(item => {
                const lineY = top - size * 0.4 - tip - item.level * levelHeight;
                const x0 = left + band * (item.from + 0.5) + 2;
                const x1 = left + band * (item.to + 0.5) - 2;
                const isStars = /^\*+$/.test(item.text);
                parts.push(`<path d="M${x0.toFixed(1)} ${(lineY + tip).toFixed(1)}V${lineY.toFixed(1)}H${x1.toFixed(1)}V${(lineY + tip).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="1.5" class="comparison"/>`);
                parts.push(`<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(lineY - (isStars ? size * 0.05 : size * 0.25)).toFixed(1)}" font-size="${isStars ? size * 1.15 : size}" font-weight="${isStars ? 700 : 400}" text-anchor="middle" fill="${ink}" class="comparison-label">${context.escapeXml(item.text)}</text>`);
            });
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
