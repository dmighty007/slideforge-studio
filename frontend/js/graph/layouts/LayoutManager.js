import { layoutGraphModel } from "../../mermaid/mermaid-graph.js";
import { documentToGraphModel, updateDocumentFromGraphModel } from "../../mermaid/mermaid-document.js";

export class LayoutManager {
    static async layout(document = {}, options = {}) {
        const engine = options.engine || document.layoutState?.engine || "slideforge-hierarchical";
        if (engine === "elk" && typeof Worker !== "undefined") {
            try {
                return await this.layoutInWorker(document, { ...options, engine });
            } catch (_error) {
                // Fall through to deterministic built-in layout.
            }
        }
        const graphModel = layoutGraphModel(documentToGraphModel(document), {
            preservePositions: options.preservePositions !== false,
        });
        return updateDocumentFromGraphModel(document, graphModel, {
            interaction: "layout",
            preservePositions: true,
            styles: document.styles || {},
        });
    }

    static layoutInWorker(document, options = {}) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(new URL("./LayoutWorker.js", import.meta.url), { type: "module" });
            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error("Graph layout worker timed out."));
            }, options.timeout || 1800);
            worker.onmessage = event => {
                clearTimeout(timeout);
                worker.terminate();
                resolve(event.data?.document || document);
            };
            worker.onerror = error => {
                clearTimeout(timeout);
                worker.terminate();
                reject(error);
            };
            worker.postMessage({ document, options });
        });
    }
}
