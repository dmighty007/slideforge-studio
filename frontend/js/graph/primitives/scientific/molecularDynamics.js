import { SCIENTIFIC_NODE_TYPES } from "../../schema/nodeTypes.js";

export const MOLECULAR_DYNAMICS_PRIMITIVES = Object.freeze([
    SCIENTIFIC_NODE_TYPES.DATABASE_IMPORT,
    SCIENTIFIC_NODE_TYPES.MD_MINIMIZATION,
    SCIENTIFIC_NODE_TYPES.MD_EQUILIBRATION,
    SCIENTIFIC_NODE_TYPES.MD_PRODUCTION,
    SCIENTIFIC_NODE_TYPES.ENHANCED_SAMPLING,
    SCIENTIFIC_NODE_TYPES.PATH_CV,
    SCIENTIFIC_NODE_TYPES.WE_BINNING,
    SCIENTIFIC_NODE_TYPES.TRAJECTORY_PROCESSING,
    SCIENTIFIC_NODE_TYPES.CLUSTERING,
    SCIENTIFIC_NODE_TYPES.MSM_ANALYSIS,
    SCIENTIFIC_NODE_TYPES.FREE_ENERGY,
    SCIENTIFIC_NODE_TYPES.NOTEBOOK,
    SCIENTIFIC_NODE_TYPES.FIGURE_GENERATION,
    SCIENTIFIC_NODE_TYPES.MANUSCRIPT,
]);

export function createMdPipelineTemplate() {
    const sequence = [
        "database-import",
        "md-minimization",
        "md-equilibration",
        "md-production-run",
        "trajectory-processing",
        "clustering",
        "msm-analysis",
        "figure-generation",
        "manuscript-stage",
    ];
    const nodes = sequence.map((subtype, index) => {
        const primitive = MOLECULAR_DYNAMICS_PRIMITIVES.find(item => item.subtype === subtype);
        return {
            id: subtype.replace(/-/g, "_"),
            type: primitive?.shape || "process",
            subtype,
            label: primitive?.label || subtype,
            semanticRole: primitive?.role || "process",
            scientific: { domain: primitive?.domain || "molecular-dynamics", suggestedNext: primitive?.suggestedNext || [] },
            geometry: { x: 80 + index * 190, y: 160, width: 160, height: 68 },
        };
    });
    const edges = nodes.slice(1).map((node, index) => ({
        id: `edge_${nodes[index].id}_${node.id}`,
        from: nodes[index].id,
        to: node.id,
        type: "data-flow",
        semanticRole: "data-flow",
    }));
    return { type: "scientific-workflow", title: "Molecular dynamics workflow", nodes, edges };
}
