export class ExportManager {
    static esc(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    static commonAttrs(el) {
        const strokeColor = el.strokeColor || "#000";
        const strokeWidth = Math.max(1, Math.min(50, el.strokeWidth || 2));
        const opacity = el.opacity ?? 1;
        const dash =
            el.strokeStyle === "dashed"
                ? ' stroke-dasharray="10 8"'
                : el.strokeStyle === "dotted"
                  ? ' stroke-dasharray="2 7"'
                  : "";
        return `stroke="${this.esc(strokeColor)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"${dash}`;
    }

    static fillAttrs(el) {
        if (el.fillStyle === "none" || !el.backgroundColor || el.backgroundColor === "transparent") return 'fill="none"';
        const opacity = el.fillStyle === "solid" ? 0.58 : 0.35;
        return `fill="${this.esc(el.backgroundColor)}" fill-opacity="${opacity}"`;
    }

    static distance(a, b) {
        return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
    }

    static pointToward(from, to, distance) {
        const length = Math.max(0.001, this.distance(from, to));
        const t = Math.max(0, Math.min(1, distance / length));
        return {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
        };
    }

    static roundedPolygonPath(points, radius = 0) {
        if (!Array.isArray(points) || points.length < 2) return "";
        const r = Math.max(0, Number(radius) || 0);
        if (points.length < 3 || r <= 0) {
            const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
            points.slice(1).forEach(point => commands.push(`L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`));
            if (points.length > 2) commands.push("Z");
            return commands.join(" ");
        }

        const commands = [];
        points.forEach((point, index) => {
            const prev = points[(index - 1 + points.length) % points.length];
            const next = points[(index + 1) % points.length];
            const cornerRadius = Math.min(r, this.distance(point, prev) * 0.42, this.distance(point, next) * 0.42);
            const start = this.pointToward(point, prev, cornerRadius);
            const end = this.pointToward(point, next, cornerRadius);
            commands.push(`${index === 0 ? "M" : "L"} ${start.x.toFixed(1)} ${start.y.toFixed(1)}`);
            commands.push(`Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`);
        });
        commands.push("Z");
        return commands.join(" ");
    }

    static generateSVG(elements, viewport, slideWidth = 1024, slideHeight = 768) {
        if (Array.isArray(elements) && elements.some(el => Number(el?.schemaVersion) >= 2)) {
            const normalized = elements.map(el => {
                if (!(Number(el?.schemaVersion) >= 2)) return el;
                const style = el.style || {};
                const geometry = el.geometry || {};
                const common = {
                    id: el.id,
                    strokeColor: style.strokeColor,
                    backgroundColor: style.backgroundColor,
                    fillStyle: style.fillStyle,
                    strokeWidth: style.strokeWidth,
                    strokeStyle: style.strokeStyle,
                    opacity: el.opacity ?? style.opacity,
                    role: el.role,
                };
                if (["stroke", "highlightStroke", "freeformPath", "laserTrail", "gesture"].includes(el.kind)) {
                    return { ...common, type: "freehand", points: geometry.points || [] };
                }
                if (["label", "sticky"].includes(el.kind)) {
                    return { ...common, type: "text", x: geometry.x, y: geometry.y, text: geometry.text, fontSize: style.fontSize, fontFamily: style.fontFamily };
                }
                return {
                    ...common,
                    type: "draw_shape",
                    shapeType: geometry.shapeType || (el.kind === "arrow" ? "arrow" : "rectangle"),
                    x: geometry.x,
                    y: geometry.y,
                    width: geometry.width,
                    height: geometry.height,
                };
            });
            return this.generateSVG(normalized, viewport, slideWidth, slideHeight);
        }
        if (!elements || elements.length === 0) {
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${slideWidth} ${slideHeight}" width="100%" height="100%"><rect width="100%" height="100%" fill="white"/></svg>`;
        }

        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${slideWidth} ${slideHeight}" width="100%" height="100%">`;
        svgContent += `<rect width="100%" height="100%" fill="white"/>`;
        svgContent += `<g transform="translate(${viewport.panX || 0}, ${viewport.panY || 0}) scale(${viewport.zoom || 1})">`;

        for (let el of elements) {
            try {
                if (el.type === "freehand" && el.points && el.points.length >= 2) {
                    let d = `M ${el.points[0].x.toFixed(1)} ${el.points[0].y.toFixed(1)} `;
                    for (let i = 1; i < el.points.length; i++) {
                        const point = el.points[i];
                        if (i < el.points.length - 1) {
                            const next = el.points[i + 1];
                            d += `Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${((point.x + next.x) / 2).toFixed(1)} ${((point.y + next.y) / 2).toFixed(1)} `;
                        } else {
                            d += `L ${point.x.toFixed(1)} ${point.y.toFixed(1)} `;
                        }
                    }
                    svgContent += `<path d="${d.trim()}" fill="none" ${this.commonAttrs(el)} />`;
                } else if (el.type === "text") {
                    const lines = String(el.text || "").split("\n");
                    svgContent += `<text x="${el.x.toFixed(1)}" y="${el.y.toFixed(1)}" fill="${this.esc(el.strokeColor || "#000")}" font-size="${el.fontSize || 22}" font-family="Comic Sans MS, Segoe Print, cursive" opacity="${el.opacity ?? 1}">`;
                    lines.forEach((line, index) => {
                        svgContent += `<tspan x="${el.x.toFixed(1)}" dy="${index === 0 ? 0 : (el.fontSize || 22) * 1.25}">${this.esc(line)}</tspan>`;
                    });
                    svgContent += `</text>`;
                } else if (el.type === "draw_shape" && el.shapeType) {
                    if (el.shapeType === "rectangle") {
                        const radius = Math.min(Math.abs(el.width), Math.abs(el.height), 64) * 0.18;
                        svgContent += `<rect x="${el.x.toFixed(1)}" y="${el.y.toFixed(1)}" width="${el.width.toFixed(1)}" height="${el.height.toFixed(1)}" rx="${radius.toFixed(1)}" ${this.fillAttrs(el)} ${this.commonAttrs(el)} />`;
                    } else if (el.shapeType === "diamond") {
                        const points = [
                            { x: el.x + el.width / 2, y: el.y },
                            { x: el.x + el.width, y: el.y + el.height / 2 },
                            { x: el.x + el.width / 2, y: el.y + el.height },
                            { x: el.x, y: el.y + el.height / 2 },
                        ];
                        const radius = Math.min(Math.abs(el.width), Math.abs(el.height)) * 0.075;
                        svgContent += `<path d="${this.roundedPolygonPath(points, radius)}" ${this.fillAttrs(el)} ${this.commonAttrs(el)} />`;
                    } else if (el.shapeType === "ellipse") {
                        const cx = (el.x + el.width / 2).toFixed(1);
                        const cy = (el.y + el.height / 2).toFixed(1);
                        svgContent += `<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(el.width / 2).toFixed(1)}" ry="${Math.abs(el.height / 2).toFixed(1)}" ${this.fillAttrs(el)} ${this.commonAttrs(el)} />`;
                    } else if (el.shapeType === "triangle") {
                        const points = [
                            { x: el.x + el.width / 2, y: el.y },
                            { x: el.x + el.width, y: el.y + el.height },
                            { x: el.x, y: el.y + el.height },
                        ];
                        const radius = Math.min(Math.abs(el.width), Math.abs(el.height)) * 0.07;
                        svgContent += `<path d="${this.roundedPolygonPath(points, radius)}" ${this.fillAttrs(el)} ${this.commonAttrs(el)} />`;
                    } else if (el.shapeType === "star") {
                        const cx = el.x + el.width / 2;
                        const cy = el.y + el.height / 2;
                        const outer = Math.min(Math.abs(el.width), Math.abs(el.height)) / 2;
                        const inner = outer * 0.382;
                        const points = Array.from({ length: 10 }, (_, index) => {
                            const radius = index % 2 === 0 ? outer : inner;
                            const angle = (Math.PI * 2 * index) / 10 - Math.PI / 2;
                            return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
                        });
                        svgContent += `<path d="${this.roundedPolygonPath(points, Math.min(Math.abs(el.width), Math.abs(el.height)) * 0.025)}" ${this.fillAttrs(el)} ${this.commonAttrs(el)} />`;
                    } else if (el.shapeType === "line" || el.shapeType === "arrow") {
                        const x2 = el.x + el.width;
                        const y2 = el.y + el.height;
                        svgContent += `<line x1="${el.x.toFixed(1)}" y1="${el.y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${this.commonAttrs(el)} />`;
                        if (el.shapeType === "arrow") {
                            const angle = Math.atan2(el.height, el.width);
                            const len = 12 + (el.strokeWidth || 2) * 2.4;
                            const p1 = { x: x2 - len * Math.cos(angle - Math.PI / 6), y: y2 - len * Math.sin(angle - Math.PI / 6) };
                            const p2 = { x: x2 - len * Math.cos(angle + Math.PI / 6), y: y2 - len * Math.sin(angle + Math.PI / 6) };
                            svgContent += `<line x1="${x2.toFixed(1)}" y1="${y2.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" ${this.commonAttrs(el)} />`;
                            svgContent += `<line x1="${x2.toFixed(1)}" y1="${y2.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" ${this.commonAttrs(el)} />`;
                        }
                    } else if (el.shapeType === "curve" || el.shapeType === "curve_arrow") {
                        const x2 = el.x + el.width;
                        const y2 = el.y + el.height;
                        const length = Math.max(1, Math.hypot(el.width, el.height));
                        const cx = (el.x + x2) / 2 - (el.height / length) * length * 0.25;
                        const cy = (el.y + y2) / 2 + (el.width / length) * length * 0.25;
                        svgContent += `<path d="M ${el.x.toFixed(1)} ${el.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" ${this.commonAttrs(el)} />`;
                        if (el.shapeType === "curve_arrow") {
                            const angle = Math.atan2(y2 - cy, x2 - cx);
                            const len = 12 + (el.strokeWidth || 2) * 2.4;
                            const p1 = { x: x2 - len * Math.cos(angle - Math.PI / 6), y: y2 - len * Math.sin(angle - Math.PI / 6) };
                            const p2 = { x: x2 - len * Math.cos(angle + Math.PI / 6), y: y2 - len * Math.sin(angle + Math.PI / 6) };
                            svgContent += `<line x1="${x2.toFixed(1)}" y1="${y2.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" ${this.commonAttrs(el)} />`;
                            svgContent += `<line x1="${x2.toFixed(1)}" y1="${y2.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" ${this.commonAttrs(el)} />`;
                        }
                    }
                }
            } catch (error) {
                console.error("Error rendering element in SVG export:", error, el);
            }
        }

        svgContent += `</g></svg>`;
        return svgContent;
    }

    static serializeToJSON(elements, viewport) {
        return JSON.stringify({
            version: "2.0.0",
            viewport: { panX: viewport.panX || 0, panY: viewport.panY || 0, zoom: viewport.zoom || 1 },
            objects: elements || [],
            assets: [],
            metadata: { title: "SlideForge Whiteboard Layer", exportedAt: new Date().toISOString() },
        }, null, 2);
    }
}
