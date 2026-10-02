import { validateScientificGraph } from "../schema/validationRules.js";
import { GraphPlaybackEngine } from "../animation/GraphPlaybackEngine.js";

export const GRAPH_AI_ACTIONS = Object.freeze([
    "prompt-to-graph",
    "methods-text-to-workflow",
    "paper-section-to-diagram",
    "auto-cluster-nodes",
    "beautify-graph",
    "simplify-workflow",
    "rough-sketch-to-graph",
    "generate-mermaid",
    "summarize-graph",
    "identify-bottlenecks",
    "semantic-layout",
    "presentation-narrative",
    "animation-sequence",
    "detect-simulation-pipeline",
    "infer-analysis-dependencies",
    "reproducibility-gap-check",
]);

export class GraphAiActions {
    static analyzeScientificWorkflow(document = {}) {
        return {
            warnings: validateScientificGraph(document),
            suggestedSteps: GraphPlaybackEngine.buildDefaultSteps(document),
            summary: `${document.nodes?.length || 0} stages, ${document.edges?.length || 0} dependencies`,
        };
    }

    static createPatchForWarnings(warnings = []) {
        return {
            metadata: {
                aiWarnings: warnings,
                aiReviewedAt: Date.now(),
            },
        };
    }
}
