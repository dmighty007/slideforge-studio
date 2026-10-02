export function validateScientificGraph(document = {}) {
    const warnings = [];
    const nodes = document.nodes || [];
    const edges = document.edges || [];
    const subtypes = new Set(nodes.map(node => node.subtype).filter(Boolean));
    const hasIncoming = subtype => {
        const targets = nodes.filter(node => node.subtype === subtype).map(node => node.id);
        return edges.some(edge => targets.includes(edge.to));
    };

    if (subtypes.has("md-production-run") && !subtypes.has("md-minimization")) {
        warnings.push({ code: "missing-minimization", message: "Production MD usually needs an energy minimization stage." });
    }
    if (subtypes.has("md-production-run") && !subtypes.has("md-equilibration")) {
        warnings.push({ code: "missing-equilibration", message: "Production MD usually needs equilibration before the run." });
    }
    if (subtypes.has("msm-analysis") && !subtypes.has("clustering") && !hasIncoming("msm-analysis")) {
        warnings.push({ code: "msm-input-gap", message: "MSM analysis should receive clustered trajectories or defined states." });
    }
    if (subtypes.has("free-energy-calculation") && !subtypes.has("enhanced-sampling") && !subtypes.has("pathcv")) {
        warnings.push({ code: "free-energy-context", message: "Free energy calculations need sampling/CV context." });
    }
    return warnings;
}
