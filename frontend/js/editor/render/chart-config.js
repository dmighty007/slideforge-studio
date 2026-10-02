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
    if (forExport) {
        options.animation = false;
        options.devicePixelRatio = 2;
    }
    return {
        type,
        data: JSON.parse(JSON.stringify(elData?.chartData || { labels: [], datasets: [] })),
        options,
    };
}

window.CHART_CATEGORY_COLORS = CHART_CATEGORY_COLORS;
window.chartCategoryPalette = chartCategoryPalette;
window.chartSeriesColors = chartSeriesColors;
window.applyChartSeriesColors = applyChartSeriesColors;
window.chartInkColor = chartInkColor;
window.buildChartJsConfig = buildChartJsConfig;
