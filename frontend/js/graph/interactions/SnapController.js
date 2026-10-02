export class SnapController {
    static snap(point = {}, grid = 8) {
        return {
            x: Math.round((Number(point.x) || 0) / grid) * grid,
            y: Math.round((Number(point.y) || 0) / grid) * grid,
        };
    }
}
