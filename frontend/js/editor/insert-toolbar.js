// The insert bar adapts to the room the canvas leaves it (the window and the side panels both change that):
//   grouped  one button per group ("Charts ▾") that opens a menu of its tools, each with its name;
//   compact  the same group buttons, icon only.
// Before, all twenty icons were always shown: on a laptop screen the last groups ran off the edge, out of reach.

const INSERT_GROUP_ICONS = {
    Basics: "fa-font",
    Charts: "fa-chart-simple",
    Science: "fa-flask",
    Graphics: "fa-shapes",
    Connect: "fa-share-nodes",
    Media: "fa-photo-film",
};

let _insertToolbarReady = false;

function _insertBar() {
    return document.querySelector("#insert-toolbar-row .insert-toolbar");
}

function _insertGroups(bar = _insertBar()) {
    return bar ? [...bar.querySelectorAll(".insert-group:not(.insert-group--plugins)")] : [];
}

function closeInsertGroupMenus(except = null) {
    _insertGroups().forEach(group => {
        if (group === except) return;
        group.classList.remove("is-open");
        group.querySelector(".insert-group-toggle")?.setAttribute("aria-expanded", "false");
        const menu = group._insertMenu;
        if (menu && menu.parentElement !== group) group.appendChild(menu); // back into the bar
        menu?.classList.remove("is-floating");
    });
}

function _openInsertGroup(group, { focus = false } = {}) {
    closeInsertGroupMenus(group);
    window.closePluginInsertMenu?.(); // one menu at a time
    group.classList.add("is-open");
    const toggle = group.querySelector(".insert-group-toggle");
    toggle?.setAttribute("aria-expanded", "true");
    // The menu opens below its button, kept inside the window, on the page itself: inside the bar (blurred, shifted,
    // and scrolling sideways when even its group buttons do not fit) it would be cut off.
    const menu = group._insertMenu;
    if (menu && toggle) {
        document.body.appendChild(menu);
        menu.classList.add("is-floating");
        const box = toggle.getBoundingClientRect();
        menu.style.top = `${Math.round(box.bottom + 8)}px`;
        menu.style.left = "0px";
        const width = menu.offsetWidth;
        menu.style.left = `${Math.round(Math.max(8, Math.min(box.left, window.innerWidth - width - 8)))}px`;
    }
    if (focus) menu?.querySelector(".insert-tool-btn")?.focus();
}

function _setUpInsertToolbar(bar) {
    if (_insertToolbarReady) return;
    _insertToolbarReady = true;
    _insertGroups(bar).forEach(group => {
        const caption = group.dataset.caption || group.getAttribute("aria-label") || "";
        const tools = [...group.querySelectorAll(":scope > .insert-tool-btn")];
        // Each tool gets its name beside its icon, shown only in the menus.
        tools.forEach(button => {
            if (button.querySelector(".insert-tool-name")) return;
            const name = document.createElement("span");
            name.className = "insert-tool-name";
            name.textContent = button.title === "Text Block" ? "Text" : button.getAttribute("aria-label") || button.title || "";
            button.appendChild(name);
            if (caption !== "Basics") button.setAttribute("role", "menuitem");
        });
        const list = document.createElement("div");
        list.className = "insert-group-tools";
        list.setAttribute("role", caption === "Basics" ? "group" : "menu");
        list.setAttribute("aria-label", caption);
        tools.forEach(button => list.appendChild(button));
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "toolbar-btn insert-group-toggle";
        toggle.title = caption;
        toggle.setAttribute("aria-haspopup", "menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.innerHTML = `<i class="fa-solid ${INSERT_GROUP_ICONS[caption] || "fa-plus"}" aria-hidden="true"></i><span class="insert-group-toggle-label"></span><i class="fa-solid fa-chevron-down insert-group-chevron" aria-hidden="true"></i>`;
        toggle.querySelector(".insert-group-toggle-label").textContent = caption;
        toggle.addEventListener("click", event => {
            event.stopPropagation();
            if (group.classList.contains("is-open")) closeInsertGroupMenus();
            else _openInsertGroup(group);
        });
        toggle.addEventListener("keydown", event => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                _openInsertGroup(group, { focus: true });
            }
        });
        list.addEventListener("keydown", event => {
            const items = [...list.querySelectorAll(".insert-tool-btn")];
            const at = items.indexOf(document.activeElement);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeInsertGroupMenus();
                toggle.focus();
            }
        });
        // A tool chosen from a menu closes it.
        list.addEventListener("click", () => {
            if (bar.dataset.layout !== "full") closeInsertGroupMenus();
        });
        group.prepend(toggle);
        group.appendChild(list);
        group._insertMenu = list;
        list._insertGroup = group;
    });
    document.addEventListener("pointerdown", event => {
        if (!event.target.closest?.(".insert-group.is-open, .insert-group-tools.is-floating")) closeInsertGroupMenus();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeInsertGroupMenus();
    });
    bar.addEventListener("scroll", () => closeInsertGroupMenus(), { passive: true });
    window.addEventListener("resize", () => closeInsertGroupMenus());
}

// Prefer labelled menus, falling back to icons when the canvas is narrow.
function fitInsertToolbar() {
    const bar = _insertBar();
    const row = document.getElementById("insert-toolbar-row");
    if (!bar || !row) return;
    _setUpInsertToolbar(bar);
    const room = row.clientWidth || row.getBoundingClientRect().width;
    if (!room) return;
    const previous = bar.dataset.layout;
    let chosen = "compact";
    for (const layout of ["grouped", "compact"]) {
        bar.dataset.layout = layout;
        if (bar.scrollWidth <= room + 1) {
            chosen = layout;
            break;
        }
    }
    bar.dataset.layout = chosen;
    if (chosen !== previous) closeInsertGroupMenus();
}

window.addEventListener("resize", () => requestAnimationFrame(fitInsertToolbar));
// Measured again once the web fonts are in (the group names grow a little) and whenever the bar's row changes size.
document.fonts?.ready?.then(() => requestAnimationFrame(fitInsertToolbar));
// A weight first used later (the bar's labels) loads after `ready`: measure again whenever fonts arrive.
document.fonts?.addEventListener?.("loadingdone", () => requestAnimationFrame(fitInsertToolbar));
if (typeof ResizeObserver === "function") {
    // Only a change of width: measuring tries each layout, which changes the row's height, and refitting on that
    // re-measured on every frame (the page drew 4 frames a second).
    const watch = () => {
        const row = document.getElementById("insert-toolbar-row");
        if (!row) return;
        let width = -1;
        new ResizeObserver(entries => {
            const next = Math.round(entries[entries.length - 1].contentRect.width);
            if (next === width) return;
            width = next;
            requestAnimationFrame(fitInsertToolbar);
        }).observe(row);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
    else watch();
}
window.fitInsertToolbar = fitInsertToolbar;
window.closeInsertGroupMenus = closeInsertGroupMenus;

function setUpEditorToolsMenu() {
    const cluster = document.querySelector("#app-toolbar .toolbar-icon-cluster");
    if (!cluster || document.getElementById("editor-tools-menu")) return;
    // Light / dark stays in the bar: it is a setting people look for at a glance, not an occasional tool.
    const tools = [
        ["[title='Copy Selected Element']", "Copy"],
        ["[title='Paste From Clipboard']", "Paste"],
        ["#toggle-transitions-modal", "Slide transitions"],
        ["#toggle-timeline-editor", "Animation timeline"],
        ["[aria-label='Tidy slide layout']", "Tidy slide layout"],
    ];
    const menu = document.createElement("details");
    menu.id = "editor-tools-menu";
    menu.className = "editor-tools-menu";
    menu.innerHTML = '<summary class="toolbar-btn" title="More tools" aria-label="More tools"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></summary><div class="editor-tools-menu__items"></div>';
    const list = menu.querySelector(".editor-tools-menu__items");
    tools.forEach(([selector, label]) => {
        const button = document.querySelector(`#app-toolbar ${selector}`);
        if (!button) return;
        let name = button.querySelector(".toolbar-btn-label");
        if (!name) {
            name = document.createElement("span");
            name.className = "toolbar-btn-label";
            button.appendChild(name);
        }
        name.textContent = label;
        list.appendChild(button);
    });
    // Separators no longer separate the commands they originally accompanied.
    cluster.querySelectorAll(":scope > .w-px").forEach(node => node.remove());
    cluster.appendChild(menu);
    list.addEventListener("click", event => {
        if (event.target.closest("button")) menu.open = false;
    });
    document.addEventListener("pointerdown", event => {
        if (!menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.stopPropagation();
            menu.open = false;
            menu.querySelector("summary").focus();
        }
    });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setUpEditorToolsMenu);
else setUpEditorToolsMenu();
