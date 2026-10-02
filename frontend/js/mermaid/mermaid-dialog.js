import { MERMAID_THEME_PALETTES, mermaidRenderModes, normalizeMermaidStyle, renderMermaid, validateMermaid, sanitizeMermaidSvg } from "./mermaid-engine.js";
import { exportMermaidSvg } from "./mermaid-export.js";
import { createMermaidElementData, insertMermaidElement, updateMermaidElement } from "./mermaid-object.js";
import { canUseVisualGraph, diagnoseFlowchart, graphToMermaid, graphToSvg, layoutGraphModel, makeNode, parseMermaidToGraph, stripGraphMetadata } from "./mermaid-graph.js";
import {
    SCIENTIFIC_WORKFLOW_PRIMITIVES,
    applyPresentationPreset,
    createGraphDocument,
    documentToGraphModel,
    updateDocumentFromGraphModel,
} from "./mermaid-document.js";
import { DEFAULT_MERMAID_TEMPLATE, MERMAID_TEMPLATES, inferMermaidType } from "./mermaid-templates.js";
import { ensureGraphElementDocument, ensureSemanticGraphDocument } from "../graph/schema/migrations.js";
import { MermaidExporter } from "../graph/parsers/MermaidExporter.js";
import { SvgGraphRenderer } from "../graph/renderers/SvgGraphRenderer.js";
import { validateScientificGraph } from "../graph/schema/validationRules.js";

const THEMES = ["default", "neutral", "dark", "forest", "base"];
let dialogState = null;
let debounceTimer = null;
let dragState = null;

// Classic-script globals (including top-level let/const) resolve by bare name from this module.
// A static table avoids Function(), which the Content-Security-Policy blocks.
const GLOBAL_READERS = {
    currentSlideIndex: () => (typeof currentSlideIndex !== "undefined" ? currentSlideIndex : undefined),
    saveStateToUndo: () => (typeof saveStateToUndo !== "undefined" ? saveStateToUndo : undefined),
    state: () => (typeof state !== "undefined" ? state : undefined),
};

function readGlobal(name, fallback = null) {
    try {
        const value = GLOBAL_READERS[name]?.();
        return value === undefined ? fallback : value;
    } catch (_err) {
        return fallback;
    }
}

function getCurrentMermaidElement(id) {
    const state = readGlobal("state");
    const currentSlideIndex = readGlobal("currentSlideIndex", 0);
    return state?.slides?.[currentSlideIndex]?.elements?.find(el => el.id === id && el.type === "mermaid") || null;
}

function ensureDialog() {
    let shell = document.getElementById("mermaid-dialog");
    if (shell) return shell;
    shell = document.createElement("div");
    shell.id = "mermaid-dialog";
    shell.className = "mermaid-dialog-shell hidden";
    shell.innerHTML = `
        <div class="mermaid-dialog-backdrop" data-mermaid-close></div>
        <section class="mermaid-dialog-panel" role="dialog" aria-modal="true" aria-label="Mermaid diagram editor">
            <header class="mermaid-dialog-header">
                <div>
                    <div class="mermaid-dialog-title">Flowchart / Mermaid Diagram</div>
                    <div class="mermaid-dialog-subtitle">Slide-native graph authoring with Mermaid import/export.</div>
                </div>
                <div class="mermaid-mode-switch" role="tablist" aria-label="Mermaid editor mode">
                    <button type="button" id="mermaid-mode-visual" class="mermaid-mode-button is-active" data-mode="visual">Visual</button>
                    <button type="button" id="mermaid-mode-split" class="mermaid-mode-button" data-mode="split">Split</button>
                    <button type="button" id="mermaid-mode-code" class="mermaid-mode-button" data-mode="code">Code</button>
                </div>
                <button type="button" class="mermaid-icon-button" data-mermaid-close title="Close"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <div class="mermaid-dialog-body">
                <div class="mermaid-editor-pane">
                    <div class="mermaid-pane-label">Mermaid source</div>
                    <div id="mermaid-editor-host" class="mermaid-editor-host"></div>
                </div>
                <div class="mermaid-preview-pane">
                    <div class="mermaid-pane-label">
                        <span>Interactive diagram</span>
                        <span class="mermaid-pane-hint mermaid-graph-only">Drag nodes. Double-click canvas to add. Drag handles to connect.</span>
                    </div>
                    <div id="mermaid-preview" class="mermaid-preview"></div>
                    <div id="mermaid-inline-editor" class="mermaid-inline-editor hidden" contenteditable="true" spellcheck="false"></div>
                    <div id="mermaid-floating-toolbar" class="mermaid-floating-toolbar mermaid-graph-only hidden">
                        <button type="button" data-toolbar-action="connect" title="Quick connect"><i class="fa-solid fa-arrow-right"></i></button>
                        <button type="button" data-toolbar-action="duplicate" title="Duplicate"><i class="fa-regular fa-copy"></i></button>
                        <button type="button" data-toolbar-action="shape" title="Toggle shape"><i class="fa-regular fa-circle"></i></button>
                        <button type="button" data-toolbar-action="color" title="Color"><i class="fa-solid fa-droplet"></i></button>
                        <button type="button" data-toolbar-action="align" title="Align"><i class="fa-solid fa-align-center"></i></button>
                        <button type="button" data-toolbar-action="layout" title="Layout selection"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                        <button type="button" data-toolbar-action="animate" title="Animation preset"><i class="fa-solid fa-person-running"></i></button>
                        <button type="button" data-toolbar-action="delete" title="Delete"><i class="fa-regular fa-trash-can"></i></button>
                    </div>
                    <div id="mermaid-marquee" class="mermaid-marquee hidden"></div>
                    <div id="mermaid-minimap" class="mermaid-minimap hidden"></div>
                    <div id="mermaid-diagnostics" class="mermaid-diagnostics" aria-live="polite"></div>
                </div>
                <aside class="mermaid-inspector-pane" aria-label="Diagram style inspector">
                    <div class="mermaid-inspector-section">
                        <div class="mermaid-inspector-title">Diagram Style</div>
                        <label class="mermaid-field">
                            <span>Font</span>
                            <select id="mermaid-font-family" class="mermaid-select mermaid-font-select" title="Font">
                                <option value="Inter, Arial, sans-serif">Inter</option>
                                <option value="Arial, sans-serif">Arial</option>
                                <option value="Georgia, serif">Georgia</option>
                                <option value="'Comic Sans MS', 'Comic Neue', cursive">Cursive</option>
                                <option value="'Caveat', 'Bradley Hand', cursive">Handwritten</option>
                                <option value="'Architects Daughter', 'Comic Sans MS', cursive">XKCD</option>
                                <option value="Courier New, monospace">Mono</option>
                            </select>
                        </label>
                        <label class="mermaid-field">
                            <span>Size</span>
                            <input id="mermaid-font-size" type="number" min="10" max="28" value="16" title="Font size in pixels">
                        </label>
                        <label class="mermaid-field">
                            <span>Shape</span>
                            <select id="mermaid-render-mode" class="mermaid-select">
                                <option value="real">Real</option>
                                <option value="draw">Draw</option>
                                <option value="sketch">Sketch</option>
                            </select>
                        </label>
                        <label class="mermaid-field">
                            <span>Node fill</span>
                            <input id="mermaid-primary-color" type="color">
                        </label>
                        <label class="mermaid-field">
                            <span>Text</span>
                            <input id="mermaid-text-color" type="color">
                        </label>
                        <label class="mermaid-field">
                            <span>Line</span>
                            <input id="mermaid-line-color" type="color">
                        </label>
                    </div>
                    <div class="mermaid-inspector-section">
                        <div class="mermaid-inspector-title">Selected</div>
                        <div id="mermaid-selected-part-label" class="mermaid-selected-part-label">Select a node or edge</div>
                        <label class="mermaid-field mermaid-graph-only">
                            <span>Label</span>
                            <input id="mermaid-selected-label" type="text" placeholder="Label">
                        </label>
                        <label class="mermaid-field mermaid-graph-only">
                            <span>Shape</span>
                            <select id="mermaid-selected-shape" class="mermaid-select">
                                <option value="process">Process</option>
                                <option value="decision">Decision</option>
                                <option value="database">Database</option>
                                <option value="cloud">Cloud</option>
                                <option value="actor">Actor</option>
                                <option value="queue">Queue</option>
                                <option value="hexagon">Hexagon</option>
                                <option value="parallelogram">Data</option>
                                <option value="terminal">Terminal</option>
                                <option value="document">Document</option>
                                <option value="scientific">Scientific</option>
                            </select>
                        </label>
                        <label class="mermaid-field mermaid-graph-only">
                            <span>Font</span>
                            <select id="mermaid-selected-font-family" class="mermaid-select" title="Font family for selected item">
                                <option value="">Inherit</option>
                                <option value="Inter, Arial, sans-serif">Inter</option>
                                <option value="Arial, sans-serif">Arial</option>
                                <option value="Georgia, serif">Georgia</option>
                                <option value="'Comic Sans MS', 'Comic Neue', cursive">Cursive</option>
                                <option value="'Caveat', 'Bradley Hand', cursive">Handwritten</option>
                                <option value="'Architects Daughter', 'Comic Sans MS', cursive">XKCD</option>
                                <option value="Courier New, monospace">Mono</option>
                            </select>
                        </label>
                        <label class="mermaid-field mermaid-graph-only">
                            <span>Size</span>
                            <input id="mermaid-selected-font-size" type="number" min="8" max="48" placeholder="Inherit" title="Font size in pixels">
                        </label>
                        <label class="mermaid-field mermaid-graph-only">
                            <span>Text Color</span>
                            <input id="mermaid-selected-text-color" type="color" value="#0f172a">
                        </label>
                        <label class="mermaid-field">
                            <span>Fill Color</span>
                            <input id="mermaid-part-color" type="color" value="#4f46e5">
                        </label>
                        <div class="mermaid-part-actions">
                            <button type="button" id="mermaid-part-fill" class="mermaid-secondary-button" title="Apply to selected fill">Fill</button>
                            <button type="button" id="mermaid-part-stroke" class="mermaid-secondary-button" title="Apply to selected stroke">Stroke</button>
                            <button type="button" id="mermaid-part-text" class="mermaid-secondary-button" title="Apply to selected text">Text Color</button>
                        </div>
                        <div class="mermaid-part-actions mermaid-graph-only">
                            <button type="button" id="mermaid-add-child" class="mermaid-secondary-button" title="Add child node">Child</button>
                            <button type="button" id="mermaid-add-sibling" class="mermaid-secondary-button" title="Add sibling node">Sibling</button>
                            <button type="button" id="mermaid-delete-item" class="mermaid-secondary-button" title="Delete selected item">Delete</button>
                        </div>
                    </div>
                    <div class="mermaid-inspector-section mermaid-graph-only">
                        <div class="mermaid-inspector-title">Layout</div>
                        <label class="mermaid-field">
                            <span>Mode</span>
                            <select id="mermaid-layout-mode" class="mermaid-select">
                                <option value="assisted">Assisted</option>
                                <option value="manual">Manual</option>
                            </select>
                        </label>
                        <label class="mermaid-field">
                            <span>Routing</span>
                            <select id="mermaid-routing-style" class="mermaid-select">
                                <option value="orthogonal">Orthogonal</option>
                                <option value="curved">Curved</option>
                            </select>
                        </label>
                        <button type="button" id="mermaid-improve-layout" class="mermaid-secondary-button"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Improve Layout</span></button>
                    </div>
                    <div class="mermaid-inspector-section mermaid-inspector-section-collapsed mermaid-graph-only">
                        <div class="mermaid-inspector-title">Story</div>
                        <button type="button" id="mermaid-branch-reveal" class="mermaid-secondary-button"><i class="fa-solid fa-route"></i><span>Branch Reveal</span></button>
                        <button type="button" id="mermaid-add-science-stage" class="mermaid-secondary-button"><i class="fa-solid fa-atom"></i><span>Scientific Stage</span></button>
                    </div>
                </aside>
            </div>
            <footer class="mermaid-dialog-toolbar">
                <div class="mermaid-toolbar-group">
                    <select id="mermaid-template-select" class="mermaid-select" title="Templates"></select>
                    <select id="mermaid-theme-select" class="mermaid-select" title="Theme"></select>
                </div>
                <div class="mermaid-toolbar-spacer"></div>
                <button type="button" id="mermaid-validate-btn" class="mermaid-secondary-button"><i class="fa-solid fa-check"></i><span>Validate</span></button>
                <button type="button" id="mermaid-export-btn" class="mermaid-secondary-button"><i class="fa-solid fa-file-export"></i><span>SVG</span></button>
                <button type="button" id="mermaid-apply-btn" class="mermaid-primary-button">Insert</button>
            </footer>
        </section>
    `;
    document.body.appendChild(shell);
    installDialogDrag(shell);
    shell.addEventListener("click", event => {
        if (event.target.closest("[data-mermaid-close]")) closeMermaidDialog();
    });
    document.addEventListener("keydown", event => {
        // Escape while renaming a node ends the rename only (it closed the whole dialog too).
        if (event.key === "Escape" && !shell.classList.contains("hidden") && !event.defaultPrevented) closeMermaidDialog();
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "m") {
            event.preventDefault();
            openMermaidDialog();
        }
        if (!shell.classList.contains("hidden")) handleMermaidDialogKeys(event);
    });
    document.addEventListener("keyup", event => {
        if (event.key === " ") document.getElementById("mermaid-preview")?.classList.remove("is-pan-hint");
    });
    return shell;
}

function handleMermaidDialogKeys(event) {
    if (!dialogState?.graphModel || dialogState.editMode === "code") return;
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setDiagnostics("Lightweight grouping is queued for the next graph-model pass.", null);
    } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        zoomGraphToSelection();
    } else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        nudgeSelection(event.key, event.shiftKey ? 40 : 10);
    } else if (event.key === " ") {
        event.preventDefault();
        document.getElementById("mermaid-preview")?.classList.add("is-pan-hint");
    } else
    if (event.key === "Tab") {
        event.preventDefault();
        addRelatedNode("sibling");
    } else if (event.key === "Enter") {
        event.preventDefault();
        addRelatedNode("child");
    } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedGraphItem();
    }
}

function installDialogDrag(shell) {
    const panel = shell.querySelector(".mermaid-dialog-panel");
    const header = shell.querySelector(".mermaid-dialog-header");
    if (!panel || !header) return;
    header.addEventListener("pointerdown", event => {
        if (event.target.closest("button, select, input, textarea")) return;
        const rect = panel.getBoundingClientRect();
        dragState = {
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
        };
        panel.classList.add("is-dragging");
        panel.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    const movePanel = event => {
        if (!dragState) return;
        const maxLeft = Math.max(8, window.innerWidth - dragState.width - 8);
        const maxTop = Math.max(8, window.innerHeight - dragState.height - 8);
        const left = Math.max(8, Math.min(maxLeft, dragState.left + event.clientX - dragState.startX));
        const top = Math.max(8, Math.min(maxTop, dragState.top + event.clientY - dragState.startY));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.transform = "none";
    };
    const endDrag = event => {
        if (!dragState) return;
        dragState = null;
        panel.classList.remove("is-dragging");
        panel.releasePointerCapture?.(event.pointerId);
    };
    panel.addEventListener("pointermove", movePanel);
    panel.addEventListener("pointerup", endDrag);
    panel.addEventListener("pointercancel", endDrag);
}

// The dialog is built once and reused, so its controls are bound by assignment: addEventListener added another
// handler on every opening, and after four openings one click on "Child" added four nodes.
function bindDialogControl(id, type, handler) {
    const node = document.getElementById(id);
    if (node) node[`on${type}`] = handler;
}

function setupControls(element) {
    const templateSelect = document.getElementById("mermaid-template-select");
    const themeSelect = document.getElementById("mermaid-theme-select");
    const applyBtn = document.getElementById("mermaid-apply-btn");
    if (templateSelect) {
        templateSelect.innerHTML = MERMAID_TEMPLATES.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
        templateSelect.value = MERMAID_TEMPLATES.find(t => t.source === getEditorValue())?.id || DEFAULT_MERMAID_TEMPLATE.id;
        templateSelect.onchange = () => {
            const template = MERMAID_TEMPLATES.find(t => t.id === templateSelect.value) || DEFAULT_MERMAID_TEMPLATE;
            setEditorValue(template.source);
            rebuildGraphFromEditor({ forceLayout: true });
            schedulePreview();
        };
    }
    if (themeSelect) {
        themeSelect.innerHTML = THEMES.map(theme => `<option value="${theme}">${theme}</option>`).join("");
        themeSelect.value = element?.theme || "default";
        themeSelect.onchange = () => {
            const palette = MERMAID_THEME_PALETTES[themeSelect.value];
            if (palette) {
                document.getElementById("mermaid-primary-color").value = palette.primaryColor;
                document.getElementById("mermaid-text-color").value = palette.primaryTextColor;
                document.getElementById("mermaid-line-color").value = palette.lineColor;
            }
            if (dialogState?.graphModel) commitGraphChange("Theme applied", { syncEditor: false });
            schedulePreview({ immediate: true });
        };
    }
    const style = normalizeMermaidStyle(element?.style || {});
    const fontField = document.getElementById("mermaid-font-family");
    const fontSizeField = document.getElementById("mermaid-font-size");
    const fillField = document.getElementById("mermaid-primary-color");
    const textField = document.getElementById("mermaid-text-color");
    const lineField = document.getElementById("mermaid-line-color");
    const handDrawnField = document.getElementById("mermaid-hand-drawn");
    const renderModeField = document.getElementById("mermaid-render-mode");
    if (fontField) fontField.value = style.fontFamily;
    if (fontSizeField) fontSizeField.value = style.fontSize;
    if (fillField) fillField.value = style.primaryColor;
    if (textField) textField.value = style.primaryTextColor;
    if (lineField) lineField.value = style.lineColor;
    if (handDrawnField) handDrawnField.checked = Boolean(style.handDrawn);
    if (renderModeField) renderModeField.value = style.renderMode || (style.handDrawn ? "sketch" : "real");
    if (handDrawnField) {
        handDrawnField.oninput = () => {
            if (renderModeField) renderModeField.value = handDrawnField.checked ? "sketch" : "real";
            schedulePreview({ immediate: true });
        };
    }
    if (renderModeField) {
        renderModeField.oninput = () => {
            if (handDrawnField) handDrawnField.checked = renderModeField.value !== "real";
            schedulePreview({ immediate: true });
        };
    }
    [fontField, fontSizeField, fillField, textField, lineField].forEach(field => {
        if (field) field.oninput = () => schedulePreview({ immediate: field.type === "color" });
    });
    if (applyBtn) {
        applyBtn.textContent = element ? "Update" : "Insert";
        applyBtn.onclick = applyMermaidDialog;
    }
    bindDialogControl("mermaid-part-fill", "click", () => applySelectedPartColor("fill"));
    bindDialogControl("mermaid-part-stroke", "click", () => applySelectedPartColor("stroke"));
    bindDialogControl("mermaid-part-text", "click", () => applySelectedPartColor("text"));
    bindDialogControl("mermaid-selected-label", "input", event => updateSelectedLabel(event.target.value));
    bindDialogControl("mermaid-selected-shape", "change", event => updateSelectedShape(event.target.value));
    bindDialogControl("mermaid-selected-font-family", "change", event => updateSelectedFontFamily(event.target.value));
    bindDialogControl("mermaid-selected-font-size", "input", event => updateSelectedFontSize(event.target.value));
    bindDialogControl("mermaid-selected-text-color", "input", event => updateSelectedTextColor(event.target.value));
    bindDialogControl("mermaid-add-child", "click", () => addRelatedNode("child"));
    bindDialogControl("mermaid-add-sibling", "click", () => addRelatedNode("sibling"));
    bindDialogControl("mermaid-delete-item", "click", deleteSelectedGraphItem);
    bindDialogControl("mermaid-improve-layout", "click", () => {
        if (!dialogState?.graphModel) return;
        dialogState.graphModel = layoutGraphModel(dialogState.graphModel, { preservePositions: false });
        commitGraphChange("Layout improved", { syncEditor: true });
    });
    bindDialogControl("mermaid-branch-reveal", "click", () => applyGraphAnimationPreset("branch-reveal"));
    bindDialogControl("mermaid-add-science-stage", "click", addScientificStage);
    const layoutMode = document.getElementById("mermaid-layout-mode");
    if (layoutMode) {
        layoutMode.value = element?.lockedLayout ? "manual" : element?.autoLayout === false ? "manual" : "assisted";
        layoutMode.onchange = () => {
            if (!dialogState?.graphModel) return;
            const value = layoutMode.value;
            dialogState.graphModel.autoLayout = value !== "manual";
            dialogState.graphModel.lockedLayout = value === "manual";
            dialogState.lockedLayout = dialogState.graphModel.lockedLayout;
            dialogState.autoLayout = dialogState.graphModel.autoLayout;
            commitGraphChange("Layout mode updated", { syncEditor: true });
        };
    }
    const routing = document.getElementById("mermaid-routing-style");
    if (routing) {
        routing.value = element?.routingStyle || element?.graphModel?.routingStyle || "orthogonal";
        routing.onchange = () => {
            if (!dialogState?.graphModel) return;
            dialogState.graphModel.routingStyle = routing.value;
            dialogState.graphModel.edges.forEach(edge => { edge.routingStyle = routing.value; });
            dialogState.routingStyle = routing.value;
            commitGraphChange("Routing updated", { syncEditor: true });
        };
    }
    document.querySelectorAll(".mermaid-mode-button").forEach(button => {
        button.onclick = () => setEditorMode(button.dataset.mode || "split");
    });
    document.querySelectorAll("[data-toolbar-action]").forEach(button => {
        button.onclick = () => handleFloatingToolbarAction(button.dataset.toolbarAction);
    });
    bindDialogControl("mermaid-validate-btn", "click", () => runValidation({ force: true }));
    bindDialogControl("mermaid-export-btn", "click", () => {
        const svg = getPreviewSvgContent() || dialogState?.lastValidSvg || sanitizeMermaidSvg(element?.svgContent || "");
        if (!svg) {
            setDiagnostics("Render a valid diagram before exporting SVG.", false);
            return;
        }
        exportMermaidSvg({ svgContent: svg });
    });
}

function setupEditor(source) {
    const host = document.getElementById("mermaid-editor-host");
    if (!host) return;
    host.innerHTML = "";
    if (window.monaco?.editor) {
        const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "vs-dark" : "vs";
        const editor = window.monaco.editor.create(host, {
            value: source,
            language: "markdown",
            theme,
            minimap: { enabled: false },
            wordWrap: "on",
            fontSize: 13,
            automaticLayout: true,
        });
        editor.onDidChangeModelContent(() => {
            if (dialogState?.suppressEditorSync) return;
            rebuildGraphFromEditor();
            schedulePreview();
        });
        dialogState.editor = editor;
        dialogState.disposeEditor = () => editor.dispose();
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.className = "mermaid-source-textarea";
    textarea.spellcheck = false;
    textarea.value = source;
    textarea.addEventListener("input", () => {
        if (dialogState?.suppressEditorSync) return;
        rebuildGraphFromEditor();
        schedulePreview();
    });
    host.appendChild(textarea);
    dialogState.editor = textarea;
}

function getEditorValue() {
    const editor = dialogState?.editor;
    if (!editor) return "";
    if (typeof editor.getValue === "function") return editor.getValue();
    return editor.value || "";
}

// The code box shows plain Mermaid: node positions live in the element's graph, not in a "%% sf:graph" line.
function setEditorValue(value) {
    const editor = dialogState?.editor;
    if (!editor) return;
    value = stripGraphMetadata(value);
    if (typeof editor.setValue === "function") editor.setValue(value);
    else editor.value = value;
}

function syncEditorFromGraph() {
    if (!dialogState?.graphModel) return;
    dialogState.suppressEditorSync = true;
    setEditorValue(dialogState.graphDocument ? MermaidExporter.fromGraphDocument(dialogState.graphDocument) : graphToMermaid(dialogState.graphModel));
    dialogState.suppressEditorSync = false;
}

function syncDocumentFromGraph(interaction = "graph-update") {
    if (!dialogState?.graphModel) return null;
    const style = getSelectedStyle();
    dialogState.graphModel.style = style;
    const updatedDocument = updateDocumentFromGraphModel(
        dialogState.graphDocument || createGraphDocument({ graphModel: dialogState.graphModel, styles: style }),
        dialogState.graphModel,
        { interaction, styles: style },
    );
    dialogState.graphDocument = ensureSemanticGraphDocument(updatedDocument, {
        mermaidSource: getEditorValue(),
        style,
        graphModel: dialogState.graphModel,
    });
    dialogState.graphDocument.styles = style;
    dialogState.graphModel = documentToGraphModel(dialogState.graphDocument);
    dialogState.graphModel.style = style;
    return dialogState.graphDocument;
}

function rebuildGraphFromEditor(options = {}) {
    const source = getEditorValue();
    if (!canUseVisualGraph(source)) {
        dialogState.graphModel = null;
        dialogState.graphDocument = null;
        return null;
    }
    const legacyDocument = createGraphDocument({
        mermaidSource: source,
        graphModel: options.forceLayout ? null : dialogState.graphModel,
        styles: getSelectedStyle(),
        routingStyle: dialogState.routingStyle,
        autoLayout: dialogState.autoLayout,
        lockedLayout: dialogState.lockedLayout,
    });
    const previous = dialogState.graphDocument;
    dialogState.graphDocument = ensureSemanticGraphDocument(legacyDocument, {
        mermaidSource: source,
        style: getSelectedStyle(),
    });
    // The code describes the diagram, not how the show reveals it: Branch Reveal is kept through code edits (and
    // through reopening, which rebuilds the diagram from its code and switched it off).
    if (previous?.presentationState?.activePreset && !options.forceLayout) {
        dialogState.graphDocument.presentationState = { ...previous.presentationState };
        dialogState.graphDocument.animations = previous.animations || [];
    }
    dialogState.graphModel = documentToGraphModel(dialogState.graphDocument);
    dialogState.graphModel.style = getSelectedStyle();
    dialogState.graphModel.routingStyle = dialogState.routingStyle || dialogState.graphModel.routingStyle || "orthogonal";
    return dialogState.graphModel;
}

function getSelectedTheme() {
    return document.getElementById("mermaid-theme-select")?.value || "default";
}

function getSelectedStyle() {
    const renderMode = document.getElementById("mermaid-render-mode")?.value;
    return normalizeMermaidStyle({
        fontFamily: document.getElementById("mermaid-font-family")?.value,
        fontSize: document.getElementById("mermaid-font-size")?.value,
        primaryColor: document.getElementById("mermaid-primary-color")?.value,
        primaryTextColor: document.getElementById("mermaid-text-color")?.value,
        lineColor: document.getElementById("mermaid-line-color")?.value,
        renderMode,
        handDrawn: renderMode ? renderMode !== "real" : document.getElementById("mermaid-hand-drawn")?.checked,
    });
}

function setDiagnostics(message, ok = null) {
    const node = document.getElementById("mermaid-diagnostics");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("is-error", ok === false);
    node.classList.toggle("is-ok", ok === true);
}

function setSelectedPartLabel(part) {
    const label = document.getElementById("mermaid-selected-part-label");
    if (!label) return;
    label.textContent = part ? part : "Select a node or edge";
    label.classList.toggle("has-selection", Boolean(part));
}

function setEditorMode(mode = "split") {
    if (!dialogState) return;
    dialogState.editMode = ["visual", "code", "split"].includes(mode) ? mode : "split";
    const shell = document.getElementById("mermaid-dialog");
    shell?.classList.remove("mermaid-mode-visual-active", "mermaid-mode-code-active", "mermaid-mode-split-active");
    shell?.classList.add(`mermaid-mode-${dialogState.editMode}-active`);
    document.querySelectorAll(".mermaid-mode-button").forEach(button => {
        button.classList.toggle("is-active", button.dataset.mode === dialogState.editMode);
    });
    setDiagnostics(dialogState.editMode === "code" ? "Code mode: Mermaid source drives the diagram." : "Visual edits stay synchronized with Mermaid source.", true);
}

function getSelectedIds() {
    return Array.isArray(dialogState?.selectedGraphIds) ? dialogState.selectedGraphIds : (dialogState?.selectedGraphItem?.id ? [dialogState.selectedGraphItem.id] : []);
}

function getSelectedNodes() {
    const ids = new Set(getSelectedIds());
    return dialogState?.graphModel?.nodes?.filter(node => ids.has(node.id)) || [];
}

function getSelectedEdges() {
    const ids = new Set(getSelectedIds());
    return dialogState?.graphModel?.edges?.filter(edge => ids.has(edge.id)) || [];
}

function selectionBounds(nodes = getSelectedNodes()) {
    if (!nodes.length) return null;
    const minX = Math.min(...nodes.map(node => node.x));
    const minY = Math.min(...nodes.map(node => node.y));
    const maxX = Math.max(...nodes.map(node => node.x + node.width));
    const maxY = Math.max(...nodes.map(node => node.y + node.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function graphPointToPreview(point) {
    const svg = document.querySelector("#mermaid-preview svg");
    if (!svg) return null;
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = point.x;
    svgPoint.y = point.y;
    const ctm = svg.getScreenCTM();
    const previewRect = document.getElementById("mermaid-preview")?.getBoundingClientRect();
    if (!ctm || !previewRect) return null;
    const screen = svgPoint.matrixTransform(ctm);
    return { x: screen.x - previewRect.left, y: screen.y - previewRect.top };
}

function edgeLabelGraphPoint(edge) {
    const model = dialogState?.graphModel;
    const from = model?.nodes?.find(node => node.id === edge?.from);
    const to = model?.nodes?.find(node => node.id === edge?.to);
    if (!from || !to) return { x: 80, y: 80 };
    const offset = edge.labelOffset || {};
    return {
        x: (from.x + from.width / 2 + to.x + to.width / 2) / 2 + (Number(offset.x) || 0),
        y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 8 + (Number(offset.y) || 0),
    };
}

function updateFloatingToolbar() {
    const toolbar = document.getElementById("mermaid-floating-toolbar");
    const preview = document.getElementById("mermaid-preview");
    if (!toolbar || !preview || !dialogState?.graphModel || dialogState.editMode === "code") return;
    const bounds = selectionBounds();
    if (!bounds) {
        toolbar.classList.add("hidden");
        return;
    }
    const topLeft = graphPointToPreview({ x: bounds.x, y: bounds.y });
    const topRight = graphPointToPreview({ x: bounds.x + bounds.width, y: bounds.y });
    if (!topLeft || !topRight) return;
    toolbar.style.left = `${Math.max(12, (topLeft.x + topRight.x) / 2 - toolbar.offsetWidth / 2)}px`;
    toolbar.style.top = `${Math.max(12, topLeft.y - 48)}px`;
    toolbar.classList.remove("hidden");
}

function updateMinimap() {
    const minimap = document.getElementById("mermaid-minimap");
    const model = dialogState?.graphModel;
    if (!minimap || !model || model.nodes.length < 8) {
        minimap?.classList.add("hidden");
        return;
    }
    const xs = model.nodes.map(node => node.x);
    const ys = model.nodes.map(node => node.y);
    const maxX = Math.max(...model.nodes.map(node => node.x + node.width));
    const maxY = Math.max(...model.nodes.map(node => node.y + node.height));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    minimap.innerHTML = model.nodes.map(node => {
        const x = ((node.x - minX) / w) * 100;
        const y = ((node.y - minY) / h) * 100;
        const width = Math.max(3, (node.width / w) * 100);
        const height = Math.max(3, (node.height / h) * 100);
        return `<span style="left:${x}%;top:${y}%;width:${width}%;height:${height}%"></span>`;
    }).join("");
    minimap.classList.remove("hidden");
}

function isEditableSvgPart(node) {
    const tag = node?.tagName;
    return ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan"].includes(tag);
}

function nearestEditableSvgPart(target, root) {
    let node = target;
    while (node && node !== root) {
        if (isEditableSvgPart(node)) return node;
        node = node.parentElement;
    }
    return null;
}

function installPreviewPartInteraction(preview) {
    if (!preview || preview.dataset.partInteractionInstalled === "true") return;
    preview.dataset.partInteractionInstalled = "true";
    preview.addEventListener("click", event => {
        const svg = preview.querySelector("svg");
        const part = nearestEditableSvgPart(event.target, svg);
        if (!part) return;
        event.preventDefault();
        event.stopPropagation();
        preview.querySelectorAll(".mermaid-part-selected").forEach(node => node.classList.remove("mermaid-part-selected"));
        part.classList.add("mermaid-part-selected");
        dialogState.selectedPart = part;
        const color = part.getAttribute("fill") || part.getAttribute("stroke") || "#4f46e5";
        const colorField = document.getElementById("mermaid-part-color");
        if (colorField && /^#[0-9a-fA-F]{3,8}$/.test(color)) colorField.value = color;
        setSelectedPartLabel(`${part.tagName.toLowerCase()} selected`);
        setDiagnostics(`Selected ${part.tagName}. Apply fill, stroke, or text color.`, null);
    });
}

function installGraphInteraction(preview) {
    if (!preview || preview.dataset.graphInteractionInstalled === "true") return;
    preview.dataset.graphInteractionInstalled = "true";
    let drag = null;
    let resize = null;
    let edgeLabelDrag = null;
    let connect = null;
    let marquee = null;
    let lastNodeClick = { id: "", time: 0 };
    let lastBlankPress = { time: 0, x: 0, y: 0 };
    let lastEdgeLabelClick = { id: "", time: 0 };
    const getPoint = event => {
        const svg = preview.querySelector("svg");
        if (!svg) return { x: 0, y: 0 };
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: event.clientX, y: event.clientY };
        const local = point.matrixTransform(ctm.inverse());
        return { x: local.x, y: local.y };
    };
    preview.addEventListener("pointerdown", event => {
        if (!dialogState?.graphModel || dialogState.editMode === "code") return;
        const resizeHandle = event.target.closest?.(".mermaid-graph-resize-handle");
        const handle = event.target.closest?.(".mermaid-graph-connect-handle");
        const edgeLabelEl = event.target.closest?.(".mermaid-graph-edge-label");
        const nodeEl = event.target.closest?.(".mermaid-graph-node");
        const edgeEl = event.target.closest?.(".mermaid-graph-edge");
        if (resizeHandle) {
            const id = resizeHandle.dataset.nodeId;
            const node = dialogState.graphModel.nodes.find(item => item.id === id);
            if (!node || node.locked) return;
            selectGraphItem("node", id);
            const point = getPoint(event);
            resize = {
                id,
                handle: resizeHandle.dataset.resizeHandle || "br",
                startX: point.x,
                startY: point.y,
                width: node.width,
                height: node.height,
            };
            preview.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
        }
        if (edgeLabelEl) {
            const id = edgeLabelEl.dataset.edgeId;
            const edge = dialogState.graphModel.edges.find(item => item.id === id);
            if (!edge) return;
            const now = Date.now();
            if (lastEdgeLabelClick.id === id && now - lastEdgeLabelClick.time < 420) {
                selectGraphItem("edge", id);
                requestAnimationFrame(() => openInlineEditor(id, { selectAll: true }));
                lastEdgeLabelClick = { id: "", time: 0 };
                event.preventDefault();
                return;
            }
            lastEdgeLabelClick = { id, time: now };
            const point = getPoint(event);
            edge.labelOffset = edge.labelOffset || { x: 0, y: 0 };
            selectGraphItem("edge", id);
            edgeLabelDrag = { id, startX: point.x, startY: point.y, offsetX: Number(edge.labelOffset.x) || 0, offsetY: Number(edge.labelOffset.y) || 0 };
            preview.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
        }
        if (handle) {
            const sourceId = handle.dataset.nodeId;
            connect = { sourceId };
            preview.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
        }
        if (nodeEl) {
            const id = nodeEl.dataset.nodeId;
            const node = dialogState.graphModel.nodes.find(item => item.id === id);
            if (!node || node.locked) return;
            const now = Date.now();
            if (lastNodeClick.id === id && now - lastNodeClick.time < 420) {
                selectGraphItem("node", id, { additive: event.shiftKey });
                requestAnimationFrame(() => openInlineEditor(id));
                lastNodeClick = { id: "", time: 0 };
                event.preventDefault();
                return;
            }
            lastNodeClick = { id, time: now };
            selectGraphItem("node", id, { additive: event.shiftKey });
            if (event.altKey) duplicateSelection({ offset: { x: 24, y: 24 }, keepSelection: true });
            const point = getPoint(event);
            const selectedNodes = getSelectedNodes();
            drag = {
                id,
                startX: point.x,
                startY: point.y,
                nodes: selectedNodes.length ? selectedNodes.map(item => ({ id: item.id, x: item.x, y: item.y })) : [{ id, x: node.x, y: node.y }],
            };
            preview.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
        }
        if (edgeEl) {
            selectGraphItem("edge", edgeEl.dataset.edgeId);
            event.preventDefault();
            return;
        }
        if (event.target === preview || event.target.tagName?.toLowerCase() === "svg") {
            const point = getPoint(event);
            // A second press on empty canvas soon after the first adds a node. The browser's dblclick never came:
            // the first release redraws the diagram, which removes the element the click was aimed at.
            const now = Date.now();
            if (now - lastBlankPress.time < 420 && Math.hypot(event.clientX - lastBlankPress.x, event.clientY - lastBlankPress.y) < 8) {
                lastBlankPress = { time: 0, x: 0, y: 0 };
                addNodeOnCanvas(point);
                event.preventDefault();
                return;
            }
            lastBlankPress = { time: now, x: event.clientX, y: event.clientY };
            marquee = { start: point, current: point };
            dialogState.selectedGraphIds = [];
            dialogState.selectedGraphItem = null;
            updateMarquee(marquee);
        }
    });
    preview.addEventListener("pointermove", event => {
        if (!dialogState?.graphModel) return;
        const point = getPoint(event);
        if (edgeLabelDrag) {
            const edge = dialogState.graphModel.edges.find(item => item.id === edgeLabelDrag.id);
            if (!edge) return;
            edge.labelOffset = {
                x: Math.round((edgeLabelDrag.offsetX + point.x - edgeLabelDrag.startX) / 5) * 5,
                y: Math.round((edgeLabelDrag.offsetY + point.y - edgeLabelDrag.startY) / 5) * 5,
            };
            renderGraphPreview({ syncEditor: false, updateCanvas: false });
        } else if (resize) {
            const node = dialogState.graphModel.nodes.find(item => item.id === resize.id);
            if (!node) return;
            const dx = point.x - resize.startX;
            const dy = point.y - resize.startY;
            node.width = Math.max(88, Math.min(520, Math.round((resize.width + dx) / 10) * 10));
            if (resize.handle === "br") {
                node.height = Math.max(48, Math.min(320, Math.round((resize.height + dy) / 10) * 10));
            }
            dialogState.graphModel.nodePositions[node.id] = { x: node.x, y: node.y };
            markManualGraphLayout();
            renderGraphPreview({ syncEditor: false, updateCanvas: false });
        } else if (drag) {
            drag.nodes.forEach(snapshot => {
                const node = dialogState.graphModel.nodes.find(item => item.id === snapshot.id);
                if (!node) return;
                node.x = Math.round((snapshot.x + point.x - drag.startX) / 10) * 10;
                node.y = Math.round((snapshot.y + point.y - drag.startY) / 10) * 10;
                dialogState.graphModel.nodePositions[node.id] = { x: node.x, y: node.y };
            });
            markManualGraphLayout();
            renderGraphPreview({ syncEditor: false, updateCanvas: false });
        } else if (marquee) {
            marquee.current = point;
            updateMarquee(marquee);
        }
        event.preventDefault();
    });
    const finishPointer = event => {
        if (drag) {
            drag = null;
            commitGraphChange("Node moved", { syncEditor: true });
        }
        if (resize) {
            resize = null;
            commitGraphChange("Node resized", { syncEditor: true });
        }
        if (edgeLabelDrag) {
            edgeLabelDrag = null;
            commitGraphChange("Edge label moved", { syncEditor: true });
        }
        if (marquee) {
            selectNodesInMarquee(marquee);
            marquee = null;
            document.getElementById("mermaid-marquee")?.classList.add("hidden");
        }
        if (connect) {
            // The pointer is captured by the preview, so the event's target is always the preview: look up what is
            // under the pointer (a drop on another node made a new node instead of connecting the two).
            const under = document.elementFromPoint(event.clientX, event.clientY) || event.target;
            const targetNode = under?.closest?.(".mermaid-graph-node")?.dataset.nodeId;
            if (targetNode && targetNode !== connect.sourceId) {
                addEdge(connect.sourceId, targetNode);
            } else {
                const point = getPoint(event);
                const newNode = addNodeAt("New node", point.x + 42, point.y - 24);
                addEdge(connect.sourceId, newNode.id);
                selectGraphItem("node", newNode.id);
                requestAnimationFrame(() => openInlineEditor(newNode.id, { selectAll: true }));
            }
            connect = null;
            commitGraphChange("Connection updated", { syncEditor: true });
        }
        preview.releasePointerCapture?.(event.pointerId);
    };
    preview.addEventListener("pointerup", finishPointer);
    preview.addEventListener("pointercancel", finishPointer);
    preview.addEventListener("dblclick", event => {
        if (!dialogState?.graphModel || dialogState.editMode === "code") return;
        const nodeEl = event.target.closest?.(".mermaid-graph-node");
        const edgeEl = event.target.closest?.(".mermaid-graph-edge");
        if (nodeEl) {
            selectGraphItem("node", nodeEl.dataset.nodeId);
            openInlineEditor(nodeEl.dataset.nodeId);
            return;
        }
        if (edgeEl) {
            selectGraphItem("edge", edgeEl.dataset.edgeId);
            openInlineEditor(edgeEl.dataset.edgeId);
            return;
        }
        if (lastBlankPress.time === 0) return; // already added by the second press
        addNodeOnCanvas(getPoint(event));
    });
    const addNodeOnCanvas = point => {
        const node = addNodeAt("New node", point.x, point.y);
        selectGraphItem("node", node.id);
        commitGraphChange("Node added", { syncEditor: true });
        requestAnimationFrame(() => openInlineEditor(node.id, { selectAll: true }));
    };
}

function updateMarquee(marquee) {
    const box = document.getElementById("mermaid-marquee");
    const a = graphPointToPreview(marquee.start);
    const b = graphPointToPreview(marquee.current);
    if (!box || !a || !b) return;
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.abs(a.x - b.x)}px`;
    box.style.height = `${Math.abs(a.y - b.y)}px`;
    box.classList.remove("hidden");
}

function selectNodesInMarquee(marquee) {
    const minX = Math.min(marquee.start.x, marquee.current.x);
    const minY = Math.min(marquee.start.y, marquee.current.y);
    const maxX = Math.max(marquee.start.x, marquee.current.x);
    const maxY = Math.max(marquee.start.y, marquee.current.y);
    const selected = dialogState.graphModel.nodes
        .filter(node => node.x + node.width >= minX && node.x <= maxX && node.y + node.height >= minY && node.y <= maxY)
        .map(node => node.id);
    dialogState.selectedGraphIds = selected;
    dialogState.selectedGraphItem = selected.length ? { type: "node", id: selected[selected.length - 1] } : null;
    setSelectedPartLabel(selected.length ? `${selected.length} nodes selected` : null);
    renderGraphPreview({ updateCanvas: false });
}

function softRelaxAroundSelection() {
    const selected = new Set(getSelectedNodes().map(node => node.id));
    if (!selected.size) return;
    const nodes = dialogState.graphModel.nodes;
    for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i];
            const b = nodes[j];
            if (selected.has(a.id) === selected.has(b.id)) continue;
            const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
            const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
            const overlapX = (a.width + b.width) / 2 + 28 - Math.abs(dx);
            const overlapY = (a.height + b.height) / 2 + 24 - Math.abs(dy);
            if (overlapX > 0 && overlapY > 0) {
                const target = selected.has(a.id) ? b : a;
                target.x += Math.sign(dx || 1) * Math.min(8, overlapX / 6);
                target.y += Math.sign(dy || 1) * Math.min(6, overlapY / 8);
            }
        }
    }
}

function markManualGraphLayout() {
    if (!dialogState?.graphModel) return;
    dialogState.graphModel.autoLayout = false;
    dialogState.graphModel.lockedLayout = true;
    dialogState.autoLayout = false;
    dialogState.lockedLayout = true;
    const layoutMode = document.getElementById("mermaid-layout-mode");
    if (layoutMode) layoutMode.value = "manual";
}

function openInlineEditor(id, options = {}) {
    const model = dialogState?.graphModel;
    const item = model?.nodes?.find(node => node.id === id) || model?.edges?.find(edge => edge.id === id);
    if (!item) return;
    const editor = document.getElementById("mermaid-inline-editor");
    if (!editor) return;
    const node = model.nodes.find(candidate => candidate.id === id);
    const point = node
        ? graphPointToPreview({ x: node.x + node.width / 2, y: node.y + node.height / 2 })
        : graphPointToPreview(edgeLabelGraphPoint(item));
    if (!point) return;
    dialogState.inlineEdit = { id, original: item.label || "" };
    editor.dataset.editingId = id;
    editor.dataset.editingType = node ? "node" : "edge";
    editor.textContent = item.label || "";
    editor.style.left = `${point.x}px`;
    editor.style.top = `${point.y}px`;
    if (node) {
        editor.style.minWidth = `${Math.max(120, node.width - 18)}px`;
        editor.style.maxWidth = `${Math.max(180, node.width + 80)}px`;
    }
    editor.classList.remove("hidden");
    editor.focus();
    if (options.selectAll) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
    editor.oninput = () => {
        const liveItem = findInlineEditedItem(editor.dataset.editingId);
        if (liveItem) liveItem.label = editor.textContent.slice(0, 240);
        dialogState.graphModel = layoutGraphModel(dialogState.graphModel, { preservePositions: true });
        renderGraphPreview({ updateCanvas: false });
        syncEditorFromGraph();
    };
    editor.onkeydown = event => {
        if (event.key === "Escape") {
            event.preventDefault();
            item.label = dialogState.inlineEdit.original;
            closeInlineEditor(false);
        } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            closeInlineEditor(true);
        }
    };
    editor.onblur = () => closeInlineEditor(true);
}

function findInlineEditedItem(id) {
    const model = dialogState?.graphModel;
    if (!model || !id) return null;
    return model.nodes.find(node => node.id === id) || model.edges.find(edge => edge.id === id) || null;
}

function closeInlineEditor(commit = true) {
    const editor = document.getElementById("mermaid-inline-editor");
    if (!editor || editor.classList.contains("hidden")) return;
    const item = findInlineEditedItem(dialogState?.inlineEdit?.id || editor.dataset.editingId);
    if (commit && item) {
        item.label = editor.textContent.slice(0, 240);
    }
    if (!commit && dialogState?.inlineEdit) {
        if (item) item.label = dialogState.inlineEdit.original;
    }
    editor.classList.add("hidden");
    editor.dataset.editingId = "";
    editor.dataset.editingType = "";
    dialogState.inlineEdit = null;
    commitGraphChange(commit ? "Label updated" : "Label edit cancelled", { syncEditor: true });
}

function getPreviewSvgContent() {
    if (dialogState?.graphModel) {
        if (!dialogState.graphDocument) syncDocumentFromGraph("export-preview");
        return dialogState.graphDocument
            ? SvgGraphRenderer.render(dialogState.graphDocument, { style: getSelectedStyle(), selectedIds: [] })
            : graphToSvg(dialogState.graphModel, getSelectedStyle(), { selectedIds: [] });
    }
    const preview = document.getElementById("mermaid-preview");
    const svg = preview?.querySelector("svg");
    if (!svg) return "";
    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".mermaid-part-selected").forEach(node => node.classList.remove("mermaid-part-selected"));
    return sanitizeMermaidSvg(new XMLSerializer().serializeToString(clone));
}

function syncPartEditedSvg() {
    const svg = getPreviewSvgContent();
    if (!svg) return;
    dialogState.lastValidSvg = svg;
    dialogState.hasPartEdits = true;
    const source = getEditorValue();
    if (dialogState.editingId) updateLiveCanvasObject(source, svg);
}

function applySelectedPartColor(target = "fill") {
    if (dialogState?.graphModel && dialogState.selectedGraphItem) {
        applySelectedGraphColor(target);
        return;
    }
    const part = dialogState?.selectedPart;
    if (!part || !part.isConnected) {
        setDiagnostics("Select a diagram part first.", false);
        return;
    }
    const color = document.getElementById("mermaid-part-color")?.value || "#4f46e5";
    if (target === "stroke") {
        part.setAttribute("stroke", color);
        part.style.stroke = color;
    } else {
        part.setAttribute("fill", color);
        part.style.fill = color;
        if (target === "text") {
            part.querySelectorAll?.("text,tspan").forEach(node => {
                node.setAttribute("fill", color);
                node.style.fill = color;
            });
        }
    }
    syncPartEditedSvg();
    setDiagnostics(`Applied ${target} color to selected ${part.tagName}.`, true);
}

function selectGraphItem(type, id, options = {}) {
    dialogState.selectedGraphItem = { type, id };
    if (type === "node") {
        const current = new Set(options.additive ? getSelectedIds() : []);
        if (current.has(id) && options.additive) current.delete(id);
        else current.add(id);
        dialogState.selectedGraphIds = [...current];
    } else {
        dialogState.selectedGraphIds = [id];
    }
    const model = dialogState.graphModel;
    const item = type === "node"
        ? model?.nodes?.find(node => node.id === id)
        : model?.edges?.find(edge => edge.id === id);
    setSelectedPartLabel(item ? `${type}: ${type === "node" ? item.label : (item.label || `${item.from} -> ${item.to}`)}` : null);
    const labelField = document.getElementById("mermaid-selected-label");
    if (labelField) labelField.value = item?.label || "";
    const shapeField = document.getElementById("mermaid-selected-shape");
    if (shapeField) {
        shapeField.value = type === "node" ? (item?.shape || "process") : "process";
        shapeField.disabled = type !== "node";
    }
    const colorField = document.getElementById("mermaid-part-color");
    const color = item?.style?.fill || item?.style?.stroke || getSelectedStyle().lineColor;
    if (colorField && /^#[0-9a-fA-F]{3,8}$/.test(color)) colorField.value = color;
    
    const fontFamilyField = document.getElementById("mermaid-selected-font-family");
    if (fontFamilyField) {
        fontFamilyField.value = item?.style?.fontFamily || "";
        fontFamilyField.disabled = type !== "node";
    }
    const fontSizeField = document.getElementById("mermaid-selected-font-size");
    if (fontSizeField) {
        fontSizeField.value = item?.style?.fontSize || "";
        fontSizeField.disabled = type !== "node";
    }
    const textColorField = document.getElementById("mermaid-selected-text-color");
    if (textColorField) {
        const textColor = item?.style?.text || getSelectedStyle().primaryTextColor;
        if (/^#[0-9a-fA-F]{3,8}$/.test(textColor)) textColorField.value = textColor;
    }
    
    renderGraphPreview({ syncEditor: false, updateCanvas: false });
    updateFloatingToolbar();
}

function updateSelectedLabel(value) {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || !model) return;
    const item = selected.type === "node"
        ? model.nodes.find(node => node.id === selected.id)
        : model.edges.find(edge => edge.id === selected.id);
    if (!item) return;
    item.label = String(value || "").slice(0, 120);
    commitGraphChange("Label updated", { syncEditor: true, debounceCanvas: true });
}

function updateSelectedShape(shape) {
    const allowed = new Set(["process", "decision", "database", "cloud", "actor", "queue", "hexagon", "parallelogram", "terminal", "document", "scientific"]);
    if (!allowed.has(shape)) return;
    const nodes = getSelectedNodes();
    if (!nodes.length) return;
    nodes.forEach(node => {
        node.shape = shape;
    });
    commitGraphChange("Shape updated", { syncEditor: true });
}

function updateSelectedFontFamily(fontFamily) {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || !model) return;
    const nodes = getSelectedNodes();
    const edges = getSelectedEdges();
    const items = selected.type === "node" ? nodes : edges;
    if (!items.length) return;
    items.forEach(item => {
        item.style = item.style || {};
        if (fontFamily) {
            item.style.fontFamily = fontFamily;
        } else {
            delete item.style.fontFamily;
        }
    });
    commitGraphChange("Font family updated", { syncEditor: true });
}

function updateSelectedFontSize(fontSize) {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || !model) return;
    const nodes = getSelectedNodes();
    const edges = getSelectedEdges();
    const items = selected.type === "node" ? nodes : edges;
    if (!items.length) return;
    const size = Number(fontSize);
    items.forEach(item => {
        item.style = item.style || {};
        if (size > 0) {
            item.style.fontSize = size;
        } else {
            delete item.style.fontSize;
        }
    });
    commitGraphChange("Font size updated", { syncEditor: true });
}

function updateSelectedTextColor(color) {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || !model) return;
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return;
    const nodes = getSelectedNodes();
    const edges = getSelectedEdges();
    const items = selected.type === "node" ? nodes : edges;
    if (!items.length) return;
    items.forEach(item => {
        item.style = item.style || {};
        item.style.text = color;
    });
    commitGraphChange("Text color updated", { syncEditor: true });
}

function applySelectedGraphColor(target) {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || !model) {
        setDiagnostics("Select a node or edge first.", false);
        return;
    }
    const color = document.getElementById("mermaid-part-color")?.value || "#4f46e5";
    const item = selected.type === "node"
        ? model.nodes.find(node => node.id === selected.id)
        : model.edges.find(edge => edge.id === selected.id);
    if (!item) return;
    item.style = item.style || {};
    if (target === "stroke" || selected.type === "edge") item.style.stroke = color;
    else if (target === "text") item.style.text = color;
    else item.style.fill = color;
    commitGraphChange("Style updated", { syncEditor: true });
}

function addNodeAt(label, x, y) {
    const model = dialogState.graphModel;
    const node = makeNode(label, Math.round(x / 10) * 10, Math.round(y / 10) * 10, "process", new Set(model.nodes.map(item => item.id)));
    model.nodes.push(node);
    model.nodePositions[node.id] = { x: node.x, y: node.y };
    return node;
}

function addEdge(from, to) {
    const model = dialogState.graphModel;
    const id = `e_${from}_${to}_${Date.now()}`;
    model.edges.push({ id, from, to, label: "", arrow: "arrow", routingStyle: model.routingStyle || "orthogonal", waypoints: [], style: {} });
    return id;
}

function addRelatedNode(kind) {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || selected.type !== "node" || !model) {
        setDiagnostics("Select a node first.", false);
        return;
    }
    const base = model.nodes.find(node => node.id === selected.id);
    if (!base) return;
    const node = addNodeAt(kind === "sibling" ? "Sibling" : "Child", base.x + 210, kind === "sibling" ? base.y + 88 : base.y);
    node.autoPlacedAt = { x: node.x, y: node.y }; // the layout finds it a free spot next to its relatives
    if (kind === "sibling") {
        // A sibling shares the selected node's parents (none: it starts its own branch).
        model.edges.filter(edge => edge.to === base.id).forEach(edge => addEdge(edge.from, node.id));
    } else {
        addEdge(base.id, node.id);
    }
    selectGraphItem("node", node.id);
    commitGraphChange(`${kind} node added`, { syncEditor: true });
}

function deleteSelectedGraphItem() {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!model) return;
    const selectedIds = new Set(getSelectedIds());
    if (selectedIds.size) {
        model.nodes = model.nodes.filter(node => !selectedIds.has(node.id));
        model.edges = model.edges.filter(edge => !selectedIds.has(edge.id) && !selectedIds.has(edge.from) && !selectedIds.has(edge.to));
        selectedIds.forEach(id => delete model.nodePositions[id]);
    } else if (selected?.type === "edge") {
        model.edges = model.edges.filter(edge => edge.id !== selected.id);
    } else {
        return;
    }
    dialogState.selectedGraphItem = null;
    dialogState.selectedGraphIds = [];
    setSelectedPartLabel(null);
    commitGraphChange("Deleted", { syncEditor: true });
}

function duplicateSelection(options = {}) {
    const model = dialogState?.graphModel;
    const selectedNodes = getSelectedNodes();
    if (!model || !selectedNodes.length) return;
    const offset = options.offset || { x: 34, y: 34 };
    const existing = new Set(model.nodes.map(node => node.id));
    const idMap = new Map();
    const clones = selectedNodes.map(node => {
        const clone = makeNode(`${node.label} copy`, node.x + offset.x, node.y + offset.y, node.shape, existing);
        existing.add(clone.id);
        clone.width = node.width;
        clone.height = node.height;
        clone.style = { ...(node.style || {}) };
        idMap.set(node.id, clone.id);
        return clone;
    });
    const cloneEdges = model.edges
        .filter(edge => idMap.has(edge.from) && idMap.has(edge.to))
        .map(edge => ({
            ...edge,
            id: `e_${idMap.get(edge.from)}_${idMap.get(edge.to)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            from: idMap.get(edge.from),
            to: idMap.get(edge.to),
            style: { ...(edge.style || {}) },
        }));
    model.nodes.push(...clones);
    model.edges.push(...cloneEdges);
    dialogState.selectedGraphIds = clones.map(node => node.id);
    dialogState.selectedGraphItem = clones.length ? { type: "node", id: clones[0].id } : null;
    commitGraphChange("Duplicated", { syncEditor: true });
}

function nudgeSelection(key, amount) {
    const dx = key === "ArrowLeft" ? -amount : key === "ArrowRight" ? amount : 0;
    const dy = key === "ArrowUp" ? -amount : key === "ArrowDown" ? amount : 0;
    const nodes = getSelectedNodes();
    if (!nodes.length) return;
    nodes.forEach(node => {
        node.x += dx;
        node.y += dy;
        dialogState.graphModel.nodePositions[node.id] = { x: node.x, y: node.y };
    });
    markManualGraphLayout();
    commitGraphChange("Moved", { syncEditor: true });
}

function handleFloatingToolbarAction(action) {
    if (action === "delete") deleteSelectedGraphItem();
    else if (action === "duplicate") duplicateSelection();
    else if (action === "layout") layoutSelection();
    else if (action === "align") alignSelectionCenterline();
    else if (action === "animate") applyGraphAnimationPreset("branch-reveal");
    else if (action === "shape") toggleSelectedShape();
    else if (action === "color") applyQuickColor();
    else if (action === "connect") addRelatedNode("child");
}

function alignSelectionCenterline() {
    const nodes = getSelectedNodes();
    if (nodes.length < 2) {
        setDiagnostics("Select at least two nodes to align.", false);
        return;
    }
    const centerY = nodes.reduce((sum, node) => sum + node.y + node.height / 2, 0) / nodes.length;
    nodes.forEach(node => {
        node.y = Math.round((centerY - node.height / 2) / 10) * 10;
        dialogState.graphModel.nodePositions[node.id] = { x: node.x, y: node.y };
    });
    markManualGraphLayout();
    commitGraphChange("Selection aligned", { syncEditor: true });
}

function layoutSelection() {
    const nodes = getSelectedNodes();
    if (nodes.length < 2) {
        // It added a child node instead, which is what the connect button is for.
        setDiagnostics("Select at least two nodes to arrange (Shift-click or drag a box around them).", false);
        return;
    }
    const bounds = selectionBounds(nodes);
    nodes
        .slice()
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .forEach((node, index) => {
            node.x = bounds.x + index * 190;
            node.y = bounds.y;
            dialogState.graphModel.nodePositions[node.id] = { x: node.x, y: node.y };
        });
    markManualGraphLayout();
    commitGraphChange("Selection arranged", { syncEditor: true });
}

function toggleSelectedShape() {
    const cycle = ["process", "decision", "database", "cloud", "actor", "queue", "hexagon", "parallelogram", "terminal", "document", "scientific"];
    getSelectedNodes().forEach(node => {
        const index = cycle.indexOf(node.shape);
        node.shape = cycle[(index + 1) % cycle.length];
    });
    commitGraphChange("Shape changed", { syncEditor: true });
}

function applyQuickColor() {
    const colors = ["#eef2ff", "#ecfeff", "#f0fdf4", "#fff7ed", "#fdf2f8"];
    const nodes = getSelectedNodes();
    const base = getSelectedStyle().primaryColor;
    nodes.forEach(node => {
        // The next colour that differs from what the node shows (the first one was the default fill, so the first
        // click looked like it did nothing).
        const current = String(node.style?.fill || base || "").toLowerCase();
        const start = colors.indexOf(current);
        const next = [...colors.slice(start + 1), ...colors.slice(0, start + 1)].find(color => color !== current) || colors[0];
        node.style = { ...(node.style || {}), fill: next };
    });
    commitGraphChange("Color changed", { syncEditor: true });
}

// Branch Reveal switches on and off. When on, the show reveals the diagram step by step, one click each.
function applyGraphAnimationPreset(presetId) {
    if (!dialogState?.graphModel) return;
    syncDocumentFromGraph("animation-preset");
    const graph = dialogState.graphDocument;
    const active = graph?.presentationState?.activePreset === presetId;
    dialogState.graphDocument = active
        ? { ...graph, animations: [], presentationState: { ...(graph.presentationState || {}), activePreset: null, revealOrder: [], focusPath: [] } }
        : applyPresentationPreset(graph, presetId);
    dialogState.graphModel = documentToGraphModel(dialogState.graphDocument);
    commitGraphChange(
        active ? "Branch Reveal off: the diagram appears whole" : "Branch Reveal on: in the show, each click reveals the next step",
        { syncEditor: true },
    );
    updateBranchRevealButton();
}

function updateBranchRevealButton() {
    const button = document.getElementById("mermaid-branch-reveal");
    if (!button) return;
    const on = dialogState?.graphDocument?.presentationState?.activePreset === "branch-reveal";
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-pressed", String(on));
    const label = button.querySelector("span");
    if (label) label.textContent = on ? "Branch Reveal: on" : "Branch Reveal";
    button.title = "In the show, each click reveals the next step of the flowchart";
}

function addScientificStage() {
    const model = dialogState?.graphModel;
    if (!model) return;
    const primitive = SCIENTIFIC_WORKFLOW_PRIMITIVES[Date.now() % SCIENTIFIC_WORKFLOW_PRIMITIVES.length];
    const selected = getSelectedNodes()[0];
    const x = selected ? selected.x + 220 : 90 + model.nodes.length * 18;
    const y = selected ? selected.y : 90 + model.nodes.length * 14;
    const node = makeNode(primitive.label, x, y, primitive.shape, new Set(model.nodes.map(item => item.id)));
    node.style = { fill: primitive.color };
    model.nodes.push(node);
    model.nodePositions[node.id] = { x: node.x, y: node.y };
    if (selected) addEdge(selected.id, node.id);
    selectGraphItem("node", node.id);
    commitGraphChange("Scientific workflow stage added", { syncEditor: true });
}

function runGraphCommand(command) {
    if (!command || !dialogState?.graphModel) return;
    if (command === "add-node") {
        const node = addNodeAt("New node", 120, 120);
        selectGraphItem("node", node.id);
        commitGraphChange("Node added", { syncEditor: true });
        requestAnimationFrame(() => openInlineEditor(node.id, { selectAll: true }));
    } else if (command === "auto-layout") {
        dialogState.graphModel = layoutGraphModel(dialogState.graphModel, { preservePositions: false });
        commitGraphChange("Graph auto-layout applied", { syncEditor: true });
    } else if (command === "branch-reveal") {
        applyGraphAnimationPreset("branch-reveal");
    } else if (command === "scientific-stage") {
        addScientificStage();
    }
}

function zoomGraphToSelection() {
    const bounds = selectionBounds();
    const preview = document.getElementById("mermaid-preview");
    if (!bounds || !preview) return;
    const point = graphPointToPreview({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    if (!point) return;
    preview.scrollBy({ left: point.x - preview.clientWidth / 2, top: point.y - preview.clientHeight / 2, behavior: "smooth" });
}

function startInlineRename() {
    const selected = dialogState?.selectedGraphItem;
    const model = dialogState?.graphModel;
    if (!selected || !model) return;
    const item = selected.type === "node"
        ? model.nodes.find(node => node.id === selected.id)
        : model.edges.find(edge => edge.id === selected.id);
    if (!item) return;
    // The app's own dialog (it was the browser's prompt box).
    window.sfPrompt({ title: selected.type === "node" ? "Rename node" : "Edge label", value: item.label || "", okLabel: "Save" }).then(next => {
        if (next === null) return;
        item.label = next.slice(0, 120);
        const labelField = document.getElementById("mermaid-selected-label");
        if (labelField) labelField.value = item.label;
        commitGraphChange("Label updated", { syncEditor: true });
    });
}

function commitGraphChange(message, options = {}) {
    if (!dialogState?.graphModel) return;
    dialogState.graphModel = layoutGraphModel(dialogState.graphModel, { preservePositions: true });
    dialogState.graphModel.style = getSelectedStyle();
    syncDocumentFromGraph(message);
    dialogState.hasPartEdits = false;
    if (options.syncEditor !== false) syncEditorFromGraph();
    renderGraphPreview({ syncEditor: false, updateCanvas: !options.debounceCanvas });
    setDiagnostics(message, true);
}

function renderGraphPreview(options = {}) {
    const preview = document.getElementById("mermaid-preview");
    if (!preview || !dialogState?.graphModel) return "";
    const style = getSelectedStyle();
    dialogState.graphModel.style = style;
    if (dialogState.graphDocument) dialogState.graphDocument.styles = style;
    if (!dialogState.graphDocument) syncDocumentFromGraph("render");
    const svg = dialogState.graphDocument
        ? SvgGraphRenderer.render(dialogState.graphDocument, {
            style,
            selectedIds: getSelectedIds(),
            showConnectHandles: true,
            showResizeHandles: true,
        })
        : graphToSvg(dialogState.graphModel, style, {
            selectedIds: getSelectedIds(),
            showConnectHandles: true,
            showResizeHandles: true,
        });
    preview.innerHTML = svg;
    installGraphInteraction(preview);
    preview.classList.remove("is-loading");
    dialogState.lastValidSvg = svg;
    dialogState.lastValidSource = dialogState.graphDocument ? MermaidExporter.fromGraphDocument(dialogState.graphDocument) : graphToMermaid(dialogState.graphModel);
    dialogState.lastValidTheme = getSelectedTheme();
    dialogState.lastValidStyle = style;
    if (options.updateCanvas !== false) updateLiveCanvasObject(dialogState.lastValidSource, svg);
    updateFloatingToolbar();
    updateMinimap();
    return svg;
}

function schedulePreview(options = {}) {
    if (debounceTimer) clearTimeout(debounceTimer);
    setDiagnostics("Waiting for changes...", null);
    debounceTimer = setTimeout(() => renderPreview(), options.immediate ? 0 : 320);
}

async function runValidation({ force = false } = {}) {
    const source = getEditorValue();
    const result = await validateMermaid(source);
    if (result.ok && dialogState?.graphDocument?.nodes?.length) {
        const scientific = validateScientificGraph(dialogState.graphDocument);
        if (scientific.warnings?.length) {
            const message = `${result.message} ${scientific.warnings[0].message}`;
            if (force) setDiagnostics(message, null);
            return { ...result, message, scientificWarnings: scientific.warnings };
        }
    }
    if (force || !result.ok) setDiagnostics(result.message, result.ok);
    return result;
}

// The controls follow the diagram type: node, layout and story tools only for flowcharts (a Gantt chart showed
// "Drag nodes" and Child/Sibling), and only the looks the type can be drawn in.
function syncDiagramKindControls(source) {
    const shell = document.getElementById("mermaid-dialog");
    shell?.classList.toggle("mermaid-non-graph", !canUseVisualGraph(source));
    const field = document.getElementById("mermaid-render-mode");
    if (!field) return;
    const modes = mermaidRenderModes(source);
    const handDrawnOnly = modes.length === 2;
    [...field.options].forEach(option => {
        option.hidden = !modes.includes(option.value);
        option.disabled = option.hidden;
        if (option.value === "sketch") option.textContent = handDrawnOnly ? "Hand-drawn" : "Sketch";
    });
    if (!modes.includes(field.value)) field.value = field.value !== "real" && modes.includes("sketch") ? "sketch" : "real";
    field.disabled = modes.length === 1;
    field.title = modes.length === 1 ? "This diagram type has no hand-drawn look" : "";
}

async function renderPreview() {
    const source = getEditorValue();
    const preview = document.getElementById("mermaid-preview");
    if (!preview || !dialogState) return;
    syncDiagramKindControls(source);
    if (canUseVisualGraph(source)) {
        if (!dialogState.graphModel) rebuildGraphFromEditor();
        renderGraphPreview();
        // Lines the flowchart reader could not use are skipped in the preview; say which, so a typo is not silent.
        const problems = diagnoseFlowchart(source);
        if (problems.length) {
            const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
            setDiagnostics(`Line ${problems[0].line}: ${problems[0].message}${more}`, false);
        } else {
            setDiagnostics("Visual graph synced", true);
        }
        return;
    }
    const token = `${Date.now()}-${Math.random()}`;
    dialogState.previewToken = token;
    preview.classList.add("is-loading");
    setDiagnostics("Rendering...", null);
    try {
        const style = getSelectedStyle();
        const { svg } = await renderMermaid(source, { theme: getSelectedTheme(), style });
        if (dialogState.previewToken !== token) return;
        preview.innerHTML = svg;
        installPreviewPartInteraction(preview);
        setSelectedPartLabel(null);
        preview.classList.remove("is-loading");
        dialogState.lastValidSvg = svg;
        dialogState.lastValidSource = source;
        dialogState.lastValidTheme = getSelectedTheme();
        dialogState.lastValidStyle = style;
        dialogState.hasPartEdits = false;
        setDiagnostics("Syntax valid", true);
        updateLiveCanvasObject(source, svg);
    } catch (error) {
        if (dialogState.previewToken !== token) return;
        preview.classList.remove("is-loading");
        if (!dialogState.lastValidSvg) preview.innerHTML = `<div class="mermaid-preview-empty">Fix syntax to render preview.</div>`;
        setDiagnostics(error?.message || String(error), false);
    }
}

function updateLiveCanvasObject(source, svg) {
    if (!dialogState?.editingId) return;
    const element = getCurrentMermaidElement(dialogState.editingId);
    if (!element) return;
    if (!dialogState.undoCaptured) {
        const saveStateToUndo = readGlobal("saveStateToUndo");
        if (typeof saveStateToUndo === "function") saveStateToUndo();
        dialogState.undoCaptured = true;
    }
    const graphDocument = dialogState.graphDocument
        ? ensureSemanticGraphDocument(dialogState.graphDocument, { mermaidSource: source, style: getSelectedStyle(), graphModel: dialogState.graphModel })
        : null;
    const graphModel = graphDocument ? documentToGraphModel(graphDocument) : dialogState.graphModel;
    Object.assign(element, {
        mermaidSource: source,
        mermaidType: inferMermaidType(source),
        theme: getSelectedTheme(),
        style: getSelectedStyle(),
        svgContent: svg,
        svgManualEdits: Boolean(dialogState.hasPartEdits),
        editMode: dialogState.editMode || "split",
        graphModel,
        graphDocument,
        semanticGraphVersion: graphDocument?.schemaVersion || null,
        nodePositions: graphModel?.nodePositions || {},
        lockedLayout: Boolean(graphModel?.lockedLayout),
        autoLayout: graphModel?.autoLayout !== false,
        routingStyle: graphModel?.routingStyle || "orthogonal",
        connectionStyle: graphModel?.connectionStyle || "arrow",
    });
    const dom = document.getElementById(element.id);
    if (dom && typeof window.renderMermaidElement === "function") {
        window.renderMermaidElement(dom, element, { force: true, updateState: false });
    }
    if (typeof window.schedulePresentationAutosave === "function") window.schedulePresentationAutosave(500);
}

async function applyMermaidDialog() {
    let source = getEditorValue();
    let svg = getPreviewSvgContent() || dialogState?.lastValidSvg || "";
    let theme = getSelectedTheme();
    let style = getSelectedStyle();
    if (dialogState?.graphModel) {
        syncDocumentFromGraph("apply");
        source = dialogState.graphDocument ? MermaidExporter.fromGraphDocument(dialogState.graphDocument) : graphToMermaid(dialogState.graphModel);
        svg = dialogState.graphDocument
            ? SvgGraphRenderer.render(dialogState.graphDocument, { style, selectedIds: [] })
            : graphToSvg(dialogState.graphModel, style, { selectedIds: [] });
    } else if (
        source !== dialogState?.lastValidSource ||
        theme !== dialogState?.lastValidTheme ||
        JSON.stringify(style) !== JSON.stringify(dialogState?.lastValidStyle || {}) ||
        !svg
    ) {
        try {
            setDiagnostics("Rendering final diagram...", null);
            const rendered = await renderMermaid(source, { theme, style });
            svg = rendered.svg;
            dialogState.lastValidSvg = svg;
            dialogState.lastValidSource = source;
            dialogState.lastValidTheme = theme;
            dialogState.lastValidStyle = style;
        } catch (error) {
            setDiagnostics(error?.message || String(error), false);
            return;
        }
    }
    if (!svg) {
        setDiagnostics("Render a valid diagram before inserting.", false);
        return;
    }
    if (dialogState.editingId) {
        updateMermaidElement(
            dialogState.editingId,
            {
                mermaidSource: source,
                mermaidType: inferMermaidType(source),
                theme,
                style,
                svgContent: svg,
                svgManualEdits: Boolean(dialogState.hasPartEdits),
                editMode: dialogState.editMode || "split",
                graphModel: dialogState.graphModel,
                graphDocument: dialogState.graphDocument,
                semanticGraphVersion: dialogState.graphDocument?.schemaVersion || null,
                nodePositions: dialogState.graphModel?.nodePositions || {},
                lockedLayout: Boolean(dialogState.graphModel?.lockedLayout),
                autoLayout: dialogState.graphModel?.autoLayout !== false,
                routingStyle: dialogState.graphModel?.routingStyle || "orthogonal",
                connectionStyle: dialogState.graphModel?.connectionStyle || "arrow",
            },
            { captureUndo: !dialogState.undoCaptured },
        );
    } else {
        insertMermaidElement(createMermaidElementData({
            mermaidSource: source,
            mermaidType: inferMermaidType(source),
            theme,
            style,
            svgContent: svg,
            svgManualEdits: Boolean(dialogState.hasPartEdits),
            editMode: dialogState.editMode || "split",
            graphModel: dialogState.graphModel,
            graphDocument: dialogState.graphDocument,
            semanticGraphVersion: dialogState.graphDocument?.schemaVersion || null,
            nodePositions: dialogState.graphModel?.nodePositions || {},
            lockedLayout: Boolean(dialogState.graphModel?.lockedLayout),
            autoLayout: dialogState.graphModel?.autoLayout !== false,
            routingStyle: dialogState.graphModel?.routingStyle || "orthogonal",
            connectionStyle: dialogState.graphModel?.connectionStyle || "arrow",
        }));
    }
    closeMermaidDialog();
}

export function openMermaidDialog(editingId = null, pendingCommand = null) {
    const shell = ensureDialog();
    const element = editingId ? getCurrentMermaidElement(editingId) : null;
    const source = element?.mermaidSource || DEFAULT_MERMAID_TEMPLATE.source;
    const graphState = element && (element.graphDocument || element.graphModel || canUseVisualGraph(source))
        ? ensureGraphElementDocument(element)
        : null;
    dialogState?.disposeEditor?.();
    dialogState = {
        editingId: element?.id || null,
        lastValidSvg: sanitizeMermaidSvg(element?.svgContent || ""),
        lastValidSource: source,
        lastValidTheme: element?.theme || "default",
        lastValidStyle: normalizeMermaidStyle(element?.style || {}),
        hasPartEdits: Boolean(element?.svgManualEdits),
        selectedPart: null,
        selectedGraphItem: null,
        selectedGraphIds: [],
        graphDocument: graphState?.graphDocument || (canUseVisualGraph(source) ? ensureSemanticGraphDocument(createGraphDocument({
            mermaidSource: source,
            graphModel: element?.graphModel || null,
            styles: element?.style || {},
            routingStyle: element?.routingStyle,
            autoLayout: element?.autoLayout,
            lockedLayout: element?.lockedLayout,
        }), { mermaidSource: source, style: element?.style || {} }) : null),
        graphModel: graphState?.graphModel || null,
        editMode: element?.editMode || "visual",
        autoLayout: element?.autoLayout !== false,
        lockedLayout: Boolean(element?.lockedLayout),
        routingStyle: element?.routingStyle || element?.graphModel?.routingStyle || "orthogonal",
        undoCaptured: false,
        pendingCommand,
    };
    dialogState.graphModel = dialogState.graphModel || (dialogState.graphDocument
        ? documentToGraphModel(dialogState.graphDocument)
        : (canUseVisualGraph(source) ? parseMermaidToGraph(source, element?.graphModel || null) : null));
    shell.classList.remove("hidden");
    const panel = shell.querySelector(".mermaid-dialog-panel");
    if (panel && !panel.style.left) {
        panel.style.left = "50%";
        panel.style.top = "50%";
        panel.style.transform = "translate(-50%, -50%)";
    }
    setupEditor(stripGraphMetadata(source));
    setupControls(element);
    setEditorMode(dialogState.editMode);
    rebuildGraphFromEditor();
    updateBranchRevealButton();
    schedulePreview({ immediate: true });
    if (pendingCommand) requestAnimationFrame(() => runGraphCommand(pendingCommand));
}

export function closeMermaidDialog() {
    const shell = document.getElementById("mermaid-dialog");
    shell?.classList.add("hidden");
    if (debounceTimer) clearTimeout(debounceTimer);
    dialogState?.disposeEditor?.();
    dialogState = null;
}

window.openMermaidDialog = openMermaidDialog;
window.closeMermaidDialog = closeMermaidDialog;
