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
        if (el?.type !== "video" || typeof el.content !== "string" || !/^\/media\/assets\//.test(el.content)) continue;
        try {
            const response = await fetch(el.content);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            el.content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob.type.startsWith("video/") ? blob : blob.slice(0, blob.size, el.localMimeType || "video/mp4"));
            });
            delete el.videoWebm; // a copy on this computer only; the importing app makes its own
        } catch (error) {
            console.warn("Video kept as a link in the JSON export:", el.content, error);
        }
    }
}

function exportPresentationJson() {
    exportJSON();
}

// Imports never go into the project that happens to be open: its slides were replaced and then autosaved. The
// open project is saved, and the import gets a project of its own.
async function startNewProjectForImport() {
    try {
        if (typeof currentPresentationId !== "undefined" && currentPresentationId) await autosavePresentationNow();
    } catch (err) {
        console.warn("Could not save the open project before importing:", err);
    }
    const created = await createNewProject();
    if (created === false) throw new Error("sign in to import a presentation");
}

// The name for an imported deck: its own, or with "(imported)" when a saved deck already has that name, so the
// two can be told apart in Recent.
async function uniqueImportTitle(title) {
    const base = String(title || "").trim() || "Imported Presentation";
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

function importPresentationJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async event => {
            try {
                const imported = JSON.parse(event.target.result);
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
                const title = await uniqueImportTitle(imported.title || file.name.replace(/\.json$/i, ""));
                await startNewProjectForImport();
                state = importedState;
                normalizeStateIds();
                currentSlideIndex = 0;
                if (typeof setCurrentPresentationTitle === "function") setCurrentPresentationTitle(title);
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
        };
        reader.readAsText(file);
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
