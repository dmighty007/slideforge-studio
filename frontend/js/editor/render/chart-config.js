// Charts: colours from the theme and the Chart.js settings the editor, thumbnails and exports all draw with.
// chartStyle (on the element) holds what the user set: legend position, axis titles, font size, grid lines and
// series colours. Charts had one series, fixed light-grey text and a white card on every theme.

const CHART_CATEGORY_COLORS = ["#4f7cff", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b"];

function _chartIsRound(chartType) {
    return chartType === "pie" || chartType === "doughnut";
}

function _chartHue(hex) {
    const match = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
    if (!match) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.08) return null; // grey: no hue to clash with
    const d = max - min;
    const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hue * 60 + 360) % 360;
}

// The theme accent first, then the category colours that do not look like it: the accent and the palette's own
// blue made the first two slices of a pie (or two series) the same blue.
function chartCategoryPalette(theme = getPresentationTheme()) {
    const accent = theme?.accentStrong || CHART_CATEGORY_COLORS[0];
    const accentHue = _chartHue(accent);
    const distinct = CHART_CATEGORY_COLORS.filter(color => {
        if (color.toLowerCase() === String(accent).toLowerCase()) return false;
        const hue = _chartHue(color);
        if (accentHue === null || hue === null) return true;
        const gap = Math.abs(hue - accentHue);
        return Math.min(gap, 360 - gap) >= 30;
    });
    return [accent, ...distinct];
}

// One series' paint: bars and lines one colour per series; pie and doughnut slices one colour each.
function chartSeriesColors(chartType, count, theme = getPresentationTheme(), seriesIndex = 0, pick = null) {
    const palette = chartCategoryPalette(theme);
    if (_chartIsRound(chartType)) {
        return {
            backgroundColor: Array.from({ length: count }, (_, index) => palette[index % palette.length]),
            borderColor: "#ffffff",
        };
    }
    const color = pick || palette[seriesIndex % palette.length];
    return { backgroundColor: chartType === "line" ? `${color}33` : color, borderColor: color };
}

// Sets every series' colours: the user's pick for a series if there is one, else the theme palette.
function applyChartSeriesColors(elData, theme = getPresentationTheme()) {
    const datasets = elData?.chartData?.datasets || [];
    const picks = elData?.chartStyle?.seriesColors || [];
    const count = elData?.chartData?.labels?.length || 0;
    datasets.forEach((dataset, index) => {
        Object.assign(dataset, chartSeriesColors(elData.chartType || "bar", count, theme, index, picks[index] || null));
        if ((elData.chartType || "bar") === "line") {
            dataset.pointBackgroundColor = dataset.borderColor;
            dataset.tension = dataset.tension ?? 0.25;
        }
    });
    return elData;
}

function _chartColorLuminance(color) {
    const value = String(color || "").trim();
    let rgb = null;
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const full = hex[1].length === 3 ? hex[1].split("").map(c => c + c).join("") : hex[1];
        rgb = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
    } else {
        const m = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/i);
        if (m && (m[4] === undefined || Number(m[4]) >= 0.5)) rgb = [m[1], m[2], m[3]].map(Number);
    }
    if (!rgb) return null;
    const lin = v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

// The colour of the chart's words and axes: dark on a light card, else the theme's text colour (on a see-through
// card or no card, what is behind is the slide).
function chartInkColor(elData, theme = getPresentationTheme()) {
    const cardLum = _chartColorLuminance(elData?.styles?.backgroundColor);
    if (cardLum !== null) return cardLum > 0.45 ? "#334155" : "#e2e8f0";
    return theme?.defaultTextColor || "#334155";
}

function _chartWithAlpha(color, alpha) {
    const hex = String(color).match(/^#([0-9a-f]{6})$/i);
    if (hex) {
        const [r, g, b] = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
}

// Error bars (chartStyle.errorBars): each series may hold a ± value per point in dataset.errors (SD, SEM or a
// confidence half-width, as the user entered it), drawn as a whisker with caps over the bar or point.
function chartHasErrorBars(elData) {
    if (!elData?.chartStyle?.errorBars || _chartIsRound(elData.chartType || "bar")) return false;
    return (elData.chartData?.datasets || []).some(dataset => (dataset.errors || []).some(value => Number(value) > 0));
}

function _chartErrorBarsPlugin(ink) {
    return {
        id: "sfErrorBars",
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const horizontal = chart.options.indexAxis === "y";
            chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                if (meta.hidden || !Array.isArray(dataset.errors)) return;
                const scale = chart.scales[horizontal ? meta.xAxisID : meta.yAxisID];
                if (!scale) return;
                meta.data.forEach((element, index) => {
                    const value = Number(dataset.data?.[index]);
                    const error = Math.abs(Number(dataset.errors[index]));
                    if (!Number.isFinite(value) || !(error > 0)) return;
                    const from = scale.getPixelForValue(value - error);
                    const to = scale.getPixelForValue(value + error);
                    const across = horizontal ? element.y : element.x;
                    const size = element.width || element.height || 20;
                    const cap = Math.max(4, Math.min(12, (horizontal ? element.height || size : element.width || size) * 0.25));
                    ctx.save();
                    ctx.strokeStyle = ink;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    if (horizontal) {
                        ctx.moveTo(from, across);
                        ctx.lineTo(to, across);
                        [from, to].forEach(x => {
                            ctx.moveTo(x, across - cap);
                            ctx.lineTo(x, across + cap);
                        });
                    } else {
                        ctx.moveTo(across, from);
                        ctx.lineTo(across, to);
                        [from, to].forEach(y => {
                            ctx.moveTo(across - cap, y);
                            ctx.lineTo(across + cap, y);
                        });
                    }
                    ctx.stroke();
                    ctx.restore();
                });
            });
        },
    };
}

// Values on the chart (chartStyle.valueLabels): a pie or doughnut shows each slice's share, as a talk needs (on by
// default there: a pie without numbers could not be read from the back of the room); bars and points show their value.
function chartShowsValueLabels(elData) {
    const setting = elData?.chartStyle?.valueLabels;
    if (setting === true || setting === false) return setting;
    return _chartIsRound(elData?.chartType || "bar");
}

function _chartNumberText(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const rounded = Math.abs(number) >= 100 ? Math.round(number) : Math.round(number * 10) / 10;
    return String(rounded);
}

function _chartValueLabelsPlugin(ink, font) {
    return {
        id: "sfValueLabels",
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const round = _chartIsRound(chart.config.type);
            const horizontal = chart.options.indexAxis === "y";
            ctx.save();
            ctx.font = `600 ${font.size}px ${font.family || "sans-serif"}`;
            const drawn = [];
            chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                if (meta.hidden) return;
                const values = (dataset.data || []).map(Number);
                const total = values.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0);
                meta.data.forEach((element, index) => {
                    const value = values[index];
                    if (!Number.isFinite(value) || chart.getDataVisibility?.(index) === false) return;
                    if (round) {
                        const share = total > 0 ? value / total : 0;
                        if (share < 0.04) return; // too thin a slice to hold its number
                        const angle = (element.startAngle + element.endAngle) / 2;
                        const radius = ((element.innerRadius || 0) + element.outerRadius) / 2 + (element.innerRadius ? 0 : element.outerRadius * 0.12);
                        const fill = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[index % dataset.backgroundColor.length] : dataset.backgroundColor;
                        const luminance = _chartColorLuminance(fill);
                        ctx.fillStyle = luminance !== null && luminance > 0.45 ? "#0f172a" : "#ffffff";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(`${Math.round(share * 100)}%`, element.x + Math.cos(angle) * radius, element.y + Math.sin(angle) * radius);
                        return;
                    }
                    const text = _chartNumberText(value);
                    if (!text || (value === 0 && chart.config.type === "bar")) return;
                    // Each number above its point (or below, or beside a horizontal bar), kept inside the plot and
                    // off the numbers already drawn: lines close together put theirs on top of each other.
                    const width = ctx.measureText(text).width;
                    const height = font.size;
                    const area = chart.chartArea;
                    const spots = horizontal
                        ? [[element.x + (value < 0 ? -6 - width : 6), element.y - height / 2]]
                        : (value < 0 ? [1, -1] : [-1, 1]).map(side => [element.x - width / 2, side < 0 ? element.y - 6 - height : element.y + 6]);
                    const spot = spots
                        .map(([x, y]) => [Math.max(area.left + 2, Math.min(area.right - width - 2, x)), Math.max(area.top - height, Math.min(area.bottom - height, y))])
                        .find(([x, y]) => !drawn.some(box => x < box.x + box.w && x + width > box.x && y < box.y + box.h && y + height > box.y));
                    if (!spot) return;
                    drawn.push({ x: spot[0], y: spot[1], w: width, h: height });
                    ctx.fillStyle = ink;
                    ctx.textAlign = "left";
                    ctx.textBaseline = "top";
                    ctx.fillText(text, spot[0], spot[1]);
                });
            });
            ctx.restore();
        },
    };
}

// A category label as lines of at most `maxChars` characters, broken between words (a word longer than a line stays
// whole); a label that fits stays a plain string.
function _wrapChartLabel(label, maxChars) {
    const text = String(label ?? "");
    if (text.length <= maxChars) return label;
    const lines = [];
    let line = "";
    text.split(/\s+/).filter(Boolean).forEach(word => {
        if (line && (line + " " + word).length > maxChars) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    });
    if (line) lines.push(line);
    return lines.length > 1 ? lines : label;
}

// The Chart.js settings for an element: its stored options, then the user's chart style, then colours that read on
// its background.
function buildChartJsConfig(elData, { forExport = false, theme = getPresentationTheme() } = {}) {
    const type = elData?.chartType || "bar";
    const round = _chartIsRound(type);
    const style = elData?.chartStyle || {};
    const ink = chartInkColor(elData, theme);
    const grid = _chartWithAlpha(ink.startsWith("#") ? ink : "#94a3b8", 0.16);
    const fontSize = Math.max(8, Math.min(40, Number(style.fontSize) || 12));
    const font = { size: fontSize, family: theme?.bodyFont || undefined };
    const options = JSON.parse(JSON.stringify(elData?.chartOptions || {}));
    options.responsive = !forExport;
    options.maintainAspectRatio = false;
    options.plugins = options.plugins || {};
    const legendPosition = style.legend || options.plugins.legend?.position || "top";
    options.plugins.legend = {
        ...(options.plugins.legend || {}),
        display: style.legend ? style.legend !== "none" : options.plugins.legend?.display !== false,
        position: legendPosition === "none" ? "top" : legendPosition,
        labels: { ...(options.plugins.legend?.labels || {}), color: ink, font },
    };
    if (style.title) {
        options.plugins.title = { display: true, text: style.title, color: ink, font: { ...font, size: fontSize + 3, weight: "700" } };
    }
    if (!round) {
        options.scales = options.scales || {};
        const axis = (key, title) => {
            const current = options.scales[key] || {};
            options.scales[key] = {
                ...current,
                ticks: { ...(current.ticks || {}), color: ink, font },
                grid: { ...(current.grid || {}), color: grid, display: style.grid === false ? false : current.grid?.display !== false },
                title: title ? { display: true, text: title, color: ink, font: { ...font, weight: "600" } } : { ...(current.title || {}), display: false },
            };
            if (key === "y" && current.beginAtZero === undefined) options.scales[key].beginAtZero = true;
        };
        axis("x", style.xTitle);
        axis("y", style.yTitle);
    }
    const errorBars = chartHasErrorBars(elData);
    if (errorBars) {
        // The value axis reaches the ends of the error bars.
        const datasets = elData.chartData.datasets || [];
        const ends = datasets.flatMap(dataset =>
            (dataset.data || []).flatMap((value, index) => {
                const error = Math.abs(Number(dataset.errors?.[index])) || 0;
                return Number.isFinite(Number(value)) ? [Number(value) - error, Number(value) + error] : [];
            }),
        );
        const valueKey = options.indexAxis === "y" ? "x" : "y";
        if (ends.length && options.scales?.[valueKey]) {
            options.scales[valueKey].suggestedMax = Math.max(...ends);
            if (Math.min(...ends) < 0) options.scales[valueKey].suggestedMin = Math.min(...ends);
        }
    }
    if (forExport) {
        options.animation = false;
        options.devicePixelRatio = 2;
    }
    // A series without colours (an imported or older deck, data set by hand) takes the theme palette rather than
    // Chart.js's grey-blue default, so it looks as it will after any edit or theme change.
    const data = JSON.parse(JSON.stringify(elData?.chartData || { labels: [], datasets: [] }));
    // Long category names wrap onto lines that fit their share of the axis (Chart.js takes a label as a list of
    // lines). Left on one line, they were slanted or squeezed and took the plot's room. Only the drawing: the data
    // keeps its labels.
    if (!round && Array.isArray(data.labels) && data.labels.length) {
        const width = parseFloat(elData?.width) || 600;
        const perLabel = (width - 80) / data.labels.length;
        const maxChars = Math.max(6, Math.floor(perLabel / (fontSize * 0.58)));
        data.labels = data.labels.map(label => _wrapChartLabel(label, maxChars));
    }
    (data.datasets || []).forEach((dataset, index) => {
        if (dataset.backgroundColor || dataset.borderColor) return;
        Object.assign(dataset, chartSeriesColors(elData.chartType || "bar", data.labels?.length || 0, getPresentationTheme(), index, elData?.chartStyle?.seriesColors?.[index] || null));
        if (type === "line") dataset.pointBackgroundColor = dataset.borderColor;
    });
    const valueLabels = chartShowsValueLabels(elData);
    if (valueLabels && !round) {
        // Room above the highest bar or point for its number.
        options.layout = { ...(options.layout || {}), padding: { ...(options.layout?.padding || {}), top: Math.round(fontSize * 1.4) } };
    }
    const plugins = [...(errorBars ? [_chartErrorBarsPlugin(ink)] : []), ...(valueLabels ? [_chartValueLabelsPlugin(ink, font)] : [])];
    return {
        type,
        data,
        options,
        ...(plugins.length ? { plugins } : {}),
    };
}

window.CHART_CATEGORY_COLORS = CHART_CATEGORY_COLORS;
window.chartCategoryPalette = chartCategoryPalette;
window.chartSeriesColors = chartSeriesColors;
window.applyChartSeriesColors = applyChartSeriesColors;
window.chartInkColor = chartInkColor;
window.buildChartJsConfig = buildChartJsConfig;
window.chartHasErrorBars = chartHasErrorBars;
window.chartShowsValueLabels = chartShowsValueLabels;
