export class ExportValidator {
    static validateScene(scene = {}, options = {}) {
        const issues = [];
        const page = scene.deck?.page || {};
        if (!Number(page.width) || !Number(page.height)) {
            issues.push({ severity: "error", message: "Scene page size is missing." });
        }
        (scene.slides || []).forEach(slide => {
            (slide.layers || []).forEach(layer => {
                (layer.nodes || []).forEach(node => {
                    const b = node.bounds || {};
                    // Objects an SVG cannot hold (video, embeds, PDFs, 3D molecules) become labelled boxes: say so.
                    if (node.exportPolicy === "placeholder") {
                        issues.push({
                            severity: "warning",
                            slideId: slide.id,
                            nodeId: node.id,
                            lost: node.type,
                            message: `${node.type} will export as a placeholder.`,
                        });
                    }
                    if (b.width < 0 || b.height < 0) {
                        issues.push({
                            severity: "error",
                            slideId: slide.id,
                            nodeId: node.id,
                            message: "Node has negative dimensions.",
                        });
                    }
                    if (node.type === "image" && !node.src) {
                        issues.push({
                            severity: "warning",
                            slideId: slide.id,
                            nodeId: node.id,
                            lost: node.pluginId ? `plugin object (${node.pluginId})` : "image",
                            message: node.pluginId ? `The ${node.pluginId} object has no picture yet.` : "Image node has no source.",
                        });
                    }
                });
            });
        });
        return {
            ok: !issues.some(issue => issue.severity === "error"),
            issues,
        };
    }
}
