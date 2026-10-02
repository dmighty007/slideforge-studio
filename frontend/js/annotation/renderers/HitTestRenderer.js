export class HitTestRenderer {
    static buildSpatialIndex(annotations = []) {
        return annotations.map(annotation => ({ id: annotation.id, annotation }));
    }
}
