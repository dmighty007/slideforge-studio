import { compileStateToRenderScene } from "../scene/SceneCompiler.js";
import { SvgRenderer } from "../renderers/SvgRenderer.js";
import { resolveExportProfile } from "./ExportProfiles.js";
import { ExportValidator } from "../validation/ExportValidator.js";

// Classic-script globals (including top-level let/const) resolve by bare name from this module.
// A static table avoids Function(), which the Content-Security-Policy blocks.
const GLOBAL_READERS = {
    currentSlideIndex: () => (typeof currentSlideIndex !== "undefined" ? currentSlideIndex : undefined),
    state: () => (typeof state !== "undefined" ? state : undefined),
};

function readGlobal(name, fallback = undefined) {
    try {
        const value = GLOBAL_READERS[name]?.();
        return value === undefined ? fallback : value;
    } catch (_error) {
        return fallback;
    }
}

function downloadTextFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export class ExportController {
    static compileScene(options = {}) {
        return compileStateToRenderScene(readGlobal("state", window.state), options);
    }

    static validate(scene, options = {}) {
        return ExportValidator.validateScene(scene, options);
    }

    static exportSceneSvg(options = {}) {
        const profile = resolveExportProfile(options.profile || "publication");
        const scene = this.compileScene({ ...options, profile });
        const validation = this.validate(scene, { profile });
        if (!validation.ok) {
            const message = validation.issues.map(issue => issue.message).join("\n") || "Export validation failed.";
            throw new Error(message);
        }
        const svg = options.slideIndex === undefined
            ? SvgRenderer.renderScene(scene)
            : SvgRenderer.renderSlide(scene.slides[options.slideIndex], scene);
        const filename = options.filename || (options.slideIndex === undefined ? "slideforge-scene.svg" : `slide-${options.slideIndex + 1}.svg`);
        downloadTextFile(svg, filename, "image/svg+xml;charset=utf-8");
        return { scene, svg, validation };
    }

    static exportCurrentSlideSvg(options = {}) {
        const currentSlideIndex = readGlobal("currentSlideIndex", window.currentSlideIndex);
        const index = Number.isFinite(Number(options.slideIndex)) ? Number(options.slideIndex) : Number(currentSlideIndex) || 0;
        return this.exportSceneSvg({ ...options, slideIndex: index });
    }
}

// "Slide SVG exported." or, when objects could not be kept, which ones became placeholder boxes.
function exportedMessage(result, done) {
    const lost = (result?.validation?.issues || []).filter(issue => issue.lost && (result.svg || "").includes(`data-node-id="${issue.nodeId}"`));
    if (!lost.length) return { text: done, tone: "success" };
    const kinds = [...new Set(lost.map(issue => issue.lost))].join(", ");
    return { text: `${done} ${lost.length} object${lost.length === 1 ? "" : "s"} (${kinds}) could not be drawn in SVG and show as labelled boxes.`, tone: "warn" };
}

window.SlideForgeExportEngine = ExportController;
window.compileSlideForgeRenderScene = options => ExportController.compileScene(options);
window.exportPresentationSceneSVG = options => {
    try {
        window.setProjectSaveHint?.("Generating deterministic SVG...", "success");
        const result = ExportController.exportSceneSvg(options || {});
        const message = exportedMessage(result, "SVG scene exported.");
        window.setProjectSaveHint?.(message.text, message.tone);
        return result;
    } catch (error) {
        console.error(error);
        window.setProjectSaveHint?.(error?.message || "SVG scene export failed", "danger");
        return null;
    }
};
window.exportCurrentSlideSceneSVG = options => {
    try {
        window.setProjectSaveHint?.("Generating slide SVG...", "success");
        const result = ExportController.exportCurrentSlideSvg(options || {});
        const message = exportedMessage(result, "Slide SVG exported.");
        window.setProjectSaveHint?.(message.text, message.tone);
        return result;
    } catch (error) {
        console.error(error);
        window.setProjectSaveHint?.(error?.message || "Slide SVG export failed", "danger");
        return null;
    }
};
