import { SvgStaticRenderer } from "./SvgStaticRenderer.js";
import { normalizeAnnotationElements } from "../objects/objectMigrators.js";

export class ExportRenderer {
    static generateSVG(elements = [], viewport = {}, slideWidth = 1024, slideHeight = 768) {
        const normalized = normalizeAnnotationElements(elements).filter(el => el.export?.includeInSvg !== false);
        const panX = Number(viewport.panX) || 0;
        const panY = Number(viewport.panY) || 0;
        const zoom = Number(viewport.zoom) || 1;
        const nodes = SvgStaticRenderer.renderNodes(normalized);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${slideWidth} ${slideHeight}" width="100%" height="100%"><g transform="translate(${panX}, ${panY}) scale(${zoom})">${nodes}</g></svg>`;
    }

    static serializeToJSON(elements = [], viewport = {}) {
        return JSON.stringify(
            {
                version: "3.0.0",
                schema: "slideforge.annotation",
                viewport: { panX: viewport.panX || 0, panY: viewport.panY || 0, zoom: viewport.zoom || 1 },
                objects: normalizeAnnotationElements(elements),
                assets: [],
                metadata: { title: "SlideForge Annotation Layer", exportedAt: new Date().toISOString() },
            },
            null,
            2,
        );
    }
}
