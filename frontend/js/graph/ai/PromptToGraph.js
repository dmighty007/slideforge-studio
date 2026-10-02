import { createSemanticGraphDocument } from "../schema/graphSchema.js";

export class PromptToGraph {
    static generateLocal(prompt = "") {
        const stages = String(prompt || "")
            .split(/(?:,|;|then|->|\n)/i)
            .map(item => item.trim())
            .filter(Boolean)
            .slice(0, 12);
        const nodes = (stages.length ? stages : ["Start", "Analyze", "Present"]).map((label, index) => ({
            id: `node_${index + 1}`,
            label,
            type: "process",
            semanticRole: /figure|plot|visual/i.test(label) ? "figure" : /analysis|analyze|model/i.test(label) ? "analysis" : "process",
            geometry: { x: 80 + index * 180, y: 180, width: 150, height: 64 },
        }));
        const edges = nodes.slice(1).map((node, index) => ({
            id: `edge_${index + 1}`,
            from: nodes[index].id,
            to: node.id,
            type: "dependency",
            semanticRole: "dependency",
        }));
        return createSemanticGraphDocument({ type: "workflow", title: "AI generated workflow", nodes, edges });
    }
}
