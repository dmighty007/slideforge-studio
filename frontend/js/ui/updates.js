// Updating the desktop app to a new version (backend/slideforge/desktop/updates.py). A few seconds after the window
// opens, at most once a day, the app looks for a newer version; when there is one, a card offers to install it while
// you keep working, and to restart into it. "Check for updates…" in the command palette asks at any time.
// The web app has no such endpoint: nothing shows there.

const SF_UPDATE_URL = "/api/desktop/update/";
let _sfUpdatePoll = null;
let _sfUpdateDismissed = false;

function _sfUpdateRequest(body) {
    const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    return fetch(SF_UPDATE_URL + (body ? "" : "?auto=1"), {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) } : {},
        body: body ? JSON.stringify(body) : undefined,
    }).then(response => (response.ok || response.status === 409 ? response.json() : Promise.reject(new Error(String(response.status)))));
}

function _sfUpdateCard() {
    let card = document.getElementById("sf-update-card");
    if (!card) {
        card = document.createElement("div");
        card.id = "sf-update-card";
        card.className = "sf-update";
        card.setAttribute("role", "status");
        card.setAttribute("aria-live", "polite");
        document.body.appendChild(card);
    }
    return card;
}

function _sfUpdateHide() {
    document.getElementById("sf-update-card")?.remove();
}

function _sfEscape(text) {
    return String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// The card for a status from the server. manual: asked for ("Check for updates…"), so "up to date" and errors show.
function _sfUpdateShow(status, { manual = false } = {}) {
    if (!status) return;
    const buttons = [];
    let icon = "fa-circle-arrow-up";
    let title = "";
    let text = "";
    let details = "";
    if (status.state === "updating") {
        icon = "fa-spinner fa-spin";
        title = `Updating to SlideForge ${_sfEscape(status.latest)}…`;
        text = "This takes a minute or two. You can keep working.";
        const last = (status.output || []).filter(Boolean).slice(-1)[0];
        if (last) details = `<div class="sf-update__log">${_sfEscape(last)}</div>`;
    } else if (status.state === "updated") {
        icon = "fa-circle-check";
        title = `SlideForge ${_sfEscape(status.installedVersion || status.latest)} is installed`;
        text = "Restart to start using it. Your work is saved first.";
        buttons.push('<button type="button" class="sf-update__btn sf-update__btn--primary" data-update="restart">Restart now</button>');
        buttons.push('<button type="button" class="sf-update__btn" data-update="later">Later</button>');
    } else if (status.state === "failed") {
        icon = "fa-triangle-exclamation";
        title = "The update did not finish";
        text = "SlideForge is unchanged. You can try again, or run the installer.";
        details = `<details class="sf-update__details"><summary>Details</summary><pre>${_sfEscape((status.output || []).join("\n"))}</pre></details>`;
        buttons.push('<button type="button" class="sf-update__btn sf-update__btn--primary" data-update="install">Try again</button>');
        buttons.push('<button type="button" class="sf-update__btn" data-update="later">Close</button>');
    } else if (status.available && (manual || !status.skipped)) {
        title = `SlideForge ${_sfEscape(status.latest)} is available`;
        text = `You have ${_sfEscape(status.current)}.`;
        if (status.canUpdate) {
            buttons.push('<button type="button" class="sf-update__btn sf-update__btn--primary" data-update="install">Update</button>');
        } else if (status.manualHint) {
            text += ` ${_sfEscape(status.manualHint)}`;
        }
        buttons.push('<button type="button" class="sf-update__btn" data-update="later">Later</button>');
        if (!manual) buttons.push(`<button type="button" class="sf-update__btn sf-update__btn--quiet" data-update="skip" data-version="${_sfEscape(status.latest)}">Skip this version</button>`);
    } else if (manual) {
        icon = status.checkError ? "fa-wifi" : "fa-circle-check";
        title = status.checkError ? "Could not check for updates" : "SlideForge is up to date";
        text = status.checkError ? _sfEscape(status.checkError) : `You have the latest version, ${_sfEscape(status.current)}.`;
        buttons.push('<button type="button" class="sf-update__btn" data-update="later">Close</button>');
    } else {
        return;
    }
    const auto = manual && status.state !== "updating"
        ? `<label class="sf-update__auto"><input type="checkbox" data-update="auto" ${status.autoCheck ? "checked" : ""}> Check for updates automatically</label>`
        : "";
    const card = _sfUpdateCard();
    card.innerHTML = `
        <i class="fa-solid ${icon} sf-update__icon" aria-hidden="true"></i>
        <div class="sf-update__body">
            <div class="sf-update__title">${title}</div>
            <div class="sf-update__text">${text}</div>
            ${details}
            ${buttons.length ? `<div class="sf-update__actions">${buttons.join("")}</div>` : ""}
            ${auto}
        </div>`;
    card.onclick = event => _sfUpdateAction(event, status);
    card.onchange = event => {
        if (event.target?.dataset?.update === "auto") _sfUpdateRequest({ action: "autoCheck", enabled: event.target.checked }).catch(() => {});
    };
}

async function _sfUpdateAction(event, status) {
    const button = event.target.closest?.("[data-update]");
    const action = button?.dataset.update;
    if (!action || action === "auto") return;
    if (action === "later") {
        _sfUpdateDismissed = status.state !== "updating" && status.state !== "updated";
        _sfUpdateHide();
        return;
    }
    if (action === "skip") {
        _sfUpdateHide();
        _sfUpdateRequest({ action: "skip", version: button.dataset.version }).catch(() => {});
        return;
    }
    if (action === "install") {
        _sfUpdateShow({ ...status, state: "updating", output: [] });
        try {
            _sfUpdateShow(await _sfUpdateRequest({ action: "install" }));
        } catch (_error) {
            _sfUpdateShow({ ...status, state: "failed", output: ["The update could not start."] });
            return;
        }
        _sfUpdateWatch();
        return;
    }
    if (action === "restart") {
        button.disabled = true;
        // Saved first, as when the window is closed; then the server starts the new version and closes this one.
        try {
            if (typeof window.sfFlushBeforeClose === "function") await window.sfFlushBeforeClose();
        } catch (_error) {}
        window.sfBusyStart?.({ title: "Restarting SlideForge…", detail: "The new version opens in a moment.", delay: 0 });
        _sfUpdateRequest({ action: "restart" }).catch(() => {});
    }
}

// While the update installs: the card follows its progress.
function _sfUpdateWatch() {
    clearInterval(_sfUpdatePoll);
    _sfUpdatePoll = setInterval(async () => {
        try {
            const status = await fetch(SF_UPDATE_URL).then(response => response.json());
            if (status.state !== "updating") clearInterval(_sfUpdatePoll);
            if (!_sfUpdateDismissed || status.state === "updated" || status.state === "failed") _sfUpdateShow(status);
        } catch (_error) {
            clearInterval(_sfUpdatePoll);
        }
    }, 2000);
}

// "Check for updates…": asks now and always answers (up to date, available, or could not check).
async function checkForUpdates() {
    if (!document.body.classList.contains("accounts-disabled")) {
        setProjectSaveHint?.("Updates are for the desktop app; the web app is updated on its server", "muted");
        return;
    }
    _sfUpdateDismissed = false;
    const card = _sfUpdateCard();
    card.innerHTML = '<i class="fa-solid fa-spinner fa-spin sf-update__icon" aria-hidden="true"></i><div class="sf-update__body"><div class="sf-update__title">Checking for updates…</div></div>';
    try {
        const status = await _sfUpdateRequest({ action: "check" });
        _sfUpdateShow(status, { manual: true });
        if (status.state === "updating") _sfUpdateWatch();
    } catch (_error) {
        _sfUpdateShow({ checkError: "Could not check for updates.", current: "", autoCheck: true }, { manual: true });
    }
}

// The automatic check, a few seconds after the window opens (desktop app only).
function _sfUpdateAutoCheck() {
    if (!document.body.classList.contains("accounts-disabled")) return;
    setTimeout(async () => {
        try {
            const status = await _sfUpdateRequest(null);
            if (status.state === "updating") _sfUpdateWatch();
            _sfUpdateShow(status);
        } catch (_error) {}
    }, 6000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _sfUpdateAutoCheck);
else _sfUpdateAutoCheck();

window.checkForUpdates = checkForUpdates;
