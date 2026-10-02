import { PromptToGraph } from "./PromptToGraph.js";

export class MethodsTextToWorkflow {
    static convertLocal(methodsText = "") {
        return PromptToGraph.generateLocal(methodsText);
    }
}
