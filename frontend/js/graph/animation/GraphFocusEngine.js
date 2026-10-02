export class GraphFocusEngine {
    static focusPath(document = {}, path = []) {
        return {
            ...document,
            presentationState: {
                ...(document.presentationState || {}),
                focusPath: path,
            },
        };
    }
}
