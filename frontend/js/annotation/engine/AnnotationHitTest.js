import { getAnnotationBounds } from "./AnnotationGeometry.js";

export function annotationIntersectsPoint(annotation, point, tolerance = 8) {
    const bounds = getAnnotationBounds(annotation);
    return (
        point.x >= bounds.x - tolerance &&
        point.x <= bounds.x + bounds.width + tolerance &&
        point.y >= bounds.y - tolerance &&
        point.y <= bounds.y + bounds.height + tolerance
    );
}
