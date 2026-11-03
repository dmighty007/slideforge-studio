(() => {
    const defaults = {
        input: "equation", equation: "(x^2 - 1)^2 + y^2", csvFormat: "matrix",
        csv: "y/x,-2,-1,0,1,2\n-2,13,4,5,4,13\n-1,10,1,2,1,10\n0,9,0,1,0,9\n1,10,1,2,1,10\n2,13,4,5,4,13",
        xMin: -2, xMax: 2, yMin: -2, yMax: 2, resolution: 49,
        view: "both", shading: "smooth", colorBar: true, levels: 10, palette: "viridis", colorMin: "", colorMax: "", subtractMin: false,
        title: "Double-well landscape", xLabel: "x", yLabel: "y", valueLabel: "f(x, y)", fontSize: 14,
        yaw: -35, pitch: 40, zoom: 1, zScale: 1, panX: 0, panY: 0,
        lighting: true, axesBox: true, zeroPlane: true, compare: false, example: "custom", stage: "theme",
        comparison: "Narrow,exp(-4*(x^2+y^2))\nBroad,exp(-x^2-y^2)\nOscillatory,exp(-x^2-y^2)*cos(5x)",
    };
    const ensure = async context => {
        await context.loadScript("model.js");
        await context.loadScript("view.js");
        await context.loadScript("webgl.js");
        return window.SlideForgeLandscape;
    };
    const text = (v, fallback) => String(v ?? fallback).slice(0, 80);
    SlideForgePlugins.register({
        id: "landscape", version: "3", name: "Landscape Explorer", icon: "fa-solid fa-mountain",
        description: "Interactive WebGL surfaces, side-by-side comparisons, heatmaps and contours from CSV or equations. Includes a Wigner example; exports keep a still.",
        insert: { fill: true, category: "Physics & maths", label: "Landscape f(x, y)", keywords: "landscape free energy surface contours heatmap grid 2d 3d equation CSV wigner mayavi compare" },
        askOnInsert: false, sizeAware: true, defaultSize: { width: 640, height: 420 }, defaultData: defaults,
        fields: [
            { key: "example", label: "Example", type: "select", options: [{ value: "custom", label: "Current inputs" }, { value: "wigner", label: "Wigner: compare three surfaces" }], hint: "Loads an editable side-by-side example inspired by Mayavi, with shared height and color scales." },
            { key: "input", label: "Input", type: "select", options: [{ value: "equation", label: "Equation f(x, y)" }, { value: "csv", label: "CSV grid" }] },
            { key: "equation", label: "f(x, y)", type: "text", when: { input: "equation", compare: false }, hint: "Use x, y, pi, e, + − * / ^ and functions such as exp, ln, sin, sqrt. Undefined values become gaps." },
            { key: "csvFormat", label: "CSV layout", type: "select", when: { input: "csv" }, options: [{ value: "matrix", label: "Matrix: x across header, y down first column" }, { value: "xyz", label: "Rows: x, y, value (on a grid)" }] },
            { key: "csv", label: "Grid data", type: "table", rows: 6, when: { input: "csv" }, hint: "Up to 81 × 81 samples / 60 KB. Blank or NA values are gaps. Nonuniform coordinates are supported. Scattered-point interpolation is not included." },
            ...["xMin", "xMax", "yMin", "yMax"].map(key => ({ key, label: ({ xMin: "X minimum", xMax: "X maximum", yMin: "Y minimum", yMax: "Y maximum" })[key], type: "number", step: "any", when: { input: "equation" } })),
            { key: "resolution", label: "Samples per axis", type: "number", min: 9, max: 81, step: 2, when: { input: "equation" }, advanced: true },
            { key: "view", label: "View", type: "select", options: [{ value: "heatmap", label: "Heatmap" }, { value: "contours", label: "Contours" }, { value: "both", label: "Heatmap + contours" }, { value: "surface", label: "3D surface" }] },
            { key: "shading", label: "Heatmap shading", type: "select", when: { view: ["heatmap", "both"] }, options: [{ value: "smooth", label: "Smooth (interpolated, as the hover values)" }, { value: "cells", label: "Cells (one color per grid cell)" }] },
            { key: "compare", label: "Compare surfaces", type: "checkbox", when: { view: "surface", input: "equation" }, hint: "Place 2–4 equations in one scene, with one height scale and one color bar." },
            { key: "comparison", label: "Comparison equations", type: "table", columns: ["Label", "Equation"], rows: 4, when: { input: "equation", compare: true }, hint: "One CSV row per label,equation; at most four surfaces. Minimum subtraction uses one shared minimum." },
            { key: "palette", label: "Colors", type: "select", options: [{ value: "viridis", label: "Viridis" }, { value: "magma", label: "Magma" }, { value: "blue-red", label: "Blue–red (diverging)" }, { value: "rainbow", label: "Rainbow (Mayavi style)" }] },
            { key: "colorBar", label: "Show color bar", type: "checkbox", hint: "Hide it when the colors need no scale, or another plot on the slide shows it. Hidden, its space goes to the plot." },
            { key: "lighting", label: "Smooth lighting", type: "checkbox", when: { view: "surface" }, hint: "Depth-tested WebGL shading; turn off to compare unshaded scalar colors." },
            { key: "stage", label: "Plot background", type: "select", options: [{ value: "theme", label: "Follow slide theme" }, { value: "slate", label: "Slate (scientific view)" }] },
            { key: "axesBox", label: "3D axes and outline", type: "checkbox", when: { view: "surface" } },
            { key: "zeroPlane", label: "Show zero plane", type: "checkbox", when: { view: "surface" }, hint: "Retains the sign of values; useful for interference surfaces with positive and negative regions." },
            { key: "subtractMin", label: "Subtract minimum", type: "checkbox", hint: "Display values relative to the sampled minimum; source data is unchanged. No probability-to-energy conversion is applied." },
            { key: "levels", label: "Contour levels", type: "number", min: 2, max: 24, when: { view: ["both", "contours"] } },
            { key: "title", label: "Title", type: "text" },
            { key: "xLabel", label: "X axis / units", type: "text" }, { key: "yLabel", label: "Y axis / units", type: "text" },
            { key: "valueLabel", label: "Value / energy units", type: "text" },
            { key: "colorMin", label: "Color minimum (blank = automatic)", type: "text", advanced: true },
            { key: "colorMax", label: "Color maximum (blank = automatic)", type: "text", advanced: true },
            { key: "fontSize", label: "Label size", type: "number", min: 10, max: 22, advanced: true },
            { key: "yaw", label: "Surface rotation (degrees)", type: "number", min: -360, max: 360, when: { view: "surface" }, advanced: true },
            { key: "pitch", label: "Surface tilt (degrees)", type: "number", min: -85, max: 85, when: { view: "surface" }, advanced: true },
            { key: "zoom", label: "Surface zoom", type: "number", min: 0.25, max: 4, step: 0.1, when: { view: "surface" }, advanced: true },
            { key: "panX", label: "Horizontal pan", type: "number", min: -1, max: 1, step: 0.05, when: { view: "surface" }, advanced: true },
            { key: "panY", label: "Vertical pan", type: "number", min: -1, max: 1, step: 0.05, when: { view: "surface" }, advanced: true },
            { key: "zScale", label: "Height exaggeration", type: "number", min: 0.1, max: 2.5, step: 0.1, when: { view: "surface" }, advanced: true },
        ],
        normalize(raw) {
            const d = { ...defaults, ...raw };
            const number = (key, min, max) => { const v = Number(d[key]); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : defaults[key]; };
            return {
                input: d.input === "csv" ? "csv" : "equation", equation: String(d.equation ?? defaults.equation).slice(0, 501),
                csvFormat: d.csvFormat === "xyz" ? "xyz" : "matrix", csv: String(d.csv ?? "").slice(0, 60000),
                xMin: number("xMin", -1e9, 1e9), xMax: number("xMax", -1e9, 1e9), yMin: number("yMin", -1e9, 1e9), yMax: number("yMax", -1e9, 1e9),
                resolution: Math.round(number("resolution", 9, 81)), view: ["heatmap", "contours", "both", "surface"].includes(d.view) ? d.view : "both", shading: d.shading === "cells" ? "cells" : "smooth", colorBar: d.colorBar !== false,
                levels: Math.round(number("levels", 2, 24)), palette: ["viridis", "magma", "blue-red", "rainbow"].includes(d.palette) ? d.palette : "viridis",
                subtractMin: d.subtractMin === true, colorMin: String(d.colorMin ?? "").trim().slice(0, 40), colorMax: String(d.colorMax ?? "").trim().slice(0, 40),
                title: text(d.title, defaults.title), xLabel: text(d.xLabel, "x"), yLabel: text(d.yLabel, "y"), valueLabel: text(d.valueLabel, "value"),
                fontSize: number("fontSize", 10, 22), yaw: number("yaw", -360, 360), pitch: number("pitch", -85, 85), zoom: number("zoom", 0.25, 4), zScale: number("zScale", 0.1, 2.5), panX: number("panX", -1, 1), panY: number("panY", -1, 1),
                lighting: d.lighting !== false, axesBox: d.axesBox !== false, zeroPlane: d.zeroPlane !== false, compare: d.compare === true && d.input === "equation" && d.view === "surface", comparison: String(d.comparison ?? defaults.comparison).slice(0, 3000), example: d.example === "wigner" ? "wigner" : "custom", stage: d.stage === "slate" ? "slate" : "theme",
            };
        },
        async render(data, context) {
            const api = await ensure(context), scene = api.scene(data, api.dataset(data, context.parseTable), context);
            if (data.view === "surface") {
                const png = api.snapshot(scene);
                if (png.length > 1500000) throw Error("This view is too detailed to save. Use fewer samples or a smaller object.");
                return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><image width="${scene.width}" height="${scene.height}" href="${png}"/></svg>`;
            }
            const svg = api.svg(scene);
            if (encodeURIComponent(svg).length < 1500000) return svg;
            // Dense contours/meshes can exceed the saved-preview budget. Keep the same scene as a compact bitmap
            // inside an SVG, rather than silently dropping its fallback on save or clipping scientific detail.
            const canvas = document.createElement("canvas"); api.paint(canvas, scene);
            const png = canvas.toDataURL("image/png");
            if (png.length > 1500000) throw Error("This view is too detailed to save. Use fewer samples/contour levels or a smaller CSV grid.");
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><image width="${scene.width}" height="${scene.height}" href="${png}"/></svg>`;
        },
        async prepare(data, previous, context) {
            if (data.example !== "wigner" || previous?.example === "wigner") return data;
            const api = await ensure(context); return { ...data, ...api.wignerPreset() };
        },
        async mount(host, data, context) { const api = await ensure(context); if (context.signal.aborted) return; return api.mount(host, data, context); },
    });
})();
