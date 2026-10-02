import { SvgGraphRenderer } from "./SvgGraphRenderer.js";

export class PresentationRenderer {
    static renderStep(document = {}, step = {}, options = {}) {
        const selectedIds = step.targetIds || step.path || [];
        return SvgGraphRenderer.render(document, { ...options, selectedIds });
    }
}
