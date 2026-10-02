// Start screen: shown when the editor opens (and from the toolbar's Home button). Lists recent presentations and
// offers a new blank deck, a deck in a chosen theme, or an import. Opening, creating and importing reuse the
// editor's own functions (loadProjectById, createNewProject, changePresentationTheme, import helpers).

const START_SCREEN_THEMES = ["editorial", "blueprint", "graphite", "horizon", "sage", "afterglow"];
const START_SCREEN_FEATURES = [
    ["fa-solid fa-shapes", "Text, tables, charts, shapes and connectors"],
    ["fa-solid fa-square-root-variable", "Equations, diagrams and 3D molecules"],
    ["fa-solid fa-wand-magic-sparkles", "Animations, transitions and presenter view"],
    ["fa-solid fa-file-export", "Export to PowerPoint, PDF, images or HTML"],
];

let _startScreenProjects = [];
let _startScreenReturnFocus = null;

function _startEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function _startIcon(className) {
    const icon = document.createElement("i");
    icon.className = className;
    icon.setAttribute("aria-hidden", "true");
    return icon;
}

function _startCover(themeId, title, slideCount = null, font = "") {
    const theme = (typeof PRESENTATION_THEMES !== "undefined" && PRESENTATION_THEMES[themeId]) || PRESENTATION_THEMES?.editorial;
    const cover = _startEl("div", "sf-cover");
    if (theme) {
        cover.style.setProperty("--cover-bg", theme.cssVars?.["--slide-bg"] || "#fff");
        cover.style.setProperty("--cover-fg", theme.cssVars?.["--slide-fg"] || theme.defaultTextColor || "#0f172a");
        cover.style.setProperty("--cover-accent", theme.cssVars?.["--slide-accent"] || theme.accentStrong || "#4f46e5");
        // The deck's own title font when known: a deck in a sans font showed a serif cover (the theme's font).
        cover.style.setProperty("--cover-font", font || theme.headingFont || "inherit");
    }
    cover.append(_startEl("div", "sf-cover__title", title || "Untitled Presentation"));
    if (slideCount !== null) {
        cover.append(_startEl("span", "sf-cover__count", `${slideCount} ${slideCount === 1 ? "slide" : "slides"}`));
    }
    return cover;
}

function _startRelativeTime(isoDate) {
    const then = new Date(isoDate).getTime();
    if (!Number.isFinite(then)) return "";
    const seconds = Math.round((then - Date.now()) / 1000);
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
    }
    return "just now";
}

function _startCanClose() {
    return Boolean(currentPresentationId);
}

function _startShowError(message) {
    const error = document.getElementById("sf-start-error");
    if (error) error.textContent = message || "";
}

async function _startRun(button, action) {
    _startShowError("");
    button?.classList.add("sf-card--busy");
    try {
        await action();
        closeStartScreen();
    } catch (err) {
        console.warn("Start screen action failed:", err);
        _startShowError(err?.message ? `Something went wrong: ${err.message}` : "Something went wrong. Please try again.");
    } finally {
        button?.classList.remove("sf-card--busy");
    }
}

function _startNewPresentation(themeId = null) {
    return async () => {
        const created = await createNewProject();
        if (created === false) throw new Error("the local server is not ready yet");
        if (themeId && themeId !== state.presentationTheme && typeof changePresentationTheme === "function") {
            changePresentationTheme(themeId);
            resetUndoHistory?.();
            schedulePresentationAutosave?.(200);
        }
    };
}

function _startForgetCurrentProject() {
    clearTimeout(_autosaveTimer);
    currentPresentationId = null;
    currentPresentationAutosaveVersion = 0;
    _lastPersistedFingerprint = "";
    localStorage.removeItem(PRESENTATION_STORAGE_KEY);
    state = buildDefaultPresentationState();
    normalizeStateIds();
    currentSlideIndex = 0;
    resetUndoHistory?.();
    setCurrentPresentationTitle("Untitled Presentation");
    applyPresentationTheme(state.presentationTheme, { persist: false });
    renderSlidesFromState?.();
    updateSlideCounter?.();
}

function _startConfirmDelete(card, project) {
    if (card.querySelector(".sf-card__confirm")) return;
    const confirm = _startEl("div", "sf-card__confirm");
    confirm.append(_startEl("span", "", `Delete “${project.title || "Untitled Presentation"}”? This cannot be undone.`));
    const buttons = _startEl("div");
    const remove = _startEl("button", "sf-danger", "Delete");
    const cancel = _startEl("button", "sf-cancel", "Cancel");
    remove.type = cancel.type = "button";
    buttons.append(remove, cancel);
    confirm.append(buttons);
    confirm.addEventListener("click", event => event.stopPropagation());
    cancel.addEventListener("click", () => {
        confirm.remove();
        card.focus();
    });
    remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
            await _presentationRequest(`/api/presentations/${project.id}/`, { method: "DELETE" });
            if (project.id === currentPresentationId) _startForgetCurrentProject();
            _startScreenProjects = _startScreenProjects.filter(item => item.id !== project.id);
            card.style.transition = "opacity 180ms, transform 180ms";
            card.style.opacity = "0";
            card.style.transform = "scale(0.96)";
            setTimeout(_startRenderProjects, 180);
            _startUpdateClose();
        } catch (err) {
            remove.disabled = false;
            _startShowError(`Could not delete: ${err?.message || err}`);
        }
    });
    card.append(confirm);
    remove.focus();
}

function _startProjectCard(project, index) {
    const card = _startEl("div", "sf-card");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.style.setProperty("--i", String(index));
    const isCurrent = project.id === currentPresentationId;
    if (isCurrent) card.classList.add("sf-card--current");
    const title = project.title || "Untitled Presentation";
    card.setAttribute("aria-label", `${isCurrent ? "Continue" : "Open"} ${title}`);

    card.append(_startCover(project.presentationTheme, project.coverTitle || title, project.slideCount ?? null, project.coverFont || ""));
    const meta = _startEl("div", "sf-card__meta");
    meta.append(_startEl("p", "sf-card__title", title));
    meta.append(_startEl("p", "sf-card__sub", `Edited ${_startRelativeTime(project.updatedAt)}`));
    card.append(meta);
    if (isCurrent) card.append(_startEl("span", "sf-card__badge", "Open now"));

    const remove = _startEl("button", "sf-card__delete");
    remove.type = "button";
    remove.title = "Delete presentation";
    remove.setAttribute("aria-label", `Delete ${title}`);
    remove.append(_startIcon("fa-regular fa-trash-can"));
    remove.addEventListener("click", event => {
        event.stopPropagation();
        _startConfirmDelete(card, project);
    });
    card.append(remove);

    const open = () =>
        _startRun(card, async () => {
            if (project.id !== currentPresentationId) {
                const loaded = await loadProjectById(project.id);
                if (!loaded) throw new Error("the presentation could not be opened");
            }
        });
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
        } else if (event.key === "Delete") {
            event.preventDefault();
            _startConfirmDelete(card, project);
        }
    });
    return card;
}

function _startRenderProjects() {
    const grid = document.getElementById("sf-start-recent");
    if (!grid) return;
    const query = (document.getElementById("sf-start-search")?.value || "").trim().toLowerCase();
    const projects = _startScreenProjects.filter(
        project => !query || `${project.title} ${project.coverTitle || ""}`.toLowerCase().includes(query),
    );
    grid.replaceChildren();
    if (!_startScreenProjects.length) {
        const empty = _startEl("div", "sf-recent__empty");
        empty.append(_startIcon("fa-regular fa-folder-open"));
        empty.append(_startEl("strong", "", "No presentations yet"));
        empty.append(_startEl("span", "", "Create one on the left. It will show up here next time."));
        grid.append(empty);
        return;
    }
    if (!projects.length) {
        grid.append(_startEl("div", "sf-recent__message", `No presentations match “${query}”.`));
        return;
    }
    projects.forEach((project, index) => grid.append(_startProjectCard(project, index)));
}

async function _startLoadProjects() {
    const grid = document.getElementById("sf-start-recent");
    if (grid) {
        grid.replaceChildren(...Array.from({ length: 4 }, () => _startEl("div", "sf-skeleton")));
    }
    try {
        const payload = await _presentationRequest("/api/presentations/", { method: "GET" });
        _startScreenProjects = Array.isArray(payload?.presentations) ? payload.presentations : [];
    } catch (err) {
        console.warn("Could not load recent presentations:", err);
        _startScreenProjects = [];
        if (grid) {
            grid.replaceChildren(_startEl("div", "sf-recent__message", "Recent presentations could not be loaded."));
        }
        return;
    }
    _startRenderProjects();
}

function _startUpdateClose() {
    const close = document.getElementById("sf-start-close");
    if (close) close.hidden = !_startCanClose();
}

function _buildStartScreen() {
    const root = _startEl("div", "sf-start");
    root.id = "start-screen";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "sf-start-title");
    root.hidden = true;
    root.append(_startEl("div", "sf-start__backdrop"));

    const panel = _startEl("div", "sf-start__panel");
    const hero = _startEl("header", "sf-start__hero");
    const logo = _startEl("img", "sf-start__logo");
    logo.src = "assets/favicon.svg";
    logo.alt = "";
    const brand = _startEl("div", "sf-start__brand");
    const heading = _startEl("h1", "", "SlideForge");
    heading.id = "sf-start-title";
    brand.append(
        heading,
        _startEl(
            "p",
            "",
            "Build polished slide decks on a free-form canvas: text, charts, equations, diagrams and molecules, " +
                "with animations and a presenter view. Export to PowerPoint and PDF when you are done.",
        ),
    );
    const close = _startEl("button", "sf-start__close");
    close.id = "sf-start-close";
    close.type = "button";
    close.append(_startEl("span", "", "Back to editor"), _startEl("kbd", "", "Esc"));
    close.addEventListener("click", () => closeStartScreen());
    hero.append(logo, brand, close);

    const body = _startEl("div", "sf-start__body");

    const create = _startEl("section", "sf-start__create");
    create.append(_startEl("h2", "", "Start"));
    const blank = _startEl("button", "sf-new");
    blank.id = "sf-start-new";
    blank.type = "button";
    const blankIcon = _startEl("span", "sf-new__icon");
    blankIcon.append(_startIcon("fa-solid fa-plus"));
    const blankText = _startEl("div");
    blankText.append(_startEl("strong", "", "New presentation"), _startEl("span", "", "Start from a blank deck"));
    blank.append(blankIcon, blankText);
    blank.addEventListener("click", () => _startRun(null, _startNewPresentation()));
    create.append(blank);

    create.append(_startEl("h3", "", "Start with a theme"));
    const themes = _startEl("div", "sf-themes");
    const addThemeTile = id => {
        const tile = _startEl("button", "sf-theme");
        tile.type = "button";
        tile.title = `New presentation in the ${PRESENTATION_THEMES[id].label} theme`;
        tile.append(_startCover(id, "Title"), _startEl("span", "", PRESENTATION_THEMES[id].label));
        tile.addEventListener("click", () => _startRun(null, _startNewPresentation(id)));
        themes.append(tile);
    };
    START_SCREEN_THEMES.filter(id => PRESENTATION_THEMES?.[id]).forEach(addThemeTile);
    create.append(themes);
    // The other themes on request: 11 of the 17 had no preview anywhere.
    const more = Object.keys(PRESENTATION_THEMES || {}).filter(id => !START_SCREEN_THEMES.includes(id));
    if (more.length) {
        const moreButton = _startEl("button", "sf-more-themes", `More themes (${more.length})`);
        moreButton.type = "button";
        moreButton.addEventListener("click", () => {
            const firstNew = themes.children.length;
            more.forEach(addThemeTile);
            // Focus stays in the screen (on the first new tile): with the button gone it fell to the page, and
            // Escape no longer closed the screen.
            themes.children[firstNew]?.focus({ preventScroll: true });
            moreButton.remove();
        });
        create.append(moreButton);
    }

    create.append(_startEl("h3", "", "Import"));
    const imports = _startEl("div", "sf-imports");
    [
        ["fa-regular fa-file-powerpoint", "PowerPoint", ".pptx file", () => triggerImportPptx()],
        ["fa-regular fa-file-code", "SlideForge file", ".json export", () => importPresentationJson()],
    ].forEach(([icon, label, hint, action]) => {
        const button = _startEl("button", "sf-import");
        button.type = "button";
        const text = _startEl("div");
        text.append(_startEl("span", "", label), _startEl("small", "", hint));
        button.append(_startIcon(icon), text);
        button.addEventListener("click", () => {
            // The file picker opens over the editor; the import always gets a new project of its own.
            closeStartScreen({ force: true });
            action();
        });
        imports.append(button);
    });
    create.append(imports);

    create.append(_startEl("h3", "", "What you can build"));
    const features = _startEl("ul", "sf-features");
    START_SCREEN_FEATURES.forEach(([icon, text]) => {
        const item = _startEl("li");
        const badge = _startEl("span", "sf-features__icon");
        badge.append(_startIcon(icon));
        item.append(badge, _startEl("span", "", text));
        features.append(item);
    });
    create.append(features);
    const error = _startEl("p", "sf-start__error");
    error.id = "sf-start-error";
    error.setAttribute("role", "alert");
    create.append(error);

    const recent = _startEl("section", "sf-start__recent");
    const head = _startEl("div", "sf-recent__head");
    head.append(_startEl("h2", "", "Recent presentations"));
    const search = _startEl("label", "sf-search");
    const searchInput = _startEl("input");
    searchInput.id = "sf-start-search";
    searchInput.type = "search";
    searchInput.placeholder = "Search presentations";
    searchInput.setAttribute("aria-label", "Search presentations");
    searchInput.addEventListener("input", _startRenderProjects);
    search.append(_startIcon("fa-solid fa-magnifying-glass"), searchInput);
    head.append(search);
    const grid = _startEl("div", "sf-recent__grid");
    grid.id = "sf-start-recent";
    recent.append(head, grid);

    body.append(create, recent);

    const footer = _startEl("footer", "sf-start__footer");
    const reopen = _startEl("span", "", "Reopen this screen any time with the ");
    reopen.append(_startIcon("fa-solid fa-house"), document.createTextNode(" button in the toolbar."));
    footer.append(reopen);

    panel.append(hero, body, footer);
    root.append(panel);
    root.addEventListener("keydown", event => {
        if (event.key === "Escape" && _startCanClose()) {
            event.preventDefault();
            closeStartScreen();
        }
    });
    document.body.append(root);
    return root;
}

function isStartScreenOpen() {
    const root = document.getElementById("start-screen");
    return Boolean(root && !root.hidden);
}

function openStartScreen() {
    // Saved projects need the server and (in the web app) a signed-in account.
    if (!_backendApiAvailable) {
        setProjectSaveHint?.("Saved projects are unavailable while the server is offline", "warn");
        return false;
    }
    if (!currentAuthUser) {
        window.openAuthModal?.("login");
        return false;
    }
    window.closeEditorDialogs?.({ all: true }); // nothing from the editor may sit on top of the start screen
    window.closeMermaidDialog?.();
    const root = document.getElementById("start-screen") || _buildStartScreen();
    _startScreenReturnFocus = document.activeElement;
    root.classList.remove("sf-start--leaving");
    root.hidden = false;
    document.body.classList.add("start-screen-open");
    _startShowError("");
    const search = document.getElementById("sf-start-search");
    if (search) search.value = "";
    _startUpdateClose();
    _startLoadProjects();
    requestAnimationFrame(() => document.getElementById("sf-start-new")?.focus());
    return true;
}

function closeStartScreen({ force = false } = {}) {
    const root = document.getElementById("start-screen");
    if (!root || root.hidden) return;
    if (!force && !_startCanClose()) return;
    const finish = () => {
        root.hidden = true;
        root.classList.remove("sf-start--leaving");
        document.body.classList.remove("start-screen-open");
        _startScreenReturnFocus?.focus?.();
        _startScreenReturnFocus = null;
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        finish();
        return;
    }
    root.classList.add("sf-start--leaving");
    setTimeout(finish, 190);
}

window.openStartScreen = openStartScreen;
window.closeStartScreen = closeStartScreen;
window.isStartScreenOpen = isStartScreenOpen;
