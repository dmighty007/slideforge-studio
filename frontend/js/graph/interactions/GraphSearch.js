export class GraphSearch {
    static search(document = {}, query = "") {
        const q = String(query || "").toLowerCase();
        if (!q) return [];
        return (document.nodes || []).filter(node => [node.label, node.subtype, node.semanticRole].join(" ").toLowerCase().includes(q));
    }
}
