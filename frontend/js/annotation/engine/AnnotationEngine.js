import { DrawingEngine } from "../../drawing/DrawingEngine.js";
import { AnnotationSerializer } from "./AnnotationSerializer.js";

export class AnnotationEngine extends DrawingEngine {
    setAnnotationObjects(annotations = []) {
        this.setElements(AnnotationSerializer.annotationsToDrawingElements(annotations));
    }

    getAnnotationObjects() {
        return AnnotationSerializer.drawingElementsToAnnotations(this.getElements());
    }
}
