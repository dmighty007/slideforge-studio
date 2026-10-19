// Ray optics plugin: the ray diagram of a thin lens or a spherical mirror. The image follows 1/f = 1/dₒ + 1/dᵢ and
// m = −dᵢ/dₒ (dᵢ > 0: a real image, on the far side of a lens or in front of a mirror). The three principal rays are
// traced with one rule: a ray meeting the element at height h leaves with its slope changed by −h/f (a mirror
// sends it back). Virtual images are found by the dashed backward extensions of the rays.

(() => {
    const FONT = "Arial, Helvetica, sans-serif";
    const RAY_COLORS = ["#D55E00", "#009E73", "#0072B2"];
    const KINDS = {
        "converging-lens": { lens: true, sign: 1, name: "Converging lens" },
        "diverging-lens": { lens: true, sign: -1, name: "Diverging lens" },
        "concave-mirror": { lens: false, sign: 1, name: "Concave mirror" },
        "convex-mirror": { lens: false, sign: -1, name: "Convex mirror" },
    };

    const format = value => {
        if (!Number.isFinite(value)) return "∞";
        return String(Number(value.toPrecision(3))).replace("-", "−");
    };

    // The image of an object at distance dₒ for focal length f (signed): distance dᵢ and magnification m.
    function imageOf(f, objectDistance) {
        const inverse = 1 / f - 1 / objectDistance;
        if (Math.abs(inverse) < 1e-12) return { distance: Infinity, magnification: Infinity };
        const distance = 1 / inverse;
        return { distance, magnification: -distance / objectDistance };
    }

    SlideForgePlugins.register({
        id: "ray-optics",
        version: "1",
        name: "Ray Diagram",
        description: "A thin lens or mirror with its principal rays and the image they form",
        icon: "fa-solid fa-eye",
        insert: { fill: true, category: "Physics & maths", label: "Ray diagram (lens or mirror)", keywords: "ray optics lens mirror focal length image object converging diverging concave convex physics" },
        defaultSize: { width: 560, height: 260 },
        sizeAware: true,
        askOnInsert: false,
        defaultData: { kind: "converging-lens", focalLength: 10, objectDistance: 25, objectHeight: 4, unit: "cm", labels: true, fontSize: 16 },
        fields: [
            {
                key: "kind",
                label: "Element",
                type: "select",
                options: Object.entries(KINDS).map(([value, kind]) => ({ value, label: kind.name })),
            },
            { key: "focalLength", label: "Focal length (size, no sign)", type: "number", min: 0.01, step: "any", hint: "Diverging lenses and convex mirrors get their negative sign from the element." },
            { key: "objectDistance", label: "Object distance", type: "number", min: 0.01, step: "any" },
            { key: "objectHeight", label: "Object height", type: "number", min: 0.01, step: "any" },
            { key: "unit", label: "Unit", type: "select", options: ["mm", "cm", "m", "none"] },
            { key: "labels", advanced: true, label: "Labels", checkboxLabel: "Show F, distances and magnification", type: "checkbox" },
            { key: "fontSize", advanced: true, label: "Text size (px)", type: "number", min: 8, max: 28, step: 1 },
        ],

        normalize(data) {
            const positive = (value, fallback) => {
                const parsed = Math.abs(Number(value));
                return Number.isFinite(parsed) && parsed > 0 ? Math.min(1e6, parsed) : fallback;
            };
            const fontSize = Number(data.fontSize);
            return {
                kind: Object.hasOwn(KINDS, data.kind) ? data.kind : "converging-lens",
                focalLength: positive(data.focalLength, 10),
                objectDistance: positive(data.objectDistance, 25),
                objectHeight: positive(data.objectHeight, 4),
                unit: ["mm", "cm", "m", "none"].includes(data.unit) ? data.unit : "cm",
                labels: data.labels !== false,
                fontSize: Number.isFinite(fontSize) ? Math.min(28, Math.max(8, fontSize)) : 13,
            };
        },

        render(data, context) {
            const kind = KINDS[data.kind];
            const f = kind.sign * data.focalLength;
            const d0 = data.objectDistance;
            const h0 = data.objectHeight;
            const image = imageOf(f, d0);
            const atInfinity = !Number.isFinite(image.distance);
            const real = !atInfinity && image.distance > 0;
            const h1 = atInfinity ? 0 : image.magnification * h0;
            // Where the image is drawn: a lens forms real images on the far side; a mirror in front.
            const imageX = atInfinity ? null : kind.lens ? image.distance : -image.distance;
            const unit = data.unit === "none" ? "" : ` ${data.unit}`;
            const { width, height } = context;
            const ink = context.textColor || "#111827";
            const size = data.fontSize;

            // World extent: object, image (unless far off), focal points (and C for mirrors), with a margin.
            const xs = [-d0, f, -f, 0];
            if (!kind.lens) xs.push(-2 * f);
            if (imageX !== null && Math.abs(imageX) < 8 * Math.max(d0, data.focalLength)) xs.push(imageX);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs, kind.lens ? 0 : data.focalLength * 0.4);
            const xPad = (xMax - xMin) * 0.12 || 1;
            const shownH1 = imageX !== null && xs.includes(imageX) ? Math.min(Math.abs(h1), h0 * 6) : 0;
            const yExtent = Math.max(h0, shownH1) * 1.35;
            const textRows = data.labels ? 2 : 0;
            const top = size * 0.6;
            const bottom = size * (0.6 + textRows * 1.35);
            const plotHeight = Math.max(40, height - top - bottom);
            const sx = x => ((x - (xMin - xPad)) / (xMax - xMin + 2 * xPad)) * width;
            const sy = y => top + plotHeight / 2 - (y / yExtent) * (plotHeight / 2);
            const parts = [];
            const line = (x1, y1, x2, y2, attrs) => `<line x1="${sx(x1).toFixed(1)}" y1="${sy(y1).toFixed(1)}" x2="${sx(x2).toFixed(1)}" y2="${sy(y2).toFixed(1)}" ${attrs}/>`;

            // Optical axis and the element
            parts.push(line(xMin - xPad, 0, xMax + xPad, 0, `stroke="${ink}" stroke-opacity="0.55" stroke-width="1"`));
            const elementHalf = yExtent * 0.92;
            if (kind.lens) {
                parts.push(line(0, -elementHalf, 0, elementHalf, `stroke="${ink}" stroke-width="2"`));
                const head = size * 0.55;
                const ends = [
                    [sy(elementHalf), kind.sign > 0 ? -1 : 1],
                    [sy(-elementHalf), kind.sign > 0 ? 1 : -1],
                ];
                ends.forEach(([y, direction]) => {
                    const x = sx(0);
                    // Converging: arrowheads point outwards (↕); diverging: inwards.
                    parts.push(`<path d="M${(x - head * 0.7).toFixed(1)} ${(y - direction * head).toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}L${(x + head * 0.7).toFixed(1)} ${(y - direction * head).toFixed(1)}" fill="none" stroke="${ink}" stroke-width="2"/>`);
                });
            } else {
                const bow = size * 0.9 * kind.sign; // concave ")": the middle further from the object
                const x = sx(0);
                const yTop = sy(elementHalf);
                const yBottom = sy(-elementHalf);
                parts.push(`<path d="M${(x - bow).toFixed(1)} ${yTop.toFixed(1)}Q${(x + bow).toFixed(1)} ${((yTop + yBottom) / 2).toFixed(1)} ${(x - bow).toFixed(1)} ${yBottom.toFixed(1)}" fill="none" stroke="${ink}" stroke-width="2.2"/>`);
                // Hatching on the back of the mirror
                for (let k = 0; k <= 8; k++) {
                    const y = yTop + ((yBottom - yTop) * k) / 8;
                    const t = (y - (yTop + yBottom) / 2) / ((yBottom - yTop) / 2);
                    const xOnCurve = x - bow + bow * (1 - t * t);
                    parts.push(`<line x1="${xOnCurve.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(xOnCurve + size * 0.5).toFixed(1)}" y2="${(y - size * 0.5).toFixed(1)}" stroke="${ink}" stroke-opacity="0.6"/>`);
                }
            }
            // Focal points (and centre of curvature for mirrors)
            const marks = kind.lens ? [[-f, "F"], [f, "F′"]] : [[-f, "F"], [-2 * f, "C"]];
            marks.forEach(([x, label]) => {
                parts.push(`<circle cx="${sx(x).toFixed(1)}" cy="${sy(0).toFixed(1)}" r="3" fill="${ink}"/>`);
                if (data.labels) parts.push(`<text x="${sx(x).toFixed(1)}" y="${(sy(0) + size * 1.2).toFixed(1)}" font-size="${size}" text-anchor="middle" fill="${ink}">${label}</text>`);
            });

            // Arrows for the object and the image
            const arrow = (x, y, color, dashed) => {
                const head = size * 0.5;
                const direction = y >= 0 ? 1 : -1;
                const tipY = sy(y);
                return (
                    `<line x1="${sx(x).toFixed(1)}" y1="${sy(0).toFixed(1)}" x2="${sx(x).toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="${color}" stroke-width="3"${dashed ? ' stroke-dasharray="6 4"' : ""}/>` +
                    `<path d="M${(sx(x) - head * 0.75).toFixed(1)} ${(tipY + direction * head).toFixed(1)}L${sx(x).toFixed(1)} ${tipY.toFixed(1)}L${(sx(x) + head * 0.75).toFixed(1)} ${(tipY + direction * head).toFixed(1)}Z" fill="${color}"/>`
                );
            };
            parts.push(arrow(-d0, h0, ink, false));

            // Principal rays: parallel to the axis, through the centre (lens) or vertex (mirror), through/towards F.
            const outgoingX = kind.lens ? xMax + xPad : xMin - xPad;
            const rays = [{ slope: 0 }, { slope: -h0 / d0 }];
            if (Math.abs(d0 - f) > 1e-9) rays.push({ slope: -h0 / (d0 - f) });
            const rayParts = [];
            rays.forEach((ray, index) => {
                const color = RAY_COLORS[index];
                const hitY = h0 + ray.slope * d0; // height where the ray meets the element (at x = 0)
                const out = ray.slope - hitY / f; // slope after the element, as if it went on through it
                // A mirror sends the ray back: direction (−1, out) instead of (1, out).
                const exitY = x => (kind.lens ? hitY + out * x : hitY - out * x);
                rayParts.push(line(-d0, h0, 0, hitY, `stroke="${color}" stroke-width="1.6"`));
                rayParts.push(line(0, hitY, outgoingX, exitY(outgoingX), `stroke="${color}" stroke-width="1.6"`));
                // Virtual image: the outgoing ray traced backwards (dashed) to where the image is.
                if (!atInfinity && !real) rayParts.push(line(0, hitY, imageX, exitY(imageX), `stroke="${color}" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity="0.85"`));
            });
            const yLimit = yExtent * 1.6;
            parts.push(`<clipPath id="rays"><rect x="0" y="${sy(yLimit).toFixed(1)}" width="${width}" height="${(sy(-yLimit) - sy(yLimit)).toFixed(1)}"/></clipPath><g clip-path="url(#rays)">${rayParts.join("")}</g>`);
            if (!atInfinity && xs.includes(imageX)) parts.push(arrow(imageX, Math.max(-yExtent * 1.2, Math.min(yExtent * 1.2, h1)), "#7c3aed", !real));

            if (data.labels) {
                const describe = atInfinity
                    ? "Image at infinity (the object is at the focal point)"
                    : `dᵢ = ${format(image.distance)}${unit} · m = ${format(image.magnification)} · ${real ? "real" : "virtual"}, ${image.magnification < 0 ? "inverted" : "upright"}, ${Math.abs(image.magnification) > 1 ? "magnified" : Math.abs(image.magnification) < 1 ? "reduced" : "same size"}`;
                parts.push(`<text x="4" y="${(height - size * 1.75).toFixed(1)}" font-size="${size}" fill="${ink}">${context.escapeXml(`${kind.name}: f = ${format(f)}${unit}, dₒ = ${format(d0)}${unit}, hₒ = ${format(h0)}${unit}`)}</text>`);
                parts.push(`<text x="4" y="${(height - size * 0.45).toFixed(1)}" font-size="${size}" font-weight="700" fill="${ink}">${context.escapeXml(describe)}</text>`);
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="${FONT}" data-image-distance="${atInfinity ? "Infinity" : image.distance}" data-magnification="${atInfinity ? "Infinity" : image.magnification}">${parts.join("")}</svg>`;
        },
    });
})();
