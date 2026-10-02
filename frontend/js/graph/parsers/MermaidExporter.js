import { deriveMermaidFromDocument } from "../../mermaid/mermaid-document.js";

export class MermaidExporter {
    static fromGraphDocument(document = {}) {
        if (!document?.nodes?.length && document?.mermaid?.source) return document.mermaid.source;
        try {
            return deriveMermaidFromDocument(document);
        } catch (_error) {
            return document?.mermaid?.source || "flowchart TD";
        }
    }
}
