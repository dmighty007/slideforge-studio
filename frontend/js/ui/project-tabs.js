// Open project sessions live in memory; the existing persistence layer still owns saving.
const _openProjectTabs = new Map();
let _projectTabBusy = false;

function registerProjectTab() {
    if (!currentPresentationId || !currentAuthUser) return;
    const id = String(currentPresentationId);
    const tab = _openProjectTabs.get(id) || { id, snapshot: null };
    tab.title = currentPresentationTitle;
    _openProjectTabs.set(id, tab);
    renderProjectTabs();
}

function updateProjectTabTitle() {
    const tab = _openProjectTabs.get(String(currentPresentationId));
    if (!tab) return;
    tab.title = currentPresentationTitle;
    // Keep the button nodes: a title field blurs before a tab click, and replacing
    // that tab on blur would swallow the click.
    const button = document.getElementById(`project-tab-${tab.id}`);
    if (button) {
        button.textContent = button.title = tab.title;
        button.nextElementSibling?.setAttribute("aria-label", `Close ${tab.title}`);
    }
}

function captureProjectTab() {
    if (!currentPresentationId) return;
    registerProjectTab();
    const tab = _openProjectTabs.get(String(currentPresentationId));
    if (!tab) return;
    tab.snapshot = {
        state: structuredClone(getPersistableState()), slide: currentSlideIndex,
        undo: undoStack.slice(), redo: redoStack.slice(),
        version: currentPresentationAutosaveVersion,
        fingerprint: _lastPersistedFingerprint, persistedTitle: _lastPersistedTitle,
        conflict: _saveConflict,
    };
}

function restoreProjectTab(id) {
    const tab = _openProjectTabs.get(String(id));
    if (!tab?.snapshot) return false;
    const saved = tab.snapshot;
    ++_presentationLoadGeneration;
    clearTimeout(_autosaveTimer);
    setPresentationHydrating(true);
    try {
        currentPresentationId = tab.id;
        currentPresentationAutosaveVersion = saved.version;
        state = structuredClone(saved.state);
        currentSlideIndex = Math.min(saved.slide, state.slides.length - 1);
        undoStack = saved.undo.slice();
        redoStack = saved.redo.slice();
        _lastPersistedFingerprint = saved.fingerprint;
        _lastPersistedTitle = saved.persistedTitle;
        _saveConflict = saved.conflict;
        setCurrentPresentationTitle(tab.title);
        localStorage.setItem(PRESENTATION_STORAGE_KEY, tab.id);
        clearSelection?.();
        applyPresentationTheme(state.presentationTheme, { persist: false });
        syncPresentationPageSetup?.();
        renderSlidesFromState?.();
        updateSlideCounter?.();
        setProjectSaveHint(_saveConflict ? SAVE_CONFLICT_MESSAGE : _persistedStateIsCurrent() ? "All changes saved" : "Unsaved changes", _saveConflict ? "danger" : "muted");
    } finally {
        setPresentationHydrating(false);
    }
    if (!_saveConflict && !_persistedStateIsCurrent()) schedulePresentationAutosave(300);
    renderProjectTabs();
    return true;
}

function forgetProjectTab(id) {
    _openProjectTabs.delete(String(id));
    renderProjectTabs();
}

function clearProjectTabs() {
    _openProjectTabs.clear();
    renderProjectTabs();
}

async function activateProjectTab(id) {
    if (_projectTabBusy || String(currentPresentationId) === String(id)) return;
    _projectTabBusy = true;
    renderProjectTabs();
    try {
        window.closeEditorDialogs?.({ all: true });
        await loadProjectById(id);
    } catch (error) {
        showNotification?.(`Could not open project: ${error.message}`, "error");
    } finally {
        _projectTabBusy = false;
        renderProjectTabs();
        document.getElementById(`project-tab-${currentPresentationId}`)?.focus();
    }
}

async function closeProjectTab(id) {
    if (_projectTabBusy) return;
    const key = String(id);
    if (String(currentPresentationId) !== key) {
        const tab = _openProjectTabs.get(key);
        if (tab?.snapshot && (tab.snapshot.fingerprint !== JSON.stringify(tab.snapshot.state) || tab.title !== tab.snapshot.persistedTitle)) {
            await activateProjectTab(key);
            showNotification?.("Save this project's changes before closing its tab.", "info");
            return;
        }
        forgetProjectTab(key);
        return;
    }
    _projectTabBusy = true;
    renderProjectTabs();
    try {
        await _saveOpenProjectBeforeSwitch();
        if (!_persistedStateIsCurrent() || _saveConflict) {
            showNotification?.("Save this project's changes before closing its tab.", "info");
            return;
        }
        const ids = [..._openProjectTabs.keys()];
        const index = ids.indexOf(key);
        const next = ids[index + 1] || ids[index - 1];
        if (next && !await loadProjectById(next)) return;
        forgetProjectTab(key);
        if (!next) {
            _startForgetCurrentProject();
            openStartScreen();
        }
    } catch (error) {
        showNotification?.(`Could not close project: ${error.message}`, "error");
    } finally {
        _projectTabBusy = false;
        renderProjectTabs();
        document.getElementById(`project-tab-${currentPresentationId}`)?.focus();
    }
}

function renderProjectTabs() {
    const strip = document.getElementById("project-tabs");
    if (!strip) return;
    // One open project needs no tabs: the title field already names it.
    strip.hidden = _openProjectTabs.size < 2;
    strip.replaceChildren();
    for (const tab of _openProjectTabs.values()) {
        const active = tab.id === String(currentPresentationId);
        const item = document.createElement("div");
        item.className = `project-tab${active ? " is-active" : ""}`;
        item.setAttribute("role", "presentation");
        const button = document.createElement("button");
        button.type = "button";
        button.id = `project-tab-${tab.id}`;
        button.className = "project-tab__select";
        button.textContent = tab.title || "Untitled Presentation";
        button.title = button.textContent;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(active));
        button.setAttribute("aria-controls", "editor-shell");
        button.tabIndex = active ? 0 : -1;
        button.disabled = _projectTabBusy;
        button.onclick = () => activateProjectTab(tab.id);
        button.onkeydown = event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End", "Delete"].includes(event.key)) return;
            event.preventDefault();
            if (event.key === "Delete") { closeProjectTab(tab.id); return; }
            const ids = [..._openProjectTabs.keys()];
            const index = ids.indexOf(tab.id);
            const next = event.key === "Home" ? ids[0] : event.key === "End" ? ids.at(-1) : ids[(index + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
            activateProjectTab(next);
        };
        const close = document.createElement("button");
        close.type = "button";
        close.className = "project-tab__close";
        close.textContent = "×";
        close.setAttribute("aria-label", `Close ${tab.title}`);
        close.title = "Close tab";
        close.disabled = _projectTabBusy;
        close.onclick = () => closeProjectTab(tab.id);
        item.append(button, close);
        strip.append(item);
    }
    strip.querySelector('.is-active')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
