export class GraphTimeline {
    static buildTracks(document = {}) {
        return [
            {
                id: `${document.id || "graph"}_track`,
                label: document.title || "Diagram",
                items: document.presentationState?.steps || document.animations || [],
            },
        ];
    }
}
