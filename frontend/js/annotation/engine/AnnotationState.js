export class AnnotationState {
    constructor() {
        this.activeTool = "select";
        this.mode = "edit";
        this.sessionAnnotations = [];
        this.selectedIds = [];
    }
}
