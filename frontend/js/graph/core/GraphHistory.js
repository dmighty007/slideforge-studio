export class GraphHistory {
    constructor(limit = 80) {
        this.limit = limit;
        this.undoStack = [];
        this.redoStack = [];
    }

    push(document) {
        this.undoStack.push(JSON.stringify(document));
        this.redoStack = [];
        if (this.undoStack.length > this.limit) this.undoStack.shift();
    }

    undo(current) {
        const previous = this.undoStack.pop();
        if (!previous) return null;
        this.redoStack.push(JSON.stringify(current));
        return JSON.parse(previous);
    }
}
