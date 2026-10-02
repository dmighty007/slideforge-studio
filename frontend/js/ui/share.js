// "Share": a read-only viewing link for the open presentation, like a Google Slides link. The editor uploads the
// standalone viewer (the same one as the Web ZIP export) to /api/presentations/<id>/share/; the server keeps the
// latest version at /s/<token>/. After each save the shared copy is updated. In the desktop app a Cloudflare quick
// tunnel makes the link reachable from anywhere while SlideForge runs (backend: slideforge/desktop/share_tunnel.py).

(function () {
    const REPUBLISH_DELAY = 4000;
    const shareStatus = new Map(); // presentation id -> last known status from the server
    let tunnel = null; // desktop only
    let pollTimer = null;
    let republishTimer = null;
    let publishing = null;
    let republishAgain = false;
    let busy = false;
    let message = null; // { text, tone }

    const isDesktop = () => typeof accountsDisabled === "function" && accountsDisabled();
    const presentationId = () => (typeof currentPresentationId !== "undefined" ? currentPresentationId : null);
    const escapeHtml = (text) =>
        String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

    async function api(path, options = {}) {
        const response = await _apiFetch(path, options);
        let payload = {};
        try {
            payload = await response.json();
        } catch (_err) {}
        if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
        return payload;
    }

    const shareUrl = (id) => `/api/presentations/${id}/share/`;

    async function refreshShare(id) {
        const status = await api(shareUrl(id));
        shareStatus.set(id, status);
        return status;
    }

    async function refreshTunnel() {
        if (!isDesktop()) return null;
        tunnel = await api("/api/share/tunnel/");
        return tunnel;
    }

    async function tunnelAction(action) {
        tunnel = await api("/api/share/tunnel/", { method: "POST", body: JSON.stringify({ action }) });
        return tunnel;
    }

    // Uploads the current version of the deck; creates the link the first time.
    async function publish(id) {
        if (publishing) {
            republishAgain = true;
            return publishing;
        }
        publishing = (async () => {
            const bundle = await buildViewerBundle({ includeVendor: false });
            const form = new FormData();
            form.append("bundle", bundle, "viewer.zip");
            const status = await api(shareUrl(id), { method: "POST", body: form });
            shareStatus.set(id, status);
            return status;
        })();
        try {
            return await publishing;
        } finally {
            publishing = null;
            if (republishAgain) {
                republishAgain = false;
                scheduleRepublish(id, 500);
            }
        }
    }

    function scheduleRepublish(id, delay = REPUBLISH_DELAY) {
        clearTimeout(republishTimer);
        republishTimer = setTimeout(() => {
            if (presentationId() !== id || !shareStatus.get(id)?.active) return;
            publish(id)
                .then(render)
                .catch((err) => console.warn("Updating the shared presentation failed:", err));
        }, delay);
    }

    window.addEventListener("slideforge:presentation-saved", async (event) => {
        const id = event.detail?.id;
        if (!id) return;
        try {
            const status = shareStatus.has(id) ? shareStatus.get(id) : await refreshShare(id);
            if (status?.active) scheduleRepublish(id);
        } catch (_err) {}
    });

    // --- dialog -------------------------------------------------------------------------------------------------
    function modal() {
        let el = document.getElementById("share-modal");
        if (el) return el;
        el = document.createElement("div");
        el.id = "share-modal";
        el.className = "share-modal hidden";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-labelledby", "share-modal-title");
        el.innerHTML = `<div class="share-card"><div id="share-modal-body"></div></div>`;
        el.addEventListener("mousedown", (event) => {
            if (event.target === el) closeShareDialog();
        });
        // Escape closes it wherever focus is, as with the other dialogs (it only worked with focus inside).
        document.addEventListener(
            "keydown",
            (event) => {
                if (event.key !== "Escape" || el.classList.contains("hidden")) return;
                event.stopPropagation();
                event.preventDefault();
                closeShareDialog();
            },
            true,
        );
        el.addEventListener("click", onClick);
        document.body.appendChild(el);
        return el;
    }

    // The web app's own address; in the desktop app the tunnel's while it runs, otherwise this computer's.
    function publicBase() {
        if (!isDesktop()) return location.origin;
        return tunnel?.url || location.origin;
    }

    function timeAgo(iso) {
        if (!iso) return "";
        const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
        if (seconds < 45) return "just now";
        if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
        return new Date(iso).toLocaleString();
    }

    function tunnelSection(status) {
        if (!isDesktop() || !status?.active) return "";
        if (tunnel?.url) {
            return `<p class="share-note"><i class="fa-solid fa-globe"></i> Reachable from anywhere while SlideForge is open.
                The address changes when SlideForge restarts; reopen Share for the new one.</p>`;
        }
        let state;
        if (tunnel?.installing) {
            state = `<p class="share-progress"><span class="share-spinner"></span> Downloading cloudflared…</p>`;
        } else if (tunnel?.running) {
            state = `<p class="share-progress"><span class="share-spinner"></span> Connecting to the internet…</p>`;
        } else if (tunnel?.available) {
            state = `${tunnel.error ? `<p class="share-error">${escapeHtml(tunnel.error)}</p>` : ""}
                <button type="button" class="share-btn share-btn-primary" data-share="tunnel-start"><i class="fa-solid fa-globe"></i> Make it reachable from anywhere</button>
                <p class="share-hint">This gives the link a public internet address through a free Cloudflare tunnel, for as long as SlideForge is open. Anyone with the link can then watch the slides.</p>`;
        } else {
            state = `<p class="share-text">To open the link on other devices, SlideForge uses a free Cloudflare tunnel
                (<code>cloudflared</code>, no account needed).</p>
                ${tunnel?.error ? `<p class="share-error">${escapeHtml(tunnel.error)}</p>` : ""}
                <div class="share-row">
                    ${tunnel?.installable ? `<button type="button" class="share-btn share-btn-primary" data-share="tunnel-install"><i class="fa-solid fa-download"></i> Download cloudflared</button>` : ""}
                </div>
                <p class="share-hint">Or install it yourself (for example <code>sudo pacman -S cloudflared</code>,
                <code>brew install cloudflared</code> or <code>winget install Cloudflare.cloudflared</code>) and reopen Share.</p>`;
        }
        return `<div class="share-section">
            <p class="share-warn"><i class="fa-solid fa-laptop"></i> This link opens on this computer only.</p>
            ${state}
        </div>`;
    }

    function render() {
        const el = document.getElementById("share-modal");
        if (!el || el.classList.contains("hidden")) return;
        const id = presentationId();
        const status = id ? shareStatus.get(id) : null;
        const base = publicBase();
        const link = status?.active ? `${base}${status.path}` : "";
        const title = document.getElementById("project-title-input")?.value.trim() || "this presentation";
        let content;
        if (!id) {
            content = `<p class="share-text">Save the presentation first${isDesktop() ? "" : " (sign in to save it on the server)"}, then share it.</p>`;
        } else if (!status) {
            content = `<p class="share-progress"><span class="share-spinner"></span> Loading…</p>`;
        } else if (!status.active) {
            content = `<p class="share-text">Anyone with the link can watch the slides. They cannot edit them or see
                your other presentations. The shared copy updates each time your changes are saved.</p>
                <div class="share-row">
                    <button type="button" class="share-btn share-btn-primary" data-share="create" ${busy ? "disabled" : ""}>
                        ${busy ? '<span class="share-spinner"></span> Creating link…' : '<i class="fa-solid fa-link"></i> Create link'}
                    </button>
                </div>`;
        } else {
            content = `
                ${
                    link
                        ? `<div class="share-link-row">
                        <input id="share-link-input" class="share-link-input" type="text" readonly value="${escapeHtml(link)}" aria-label="Viewing link">
                        <button type="button" class="share-btn share-btn-primary" data-share="copy"><i class="fa-regular fa-copy"></i> Copy</button>
                        <button type="button" class="share-btn" data-share="open" title="Open the link"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                    </div>`
                        : ""
                }
                <p class="share-hint">View only. ${publishing || busy ? '<span class="share-spinner"></span> Updating…' : `Updated ${escapeHtml(timeAgo(status.publishedAt))}; it follows your saved changes.`}</p>
                ${tunnelSection(status)}
                <div class="share-row share-row-end">
                    <button type="button" class="share-btn share-btn-danger" data-share="stop" ${busy ? "disabled" : ""}><i class="fa-solid fa-link-slash"></i> Stop sharing</button>
                </div>`;
        }
        el.querySelector("#share-modal-body").innerHTML = `
            <div class="share-head">
                <div>
                    <div id="share-modal-title" class="share-title">Share “${escapeHtml(title)}”</div>
                    <div class="share-subtitle">A view-only link to the presentation</div>
                </div>
                <button type="button" class="share-close" data-share="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            ${message ? `<p class="share-${message.tone}">${escapeHtml(message.text)}</p>` : ""}
            ${content}`;
        // Redrawing removed the focused button, so focus fell back to the page and keys went to the editor.
        if (!el.contains(document.activeElement)) el.querySelector(".share-close")?.focus({ preventScroll: true });
        schedulePoll();
    }

    // While the tunnel downloads or connects, check on it every second.
    function schedulePoll() {
        clearTimeout(pollTimer);
        const open = !document.getElementById("share-modal")?.classList.contains("hidden");
        if (!open || !isDesktop() || !tunnel) return;
        if (!(tunnel.installing || (tunnel.running && !tunnel.url))) return;
        pollTimer = setTimeout(async () => {
            try {
                await refreshTunnel();
            } catch (_err) {}
            render();
        }, 1000);
    }

    async function run(task) {
        busy = true;
        message = null;
        render();
        try {
            await task();
        } catch (err) {
            message = { text: err.message || String(err), tone: "error" };
        } finally {
            busy = false;
            render();
        }
    }

    async function copyLink() {
        const input = document.getElementById("share-link-input");
        if (!input) return;
        try {
            await navigator.clipboard.writeText(input.value);
        } catch (_err) {
            input.select();
            document.execCommand("copy");
        }
        message = { text: "Link copied", tone: "success" };
        render();
    }

    function onClick(event) {
        const action = event.target.closest("[data-share]")?.dataset.share;
        if (!action) return;
        const id = presentationId();
        if (action === "close") closeShareDialog();
        else if (action === "copy") copyLink();
        else if (action === "open") window.open(document.getElementById("share-link-input")?.value, "_blank", "noopener");
        else if (action === "create")
            // Only the link on this computer. Putting it on a public address is the user's own next step
            // ("Make it reachable from anywhere"): it used to start a Cloudflare tunnel here without asking.
            run(() => publish(id));
        else if (action === "stop")
            run(async () => {
                clearTimeout(republishTimer);
                shareStatus.set(id, await api(shareUrl(id), { method: "DELETE" }));
                message = { text: "Sharing stopped. The link no longer works.", tone: "success" };
            });
        else if (action === "tunnel-start") run(() => tunnelAction("start"));
        else if (action === "tunnel-install") run(() => tunnelAction("install"));
    }

    async function openShareDialog() {
        const el = modal();
        message = null;
        el.classList.remove("hidden");
        render();
        el.querySelector(".share-close")?.focus();
        try {
            if (!presentationId() && typeof saveCurrentProject === "function") await saveCurrentProject();
        } catch (_err) {}
        const id = presentationId();
        try {
            if (id) await refreshShare(id);
            await refreshTunnel();
            // Links from an earlier session need the tunnel again (it stops when SlideForge exits).
            if (id && shareStatus.get(id)?.active && tunnel?.available && !tunnel.running) await tunnelAction("start");
        } catch (err) {
            message = { text: `Sharing is not available: ${err.message || err}`, tone: "error" };
        }
        render();
    }

    function closeShareDialog() {
        clearTimeout(pollTimer);
        document.getElementById("share-modal")?.classList.add("hidden");
    }

    window.openShareDialog = openShareDialog;
    window.closeShareDialog = closeShareDialog;
})();
