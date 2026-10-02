export class ConnectorController {
    static inferEdgeType(fromNode = {}, toNode = {}) {
        if (fromNode.scientific?.domain === "systems-biology" || toNode.scientific?.domain === "systems-biology") return "activation";
        return "dependency";
    }
}
