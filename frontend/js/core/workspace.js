// AI-native workspace shell: adaptive modes, docks, and keyboard insertion.

const SLIDEFORGE_WORKSPACE_MODES = {
    slides: { label: "Slides", bodyClass: "workspace-slides" },
    whiteboard: { label: "Board", bodyClass: "workspace-whiteboard" },
    timeline: { label: "Motion", bodyClass: "workspace-timeline" },
    review: { label: "Review", bodyClass: "workspace-review" },
};

const SLASH_COMMANDS = [
    {
        id: "text",
        label: "Text block",
        detail: "Add a clean editable text object",
        icon: "fa-t",
        run: () => window.addElement?.("text"),
    },
    {
        id: "equation",
        label: "Equation",
        detail: "Create a LaTeX equation block",
        icon: "fa-square-root-variable",
        run: () => window.openEquationModal?.(),
    },
    {
        id: "chart",
        label: "Chart",
        detail: "Insert a scientific chart starter",
        icon: "fa-chart-column",
        run: () => window.addChart?.("bar"),
    },
    {
        id: "diagram",
        label: "Diagram",
        detail: "Build a flowchart or pathway diagram",
        icon: "fa-diagram-project",
        run: () => window.openMermaidDialog?.(),
    },
    {
        id: "molecule",
        label: "Molecule / trajectory",
        detail: "Import a PDB, CIF, SDF, or trajectory asset",
        icon: "fa-atom",
        run: () => document.getElementById("molecule-file-upload")?.click(),
    },
    {
        id: "polish",
        label: "AI polish slide",
        detail: "Improve visual hierarchy on the active slide",
        icon: "fa-wand-magic-sparkles",
        run: () => window.aiCleanUpSlide?.(),
    },
    {
        id: "timeline",
        label: "Open motion timeline",
        detail: "Edit builds, timings, and object tracks",
        icon: "fa-film",
        run: () => setWorkspaceMode("timeline"),
    },
];

let slashSelectedIndex = 0;
let slashResults = SLASH_COMMANDS;

function setWorkspaceMode(mode) {
    const config = SLIDEFORGE_WORKSPACE_MODES[mode] || SLIDEFORGE_WORKSPACE_MODES.slides;
    const shell = document.getElementById("editor-shell");
    const label = document.getElementById("workspace-mode-label");

    if (shell) shell.dataset.workspaceMode = mode;
    if (label) label.textContent = config.label;

    Object.values(SLIDEFORGE_WORKSPACE_MODES).forEach(item => document.body.classList.remove(item.bodyClass));
    document.body.classList.add(config.bodyClass);

    document.querySelectorAll(".workspace-mode-btn").forEach(btn => {
        const active = btn.dataset.workspaceMode === mode;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const isWhiteboardActive = document.body.classList.contains("whiteboard-mode-active");
    if (mode === "whiteboard" && typeof window.toggleWhiteboardMode === "function" && !isWhiteboardActive) {
        window.toggleWhiteboardMode();
    } else if (mode !== "whiteboard" && isWhiteboardActive && typeof window.exitWhiteboardMode === "function") {
        window.exitWhiteboardMode();
    }

    if (mode === "timeline") {
        const timeline = typeof window.getTimelineEditor === "function" ? window.getTimelineEditor() : null;
        if (timeline && !timeline.isVisible) {
            window.toggleTimelineEditor?.();
        }
    } else if (typeof window.getTimelineEditor === "function") {
        const timeline = window.getTimelineEditor();
        if (timeline?.isVisible) {
            window.toggleTimelineEditor?.();
        }
    }

    if (mode === "review" && typeof setPropertiesPanelVisible === "function") {
        setPropertiesPanelVisible(true);
    }

    requestAnimationFrame(() => {
        window.handleEditorViewportResize?.();
        window.updateFloatingToolbars?.();
    });
}

function toggleSlideRail() {
    document.body.classList.toggle("slide-rail-collapsed");
    const refitEditor = () => {
        if (typeof window.resetZoom === "function") {
            window.resetZoom();
        } else {
            window.handleEditorViewportResize?.();
            window.centerSlide?.();
        }
        window.updateFloatingToolbars?.();
    };
    requestAnimationFrame(() => {
        refitEditor();
        window.setTimeout(refitEditor, 220);
        window.setTimeout(refitEditor, 420);
    });
}

function toggleInsertDock(force) {
    const dock = document.getElementById("context-insert-fab");
    if (!dock) return;
    dock.classList.toggle("open", typeof force === "boolean" ? force : !dock.classList.contains("open"));
}

function toggleAIDock(force) {
    const dock = document.getElementById("ai-assistant-dock");
    const button = dock?.querySelector(".ai-dock-toggle");
    if (!dock) return;

    const nextOpen = typeof force === "boolean" ? force : dock.dataset.state !== "open";
    dock.dataset.state = nextOpen ? "open" : "collapsed";
    button?.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

function openSlashCommandMenu() {
    const menu = document.getElementById("slash-command-menu");
    const input = document.getElementById("slash-command-input");
    if (!menu || !input) return;

    slashSelectedIndex = 0;
    input.value = "";
    renderSlashCommands("");
    menu.classList.remove("hidden");
    requestAnimationFrame(() => input.focus());
}

function closeSlashCommandMenu() {
    document.getElementById("slash-command-menu")?.classList.add("hidden");
}

function renderSlashCommands(query) {
    const container = document.getElementById("slash-command-results");
    if (!container) return;

    const normalized = String(query || "").toLowerCase().trim();
    slashResults = SLASH_COMMANDS.filter(cmd => {
        return !normalized || cmd.label.toLowerCase().includes(normalized) || cmd.detail.toLowerCase().includes(normalized) || cmd.id.includes(normalized);
    });
    slashSelectedIndex = Math.min(slashSelectedIndex, Math.max(0, slashResults.length - 1));

    if (!slashResults.length) {
        container.innerHTML = `<div class="px-4 py-8 text-center text-sm text-slate-400">No insertion command found.</div>`;
        return;
    }

    container.innerHTML = slashResults
        .map(
            (cmd, index) => `
                <button type="button" class="slash-command-item ${index === slashSelectedIndex ? "active" : ""}" data-slash-index="${index}">
                    <i class="fa-solid ${cmd.icon}"></i>
                    <span><strong>${cmd.label}</strong><span>${cmd.detail}</span></span>
                </button>
            `,
        )
        .join("");
}

function executeSlashCommand(index = slashSelectedIndex) {
    const command = slashResults[index];
    if (!command) return;
    closeSlashCommandMenu();
    setTimeout(() => command.run(), 30);
}

function initWorkspaceShell() {
    const compactRailQuery = window.matchMedia?.("(max-width: 720px)");
    document.body.classList.toggle("slide-rail-collapsed", Boolean(compactRailQuery?.matches));
    compactRailQuery?.addEventListener?.("change", event => {
        document.body.classList.toggle("slide-rail-collapsed", event.matches);
        window.requestAnimationFrame(() => {
            window.resetZoom?.();
            window.handleEditorViewportResize?.();
            window.centerSlide?.();
        });
    });
    localStorage.removeItem("slideforge_slide_rail_collapsed");
    localStorage.removeItem("slideforge_workspace_mode");
    setWorkspaceMode("slides");
    registerWorkspaceCommands();

    const slashInput = document.getElementById("slash-command-input");
    slashInput?.addEventListener("input", event => renderSlashCommands(event.target.value));
    slashInput?.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            slashSelectedIndex = Math.min(slashSelectedIndex + 1, slashResults.length - 1);
            renderSlashCommands(slashInput.value);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            slashSelectedIndex = Math.max(slashSelectedIndex - 1, 0);
            renderSlashCommands(slashInput.value);
        } else if (event.key === "Enter") {
            event.preventDefault();
            executeSlashCommand();
        } else if (event.key === "Escape") {
            event.preventDefault();
            closeSlashCommandMenu();
        }
    });

    document.getElementById("slash-command-results")?.addEventListener("click", event => {
        const button = event.target.closest?.("[data-slash-index]");
        if (!button) return;
        executeSlashCommand(Number(button.dataset.slashIndex));
    });

    document.addEventListener(
        "keydown",
        event => {
            if (document.body.classList.contains("play-mode-active")) return;
            if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target || document.activeElement;
            if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
            event.preventDefault();
            openSlashCommandMenu();
        },
        true,
    );

    document.addEventListener("mousedown", event => {
        const slashMenu = document.getElementById("slash-command-menu");
        if (slashMenu && !slashMenu.classList.contains("hidden") && !slashMenu.contains(event.target)) {
            closeSlashCommandMenu();
        }
        const insertDock = document.getElementById("context-insert-fab");
        if (insertDock && insertDock.classList.contains("open") && !insertDock.contains(event.target)) {
            toggleInsertDock(false);
        }
    });
}

function registerWorkspaceCommands() {
    if (typeof COMMANDS === "undefined" || !Array.isArray(COMMANDS)) return;
    const additions = [
        { id: "workspace-slides", title: "Workspace: Slides Mode", icon: "fa-window-maximize", action: () => setWorkspaceMode("slides") },
        { id: "workspace-whiteboard", title: "Workspace: Whiteboard Mode", icon: "fa-chalkboard", action: () => setWorkspaceMode("whiteboard") },
        { id: "workspace-timeline", title: "Workspace: Timeline / Animation Mode", icon: "fa-film", action: () => setWorkspaceMode("timeline") },
        { id: "workspace-review", title: "Workspace: Review Mode", icon: "fa-comment-dots", action: () => setWorkspaceMode("review") },
        { id: "open-slash-insert", title: "Open Slash Insert Menu", icon: "fa-terminal", action: () => openSlashCommandMenu() },
        { id: "toggle-ai-dock", title: "Toggle AI Assistant Dock", icon: "fa-wand-magic-sparkles", action: () => toggleAIDock() },
    ];
    additions.forEach(command => {
        if (!COMMANDS.some(existing => existing.id === command.id)) COMMANDS.push(command);
    });
}

window.setWorkspaceMode = setWorkspaceMode;
window.toggleSlideRail = toggleSlideRail;
window.toggleInsertDock = toggleInsertDock;
window.toggleAIDock = toggleAIDock;
window.openSlashCommandMenu = openSlashCommandMenu;
window.closeSlashCommandMenu = closeSlashCommandMenu;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWorkspaceShell, { once: true });
} else {
    initWorkspaceShell();
}
