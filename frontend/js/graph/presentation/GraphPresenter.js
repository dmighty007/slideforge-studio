import { GraphPlaybackEngine } from "../animation/GraphPlaybackEngine.js";

export class GraphPresenter {
    static getSteps(document = {}) {
        return document.presentationState?.steps?.length ? document.presentationState.steps : GraphPlaybackEngine.buildDefaultSteps(document);
    }
}
