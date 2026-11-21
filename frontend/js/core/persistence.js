// Saving the open project to the server, and keeping its unsaved edits safe: the autosave queue, save conflicts
// between windows, the per-project backup recovered on the next load, and the last save when the page closes.
// Split from state.js (which it follows in index.html): it shares that file's globals, as classic scripts do.

// One save at a time. A second PATCH sent while one was in flight carried the same autosave version, so the server
// refused it (409): the newer edits stayed unsaved and the user was told to reload, which would have lost them.
// Each call now waits for the one before; it then saves only what is still unsaved.
let _autosaveChain = Promise.resolve();
// keepMine: an explicit save (Save button, Ctrl+S) after a conflict, which replaces the other window's version.
function autosavePresentationNow({ keepMine = false } = {}) {
    const run = _autosaveChain.catch(() => {}).then(() => _autosavePresentationOnce({ keepMine }));
    _autosaveChain = run;
    return run;
}

// The deck was saved from another tab or window since this one loaded it: { id, serverVersion }. Autosave stops for
// it here. It used to take the server's version number and save again, so the next edit here silently replaced the
// other window's work while both said "All changes saved". Reloading takes that version; Ctrl+S keeps this one.
let _saveConflict = null;
// The project whose next save replaces a deck saved from elsewhere (set by Ctrl+S after a conflict, and by restoring
// refused edits); cleared when that save lands.
let _keepReplacedOnSave = null;
const SAVE_CONFLICT_MESSAGE = "Changed in another window. Reload to get that version, or press Ctrl+S to keep yours.";

async function _autosavePresentationOnce({ keepMine = false } = {}) {
    if (
        !_presentationPersistenceEnabled ||
        !_presentationPersistenceReady ||
        !currentPresentationId ||
        isPresentationHydrating()
    ) {
        return false;
    }
    // A save belongs to the project it started for; if the user opens another project meanwhile, drop it.
    const presentationId = currentPresentationId;
    const stillCurrent = () => currentPresentationId === presentationId && !isPresentationHydrating();
    if (typeof syncMoleculeViewStatesFromDom === "function") {
        await syncMoleculeViewStatesFromDom();
    }
    if (!stillCurrent()) return false;
    if (_saveConflict?.id === presentationId) {
        if (!keepMine) {
            setProjectSaveHint(SAVE_CONFLICT_MESSAGE, "danger");
            return false;
        }
        currentPresentationAutosaveVersion = _saveConflict.serverVersion || currentPresentationAutosaveVersion;
        _saveConflict = null;
        _lastPersistedFingerprint = ""; // the server has the other version: this one is unsaved whatever it matches
        _keepReplacedOnSave = presentationId;
    }
    // One snapshot for the check, the request and the backup (each used to build its own).
    const persistable = getPersistableState();
    const fingerprint = JSON.stringify(persistable);
    const title = _inferPresentationTitle();
    if (fingerprint === _lastPersistedFingerprint && title === _lastPersistedTitle) {
        setProjectSaveHint("All changes saved", "success");
        return false;
    }

    const payload = {
        title,
        presentationTheme: state.presentationTheme,
        state: persistable,
        autosaveVersion: currentPresentationAutosaveVersion,
    };
    // This save replaces a deck saved from elsewhere: the server keeps that one as a revision (studio/views.py).
    const keepsReplaced = _keepReplacedOnSave === presentationId;
    if (keepsReplaced) payload.keepReplaced = true;
    let saved;
    const fingerprintHash = _stateHash(fingerprint);
    _pendingSaveHashes.add(fingerprintHash);
    keepUnsavedBackup(payload.state);
    try {
        saved = await _presentationRequest(`/api/presentations/${presentationId}/`, {
            method: "PATCH",
            body: JSON.stringify(payload),
        });
    } catch (err) {
        _pendingSaveHashes.delete(fingerprintHash);
        if (!stillCurrent()) return false;
        if (err?.status === 409) {
            _saveConflict = { id: presentationId, serverVersion: err.payload?.autosaveVersion || 0 };
            setProjectSaveHint(SAVE_CONFLICT_MESSAGE, "danger");
            return false; // said; not a failure for the callers to report again as "Save failed"
        }
        throw err;
    }
    _pendingSaveHashes.delete(fingerprintHash);
    if (keepsReplaced && _keepReplacedOnSave === presentationId) _keepReplacedOnSave = null;
    if (!stillCurrent()) return false;
    currentPresentationAutosaveVersion = saved.autosaveVersion || currentPresentationAutosaveVersion;
    setCurrentPresentationTitle(payload.title);
    _lastPersistedFingerprint = fingerprint;
    _lastPersistedTitle = payload.title;
    const current = _persistedStateIsCurrent();
    if (current) _clearUnsavedBackup(presentationId);
    else keepUnsavedBackup();
    setProjectSaveHint(current ? "All changes saved" : "Unsaved changes", current ? "success" : "warn");
    window.dispatchEvent(new CustomEvent("slideforge:presentation-saved", { detail: { id: presentationId } }));
    return true;
}

// Hashes of the snapshots of saves still in flight. A hash, not the snapshot: the backup would hold the deck twice.
const _pendingSaveHashes = new Set();

// Two 32-bit FNV-1a hashes in one pass: enough to recognise a saved snapshot again, far smaller than the snapshot.
function _stateHash(text) {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 16777619);
        b = Math.imul(b ^ c, 2246822519);
    }
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

// Where this session's recovery data belongs: the open server project, the local project, or nothing yet.
function _unsavedBackupScope() {
    if (isPresentationHydrating()) return null;
    if (!_backendApiAvailable || !_presentationPersistenceEnabled) return "local";
    return _presentationPersistenceReady && currentPresentationId ? currentPresentationId : null;
}

let _unsavedBackupDb = null;

// The IndexedDB database for backups too big for localStorage; resolves to null where IndexedDB cannot be used.
function _openUnsavedBackupDb() {
    if (!_unsavedBackupDb) {
        _unsavedBackupDb = new Promise(resolve => {
            try {
                const request = indexedDB.open(UNSAVED_BACKUP_DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(UNSAVED_BACKUP_DB_STORE);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
            } catch (_err) {
                resolve(null);
            }
        });
    }
    return _unsavedBackupDb;
}

// Runs `work(store)` in one transaction; resolves to the result of the request it returns (or null) when it commits.
// Transactions on the store run in the order they were started, so a later write or delete always wins.
async function _unsavedBackupDbRun(mode, work) {
    const db = await _openUnsavedBackupDb();
    if (!db) return null;
    return new Promise(resolve => {
        try {
            const transaction = db.transaction(UNSAVED_BACKUP_DB_STORE, mode);
            const request = work(transaction.objectStore(UNSAVED_BACKUP_DB_STORE));
            transaction.oncomplete = () => resolve(request ? request.result ?? null : null);
            transaction.onerror = transaction.onabort = () => resolve(null);
        } catch (_err) {
            resolve(null);
        }
    });
}

// Each project has its own backup. There was one slot for all of them, so with two projects open in two tabs
// (localStorage is shared) each backup replaced the other's.
function _unsavedBackupKey(presentationId) {
    return `${UNSAVED_BACKUP_STORAGE_KEY}:${presentationId}`;
}

// The backup kept for a project, from localStorage or else IndexedDB; null when there is none or it cannot be
// read. The single slot of earlier versions (UNSAVED_BACKUP_STORAGE_KEY itself) is read too, when it is this project's.
async function _readUnsavedBackup(presentationId) {
    for (const key of [_unsavedBackupKey(presentationId), UNSAVED_BACKUP_STORAGE_KEY]) {
        try {
            const kept = JSON.parse(localStorage.getItem(key) || "null");
            if (kept?.presentationId === presentationId) return kept;
        } catch (_err) {
            localStorage.removeItem(key);
        }
        const stored = await _unsavedBackupDbRun("readonly", store => store.get(key));
        if (stored?.presentationId === presentationId) return stored;
    }
    return null;
}

function _removeUnsavedBackup(presentationId) {
    const key = _unsavedBackupKey(presentationId);
    localStorage.removeItem(key);
    try {
        if (JSON.parse(localStorage.getItem(UNSAVED_BACKUP_STORAGE_KEY) || "null")?.presentationId === presentationId) {
            localStorage.removeItem(UNSAVED_BACKUP_STORAGE_KEY);
        }
    } catch (_err) {
        localStorage.removeItem(UNSAVED_BACKUP_STORAGE_KEY);
    }
    _unsavedBackupDbRun("readwrite", store => {
        store.delete(key);
        const old = store.get(UNSAVED_BACKUP_STORAGE_KEY);
        old.onsuccess = () => {
            if (old.result?.presentationId === presentationId) store.delete(UNSAVED_BACKUP_STORAGE_KEY);
        };
        return null;
    });
}

function _writeUnsavedBackup(snapshot) {
    const backup = {
        ...snapshot,
        presentationId: currentPresentationId,
        pendingFingerprints: [..._pendingSaveHashes],
        savedAt: new Date().toISOString(),
    };
    const key = _unsavedBackupKey(currentPresentationId);
    try {
        localStorage.setItem(key, JSON.stringify(backup));
        // The snapshot holds that typing now; and a copy left in IndexedDB is older than this one.
        localStorage.removeItem(UNSAVED_TYPING_STORAGE_KEY);
        _unsavedBackupDbRun("readwrite", store => store.delete(key));
        return;
    } catch (_err) {
        // Too big (or storage refused): the copy left there is older than this one, so it must not be recovered.
        try { localStorage.removeItem(key); } catch (_removeErr) { /* nothing kept */ }
    }
    let typingAtSnapshot = null;
    try { typingAtSnapshot = localStorage.getItem(UNSAVED_TYPING_STORAGE_KEY); } catch (_err) { /* none */ }
    _unsavedBackupDbRun("readwrite", store => store.put(backup, key)).then(() => {
        // Once the snapshot is stored it holds that typing; typing done since is newer, and stays.
        try {
            if (typingAtSnapshot !== null && localStorage.getItem(UNSAVED_TYPING_STORAGE_KEY) === typingAtSnapshot) {
                localStorage.removeItem(UNSAVED_TYPING_STORAGE_KEY);
            }
        } catch (_err) { /* kept */ }
    });
}

let _unsavedBackupTimer = null;

function keepUnsavedBackup(snapshotState = null) {
    clearTimeout(_unsavedBackupTimer);
    _unsavedBackupTimer = null;
    const scope = _unsavedBackupScope();
    if (scope === "local") {
        saveLocalPresentationNow();
        return;
    }
    if (!scope) return;
    _writeUnsavedBackup({ autosaveVersion: currentPresentationAutosaveVersion, state: snapshotState || getPersistableState() });
}

// A full snapshot costs a serialisation of the whole deck (pictures included), so take at most one a second.
// Typing between snapshots is kept by keepTypingBackup, which only writes the box being typed in.
function _scheduleUnsavedBackup() {
    if (_unsavedBackupTimer) return;
    _unsavedBackupTimer = setTimeout(() => keepUnsavedBackup(), 1000);
}

// Called on every keystroke: closing a browser page need not dispatch pagehide, so the last characters typed are
// stored right away, as the text of their box only.
function keepTypingBackup(elementId, fields) {
    const scope = _unsavedBackupScope();
    if (!scope || !elementId) return;
    try {
        const kept = JSON.parse(localStorage.getItem(UNSAVED_TYPING_STORAGE_KEY) || "null");
        const typing = kept?.scope === scope ? kept : { scope, elements: {} };
        typing.autosaveVersion = currentPresentationAutosaveVersion;
        typing.pendingFingerprints = [..._pendingSaveHashes];
        typing.elements[elementId] = { content: fields.content, textDocument: fields.textDocument };
        localStorage.setItem(UNSAVED_TYPING_STORAGE_KEY, JSON.stringify(typing));
    } catch (err) {
        console.warn("Could not keep a backup of the text being typed:", err);
    }
}

// Puts kept typing back into `state` when `usable(typing)` says its base is the deck just loaded.
function _takeTypingBackup(scope, usable) {
    let typing = null;
    try {
        typing = JSON.parse(localStorage.getItem(UNSAVED_TYPING_STORAGE_KEY) || "null");
    } catch (_err) {
        typing = null;
    }
    if (!typing || typing.scope !== scope) return 0;
    localStorage.removeItem(UNSAVED_TYPING_STORAGE_KEY);
    if (!usable(typing)) {
        // Refused like a backup (_takeUnsavedBackup), and offered with it when it differs from the deck loaded.
        const differs = (state.slides || []).some(slide => (slide.elements || []).some(el =>
            typing.elements?.[el.id] && typing.elements[el.id].content !== el.content));
        if (differs) _refusedRecovery = { ...(_refusedRecovery?.presentationId === scope ? _refusedRecovery : { presentationId: scope }), typing };
        return 0;
    }
    return _applyTypingBackup(typing);
}

function _applyTypingBackup(typing) {
    let applied = 0;
    (state.slides || []).forEach(slide => (slide.elements || []).forEach(el => {
        const fields = typing.elements?.[el.id];
        if (!fields) return;
        Object.assign(el, fields);
        applied++;
    }));
    return applied;
}

function _clearTypingBackup(scope) {
    try {
        const typing = JSON.parse(localStorage.getItem(UNSAVED_TYPING_STORAGE_KEY) || "null");
        if (typing?.scope === scope) localStorage.removeItem(UNSAVED_TYPING_STORAGE_KEY);
    } catch (_err) {
        localStorage.removeItem(UNSAVED_TYPING_STORAGE_KEY);
    }
}

function schedulePresentationAutosave(delay = 1200) {
    _scheduleUnsavedBackup();
    if (!_backendApiAvailable || !_presentationPersistenceEnabled) {
        setProjectSaveHint("Unsaved local changes", "warn");
        clearTimeout(_autosaveTimer);
        _autosaveTimer = setTimeout(() => saveLocalPresentationNow(), Math.min(delay, 300));
        return;
    }
    if (!_presentationPersistenceEnabled || !_presentationPersistenceReady || isPresentationHydrating()) {
        return;
    }
    setProjectSaveHint("Unsaved changes", "warn");
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
        // Renders schedule saves too; while the start screen is open with nothing chosen there is nothing to save.
        if (!currentPresentationId && window.isStartScreenOpen?.()) return;
        _ensurePresentationRecord()
            .then(created => (created ? true : autosavePresentationNow()))
            .catch(err => {
                console.warn("Autosave failed:", err);
                // A conflict has said so already, with what to do (_autosavePresentationOnce).
                if (err?.status !== 409) setProjectSaveHint("Save failed", "danger");
            });
    }, delay);
}

// `backup` is the one _readUnsavedBackup found; it is taken (removed) when it belongs to this deck.
function _takeUnsavedBackup(backup, presentationId, serverVersion, serverState = null) {
    if (!backup || backup.presentationId !== presentationId) return null;
    _removeUnsavedBackup(presentationId);
    // Same version as when the backup was taken: the server never received those edits.
    const sameVersion = backup.autosaveVersion === serverVersion;
    // A save already in flight can land after the page closes. Recover only if the server has that exact snapshot.
    const pendingSaveLanded = _pendingSaveLanded(backup, serverVersion, serverState);
    const hasSlides = Array.isArray(backup.state?.slides) && backup.state.slides.length;
    if ((sameVersion || pendingSaveLanded) && hasSlides) return backup;
    // Refused: the project was saved from elsewhere since. It used to be dropped here while the hint said "All
    // changes saved"; it is kept for this session and offered (_offerRefusedRecovery). Not when the server has
    // exactly these edits (the last save made while the page closed landed): nothing was lost then.
    if (hasSlides && JSON.stringify(backup.state) !== JSON.stringify(serverState)) {
        _refusedRecovery = { presentationId, state: backup.state };
    }
    return null;
}

// Unsaved edits that were not applied when their project opened: { presentationId, state?, typing? }.
let _refusedRecovery = null;

function _offerRefusedRecovery() {
    if (!_refusedRecovery || _refusedRecovery.presentationId !== currentPresentationId) return;
    if (typeof showNotification !== "function") return;
    showNotification("This project was changed elsewhere after your last unsaved edits here, so they were not applied.", "info", {
        action: { label: "Restore my edits", run: restoreRefusedChanges },
        sticky: true,
    });
}

// Puts the refused edits back and saves them over the server's deck, which the server keeps as a revision.
function restoreRefusedChanges() {
    const refused = _refusedRecovery;
    if (!refused || refused.presentationId !== currentPresentationId || isPresentationHydrating()) return false;
    _refusedRecovery = null;
    if (typeof saveStateToUndo === "function") saveStateToUndo(); // Ctrl+Z goes back to the server's deck
    if (refused.state) state = refused.state;
    if (refused.typing) _applyTypingBackup(refused.typing);
    normalizeStateIds();
    syncPresentationThemeFromState?.({ persist: false });
    syncPresentationPageSetup?.();
    currentSlideIndex = Math.max(0, Math.min(currentSlideIndex, state.slides.length - 1));
    _keepReplacedOnSave = currentPresentationId;
    _lastPersistedFingerprint = "";
    clearSelection?.();
    renderSlidesFromState?.();
    buildPropertiesPanel?.({ immediate: true });
    updateSlideCounter?.();
    schedulePresentationAutosave(300);
    return true;
}

function _pendingSaveLanded(backup, serverVersion, serverState) {
    return serverVersion === backup.autosaveVersion + 1 &&
        Boolean(backup.pendingFingerprints?.includes(_stateHash(JSON.stringify(serverState))));
}

function _clearUnsavedBackup(presentationId) {
    _removeUnsavedBackup(presentationId);
    _clearTypingBackup(presentationId);
}

function _saveRecoveredChanges() {
    if (!_pendingRecoverySave) return;
    _pendingRecoverySave = false;
    schedulePresentationAutosave(300);
}

// Autosave is debounced, so closing the page right after an edit would lose it. Keep a local backup (recovered on
// the next load if the server never got it) and try one last save that survives the page closing.
function flushUnsavedChangesOnExit() {
    if (isPresentationHydrating()) return;
    if (!_backendApiAvailable || !_presentationPersistenceEnabled) {
        saveLocalPresentationNow();
        return;
    }
    if (!_presentationPersistenceReady || !currentPresentationId) return;
    if (_persistedStateIsCurrent()) return;
    clearTimeout(_autosaveTimer);
    const payload = {
        title: _inferPresentationTitle(),
        presentationTheme: state.presentationTheme,
        state: getPersistableState(),
        autosaveVersion: currentPresentationAutosaveVersion,
    };
    _writeUnsavedBackup(payload);
    // keepalive requests are limited to 64 KB; larger decks rely on the backup above.
    _apiFetch(`/api/presentations/${currentPresentationId}/`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        keepalive: true,
    }).catch(() => {});
}

window.addEventListener("pagehide", flushUnsavedChangesOnExit);

// The desktop window calls this when it is closed, and waits for it (app.py, _save_before_close): the text box being
// edited hands its words to the deck, then the deck is saved to the server. Closed at once, the last words typed
// could be lost: the typing backup lives in localStorage, which the window writes to disk only after a while.
async function sfFlushBeforeClose() {
    // Shown at once: the window stays open until the save ends, and without it the close looked ignored.
    const busy = window.sfBusyStart?.({ title: "Saving before closing…", detail: "The window closes when your work is saved.", delay: 0 });
    try {
        if (typeof commitActiveTextEditors === "function") commitActiveTextEditors();
        const active = document.activeElement;
        if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) active.blur();
        await new Promise(resolve => setTimeout(resolve, 30));
        if (isPresentationHydrating()) return true;
        if (!_backendApiAvailable || !_presentationPersistenceEnabled) {
            saveLocalPresentationNow();
            return true;
        }
        // A deck being created by its first edit is waited for; nothing is created for a window closed unused.
        if (_creatingPresentationRecord) await _creatingPresentationRecord.catch(() => {});
        if (currentPresentationId) await autosavePresentationNow();
    } catch (err) {
        console.warn("Saving before the window closes failed:", err);
    } finally {
        busy?.done();
    }
    return true;
}
window.sfFlushBeforeClose = sfFlushBeforeClose;
