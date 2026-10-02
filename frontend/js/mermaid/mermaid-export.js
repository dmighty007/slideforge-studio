import { sanitizeMermaidSvg } from "./mermaid-engine.js";
import { GraphSvgExporter } from "../graph/exporters/GraphSvgExporter.js";
import { ensureSemanticGraphDocument } from "../graph/schema/migrations.js";

export function exportMermaidSvg(element) {
    const graphDocument = element?.graphDocument?.nodes?.length
        ? ensureSemanticGraphDocument(element.graphDocument, { mermaidSource: element.mermaidSource, style: element.style })
        : null;
    const svg = sanitizeMermaidSvg(graphDocument ? GraphSvgExporter.exportString(graphDocument) : (element?.svgContent || ""));
    if (!svg) return false;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `slideforge-mermaid-${Date.now()}.svg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
}

window.exportMermaidSvg = exportMermaidSvg;
