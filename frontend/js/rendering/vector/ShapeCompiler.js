function clampPercent(value, fallback, min = 0, max = 100) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

export function parsePx(value, fallback = 0) {
    const number = Number.parseFloat(String(value ?? "").replace("px", ""));
    return Number.isFinite(number) ? number : fallback;
}

export function parseBorderShorthand(border = "") {
    const text = String(border || "").trim();
    if (!text || text === "none") return {};
    const widthMatch = text.match(/(?:^|\s)(\d*\.?\d+)px(?:\s|$)/i);
    const styleMatch = text.match(/\b(solid|dashed|dotted|double|none)\b/i);
    const color = text
        .replace(widthMatch?.[0] || "", " ")
        .replace(styleMatch?.[0] || "", " ")
        .trim();
    return {
        width: widthMatch ? Number(widthMatch[1]) : undefined,
        style: styleMatch ? styleMatch[1].toLowerCase() : undefined,
        color: color && color !== "0" ? color : undefined,
    };
}

export function compileShapeGeometry(element = {}) {
    const type = element.shapeType || "rectangle";
    const head = clampPercent(element.arrowHeadSize, 38, 12, 80);
    const shaft = clampPercent(element.arrowShaftSize, 36, 12, 90);
    const headStart = 100 - head;
    const headEnd = head;
    const shaftStart = (100 - shaft) / 2;
    const shaftEnd = 100 - shaftStart;
    const points = {
        triangle: [[50, 0], [100, 100], [0, 100]],
        diamond: [[50, 0], [100, 50], [50, 100], [0, 50]],
        hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
        parallelogram: [[20, 0], [100, 0], [80, 100], [0, 100]],
        "arrow-right": [[0, shaftStart], [headStart, shaftStart], [headStart, 0], [100, 50], [headStart, 100], [headStart, shaftEnd], [0, shaftEnd]],
        "arrow-left": [[headEnd, 0], [headEnd, shaftStart], [100, shaftStart], [100, shaftEnd], [headEnd, shaftEnd], [headEnd, 100], [0, 50]],
        "arrow-up": [[50, 0], [100, headEnd], [shaftEnd, headEnd], [shaftEnd, 100], [shaftStart, 100], [shaftStart, headEnd], [0, headEnd]],
        "arrow-down": [[shaftStart, 0], [shaftEnd, 0], [shaftEnd, headStart], [100, headStart], [50, 100], [0, headStart], [shaftStart, headStart]],
    };
    if (type === "circle") return { primitive: "ellipse" };
    if (points[type]) return { primitive: "polygon", points: points[type] };
    // The other fixed-outline shapes come from the editor's shape catalog.
    const catalogPoints = typeof window !== "undefined" ? window.SHAPE_POLYGONS?.[type] : null;
    if (catalogPoints) return { primitive: "polygon", points: catalogPoints };
    return { primitive: "rect" };
}

export function compileShapeStyle(element = {}) {
    const styles = element.styles || {};
    const border = parseBorderShorthand(styles.border);
    const strokeWidth = Math.max(0, parsePx(styles.borderWidth ?? border.width, 0));
    const strokeStyle = String(styles.borderStyle || border.style || "solid").toLowerCase();
    const stroke = String(styles.borderColor || border.color || "transparent").trim();
    return {
        fill: styles.backgroundColor || "transparent",
        stroke,
        strokeWidth,
        strokeStyle,
        radius: parsePx(styles.borderRadius, 0),
        opacity: Number(styles.opacity ?? element.opacity ?? 1),
        hasStroke: strokeWidth > 0 && strokeStyle !== "none" && stroke && !/^transparent$/i.test(stroke),
    };
}
