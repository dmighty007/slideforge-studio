// "Plugins": lists the built-in plugins and the user's own (from their plugins folder), switches them on and off,
// installs one from a .zip and removes the user's own. The server keeps the list and the switches
// (backend: slideforge/studio/plugins.py); js/plugins/plugins.js loads and unloads them in the open editor.

(function () {
    let listing = null; // the last GET /api/plugins/ answer
    let busy = false;
    let message = null; // { text, tone }
    let confirmingRemove = ""; // the id whose Remove button was pressed once
    let search = "";
    const replaced = new Set(); // plugins reinstalled while their old script is still running

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

    function modal() {
        let el = document.getElementById("plugin-manager-modal");
        if (el) return el;
        el = document.createElement("div");
        el.id = "plugin-manager-modal";
        el.className = "share-modal hidden";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.setAttribute("aria-labelledby", "plugin-manager-title");
        el.innerHTML = `<div class="share-card plugin-manager-card"><div id="plugin-manager-body"></div>
            <input type="file" id="plugin-manager-file" accept=".zip,application/zip" hidden></div>`;
        el.addEventListener("mousedown", (event) => {
            if (event.target === el) closePluginManager();
        });
        document.addEventListener(
            "keydown",
            (event) => {
                if (event.key !== "Escape" || el.classList.contains("hidden")) return;
                event.stopPropagation();
                event.preventDefault();
                closePluginManager();
            },
            true,
        );
        el.addEventListener("click", onClick);
        el.addEventListener("change", onChange);
        el.addEventListener("input", onInput);
        document.body.appendChild(el);
        return el;
    }

    function usageText(id) {
        const count = typeof countPluginObjects === "function" ? countPluginObjects(id) : 0;
        if (!count) return "";
        return `Used ${count === 1 ? "once" : `${count} times`} in this presentation`;
    }

    function pluginMatches(plugin) {
        if (!search) return true;
        const haystack = [plugin.id, plugin.name, plugin.description, plugin.author].filter(Boolean).join(" ").toLocaleLowerCase();
        return haystack.includes(search);
    }

    function pluginRow(plugin, canManage) {
        const loaded = typeof getSlidePlugin === "function" && getSlidePlugin(plugin.id);
        const icon = plugin.icon || loaded?.icon || "fa-solid fa-puzzle-piece";
        const usage = usageText(plugin.id);
        const notes = [
            usage && `<span>${escapeHtml(usage)}</span>`,
            plugin.author && `<span>by ${escapeHtml(plugin.author)}</span>`,
            plugin.homepage && `<a href="${escapeHtml(plugin.homepage)}" target="_blank" rel="noopener noreferrer">Website</a>`,
        ].filter(Boolean);
        const removing = confirmingRemove === plugin.id;
        return `<li class="plugin-row${plugin.enabled ? "" : " plugin-row--off"}" data-plugin-row="${escapeHtml(plugin.id)}">
            <span class="plugin-row__icon"><i class="${escapeHtml(icon)}" aria-hidden="true"></i></span>
            <div class="plugin-row__main">
                <div class="plugin-row__title">
                    <span class="plugin-row__name">${escapeHtml(plugin.name || plugin.id)}</span>
                    ${plugin.version ? `<span class="plugin-row__version">${escapeHtml(plugin.version)}</span>` : ""}
                    <span class="plugin-badge plugin-badge--${plugin.source === "user" ? "user" : "bundled"}">${plugin.source === "user" ? "Yours" : "Built-in"}</span>
                </div>
                ${plugin.description ? `<p class="plugin-row__text">${escapeHtml(plugin.description)}</p>` : ""}
                ${notes.length ? `<p class="plugin-row__meta">${notes.join(" · ")}</p>` : ""}
                ${plugin.error ? `<p class="share-error plugin-row__error">${escapeHtml(plugin.error)}</p>` : ""}
                ${replaced.has(plugin.id) ? `<p class="plugin-row__meta"><i class="fa-solid fa-rotate"></i> Reload SlideForge to use the version you just installed.</p>` : ""}
                ${
                    canManage && plugin.source === "user"
                        ? `<div class="plugin-row__actions">
                            <button type="button" class="share-btn share-btn-danger plugin-row__remove" data-plugin-action="remove" data-plugin-id="${escapeHtml(plugin.id)}" ${busy ? "disabled" : ""}>
                                <i class="fa-regular fa-trash-can"></i> ${removing ? "Delete its files for good?" : "Remove"}
                            </button>
                            ${removing ? `<button type="button" class="share-btn" data-plugin-action="keep">Keep</button>` : ""}
                        </div>`
                        : ""
                }
            </div>
            <label class="plugin-switch" title="${plugin.enabled ? "Switch off" : "Switch on"}">
                <input type="checkbox" data-plugin-toggle="${escapeHtml(plugin.id)}" ${plugin.enabled ? "checked" : ""}
                    ${!canManage || busy || (plugin.error && !plugin.enabled) ? "disabled" : ""}
                    aria-label="${escapeHtml(plugin.name || plugin.id)} on">
                <span class="plugin-switch__track" aria-hidden="true"></span>
            </label>
        </li>`;
    }

    // Plugins the open deck uses that this installation does not have at all.
    function missingRows() {
        const known = new Set((listing?.plugins || []).map((plugin) => plugin.id));
        const used = new Map();
        (state?.slides || []).forEach((slide) =>
            (slide.elements || []).forEach((el) => {
                if (el?.type === "plugin" && !known.has(el.pluginId)) used.set(el.pluginId, (used.get(el.pluginId) || 0) + 1);
            }),
        );
        return [...used.entries()]
            .filter(([id]) => pluginMatches({ id, name: id }))
            .map(
            ([id, count]) => `<li class="plugin-row plugin-row--off">
                <span class="plugin-row__icon"><i class="fa-solid fa-circle-question" aria-hidden="true"></i></span>
                <div class="plugin-row__main">
                    <div class="plugin-row__title"><span class="plugin-row__name">${escapeHtml(id)}</span>
                        <span class="plugin-badge plugin-badge--missing">Not installed</span></div>
                    <p class="plugin-row__text">This presentation has ${count === 1 ? "an object" : `${count} objects`} from it. They show their last saved picture.</p>
                </div>
            </li>`,
            );
    }

    function render() {
        const el = document.getElementById("plugin-manager-modal");
        if (!el || el.classList.contains("hidden")) return;
        const canManage = Boolean(listing?.canManage);
        let content;
        if (!listing) {
            content = `<p class="share-progress"><span class="share-spinner"></span> Loading…</p>`;
        } else {
            const rows = [...listing.plugins.filter(pluginMatches).map((plugin) => pluginRow(plugin, canManage)), ...missingRows()];
            content = `
                ${canManage ? "" : `<p class="share-note"><i class="fa-solid fa-lock"></i> Only an administrator can switch plugins on or off.</p>`}
                <label class="plugin-search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <span class="sr-only">Search plugins</span>
                    <input id="plugin-manager-search" type="search" value="${escapeHtml(search)}" placeholder="Search plugins…" autocomplete="off">
                </label>
                ${
                    rows.length
                        ? `<ul class="plugin-list">${rows.join("")}</ul>`
                        : `<p class="share-text">${search ? "No plugins match your search." : "No plugins are installed."}</p>`
                }
                ${
                    listing.userDir
                        ? `<div class="share-section">
                            <p class="share-text">Your own plugins go in this folder (one folder per plugin, with a <code>plugin.js</code>). They are kept when SlideForge is updated.</p>
                            <div class="share-link-row">
                                <input id="plugin-manager-dir" class="share-link-input" type="text" readonly value="${escapeHtml(listing.userDir)}" aria-label="Your plugins folder">
                                <button type="button" class="share-btn" data-plugin-action="copy-dir"><i class="fa-regular fa-copy"></i> Copy</button>
                            </div>
                        </div>`
                        : ""
                }
                <div class="share-row share-row-end">
                    <button type="button" class="share-btn" data-plugin-action="rescan" ${busy ? "disabled" : ""}><i class="fa-solid fa-rotate"></i> Look again</button>
                    ${
                        listing.canInstall
                            ? `<button type="button" class="share-btn share-btn-primary" data-plugin-action="install" ${busy ? "disabled" : ""}>
                                ${busy ? '<span class="share-spinner"></span> Working…' : '<i class="fa-solid fa-file-zipper"></i> Install from .zip…'}</button>`
                            : ""
                    }
                </div>
                <p class="share-hint">Plugins run inside SlideForge with full access to your presentations. Only install plugins you trust. How to write one: docs/PLUGINS.md.</p>`;
        }
        el.querySelector("#plugin-manager-body").innerHTML = `
            <div class="share-head">
                <div>
                    <div id="plugin-manager-title" class="share-title">Plugins</div>
                    <div class="share-subtitle">New kinds of slide objects</div>
                </div>
                <button type="button" class="share-close" data-plugin-action="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            ${message ? `<p class="share-${message.tone}">${escapeHtml(message.text)}</p>` : ""}
            ${content}`;
        if (!el.contains(document.activeElement)) el.querySelector(".share-close")?.focus({ preventScroll: true });
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

    // Brings the open editor in line with the server's list: loads what was switched on, unloads what was not.
    async function apply(next) {
        listing = next;
        await fetchPluginCatalogue().catch(() => {});
        const problems = [];
        for (const plugin of next.plugins || []) {
            const loaded = Boolean(getSlidePlugin(plugin.id));
            if (plugin.enabled && !plugin.error && !loaded) {
                try {
                    await enableSlidePlugin(plugin.id, plugin.script);
                } catch (err) {
                    problems.push(`${plugin.name || plugin.id}: ${err.message || err}`);
                }
            } else if (!plugin.enabled && loaded) {
                disableSlidePlugin(plugin.id);
            }
        }
        // Removed from the folder: unload it too.
        const ids = new Set((next.plugins || []).map((plugin) => plugin.id));
        listSlidePlugins()
            .filter((plugin) => !ids.has(plugin.id))
            .forEach((plugin) => disableSlidePlugin(plugin.id));
        if (problems.length) throw new Error(`Could not load: ${problems.join("; ")}`);
    }

    function onClick(event) {
        const target = event.target.closest("[data-plugin-action]");
        const action = target?.dataset.pluginAction;
        if (!action) return;
        if (action === "close") closePluginManager();
        else if (action === "rescan") run(async () => apply(await api("/api/plugins/")));
        else if (action === "install") document.getElementById("plugin-manager-file")?.click();
        else if (action === "keep") {
            confirmingRemove = "";
            render();
        } else if (action === "remove") {
            const id = target.dataset.pluginId;
            if (confirmingRemove !== id) {
                confirmingRemove = id;
                render();
                return;
            }
            confirmingRemove = "";
            run(async () => {
                await apply(await api(`/api/plugins/${encodeURIComponent(id)}/`, { method: "DELETE" }));
                message = { text: `Removed “${id}”.`, tone: "success" };
            });
        } else if (action === "copy-dir") {
            const input = document.getElementById("plugin-manager-dir");
            navigator.clipboard?.writeText(input.value).catch(() => {
                input.select();
                document.execCommand("copy");
            });
            message = { text: "Folder path copied", tone: "success" };
            render();
        }
    }

    function onChange(event) {
        const toggle = event.target.closest("[data-plugin-toggle]");
        if (toggle) {
            const id = toggle.dataset.pluginToggle;
            const enabled = toggle.checked;
            run(async () => {
                await apply(await api(`/api/plugins/${encodeURIComponent(id)}/`, { method: "POST", body: JSON.stringify({ enabled }) }));
            });
            return;
        }
        if (event.target.id === "plugin-manager-file") {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            run(async () => {
                const form = new FormData();
                form.append("plugin", file, file.name);
                const result = await api("/api/plugins/install/", { method: "POST", body: form });
                // A plugin whose script already ran keeps running its old code until the editor is reloaded.
                if (typeof SlideForgePlugins !== "undefined" && SlideForgePlugins.get(result.installed)) replaced.add(result.installed);
                await apply(result);
                const installed = result.plugins.find((plugin) => plugin.id === result.installed);
                message = { text: `Installed “${installed?.name || result.installed}”.`, tone: "success" };
            });
        }
    }

    function onInput(event) {
        if (event.target.id !== "plugin-manager-search") return;
        search = String(event.target.value || "").trim().toLocaleLowerCase();
        render();
        const input = document.getElementById("plugin-manager-search");
        if (input) {
            input.focus({ preventScroll: true });
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }

    async function openPluginManager() {
        const el = modal();
        message = null;
        confirmingRemove = "";
        search = "";
        el.classList.remove("hidden");
        render();
        el.querySelector(".share-close")?.focus();
        try {
            listing = await api("/api/plugins/");
        } catch (err) {
            // The frontend on its own (no server): the built-in list, read-only.
            listing = await fetchPluginCatalogue().catch(() => ({ plugins: [], canManage: false }));
            message = { text: `Plugins cannot be changed here: ${err.message || err}`, tone: "error" };
        }
        render();
    }

    function closePluginManager() {
        document.getElementById("plugin-manager-modal")?.classList.add("hidden");
    }

    window.openPluginManager = openPluginManager;
    window.closePluginManager = closePluginManager;
})();
