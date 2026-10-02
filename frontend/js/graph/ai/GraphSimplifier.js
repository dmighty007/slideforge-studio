export class GraphSimplifier {
    static findLowInformationNodes(document = {}) {
        return (document.nodes || []).filter(node => /^(step|process|node)\s*\d*$/i.test(node.label || ""));
    }
}
