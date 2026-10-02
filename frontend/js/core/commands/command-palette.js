// Command palette: command list, search and execution.

// ─── Command Palette ──────────────────────────────────────────────────────────

const COMMANDS = [
    { id: "add-slide", title: "Add Slide", icon: "fa-plus", action: addSlide },
    { id: "duplicate-slide", title: "Duplicate Slide", icon: "fa-copy", action: duplicateCurrentSlide },
    { id: "delete-slide", title: "Delete Slide", icon: "fa-trash", action: deleteCurrentSlide },
    { id: "add-text", title: "Add Text Box", icon: "fa-t", action: () => addElement("text") },
    { id: "add-shape-rect", title: "Add Rectangle", icon: "fa-square", action: () => addShape("rectangle") },
    { id: "add-shape-circle", title: "Add Circle", icon: "fa-circle", action: () => addShape("circle") },
    { id: "add-drawing", title: "Add Drawing (Excalidraw)", icon: "fa-pen-ruler", action: () => window.addDrawing?.() },
    {
        id: "add-mermaid",
        title: "Insert Flowchart / Mermaid Diagram",
        icon: "fa-diagram-project",
        action: () => window.openMermaidDialog?.(),
    },
    {
        id: "graph-add-node",
        title: "Graph: Add Node",
        icon: "fa-circle-plus",
        action: () => window.openMermaidDialog?.(state.selectedIds?.[0], "add-node"),
    },
    {
        id: "graph-auto-layout",
        title: "Graph: Auto-layout Selection",
        icon: "fa-wand-magic-sparkles",
        action: () => window.openMermaidDialog?.(state.selectedIds?.[0], "auto-layout"),
    },
    {
        id: "graph-branch-reveal",
        title: "Graph: Branch Reveal Animation",
        icon: "fa-route",
        action: () => window.openMermaidDialog?.(state.selectedIds?.[0], "branch-reveal"),
    },
    {
        id: "graph-scientific-stage",
        title: "Graph: Scientific Workflow Stage",
        icon: "fa-atom",
        action: () => window.openMermaidDialog?.(state.selectedIds?.[0], "scientific-stage"),
    },
    {
        id: "add-image",
        title: "Add Image",
        icon: "fa-image",
        action: () => {
            const fileInput = document.getElementById("image-file-upload");
            if (fileInput) fileInput.click();
        },
    },
    { id: "add-video", title: "Add Video", icon: "fa-video", action: () => addElement("video") },
    { id: "ai-cleanup", title: "Tidy Slide Layout", icon: "fa-wand-magic-sparkles", keywords: "ai clean up polish align grid", action: aiCleanUpSlide },
    { id: "present", title: "Toggle Presentation Mode", icon: "fa-play", action: togglePlayMode },
    { id: "dark-mode", title: "Dark Mode / Light Mode (switch)", icon: "fa-moon", action: () => toggleAppTheme() },
    { id: "export-pdf", title: "Export to PDF", icon: "fa-file-pdf", action: exportPresentationPDF },
    {
        id: "export-scene-svg",
        title: "Export Current Slide SVG",
        icon: "fa-vector-square",
        action: exportPresentationSceneSVG,
    },
    { id: "export-pptx", title: "Export to PPTX", icon: "fa-file-powerpoint", action: exportPresentationPPTX },
    { id: "export-zip", title: "Export to Web (ZIP)", icon: "fa-file-zipper", action: exportPresentationZip },
    { id: "export-json", title: "Export to JSON", icon: "fa-file-code", action: exportPresentationJson },
    { id: "import-json", title: "Import from JSON", icon: "fa-file-import", action: importPresentationJson },
    { id: "import-pptx", title: "Import from PPTX", icon: "fa-file-powerpoint", action: triggerImportPptx },

    // The selected objects. They are listed only while something is selected, and first then.
    { id: "dup-selection", title: "Duplicate Selection", icon: "fa-clone", keywords: "dup copy clone repeat", needs: 1, action: () => duplicateSelectedElements() },
    { id: "delete-selection", title: "Delete Selection", icon: "fa-trash-can", keywords: "remove erase", needs: 1, action: () => deleteSelectedElements() },
    { id: "copy-selection", title: "Copy Selection", icon: "fa-copy", keywords: "clipboard", needs: 1, action: () => copyElement() },
    { id: "bring-forward", title: "Bring Forward", icon: "fa-layer-group", keywords: "layer order front up", needs: 1, single: true, action: () => moveSelectedLayer("up") },
    { id: "send-backward", title: "Send Backward", icon: "fa-layer-group", keywords: "layer order back down", needs: 1, single: true, action: () => moveSelectedLayer("down") },
    { id: "lock-selection", title: "Lock / Unlock Selection", icon: "fa-lock", keywords: "pin freeze", needs: 1, action: () => state.selectedIds.slice().forEach(id => toggleLockElement(id)) },
    { id: "group-selection", title: "Group Selection", icon: "fa-object-group", keywords: "combine", needs: 2, action: () => groupSelected() },
    { id: "ungroup-selection", title: "Ungroup Selection", icon: "fa-object-ungroup", keywords: "split", needs: 1, action: () => ungroupSelected() },
    ...["left", "center", "right", "top", "middle", "bottom"].map(mode => ({
        id: `align-${mode}`,
        title: `Align ${mode[0].toUpperCase()}${mode.slice(1)}`,
        icon: ["top", "middle", "bottom"].includes(mode) ? "fa-grip-lines" : "fa-align-center",
        keywords: "line up arrange distribute",
        needs: 2,
        action: () => alignSelection(mode),
    })),

    { id: "paste", title: "Paste", icon: "fa-paste", keywords: "clipboard", action: () => pasteFromClipboard() },
    { id: "undo", title: "Undo", icon: "fa-rotate-left", keywords: "back revert", action: () => undo() },
    { id: "redo", title: "Redo", icon: "fa-rotate-right", keywords: "again", action: () => redo() },
    { id: "add-table", title: "Add Table", icon: "fa-table", keywords: "grid rows columns", action: () => addElement("table") },
    { id: "add-chart-bar", title: "Add Bar Chart", icon: "fa-chart-bar", keywords: "graph plot column", action: () => addChart("bar") },
    { id: "add-chart-line", title: "Add Line Chart", icon: "fa-chart-line", keywords: "graph plot trend", action: () => addChart("line") },
    { id: "add-chart-pie", title: "Add Pie Chart", icon: "fa-chart-pie", keywords: "graph donut share", action: () => addChart("pie") },
    { id: "add-equation", title: "Add Equation (LaTeX)", icon: "fa-square-root-variable", keywords: "math formula katex", action: () => openEquationModal() },
    { id: "add-symbol", title: "Insert Symbol", icon: "fa-font", keywords: "greek math arrow character", action: () => openSymbolPicker() },
    { id: "add-icon", title: "Insert Icon", icon: "fa-icons", keywords: "glyph pictogram", action: () => openIconPicker() },
    { id: "add-molecule", title: "Add Molecule (PDB or Trajectory)", icon: "fa-atom", keywords: "protein structure md", action: () => document.getElementById("molecule-file-upload")?.click() },
    { id: "add-pdf", title: "Add PDF", icon: "fa-file-pdf", keywords: "document paper", action: () => document.getElementById("pdf-file-upload")?.click() },
    { id: "add-connector", title: "Add Line Connector", icon: "fa-slash", keywords: "arrow line link", action: () => addConnector("line") },
    { id: "toggle-properties", title: "Show / Hide Properties", icon: "fa-sliders", keywords: "panel inspector", action: () => togglePropertiesPanel?.() },
    // The theme and slide size were only in Properties with nothing selected, and "theme" found nothing here.
    ...Object.entries(typeof PRESENTATION_THEMES !== "undefined" ? PRESENTATION_THEMES : {}).map(([themeId, theme]) => ({
        id: `theme-${themeId}`,
        title: `Theme: ${theme.label || themeId}`,
        icon: "fa-palette",
        keywords: "theme design look colours colors style deck",
        action: () => changePresentationTheme(themeId),
    })),
    ...Object.values(typeof PRESENTATION_PAGE_SETUPS !== "undefined" ? PRESENTATION_PAGE_SETUPS : {})
        .filter(setup => !/legacy/i.test(setup.label || ""))
        .map(setup => ({
            id: `slide-size-${setup.id}`,
            title: `Slide Size: ${setup.label}`,
            icon: "fa-expand",
            keywords: "page setup aspect ratio format widescreen 16:9 4:3 dimensions",
            action: () => applyPresentationPageSetup(setup.id),
        })),
    ...(typeof SHAPE_CATALOG !== "undefined" ? SHAPE_CATALOG : [])
        .filter(shape => !["rectangle", "circle"].includes(shape.type))
        .map(shape => ({
            id: `add-shape-${shape.type}`,
            title: `Add ${shape.group === "arrow" ? `${shape.label} Arrow` : shape.label}${shape.type === "rounded-rectangle" ? " Rectangle" : ""}`,
            icon: shape.group === "arrow" ? "fa-arrow-right" : "fa-shapes",
            keywords: "shape",
            action: () => insertShapeFromPicker(shape.type),
        })),
];

// What a command is found by: its title and its keywords, so "dup" or "clone" find the duplicate commands.
function _commandMatches(cmd, query) {
    if (!query) return true;
    const haystack = `${cmd.title} ${cmd.keywords || ""}`.toLowerCase();
    return query.split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

// Commands for the selection only while there is one (two or more for grouping and aligning).
function _commandAvailable(cmd) {
    const count = state.selectedIds?.length || 0;
    if (!cmd.needs) return true;
    if (cmd.single && count !== 1) return false;
    return count >= cmd.needs;
}

let commandPaletteSelectedIndex = 0;

let commandPaletteResults = [];

function openCommandPalette() {
    const modal = document.getElementById("command-palette-modal");
    const input = document.getElementById("command-palette-input");
    if (!modal || !input) return;

    modal.style.display = "flex";
    input.value = "";
    input.focus();
    renderCommandPaletteResults("");

    input.oninput = e => renderCommandPaletteResults(e.target.value);
    input.onkeydown = e => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            commandPaletteSelectedIndex = Math.min(commandPaletteSelectedIndex + 1, commandPaletteResults.length - 1);
            updateCommandPaletteSelection();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            commandPaletteSelectedIndex = Math.max(commandPaletteSelectedIndex - 1, 0);
            updateCommandPaletteSelection();
        } else if (e.key === "Enter") {
            e.preventDefault();
            executeSelectedCommand();
        } else if (e.key === "Escape") {
            e.preventDefault();
            closeCommandPalette();
        }
    };
}

function closeCommandPalette() {
    const modal = document.getElementById("command-palette-modal");
    if (modal) modal.style.display = "none";
}

window.closeCommandPalette = closeCommandPalette;

window.openCommandPalette = openCommandPalette;

function renderCommandPaletteResults(query) {
    const container = document.getElementById("command-palette-results");
    if (!container) return;

    const lowerQuery = query.toLowerCase().trim();
    const available = COMMANDS.filter(cmd => _commandAvailable(cmd) && _commandMatches(cmd, lowerQuery));
    // With something selected, what can be done to it comes first.
    commandPaletteResults = [...available.filter(cmd => cmd.needs), ...available.filter(cmd => !cmd.needs)];
    commandPaletteSelectedIndex = 0;

    if (commandPaletteResults.length === 0) {
        container.innerHTML = `<div class="px-4 py-8 text-center text-slate-400 text-sm">No commands found for "${escapeHtml(query)}"</div>`;
        return;
    }

    container.innerHTML = commandPaletteResults
        .map(
            (cmd, index) => `
        <button id="cmd-item-${index}" class="w-full text-left px-4 py-3 flex items-center gap-3 text-slate-700 hover:bg-slate-50 transition-colors ${index === 0 ? "bg-slate-50 border-l-2 border-primary text-primary" : "border-l-2 border-transparent"}" onclick="executeCommandPaletteCommand('${cmd.id}')">
            <i class="fa-solid ${cmd.icon} w-5 text-center ${index === 0 ? "text-primary" : "text-slate-400"}"></i>
            <span class="text-sm font-medium">${cmd.title}</span>
        </button>
    `,
        )
        .join("");
}

function updateCommandPaletteSelection() {
    commandPaletteResults.forEach((_, index) => {
        const btn = document.getElementById(`cmd-item-${index}`);
        if (!btn) return;
        const icon = btn.querySelector("i");
        if (index === commandPaletteSelectedIndex) {
            btn.classList.add("bg-slate-50", "border-primary", "text-primary");
            btn.classList.remove("border-transparent", "text-slate-700");
            icon?.classList.add("text-primary");
            icon?.classList.remove("text-slate-400");
            btn.scrollIntoView({ block: "nearest" });
        } else {
            btn.classList.remove("bg-slate-50", "border-primary", "text-primary");
            btn.classList.add("border-transparent", "text-slate-700");
            icon?.classList.remove("text-primary");
            icon?.classList.add("text-slate-400");
        }
    });
}

function executeSelectedCommand() {
    if (commandPaletteResults[commandPaletteSelectedIndex]) {
        executeCommandPaletteCommand(commandPaletteResults[commandPaletteSelectedIndex].id);
    }
}

function executeCommandPaletteCommand(cmdId) {
    const cmd = COMMANDS.find(c => c.id === cmdId);
    if (cmd) {
        closeCommandPalette();
        // slight delay to let modal close
        setTimeout(() => cmd.action(), 50);
    }
}

window.executeCommandPaletteCommand = executeCommandPaletteCommand;
