import { GRAPH_EDGE_ROLES } from "./semanticRoles.js";

export const GRAPH_EDGE_TYPES = Object.freeze({
    DEPENDENCY: {
        type: "dependency",
        role: GRAPH_EDGE_ROLES.DEPENDENCY,
        arrow: "arrow",
        routing: "orthogonal",
    },
    DATA_FLOW: {
        type: "data-flow",
        role: GRAPH_EDGE_ROLES.DATA_FLOW,
        arrow: "arrow",
        routing: "orthogonal",
    },
    ACTIVATION: {
        type: "activation",
        role: GRAPH_EDGE_ROLES.ACTIVATION,
        arrow: "arrow",
        routing: "curved",
    },
    INHIBITION: {
        type: "inhibition",
        role: GRAPH_EDGE_ROLES.INHIBITION,
        arrow: "bar",
        routing: "curved",
    },
    TRANSITION: {
        type: "transition",
        role: GRAPH_EDGE_ROLES.TRANSITION,
        arrow: "arrow",
        routing: "curved",
    },
});
