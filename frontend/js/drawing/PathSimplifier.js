export class PathSimplifier {
    static perpendicularDistance(p, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        if (dx === 0 && dy === 0) {
            return Math.sqrt((p.x - lineStart.x) ** 2 + (p.y - lineStart.y) ** 2);
        }
        const numerator = Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
        const denominator = Math.sqrt(dx * dx + dy * dy);
        return numerator / denominator;
    }

    static simplifyRDP(points, epsilon = 1.0) {
        if (points.length < 3) return points;

        let maxDist = 0;
        let index = 0;
        const end = points.length - 1;

        for (let i = 1; i < end; i++) {
            const dist = this.perpendicularDistance(points[i], points[0], points[end]);
            if (dist > maxDist) {
                maxDist = dist;
                index = i;
            }
        }

        if (maxDist > epsilon) {
            const results1 = this.simplifyRDP(points.slice(0, index + 1), epsilon);
            const results2 = this.simplifyRDP(points.slice(index), epsilon);
            return results1.slice(0, results1.length - 1).concat(results2);
        }
        
        return [points[0], points[end]];
    }
}
