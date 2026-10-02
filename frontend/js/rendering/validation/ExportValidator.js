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
                    if (node.exportPolicy === "placeholder" && options.profile?.id === "publication") {
                        issues.push({
                            severity: "warning",
                            slideId: slide.id,
                            nodeId: node.id,
                            message: `${node.type} will export as a placeholder in publication profile.`,
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
                            message: "Image node has no source.",
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
