import { AnnotationSerializer } from "../engine/AnnotationSerializer.js";

export class PresenterAnnotationLayer {
    static saveTemporaryDrawingToSlide(slide, drawingElements = []) {
        const annotations = AnnotationSerializer.drawingElementsToAnnotations(drawingElements).map(annotation => ({
            ...annotation,
            presentation: { ...(annotation.presentation || {}), mode: "persistent", audienceVisible: true },
        }));
        const existing = AnnotationSerializer.slideToAnnotations(slide);
        AnnotationSerializer.commitAnnotationsToSlide(slide, [...existing, ...annotations]);
        return slide.whiteboardElements;
    }
}
