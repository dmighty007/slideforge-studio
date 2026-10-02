export class HistoryManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 50;
    }

    pushState(elements) {
        const serialized = JSON.stringify(elements);
        this.undoStack.push(serialized);
        this.redoStack = [];

        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }
    }

    undo(currentElements) {
        if (this.undoStack.length === 0) return null;

        this.redoStack.push(JSON.stringify(currentElements));
        const prev = this.undoStack.pop();
        return JSON.parse(prev);
    }

    redo(currentElements) {
        if (this.redoStack.length === 0) return null;

        this.undoStack.push(JSON.stringify(currentElements));
        const next = this.redoStack.pop();
        return JSON.parse(next);
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
}
