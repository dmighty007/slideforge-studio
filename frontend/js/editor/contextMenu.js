// js/contextMenu.js

let contextMenuTargetId = null;

// What the menu offers: on objects, the clipboard, order, grouping, lock and delete; on the empty slide, paste
// (where you clicked) and select all. Before, it had no clipboard or front/back items, Duplicate did nothing (it
// was called without the object), and a right-click on the slide itself showed no menu at all.
const CONTEXT_MENU_SHORTCUT_MOD = /Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl+";

function _contextMenuItems(onElement) {
    const slide = state.slides[currentSlideIndex];
    const selected = slide.elements.filter(el => state.selectedIds.includes(el.id));
    const k = CONTEXT_MENU_SHORTCUT_MOD;
    if (!onElement) {
        return [
            { action: "paste", icon: "fa-regular fa-paste", label: "Paste here", keys: `${k}V` },
            { action: "select-all", icon: "fa-solid fa-object-ungroup", label: "Select all", keys: `${k}A` },
        ];
    }
    const locked = selected.length === 1 && selected[0].locked === true;
    const grouped = selected.some(el => el.groupId);
    return [
        { action: "cut", icon: "fa-solid fa-scissors", label: "Cut", keys: `${k}X` },
        { action: "copy", icon: "fa-regular fa-copy", label: "Copy", keys: `${k}C` },
        { action: "paste", icon: "fa-regular fa-paste", label: "Paste", keys: `${k}V` },
        { action: "duplicate", icon: "fa-regular fa-clone", label: "Duplicate", keys: `${k}D` },
        "-",
        { action: "front", icon: "fa-solid fa-angles-up", label: "Bring to front" },
        { action: "forward", icon: "fa-solid fa-angle-up", label: "Bring forward" },
        { action: "backward", icon: "fa-solid fa-angle-down", label: "Send backward" },
        { action: "back", icon: "fa-solid fa-angles-down", label: "Send to back" },
        "-",
        ...(selected.length > 1 && !(grouped && selected.every(el => el.groupId === selected[0].groupId))
            ? [{ action: "group", icon: "fa-solid fa-object-group", label: "Group", keys: `${k}G` }]
            : []),
        ...(grouped ? [{ action: "ungroup", icon: "fa-solid fa-object-ungroup", label: "Ungroup", keys: `${k}⇧G` }] : []),
        { action: "lock", icon: locked ? "fa-solid fa-unlock" : "fa-solid fa-lock", label: locked ? "Unlock" : "Lock" },
        "-",
        { action: "delete", icon: "fa-regular fa-trash-can", label: "Delete", keys: "Del", danger: true },
    ];
}

function _renderContextMenu(menu, onElement, title) {
    menu.innerHTML = "";
    const head = document.createElement("div");
    head.className = "px-3 py-1.5 mb-1 border-b border-border";
    head.innerHTML = '<span id="ctx-element-type" class="text-[10px] font-bold text-text-sub uppercase tracking-widest"></span>';
    head.firstChild.textContent = title;
    menu.appendChild(head);
    const items = _contextMenuItems(onElement);
    items.forEach((item, index) => {
        if (item === "-") {
            if (index && items[index - 1] !== "-") menu.appendChild(Object.assign(document.createElement("div"), { className: "h-px bg-border my-1" }));
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.dataset.ctxAction = item.action;
        button.className = `ctx-menu-item w-full flex items-center gap-3 px-4 py-1.5 text-sm hover:bg-surface transition-colors ${item.danger ? "text-red-500" : "text-text-main"}`;
        button.innerHTML = `<i class="${item.icon} w-4 ${item.danger ? "" : "text-text-sub"}" aria-hidden="true"></i><span class="flex-1 text-left"></span>${item.keys ? '<kbd class="ctx-menu-keys"></kbd>' : ""}`;
        button.querySelector("span").textContent = item.label;
        if (item.keys) button.querySelector("kbd").textContent = item.keys;
        button.addEventListener("click", () => ctxAction(item.action));
        menu.appendChild(button);
    });
}

let contextMenuPoint = null; // where the menu was opened, in the page: "Paste here" puts the objects there

function openContextMenuAt(target, clientX, clientY) {
    const menu = document.getElementById("canvas-context-menu");
    if (!menu) return;
    const element = target?.closest?.(".canvas-element");
    const onElement = Boolean(element && element.dataset?.presetBackground !== "true");
    const onSlide = Boolean(target?.closest?.(".slides > section"));
    if (!onElement && !onSlide) {
        hideContextMenu();
        return;
    }
    contextMenuPoint = { clientX, clientY };
    let title = "Slide";
    if (onElement) {
        contextMenuTargetId = element.id;
        // The object under the pointer is what the menu acts on (with the rest of the selection if it is in it).
        if (!state.selectedIds.includes(element.id)) selectElement(element.id, "replace");
        const elData = state.slides[currentSlideIndex].elements.find(el => el.id === element.id);
        const count = state.selectedIds.length;
        title = count > 1 ? `${count} objects` : elData ? elData.type.charAt(0).toUpperCase() + elData.type.slice(1) : "Object";
    } else {
        contextMenuTargetId = null;
    }
    _renderContextMenu(menu, onElement, title);

    menu.classList.remove("hidden");
    menu.style.left = "0px";
    menu.style.top = "0px";
    const width = menu.offsetWidth || 224;
    const height = menu.offsetHeight || 300;
    // Opened to the left or above the pointer when there is no room, and never off the window's edge.
    let x = clientX + width > window.innerWidth - 8 ? clientX - width : clientX;
    let y = clientY + height > window.innerHeight - 8 ? clientY - height : clientY;
    x = Math.max(8, Math.min(x, window.innerWidth - width - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - height - 8));
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
    menu.setAttribute("role", "menu");
    menu._returnFocus = document.activeElement;
}

function initContextMenu() {
    const canvasWrapper = document.getElementById("canvas-wrapper");
    const menu = document.getElementById("canvas-context-menu");

    canvasWrapper.addEventListener("contextmenu", (e) => {
        // While presenting, the presentation's own menu answers (presentation-tools.js).
        if (document.body.classList.contains("play-mode-active")) return;
        // In text being edited the browser's own menu answers (spelling, copy and paste of the words). Chrome
        // also sends this event for a tap in such text, and the object menu then covered it.
        if (e.target.closest?.('[contenteditable="true"], input, textarea')) {
            hideContextMenu();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        openContextMenuAt(e.target, e.clientX, e.clientY);
        // From the keyboard (the Menu key, Shift+F10) the first item takes the focus.
        if (e.button !== 2 || (!e.clientX && !e.clientY)) menu.querySelector(".ctx-menu-item")?.focus();
    });

    window.addEventListener("mousedown", (e) => {
        if (menu && !menu.contains(e.target)) {
            hideContextMenu();
        }
    }, true);

    window.addEventListener("keydown", (e) => {
        if (!menu || menu.classList.contains("hidden")) return;
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            hideContextMenu();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const items = [...menu.querySelectorAll(".ctx-menu-item")];
        const at = items.indexOf(document.activeElement);
        const next = e.key === "Home" ? 0
            : e.key === "End" ? items.length - 1
            : e.key === "ArrowDown" ? (at + 1) % items.length
            : (at <= 0 ? items.length : at) - 1;
        items[next]?.focus();
    }, true);

    window.addEventListener("scroll", hideContextMenu, true);
    window.addEventListener("resize", hideContextMenu);
    window.addEventListener("blur", hideContextMenu);
}

function hideContextMenu() {
    const menu = document.getElementById("canvas-context-menu");
    if (!menu || menu.classList.contains("hidden")) return;
    menu.classList.add("hidden");
    if (menu.contains(document.activeElement)) menu._returnFocus?.focus?.();
}

// Slide coordinates of a point in the page.
function _slidePointAt(clientX, clientY) {
    const slide = document.querySelector(".reveal .slides section.present");
    const rect = slide?.getBoundingClientRect();
    if (!rect) return null;
    const scale = typeof getCanvasScale === "function" ? getCanvasScale() : 1;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

async function _pasteAtContextPoint() {
    const point = contextMenuPoint && _slidePointAt(contextMenuPoint.clientX, contextMenuPoint.clientY);
    const before = new Set(state.slides[currentSlideIndex].elements.map(el => el.id));
    const pasted = await pasteFromClipboard();
    if (!pasted || !point) return;
    const added = state.slides[currentSlideIndex].elements.filter(el => !before.has(el.id));
    if (!added.length) return;
    // The pasted objects' top-left corner where the menu was opened, kept on the slide.
    const { width: slideW, height: slideH } = typeof getSlideSize === "function" ? getSlideSize() : { width: 1280, height: 720 };
    const left = Math.min(...added.map(el => parseFloat(el.x) || 0));
    const top = Math.min(...added.map(el => parseFloat(el.y) || 0));
    const right = Math.max(...added.map(el => (parseFloat(el.x) || 0) + (parseFloat(el.width) || 0)));
    const bottom = Math.max(...added.map(el => (parseFloat(el.y) || 0) + (parseFloat(el.height) || 0)));
    const dx = Math.max(0, Math.min(point.x, slideW - (right - left))) - left;
    const dy = Math.max(0, Math.min(point.y, slideH - (bottom - top))) - top;
    added.forEach(el => {
        el.x = Math.round((parseFloat(el.x) || 0) + dx);
        el.y = Math.round((parseFloat(el.y) || 0) + dy);
    });
    renderSlidesFromState();
    setSelectedIds(added.map(el => el.id));
    buildPropertiesPanel();
    updateGroupBound();
    window.schedulePresentationAutosave?.();
}

function ctxAction(type) {
    hideContextMenu();
    switch (type) {
        case "cut":
            copyElement();
            deleteSelectedElements();
            break;
        case "copy":
            copyElement();
            break;
        case "paste":
            _pasteAtContextPoint();
            break;
        case "duplicate":
            duplicateSelectedElements();
            break;
        case "select-all": {
            const ids = state.slides[currentSlideIndex].elements
                .filter(el => el && !el.editableMasterFooterElement && !el.isMasterElement)
                .map(el => el.id);
            setSelectedIds(ids);
            buildPropertiesPanel();
            updateGroupBound();
            break;
        }
        case "front":
        case "forward":
        case "backward":
        case "back":
            reorderSelection(type);
            break;
        case "group":
            groupSelected();
            break;
        case "ungroup":
            ungroupSelected();
            break;
        case "delete":
            deleteSelectedElements();
            break;
        case "lock":
            if (contextMenuTargetId) toggleLockElement(contextMenuTargetId);
            break;
    }
}

// Stacking order of the selection: to the front or back, or one place up or down past the next object. Bring
// forward used to add 1 to the object's own number, which often tied with the object above and changed nothing.
function reorderSelection(where) {
    const slide = state.slides[currentSlideIndex];
    const content = slide.elements.filter(el => !el.isMasterElement && !el.editableMasterFooterElement && !(typeof isPresetBackgroundElement === "function" && isPresetBackgroundElement(el)));
    if (!content.length || !state.selectedIds.length) return;
    const order = content
        .map((el, index) => ({ el, index, z: parseInt(el.styles?.zIndex, 10) || 0 }))
        .sort((a, b) => a.z - b.z || a.index - b.index)
        .map(entry => entry.el);
    const picked = order.filter(el => state.selectedIds.includes(el.id));
    const rest = order.filter(el => !state.selectedIds.includes(el.id));
    let next;
    if (where === "front") next = [...rest, ...picked];
    else if (where === "back") next = [...picked, ...rest];
    else {
        next = order.slice();
        const step = where === "forward" ? 1 : -1;
        const sequence = step > 0 ? [...picked].reverse() : picked;
        sequence.forEach(el => {
            const at = next.indexOf(el);
            const to = at + step;
            if (to < 0 || to >= next.length || state.selectedIds.includes(next[to].id)) return;
            next.splice(at, 1);
            next.splice(to, 0, el);
        });
    }
    if (next.every((el, i) => el === order[i])) return;
    saveStateToUndo();
    // Numbered from the lowest number in use, so objects stay above the slide's background and below its footer.
    const base = Math.max(1, Math.min(...order.map(el => parseInt(el.styles?.zIndex, 10) || 1)));
    next.forEach((el, i) => {
        el.styles = { ...(el.styles || {}), zIndex: base + i };
        const dom = getActiveSlideElementDom?.(el.id) || document.getElementById(el.id);
        if (dom) dom.style.zIndex = base + i;
    });
    buildPropertiesPanel();
    window.renderSlidePreviews?.(currentSlideIndex);
    window.schedulePresentationAutosave?.();
}

function changeZIndex(id, delta) {
    const slide = state.slides[currentSlideIndex];
    const elData = slide.elements.find(el => el.id === id);
    if (!elData) return;

    saveStateToUndo();
    const currentZ = parseInt(elData.styles?.zIndex) || 1;
    const nextZ = Math.max(1, currentZ + delta);
    
    updateElementState(id, { styles: { ...elData.styles, zIndex: nextZ } });
    
    const dom = document.getElementById(id);
    if (dom) dom.style.zIndex = nextZ;
    
    buildPropertiesPanel();
}

function toggleLockElement(id) {
    const slide = state.slides[currentSlideIndex];
    const elData = slide.elements.find(el => el.id === id);
    if (!elData) return;

    saveStateToUndo();
    const nextLocked = !elData.locked;
    updateElementState(id, { locked: nextLocked });
    
    const dom = document.getElementById(id);
    if (dom) {
        dom.classList.toggle("element-locked", nextLocked);
    }
    buildPropertiesPanel();
}

window.initContextMenu = initContextMenu;
window.ctxAction = ctxAction;
window.openContextMenuAt = openContextMenuAt;
window.reorderSelection = reorderSelection;
