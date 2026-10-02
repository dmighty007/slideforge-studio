import { GraphNarrativeBuilder } from "../ai/GraphNarrativeBuilder.js";

export class GraphStoryMode {
    static fromDocument(document = {}) {
        return GraphNarrativeBuilder.buildNarrative(document);
    }
}
