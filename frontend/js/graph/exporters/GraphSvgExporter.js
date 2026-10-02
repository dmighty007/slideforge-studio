import { ExportSvgRenderer } from "../renderers/ExportSvgRenderer.js";

export class GraphSvgExporter {
    static exportString(graphDocument = {}) {
        return ExportSvgRenderer.render(graphDocument);
    }

    static download(graphDocument = {}) {
        const blob = new Blob([this.exportString(graphDocument)], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `slideforge-graph-${Date.now()}.svg`;
        window.document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }
}
