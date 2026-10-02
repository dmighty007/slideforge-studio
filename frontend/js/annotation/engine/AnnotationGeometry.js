export function getAnnotationBounds(annotation = {}) {
    const geometry = annotation.geometry || {};
    const points = geometry.points || [];
    if (points.length) {
        const xs = points.map(point => Number(point.x) || 0);
        const ys = points.map(point => Number(point.y) || 0);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return {
        x: Number(geometry.x) || 0,
        y: Number(geometry.y) || 0,
        width: Number(geometry.width) || 0,
        height: Number(geometry.height) || 0,
    };
}
