export const GRAPH_DOMAINS = Object.freeze({
    GENERAL: "general",
    MOLECULAR_DYNAMICS: "molecular-dynamics",
    ENHANCED_SAMPLING: "enhanced-sampling",
    WEIGHTED_ENSEMBLE: "weighted-ensemble",
    KINETICS: "kinetics",
    FREE_ENERGY: "free-energy",
    COMPUTATIONAL_PIPELINE: "computational-pipeline",
    SYSTEMS_BIOLOGY: "systems-biology",
    EXPERIMENTAL_DESIGN: "experimental-design",
});

export const GRAPH_NODE_ROLES = Object.freeze({
    PROCESS: "process",
    DECISION: "decision",
    DATA: "data",
    COMPUTE: "compute",
    ANALYSIS: "analysis",
    VALIDATION: "validation",
    FIGURE: "figure",
    MANUSCRIPT: "manuscript",
    MOLECULAR_PATHWAY: "molecular-pathway",
});

export const GRAPH_EDGE_ROLES = Object.freeze({
    DATA_FLOW: "data-flow",
    CONTROL_FLOW: "control-flow",
    DEPENDENCY: "dependency",
    ACTIVATION: "activation",
    INHIBITION: "inhibition",
    TRANSITION: "transition",
    MESSAGE: "message",
});
