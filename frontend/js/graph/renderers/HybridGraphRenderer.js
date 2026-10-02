import { SvgGraphRenderer } from "./SvgGraphRenderer.js";

export class HybridGraphRenderer {
    static render(document = {}, options = {}) {
        const nodeCount = document.nodes?.length || 0;
        const edgeCount = document.edges?.length || 0;
        return {
            mode: nodeCount + edgeCount > 600 ? "hybrid-lod" : "svg",
            svg: SvgGraphRenderer.render(document, options),
            lod: nodeCount > 250,
        };
    }
}
