export class GraphStore {
    constructor(document = null) {
        this.document = document;
        this.listeners = new Set();
    }

    set(document) {
        this.document = document;
        this.listeners.forEach(listener => listener(document));
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
