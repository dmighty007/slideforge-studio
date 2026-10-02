import { documentToGraphModel } from "../../mermaid/mermaid-document.js";

export class GraphScene {
    static fromDocument(document = {}) {
        const model = documentToGraphModel(document);
        return {
            id: document.id,
            type: document.type || model.type || "flowchart",
            nodes: model.nodes || [],
            edges: model.edges || [],
            groups: document.groups || model.groups || [],
            lanes: document.lanes || [],
            viewport: document.viewport || model.viewport || { x: 0, y: 0, zoom: 1 },
            styles: document.styles || model.style || {},
            layoutState: document.layoutState || {},
            presentationState: document.presentationState || {},
            metadata: document.metadata || {},
            sourceDocument: document,
        };
    }
}
