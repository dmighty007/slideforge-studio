import { annotationToLegacyDrawing, normalizeAnnotationElements } from "../objects/objectMigrators.js";

function esc(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function strokeAttrs(style = {}, opacity = 1) {
    const width = Math.max(0.5, num(style.strokeWidth, 2));
    const dash =
        style.strokeStyle === "dashed"
            ? ` stroke-dasharray="${width * 5} ${width * 4}"`
            : style.strokeStyle === "dotted"
              ? ` stroke-dasharray="${width} ${width * 3}"`
              : "";
    return `stroke="${esc(style.strokeColor || "#1f2937")}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${dash}`;
}

function fillAttrs(style = {}) {
    const fill = style.fillStyle === "solid" && style.backgroundColor && style.backgroundColor !== "transparent" ? style.backgroundColor : "none";
    const opacity = fill === "none" ? 1 : style.fillOpacity ?? 0.35;
    return `fill="${esc(fill)}"${fill === "none" ? "" : ` fill-opacity="${opacity}"`}`;
}

function pathFromPoints(points = []) {
    if (!points.length) return "";
    if (points.length < 3) return points.map((p, i) => `${i ? "L" : "M"} ${num(p.x)} ${num(p.y)}`).join(" ");
    let d = `M ${num(points[0].x)} ${num(points[0].y)} `;
    for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        const next = points[i + 1];
        if (next) {
            d += `Q ${num(point.x)} ${num(point.y)} ${(num(point.x) + num(next.x)) / 2} ${(num(point.y) + num(next.y)) / 2} `;
        } else {
            d += `L ${num(point.x)} ${num(point.y)}`;
        }
    }
    return d.trim();
}

function renderLegacyDrawing(el) {
    if (!el) return "";
    const style = {
        strokeColor: el.strokeColor,
        backgroundColor: el.backgroundColor,
        fillStyle: el.fillStyle,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        fillOpacity: el.fillStyle === "solid" ? 0.5 : 0.28,
    };
    const opacity = el.opacity ?? 1;
    if (el.type === "freehand") {
        const d = pathFromPoints(el.points || []);
        if (!d) return "";
        const blend = el.blendMode === "multiply" ? ' style="mix-blend-mode:multiply"' : "";
        return `<path data-annotation-id="${esc(el.id)}" d="${esc(d)}" ${strokeAttrs(style, opacity)} fill="none"${blend}/>`;
    }
    if (el.type === "text") {
        const fontSize = num(el.fontSize, 22);
        const fontFamily = esc(el.fontFamily || "Comic Sans MS, Segoe Print, cursive");
        return String(el.text || "")
            .split("\n")
            .map((line, index) => `<text data-annotation-id="${esc(el.id)}" x="${num(el.x)}" y="${num(el.y) + index * fontSize * 1.25}" fill="${esc(el.strokeColor || "#1f2937")}" font-size="${fontSize}" font-family="${fontFamily}" opacity="${opacity}">${esc(line)}</text>`)
            .join("");
    }
    if (el.type !== "draw_shape") return "";
    const x = num(el.x);
    const y = num(el.y);
    const w = num(el.width);
    const h = num(el.height);
    const attrs = `${strokeAttrs(style, opacity)} ${fillAttrs(style)}`;
    if (el.shapeType === "rectangle") {
        const radius = Math.min(Math.abs(w), Math.abs(h), 64) * 0.18;
        return `<rect data-annotation-id="${esc(el.id)}" x="${Math.min(x, x + w)}" y="${Math.min(y, y + h)}" width="${Math.abs(w)}" height="${Math.abs(h)}" rx="${radius}" ${attrs}/>`;
    }
    if (el.shapeType === "ellipse") return `<ellipse data-annotation-id="${esc(el.id)}" cx="${x + w / 2}" cy="${y + h / 2}" rx="${Math.abs(w / 2)}" ry="${Math.abs(h / 2)}" ${attrs}/>`;
    if (el.shapeType === "line") return `<line data-annotation-id="${esc(el.id)}" x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${strokeAttrs(style, opacity)}/>`;
    if (el.shapeType === "curve" || el.shapeType === "curve_arrow") {
        const x2 = x + w;
        const y2 = y + h;
        const length = Math.max(1, Math.hypot(w, h));
        const cx = (x + x2) / 2 - (h / length) * length * 0.25;
        const cy = (y + y2) / 2 + (w / length) * length * 0.25;
        const stroke = strokeAttrs(style, opacity);
        const path = `<path data-annotation-id="${esc(el.id)}" d="M ${x} ${y} Q ${cx} ${cy} ${x2} ${y2}" ${stroke} fill="none"/>`;
        if (el.shapeType !== "curve_arrow") return path;
        return `${path}${arrowHead(x2, y2, Math.atan2(y2 - cy, x2 - cx), stroke)}`;
    }
    if (el.shapeType === "arrow") {
        const stroke = strokeAttrs(style, opacity);
        return `<line data-annotation-id="${esc(el.id)}" x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${stroke}/>${arrowHead(x + w, y + h, Math.atan2(h, w), stroke)}`;
    }
    const points =
        el.shapeType === "diamond"
            ? `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`
            : el.shapeType === "triangle"
              ? `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`
              : "";
    return points ? `<polygon data-annotation-id="${esc(el.id)}" points="${points}" ${attrs}/>` : "";
}

function arrowHead(x, y, angle, stroke) {
    const len = 16;
    const leftX = x - Math.cos(angle - Math.PI / 6) * len;
    const leftY = y - Math.sin(angle - Math.PI / 6) * len;
    const rightX = x - Math.cos(angle + Math.PI / 6) * len;
    const rightY = y - Math.sin(angle + Math.PI / 6) * len;
    return `<line x1="${x}" y1="${y}" x2="${leftX}" y2="${leftY}" ${stroke}/><line x1="${x}" y1="${y}" x2="${rightX}" y2="${rightY}" ${stroke}/>`;
}

export class SvgStaticRenderer {
    static renderNodes(elements = []) {
        return normalizeAnnotationElements(elements)
            .filter(el => el.visible !== false && el.presentation?.audienceVisible !== false)
            .map(annotation => renderLegacyDrawing(annotationToLegacyDrawing(annotation)))
            .join("");
    }

    static renderSvg(elements = [], slideWidth = 1024, slideHeight = 768, attrs = "") {
        return `<svg viewBox="0 0 ${slideWidth} ${slideHeight}" aria-hidden="true" ${attrs}>${this.renderNodes(elements)}</svg>`;
    }
}
