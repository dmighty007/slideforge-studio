// Scale bar plugin: a bar with its length ("10 µm") for micrographs, maps and diagrams. The bar spans the object's
// box: put the object over the picture and size it to the length the label states (for example, across a feature
// of known size). The label and line thickness stay the same size whatever the box.

(() => {
    const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
    const UNITS = ["pm", "Å", "nm", "µm", "mm", "cm", "m", "km", "px"];
    const BACKINGS = { none: null, dark: "rgba(15, 23, 42, 0.62)", light: "rgba(255, 255, 255, 0.82)" };

    const escapeXml = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

    // 10 → "10", 0.5 → "0.5", 2500 → "2500" (no float noise such as 0.30000000000000004).
    const formatNumber = value => String(Number(value.toPrecision(6)));

    SlideForgePlugins.register({
        id: "scale-bar",
        version: "1",
        name: "Scale Bar",
        description: "A scale bar with its length, for micrographs, maps and diagrams",
        icon: "fa-solid fa-ruler-horizontal",
        insert: { label: "Scale bar", keywords: "scale bar micrograph microscopy length um nm map" },
        defaultSize: { width: 200, height: 48 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: {
            length: 10,
            unit: "µm",
            label: "",
            color: "",
            thickness: 6,
            fontSize: 18,
            labelPosition: "above",
            endTicks: false,
            backing: "none",
        },
        fields: [
            { key: "length", label: "Length", type: "number", min: 0, step: "any", hint: "Size the box so the bar matches this length on the picture." },
            { key: "unit", label: "Unit", type: "select", options: UNITS },
            { key: "label", label: "Label", type: "text", placeholder: "Automatic, e.g. 10 µm" },
            { key: "color", label: "Colour", type: "color", allowAuto: true },
            { key: "thickness", label: "Bar thickness (px)", type: "number", min: 1, max: 40, step: 1 },
            { key: "fontSize", label: "Label size (px)", type: "number", min: 6, max: 72, step: 1 },
            {
                key: "labelPosition",
                label: "Label",
                type: "select",
                options: [
                    { value: "above", label: "Above the bar" },
                    { value: "below", label: "Below the bar" },
                    { value: "none", label: "No label" },
                ],
            },
            { key: "endTicks", label: "Ends", checkboxLabel: "End ticks", type: "checkbox" },
            {
                key: "backing",
                label: "Backing",
                type: "select",
                options: [
                    { value: "none", label: "None" },
                    { value: "dark", label: "Dark box (light bar)" },
                    { value: "light", label: "Light box (dark bar)" },
                ],
            },
        ],

        normalize(data) {
            const number = (value, fallback, min, max) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
            };
            return {
                length: number(data.length, 10, 0, 1e9),
                unit: UNITS.includes(data.unit) ? data.unit : "µm",
                label: String(data.label ?? "").trim().slice(0, 40),
                color: HEX_COLOR.test(String(data.color || "")) ? data.color : "",
                thickness: number(data.thickness, 6, 1, 40),
                fontSize: number(data.fontSize, 18, 6, 72),
                labelPosition: ["above", "below", "none"].includes(data.labelPosition) ? data.labelPosition : "above",
                endTicks: Boolean(data.endTicks),
                backing: Object.hasOwn(BACKINGS, data.backing) ? data.backing : "none",
            };
        },

        render(data, context) {
            const { width, height } = context;
            const backing = BACKINGS[data.backing];
            const ink = HEX_COLOR.test(data.color)
                ? data.color
                : data.backing === "dark"
                  ? "#ffffff"
                  : data.backing === "light"
                    ? "#111827"
                    : context.textColor || "#111827";
            const label = data.labelPosition === "none" ? "" : data.label || `${formatNumber(data.length)} ${data.unit}`;
            const pad = backing ? Math.max(4, Math.round(data.fontSize * 0.4)) : 0;
            const tick = data.endTicks ? Math.max(data.thickness * 1.6, data.fontSize * 0.5) : 0;
            const gap = Math.round(data.fontSize * 0.3);
            const textHeight = label ? data.fontSize : 0;
            const contentHeight = Math.max(data.thickness, tick) + (label ? gap + textHeight : 0);
            // Centred vertically in the box.
            const top = Math.max(pad, (height - contentHeight) / 2);
            const barCenterY = data.labelPosition === "above" && label ? top + textHeight + gap + Math.max(data.thickness, tick) / 2 : top + Math.max(data.thickness, tick) / 2;
            const x0 = pad;
            const x1 = Math.max(pad + 1, width - pad);
            const parts = [];
            if (backing) parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="${Math.min(10, height / 4)}" fill="${backing}"/>`);
            parts.push(`<rect x="${x0}" y="${barCenterY - data.thickness / 2}" width="${x1 - x0}" height="${data.thickness}" fill="${ink}"/>`);
            if (tick) {
                const w = Math.max(1.5, data.thickness / 2.5);
                [x0, x1 - w].forEach(x => parts.push(`<rect x="${x}" y="${barCenterY - tick / 2}" width="${w}" height="${tick}" fill="${ink}"/>`));
            }
            if (label) {
                const y = data.labelPosition === "above" ? barCenterY - Math.max(data.thickness, tick) / 2 - gap : barCenterY + Math.max(data.thickness, tick) / 2 + gap + textHeight * 0.8;
                parts.push(
                    `<text x="${width / 2}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${data.fontSize}" font-weight="700" fill="${ink}" text-anchor="middle">${escapeXml(label)}</text>`,
                );
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
        },
    });
})();
