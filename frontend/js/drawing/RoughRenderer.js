export class RoughRenderer {
    static seededRandom(seed) {
        let value = seed || 1;
        return () => {
            value = (value * 1664525 + 1013904223) >>> 0;
            return value / 4294967296;
        };
    }

    static _rand(style) {
        if (typeof style.random === "function") return style.random();
        return Math.random();
    }

    static getJitterOffset(length, roughness, rand = Math.random) {
        const offsetRange = roughness * (length * 0.026);
        const maxOffset = Math.max(1.2, Math.min(offsetRange, 18));
        return (rand() - 0.5) * maxOffset;
    }

    static getCurvePoints(x1, y1, x2, y2, roughness, bowing, rand = Math.random) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const nx = -dy / length;
        const ny = dx / length;
        const bowAmp = (rand() - 0.5) * bowing * Math.max(2.0, roughness * 3.2);
        return {
            midJitterX: mx + nx * bowAmp + this.getJitterOffset(length, roughness, rand),
            midJitterY: my + ny * bowAmp + this.getJitterOffset(length, roughness, rand),
        };
    }

    static roughProfile(style = {}) {
        const roughness = Math.max(0, Math.min(4.2, Number(style.roughness) || 0));
        const strokeWidth = Math.max(1, Number(style.strokeWidth) || 2);
        return {
            roughness,
            strokeWidth,
            baseAlpha: roughness <= 0.2 ? 1 : Math.max(0.58, 0.86 - roughness * 0.07),
            overlayAlpha: Math.min(0.68, 0.28 + roughness * 0.12),
            overlayPasses: roughness < 1 ? 1 : roughness < 2.2 ? 2 : 3,
            wobble: Math.max(0.4, roughness * (1.6 + strokeWidth * 0.12)),
            radiusWobble: Math.min(0.12, 0.025 + roughness * 0.018),
        };
    }

    static applyStrokeStyle(ctx, style) {
        const strokeStyle = style.strokeStyle || "solid";
        if (strokeStyle === "dashed") ctx.setLineDash([10, 8]);
        else if (strokeStyle === "dotted") ctx.setLineDash([2, 7]);
        else ctx.setLineDash([]);
    }

    static _setupStroke(ctx, style, lineWidth = style.strokeWidth ?? 2) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style.strokeColor ?? "#000000";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        this.applyStrokeStyle(ctx, style);
    }

    static _roughOverlayWidth(style) {
        const strokeWidth = style.strokeWidth ?? 2;
        const roughness = Math.max(0, Number(style.roughness) || 0);
        return Math.max(0.75, strokeWidth * (0.32 + Math.min(roughness, 3) * 0.05));
    }

    static _drawExactLine(ctx, x1, y1, x2, y2) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    static _drawExactCurve(ctx, x1, y1, cx, cy, x2, y2) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.stroke();
    }

    static _roundedRectPath(ctx, x, y, w, h, radius) {
        const x1 = Math.min(x, x + w);
        const y1 = Math.min(y, y + h);
        const x2 = Math.max(x, x + w);
        const y2 = Math.max(y, y + h);
        const r = Math.max(0, Math.min(radius, (x2 - x1) / 2, (y2 - y1) / 2));
        ctx.moveTo(x1 + r, y1);
        ctx.lineTo(x2 - r, y1);
        ctx.quadraticCurveTo(x2, y1, x2, y1 + r);
        ctx.lineTo(x2, y2 - r);
        ctx.quadraticCurveTo(x2, y2, x2 - r, y2);
        ctx.lineTo(x1 + r, y2);
        ctx.quadraticCurveTo(x1, y2, x1, y2 - r);
        ctx.lineTo(x1, y1 + r);
        ctx.quadraticCurveTo(x1, y1, x1 + r, y1);
    }

    static _distance(a, b) {
        return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
    }

    static _pointToward(from, to, distance) {
        const length = Math.max(0.001, this._distance(from, to));
        const t = Math.max(0, Math.min(1, distance / length));
        return {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
        };
    }

    static _smoothPolygonPath(ctx, points, radius = 0) {
        if (!Array.isArray(points) || points.length < 2) return;
        const r = Math.max(0, Number(radius) || 0);
        if (points.length < 3 || r <= 0) {
            ctx.moveTo(points[0].x, points[0].y);
            points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
            if (points.length > 2) ctx.closePath();
            return;
        }

        points.forEach((point, index) => {
            const prev = points[(index - 1 + points.length) % points.length];
            const next = points[(index + 1) % points.length];
            const cornerRadius = Math.min(r, this._distance(point, prev) * 0.42, this._distance(point, next) * 0.42);
            const start = this._pointToward(point, prev, cornerRadius);
            const end = this._pointToward(point, next, cornerRadius);
            if (index === 0) ctx.moveTo(start.x, start.y);
            else ctx.lineTo(start.x, start.y);
            ctx.quadraticCurveTo(point.x, point.y, end.x, end.y);
        });
        ctx.closePath();
    }

    static _jitterPoints(points, style = {}, rand = Math.random, scale = 1) {
        const roughness = Math.max(0, Number(style.roughness) || 0);
        const jitter = Math.min(14, roughness * 2.4 * scale);
        return points.map(point => ({
            x: point.x + (rand() - 0.5) * jitter,
            y: point.y + (rand() - 0.5) * jitter,
        }));
    }

    static _drawWobblyRoundedRect(ctx, x, y, w, h, radius, style, rand) {
        const roughness = Math.max(0, Number(style.roughness) || 0);
        const x1 = Math.min(x, x + w);
        const y1 = Math.min(y, y + h);
        const x2 = Math.max(x, x + w);
        const y2 = Math.max(y, y + h);
        const r = Math.max(0, Math.min(radius, (x2 - x1) / 2, (y2 - y1) / 2));
        const jitter = Math.min(10, roughness * 2.2);
        const j = () => (rand() - 0.5) * jitter;
        ctx.beginPath();
        ctx.moveTo(x1 + r + j(), y1 + j());
        ctx.lineTo(x2 - r + j(), y1 + j());
        ctx.quadraticCurveTo(x2 + j(), y1 + j(), x2 + j(), y1 + r + j());
        ctx.lineTo(x2 + j(), y2 - r + j());
        ctx.quadraticCurveTo(x2 + j(), y2 + j(), x2 - r + j(), y2 + j());
        ctx.lineTo(x1 + r + j(), y2 + j());
        ctx.quadraticCurveTo(x1 + j(), y2 + j(), x1 + j(), y2 - r + j());
        ctx.lineTo(x1 + j(), y1 + r + j());
        ctx.quadraticCurveTo(x1 + j(), y1 + j(), x1 + r + j(), y1 + j());
        ctx.stroke();
    }

    static _drawWobblyLine(ctx, x1, y1, x2, y2, style, rand) {
        const roughness = Math.max(0, Number(style.roughness) || 0);
        const bowing = Number(style.bowing) || 1;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(1, Math.hypot(dx, dy));
        const nx = -dy / length;
        const ny = dx / length;
        const segments = Math.max(2, Math.min(12, Math.ceil(length / 52) + Math.floor(roughness)));
        const endJitter = roughness * 0.9;
        const wobble = Math.min(22, Math.max(0.6, roughness * Math.min(8, Math.sqrt(length) * 0.55)));
        const bow = (rand() - 0.5) * bowing * roughness * Math.min(18, length * 0.075);
        ctx.beginPath();
        for (let i = 0; i <= segments; i += 1) {
            const t = i / segments;
            const edgeScale = i === 0 || i === segments ? 0.35 : Math.sin(Math.PI * t);
            const tangentJitter = (rand() - 0.5) * roughness * 1.2 * edgeScale;
            const normalJitter = ((rand() - 0.5) * wobble + bow * Math.sin(Math.PI * t)) * edgeScale;
            const px =
                x1 +
                dx * t +
                (i === 0 || i === segments ? (rand() - 0.5) * endJitter : 0) +
                (dx / length) * tangentJitter +
                nx * normalJitter;
            const py =
                y1 +
                dy * t +
                (i === 0 || i === segments ? (rand() - 0.5) * endJitter : 0) +
                (dy / length) * tangentJitter +
                ny * normalJitter;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    static _drawWobblyEllipse(ctx, cx, cy, rx, ry, style, rand) {
        const profile = this.roughProfile(style);
        const maxRadius = Math.max(Math.abs(rx), Math.abs(ry));
        const pointsCount = Math.max(72, Math.min(220, Math.ceil(maxRadius * 1.15)));
        const step = (Math.PI * 2) / pointsCount;
        const phase = rand() * Math.PI * 2;
        const radialNoise = profile.radiusWobble * 0.72;
        const driftX = (rand() - 0.5) * profile.wobble * 0.35;
        const driftY = (rand() - 0.5) * profile.wobble * 0.35;
        const microJitter = profile.wobble * 0.08;
        ctx.beginPath();
        for (let j = 0; j <= pointsCount + 1; j++) {
            const angle = j * step;
            const wave =
                Math.sin(angle * 2 + phase) * radialNoise * 0.5 +
                Math.sin(angle * 3 + phase * 0.7) * radialNoise * 0.34 +
                Math.sin(angle * 5 + phase * 1.37) * radialNoise * 0.16;
            const rXOffset = rx * (1 + wave);
            const rYOffset = ry * (1 + wave * 0.85);
            const tangent = Math.sin(angle * 4 + phase * 0.43) * microJitter;
            const px = cx + driftX + Math.cos(angle) * rXOffset - Math.sin(angle) * tangent;
            const py = cy + driftY + Math.sin(angle) * rYOffset + Math.cos(angle) * tangent;
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    static drawRoughLine(ctx, x1, y1, x2, y2, style = {}) {
        const roughness = style.roughness ?? 1.5;
        const rand = style.random || Math.random;
        const profile = this.roughProfile(style);
        ctx.save();
        const initialAlpha = ctx.globalAlpha;

        ctx.globalAlpha = initialAlpha * profile.baseAlpha;
        this._setupStroke(ctx, style);
        this._drawExactLine(ctx, x1, y1, x2, y2);

        if (roughness > 0.2) {
            ctx.globalAlpha = initialAlpha * profile.overlayAlpha;
            this._setupStroke(ctx, style, this._roughOverlayWidth(style));
            for (let pass = 0; pass < profile.overlayPasses; pass += 1) {
                this._drawWobblyLine(ctx, x1, y1, x2, y2, style, rand);
            }
        }
        ctx.restore();
    }

    static fillPolygon(ctx, points, style = {}) {
        const fill = style.backgroundColor || "transparent";
        if (style.fillStyle === "none") return;
        if (!fill || fill === "transparent") return;
        ctx.save();
        ctx.globalAlpha *= style.fillOpacity ?? 0.45;
        ctx.fillStyle = fill;
        ctx.beginPath();
        this._smoothPolygonPath(ctx, points, style.cornerRadius || 0);
        ctx.fill();

        if (style.fillStyle === "hachure" || style.fillStyle === "cross-hatch") {
            const rand = style.random || Math.random;
            const roughness = Math.max(0, Number(style.roughness) || 0);
            const minX = Math.min(...points.map(p => p.x));
            const maxX = Math.max(...points.map(p => p.x));
            const minY = Math.min(...points.map(p => p.y));
            const maxY = Math.max(...points.map(p => p.y));
            ctx.clip();
            ctx.globalAlpha *= 0.75;
            ctx.strokeStyle = fill;
            ctx.lineWidth = Math.max(1, 1.25 + roughness * 0.12);
            ctx.lineCap = "round";
            const gap = Math.max(7, 11 - roughness * 0.8);
            for (let x = minX - (maxY - minY); x < maxX + (maxY - minY); x += gap + (rand() - 0.5) * roughness * 1.4) {
                const jitter = roughness * 2.2;
                ctx.beginPath();
                ctx.moveTo(x + (rand() - 0.5) * jitter, maxY + gap + (rand() - 0.5) * jitter);
                ctx.lineTo(x + (maxY - minY) + gap + (rand() - 0.5) * jitter, minY - gap + (rand() - 0.5) * jitter);
                ctx.stroke();
            }
            if (style.fillStyle === "cross-hatch") {
                for (let x = minX - (maxY - minY); x < maxX + (maxY - minY); x += gap + (rand() - 0.5) * roughness * 1.4) {
                    const jitter = roughness * 2.2;
                    ctx.beginPath();
                    ctx.moveTo(x + (rand() - 0.5) * jitter, minY - gap + (rand() - 0.5) * jitter);
                    ctx.lineTo(x + (maxY - minY) + gap + (rand() - 0.5) * jitter, maxY + gap + (rand() - 0.5) * jitter);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }

    static drawRoughPolygon(ctx, points, style = {}, options = {}) {
        if (!Array.isArray(points) || points.length < 2) return;
        const roughness = style.roughness ?? 1.5;
        const rand = style.random || Math.random;
        const profile = this.roughProfile(style);
        const cornerRadius = options.cornerRadius ?? style.cornerRadius ?? 0;
        this.fillPolygon(ctx, points, { ...style, cornerRadius });

        ctx.save();
        const initialAlpha = ctx.globalAlpha;
        ctx.globalAlpha = initialAlpha * profile.baseAlpha;
        this._setupStroke(ctx, style);
        ctx.beginPath();
        this._smoothPolygonPath(ctx, points, cornerRadius);
        ctx.stroke();

        if (roughness > 0.2) {
            ctx.globalAlpha = initialAlpha * profile.overlayAlpha;
            this._setupStroke(ctx, style, this._roughOverlayWidth(style));
            for (let pass = 0; pass < profile.overlayPasses; pass += 1) {
                ctx.beginPath();
                this._smoothPolygonPath(ctx, this._jitterPoints(points, style, rand, pass + 1), cornerRadius);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    static fillRoundedRect(ctx, x, y, w, h, radius, style = {}) {
        const fill = style.backgroundColor || "transparent";
        if (style.fillStyle === "none") return;
        if (!fill || fill === "transparent") return;
        ctx.save();
        ctx.globalAlpha *= style.fillOpacity ?? 0.58;
        ctx.fillStyle = fill;
        ctx.beginPath();
        this._roundedRectPath(ctx, x, y, w, h, radius);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    static drawRoughRect(ctx, x, y, w, h, style = {}) {
        const roughness = style.roughness ?? 1.5;
        const rand = style.random || Math.random;
        const profile = this.roughProfile(style);
        const radius = Math.min(Math.abs(w), Math.abs(h), 64) * 0.18;
        this.fillRoundedRect(ctx, x, y, w, h, radius, style);

        ctx.save();
        const initialAlpha = ctx.globalAlpha;
        ctx.globalAlpha = initialAlpha * profile.baseAlpha;
        this._setupStroke(ctx, style);
        ctx.beginPath();
        this._roundedRectPath(ctx, x, y, w, h, radius);
        ctx.stroke();
        if (roughness > 0.2) {
            ctx.globalAlpha = initialAlpha * profile.overlayAlpha;
            this._setupStroke(ctx, style, this._roughOverlayWidth(style));
            for (let pass = 0; pass < profile.overlayPasses; pass += 1) {
                this._drawWobblyRoundedRect(ctx, x, y, w, h, radius, style, rand);
            }
        }
        ctx.restore();
    }

    static drawRoughDiamond(ctx, x, y, w, h, style = {}) {
        const cornerRadius = Math.min(Math.abs(w), Math.abs(h)) * 0.075;
        const points = [
            { x: x + w / 2, y },
            { x: x + w, y: y + h / 2 },
            { x: x + w / 2, y: y + h },
            { x, y: y + h / 2 },
        ];
        this.drawRoughPolygon(ctx, points, style, { cornerRadius });
    }

    static drawRoughEllipse(ctx, cx, cy, rx, ry, style = {}) {
        const roughness = style.roughness ?? 1.5;
        const strokeWidth = style.strokeWidth ?? 2;
        const strokeColor = style.strokeColor ?? "#000000";
        const rand = style.random || Math.random;
        const profile = this.roughProfile(style);

        if (style.backgroundColor && style.backgroundColor !== "transparent") {
            ctx.save();
            ctx.globalAlpha *= style.fillOpacity ?? 0.45;
            ctx.fillStyle = style.backgroundColor;
            ctx.beginPath();
            ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.save();
        const initialAlpha = ctx.globalAlpha;
        ctx.globalAlpha = initialAlpha * profile.baseAlpha;
        this._setupStroke(ctx, { ...style, strokeColor, strokeWidth });
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
        ctx.stroke();

        if (roughness <= 0.2) {
            ctx.restore();
            return;
        }

        ctx.globalAlpha = initialAlpha * profile.overlayAlpha;
        this._setupStroke(ctx, { ...style, strokeColor, strokeWidth }, this._roughOverlayWidth({ ...style, strokeWidth }));
        for (let pass = 0; pass < profile.overlayPasses; pass += 1) {
            this._drawWobblyEllipse(ctx, cx, cy, rx, ry, style, rand);
        }
        ctx.restore();
    }

    static drawRoughArrow(ctx, x1, y1, x2, y2, style = {}) {
        this.drawRoughLine(ctx, x1, y1, x2, y2, style);
        const arrowLength = 12 + (style.strokeWidth ?? 2) * 2.4;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const leftHeadX = x2 - arrowLength * Math.cos(angle - Math.PI / 6);
        const leftHeadY = y2 - arrowLength * Math.sin(angle - Math.PI / 6);
        const rightHeadX = x2 - arrowLength * Math.cos(angle + Math.PI / 6);
        const rightHeadY = y2 - arrowLength * Math.sin(angle + Math.PI / 6);
        this.drawRoughLine(ctx, x2, y2, leftHeadX, leftHeadY, style);
        this.drawRoughLine(ctx, x2, y2, rightHeadX, rightHeadY, style);
    }

    static drawRoughTriangle(ctx, x, y, w, h, style = {}) {
        const cornerRadius = Math.min(Math.abs(w), Math.abs(h)) * 0.07;
        const points = [
            { x: x + w / 2, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
        ];
        this.drawRoughPolygon(ctx, points, style, { cornerRadius });
    }

    static drawRoughStar(ctx, x, y, w, h, style = {}) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const outerRadius = Math.min(w, h) / 2;
        const innerRadius = outerRadius * 0.382;
        const points = [];
        for (let i = 0; i < 10; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (Math.PI * 2 * i) / 10 - Math.PI / 2;
            points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
        }
        this.drawRoughPolygon(ctx, points, style, { cornerRadius: Math.min(Math.abs(w), Math.abs(h)) * 0.025 });
    }

    static drawRoughCurve(ctx, x1, y1, x2, y2, style = {}) {
        const roughness = style.roughness ?? 1.5;
        const rand = style.random || Math.random;
        const profile = this.roughProfile(style);
        ctx.save();
        const initialAlpha = ctx.globalAlpha;

        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const controlDist = length * 0.25;
        const cx = mx - (dy / length) * controlDist;
        const cy = my + (dx / length) * controlDist;

        ctx.globalAlpha = initialAlpha * profile.baseAlpha;
        this._setupStroke(ctx, style);
        this._drawExactCurve(ctx, x1, y1, cx, cy, x2, y2);

        if (roughness > 0.2) {
            ctx.globalAlpha = initialAlpha * profile.overlayAlpha;
            this._setupStroke(ctx, style, this._roughOverlayWidth(style));
            for (let pass = 0; pass < profile.overlayPasses; pass += 1) {
                const startJitterX = x1 + (rand() - 0.5) * roughness * 1.6;
                const startJitterY = y1 + (rand() - 0.5) * roughness * 1.6;
                const endJitterX = x2 + (rand() - 0.5) * roughness * 1.6;
                const endJitterY = y2 + (rand() - 0.5) * roughness * 1.6;
                const controlJitterX = cx + (rand() - 0.5) * roughness * 12;
                const controlJitterY = cy + (rand() - 0.5) * roughness * 12;
                this._drawExactCurve(ctx, startJitterX, startJitterY, controlJitterX, controlJitterY, endJitterX, endJitterY);
            }
        }
        ctx.restore();
    }

    static drawRoughCurveArrow(ctx, x1, y1, x2, y2, style = {}) {
        this.drawRoughCurve(ctx, x1, y1, x2, y2, style);

        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const controlDist = length * 0.25;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const cx = mx - (dy / length) * controlDist;
        const cy = my + (dx / length) * controlDist;

        const arrowLength = 12 + (style.strokeWidth ?? 2) * 2.4;
        const tangentAngle = Math.atan2(y2 - cy, x2 - cx);
        const leftHeadX = x2 - arrowLength * Math.cos(tangentAngle - Math.PI / 6);
        const leftHeadY = y2 - arrowLength * Math.sin(tangentAngle - Math.PI / 6);
        const rightHeadX = x2 - arrowLength * Math.cos(tangentAngle + Math.PI / 6);
        const rightHeadY = y2 - arrowLength * Math.sin(tangentAngle + Math.PI / 6);

        this.drawRoughLine(ctx, x2, y2, leftHeadX, leftHeadY, style);
        this.drawRoughLine(ctx, x2, y2, rightHeadX, rightHeadY, style);
    }
}
