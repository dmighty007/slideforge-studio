import { renderDocumentToSvg } from "../../mermaid/mermaid-document.js";

export class SvgGraphRenderer {
    static render(document = {}, options = {}) {
        // The caller's style (the element's current style, or the editor's controls) wins over the one saved
        // with the graph document, so style changes made after the diagram was created are shown.
        const style = options.style ? { ...(document.styles || {}), ...options.style } : document.styles || {};
        return renderDocumentToSvg(document, style, {
            selectedIds: options.selectedIds || [],
            viewport: options.viewport || null,
            showConnectHandles: options.showConnectHandles === true,
            showResizeHandles: options.showResizeHandles === true,
        });
    }
}
