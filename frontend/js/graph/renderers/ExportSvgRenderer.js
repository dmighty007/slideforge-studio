import { SvgGraphRenderer } from "./SvgGraphRenderer.js";

export class ExportSvgRenderer {
    static render(document = {}, options = {}) {
        const svg = SvgGraphRenderer.render(document, options);
        return svg.replace("<svg", `<svg data-slideforge-graph="${document.id || ""}"`);
    }
}
