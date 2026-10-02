import { createGraphDocument, documentToGraphModel } from "../../mermaid/mermaid-document.js";
import { parseMermaidToGraph } from "../../mermaid/mermaid-graph.js";
import { createSemanticGraphDocument, SEMANTIC_GRAPH_SCHEMA_VERSION } from "./graphSchema.js";
import { MermaidImporter } from "../parsers/MermaidImporter.js";

export function ensureSemanticGraphDocument(input = {}, options = {}) {
    if (input?.schemaVersion >= SEMANTIC_GRAPH_SCHEMA_VERSION && Array.isArray(input.nodes)) {
        return createSemanticGraphDocument(input);
    }

    if (input?.graphDocument) {
        return ensureSemanticGraphDocument(input.graphDocument, {
            ...options,
            mermaidSource: input.mermaidSource,
            style: input.style,
            graphModel: input.graphModel,
        });
    }

    if (Array.isArray(input?.nodes) && Array.isArray(input?.edges)) {
        return createSemanticGraphDocument({
            ...input,
            mermaid: {
                source: options.mermaidSource || input.mermaidSource || input.mermaid?.source || "",
                exportCompatibility: "round-trip",
            },
            styles: input.styles || input.style || options.style || {},
        });
    }

    if (input?.graphModel) {
        const legacyDocument = createGraphDocument({
            graphModel: input.graphModel,
            mermaidSource: input.mermaidSource || options.mermaidSource || "",
            styles: input.style || options.style || {},
            routingStyle: input.routingStyle,
            autoLayout: input.autoLayout,
            lockedLayout: input.lockedLayout,
        });
        return createSemanticGraphDocument({
            ...legacyDocument,
            mermaid: { source: input.mermaidSource || options.mermaidSource || "", exportCompatibility: "round-trip" },
        });
    }

    if (input?.mermaidSource || options.mermaidSource) {
        return MermaidImporter.toGraphDocument(input.mermaidSource || options.mermaidSource, {
            previousGraph: input.graphModel || options.graphModel || null,
            styles: input.style || options.style || {},
            routingStyle: input.routingStyle,
            autoLayout: input.autoLayout,
            lockedLayout: input.lockedLayout,
        });
    }

    return createSemanticGraphDocument();
}

export function ensureGraphElementDocument(element = {}) {
    const document = ensureSemanticGraphDocument(element, {
        mermaidSource: element.mermaidSource || "",
        style: element.style || {},
        graphModel: element.graphModel || null,
    });
    return {
        graphDocument: document,
        graphModel: documentToGraphModel(document),
    };
}

export function migrateGraphDocumentV1ToV2(document = {}, context = {}) {
    return ensureSemanticGraphDocument(document, context);
}

export function graphModelToDocumentV2(graphModel = {}, context = {}) {
    return ensureSemanticGraphDocument({ graphModel, ...context });
}

export function mermaidSourceToDocumentV2(source = "", context = {}) {
    return MermaidImporter.toGraphDocument(source, context);
}
