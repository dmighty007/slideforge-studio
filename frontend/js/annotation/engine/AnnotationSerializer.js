import {
    annotationToLegacyDrawing,
    legacyDrawingToAnnotation,
    legacySketchElementToAnnotations,
    normalizeAnnotationElements,
} from "../objects/objectMigrators.js";

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function pxNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number.parseFloat(String(value ?? "").replace("px", ""));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function localizeDrawingElement(el, bounds) {
    const copy = clone(el);
    if (copy.type === "freehand") {
        copy.points = (copy.points || []).map(point => ({ ...point, x: point.x - bounds.x, y: point.y - bounds.y }));
    } else {
        copy.x = (copy.x || 0) - bounds.x;
        copy.y = (copy.y || 0) - bounds.y;
    }
    return copy;
}

export class AnnotationSerializer {
    static slideToAnnotations(slide = {}) {
        const canonical = normalizeAnnotationElements(slide.whiteboardElements || []);
        const embeddedWhiteboards = [];
        (slide.elements || []).forEach((el, index) => {
            if (el.type === "whiteboard" && el.drawingElement) {
                const drawing = clone(el.drawingElement);
                const viewBox = el.drawingViewBox || {};
                const scaleX = pxNumber(el.width, viewBox.width || 1) / Math.max(1, Number(viewBox.width) || pxNumber(el.width, 1));
                const scaleY = pxNumber(el.height, viewBox.height || 1) / Math.max(1, Number(viewBox.height) || pxNumber(el.height, 1));
                if (drawing.type === "freehand") {
                    drawing.points = (drawing.points || []).map(point => ({
                        ...point,
                        x: point.x * scaleX + (Number(el.x) || 0),
                        y: point.y * scaleY + (Number(el.y) || 0),
                    }));
                } else {
                    drawing.x = (Number(drawing.x) || 0) * scaleX + (Number(el.x) || 0);
                    drawing.y = (Number(drawing.y) || 0) * scaleY + (Number(el.y) || 0);
                    if (drawing.width !== undefined) drawing.width = Number(drawing.width) * scaleX;
                    if (drawing.height !== undefined) drawing.height = Number(drawing.height) * scaleY;
                }
                const annotation = legacyDrawingToAnnotation(drawing, canonical.length + index);
                if (annotation) embeddedWhiteboards.push({ ...annotation, metadata: { ...(annotation.metadata || {}), sourceElementId: el.id, migratedFrom: "whiteboard-element" } });
            }
        });
        if (embeddedWhiteboards.some(annotation => annotation.metadata?.sourceElementId)) {
            return embeddedWhiteboards.sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0));
        }
        if (canonical.length) return canonical;
        return [...canonical, ...embeddedWhiteboards].sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0));
    }

    static annotationsToDrawingElements(annotations = []) {
        return normalizeAnnotationElements(annotations).map(annotationToLegacyDrawing);
    }

    static drawingElementsToAnnotations(drawingElements = []) {
        return normalizeAnnotationElements(drawingElements);
    }

    static migrateLegacySketches(slide = {}) {
        const migrated = [];
        (slide.elements || []).forEach(el => {
            if (el.type !== "sketch") return;
            migrated.push(...legacySketchElementToAnnotations(el, Number(el.x) || 0, Number(el.y) || 0));
        });
        return migrated;
    }

    static commitAnnotationsToSlide(slide, annotations = [], options = {}) {
        if (!slide) return slide;
        slide.whiteboardElements = normalizeAnnotationElements(annotations);
        if (options.removeEmbeddedWhiteboards !== false && Array.isArray(slide.elements)) {
            slide.elements = slide.elements.filter(el => el.type !== "whiteboard");
        }
        return slide;
    }

    static drawingElementToSlideElement(drawingEl, bounds, id, zIndex, previous = null) {
        return {
            id,
            type: "whiteboard",
            x: bounds.x,
            y: bounds.y,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            drawingElement: localizeDrawingElement(drawingEl, bounds),
            drawingViewBox: { width: bounds.width, height: bounds.height },
            styles: {
                ...(previous?.styles || {}),
                zIndex,
                backgroundColor: "transparent",
                borderRadius: "0px",
            },
            animation: previous?.animation || null,
            fragmentAnimation: previous?.fragmentAnimation || "none",
            fragmentIndex: previous?.fragmentIndex ?? null,
        };
    }
}
