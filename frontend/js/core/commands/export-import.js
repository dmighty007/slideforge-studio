// Commands: exporting (JSON, ZIP, PDF, PPTX, SVG) and importing presentations.

// ─── Export ───────────────────────────────────────────────────────────────────

async function exportJSON() {
    const filenameBase =
        (typeof currentPresentationTitle !== "undefined" && currentPresentationTitle
            ? currentPresentationTitle
            : "presentation"
        )
            .replace(/[^\w\-]+/g, "_")
            .replace(/^_+|_+$/g, "") || "presentation";
    const a = document.createElement("a");
    // The deck's name travels with it: an imported deck was named after its file ("deck").
    const title = typeof currentPresentationTitle !== "undefined" && currentPresentationTitle ? String(currentPresentationTitle) : "";
    const deck = JSON.parse(JSON.stringify(state));
    await inlineUploadedVideosForExport(deck);
    const payload = title ? { title, ...deck } : deck;
    // A file, not a data: link: with videos inside, the text is too long for a link.
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    a.setAttribute("href", blobUrl);
    a.setAttribute("download", `${filenameBase}.json`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}

// Uploaded videos go into the JSON file itself: the deck held only their address on this computer
// (/media/assets/…), so on another install, or the desktop app importing a deck made elsewhere, they were missing
// ("Unsupported Format"). Opening the file uploads them again (migrateInlineVideoAssets).
async function inlineUploadedVideosForExport(deck) {
    const elements = (deck.slides || []).flatMap(slide => slide.elements || []);
    for (const el of elements) {
        // Sounds too, the same way.
        if ((el?.type !== "video" && el?.type !== "audio") || typeof el.content !== "string" || !/^\/media\/assets\//.test(el.content)) continue;
        const kind = el.type === "audio" ? "audio" : "video";
        try {
            const response = await fetch(el.content);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            el.content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob.type.startsWith(`${kind}/`) ? blob : blob.slice(0, blob.size, el.localMimeType || (kind === "audio" ? "audio/mpeg" : "video/mp4")));
            });
            delete el.videoWebm; // a copy on this computer only; the importing app makes its own
            delete el.audioWebm;
        } catch (error) {
            console.warn("Video kept as a link in the JSON export:", el.content, error);
        }
    }
}

function exportPresentationJson() {
    exportJSON();
}

// Imports never go into a different project that happens to be open, unless that project is already open in a tab
// for this same file (re-importing the same file updates its open tab in place instead of spawning a duplicate tab).
let _importProjectRollback = null;

async function startNewProjectForImport(file = null, options = {}) {
    const previousId = typeof currentPresentationId !== "undefined" ? currentPresentationId : null;
    const baseTitle =
        options.baseTitle ||
        String(file?.name || "")
            .replace(/\.(pptx|key|pdf|json)$/i, "")
            .trim();
    const matchByTitle = options.matchByTitle !== undefined ? Boolean(options.matchByTitle) : !/\.json$/i.test(String(file?.name || ""));
    const existingTab =
        (file || baseTitle) && typeof window.findOpenProjectTabForImport === "function"
            ? window.findOpenProjectTabForImport(file?.name || "", baseTitle, { matchByTitle })
            : null;

    if (existingTab && existingTab.id) {
        try {
            if (previousId && String(previousId) !== String(existingTab.id)) {
                await autosavePresentationNow();
            }
        } catch (err) {
            console.warn("Could not save the open project before switching to import target tab:", err);
        }
        if (String(currentPresentationId) !== String(existingTab.id) && typeof loadProjectById === "function") {
            await loadProjectById(existingTab.id);
        }
        _importProjectRollback = {
            mode: "reused",
            previousId,
            reusedId: existingTab.id,
            reusedSnapshot:
                typeof getPersistableState === "function"
                    ? {
                          state: JSON.parse(JSON.stringify(getPersistableState())),
                          title: typeof currentPresentationTitle !== "undefined" ? currentPresentationTitle : existingTab.title,
                          slideIndex: typeof currentSlideIndex !== "undefined" ? currentSlideIndex : 0,
                      }
                    : null,
        };
        if (file?.name) window.setProjectTabImportSource?.(existingTab.id, file.name);
        return { reused: true, presentationId: existingTab.id, title: existingTab.title || baseTitle };
    }

    const localSnapshot =
        !previousId && typeof getPersistableState === "function"
            ? {
                  state: JSON.parse(JSON.stringify(getPersistableState())),
                  title: typeof currentPresentationTitle !== "undefined" ? currentPresentationTitle : "Untitled Presentation",
                  slideIndex: typeof currentSlideIndex !== "undefined" ? currentSlideIndex : 0,
              }
            : null;
    try {
        if (previousId) await autosavePresentationNow();
    } catch (err) {
        console.warn("Could not save the open project before importing:", err);
    }
    const created = await createNewProject({ offerUndo: false });
    if (created === false) throw new Error("sign in to import a presentation");
    const createdId = typeof currentPresentationId !== "undefined" ? currentPresentationId : null;
    if (createdId && file?.name) {
        window.setProjectTabImportSource?.(createdId, file.name);
    }
    _importProjectRollback =
        createdId && createdId !== previousId
            ? { mode: "created", previousId, createdId, localSnapshot: null }
            : localSnapshot
              ? { mode: "local", previousId: null, createdId: null, localSnapshot }
              : null;
    return { reused: false, presentationId: createdId };
}

function clearImportProjectRollback() {
    _importProjectRollback = null;
}

async function rollbackFailedImportProject() {
    const rollback = _importProjectRollback;
    _importProjectRollback = null;
    if (!rollback) return;
    if (rollback.mode === "reused" && rollback.reusedId) {
        if (rollback.reusedSnapshot && String(currentPresentationId) === String(rollback.reusedId)) {
            state = rollback.reusedSnapshot.state;
            normalizeStateIds?.();
            currentSlideIndex = Math.max(0, Math.min(rollback.reusedSnapshot.slideIndex || 0, (state.slides?.length || 1) - 1));
            setCurrentPresentationTitle?.(rollback.reusedSnapshot.title);
            syncPresentationThemeFromState?.({ persist: false });
            syncPresentationPageSetup?.();
            clearSelection?.();
            renderSlidesFromState?.();
            buildPropertiesPanel?.({ immediate: true });
            updateSlideCounter?.();
        }
        if (rollback.previousId && String(rollback.previousId) !== String(currentPresentationId) && typeof loadProjectById === "function") {
            await loadProjectById(rollback.previousId).catch(() => {});
        }
        return;
    }
    if (rollback.createdId && typeof currentPresentationId !== "undefined" && currentPresentationId === rollback.createdId) {
        clearTimeout(_autosaveTimer);
        currentPresentationId = null;
        _lastPersistedFingerprint = "";
        _lastPersistedTitle = "";
        _saveConflict = null;
        window.forgetProjectTab?.(rollback.createdId);
        try {
            await _presentationRequest?.(`/api/presentations/${rollback.createdId}/`, { method: "DELETE" });
        } catch (_err) {}
        if (rollback.previousId && typeof loadProjectById === "function") {
            await loadProjectById(rollback.previousId).catch(() => {});
        } else if (typeof _startForgetCurrentProject === "function") {
            _startForgetCurrentProject();
        }
        return;
    }
    if (rollback.localSnapshot) {
        state = rollback.localSnapshot.state;
        normalizeStateIds?.();
        currentSlideIndex = Math.max(0, Math.min(rollback.localSnapshot.slideIndex || 0, (state.slides?.length || 1) - 1));
        setCurrentPresentationTitle?.(rollback.localSnapshot.title);
        syncPresentationThemeFromState?.({ persist: false });
        syncPresentationPageSetup?.();
        clearSelection?.();
        saveLocalPresentationNow?.();
        renderSlidesFromState?.();
        buildPropertiesPanel?.({ immediate: true });
        updateSlideCounter?.();
    }
}
window.clearImportProjectRollback = clearImportProjectRollback;
window.rollbackFailedImportProject = rollbackFailedImportProject;

// The name for an imported deck: its own, or with "(imported)" when a saved deck already has that name, so the
// two can be told apart in Recent. When re-importing into an already-open tab for the same file, keep that tab's title.
async function uniqueImportTitle(title, file = null, options = {}) {
    const base = String(title || "").trim() || "Imported Presentation";
    const matchByTitle = options.matchByTitle !== undefined ? Boolean(options.matchByTitle) : !/\.json$/i.test(String(file?.name || ""));
    if (typeof window.findOpenProjectTabForImport === "function") {
        const existingTab = window.findOpenProjectTabForImport(file?.name || "", base, { matchByTitle });
        if (existingTab) return existingTab.title || base;
    }
    if (typeof _backendApiAvailable === "undefined" || !_backendApiAvailable || typeof listSavedProjects !== "function") return base;
    try {
        const taken = new Set((await listSavedProjects()).map(project => String(project.title || "").trim().toLowerCase()));
        if (!taken.has(base.toLowerCase())) return base;
        for (let n = 1; n < 100; n += 1) {
            const candidate = n === 1 ? `${base} (imported)` : `${base} (imported ${n})`;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
    } catch (_err) {}
    return base;
}

// Equations given as LaTeX only (latexSrc, no drawn content): drawn now with KaTeX, as the equation dialog draws
// them. A deck written by a script or by hand (the slide-making skill's decks) can carry just the LaTeX; it showed
// as raw "\frac{...}" text.
function renderImportedEquations(deck) {
    if (typeof katex === "undefined") return;
    (deck?.slides || []).forEach(slide =>
        (slide?.elements || []).forEach(el => {
            if (!el || (el.type !== "equation" && el.type !== "latex") || typeof el.latexSrc !== "string" || !el.latexSrc.trim()) return;
            if (typeof el.content === "string" && el.content.trim() && el.content.trim() !== el.latexSrc.trim()) return;
            try {
                el.content = katex.renderToString(el.latexSrc, { throwOnError: false, displayMode: el.displayMode !== false });
            } catch (_error) {
                // the LaTeX stays as text
            }
        }),
    );
}

// A SlideForge .json export (or a deck from the PDF bridge), imported into a project of its own: from the file
// picker, or a file given on the command line (open-requests.js).
async function importPresentationJsonFile(file) {
    try {
        const imported = JSON.parse(await file.text());
        let importedState = null;
        if (_looksLikeBridgeExport(imported)) {
            importedState = _convertBridgeExportToEditorState(imported);
        } else if (imported.slides) {
            const { title: _exportedTitle, ...deck } = imported; // the name is the project's, not part of the deck
            importedState = {
                ...deck,
                presentationTheme: imported.presentationTheme || state.presentationTheme || "blank",
            };
        }
        if (!importedState) {
            throw new Error("Unsupported presentation JSON format.");
        }
        const baseTitle = imported.title || file.name.replace(/\.json$/i, "");
        const title = await uniqueImportTitle(baseTitle, file, { matchByTitle: false });
        await startNewProjectForImport(file, { baseTitle, matchByTitle: false });
        state = importedState;
        normalizeStateIds();
        renderImportedEquations(state);
        currentSlideIndex = 0;
        if (typeof setCurrentPresentationTitle === "function") setCurrentPresentationTitle(title);
        if (typeof currentPresentationId !== "undefined" && currentPresentationId && file?.name) {
            window.setProjectTabImportSource?.(currentPresentationId, file.name);
        }
        if (typeof syncPresentationPageSetup === "function") syncPresentationPageSetup();
        applyPresentationTheme(state.presentationTheme, { persist: false });
        resetUndoHistory?.();
        // Videos carried in the file are uploaded into this install (the last opened deck's run is done).
        if (typeof migrateInlineVideoAssets === "function") {
            window.__inlineVideoMigrationPromise = null;
            await migrateInlineVideoAssets().catch(err => console.warn("Imported videos stay inline:", err));
        }
        renderSlidesFromState();
        updateSlideCounter();
        // Saved into the project just made for it. It used to be copied into a second new project, which
        // left the first behind as an empty "Untitled Presentation".
        if (typeof autosavePresentationNow === "function" && typeof currentPresentationId !== "undefined" && currentPresentationId) {
            await autosavePresentationNow();
        } else {
            schedulePresentationAutosave?.(0);
        }
    } catch (err) {
        setProjectSaveHint?.(`Invalid JSON file: ${err.message}`, "danger");
    }
}

function importPresentationJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = e => {
        const file = e.target.files?.[0];
        if (file) importPresentationJsonFile(file);
    };
    input.click();
}

function exportPresentationZip() {
    if (typeof exportZip === "function") {
        exportZip();
    } else {
        console.error("exportZip function not found. Ensure export.js is loaded.");
    }
}

function exportPresentationPDF() {
    if (typeof exportPDF === "function") {
        exportPDF();
    } else {
        console.error("exportPDF function not found. Ensure export.js is loaded.");
    }
}

function exportPresentationPPTX() {
    if (typeof exportPPTX === "function") {
        exportPPTX();
    } else {
        console.error("exportPPTX function not found. Ensure export.js is loaded.");
    }
}

function exportPresentationSceneSVG() {
    if (typeof window.exportCurrentSlideSceneSVG === "function") {
        window.exportCurrentSlideSceneSVG();
    } else {
        console.error("exportCurrentSlideSceneSVG function not found. Ensure rendering export engine is loaded.");
    }
}

function triggerImportPptx() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pptx";
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        if (typeof importPptx === "function") {
            importPptx(file);
        } else {
            alert("PPTX Importer not loaded!");
        }
    };
    input.click();
}
