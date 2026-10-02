import { layoutGraphModel } from "../../mermaid/mermaid-graph.js";
import { documentToGraphModel, updateDocumentFromGraphModel } from "../../mermaid/mermaid-document.js";

self.onmessage = event => {
    const { document, options = {} } = event.data || {};
    const graphModel = layoutGraphModel(documentToGraphModel(document), {
        preservePositions: options.preservePositions !== false,
    });
    self.postMessage({
        document: updateDocumentFromGraphModel(document, graphModel, {
            interaction: "worker-layout",
            preservePositions: true,
            styles: document.styles || {},
        }),
    });
};
