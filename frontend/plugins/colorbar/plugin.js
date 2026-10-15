// Colour bar plugin: a legend for a colour scale (viridis, magma, coolwarm…) with its range, ticks and label, to
// sit next to a heatmap, a map or a rendered image. The bar fills the object's box; labels keep their size.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const FONT = "Arial, Helvetica, sans-serif";
    // Colour scales as evenly spaced stops (matplotlib's perceptually uniform maps, sampled; RdBu and coolwarm
    // diverge around their middle). The heatmap plugin keeps a copy of this table.
    const COLORMAPS = {
        viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
        magma: ["#000004", "#180f3d", "#440f76", "#721f81", "#9e2f7f", "#cd4071", "#f1605d", "#fd9668", "#feca8d", "#fcfdbf"],
        plasma: ["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"],
        inferno: ["#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"],
        cividis: ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#fee838"],
        coolwarm: ["#3b4cc0", "#6282ea", "#8db0fe", "#b8d0f9", "#dddcdc", "#f5c4ad", "#f49a7b", "#de604d", "#b40426"],
        rdbu: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#fddbc7", "#f7f7f7", "#d1e5f0", "#92c5de", "#4393c3", "#2166ac", "#053061"],
        greys: ["#ffffff", "#d9d9d9", "#bdbdbd", "#969696", "#636363", "#252525", "#000000"],
    };
    const COLORMAP_OPTIONS = [
        { value: "viridis", label: "Viridis" },
        { value: "magma", label: "Magma" },
        { value: "plasma", label: "Plasma" },
        { value: "inferno", label: "Inferno" },
        { value: "cividis", label: "Cividis" },
        { value: "coolwarm", label: "Coolwarm (diverging)" },
        { value: "rdbu", label: "RdBu (diverging)" },
        { value: "greys", label: "Greys" },
    ];

    const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    // The colour at t (0…1) along a scale.
    function colorAt(name, t) {
        const stops = COLORMAPS[name] || COLORMAPS.viridis;
        const position = Math.min(1, Math.max(0, t)) * (stops.length - 1);
        const index = Math.min(stops.length - 2, Math.floor(position));
        const f = position - index;
        const [a, b] = [toRgb(stops[index]), toRgb(stops[index + 1])];
        return `#${a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, "0")).join("")}`;
    }

    const format = value => String(Number(value.toPrecision(6)));

    SlideForgePlugins.register({
        id: "colorbar",
        version: "1",
        name: "Colour Bar",
        description: "A colour scale legend (viridis, magma, coolwarm…) with range, ticks and label",
        icon: "fa-solid fa-palette",
        insert: { category: "Figures & references", label: "Colour bar", keywords: "colour color bar scale legend colormap viridis magma heatmap" },
        defaultSize: { width: 300, height: 70 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: { colormap: "viridis", min: 0, max: 1, ticks: 5, label: "", orientation: "horizontal", reverse: false, fontSize: 14, color: "" },
        fields: [
            { key: "colormap", label: "Colour scale", type: "select", options: COLORMAP_OPTIONS },
            { key: "min", label: "From", type: "number", step: "any" },
            { key: "max", label: "To", type: "number", step: "any" },
            { key: "ticks", label: "About this many ticks", type: "number", min: 2, max: 12, step: 1 },
            { key: "label", label: "Label", type: "text", placeholder: "e.g. Expression (log₂ TPM)" },
            {
                key: "orientation",
                label: "Direction",
                type: "select",
                options: [
                    { value: "horizontal", label: "Horizontal" },
                    { value: "vertical", label: "Vertical" },
                ],
            },
            { key: "reverse", label: "Order", checkboxLabel: "Reverse the colours", type: "checkbox" },
            { key: "fontSize", label: "Text size (px)", type: "number", min: 8, max: 32, step: 1 },
            { key: "color", label: "Text colour", type: "color", allowAuto: true },
        ],

        normalize(data) {
            const number = (value, fallback, min = -1e12, max = 1e12) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                colormap: Object.hasOwn(COLORMAPS, data.colormap) ? data.colormap : "viridis",
                min: number(data.min, 0),
                max: number(data.max, 1),
                ticks: Math.round(number(data.ticks, 5, 2, 12)),
                label: String(data.label ?? "").slice(0, 80),
                orientation: data.orientation === "vertical" ? "vertical" : "horizontal",
                reverse: Boolean(data.reverse),
                fontSize: number(data.fontSize, 14, 8, 32),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
            };
        },

        render(data, context) {
            if (!(data.max > data.min)) throw new Error("“To” must be larger than “From”");
            const { width, height } = context;
            const ink = HEX_COLOR.test(data.color) ? data.color : context.textColor || "#111827";
            const size = data.fontSize;
            const ticks = context.niceTicks(data.min, data.max, data.ticks).ticks.filter(t => t >= data.min - 1e-9 && t <= data.max + 1e-9);
            const stops = Array.from({ length: 17 }, (_, i) => {
                const t = i / 16;
                return `<stop offset="${(t * 100).toFixed(2)}%" stop-color="${colorAt(data.colormap, data.reverse ? 1 - t : t)}"/>`;
            }).join("");
            const parts = [];
            if (data.orientation === "horizontal") {
                const labelHeight = data.label ? size * 1.5 : 0;
                const tickHeight = size * 1.5;
                const half = Math.max(...ticks.map(t => context.measureText(format(t), { size: size * 0.9, family: FONT }))) / 2;
                const x0 = half + 2;
                const x1 = width - half - 2;
                const barHeight = Math.max(6, height - labelHeight - tickHeight - 2);
                parts.push(`<defs><linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>`);
                if (data.label) parts.push(`<text x="${width / 2}" y="${(size * 1.05).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.label)}</text>`);
                parts.push(`<rect x="${x0.toFixed(1)}" y="${labelHeight.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${barHeight.toFixed(1)}" fill="url(#bar)" stroke="${ink}" stroke-opacity="0.35"/>`);
                ticks.forEach(t => {
                    const x = x0 + ((t - data.min) / (data.max - data.min)) * (x1 - x0);
                    const y = labelHeight + barHeight;
                    parts.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y.toFixed(1)}" y2="${(y + size * 0.3).toFixed(1)}" stroke="${ink}"/>`);
                    parts.push(`<text x="${x.toFixed(1)}" y="${(y + size * 1.25).toFixed(1)}" font-size="${(size * 0.9).toFixed(1)}" text-anchor="middle" fill="${ink}">${format(t)}</text>`);
                });
            } else {
                const labelWidth = data.label ? size * 1.5 : 0;
                const tickWidth = Math.max(...ticks.map(t => context.measureText(format(t), { size: size * 0.9, family: FONT }))) + size * 0.6;
                const y0 = size * 0.6;
                const y1 = height - size * 0.6;
                const barWidth = Math.max(6, width - labelWidth - tickWidth - 2);
                // Top of a vertical bar is the high end.
                parts.push(`<defs><linearGradient id="bar" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient></defs>`);
                parts.push(`<rect x="0" y="${y0.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(y1 - y0).toFixed(1)}" fill="url(#bar)" stroke="${ink}" stroke-opacity="0.35"/>`);
                ticks.forEach(t => {
                    const y = y1 - ((t - data.min) / (data.max - data.min)) * (y1 - y0);
                    parts.push(`<line x1="${barWidth.toFixed(1)}" x2="${(barWidth + size * 0.3).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${ink}"/>`);
                    parts.push(`<text x="${(barWidth + size * 0.45).toFixed(1)}" y="${(y + size * 0.32).toFixed(1)}" font-size="${(size * 0.9).toFixed(1)}" fill="${ink}">${format(t)}</text>`);
                });
                if (data.label) {
                    parts.push(`<text transform="translate(${(width - size * 0.4).toFixed(1)} ${(height / 2).toFixed(1)}) rotate(-90)" font-size="${size}" text-anchor="middle" fill="${ink}">${context.escapeXml(data.label)}</text>`);
                }
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}">${parts.join("")}</svg>`;
        },
    });
})();
