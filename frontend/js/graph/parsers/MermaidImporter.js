import { createGraphDocument } from "../../mermaid/mermaid-document.js";
import { parseMermaidToGraph } from "../../mermaid/mermaid-graph.js";
import { inferMermaidType } from "../../mermaid/mermaid-templates.js";
import { createSemanticGraphDocument } from "../schema/graphSchema.js";

export class MermaidImporter {
    static canImportVisually(source = "") {
        return /^(flowchart|graph)\s+/i.test(String(source || "").trim());
    }

    static toGraphDocument(source = "", options = {}) {
        const graphModel = this.canImportVisually(source)
            ? parseMermaidToGraph(source, options.previousGraph || null)
            : options.previousGraph || { nodes: [], edges: [], direction: "TD" };
        const legacyDocument = createGraphDocument({
            mermaidSource: source,
            graphModel,
            styles: options.styles || {},
            routingStyle: options.routingStyle,
            autoLayout: options.autoLayout,
            lockedLayout: options.lockedLayout,
        });
        return createSemanticGraphDocument({
            ...legacyDocument,
            type: inferMermaidType(source),
            mermaid: {
                source,
                importedWith: options.importedWith || "mermaid-compatible",
                exportCompatibility: this.canImportVisually(source) ? "round-trip" : "source-fallback",
                unsupportedBlocks: this.canImportVisually(source) ? [] : [{ type: inferMermaidType(source), reason: "visual-import-not-yet-supported" }],
            },
            metadata: {
                ...(legacyDocument.metadata || {}),
                sourceFormat: "mermaid",
            },
        });
    }
}
