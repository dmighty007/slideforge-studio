import { MOLECULAR_DYNAMICS_PRIMITIVES, createMdPipelineTemplate } from "./scientific/molecularDynamics.js";

const registry = new Map();

export const GraphPrimitiveRegistry = {
    register(primitive) {
        if (!primitive?.subtype && !primitive?.id) return;
        registry.set(primitive.subtype || primitive.id, primitive);
    },
    get(id) {
        return registry.get(id) || null;
    },
    list() {
        return [...registry.values()];
    },
    createTemplate(id) {
        if (id === "molecular-dynamics-pipeline") return createMdPipelineTemplate();
        return null;
    },
};

MOLECULAR_DYNAMICS_PRIMITIVES.forEach(primitive => GraphPrimitiveRegistry.register(primitive));
