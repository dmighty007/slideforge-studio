export class HitTestRenderer {
    static buildSpatialIndex(document = {}) {
        return (document.nodes || []).map(node => ({
            id: node.id,
            bounds: {
                x: node.geometry?.x ?? node.x ?? 0,
                y: node.geometry?.y ?? node.y ?? 0,
                width: node.geometry?.width ?? node.width ?? 0,
                height: node.geometry?.height ?? node.height ?? 0,
            },
        }));
    }

    static hitTest(index = [], point = {}) {
        for (let i = index.length - 1; i >= 0; i -= 1) {
            const item = index[i];
            const b = item.bounds;
            if (point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height) return item.id;
        }
        return null;
    }
}
