export class GraphPlaybackEngine {
    static buildDefaultSteps(document = {}) {
        const order = document.presentationState?.revealOrder?.length
            ? document.presentationState.revealOrder
            : (document.nodes || []).map(node => node.id);
        return order.map((id, index) => ({
            id: `step_${index + 1}`,
            action: "reveal",
            targetIds: [id],
            duration: 520,
        }));
    }
}
