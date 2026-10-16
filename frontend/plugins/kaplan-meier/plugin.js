// Kaplan–Meier plugin: survival curves per group from a table of time, event (1 = event, 0 = censored) and an
// optional group. Step curves with censoring ticks, optional 95% confidence bands (Greenwood variance on the
// log(−log S) scale, as R's conf.type = "log-log"), median survival lines, a numbers-at-risk table under the axis
// and the log-rank test across the groups (χ² with k − 1 degrees of freedom).

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    const OKABE_ITO = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000", "#F0E442"];
    const Z95 = 1.959963984540054;

    function readSubjects(rows) {
        const subjects = [];
        rows.forEach((row, index) => {
            const [timeText = "", eventText = "", group = ""] = row;
            // A blank time is missing, not 0: Number("") is 0, and a half-filled row became an event at time zero.
            const blank = String(timeText).trim() === "";
            const time = blank ? NaN : Number(String(timeText).trim().replace(",", "."));
            if (index === 0 && !blank && !Number.isFinite(time)) return; // a header row
            if (blank) throw new Error(`Row ${index + 1}: the time is missing (enter 0 for time zero)`);
            const event = String(eventText).trim().toLowerCase();
            const happened = ["1", "true", "yes", "event", "dead", "died"].includes(event) ? 1 : ["0", "false", "no", "censored", "alive"].includes(event) ? 0 : null;
            if (!Number.isFinite(time) || time < 0 || happened === null) {
                throw new Error(`Row ${index + 1}: needs a time (0 or more) and an event (1 = event, 0 = censored)`);
            }
            subjects.push({ time, event: happened, group: String(group).trim() || "All" });
        });
        if (!subjects.length) throw new Error("Add rows: time, event (1/0) and, if you compare groups, a group");
        return subjects;
    }

    // The Kaplan–Meier estimate for one group: steps at each event time, with Greenwood's sum for the bands.
    function kaplanMeier(subjects) {
        const sorted = [...subjects].sort((a, b) => a.time - b.time);
        const times = [...new Set(sorted.map(s => s.time))];
        let atRisk = sorted.length;
        let survival = 1;
        let greenwood = 0;
        const steps = [{ time: 0, survival: 1, lower: 1, upper: 1 }];
        const censored = [];
        times.forEach(time => {
            const here = sorted.filter(s => s.time === time);
            const events = here.filter(s => s.event).length;
            if (events) {
                survival *= 1 - events / atRisk;
                greenwood += atRisk > events ? events / (atRisk * (atRisk - events)) : Infinity;
                let lower = NaN;
                let upper = NaN;
                if (survival > 0 && survival < 1 && Number.isFinite(greenwood)) {
                    const se = Math.sqrt(greenwood) / Math.abs(Math.log(survival));
                    lower = survival ** Math.exp(Z95 * se);
                    upper = survival ** Math.exp(-Z95 * se);
                }
                steps.push({ time, survival, lower, upper, atRisk, events });
            }
            here.filter(s => !s.event).forEach(() => censored.push({ time, survival }));
            atRisk -= here.length;
        });
        const medianStep = steps.find(step => step.survival <= 0.5);
        return { steps, censored, n: sorted.length, median: medianStep ? medianStep.time : null };
    }

    const atRiskAt = (subjects, time) => subjects.filter(s => s.time >= time).length;

    // ln Γ(x) (Lanczos), and the upper regularized incomplete gamma Q(a, x), for χ² p-values.
    function logGamma(x) {
        const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
        let y = x;
        const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
        let series = 1.000000000190015;
        c.forEach(v => (series += v / ++y));
        return -tmp + Math.log((2.5066282746310005 * series) / x);
    }
    function gammaQ(a, x) {
        if (x <= 0) return 1;
        if (x < a + 1) {
            let sum = 1 / a;
            let term = sum;
            for (let n = 1; n < 500; n++) {
                term *= x / (a + n);
                sum += term;
                if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
            }
            return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
        }
        let b = x + 1 - a;
        let c = 1 / 1e-300;
        let d = 1 / b;
        let h = d;
        for (let i = 1; i < 500; i++) {
            const an = -i * (i - a);
            b += 2;
            d = an * d + b;
            if (Math.abs(d) < 1e-300) d = 1e-300;
            c = b + an / c;
            if (Math.abs(c) < 1e-300) c = 1e-300;
            d = 1 / d;
            const delta = d * c;
            h *= delta;
            if (Math.abs(delta - 1) < 1e-15) break;
        }
        return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
    }

    // Solves A x = b (Gaussian elimination with partial pivoting).
    function solve(A, b) {
        const n = b.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let pivot = col;
            for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
            [M[col], M[pivot]] = [M[pivot], M[col]];
            if (Math.abs(M[col][col]) < 1e-12) return null;
            for (let r = 0; r < n; r++) {
                if (r === col) continue;
                const f = M[r][col] / M[col][col];
                for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
            }
        }
        return M.map((row, i) => row[n] / row[i]);
    }

    // The log-rank test: observed minus expected events per group, and its covariance, over all event times.
    function logRank(groups) {
        const k = groups.length;
        const all = groups.flatMap((group, g) => group.subjects.map(s => ({ ...s, g })));
        const times = [...new Set(all.filter(s => s.event).map(s => s.time))].sort((a, b) => a - b);
        const OminusE = new Array(k).fill(0);
        const V = Array.from({ length: k }, () => new Array(k).fill(0));
        times.forEach(time => {
            const n = groups.map((_, g) => all.filter(s => s.g === g && s.time >= time).length);
            const d = groups.map((_, g) => all.filter(s => s.g === g && s.time === time && s.event).length);
            const N = n.reduce((a, b) => a + b, 0);
            const D = d.reduce((a, b) => a + b, 0);
            if (N < 2) {
                if (N === 1) for (let g = 0; g < k; g++) OminusE[g] += d[g] - (D * n[g]) / N;
                return;
            }
            const factor = (D * (N - D)) / (N - 1);
            for (let g = 0; g < k; g++) {
                OminusE[g] += d[g] - (D * n[g]) / N;
                for (let h = 0; h < k; h++) V[g][h] += factor * (n[g] / N) * ((g === h ? 1 : 0) - n[h] / N);
            }
        });
        const df = k - 1;
        const x = solve(V.slice(0, df).map(row => row.slice(0, df)), OminusE.slice(0, df));
        if (!x) return null;
        const chi2 = x.reduce((sum, value, i) => sum + value * OminusE[i], 0);
        return { chi2, df, p: gammaQ(df / 2, chi2 / 2) };
    }

    const formatP = p => (p < 0.001 ? "p < 0.001" : `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`);

    SlideForgePlugins.register({
        id: "kaplan-meier",
        version: "5",
        name: "Kaplan–Meier Curve",
        description: "Survival curves per group with censoring marks, confidence bands, numbers at risk and the log-rank test",
        icon: "fa-solid fa-chart-line",
        insert: { fill: true, category: "Statistics", label: "Kaplan–Meier survival curve", keywords: "kaplan meier survival curve censoring log-rank hazard numbers at risk clinical" },
        defaultSize: { width: 560, height: 360 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            data:
                "Time,Event,Group\n6,1,6-MP\n6,1,6-MP\n6,1,6-MP\n6,0,6-MP\n7,1,6-MP\n9,0,6-MP\n10,1,6-MP\n10,0,6-MP\n11,0,6-MP\n13,1,6-MP\n16,1,6-MP\n17,0,6-MP\n19,0,6-MP\n20,0,6-MP\n22,1,6-MP\n23,1,6-MP\n25,0,6-MP\n32,0,6-MP\n32,0,6-MP\n34,0,6-MP\n35,0,6-MP\n" +
                "1,1,Placebo\n1,1,Placebo\n2,1,Placebo\n2,1,Placebo\n3,1,Placebo\n4,1,Placebo\n4,1,Placebo\n5,1,Placebo\n5,1,Placebo\n8,1,Placebo\n8,1,Placebo\n8,1,Placebo\n8,1,Placebo\n11,1,Placebo\n11,1,Placebo\n12,1,Placebo\n12,1,Placebo\n15,1,Placebo\n17,1,Placebo\n22,1,Placebo\n23,1,Placebo",
            xLabel: "Time (weeks)",
            yLabel: "Survival probability",
            percent: false,
            bands: true,
            censorMarks: true,
            medians: false,
            atRisk: true,
            logRank: true,
            fontSize: 16,
            lineWidth: 2,
        },
        fields: [
            { key: "data", label: "Data", type: "table", summarize: rows => {
                    const body = Number.isFinite(Number(String(rows[0][0]).trim())) && String(rows[0][0]).trim() !== "" ? rows : rows.slice(1);
                    const groups = new Set(body.map(row => String(row[2] ?? "").trim() || "All"));
                    const censored = body.filter(row => ["0", "false", "no", "censored", "alive"].includes(String(row[1] ?? "").trim().toLowerCase())).length;
                    return `${body.length} subjects in ${groups.size} group${groups.size === 1 ? "" : "s"}, ${censored} censored`;
                }, columns: ["Time", "Event (1/0)", "Group (optional)"], rows: 7, hint: "One row per subject. Event: 1 = event (death, relapse…), 0 = censored." },
            { key: "xLabel", label: "Time axis label", type: "text" },
            { key: "yLabel", label: "Survival axis label", type: "text" },
            { key: "percent", label: "Scale", checkboxLabel: "Survival in percent", type: "checkbox" },
            { key: "bands", label: "Confidence", checkboxLabel: "95% confidence bands (log–log)", type: "checkbox" },
            { key: "censorMarks", label: "Censoring", checkboxLabel: "Tick marks at censored times", type: "checkbox" },
            { key: "medians", label: "Medians", checkboxLabel: "Dashed lines at median survival", type: "checkbox" },
            { key: "atRisk", label: "Numbers at risk", checkboxLabel: "Table under the axis", type: "checkbox" },
            { key: "logRank", label: "Log-rank test", checkboxLabel: "Show the p-value (two or more groups)", type: "checkbox" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 28, step: 1 },
            { key: "lineWidth", label: "Line width (px)", type: "number", min: 0.5, max: 6, step: 0.5 },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                data: String(data.data ?? ""),
                xLabel: String(data.xLabel ?? "").slice(0, 80),
                yLabel: String(data.yLabel ?? "").slice(0, 80),
                percent: Boolean(data.percent),
                bands: data.bands !== false,
                censorMarks: data.censorMarks !== false,
                medians: Boolean(data.medians),
                atRisk: data.atRisk !== false,
                logRank: data.logRank !== false,
                fontSize: number(data.fontSize, 13, 8, 28),
                lineWidth: number(data.lineWidth, 2, 0.5, 6),
            };
        },

        render(data, context) {
            const subjects = readSubjects(context.parseTable(data.data));
            const names = [...new Set(subjects.map(s => s.group))].slice(0, 8);
            const groups = names.map((name, index) => {
                const members = subjects.filter(s => s.group === name);
                return { name, subjects: members, color: OKABE_ITO[index], ...kaplanMeier(members) };
            });
            const test = data.logRank && groups.length > 1 ? logRank(groups) : null;
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;
            const maxTime = Math.max(...subjects.map(s => s.time)) || 1;
            const xTicks = context.niceTicks(0, maxTime, Math.max(3, Math.round(width / 90)));
            const xMax = xTicks.max;
            const yTickValues = [0, 0.25, 0.5, 0.75, 1];
            const yText = v => (data.percent ? `${Math.round(v * 100)}` : String(v));
            const tickWidth = Math.max(...yTickValues.map(v => context.measureText(yText(v), { size, family: FONT })));
            const nameWidth = data.atRisk ? Math.max(...groups.map(g => context.measureText(g.name, { size, family: FONT }))) : 0;
            const left = Math.max((data.yLabel ? size * 1.6 : 0) + tickWidth + size * 0.7, nameWidth + size * 1.8);
            const right = size;
            let top = size * 0.8;
            const riskHeight = data.atRisk ? size * 1.5 * (groups.length + 1) : 0;
            const axisHeight = size * 1.6 + (data.xLabel ? size * 1.4 : 0);
            const plotWidth = Math.max(40, width - left - right);
            let plotHeight = Math.max(40, height - top - axisHeight - riskHeight);
            const x = t => left + (t / xMax) * plotWidth;
            const y = s => top + (1 - s) * plotHeight;

            // Legend with group sizes, and the log-rank result, in the corner of the plot the curves and their bands
            // cross least (fixed top right, it sat over a band). When every corner is crossed, it goes on a line above
            // the plot, which moves down to make room.
            const legend = groups.map(g => `${g.name} (n = ${g.n}${data.medians ? `, median ${g.median === null ? "not reached" : Number(g.median.toPrecision(4))}` : ""})`);
            const showLegend = groups.length > 1 || data.medians;
            const lines = [...(showLegend ? legend : []), ...(test ? [`Log-rank ${formatP(test.p)}`] : [])];
            let legendAt = null;
            const blockWidth = lines.length ? Math.max(...lines.map(text => context.measureText(text, { size, family: FONT }))) + (showLegend ? size * 1.6 : 0) : 0;
            const blockHeight = lines.length * size * 1.35 + (test && showLegend ? size * 0.2 : 0);
            if (lines.length) {
                const pad = size * 0.4;
                const corners = [
                    { right: true, top: true },
                    { right: true, top: false },
                    { right: false, top: false },
                    { right: false, top: true },
                ].map(corner => {
                    const x0 = corner.right ? left + plotWidth - pad - blockWidth : left + pad + size * 0.4;
                    const y0 = corner.top ? top + pad * 0.5 : top + plotHeight - pad - blockHeight;
                    return { ...corner, x0, y0 };
                });
                // What a group covers at time t: its curve, and its band when bands are drawn.
                const stepAt = (group, t) => {
                    let found = null;
                    for (const step of group.steps) {
                        if (step.time > t) break;
                        found = step;
                    }
                    return found;
                };
                const overlap = corner => {
                    let hits = 0;
                    for (let k = 0; k <= 16; k++) {
                        const px = corner.x0 + (blockWidth * k) / 16;
                        const t = ((px - left) / plotWidth) * xMax;
                        groups.forEach(group => {
                            const lastTime = Math.max(...group.subjects.map(s => s.time));
                            if (t < 0 || t > lastTime) return;
                            const step = stepAt(group, t);
                            if (!step) return;
                            const hi = data.bands && Number.isFinite(step.upper) ? Math.max(step.upper, step.survival) : step.survival;
                            const lo = data.bands && Number.isFinite(step.lower) ? Math.min(step.lower, step.survival) : step.survival;
                            const yTop = y(hi) - size * 0.3;
                            const yBottom = y(lo) + size * 0.3;
                            if (yTop < corner.y0 + blockHeight && yBottom > corner.y0) hits += data.bands ? 1 : 2;
                        });
                    }
                    return hits;
                };
                const best = corners.reduce((winner, corner) => (overlap(corner) < overlap(winner) ? corner : winner), corners[0]);
                if (overlap(best) > 0 && height - blockHeight - axisHeight - riskHeight > 120) {
                    legendAt = { x0: Math.max(left, left + plotWidth - blockWidth), y0: size * 0.2 };
                    top += blockHeight + size * 0.4;
                    plotHeight = Math.max(40, height - top - axisHeight - riskHeight);
                } else {
                    legendAt = best;
                }
            }
            const parts = [];
            // Grid and axes
            yTickValues.forEach(v => {
                parts.push(`<line x1="${left}" x2="${left + plotWidth}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${ink}" stroke-opacity="0.1"/>`);
                parts.push(`<text x="${(left - size * 0.4).toFixed(1)}" y="${(y(v) + size * 0.32).toFixed(1)}" font-size="${size}" text-anchor="end" fill="${ink}">${yText(v)}</text>`);
            });
            const axisY = top + plotHeight;
            parts.push(`<path d="M${left} ${top}V${axisY}H${left + plotWidth}" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
            xTicks.ticks.forEach(t => {
                parts.push(`<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${axisY}" y2="${(axisY + size * 0.35).toFixed(1)}" stroke="${ink}"/>`);
                parts.push(`<text x="${x(t).toFixed(1)}" y="${(axisY + size * 1.3).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${Number(t.toPrecision(6))}</text>`);
            });
            if (data.xLabel) parts.push(`<text x="${(left + plotWidth / 2).toFixed(1)}" y="${(axisY + size * 2.75).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.xLabel)}</text>`);
            if (data.yLabel) parts.push(`<text transform="translate(${(size * 0.95).toFixed(1)} ${(top + plotHeight / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.yLabel)}${data.percent ? " (%)" : ""}</text>`);

            groups.forEach(group => {
                const lastTime = Math.max(...group.subjects.map(s => s.time));
                // Bands: the confidence limits as steps, between event times.
                if (data.bands) {
                    const upper = [];
                    const lower = [];
                    group.steps.forEach((step, i) => {
                        const next = group.steps[i + 1]?.time ?? lastTime;
                        if (!Number.isFinite(step.lower) && i > 0) return;
                        const lo = i === 0 ? 1 : step.lower;
                        const hi = i === 0 ? 1 : step.upper;
                        upper.push(`${x(step.time).toFixed(1)} ${y(hi).toFixed(1)}`, `${x(next).toFixed(1)} ${y(hi).toFixed(1)}`);
                        lower.push(`${x(step.time).toFixed(1)} ${y(lo).toFixed(1)}`, `${x(next).toFixed(1)} ${y(lo).toFixed(1)}`);
                    });
                    if (upper.length > 2) parts.push(`<path d="M${upper.join("L")}L${lower.reverse().join("L")}Z" fill="${group.color}" fill-opacity="0.15"/>`);
                }
                let path = `M${x(0)} ${y(1)}`;
                group.steps.slice(1).forEach(step => {
                    path += `H${x(step.time).toFixed(1)}V${y(step.survival).toFixed(1)}`;
                });
                path += `H${x(lastTime).toFixed(1)}`;
                parts.push(`<path d="${path}" fill="none" stroke="${group.color}" stroke-width="${data.lineWidth}"/>`);
                if (data.censorMarks) {
                    group.censored.forEach(mark => {
                        parts.push(`<path d="M${x(mark.time).toFixed(1)} ${(y(mark.survival) - size * 0.35).toFixed(1)}v${(size * 0.7).toFixed(1)}" stroke="${group.color}" stroke-width="${Math.max(1, data.lineWidth * 0.75)}"/>`);
                    });
                }
                if (data.medians && group.median !== null) {
                    parts.push(`<path d="M${left} ${y(0.5).toFixed(1)}H${x(group.median).toFixed(1)}V${axisY}" fill="none" stroke="${group.color}" stroke-width="1" stroke-dasharray="4 3"/>`);
                }
            });

            if (legendAt) {
                const textX = legendAt.x0 + (showLegend ? size * 1.6 : 0);
                if (showLegend) {
                    legend.forEach((text, i) => {
                        const yy = legendAt.y0 + size * 1.05 + i * size * 1.35;
                        parts.push(`<line x1="${legendAt.x0.toFixed(1)}" x2="${(legendAt.x0 + size * 1.2).toFixed(1)}" y1="${(yy - size * 0.3).toFixed(1)}" y2="${(yy - size * 0.3).toFixed(1)}" stroke="${groups[i].color}" stroke-width="${data.lineWidth + 1}"/>`);
                        parts.push(`<text x="${textX.toFixed(1)}" y="${yy.toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(text)}</text>`);
                    });
                }
                if (test) {
                    const yy = legendAt.y0 + size * 1.05 + (lines.length - 1) * size * 1.35 + (showLegend ? size * 0.2 : 0);
                    parts.push(`<text x="${textX.toFixed(1)}" y="${yy.toFixed(1)}" font-size="${size}" fill="${ink}">Log-rank ${context.escapeXml(formatP(test.p))}</text>`);
                }
            }

            // Numbers at risk under the axis, one row per group, under the time ticks.
            if (data.atRisk) {
                const tableTop = axisY + axisHeight + size * 0.2;
                parts.push(`<text x="0" y="${(tableTop + size * 0.9).toFixed(1)}" font-size="${size}" font-weight="700" fill="${ink}">Number at risk</text>`);
                groups.forEach((group, i) => {
                    const yy = tableTop + size * 0.9 + (i + 1) * size * 1.4;
                    // The name in the text colour (vermilion text was 3.6:1 on white), with the group's colour beside it.
                    parts.push(`<rect x="0" y="${(yy - size * 0.55).toFixed(1)}" width="${(size * 0.5).toFixed(1)}" height="${(size * 0.5).toFixed(1)}" fill="${group.color}"/>`);
                    parts.push(`<text x="${(size * 0.7).toFixed(1)}" y="${yy.toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(group.name)}</text>`);
                    xTicks.ticks.forEach(t => {
                        parts.push(`<text x="${x(t).toFixed(1)}" y="${yy.toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${atRiskAt(group.subjects, t)}</text>`);
                    });
                });
            }
            const summary = groups.map(g => ({ name: g.name, n: g.n, median: g.median, steps: g.steps.map(s => [s.time, s.survival, s.lower, s.upper].map(v => (Number.isFinite(v) ? Number(v.toFixed(6)) : null))) }));
            // The numbers behind the drawing, kept as the picture's description (not drawn; used by the tests).
            const note = `<desc>${context.escapeXml(JSON.stringify({ groups: summary, test }))}</desc>`;
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${note}${parts.join("")}</svg>`;
        },
    });
})();
