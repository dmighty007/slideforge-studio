export class GraphNarrativeBuilder {
    static buildNarrative(document = {}) {
        const title = document.title || "workflow";
        const stages = (document.nodes || []).slice(0, 8).map(node => node.label);
        return {
            title,
            bullets: stages.map((label, index) => `${index + 1}. ${label}`),
            focusPath: (document.nodes || []).slice(0, 6).map(node => node.id),
        };
    }
}
