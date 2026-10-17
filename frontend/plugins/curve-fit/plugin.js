// Curve fit plugin: points from a table (x, then one column of y per series) and a least-squares fit of a model
// to each series: four-parameter dose-response (EC50, Hill slope; log x axis), straight line, Michaelis-Menten or
// one-phase exponential decay. Levenberg-Marquardt; standard errors from the covariance s²(JᵀJ)⁻¹ and 95%
// intervals from Student's t, as SciPy's curve_fit and GraphPad report them (checked against SciPy 1.18).

(() => {
    const FONT = "Arial, Helvetica, sans-serif";
    // Okabe & Ito, a palette readable with colour-vision deficiencies.
    const OKABE_ITO = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000"];

    const MODELS = {
        "dose-response": {
            label: "Dose-response (4 parameters)",
            names: ["Bottom", "Top", "log EC50", "Hill slope"],
            // y = Bottom + (Top − Bottom) / (1 + 10^((logEC50 − log x)·Hill))
            f: ([bottom, top, logEC50, hill], x) => bottom + (top - bottom) / (1 + 10 ** ((logEC50 - Math.log10(x)) * hill)),
            guess(points) {
                const sorted = [...points].sort((a, b) => a.x - b.x);
                const low = sorted.slice(0, Math.max(1, Math.round(sorted.length / 4)));
                const high = sorted.slice(-Math.max(1, Math.round(sorted.length / 4)));
                const mean = list => list.reduce((sum, p) => sum + p.y, 0) / list.length;
                const bottom = mean(low);
                const top = mean(high);
                // The x where the response is closest to halfway.
                const half = (bottom + top) / 2;
                const middle = sorted.reduce((best, p) => (Math.abs(p.y - half) < Math.abs(best.y - half) ? p : best), sorted[0]);
                return [bottom, top, Math.log10(middle.x), 1];
            },
            needsPositiveX: true,
        },
        linear: {
            label: "Straight line",
            names: ["Slope", "Intercept"],
            f: ([slope, intercept], x) => slope * x + intercept,
            guess(points) {
                const n = points.length;
                const mx = points.reduce((s, p) => s + p.x, 0) / n;
                const my = points.reduce((s, p) => s + p.y, 0) / n;
                const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0) || 1;
                const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
                return [slope, my - slope * mx];
            },
        },
        "michaelis-menten": {
            label: "Michaelis–Menten",
            names: ["Vmax", "Km"],
            f: ([vmax, km], x) => (vmax * x) / (km + x),
            guess(points) {
                const vmax = Math.max(...points.map(p => p.y));
                const half = points.reduce((best, p) => (Math.abs(p.y - vmax / 2) < Math.abs(best.y - vmax / 2) ? p : best), points[0]);
                return [vmax, Math.max(1e-9, half.x)];
            },
        },
        "exp-decay": {
            label: "One-phase decay",
            names: ["Y0", "Plateau", "k"],
            f: ([y0, plateau, k], x) => plateau + (y0 - plateau) * Math.exp(-k * x),
            guess(points) {
                const sorted = [...points].sort((a, b) => a.x - b.x);
                const span = sorted.at(-1).x - sorted[0].x || 1;
                return [sorted[0].y, sorted.at(-1).y, 3 / span];
            },
        },
    };

    // ── Statistics ──────────────────────────────────────────────────────────────

    function logGamma(x) {
        const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
        let y = x;
        const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
        let ser = 1.000000000190015;
        c.forEach(coefficient => (ser += coefficient / ++y));
        return -tmp + Math.log((2.5066282746310005 * ser) / x);
    }

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

    // The t value with the given two-sided tail probability (0.05 → the 97.5th percentile), by bisection.
    function tCritical(df, alpha = 0.05) {
        const tail = t => 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
        let low = 0;
        let high = 1e4;
        for (let i = 0; i < 200; i++) {
            const mid = (low + high) / 2;
            if (tail(mid) > alpha / 2) low = mid;
            else high = mid;
        }
        return (low + high) / 2;
    }

    function invert(matrix) {
        const n = matrix.length;
        const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
        for (let col = 0; col < n; col++) {
            let pivot = col;
            for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
            if (Math.abs(a[pivot][col]) < 1e-300) return null;
            [a[col], a[pivot]] = [a[pivot], a[col]];
            const scale = a[col][col];
            for (let j = 0; j < 2 * n; j++) a[col][j] /= scale;
            for (let row = 0; row < n; row++) {
                if (row === col) continue;
                const factor = a[row][col];
                for (let j = 0; j < 2 * n; j++) a[row][j] -= factor * a[col][j];
            }
        }
        return a.map(row => row.slice(n));
    }

    // Levenberg-Marquardt least squares. Resolves to the parameters, their standard errors and 95% intervals, R².
    function fit(model, points) {
        const f = model.f;
        const residuals = params => points.map(p => p.y - f(params, p.x));
        const sumSquares = params => residuals(params).reduce((s, r) => s + r * r, 0);
        const jacobian = params =>
            points.map(p =>
                params.map((value, j) => {
                    const step = Math.max(1e-7, Math.abs(value) * 1e-6);
                    const up = params.slice();
                    const down = params.slice();
                    up[j] += step;
                    down[j] -= step;
                    return (f(up, p.x) - f(down, p.x)) / (2 * step);
                }),
            );
        let params = model.guess(points);
        let cost = sumSquares(params);
        let lambda = 1e-3;
        for (let iteration = 0; iteration < 500; iteration++) {
            const J = jacobian(params);
            const r = residuals(params);
            const m = params.length;
            const JtJ = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0)));
            const Jtr = Array.from({ length: m }, (_, i) => J.reduce((s, row, k) => s + row[i] * r[k], 0));
            let improved = false;
            for (let attempt = 0; attempt < 20; attempt++) {
                const A = JtJ.map((row, i) => row.map((value, j) => (i === j ? value * (1 + lambda) + 1e-12 : value)));
                const inverse = invert(A);
                if (!inverse) break;
                const delta = inverse.map(row => row.reduce((s, value, j) => s + value * Jtr[j], 0));
                const next = params.map((value, i) => value + delta[i]);
                const nextCost = sumSquares(next);
                if (Number.isFinite(nextCost) && nextCost < cost) {
                    const change = Math.abs(cost - nextCost) / Math.max(cost, 1e-300);
                    params = next;
                    cost = nextCost;
                    lambda = Math.max(1e-12, lambda / 10);
                    improved = true;
                    if (change < 1e-14) iteration = 500;
                    break;
                }
                lambda *= 10;
            }
            if (!improved) break;
        }
        const n = points.length;
        const p = params.length;
        const df = n - p;
        const J = jacobian(params);
        const JtJ = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0)));
        const inverse = invert(JtJ);
        const variance = df > 0 ? cost / df : NaN;
        const se = params.map((_, i) => (inverse && df > 0 ? Math.sqrt(Math.max(0, inverse[i][i] * variance)) : NaN));
        const t = df > 0 ? tCritical(df) : NaN;
        const meanY = points.reduce((s, q) => s + q.y, 0) / n;
        const total = points.reduce((s, q) => s + (q.y - meanY) ** 2, 0);
        return {
            params,
            se,
            ci: params.map((value, i) => [value - t * se[i], value + t * se[i]]),
            r2: total > 0 ? 1 - cost / total : NaN,
            df,
        };
    }

    // ── Data ─────────────────────────────────────────────────────────────────────

    const numberOrNull = text => {
        const value = Number(String(text ?? "").trim().replace(",", "."));
        return String(text ?? "").trim() !== "" && Number.isFinite(value) ? value : null;
    };

    function readSeries(rows) {
        if (!rows.length) throw new Error("Paste the data: x in the first column, then one column of y per series");
        const header = rows[0].slice(1).some(cell => cell !== "" && numberOrNull(cell) === null) || numberOrNull(rows[0][0]) === null;
        const body = header ? rows.slice(1) : rows;
        const columns = Math.max(...rows.map(row => row.length));
        if (columns < 2) throw new Error("Two columns at least: x, then y");
        const series = [];
        for (let column = 1; column < columns; column++) {
            const points = [];
            body.forEach((row, index) => {
                const x = numberOrNull(row[0]);
                const y = numberOrNull(row[column]);
                if (String(row[column] ?? "").trim() === "") return;
                if (x === null) throw new Error(`Row ${index + 1}: “${row[0]}” is not a number`);
                if (y === null) throw new Error(`Row ${index + 1}, column ${column + 1}: “${row[column]}” is not a number`);
                points.push({ x, y });
            });
            if (points.length) series.push({ name: header ? rows[0][column] || `Series ${column}` : `Series ${column}`, points });
        }
        if (!series.length) throw new Error("No y values");
        return series;
    }

    const formatNumber = value => {
        if (!Number.isFinite(value)) return "–";
        const magnitude = Math.abs(value);
        if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3)) return value.toExponential(2);
        return String(Number(value.toPrecision(3)));
    };

    // The unit in an axis label's round or square brackets: "Time (h)" or "Time [h]" → "h"; none → "".
    const unitOf = label => {
        const match = String(label || "").match(/(?:\(([^()]+)\)|\[([^[\]]+)\])\s*$/);
        return (match?.[1] || match?.[2] || "").trim();
    };
    // A compound unit ("mg L", "µM/s") goes in brackets before a power or a division.
    const unitAtom = unit => (/^[\p{L}µ°%]+$/u.test(unit) ? unit : `(${unit})`);
    const perUnit = unit => (unit ? `${unitAtom(unit)}⁻¹` : "");

    // The numbers a researcher quotes for each model, with the units the axes give them: along x a half-life, Km and
    // EC50 (in x), a rate k (per x), a slope (y per x), an intercept and Vmax (in y). "t½ 1130" said nothing of hours,
    // and "k 0.198" nothing of "per hour".
    function describe(modelId, result, xUnit = "", yUnit = "") {
        const [a, b, c, d] = result.params;
        const withUnit = (text, unit) => (unit ? `${text} ${unit}` : text);
        const inX = text => withUnit(text, xUnit);
        const inY = text => withUnit(text, yUnit);
        const slopeUnit = yUnit && xUnit ? `${unitAtom(yUnit)}/${unitAtom(xUnit)}` : yUnit || perUnit(xUnit);
        const ci = i => `${formatNumber(result.ci[i][0])}–${formatNumber(result.ci[i][1])}`;
        const r2 = `R² ${Number.isFinite(result.r2) ? result.r2.toFixed(3) : "–"}`;
        if (modelId === "dose-response") {
            return `EC50 ${inX(formatNumber(10 ** c))} (${formatNumber(10 ** result.ci[2][0])}–${formatNumber(10 ** result.ci[2][1])}), Hill ${formatNumber(d)}, ${r2}`;
        }
        if (modelId === "linear") return `slope ${withUnit(formatNumber(a), slopeUnit)} (${ci(0)}), intercept ${inY(formatNumber(b))}, ${r2}`;
        if (modelId === "michaelis-menten") return `Vmax ${inY(formatNumber(a))} (${ci(0)}), Km ${inX(formatNumber(b))} (${ci(1)}), ${r2}`;
        return `k ${withUnit(formatNumber(c), perUnit(xUnit))} (${ci(2)}), t½ ${inX(formatNumber(Math.LN2 / c))}, ${r2}`;
    }

    function fitAll(data, rows) {
        const model = MODELS[data.model] || MODELS["dose-response"];
        const series = readSeries(rows);
        series.forEach(item => {
            if (model.needsPositiveX && item.points.some(p => p.x <= 0)) {
                throw new Error(`${item.name}: a dose-response fit needs doses above 0 (it works on log dose)`);
            }
            if (item.points.length <= model.names.length) {
                throw new Error(`${item.name}: ${model.names.length + 1} points at least are needed for this model`);
            }
            item.fit = fit(model, item.points);
            if (!item.fit.params.every(Number.isFinite)) throw new Error(`${item.name}: the fit did not converge`);
        });
        return { model, series };
    }

    // Log axis ticks: the powers of ten in range (and 2 and 5 times them when there are few decades).
    function logTicks(low, high) {
        const ticks = [];
        const first = Math.floor(Math.log10(low));
        const last = Math.ceil(Math.log10(high));
        const steps = last - first <= 2 ? [1, 2, 5] : [1];
        for (let power = first; power <= last; power++) {
            steps.forEach(step => {
                const value = step * 10 ** power;
                if (value >= low * 0.999 && value <= high * 1.001) ticks.push(value);
            });
        }
        return ticks;
    }

    SlideForgePlugins.register({
        id: "curve-fit",
        // 4: fitted values carry the axes' units (x, per x, y, y per x).
        version: "4",
        name: "Curve Fit",
        description: "Points with a fitted curve: dose-response (EC50), line, Michaelis–Menten or decay, with 95% intervals",
        icon: "fa-solid fa-chart-line",
        insert: { fill: true, category: "Statistics", label: "Curve fit (dose-response, EC50)", keywords: "curve fit regression dose response ec50 ic50 hill sigmoid logistic michaelis menten km vmax decay half-life linear" },
        defaultSize: { width: 480, height: 320 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            data: "Dose (µM),Drug A,Drug B\n0.01,2.1,1.5\n0.03,4.0,2.2\n0.1,11.8,4.1\n0.3,29.5,9.8\n1,58.2,24.6\n3,82.1,51.3\n10,93.6,77.9\n30,97.0,90.2",
            model: "dose-response",
            xScale: "auto",
            showFit: true,
            showParams: true,
            xLabel: "Dose (µM)",
            yLabel: "Response (%)",
            pointSize: 8,
            lineWidth: 2.5,
            fontSize: 16,
        },
        fields: [
            {
                key: "data",
                label: "Data",
                type: "table",
                rows: 8,
                placeholder: "Dose,Response\n0.1,5\n1,48\n10,95",
                hint: "x in the first column, then one column of y per series (a header row names them). Repeat an x for replicates.",
                summarize: rows => {
                    try {
                        const series = readSeries(rows);
                        return `${series.length} series, ${series.reduce((s, item) => s + item.points.length, 0)} points`;
                    } catch (_error) {
                        return "";
                    }
                },
            },
            {
                key: "model",
                label: "Model",
                type: "select",
                options: Object.entries(MODELS).map(([value, model]) => ({ value, label: model.label })),
            },
            {
                key: "xScale",
                label: "x axis",
                type: "select",
                options: [
                    { value: "auto", label: "Automatic (log for dose-response)" },
                    { value: "log", label: "Logarithmic" },
                    { value: "linear", label: "Linear" },
                ],
            },
            { key: "showFit", label: "Fit", checkboxLabel: "Draw the fitted curve", type: "checkbox" },
            { key: "showParams", label: "Values", checkboxLabel: "Show the fitted values in the legend", type: "checkbox" },
            { key: "xLabel", label: "x axis label", type: "text" },
            { key: "yLabel", label: "y axis label", type: "text" },
            { key: "pointSize", label: "Point size (px)", type: "number", min: 2, max: 16, step: 1 },
            { key: "lineWidth", label: "Line width (px)", type: "number", min: 0.5, max: 8, step: 0.5 },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 32, step: 1 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                data: String(data.data ?? ""),
                model: MODELS[data.model] ? data.model : "dose-response",
                xScale: ["auto", "log", "linear"].includes(data.xScale) ? data.xScale : "auto",
                showFit: data.showFit !== false,
                showParams: data.showParams !== false,
                xLabel: String(data.xLabel ?? "").slice(0, 80),
                yLabel: String(data.yLabel ?? "").slice(0, 80),
                pointSize: number(data.pointSize, 8, 2, 16),
                lineWidth: number(data.lineWidth, 2.5, 0.5, 8),
                fontSize: number(data.fontSize, 16, 8, 32),
            };
        },

        // Axis labels from a new table's header row, while they are still the example's (or the last header's):
        // "Dose (mg),Clearance" names the axes "Dose (mg)" and, for one series, "Clearance".
        onTableData(key, rows, data, previous) {
            if (key !== "data" || !rows.length) return null;
            const header = rows[0];
            if (numberOrNull(header[0]) !== null && header.slice(1).every(cell => numberOrNull(cell) !== null)) return null;
            const oldHeader = (typeof parsePluginTable === "function" ? parsePluginTable(previous.data)[0] : null) || [];
            const defaults = { xLabel: "Dose (µM)", yLabel: "Response (%)" };
            const automatic = (value, field, oldValue) => !value || value === defaults[field] || value === oldValue;
            const updates = {};
            if (header[0] && automatic(data.xLabel, "xLabel", oldHeader[0])) updates.xLabel = header[0];
            const series = header.slice(1).filter(Boolean);
            if (series.length === 1 && automatic(data.yLabel, "yLabel", oldHeader.length === 2 ? oldHeader[1] : null)) updates.yLabel = series[0];
            return updates;
        },

        // The fitted values with their 95% intervals, to read and quote.
        status(data) {
            if (typeof parsePluginTable !== "function") return "";
            try {
                const { series } = fitAll(data, parsePluginTable(data.data));
                return series.map(item => `${item.name}: ${describe(data.model, item.fit, unitOf(data.xLabel), unitOf(data.yLabel))}`).join("; ");
            } catch (_error) {
                return "";
            }
        },

        render(data, context) {
            const { model, series } = fitAll(data, context.parseTable(data.data));
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;
            const all = series.flatMap(item => item.points);
            const logX = data.xScale === "log" || (data.xScale === "auto" && data.model === "dose-response");
            if (logX && all.some(p => p.x <= 0)) throw new Error("A log x axis needs x values above 0");
            const xs = all.map(p => p.x);
            let xLow = Math.min(...xs);
            let xHigh = Math.max(...xs);
            if (logX) {
                xLow /= 1.6;
                xHigh *= 1.6;
            } else {
                const pad = (xHigh - xLow || 1) * 0.05;
                xLow = xLow >= 0 ? Math.max(0, xLow - pad) : xLow - pad;
                xHigh += pad;
            }
            const toX = x => (logX ? Math.log10(x) : x);
            // The y range covers the points and the curves.
            const curveSamples = 160;
            series.forEach(item => {
                item.curve = Array.from({ length: curveSamples + 1 }, (_, k) => {
                    const u = toX(xLow) + ((toX(xHigh) - toX(xLow)) * k) / curveSamples;
                    const x = logX ? 10 ** u : u;
                    return { x, y: model.f(item.fit.params, x) };
                }).filter(p => Number.isFinite(p.y));
            });
            const ys = [...all.map(p => p.y), ...(data.showFit ? series.flatMap(item => item.curve.map(p => p.y)) : [])];
            const yTicks = context.niceTicks(Math.min(...ys), Math.max(...ys), Math.max(3, Math.round(height / 60)));
            const yLow = yTicks.min;
            const yHigh = yTicks.max;
            const xTickValues = logX ? logTicks(xLow, xHigh) : context.niceTicks(xLow, xHigh, Math.max(3, Math.round(width / 90))).ticks.filter(t => t >= xLow && t <= xHigh);
            const format = value => String(Number(value.toPrecision(4)));
            const legendLines = series.map(item => (data.showParams ? `${item.name}: ${describe(data.model, item.fit, unitOf(data.xLabel), unitOf(data.yLabel))}` : item.name));
            const legendHeight = series.length > 1 || data.showParams ? legendLines.length * size * 1.35 + size * 0.4 : 0;
            const tickWidth = Math.max(...yTicks.ticks.map(t => context.measureText(format(t), { size, family: FONT })));
            const left = (data.yLabel ? size * 1.6 : 0) + tickWidth + size * 0.8;
            const right = size;
            const top = size * 0.6 + legendHeight;
            const bottom = size * (data.xLabel ? 2.9 : 1.8);
            const plotWidth = Math.max(40, width - left - right);
            const plotHeight = Math.max(40, height - top - bottom);
            const px = x => left + ((toX(x) - toX(xLow)) / (toX(xHigh) - toX(xLow))) * plotWidth;
            const py = y => top + plotHeight - ((y - yLow) / (yHigh - yLow)) * plotHeight;
            const parts = [];
            yTicks.ticks.forEach(t => {
                parts.push(`<line x1="${left}" x2="${left + plotWidth}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}" stroke="${ink}" stroke-opacity="0.1"/>`);
                parts.push(`<text x="${(left - size * 0.4).toFixed(1)}" y="${(py(t) + size * 0.32).toFixed(1)}" font-size="${size}" text-anchor="end" fill="${ink}">${format(t)}</text>`);
            });
            parts.push(`<path d="M${left} ${top}V${top + plotHeight}H${left + plotWidth}" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
            xTickValues.forEach(t => {
                parts.push(`<line x1="${px(t).toFixed(1)}" x2="${px(t).toFixed(1)}" y1="${top + plotHeight}" y2="${(top + plotHeight + size * 0.35).toFixed(1)}" stroke="${ink}"/>`);
                parts.push(`<text x="${px(t).toFixed(1)}" y="${(top + plotHeight + size * 1.35).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${format(t)}</text>`);
            });
            if (data.xLabel) parts.push(`<text x="${(left + plotWidth / 2).toFixed(1)}" y="${(height - size * 0.35).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.xLabel)}</text>`);
            if (data.yLabel) parts.push(`<text transform="translate(${(size * 0.95).toFixed(1)} ${(top + plotHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.yLabel)}</text>`);
            parts.push(`<clipPath id="fit-area"><rect x="${left}" y="${top - data.pointSize}" width="${plotWidth}" height="${plotHeight + data.pointSize * 2}"/></clipPath><g clip-path="url(#fit-area)">`);
            series.forEach((item, index) => {
                const color = OKABE_ITO[index % OKABE_ITO.length];
                if (data.showFit && item.curve.length > 1) {
                    parts.push(`<path class="fit-curve" d="M${item.curve.map(p => `${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join("L")}" fill="none" stroke="${color}" stroke-width="${data.lineWidth}"/>`);
                }
                item.points.forEach(p => {
                    parts.push(`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${(data.pointSize / 2).toFixed(1)}" fill="${color}" stroke="#ffffff" stroke-width="0.8"/>`);
                });
            });
            parts.push("</g>");
            if (legendHeight) {
                legendLines.forEach((text, index) => {
                    const yy = size * 0.2 + size * 1.05 + index * size * 1.35;
                    const color = OKABE_ITO[index % OKABE_ITO.length];
                    parts.push(`<line x1="${left}" x2="${(left + size * 1.2).toFixed(1)}" y1="${(yy - size * 0.32).toFixed(1)}" y2="${(yy - size * 0.32).toFixed(1)}" stroke="${color}" stroke-width="${data.lineWidth + 1}"/>`);
                    parts.push(`<text class="fit-legend" x="${(left + size * 1.6).toFixed(1)}" y="${yy.toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(text)}</text>`);
                });
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
