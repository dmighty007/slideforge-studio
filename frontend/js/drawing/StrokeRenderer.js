export class StrokeRenderer {
    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    static getCatmullRomPoint(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;

        const f0 = -0.5 * t3 + t2 - 0.5 * t;
        const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
        const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
        const f3 = 0.5 * t3 - 0.5 * t2;

        return {
            x: p0.x * f0 + p1.x * f1 + p2.x * f2 + p3.x * f3,
            y: p0.y * f0 + p1.y * f1 + p2.y * f2 + p3.y * f3,
            pressure: p0.pressure * f0 + p1.pressure * f1 + p2.pressure * f2 + p3.pressure * f3,
        };
    }

    static generateSplinePoints(points, segmentSamples = 6) {
        if (points.length < 2) return points;
        if (points.length === 2) {
            const pts = [];
            for (let i = 0; i <= segmentSamples; i++) {
                const t = i / segmentSamples;
                pts.push({
                    x: points[0].x + (points[1].x - points[0].x) * t,
                    y: points[0].y + (points[1].y - points[0].y) * t,
                    pressure: points[0].pressure + (points[1].pressure - points[0].pressure) * t,
                });
            }
            return pts;
        }

        const splined = [];
        const extended = [points[0], ...points, points[points.length - 1]];

        for (let i = 1; i < extended.length - 2; i++) {
            const p0 = extended[i - 1];
            const p1 = extended[i];
            const p2 = extended[i + 1];
            const p3 = extended[i + 2];

            for (let j = 0; j < segmentSamples; j++) {
                const t = j / segmentSamples;
                splined.push(this.getCatmullRomPoint(p0, p1, p2, p3, t));
            }
        }
        splined.push(points[points.length - 1]);
        return splined;
    }

    static drawInkStroke(ctx, points, strokeColor, baseWidth = 3) {
        if (!points || points.length === 0) return;
        const width = Math.max(0.75, Number(baseWidth) || 3);
        if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor;
            ctx.fill();
            return;
        }

        const strokePoints = this.generateSplinePoints(points, 5);
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.fillStyle = strokeColor;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        let previousWidth = width * this.clamp(strokePoints[0].pressure || 0.5, 0.35, 1);
        for (let i = 1; i < strokePoints.length; i++) {
            const prev = strokePoints[i - 1];
            const current = strokePoints[i];
            const pressure = this.clamp(current.pressure || 0.5, 0.28, 1);
            const distance = Math.max(0.01, Math.hypot(current.x - prev.x, current.y - prev.y));
            const taper = Math.min(1, i / 5, (strokePoints.length - i) / 5);
            const pressureWidth = width * (0.54 + pressure * 0.68) * Math.max(0.72, taper);
            const nextWidth = previousWidth * 0.72 + pressureWidth * 0.28;

            ctx.lineWidth = Math.max(0.75, (previousWidth + nextWidth) / 2);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            if (i < strokePoints.length - 1) {
                const next = strokePoints[i + 1];
                ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
            } else {
                ctx.lineTo(current.x, current.y);
            }
            ctx.stroke();

            if (distance > width * 1.4) {
                ctx.beginPath();
                ctx.arc(current.x, current.y, Math.max(0.5, nextWidth / 2), 0, Math.PI * 2);
                ctx.fill();
            }
            previousWidth = nextWidth;
        }
        ctx.restore();
    }
}
