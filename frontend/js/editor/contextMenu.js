// js/contextMenu.js

let contextMenuTargetId = null;

function initContextMenu() {
    const canvasWrapper = document.getElementById("canvas-wrapper");
    const menu = document.getElementById("canvas-context-menu");

    canvasWrapper.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const target = e.target.closest(".canvas-element");
        if (!target || target.dataset?.presetBackground === "true") {
            hideContextMenu();
            return;
        }

        contextMenuTargetId = target.id;
        
        // Ensure the element is selected
        if (!state.selectedIds.includes(target.id)) {
            selectElement(target.id, "replace");
        }

        const typeLabel = document.getElementById("ctx-element-type");
        const elData = state.slides[currentSlideIndex].elements.find(el => el.id === target.id);
        if (typeLabel && elData) {
            typeLabel.textContent = elData.type.charAt(0).toUpperCase() + elData.type.slice(1);
        }

        // Update Group/Ungroup buttons
        const groupBtn = menu.querySelector('#ctx-group-btn');
        const ungroupBtn = menu.querySelector('#ctx-ungroup-btn');
        if (groupBtn) {
            groupBtn.classList.toggle("hidden", state.selectedIds.length < 2);
        }
        if (ungroupBtn) {
            const hasGroup = state.selectedIds.some(id => {
                const el = state.slides[currentSlideIndex].elements.find(e => e.id === id);
                return !!el?.groupId;
            });
            ungroupBtn.classList.toggle("hidden", !hasGroup);
        }

        // Update Lock/Unlock text
        const lockBtn = menu.querySelector('button[onclick="ctxAction(\'lock\')"]');
        if (lockBtn && elData) {
            const isLocked = elData.locked === true;
            lockBtn.innerHTML = isLocked 
                ? '<i class="fa-solid fa-unlock text-slate-600 w-4"></i> Unlock Element'
                : '<i class="fa-solid fa-lock text-slate-600 w-4"></i> Lock Element';
        }

        // Position menu
        menu.classList.remove("hidden");
        const menuWidth = menu.offsetWidth || 224;
        const menuHeight = menu.offsetHeight || 300;
        
        let x = e.clientX;
        let y = e.clientY;

        // Keep inside window
        if (x + menuWidth > window.innerWidth) x -= menuWidth;
        if (y + menuHeight > window.innerHeight) y -= menuHeight;

        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
    });

    window.addEventListener("mousedown", (e) => {
        if (menu && !menu.contains(e.target)) {
            hideContextMenu();
        }
    }, true);

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            hideContextMenu();
        }
    }, true);

    window.addEventListener("scroll", hideContextMenu, true);
}

function hideContextMenu() {
    const menu = document.getElementById("canvas-context-menu");
    if (menu) menu.classList.add("hidden");
}

function ctxAction(type) {
    if (!contextMenuTargetId) return;
    
    switch (type) {
        case 'bring-forward':
            changeZIndex(contextMenuTargetId, 1);
            break;
        case 'send-backward':
            changeZIndex(contextMenuTargetId, -1);
            break;
        case 'duplicate':
            duplicateElement();
            break;
        case 'group':
            groupSelected();
            break;
        case 'ungroup':
            ungroupSelected();
            break;
        case 'delete':
            deleteSelectedElements();
            break;
        case 'lock':
            toggleLockElement(contextMenuTargetId);
            break;
    }
    hideContextMenu();
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
